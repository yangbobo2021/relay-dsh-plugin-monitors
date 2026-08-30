import { createTimerWait } from "./timer.mjs";
import { MonitorRuntime } from "./runtime.mjs";
import { validateArtifactBoundary } from "./observer-registry.mjs";
import { randomUUID } from "node:crypto";

export class RelayMonitorsController {
  constructor({ events, observers, logger = console, pollIntervalMs = 1_000, observationTimeoutMs = 30_000, workerId = `relay-monitors-${randomUUID()}` }) {
    if (events?.apiVersion !== 1) throw new Error(`Monitors requires relayEvents API v1, received ${events?.apiVersion}`);
    this.events = events;
    this.observers = observers;
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
      observer: { observe: input => this.observe(input) },
      relayRuntime: { dispatchSession: sessionId => events.dispatchSession(sessionId) },
      workerId,
    });
    this.provider = Object.freeze({
      id: "relay.monitors",
      prepare: input => this.run(() => this.prepare(input)),
      checkMonitor: (id, options) => this.run(() => this.runtime.checkMonitor(id, options)),
    });
  }

  start() {
    this.schedule(0);
  }

  async prepare({ waits, monitors }) {
    for (const monitor of monitors) validateArtifactBoundary(monitor);
    return this.runtime.prepare({ waits, monitors });
  }

  createTimer(input) {
    return createTimerWait(input);
  }

  schedule(delay = this.pollIntervalMs) {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      if (this.stopped) return;
      void this.run(() => this.runtime.runDue()).catch(error => {
        this.logger.error?.(`Relay Monitor worker failed: ${error?.stack ?? error}`);
      }).finally(() => this.schedule());
    }, delay);
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.accepting = false;
    this.abort.abort(new Error("Relay Monitors is shutting down"));
    if (this.timer) clearTimeout(this.timer);
    await Promise.allSettled([...this.inFlight]);
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
    try { return await Promise.race([cancelled, Promise.resolve().then(() => {
      signal.throwIfAborted();
      return this.observers.observe({ ...input, signal });
    })]); }
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

function monitorStore(events) {
  return {
    beginMonitorCheck: (...args) => events.beginMonitorCheck(...args),
    completeMonitorCheck: (...args) => events.completeMonitorCheck(...args),
    failMonitorCheck: (...args) => events.failMonitorCheck(...args),
    abandonMonitorCheck: (...args) => events.abandonMonitorCheck(...args),
    listDueMonitors: (...args) => events.listDueMonitors(...args),
  };
}

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
