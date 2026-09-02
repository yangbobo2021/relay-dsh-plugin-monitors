import assert from "node:assert/strict";
import test from "node:test";

import { installMonitorAgentBridge } from "../agent-bridge.js";

test("MB08-001: catalog tool derives ownership from its installation context and accepts no Session or credential input", async () => {
  const definitions = [];
  const requested = [];
  const dispose = installMonitorAgentBridge({ tools: { register(value) { definitions.push(value); return () => definitions.splice(definitions.indexOf(value), 1); } } }, {
    sessionId: "authenticated-session",
    async listBundleTypes(input) {
      requested.push(input);
      return { bundleTypes: [{ type_id: "fixture.order-status", status: "available", name: "Order status" }], nextCursor: null, total: 1 };
    },
    async createBundleFromType() { throw new Error("not called"); },
    async validateCustomBundle() { throw new Error("not called"); },
    async installCustomBundle() { throw new Error("not called"); },
    async updateCustomBundle() { throw new Error("not called"); },
    async rollbackCustomBundle() { throw new Error("not called"); },
  });
  const definition = definitions.find(value => value.name === "relay_list_monitor_bundle_types");
  assert.ok(definition);
  assert.equal("session_id" in definition.parameters.properties, false);
  assert.equal("credential" in definition.parameters.properties, false);
  const result = await definition.execute({ locale: "zh-CN" });
  assert.deepEqual(requested, [{ locale: "zh-CN", cursor: null, limit: 50, authorization: { sessionId: "authenticated-session" } }]);
  assert.equal(result.bundleTypes[0].type_id, "fixture.order-status");
  dispose();
  assert.deepEqual(definitions, []);
});

test("MB08-002: create-from-type tool derives Session ownership and reports only after durable registration callback", async () => {
  const definitions = new Map();
  const calls = [];
  installMonitorAgentBridge({ tools: { register(value) { definitions.set(value.name, value); return () => definitions.delete(value.name); } } }, {
    sessionId: "authenticated-session",
    authorization: { cwd: "/work/project" },
    async listBundleTypes() { return { bundleTypes: [], nextCursor: null, total: 0 }; },
    async createBundleFromType(input) {
      calls.push(input);
      return { monitorIds: ["monitor-1"], waitIds: ["wait-1"], nextCheckAt: "2026-09-02T12:00:00.000Z" };
    },
    async validateCustomBundle() { throw new Error("not called"); },
    async installCustomBundle() { throw new Error("not called"); },
    async updateCustomBundle() { throw new Error("not called"); },
    async rollbackCustomBundle() { throw new Error("not called"); },
  });
  const tool = definitions.get("relay_create_monitor_from_type");
  assert.ok(tool);
  assert.equal("session_id" in tool.parameters.properties, false);
  const result = await tool.execute({
    type_id: "fixture.state", bundle_version: 1, task_summary: "等待", parameters: { target: "订单" },
  });
  assert.deepEqual(calls, [{
    typeId: "fixture.state", bundleVersion: 1, taskSummary: "等待", parameters: { target: "订单" },
    sessionId: "authenticated-session", authorization: { cwd: "/work/project", sessionId: "authenticated-session" },
  }]);
  assert.equal(result.created, true);
  assert.deepEqual(result.monitorIds, ["monitor-1"]);
});

test("MB08-003: validate/install tools bind one immutable receipt to the authenticated Session", async () => {
  const definitions = new Map();
  const calls = [];
  installMonitorAgentBridge({ tools: { register(value) { definitions.set(value.name, value); return () => definitions.delete(value.name); } } }, {
    sessionId: "session-owner",
    authorization: { cwd: "/work/project" },
    async listBundleTypes() { return { bundleTypes: [], nextCursor: null, total: 0 }; },
    async createBundleFromType() { throw new Error("not called"); },
    async validateCustomBundle(input) {
      calls.push({ validate: input });
      return {
        validationId: "validation-1", artifactHash: "a".repeat(64), artifactBytes: 10,
        typeId: "custom.process-exit", approvedCapabilities: ["process.status"],
        receiptExpiresAt: "2026-09-02T12:10:00.000Z", bundleExpiresAt: "2026-09-03T12:00:00.000Z", runtime: "quickjs-wasm",
      };
    },
    async installCustomBundle(input) {
      calls.push({ install: input });
      return { validationId: input.validationId, artifactHash: "a".repeat(64), monitorIds: ["m"], waitIds: ["w"], expiry: "2026-09-03T12:00:00.000Z" };
    },
    async updateCustomBundle() { throw new Error("not called"); },
    async rollbackCustomBundle() { throw new Error("not called"); },
  });
  const validate = definitions.get("relay_validate_monitor_bundle");
  const install = definitions.get("relay_install_monitor_bundle");
  assert.equal("session_id" in validate.parameters.properties, false);
  assert.equal("session_id" in install.parameters.properties, false);
  const validated = await validate.execute({ manifest: { contract_version: 1 }, source: "source" });
  assert.equal(validated.validationId, "validation-1");
  await install.execute({ validation_id: validated.validationId, task_summary: "等待", resume_prompt: "继续" });
  assert.equal(calls[0].validate.authorization.sessionId, "session-owner");
  assert.deepEqual(calls[1].install, {
    validationId: "validation-1", sessionId: "session-owner", authorization: { cwd: "/work/project", sessionId: "session-owner" },
    taskSummary: "等待", resumePrompt: "继续",
  });
});

test("MB03-009: update and rollback tools bind the authenticated Session and expose no owner input", async () => {
  const definitions = new Map();
  const calls = [];
  installMonitorAgentBridge({ tools: { register(value) { definitions.set(value.name, value); return () => definitions.delete(value.name); } } }, {
    sessionId: "session-owner",
    authorization: { cwd: "/work/project" },
    async listBundleTypes() { return { bundleTypes: [], nextCursor: null, total: 0 }; },
    async createBundleFromType() { throw new Error("not called"); },
    async validateCustomBundle() { throw new Error("not called"); },
    async installCustomBundle() { throw new Error("not called"); },
    async updateCustomBundle(input) {
      calls.push({ update: input });
      return { validationId: input.validationId, monitorId: input.monitorId, artifactHash: "a".repeat(64),
        previousVersionId: "v1", activeVersionId: "v2", version: 4 };
    },
    async rollbackCustomBundle(input) {
      calls.push({ rollback: input });
      return { monitorId: input.monitorId, artifactHash: "b".repeat(64), previousVersionId: "v2", activeVersionId: "v1", version: 5 };
    },
  });
  const update = definitions.get("relay_update_monitor_bundle");
  const rollback = definitions.get("relay_rollback_monitor_bundle");
  assert.equal("session_id" in update.parameters.properties, false);
  assert.equal("session_id" in rollback.parameters.properties, false);
  assert.equal((await update.execute({ monitor_id: "m", validation_id: "validation-2", expected_version: 3 })).updated, true);
  assert.equal((await rollback.execute({ monitor_id: "m", version_id: "v1", expected_version: 4 })).rolledBack, true);
  assert.deepEqual(calls, [{ update: {
    monitorId: "m", validationId: "validation-2", sessionId: "session-owner", expectedVersion: 3,
    authorization: { cwd: "/work/project", sessionId: "session-owner" },
  } }, { rollback: {
    monitorId: "m", versionId: "v1", sessionId: "session-owner", expectedVersion: 4,
    authorization: { cwd: "/work/project", sessionId: "session-owner" },
  } }]);
});
