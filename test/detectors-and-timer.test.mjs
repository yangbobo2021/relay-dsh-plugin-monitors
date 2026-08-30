import assert from "node:assert/strict";
import test from "node:test";

import { detectMonitorEvents } from "../src/detectors.mjs";
import { createTimerWait } from "../src/timer.mjs";

test("durable timer proposal is bound to the authenticated Session and clock observer", () => {
  const proposal = createTimerWait({
    sessionId: "session-timer",
    afterSeconds: 30,
    resumePrompt: "Continue the deployment.",
    now: new Date("2026-08-30T00:00:00.000Z"),
    idFactory: () => "fixed",
  });
  assert.equal(proposal.timer.deadline, "2026-08-30T00:00:30.000Z");
  assert.equal(proposal.monitors[0].observer.provider, "clock");
  assert.equal(proposal.monitors[0].wait_id, proposal.waits[0].wait_id);
  assert.equal(proposal.sessionId, "session-timer");
});

test("timer rejects every non-positive or ambiguous delay", () => {
  const base = { sessionId: "s", resumePrompt: "resume" };
  for (const afterSeconds of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createTimerWait({ ...base, afterSeconds }), /positive safe integer/);
  }
  assert.throws(() => createTimerWait({ sessionId: "s", afterSeconds: 1, resumePrompt: " " }), /cannot be empty/);
});

test("field transition, unseen item, and deadline detectors are deterministic", () => {
  assert.deepEqual(detectMonitorEvents({
    monitor: { detector: { kind: "field_transition", field: "status", to: "approved", event_type: "approved" } },
    previous: { id: "PO-1", status: "pending" },
    current: { id: "PO-1", status: "approved" },
  })[0], { type: "approved", key: "PO-1:approved", data: { id: "PO-1", status: "approved" } });
  assert.equal(detectMonitorEvents({
    monitor: { detector: { kind: "field_transition", field: "status", to: "approved", event_type: "approved" } },
    previous: { id: "PO-1", status: "approved" },
    current: { id: "PO-1", status: "approved" },
  }).length, 0);
  assert.equal(detectMonitorEvents({
    monitor: { detector: { kind: "unseen_items", identity_field: "item_ids", event_type: "new.item" } },
    previous: { item_ids: ["a"] }, current: { item_ids: ["a", "b"] },
  })[0].key, "item:b");
  assert.equal(detectMonitorEvents({
    monitor: { detector: { kind: "deadline_reached", timer_id: "t", deadline: "2026-08-30T00:00:00Z", event_type: "timer.elapsed" } },
    previous: null, current: { observed_at: "2026-08-30T00:00:01Z" },
  })[0].key, "t:2026-08-30T00:00:00Z");
});
