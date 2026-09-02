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
