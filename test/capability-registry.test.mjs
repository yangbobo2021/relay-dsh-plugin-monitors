import assert from "node:assert/strict";
import test from "node:test";

import { Context } from "@deepseek-ai/cordis";
import { RelayMonitorCapabilityRegistry } from "../src/capability-registry.mjs";

const provider = (overrides = {}) => ({
  api_version: 1,
  id: "fixture.process",
  provider_version: 1,
  operations: {
    status: {
      class: "read",
      parameters: { type: "object", additionalProperties: false, required: ["handle"], properties: { handle: { type: "string" } } },
      result: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { enum: ["running", "exited"] } } },
    },
  },
  authorize: ({ authorization }) => authorization.sessionId === "owner",
  async execute() { return { status: "running" }; },
  ...overrides,
});

test("MB04-002/008: provider registration is immutable, discoverable, duplicate-safe, and owner-disposable", async () => {
  const ctx = new Context();
  const registry = new RelayMonitorCapabilityRegistry(ctx);
  assert.equal(typeof ctx.reflect.get("relayMonitorCapabilities", false).invoke, "function");
  const definition = provider();
  const dispose = registry.registerCapabilityProvider(definition);
  definition.operations.status.class = "mutate";
  assert.throws(() => registry.registerCapabilityProvider(provider()), /already registered/u);
  assert.deepEqual(await registry.listCapabilityProviders({ authorization: { sessionId: "denied" } }), []);
  assert.deepEqual(await registry.listCapabilityProviders({ authorization: { sessionId: "owner" } }), [{
    api_version: 1, id: "fixture.process", provider_version: 1, operations: ["status"], status: "available",
  }]);
  dispose(); dispose();
  assert.deepEqual(await registry.listCapabilityProviders({ authorization: { sessionId: "owner" } }), []);
});

test("MB04-002/010: broker invokes only a schema-valid subset of the exact authorized grant", async () => {
  const registry = new RelayMonitorCapabilityRegistry(new Context());
  const calls = [];
  registry.registerCapabilityProvider(provider({ async execute(input) { calls.push(input); return { status: "running" }; } }));
  const grants = [{ provider: "fixture.process", operation: "status", arguments: { handle: "issued-handle", detail: false } }];
  assert.deepEqual(await registry.invoke({
    request: { provider: "fixture.process", operation: "status", arguments: { handle: "issued-handle" } },
    grants, authorization: { sessionId: "owner" },
  }), { status: "running" });
  assert.equal(calls[0].arguments.handle, "issued-handle");
  for (const request of [
    { provider: "fixture.process", operation: "status", arguments: { handle: "forged" } },
    { provider: "fixture.process", operation: "status", arguments: { handle: "issued-handle", extra: true } },
    { provider: "fixture.process", operation: "kill", arguments: { handle: "issued-handle" } },
  ]) await assert.rejects(registry.invoke({ request, grants, authorization: { sessionId: "owner" } }), error => error?.errorClass === "capability_denied");
  await assert.rejects(registry.invoke({
    request: { provider: "fixture.process", operation: "status", arguments: { handle: "issued-handle" } }, grants,
    authorization: { sessionId: "other" },
  }), error => error?.errorClass === "capability_denied");
});

test("MB04-006/009: unload cancels authority and rejects a late provider result", async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const registry = new RelayMonitorCapabilityRegistry(new Context());
  const dispose = registry.registerCapabilityProvider(provider({ async execute() { return blocked; } }));
  const request = registry.invoke({
    request: { provider: "fixture.process", operation: "status", arguments: { handle: "issued" } },
    grants: [{ provider: "fixture.process", operation: "status", arguments: { handle: "issued" } }],
    authorization: { sessionId: "owner" },
  });
  await new Promise(resolve => setImmediate(resolve));
  dispose();
  release({ status: "running" });
  await assert.rejects(request, error => error?.errorClass === "provider_unavailable");
  await assert.rejects(registry.invoke({
    request: { provider: "fixture.process", operation: "status", arguments: { handle: "issued" } },
    grants: [{ provider: "fixture.process", operation: "status", arguments: { handle: "issued" } }],
    authorization: { sessionId: "owner" },
  }), error => error?.errorClass === "provider_unavailable");
});

test("MB04-009: capability lifecycle subscribers receive complete register/unregister transitions", () => {
  const registry = new RelayMonitorCapabilityRegistry(new Context());
  const changes = [];
  const unsubscribe = registry.subscribe(change => changes.push(change));
  const dispose = registry.registerCapabilityProvider(provider());
  assert.equal(registry.hasCapabilityProvider("fixture.process"), true);
  dispose(); dispose();
  assert.equal(registry.hasCapabilityProvider("fixture.process"), false);
  assert.deepEqual(changes, [
    { id: "fixture.process", state: "registered" },
    { id: "fixture.process", state: "unregistered" },
  ]);
  unsubscribe();
});

test("MB04-003/008: invalid API, mutate operation, schema, hooks, and output fail closed", async () => {
  for (const override of [
    { api_version: 2 },
    { operations: { kill: { class: "mutate", parameters: { type: "object" }, result: { type: "object" } } } },
    { operations: { status: { class: "read", parameters: { type: "object", unsupported: true }, result: { type: "object" } } } },
    { authorize: null },
    { execute: null },
  ]) assert.throws(() => new RelayMonitorCapabilityRegistry(new Context()).registerCapabilityProvider(provider(override)));

  const invalidOutput = new RelayMonitorCapabilityRegistry(new Context());
  invalidOutput.registerCapabilityProvider(provider({ async execute() { return { status: "secret-third-state" }; } }));
  await assert.rejects(invalidOutput.invoke({
    request: { provider: "fixture.process", operation: "status", arguments: { handle: "issued" } },
    grants: [{ provider: "fixture.process", operation: "status", arguments: { handle: "issued" } }],
    authorization: { sessionId: "owner" },
  }), /parameter/u);
});
