import assert from "node:assert/strict";
import test from "node:test";

import { Context } from "@deepseek-ai/cordis";

import { RelayMonitorBundleRegistry } from "../src/bundle-registry.mjs";

const completeType = (overrides = {}) => ({
  api_version: 1,
  type_id: "fixture.order-status",
  bundle_version: 1,
  origin: { kind: "plugin", plugin_id: "fixture-plugin", plugin_version: "1.2.3" },
  event_types: ["order.approved"],
  parameter_schema: {
    type: "object",
    additionalProperties: false,
    required: ["order_id"],
    properties: { order_id: { type: "string", minLength: 1, maxLength: 64 } },
  },
  capabilities: ["fixture.orders.read"],
  lifecycle: ["one_shot"],
  locales: {
    "en-US": {
      name: "Order status",
      description: "Wait for an order status transition.",
      permissions: "Reads one authorized order.",
      remediation: "Connect the fixture order provider.",
    },
    "zh-CN": {
      name: "订单状态",
      description: "等待订单状态发生变化。",
      permissions: "读取一个已授权订单。",
      remediation: "请连接测试订单服务。",
    },
  },
  async availability() { return "available"; },
  async create() { return { manifest: {}, artifact: new Uint8Array() }; },
  ...overrides,
});

test("MB01-001: Core has an empty Bundle Type catalog before extensions register", async () => {
  const registry = new RelayMonitorBundleRegistry(new Context());
  assert.deepEqual(await registry.listBundleTypes(), []);
});

test("MB01-002/003/009: registry lists a localized, deterministic, live capability catalog", async () => {
  const ctx = new Context();
  const registry = new RelayMonitorBundleRegistry(ctx);
  const publicService = ctx.reflect.get("relayMonitorBundles", false);
  assert.equal(publicService.name, "relayMonitorBundles", "plugins can resolve the public registry service");
  assert.equal(typeof publicService.registerBundleType, "function");
  registry.registerBundleType(completeType({ type_id: "fixture.z-last" }));
  registry.registerBundleType(completeType({
    type_id: "fixture.a-first",
    bundle_version: 2,
    async availability() { return { status: "configuration_required" }; },
  }));

  const catalog = await registry.listBundleTypes({ locale: "zh-CN", authorization: { projectId: "project-a" } });
  assert.deepEqual(catalog.map(entry => entry.type_id), ["fixture.a-first", "fixture.z-last"]);
  assert.equal(catalog[0].name, "订单状态");
  assert.equal(catalog[0].status, "configuration_required");
  assert.equal(catalog[0].bundle_version, 2);
  assert.deepEqual(catalog[0].event_types, ["order.approved"]);
  assert.deepEqual(catalog[0].origin, { kind: "plugin", plugin_id: "fixture-plugin", plugin_version: "1.2.3" });
});

test("MB01-007: an in-flight list is a complete snapshot while new lists reflect unload immediately", async () => {
  const registry = new RelayMonitorBundleRegistry(new Context());
  let resolveAuthorization;
  const authorization = new Promise(resolve => { resolveAuthorization = resolve; });
  const dispose = registry.registerBundleType(completeType({
    async authorize() { return authorization; },
  }));
  const inFlight = registry.listBundleTypes();
  dispose();
  assert.deepEqual(await registry.listBundleTypes(), []);
  resolveAuthorization(true);
  const oldSnapshot = await inFlight;
  assert.equal(oldSnapshot.length, 1);
  assert.deepEqual(Object.keys(oldSnapshot[0]).sort(), [
    "api_version", "bundle_version", "capabilities", "description", "event_types", "lifecycle",
    "locale", "name", "origin", "parameter_schema", "permissions", "remediation", "status", "type_id",
  ]);
});

test("MB01-004/006: duplicate registration fails atomically and disposal is owner-safe and idempotent", async () => {
  const registry = new RelayMonitorBundleRegistry(new Context());
  const first = completeType();
  const dispose = registry.registerBundleType(first);
  assert.throws(() => registry.registerBundleType(completeType()), /already registered/u);
  assert.equal((await registry.listBundleTypes()).length, 1);

  dispose();
  dispose();
  assert.deepEqual(await registry.listBundleTypes(), []);

  const replacement = completeType();
  registry.registerBundleType(replacement);
  dispose();
  assert.equal((await registry.listBundleTypes()).length, 1);
});

test("MB01-005: malformed definitions fail before visibility", async () => {
  const invalid = [
    ["id", { type_id: "UPPER" }],
    ["version", { bundle_version: 0 }],
    ["API", { api_version: 2 }],
    ["Event", { event_types: [] }],
    ["schema", { parameter_schema: { type: "array" } }],
    ["capability", { capabilities: ["INVALID CAPABILITY"] }],
    ["lifecycle", { lifecycle: ["forever"] }],
    ["locale", { locales: { "en-US": completeType().locales["en-US"] } }],
    ["factory", { create: null }],
  ];
  for (const [expected, override] of invalid) {
    const registry = new RelayMonitorBundleRegistry(new Context());
    assert.throws(() => registry.registerBundleType(completeType(override)), new RegExp(expected, "iu"));
    assert.deepEqual(await registry.listBundleTypes(), []);
  }
});

test("MB01-008/010: authorization hides records and catalog projection cannot leak secrets or executable hooks", async () => {
  const registry = new RelayMonitorBundleRegistry(new Context());
  const secret = "seeded-secret-value";
  registry.registerBundleType(completeType({
    origin: { kind: "plugin", plugin_id: "fixture-plugin", plugin_version: "1.2.3", credential: secret },
    secret_handle: `handle:${secret}`,
    authorize({ projectId }) { return projectId === "allowed"; },
    async availability() { return { status: "available", credential: secret }; },
  }));

  assert.deepEqual(await registry.listBundleTypes({ authorization: { projectId: "denied" } }), []);
  const allowed = await registry.listBundleTypes({ authorization: { projectId: "allowed" } });
  assert.equal(allowed.length, 1);
  const encoded = JSON.stringify(allowed);
  assert.doesNotMatch(encoded, /seeded-secret|handle:/u);
  assert.equal("create" in allowed[0], false);
  assert.equal("authorize" in allowed[0], false);
  assert.equal("availability" in allowed[0], false);
});

test("MB01-009: every documented configuration state is preserved and invalid health output fails closed", async () => {
  const registry = new RelayMonitorBundleRegistry(new Context());
  const states = ["available", "configuration_required", "unavailable", "incompatible"];
  for (const [index, status] of states.entries()) {
    registry.registerBundleType(completeType({
      type_id: `fixture.state-${index}`,
      async availability() { return status; },
    }));
  }
  registry.registerBundleType(completeType({
    type_id: "fixture.state-invalid",
    async availability() { return { status: "secretly-ready", credential: "seeded-secret-value" }; },
  }));
  const catalog = await registry.listBundleTypes();
  assert.deepEqual(catalog.map(entry => entry.status), [...states, "unavailable"]);
  assert.doesNotMatch(JSON.stringify(catalog), /seeded-secret|secretly-ready/u);
});

test("MB01-002/006: caller mutation after registration cannot change the visible record", async () => {
  const registry = new RelayMonitorBundleRegistry(new Context());
  const definition = completeType();
  registry.registerBundleType(definition);
  definition.type_id = "fixture.changed";
  definition.locales["en-US"].name = "Changed";
  definition.event_types.push("secret.event");

  const [entry] = await registry.listBundleTypes({ locale: "en-US" });
  assert.equal(entry.type_id, "fixture.order-status");
  assert.equal(entry.name, "Order status");
  assert.deepEqual(entry.event_types, ["order.approved"]);
  assert.equal(Object.isFrozen(entry), true);
  assert.equal(Object.isFrozen(entry.parameter_schema), true);
});
