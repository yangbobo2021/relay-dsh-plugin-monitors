import { createHash, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { sep } from "node:path";

import { assertValidParameterSchema, validateParameters } from "./parameter-schema.mjs";

const TYPE_ID = /^custom\.[a-z][a-z0-9]*(?:[.-][a-z0-9][a-z0-9-]*)*$/u;
const EVENT_TYPE = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_-]*)+$/u;
const LOCALIZED_FIELDS = ["name", "description", "permissions", "remediation"];

export class RelayCustomMonitorBundles {
  constructor({ artifacts, sandbox, capabilities, clock = () => new Date(), idFactory = randomUUID, receiptTtlMs = 10 * 60_000 } = {}) {
    if (!artifacts || !sandbox || !capabilities) throw new TypeError("Custom Monitor Bundles require artifacts, sandbox, and capabilities");
    this.artifacts = artifacts;
    this.sandbox = sandbox;
    this.capabilities = capabilities;
    this.clock = clock;
    this.idFactory = idFactory;
    this.receiptTtlMs = receiptTtlMs;
    this.receipts = new Map();
    this.locks = new Map();
  }

  async validate({ manifest, source, authorization }) {
    return this.#withLock("__artifact_store__", () => this.#validateLocked({ manifest, source, authorization }));
  }

  async #validateLocked({ manifest, source, authorization }) {
    const normalized = validateCustomManifest(manifest, this.clock());
    if (authorization?.sessionId == null) throw customError("invalid_owner", "Authenticated Session is required");
    const normalizedAuthorization = await normalizeAuthorization(authorization, normalized.scope);
    await this.capabilities.validateGrants({ grants: normalized.capability_grants, authorization: normalizedAuthorization });
    await this.sandbox.validate(source);
    const artifact = await this.artifacts.put(source);
    const validationId = `validation-${this.idFactory()}`;
    const validatedAt = this.clock();
    const receipt = {
      validationId,
      manifest: normalized,
      artifact,
      authorization: normalizedAuthorization,
      expiresAt: new Date(validatedAt.getTime() + this.receiptTtlMs).toISOString(),
      state: "validated",
    };
    this.receipts.set(validationId, receipt);
    await this.artifacts.putReceipt(receipt);
    return publicReceipt(receipt);
  }

  async install(input) {
    return this.#withLock(input?.validationId, () => this.#installLocked(input));
  }

  async update(input) {
    return this.#withLock(`monitor:${input?.monitorId ?? ""}`, () => this.#updateLocked(input));
  }

  async rollback(input) {
    return this.#withLock(`monitor:${input?.monitorId ?? ""}`, () => this.#rollbackLocked(input));
  }

  async cleanupExpired({ activeArtifactHashes = [] } = {}) {
    return this.#withLock("__artifact_store__", () => this.#cleanupExpiredLocked({ activeArtifactHashes }));
  }

  async #cleanupExpiredLocked({ activeArtifactHashes }) {
    const active = new Set(activeArtifactHashes);
    for (const hash of active) {
      if (!/^[a-f0-9]{64}$/u.test(hash ?? "")) throw new TypeError("active Monitor artifact hash is invalid");
    }
    const receipts = await this.artifacts.listReceipts();
    const now = this.clock().getTime();
    const expired = receipts.filter(receipt => Date.parse(receipt.manifest.expires_at) <= now
      || (receipt.state !== "installed" && Date.parse(receipt.expiresAt) <= now));
    const deletedReceiptIds = [];
    for (const receipt of expired) {
      if (await this.artifacts.deleteReceipt(receipt.validationId)) deletedReceiptIds.push(receipt.validationId);
      this.receipts.delete(receipt.validationId);
    }
    const remaining = await this.artifacts.listReceipts();
    const referenced = new Set([...active, ...remaining.map(receipt => receipt.artifact.sha256)]);
    const deletedArtifactHashes = [];
    for (const hash of await this.artifacts.listArtifactHashes()) {
      if (!referenced.has(hash) && await this.artifacts.deleteArtifact(hash)) deletedArtifactHashes.push(hash);
    }
    return Object.freeze({
      deletedReceiptIds: Object.freeze(deletedReceiptIds.sort()),
      deletedArtifactHashes: Object.freeze(deletedArtifactHashes.sort()),
    });
  }

  async #installLocked({ validationId, sessionId, authorization = {}, taskSummary, resumePrompt, registerWaits }) {
    const receipt = await this.#getReceipt(validationId);
    if (!receipt) throw customError("validation_missing", "Monitor Bundle validation receipt does not exist");
    const installingAuthorization = await normalizeAuthorization({ ...authorization, sessionId }, receipt.manifest.scope);
    assertReceiptAccess(receipt, installingAuthorization);
    if (Date.parse(receipt.expiresAt) <= this.clock().getTime()) throw customError("validation_expired", "Monitor Bundle validation receipt expired");
    if (Date.parse(receipt.manifest.expires_at) <= this.clock().getTime()) throw customError("bundle_expired", "Monitor Bundle expired before installation");
    if (receipt.manifest.scope === "project") {
      return this.#installProjectReceipt({ receipt, authorization: installingAuthorization, taskSummary, resumePrompt, registerWaits });
    }
    if (receipt.state === "installed") return structuredClone(receipt.installResult);
    if (!["validated", "installing"].includes(receipt.state)) throw customError("validation_consumed", "Monitor Bundle validation receipt was already used");
    if (typeof registerWaits !== "function") throw new TypeError("registerWaits callback is required");
    receipt.proposal ??= createCustomProposal({
      receipt,
      sessionId,
      taskSummary,
      resumePrompt,
      idFactory: this.idFactory,
      runtimeAuthorization: installingAuthorization,
    });
    receipt.state = "installing";
    await this.#persistReceipt(receipt);
    const proposal = receipt.proposal;
    try {
      const registration = await registerWaits(proposal);
      receipt.state = "installed";
      const monitorIds = proposal.monitors.map(monitor => monitor.monitor_id);
      const waitIds = proposal.waits.map(wait => wait.wait_id);
      receipt.installResult = {
        validationId,
        artifactHash: receipt.artifact.sha256,
        monitorIds,
        waitIds,
        nextCheckAt: registration.monitors.filter(monitor => monitorIds.includes(monitor.monitor_id))
          .map(monitor => monitor.next_check_at).filter(Boolean).sort()[0] ?? null,
        expiry: receipt.manifest.expires_at,
      };
      await this.#persistReceipt(receipt);
      return structuredClone(receipt.installResult);
    } catch (error) {
      receipt.state = "validated";
      await this.#persistReceipt(receipt);
      throw error;
    }
  }

  async #updateLocked({ validationId, monitorId, sessionId, authorization = {}, expectedVersion, inspectMonitor, rebaselineMonitor }) {
    if (typeof inspectMonitor !== "function" || typeof rebaselineMonitor !== "function") throw new TypeError("Monitor update callbacks are required");
    const receipt = await this.#getReceipt(validationId);
    if (!receipt) throw customError("validation_missing", "Monitor Bundle validation receipt does not exist");
    const installingAuthorization = await normalizeAuthorization({ ...authorization, sessionId }, receipt.manifest.scope);
    assertReceiptAccess(receipt, installingAuthorization);
    if (Date.parse(receipt.expiresAt) <= this.clock().getTime()) throw customError("validation_expired", "Monitor Bundle validation receipt expired");
    if (Date.parse(receipt.manifest.expires_at) <= this.clock().getTime()) throw customError("bundle_expired", "Monitor Bundle expired before update");
    const current = await inspectMonitor(monitorId);
    assertCustomMonitorOwner(current, sessionId);
    assertCompatibleReplacement(current.artifact?.manifest, receipt.manifest);
    await this.capabilities.validateGrants({ grants: receipt.manifest.capability_grants, authorization: installingAuthorization });
    receipt.updates ??= {};
    const prior = receipt.updates[monitorId];
    if (prior?.state === "installed" && current.artifact?.sha256 === receipt.artifact.sha256) return structuredClone(prior.result);
    const previousVersionId = current.active_version_id;
    const proposal = createReplacementProposal(receipt, current, installingAuthorization);
    const updated = await rebaselineMonitor(monitorId, proposal, { expectedVersion });
    const result = {
      validationId,
      monitorId,
      artifactHash: receipt.artifact.sha256,
      previousVersionId,
      activeVersionId: updated.active_version_id,
      version: updated.version,
    };
    receipt.updates[monitorId] = { state: "installed", result };
    receipt.state = "installed";
    await this.#persistReceipt(receipt);
    return structuredClone(result);
  }

  async #rollbackLocked({ monitorId, versionId, sessionId, authorization = {}, expectedVersion, inspectMonitor, rebaselineMonitor }) {
    if (typeof inspectMonitor !== "function" || typeof rebaselineMonitor !== "function") throw new TypeError("Monitor rollback callbacks are required");
    const current = await inspectMonitor(monitorId);
    assertCustomMonitorOwner(current, sessionId);
    const target = current.versions?.find(version => version.version_id === versionId);
    if (!target) throw customError("version_missing", "Monitor Bundle version does not exist");
    const targetManifest = target.manifest;
    const targetArtifact = targetManifest?.artifact;
    if (targetArtifact?.kind !== "sandboxed-bundle" || !targetArtifact.manifest) {
      throw customError("invalid_version", "Only custom Monitor Bundle versions can be rolled back");
    }
    if (Date.parse(targetArtifact.manifest.expires_at) <= this.clock().getTime()) {
      throw customError("bundle_expired", "The selected Monitor Bundle version has expired");
    }
    assertCompatibleReplacement(current.artifact?.manifest, targetArtifact.manifest);
    assertNoCapabilityExpansion(current.artifact?.manifest?.capability_grants ?? [], targetArtifact.manifest.capability_grants);
    const installingAuthorization = await normalizeAuthorization({ ...authorization, sessionId }, targetArtifact.manifest.scope);
    await this.capabilities.validateGrants({ grants: targetArtifact.manifest.capability_grants, authorization: installingAuthorization });
    await this.artifacts.read(targetArtifact.sha256);
    const rolledBack = await rebaselineMonitor(monitorId, {
      observer: targetManifest.observer,
      detector: targetManifest.detector,
      schedule: targetManifest.schedule,
      retry: targetManifest.retry,
      capabilities: targetManifest.capabilities,
      artifact: targetArtifact,
    }, { expectedVersion });
    return {
      monitorId,
      artifactHash: target.artifact_hash,
      previousVersionId: current.active_version_id,
      activeVersionId: rolledBack.active_version_id,
      version: rolledBack.version,
    };
  }

  async listBundleTypes({ locale = "en-US", authorization = {} } = {}) {
    if (typeof authorization.sessionId !== "string" || !authorization.sessionId) return [];
    const selectedLocale = locale === "zh-CN" ? "zh-CN" : "en-US";
    const receipts = await this.artifacts.listReceipts();
    const now = this.clock().getTime();
    const visible = [];
    for (const receipt of receipts) {
      let normalizedAuthorization;
      try { normalizedAuthorization = await normalizeAuthorization(authorization, receipt.manifest.scope); }
      catch { continue; }
      if (receiptAccessAllowed(receipt, normalizedAuthorization)) visible.push(publicCatalogEntry(receipt, selectedLocale, now));
    }
    return visible.sort((left, right) => left.type_id.localeCompare(right.type_id, "en") || left.artifact_hash.localeCompare(right.artifact_hash, "en"));
  }

  createRuntimeProvider() {
    return Object.freeze({
      id: "custom.bundle",
      observe: async ({ monitor, signal }) => {
        const manifest = monitor.artifact?.manifest;
        if (Date.parse(manifest?.expires_at) <= this.clock().getTime()) throw customError("bundle_expired", "Custom Monitor Bundle expired");
        const source = await this.artifacts.read(monitor.artifact.sha256);
        const request = await this.sandbox.observe(source, { config: manifest.config });
        const result = await this.capabilities.invoke({
          request,
          grants: manifest.capability_grants,
          authorization: monitor.artifact.authorization,
          signal,
        });
        validateParameters(manifest.observation_schema, result);
        return result;
      },
      detect: async ({ monitor, previous, current }) => {
        const manifest = monitor.artifact?.manifest;
        const source = await this.artifacts.read(monitor.artifact.sha256);
        const events = await this.sandbox.detect(source, previous, current);
        return validateCustomEvents(events, manifest);
      },
    });
  }

  async #getReceipt(validationId) {
    if (this.receipts.has(validationId)) return this.receipts.get(validationId);
    const receipt = await this.artifacts.readReceipt(validationId);
    if (receipt) this.receipts.set(validationId, receipt);
    return receipt;
  }

  async #persistReceipt(receipt) {
    this.receipts.set(receipt.validationId, receipt);
    await this.artifacts.updateReceipt(receipt);
  }

  async #installProjectReceipt({ receipt, authorization, taskSummary, resumePrompt, registerWaits }) {
    if (typeof registerWaits !== "function") throw new TypeError("registerWaits callback is required");
    await this.capabilities.validateGrants({ grants: receipt.manifest.capability_grants, authorization });
    receipt.installations ??= {};
    const existing = receipt.installations[authorization.sessionId];
    if (existing?.state === "installed") return structuredClone(existing.result);
    const installation = existing ?? {
      state: "validated",
      proposal: createCustomProposal({
        receipt, sessionId: authorization.sessionId, taskSummary, resumePrompt,
        idFactory: this.idFactory, runtimeAuthorization: authorization,
      }),
    };
    receipt.installations[authorization.sessionId] = installation;
    installation.state = "installing";
    await this.#persistReceipt(receipt);
    try {
      const registration = await registerWaits(installation.proposal);
      const monitorIds = installation.proposal.monitors.map(monitor => monitor.monitor_id);
      const waitIds = installation.proposal.waits.map(wait => wait.wait_id);
      installation.state = "installed";
      installation.result = {
        validationId: receipt.validationId, artifactHash: receipt.artifact.sha256, monitorIds, waitIds,
        nextCheckAt: registration.monitors.filter(monitor => monitorIds.includes(monitor.monitor_id))
          .map(monitor => monitor.next_check_at).filter(Boolean).sort()[0] ?? null,
        expiry: receipt.manifest.expires_at,
      };
      receipt.state = "installed";
      await this.#persistReceipt(receipt);
      return structuredClone(installation.result);
    } catch (error) {
      installation.state = "validated";
      await this.#persistReceipt(receipt);
      throw error;
    }
  }

  async #withLock(key, operation) {
    if (typeof key !== "string" || !key) return operation();
    const previous = this.locks.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.locks.set(key, current);
    try { return await current; }
    finally { if (this.locks.get(key) === current) this.locks.delete(key); }
  }
}

export function validateCustomManifest(manifest, now = new Date()) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw customError("invalid_manifest", "Monitor Bundle manifest is required");
  if (manifest.contract_version !== 1) throw customError("invalid_manifest", "Monitor Bundle contract version must be 1");
  if (!TYPE_ID.test(manifest.type_id ?? "")) throw customError("invalid_manifest", "Custom Monitor Bundle requires a custom.* type id");
  if (!Array.isArray(manifest.event_types) || manifest.event_types.length !== 1 || !EVENT_TYPE.test(manifest.event_types[0] ?? "")) {
    throw customError("invalid_manifest", "Custom Monitor Bundle v1 requires exactly one declared Event type");
  }
  if (!Array.isArray(manifest.capability_grants) || manifest.capability_grants.length === 0 || manifest.capability_grants.length > 16) {
    throw customError("invalid_manifest", "Custom Monitor Bundle capability grants are required");
  }
  for (const grant of manifest.capability_grants) {
    if (typeof grant?.provider !== "string" || typeof grant?.operation !== "string" || !grant.arguments || typeof grant.arguments !== "object") {
      throw customError("invalid_manifest", "Custom Monitor Bundle capability grant is invalid");
    }
  }
  if (!manifest.config || typeof manifest.config !== "object" || Array.isArray(manifest.config)) throw customError("invalid_manifest", "Custom Monitor Bundle config must be an object");
  const scope = manifest.scope ?? "session";
  if (!["session", "project"].includes(scope)) throw customError("invalid_manifest", "Custom Monitor Bundle scope must be session or project");
  if (!["one_shot", "recurring"].includes(manifest.lifecycle)) throw customError("invalid_manifest", "Custom Monitor Bundle lifecycle is invalid");
  const interval = manifest.schedule?.interval_seconds;
  const jitter = manifest.schedule?.jitter_seconds ?? 0;
  if (!Number.isSafeInteger(interval) || interval < 1 || interval > 86_400 || !Number.isSafeInteger(jitter) || jitter < 0 || jitter > Math.min(interval, 3_600)) {
    throw customError("invalid_manifest", "Custom Monitor Bundle schedule is invalid");
  }
  const expiry = Date.parse(manifest.expires_at);
  if (!Number.isFinite(expiry) || !/[zZ]|[+-]\d{2}:\d{2}$/u.test(manifest.expires_at ?? "") || expiry <= now.getTime()
    || expiry > now.getTime() + 30 * 24 * 60 * 60_000) throw customError("invalid_manifest", "Custom Monitor Bundle expiry must be an explicitly zoned future time within 30 days");
  assertValidParameterSchema(manifest.observation_schema, "custom Bundle observation schema");
  assertValidParameterSchema(manifest.event_data_schema, "custom Bundle Event data schema");
  validateLocales(manifest.locales);
  return deepFreeze(structuredClone({
    contract_version: 1,
    type_id: manifest.type_id,
    event_types: manifest.event_types,
    capability_grants: manifest.capability_grants,
    config: manifest.config,
    lifecycle: manifest.lifecycle,
    schedule: { interval_seconds: interval, jitter_seconds: jitter },
    retry: manifest.retry ?? { degraded_after: 1, fail_after: 5, backoff_seconds: [5, 30, 60, 300] },
    expires_at: new Date(expiry).toISOString(),
    observation_schema: manifest.observation_schema,
    event_data_schema: manifest.event_data_schema,
    locales: manifest.locales,
    scope,
  }));
}

function validateLocales(locales) {
  if (!locales || typeof locales !== "object" || Array.isArray(locales)) throw customError("invalid_manifest", "Custom Monitor Bundle localized presentation is required");
  for (const locale of ["en-US", "zh-CN"]) {
    const presentation = locales[locale];
    if (!presentation || typeof presentation !== "object" || Array.isArray(presentation)) throw customError("invalid_manifest", `Custom Monitor Bundle locale ${locale} is required`);
    for (const field of LOCALIZED_FIELDS) {
      if (typeof presentation[field] !== "string" || !presentation[field].trim() || presentation[field].length > 2_000) {
        throw customError("invalid_manifest", `Custom Monitor Bundle locale ${locale}.${field} is invalid`);
      }
    }
  }
}

function createCustomProposal({ receipt, sessionId, taskSummary, resumePrompt, idFactory, runtimeAuthorization = receipt.authorization }) {
  if (typeof taskSummary !== "string" || !taskSummary.trim() || taskSummary.length > 2_000) throw customError("invalid_summary", "Task summary is invalid");
  if (typeof resumePrompt !== "string" || !resumePrompt.trim() || resumePrompt.length > 8_000) throw customError("invalid_continuation", "Resume prompt is invalid");
  const instanceId = `custom-monitor-${idFactory()}`;
  const waitId = `wait-${instanceId}`;
  const manifest = receipt.manifest;
  return {
    sessionId,
    taskSummary: taskSummary.trim(),
    context: { custom_bundle_type: manifest.type_id, artifact_hash: receipt.artifact.sha256 },
    waits: [{
      wait_id: waitId,
      phase: "waiting_for_custom_monitor",
      exclusive: true,
      exclusive_owner_key: instanceId,
      expected_event: manifest.event_types[0],
      caused_by: "The Agent installed a validated custom Monitor Bundle.",
      actors: [],
      entities: [instanceId],
      prior_exchange: taskSummary.trim(),
      continuation: {
        next_action: resumePrompt.trim(),
        success_condition: `The custom Monitor emitted ${manifest.event_types[0]}.`,
        constraints: [],
        artifacts: [{ kind: "relay_monitor_bundle", id: instanceId, label: manifest.type_id }],
        on_failure: "Inspect the custom Monitor's stable failure class and repair or stop it.",
        on_timeout: "Report that the custom Monitor has not observed its condition before expiry.",
      },
    }],
    monitors: [{
      monitor_id: instanceId,
      wait_id: waitId,
      lifecycle: manifest.lifecycle,
      observer: { provider: "custom.bundle" },
      detector: { kind: "custom.bundle", event_type: manifest.event_types[0] },
      schedule: manifest.schedule,
      retry: manifest.retry,
      capabilities: Object.fromEntries(manifest.capability_grants.map(grant => [grant.provider, { operation: grant.operation }])),
      artifact: createRuntimeArtifact({
        receipt,
        runtimeAuthorization,
      }),
    }],
  };
}

function createReplacementProposal(receipt, current, runtimeAuthorization) {
  const manifest = receipt.manifest;
  return {
    observer: { provider: "custom.bundle" },
    detector: { kind: "custom.bundle", event_type: manifest.event_types[0] },
    schedule: manifest.schedule,
    retry: manifest.retry,
    capabilities: Object.fromEntries(manifest.capability_grants.map(grant => [grant.provider, { operation: grant.operation }])),
    artifact: createRuntimeArtifact({ receipt, runtimeAuthorization, replacesArtifactHash: current.artifact_hash }),
  };
}

function createRuntimeArtifact({ receipt, runtimeAuthorization, replacesArtifactHash }) {
  const manifest = receipt.manifest;
  const identity = {
    source_sha256: receipt.artifact.sha256,
    manifest,
    authorization: runtimeAuthorization,
    replaces_artifact_hash: replacesArtifactHash ?? null,
  };
  return {
    kind: "sandboxed-bundle",
    type_id: manifest.type_id,
    bundle_version: 1,
    sha256: receipt.artifact.sha256,
    version_sha256: createHash("sha256").update(stableJson(identity), "utf8").digest("hex"),
    manifest,
    authorization: runtimeAuthorization,
    origin: { kind: "agent", creator_session: receipt.authorization.sessionId, scope: manifest.scope },
    ...(replacesArtifactHash ? { replaces_artifact_hash: replacesArtifactHash } : {}),
  };
}

function assertCustomMonitorOwner(monitor, sessionId) {
  if (!monitor || monitor.session_id !== sessionId) throw customError("owner_mismatch", "Monitor Bundle does not belong to this Session");
  if (monitor.artifact?.kind !== "sandboxed-bundle" || monitor.observer?.provider !== "custom.bundle") {
    throw customError("invalid_monitor", "Only custom Monitor Bundles can use custom update or rollback");
  }
  if (!new Set(["active", "degraded", "paused"]).has(monitor.state)) {
    throw customError("invalid_monitor_state", `Monitor Bundle cannot be changed from ${monitor.state}`);
  }
}

function assertCompatibleReplacement(current, replacement) {
  if (!current || !replacement || current.type_id !== replacement.type_id) {
    throw customError("incompatible_update", "Monitor Bundle update must retain its type id");
  }
  if (current.scope !== replacement.scope || current.lifecycle !== replacement.lifecycle
    || current.event_types?.[0] !== replacement.event_types?.[0]) {
    throw customError("incompatible_update", "Monitor Bundle update must retain scope, lifecycle, and Event contract");
  }
}

function assertNoCapabilityExpansion(current, target) {
  const allowed = new Set(current.map(stableJson));
  if (target.some(grant => !allowed.has(stableJson(grant)))) {
    throw customError("capability_expansion", "Monitor Bundle rollback cannot restore broader capabilities");
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function validateCustomEvents(events, manifest) {
  if (!Array.isArray(events) || events.length > 1) throw customError("invalid_event", "Custom Monitor Bundle v1 may emit at most one Event per check");
  return events.map(event => {
    if (!event || event.type !== manifest.event_types[0] || typeof event.key !== "string" || !event.key || event.key.length > 512) {
      throw customError("invalid_event", "Custom Monitor emitted an undeclared Event or invalid key");
    }
    validateParameters(manifest.event_data_schema, event.data);
    return structuredClone({ type: event.type, key: event.key, data: event.data });
  });
}

function publicReceipt(receipt) {
  return Object.freeze({
    validationId: receipt.validationId,
    artifactHash: receipt.artifact.sha256,
    artifactBytes: receipt.artifact.bytes,
    typeId: receipt.manifest.type_id,
    approvedCapabilities: Object.freeze(receipt.manifest.capability_grants.map(grant => `${grant.provider}.${grant.operation}`)),
    receiptExpiresAt: receipt.expiresAt,
    bundleExpiresAt: receipt.manifest.expires_at,
    runtime: "quickjs-wasm",
  });
}

function publicCatalogEntry(receipt, locale, now) {
  const manifest = receipt.manifest;
  const localized = manifest.locales[locale];
  const expired = Date.parse(manifest.expires_at) <= now || Date.parse(receipt.expiresAt) <= now && receipt.state !== "installed";
  return deepFreeze({
    api_version: 1,
    type_id: manifest.type_id,
    bundle_version: 1,
    origin: { kind: "agent", creator_session: receipt.authorization.sessionId, scope: manifest.scope },
    event_types: [...manifest.event_types],
    parameter_schema: { type: "object", additionalProperties: false, properties: {} },
    capabilities: manifest.capability_grants.map(grant => `${grant.provider}.${grant.operation}`),
    lifecycle: [manifest.lifecycle],
    status: expired ? "unavailable" : "available",
    locale,
    name: localized.name,
    description: localized.description,
    permissions: localized.permissions,
    remediation: expired ? localized.remediation : localized.remediation,
    artifact_hash: receipt.artifact.sha256,
    scope: manifest.scope,
    creator_session: receipt.authorization.sessionId,
    reusable: manifest.scope === "project",
    expiry: manifest.expires_at,
    validation_state: expired ? "expired" : receipt.state,
  });
}

async function normalizeAuthorization(authorization, scope) {
  if (typeof authorization?.sessionId !== "string" || !authorization.sessionId) throw customError("invalid_owner", "Authenticated Session is required");
  const result = structuredClone(authorization);
  if (scope === "project") {
    if (typeof authorization.cwd !== "string" || !authorization.cwd) throw customError("invalid_project", "Project-scoped Monitor Bundle requires an authenticated project directory");
    try { result.projectRoot = await realpath(authorization.cwd); }
    catch { throw customError("invalid_project", "Project-scoped Monitor Bundle project directory is unavailable"); }
  }
  return result;
}

function assertReceiptAccess(receipt, authorization) {
  if (!receiptAccessAllowed(receipt, authorization)) throw customError("owner_mismatch", "Monitor Bundle validation is not authorized for this Session or project");
}

function receiptAccessAllowed(receipt, authorization) {
  if (receipt.manifest.scope === "session") return receipt.authorization.sessionId === authorization.sessionId;
  const root = receipt.authorization.projectRoot;
  const candidate = authorization.projectRoot;
  return typeof root === "string" && typeof candidate === "string" && (candidate === root || candidate.startsWith(`${root}${sep}`));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function customError(errorClass, message) {
  return Object.assign(new Error(message), { name: "CustomMonitorBundleError", errorClass });
}
