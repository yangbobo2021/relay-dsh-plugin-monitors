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
