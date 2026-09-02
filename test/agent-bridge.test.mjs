import assert from "node:assert/strict";
import test from "node:test";

import { installMonitorAgentBridge } from "../agent-bridge.js";

test("EP13-002: timer tool exposes mutually validated relative or absolute input without Session ownership input", async () => {
  let definition;
  let supplied;
  const dispose = installMonitorAgentBridge({ tools: { register(value) { definition = value; return () => { definition = null; }; } } }, {
    sessionId: "authenticated-session",
    async scheduleTimer(input) {
      supplied = input;
      return { timer_id: "timer-1", deadline: "2026-08-30T00:30:00.000Z" };
    },
  });
  assert.equal("session_id" in definition.parameters.properties, false);
  assert.ok(definition.parameters.properties.after_seconds);
  assert.ok(definition.parameters.properties.deadline);
  await definition.execute({
    task_summary: "continue", deadline: "2026-08-30T08:30:00+08:00", resume_prompt: "resume",
  });
  assert.equal(supplied.sessionId, "authenticated-session");
  assert.equal(supplied.afterSeconds, undefined);
  assert.equal(supplied.deadline, "2026-08-30T08:30:00+08:00");
  dispose();
  assert.equal(definition, null);
});

test("MB08-001: catalog tool derives ownership from its installation context and accepts no Session or credential input", async () => {
  const definitions = [];
  const requested = [];
  const dispose = installMonitorAgentBridge({ tools: { register(value) { definitions.push(value); return () => definitions.splice(definitions.indexOf(value), 1); } } }, {
    sessionId: "authenticated-session",
    async scheduleTimer() { throw new Error("not called"); },
    async listBundleTypes(input) {
      requested.push(input);
      return [{ type_id: "fixture.order-status", status: "available", name: "Order status" }];
    },
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
