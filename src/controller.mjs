import { MonitorRuntime } from "./runtime.mjs";
import { validateArtifactBoundary } from "./observer-registry.mjs";
import { randomUUID } from "node:crypto";

export class RelayMonitorsController {
  constructor({ events, observers, capabilities = null, maintenance = null, logger = console, pollIntervalMs = 1_000, observationTimeoutMs = 30_000, workerId = `relay-monitors-${randomUUID()}` }) {
    if (events?.apiVersion !== 1) throw new Error(`Monitors requires relayEvents API v1, received ${events?.apiVersion}`);
    this.events = events;
    this.observers = observers;
    this.capabilities = capabilities;
    this.maintenance = typeof maintenance === "function" ? maintenance : null;
    this.logger = logger;
    this.pollIntervalMs = positiveInteger(pollIntervalMs, 1_000);
    this.stopped = false;
    this.timer = null;
    this.accepting = true;
    this.inFlight = new Set();
    this.abort = new AbortController();
    this.observationTimeoutMs = Math.min(30_000, positiveInteger(observationTimeoutMs, 30_000));
    this.runtime = new MonitorRuntime({
      store: monitorStore(events),
      observer: {
        observe: input => this.observe(input),
        detect: input => this.observers.detect(input),
      },
      relayRuntime: { dispatchSession: sessionId => events.dispatchSession(sessionId) },
      workerId,
    });
    this.provider = Object.freeze({
      id: "relay.monitors",
      prepare: input => this.run(() => this.prepare(input)),
      checkMonitor: (id, options) => this.run(async () => {
        const result = await this.runtime.checkMonitor(id, options);
        await this.runMaintenance();
        return result;
      }),
    });
    this.availabilityDisposers = [];
    if (typeof observers.subscribe === "function") {
      this.availabilityDisposers.push(observers.subscribe(change => this.queueAvailabilityAudit("observer", change.id)));
    }
    if (typeof capabilities?.subscribe === "function") {
      this.availabilityDisposers.push(capabilities.subscribe(change => this.queueAvailabilityAudit("capability", change.id)));
    }
  }

  start() {
    this.schedule(0);
    this.queueAvailabilityAudit("all", null, { missingOnly: true });
  }

  async prepare({ waits, monitors }) {
    for (const monitor of monitors) validateArtifactBoundary(monitor);
    return this.runtime.prepare({ waits, monitors });
  }

  schedule(delay = this.pollIntervalMs) {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      if (this.stopped) return;
      void this.run(async () => {
        const results = await this.runtime.runDue();
        await this.runMaintenance();
        return results;
      }).catch(error => {
        this.logger.error?.(`Relay Monitor worker failed: ${error?.stack ?? error}`);
      }).finally(() => this.schedule());
    }, delay);
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.accepting = false;
    this.abort.abort(new Error("Relay Monitors is shutting down"));
    for (const dispose of this.availabilityDisposers.splice(0)) dispose();
    if (this.timer) clearTimeout(this.timer);
    await Promise.allSettled([...this.inFlight]);
  }

  async runMaintenance() {
    if (!this.maintenance) return;
    try { await this.maintenance(); }
    catch (error) { this.logger.error?.(`Relay Monitor maintenance failed: ${error?.stack ?? error}`); }
  }

  queueAvailabilityAudit(kind, id, options = {}) {
    queueMicrotask(() => {
      if (!this.accepting) return;
      void this.run(() => this.auditAvailability(kind, id, options)).catch(error => {
        this.logger.error?.(`Relay Monitor availability audit failed: ${error?.stack ?? error}`);
      });
    });
  }

  async auditAvailability(kind, id, { missingOnly = false } = {}) {
    const registrations = this.events.listWaits();
    for (const monitor of registrations.flatMap(registration => registration.monitors ?? [])) {
      if (!new Set(["active", "degraded"]).has(monitor.state) || monitor.paused) continue;
      const observerId = monitor.observer?.provider;
      const grants = monitor.artifact?.manifest?.capability_grants ?? [];
      const affected = kind === "all"
        ? !this.observers.has?.(observerId) || grants.some(grant => !this.capabilities?.hasCapabilityProvider?.(grant.provider))
        : kind === "observer" ? observerId === id : grants.some(grant => grant.provider === id);
      if (!affected) continue;
      if (missingOnly && this.observers.has?.(observerId)
        && grants.every(grant => this.capabilities?.hasCapabilityProvider?.(grant.provider))) continue;
      await this.runtime.checkMonitor(monitor.monitor_id, { force: true });
    }
  }

  async observe(input) {
    const timeout = new AbortController();
    const signal = AbortSignal.any([this.abort.signal, timeout.signal]);
    const timer = setTimeout(() => timeout.abort(new Error("Monitor observation timed out")), this.observationTimeoutMs);
    let onAbort;
    const cancelled = new Promise((_, reject) => {
      onAbort = () => {
        const error = new Error(signal.reason?.message ?? "Monitor cancelled");
        error.errorClass = this.abort.signal.aborted ? "cancelled" : "observation_timeout";
        reject(error);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    try {
      const observation = await Promise.race([cancelled, Promise.resolve().then(() => {
      signal.throwIfAborted();
      return this.observers.observe({ ...input, signal });
      })]);
      return validateObservationBoundary(observation);
    }
    finally { clearTimeout(timer); signal.removeEventListener("abort", onAbort); }
  }

  run(operation) {
    if (!this.accepting) throw new Error("Relay Monitors is shutting down");
    const result = operation();
    if (!result || typeof result.then !== "function") return result;
    const task = Promise.resolve(result);
    this.inFlight.add(task);
    void task.then(
      () => this.inFlight.delete(task),
      () => this.inFlight.delete(task),
    );
    return task;
  }
}

export function validateObservationBoundary(value, { maxBytes = 262_144, maxDepth = 32, maxNodes = 10_000 } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw observationError("Monitor observation must be an object");
  const ancestors = new Set();
  const stack = [{ value, depth: 0, leaving: false }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current.leaving) {
      ancestors.delete(current.value);
      continue;
    }
    if (current.depth > maxDepth) throw observationError("Monitor observation exceeded the depth limit");
    if (current.value && typeof current.value === "object") {
      if (ancestors.has(current.value)) throw observationError("Monitor observation contains a cycle");
      ancestors.add(current.value);
      stack.push({ value: current.value, depth: current.depth, leaving: true });
      for (const child of Array.isArray(current.value) ? current.value : Object.values(current.value)) {
        nodes += 1;
        if (nodes > maxNodes) throw observationError("Monitor observation exceeded the field limit");
        if (child && typeof child === "object") stack.push({ value: child, depth: current.depth + 1, leaving: false });
      }
    }
  }
  let encoded;
  try { encoded = JSON.stringify(value); }
  catch { throw observationError("Monitor observation is not JSON serializable"); }
  if (encoded === undefined || Buffer.byteLength(encoded, "utf8") > maxBytes) {
    throw observationError("Monitor observation exceeded the size limit");
  }
  return value;
}

function observationError(message) {
  return Object.assign(new Error(message), { errorClass: "observation_too_large" });
}

function monitorStore(events) {
  return {
    beginMonitorCheck: (...args) => events.beginMonitorCheck(...args),
    completeMonitorCheck: (...args) => events.completeMonitorCheck(...args),
    failMonitorCheck: (...args) => events.failMonitorCheck(...args),
    expireMonitorCheck: (...args) => events.expireMonitorCheck(...args),
    abandonMonitorCheck: (...args) => events.abandonMonitorCheck(...args),
    listDueMonitors: (...args) => events.listDueMonitors(...args),
  };
}

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
