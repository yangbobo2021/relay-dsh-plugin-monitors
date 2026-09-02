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
  assert.equal(proposal.waits[0].expected_event, "timer.elapsed");
  assert.equal(proposal.waits[0].continuation.on_timeout, "Continue the deployment.");
  assert.deepEqual(proposal.timer.intent, { kind: "relative", after_seconds: 30 });
});

test("EP13-002/003: absolute timer requires explicit timezone, future time, and preserves intent", () => {
  const base = { sessionId: "s", resumePrompt: "resume", now: new Date("2026-08-30T00:00:00.000Z"), idFactory: () => "absolute" };
  const proposal = createTimerWait({ ...base, deadline: "2026-08-30T08:30:00+08:00" });
  assert.equal(proposal.timer.deadline, "2026-08-30T00:30:00.000Z");
  assert.deepEqual(proposal.timer.intent, { kind: "absolute", input: "2026-08-30T08:30:00+08:00", immediate: false });
  for (const deadline of [
    "2026-08-30T00:30:00", "not-a-date", "2026-08-29T23:59:59Z", "2026-02-30T00:00:00Z",
  ]) assert.throws(() => createTimerWait({ ...base, deadline }), /deadline/);
  assert.throws(() => createTimerWait({ ...base, afterSeconds: 1, deadline: "2026-08-30T00:30:00Z" }), /exactly one/);
  const immediate = createTimerWait({ ...base, deadline: "2026-08-29T23:59:59Z", allowImmediate: true });
  assert.equal(immediate.timer.deadline, base.now.toISOString());
  assert.deepEqual(immediate.timer.intent, { kind: "absolute", input: "2026-08-29T23:59:59Z", immediate: true });
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

test("snapshot_changed ignores baseline and stable reorder fingerprints, then emits one bounded transition", () => {
  const monitor = { detector: {
    kind: "snapshot_changed",
    fingerprint_field: "state_fingerprint",
    identity_field: "transition_key",
    event_type: "github.pull_request.transition",
    correlation_key_field: "correlation_key",
  } };
  const baseline = { state_fingerprint: "a", transition_key: "pr@a" };
  assert.deepEqual(detectMonitorEvents({ monitor, previous: null, current: baseline }), []);
  assert.deepEqual(detectMonitorEvents({ monitor, previous: baseline, current: { ...baseline } }), []);
  const changed = { state_fingerprint: "b", transition_key: "pr@b", correlation_key: "github:pr:check:1:failure", head_sha: "abc" };
  assert.deepEqual(detectMonitorEvents({ monitor, previous: baseline, current: changed }), [{
    type: "github.pull_request.transition",
    key: "pr@b",
    data: changed,
    correlation_key: "github:pr:check:1:failure",
  }]);
});
