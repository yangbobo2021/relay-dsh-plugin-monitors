import assert from "node:assert/strict";

export function detectMonitorEvents({ monitor, previous, current }) {
  assert.ok(current && typeof current === "object", "current observation is required");
  const detector = monitor.detector;
  if (detector.kind === "field_transition") {
    return detectFieldTransition(detector, previous, current);
  }
  if (detector.kind === "unseen_items") {
    return detectUnseenItem(detector, previous, current);
  }
  if (detector.kind === "snapshot_changed") {
    return detectSnapshotChanged(detector, previous, current);
  }
  throw new Error(`unsupported Monitor detector ${detector.kind}`);
}

function detectSnapshotChanged(detector, previous, current) {
  assert.equal(typeof detector.fingerprint_field, "string", "snapshot_changed requires fingerprint_field");
  assert.equal(typeof detector.identity_field, "string", "snapshot_changed requires identity_field");
  assert.equal(typeof detector.event_type, "string", "snapshot_changed requires event_type");
  const fingerprint = current[detector.fingerprint_field];
  const identity = current[detector.identity_field];
  assert.equal(typeof fingerprint, "string", "snapshot_changed current fingerprint is required");
  assert.equal(typeof identity, "string", "snapshot_changed current identity is required");
  if (previous == null || previous[detector.fingerprint_field] === fingerprint) return [];
  const correlationKey = detector.correlation_key_field == null ? null : current[detector.correlation_key_field];
  if (detector.correlation_key_field != null) assert.equal(typeof correlationKey, "string", "snapshot_changed correlation key is required");
  return [{
    type: detector.event_type,
    key: identity,
    data: current,
    ...(correlationKey ? { correlation_key: correlationKey } : {}),
  }];
}

function detectFieldTransition(detector, previous, current) {
  assert.equal(typeof detector.field, "string", "field_transition requires field");
  assert.equal(typeof detector.event_type, "string", "field_transition requires event_type");
  if (current[detector.field] !== detector.to || previous?.[detector.field] === detector.to) {
    return [];
  }
  const identityField = detector.identity_field ?? findIdentityField(current);
  const identity = identityField ? current[identityField] : detector.field;
  return [{
    type: detector.event_type,
    key: `${identity}:${current[detector.field]}`,
    data: current,
  }];
}

function detectUnseenItem(detector, previous, current) {
  assert.equal(typeof detector.identity_field, "string", "unseen_items requires identity_field");
  assert.equal(typeof detector.event_type, "string", "unseen_items requires event_type");
  const previousItems = previous?.[detector.identity_field] ?? [];
  const currentItems = current[detector.identity_field] ?? [];
  assert.ok(Array.isArray(previousItems), "previous unseen_items field must be an array");
  assert.ok(Array.isArray(currentItems), "current unseen_items field must be an array");
  const seen = new Set(previousItems);
  const item = currentItems.find((candidate) => !seen.has(candidate));
  if (item == null) {
    return [];
  }
  const prefix = detector.key_prefix ?? singularPrefix(detector.identity_field);
  return [{
    type: detector.event_type,
    key: `${prefix}:${item}`,
    data: { item_id: item, observation: current },
  }];
}

function findIdentityField(value) {
  return Object.keys(value).find((key) => key === "id" || key.endsWith("_id"));
}

function singularPrefix(field) {
  return field.replace(/_ids$/, "").replace(/s$/, "") || "item";
}
