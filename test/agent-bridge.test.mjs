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
      return [{ type_id: "fixture.order-status", status: "available", name: "Order status" }];
    },
    async createBundleFromType() { throw new Error("not called"); },
  });
  const definition = definitions.find(value => value.name === "relay_list_monitor_bundle_types");
  assert.ok(definition);
  assert.equal("session_id" in definition.parameters.properties, false);
  assert.equal("credential" in definition.parameters.properties, false);
  const result = await definition.execute({ locale: "zh-CN" });
  assert.deepEqual(requested, [{ locale: "zh-CN", authorization: { sessionId: "authenticated-session" } }]);
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
    async listBundleTypes() { return []; },
    async createBundleFromType(input) {
      calls.push(input);
      return { monitorIds: ["monitor-1"], waitIds: ["wait-1"], nextCheckAt: "2026-09-02T12:00:00.000Z" };
    },
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
