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
    "locale", "name", "origin", "parameter_schema", "permissions", "remediation", "status",
    "supported_prior_versions", "type_id",
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
    ["prior versions", { bundle_version: 2, supported_prior_versions: [1] }],
    ["prior versions", { bundle_version: 2, supported_prior_versions: [2], migrate() {} }],
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

test("MB03-001: an owner-filtered Agent catalog provider shares discovery without becoming instantiable", async () => {
  const registry = new RelayMonitorBundleRegistry(new Context());
  const provider = {
    id: "relay.agent-bundles",
    async listBundleTypes({ locale, authorization }) {
      if (authorization.sessionId !== "owner") return [];
      return [{
        api_version: 1, type_id: "custom.process-exit", bundle_version: 1,
        origin: { kind: "agent", creator_session: "owner", scope: "session" },
        event_types: ["process.exited"],
        parameter_schema: { type: "object", additionalProperties: false, properties: {} },
        capabilities: ["process.read.status"], lifecycle: ["one_shot"], status: "available", locale,
        name: locale === "zh-CN" ? "进程退出" : "Process exit",
        description: "Scoped custom Bundle", permissions: "Reads one process.", remediation: "Issue a new Handle.",
        artifact_hash: "a".repeat(64), scope: "session", creator_session: "owner", reusable: false,
        expiry: "2026-09-03T00:00:00.000Z", validation_state: "validated",
      }];
    },
  };
  const dispose = registry.registerCatalogProvider(provider);
  assert.deepEqual(await registry.listBundleTypes({ authorization: { sessionId: "other" } }), []);
  const [entry] = await registry.listBundleTypes({ locale: "zh-CN", authorization: { sessionId: "owner" } });
  assert.equal(entry.name, "进程退出");
  await assert.rejects(registry.instantiateBundleType({
    typeId: entry.type_id, bundleVersion: 1, sessionId: "owner", taskSummary: "x", authorization: { sessionId: "owner" },
  }), /not registered/u);
  dispose();
  assert.deepEqual(await registry.listBundleTypes({ authorization: { sessionId: "owner" } }), []);
});

test("MB01-003: catalog keyset pagination is deterministic and rejects malformed cursors", async () => {
  const registry = new RelayMonitorBundleRegistry(new Context());
  for (const id of ["fixture.c", "fixture.a", "fixture.b"]) registry.registerBundleType(completeType({ type_id: id }));
  const first = await registry.listBundleTypePage({ limit: 2 });
  assert.deepEqual(first.bundleTypes.map(entry => entry.type_id), ["fixture.a", "fixture.b"]);
  assert.equal(first.total, 3);
  assert.equal(typeof first.nextCursor, "string");
  const second = await registry.listBundleTypePage({ limit: 2, cursor: first.nextCursor });
  assert.deepEqual(second.bundleTypes.map(entry => entry.type_id), ["fixture.c"]);
  assert.equal(second.nextCursor, null);
  await assert.rejects(registry.listBundleTypePage({ cursor: "not-a-cursor" }), /cursor is invalid/u);
});

test("MB02-008: version migration is explicit, bounded, authorized, and reports incompatibility without executing", async () => {
  const registry = new RelayMonitorBundleRegistry(new Context(), { factoryTimeoutMs: 20 });
  let calls = 0;
  registry.registerBundleType(completeType({
    bundle_version: 2,
    supported_prior_versions: [1],
    authorize({ projectId }) { return projectId === "allowed"; },
    migrate({ fromVersion, artifact }) {
      calls += 1;
      return { artifact: { ...artifact, type_id: "fixture.order-status", bundle_version: 2, migrated_from: fromVersion } };
    },
  }));
  const [entry] = await registry.listBundleTypes({ authorization: { projectId: "allowed" } });
  assert.deepEqual(entry.supported_prior_versions, [1]);
  const migrated = await registry.migrateBundleArtifact({ typeId: "fixture.order-status", fromVersion: 1, toVersion: 2,
    artifact: { type_id: "fixture.order-status", bundle_version: 1 }, authorization: { projectId: "allowed" } });
  assert.equal(migrated.compatible, true);
  assert.equal(migrated.artifact.migrated_from, 1);
  await assert.rejects(registry.migrateBundleArtifact({ typeId: "fixture.order-status", fromVersion: 1, toVersion: 2,
    artifact: {}, authorization: { projectId: "denied" } }), /not authorized/u);
  const unsupported = await registry.migrateBundleArtifact({ typeId: "fixture.order-status", fromVersion: 3, toVersion: 2,
    artifact: {}, authorization: { projectId: "allowed" } }).catch(error => error);
  assert.match(unsupported.message, /source version is invalid/u);
  assert.equal(calls, 1);
});

test("MB02-008: an unsupported prior version is explicitly incompatible and a migration timeout fails closed", async () => {
  const registry = new RelayMonitorBundleRegistry(new Context(), { factoryTimeoutMs: 10 });
  registry.registerBundleType(completeType({
    bundle_version: 3,
    supported_prior_versions: [2],
    async migrate() { await new Promise(() => {}); },
  }));
  assert.deepEqual(await registry.migrateBundleArtifact({ typeId: "fixture.order-status", fromVersion: 1, toVersion: 3, artifact: {} }), {
    compatible: false, reason: "unsupported_prior_version", fromVersion: 1, toVersion: 3,
  });
  await assert.rejects(registry.migrateBundleArtifact({ typeId: "fixture.order-status", fromVersion: 2, toVersion: 3,
    artifact: {} }), /timed out/u);
});
