import assert from "node:assert/strict";
import test from "node:test";

import { Context } from "@deepseek-ai/cordis";
import { RelayMonitorBundleRegistry } from "../src/bundle-registry.mjs";

const definition = (overrides = {}) => ({
  api_version: 1,
  type_id: "fixture.state",
  bundle_version: 1,
  origin: { kind: "plugin", plugin_id: "fixture", plugin_version: "1.0.0" },
  event_types: ["fixture.changed"],
  parameter_schema: {
    type: "object",
    additionalProperties: false,
    required: ["target", "count", "labels", "enabled"],
    properties: {
      target: { type: "string", minLength: 1, maxLength: 8, pattern: "^[a-z]+$" },
      count: { type: "integer", minimum: 1, maximum: 3 },
      labels: { type: "array", minItems: 1, maxItems: 2, uniqueItems: true, items: { type: "string" } },
      enabled: { type: "boolean" },
      mode: { enum: ["fast", "safe"] },
    },
  },
  capabilities: ["fixture.read"],
  lifecycle: ["one_shot"],
  locales: {
    "en-US": { name: "State", description: "State", permissions: "Read state", remediation: "Configure state" },
    "zh-CN": { name: "状态", description: "状态", permissions: "读取状态", remediation: "配置状态" },
  },
  async create({ sessionId, taskSummary }) {
    return proposal({ sessionId, taskSummary });
  },
  ...overrides,
});

test("MB02-001/003/004: available authorized type validates typed parameters and returns a normalized proposal", async () => {
  const registry = new RelayMonitorBundleRegistry(new Context());
  registry.registerBundleType(definition());
  const result = await registry.instantiateBundleType({
    typeId: "fixture.state", bundleVersion: 1, sessionId: "session-owner", taskSummary: "等待状态",
    authorization: { sessionId: "session-owner" },
    parameters: { target: "order", count: 2, labels: ["中", "en"], enabled: true, mode: "safe" },
  });
  assert.equal(result.sessionId, "session-owner");
  assert.equal(result.monitors[0].artifact.type_id, "fixture.state");
  assert.equal(result.monitors[0].artifact.bundle_version, 1);
});

test("MB02-005: serializable shared references pass while a true factory-result cycle fails", async () => {
  const sharedRegistry = new RelayMonitorBundleRegistry(new Context());
  sharedRegistry.registerBundleType(definition({ async create(input) {
    const value = proposal(input);
    const shared = { safe: true };
    value.context.first = shared;
    value.context.second = shared;
    return value;
  } }));
  await sharedRegistry.instantiateBundleType({
    typeId: "fixture.state", bundleVersion: 1, sessionId: "owner", taskSummary: "wait",
    parameters: { target: "order", count: 1, labels: ["a"], enabled: true },
  });

  const cyclicRegistry = new RelayMonitorBundleRegistry(new Context());
  cyclicRegistry.registerBundleType(definition({ async create(input) {
    const value = proposal(input);
    value.context.self = value.context;
    return value;
  } }));
  await assert.rejects(cyclicRegistry.instantiateBundleType({
    typeId: "fixture.state", bundleVersion: 1, sessionId: "owner", taskSummary: "wait",
    parameters: { target: "order", count: 1, labels: ["a"], enabled: true },
  }), /cycle/u);
});

test("MB02-003: parameter boundary matrix fails before factory execution", async () => {
  let calls = 0;
  const registry = new RelayMonitorBundleRegistry(new Context());
  registry.registerBundleType(definition({ async create(input) { calls += 1; return proposal(input); } }));
  const invalid = [
    {},
    { target: "", count: 1, labels: ["a"], enabled: true },
    { target: "TOO", count: 1, labels: ["a"], enabled: true },
    { target: "order", count: 0, labels: ["a"], enabled: true },
    { target: "order", count: 1.5, labels: ["a"], enabled: true },
    { target: "order", count: 1, labels: [], enabled: true },
    { target: "order", count: 1, labels: ["a", "a"], enabled: true },
    { target: "order", count: 1, labels: ["a"], enabled: "yes" },
    { target: "order", count: 1, labels: ["a"], enabled: true, extra: 1 },
    { target: "order", count: 1, labels: ["a"], enabled: true, mode: "unsafe" },
  ];
  for (const parameters of invalid) await assert.rejects(registry.instantiateBundleType({
    typeId: "fixture.state", bundleVersion: 1, sessionId: "s", taskSummary: "wait", parameters,
  }), /parameter/u);
  assert.equal(calls, 0);
});

test("MB02-002/004/005: factory cannot spoof owner or exceed declared Event, capability, or lifecycle", async () => {
  for (const [label, mutate] of [
    ["Session", value => { value.sessionId = "another-session"; }],
    ["Event", value => { value.waits[0].expected_event = "undeclared.event"; }],
    ["capability", value => { value.monitors[0].capabilities = { "admin.write": true }; }],
    ["lifecycle", value => { value.monitors[0].lifecycle = "recurring"; }],
  ]) {
    const registry = new RelayMonitorBundleRegistry(new Context());
    registry.registerBundleType(definition({ async create(input) { const value = proposal(input); mutate(value); return value; } }));
    await assert.rejects(registry.instantiateBundleType({
      typeId: "fixture.state", bundleVersion: 1, sessionId: "owner", taskSummary: "wait",
      parameters: { target: "order", count: 1, labels: ["a"], enabled: true },
    }), new RegExp(label, "iu"));
  }
});

test("MB02-005/006: hidden, unavailable, throwing, and timed-out factories fail without a registration callback", async () => {
  for (const [override, expected] of [
    [{ authorize: () => false }, /not authorized/u],
    [{ availability: () => "configuration_required" }, /configuration_required/u],
    [{ async create() { throw new Error("factory exploded"); } }, /factory exploded/u],
    [{ async create() { return new Promise(() => {}); } }, /timed out/u],
  ]) {
    const registry = new RelayMonitorBundleRegistry(new Context(), { factoryTimeoutMs: 5 });
    registry.registerBundleType(definition(override));
    await assert.rejects(registry.instantiateBundleType({
      typeId: "fixture.state", bundleVersion: 1, sessionId: "owner", taskSummary: "wait",
      parameters: { target: "order", count: 1, labels: ["a"], enabled: true },
    }), expected);
  }
});

function proposal({ sessionId, taskSummary }) {
  return {
    sessionId,
    taskSummary,
    context: {},
    waits: [{
      wait_id: "wait-1", phase: "waiting", exclusive: true, expected_event: "fixture.changed",
      caused_by: "fixture", actors: [], entities: ["fixture"], prior_exchange: taskSummary,
    }],
    monitors: [{
      monitor_id: "monitor-1", wait_id: "wait-1", lifecycle: "one_shot",
      observer: { provider: "fixture" }, detector: { kind: "fixture", event_type: "fixture.changed" },
      capabilities: { "fixture.read": true }, artifact: { kind: "trusted-provider" },
      schedule: { interval_seconds: 60 },
    }],
  };
}
