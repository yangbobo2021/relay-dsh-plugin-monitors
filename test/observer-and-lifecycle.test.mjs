import assert from "node:assert/strict";
import test from "node:test";

import { Context } from "@deepseek-ai/cordis";

import { RelayMonitorsController } from "../src/controller.mjs";
import {
  RelayMonitorObserverRegistry,
  validateArtifactBoundary,
} from "../src/observer-registry.mjs";
import { validateObservationBoundary } from "../src/controller.mjs";

test("observer registry rejects duplicates and delegates observation and detection to its provider", async () => {
  const registry = new RelayMonitorObserverRegistry(new Context());
  const provider = {
    id: "fixture",
    async observe() { return { state: "ok" }; },
    detect({ current }) { return [{ type: "fixture.done", key: "done", data: current }]; },
  };
  const release = registry.register(provider);
  assert.throws(() => registry.register(provider), /already registered/);
  assert.deepEqual(await registry.observe({
    monitor: { monitor_id: "m", observer: { provider: "fixture" }, detector: { kind: "field_transition" } },
  }), { state: "ok" });
  assert.deepEqual(await registry.detect({
    monitor: { observer: { provider: "fixture" } }, previous: null, current: { state: "ok" },
  }), [{ type: "fixture.done", key: "done", data: { state: "ok" } }]);
  release();
  await assert.rejects(registry.observe({
    monitor: { monitor_id: "m", observer: { provider: "fixture" }, detector: { kind: "field_transition" } },
  }), /not registered/);
});

test("MB04-006/009: observer lifecycle is observable and a result arriving after unload is rejected", async () => {
  const registry = new RelayMonitorObserverRegistry(new Context());
  const changes = [];
  const unsubscribe = registry.subscribe(change => changes.push(change));
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const dispose = registry.register({ id: "fixture", async observe() { return pending; } });
  const observation = registry.observe({ monitor: { observer: { provider: "fixture" } } });
  await new Promise(resolve => setImmediate(resolve));
  dispose();
  release({ state: "late" });
  await assert.rejects(observation, error => error?.errorClass === "provider_unavailable");
  assert.deepEqual(changes, [{ id: "fixture", state: "registered" }, { id: "fixture", state: "unregistered" }]);
  unsubscribe();
});

test("generated code and privileged capabilities fail before baseline", () => {
  for (const monitor of [
    { artifact: { kind: "generated-js" } },
    { artifact: { kind: "builtin" }, capabilities: { shell: true } },
    { artifact: { kind: "trusted-provider" }, capabilities: { browser: true } },
  ]) assert.throws(() => validateArtifactBoundary(monitor), /not allowed/);
});

test("controller prepares baseline through a trusted observer/detector provider", async () => {
  const registry = new RelayMonitorObserverRegistry(new Context());
  registry.register({
    id: "fixture",
    async observe() { return { id: "PO-1", status: "pending" }; },
    detect() { return []; },
  });
  const controller = new RelayMonitorsController({ events: fakeEvents(), observers: registry, pollIntervalMs: 60_000 });
  try {
    const prepared = await controller.provider.prepare({
      waits: [{ wait_id: "wait-1" }],
      monitors: [{
        monitor_id: "monitor-1", wait_id: "wait-1", lifecycle: "one_shot",
        observer: { provider: "fixture" }, artifact: { kind: "trusted-provider" },
        detector: { kind: "field_transition", field: "status", to: "approved", event_type: "po.approved" },
      }],
    });
    assert.deepEqual(prepared[0].baseline_observation, { id: "PO-1", status: "pending" });
  } finally {
    await controller.stop();
  }
});

test("controller shutdown aborts an in-flight observation and rejects new checks", async () => {
  let unblock;
  let started;
  const began = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { unblock = resolve; });
  const registry = new RelayMonitorObserverRegistry(new Context());
  registry.register({ id: "blocked", async observe() { started(); return blocked; }, detect() { return []; } });
  const events = fakeEvents({
    beginMonitorCheck() {
      return {
        status: "started",
        monitor: {
          monitor_id: "m", observer: { provider: "blocked" },
          detector: { kind: "field_transition", field: "status", to: "done", event_type: "done" },
          last_observation: { data: { id: "x", status: "waiting" } },
        },
      };
    },
  });
  const controller = new RelayMonitorsController({ events, observers: registry, pollIntervalMs: 60_000 });
  const check = controller.provider.checkMonitor("m", { force: true });
  await began;
  let stopped = false;
  const stopping = controller.stop().then(() => { stopped = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped, true);
  assert.throws(() => controller.provider.checkMonitor("m"), /shutting down/);
  unblock({ id: "x", status: "done" });
  await check;
  await stopping;
});

function fakeEvents(overrides = {}) {
  return {
    apiVersion: 1,
    beginMonitorCheck: () => ({ status: "no_work" }),
    completeMonitorCheck: () => ({ sessionIds: [] }),
    failMonitorCheck: () => ({ sessionIds: [] }),
    abandonMonitorCheck: () => ({ status: "aborted", sessionIds: [] }),
    listDueMonitors: () => [],
    dispatchSession: async () => ({ status: "no_work" }),
    ...overrides,
  };
}

test("observation deadlines bound an uncooperative provider and propagate its abort signal", async () => {
  let signal;
  const controller = new RelayMonitorsController({ events: fakeEvents(), observationTimeoutMs: 5,
    observers: { observe(input) { signal = input.signal; return new Promise(() => {}); } },
  });
  try {
    await assert.rejects(controller.observe({}), error => error.errorClass === "observation_timeout");
    assert.equal(signal.aborted, true);
  } finally { await controller.stop(); }
});

test("EP11-004/007: observation size, depth, field count, cycles, and boundary value are enforced before detector commit", () => {
  const boundary = { value: "x".repeat(100) };
  assert.equal(validateObservationBoundary(boundary, { maxBytes: 112 }), boundary);
  assert.throws(() => validateObservationBoundary(boundary, { maxBytes: 111 }), error => error?.errorClass === "observation_too_large");
  let deep = {};
  for (let index = 0; index < 34; index += 1) deep = { child: deep };
  assert.throws(() => validateObservationBoundary(deep), /depth limit/u);
  assert.throws(() => validateObservationBoundary(Object.fromEntries(Array.from({ length: 10_001 }, (_, index) => [`k${index}`, index]))), /field limit/u);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => validateObservationBoundary(cyclic), /cycle/u);
  const shared = { status: "ok" };
  assert.deepEqual(validateObservationBoundary({ left: shared, right: shared }), { left: shared, right: shared },
    "a shared acyclic reference is valid JSON structure, not a cycle");
});
