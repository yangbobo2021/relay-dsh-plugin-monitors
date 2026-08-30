import { createTimerWait } from "./timer.mjs";
import { MonitorRuntime } from "./runtime.mjs";
import { validateArtifactBoundary } from "./observer-registry.mjs";

export class RelayMonitorsController {
  constructor({ events, observers, logger = console, pollIntervalMs = 1_000, workerId = "relay-monitors-worker" }) {
    if (events?.apiVersion !== 1) throw new Error(`Monitors requires relayEvents API v1, received ${events?.apiVersion}`);
    this.events = events;
    this.observers = observers;
    this.logger = logger;
    this.pollIntervalMs = positiveInteger(pollIntervalMs, 1_000);
    this.stopped = false;
    this.timer = null;
    this.accepting = true;
    this.inFlight = new Set();
    this.runtime = new MonitorRuntime({
      store: monitorStore(events),
      observer: observers,
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
    if (this.timer) clearTimeout(this.timer);
    await Promise.allSettled([...this.inFlight]);
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
    listDueMonitors: (...args) => events.listDueMonitors(...args),
  };
}

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
