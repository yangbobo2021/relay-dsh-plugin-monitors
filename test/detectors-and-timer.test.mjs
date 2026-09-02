import assert from "node:assert/strict";
import test from "node:test";

import { detectMonitorEvents } from "../src/detectors.mjs";

test("field transition and unseen item detectors are deterministic", () => {
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
