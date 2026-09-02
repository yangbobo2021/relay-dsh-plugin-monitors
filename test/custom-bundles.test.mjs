import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Context } from "@deepseek-ai/cordis";
import { MonitorArtifactStore } from "../src/artifact-store.mjs";
import { RelayMonitorCapabilityRegistry } from "../src/capability-registry.mjs";
import { RelayCustomMonitorBundles } from "../src/custom-bundles.mjs";
import { MonitorBundleSandbox } from "../src/sandbox.mjs";

const source = `globalThis.monitor={
  observe(context){return {provider:"fixture.process",operation:"status",arguments:{handle:context.config.handle}}},
  detect(previous,current){return previous?.status==="running"&&current.status==="exited"?[{type:"process.exited",key:current.handle+":"+current.identity,data:current}]:[]}
}`;

const manifest = (overrides = {}) => ({
  contract_version: 1,
  type_id: "custom.process-exit",
  event_types: ["process.exited"],
  capability_grants: [{ provider: "fixture.process", operation: "status", arguments: { handle: "issued-handle" } }],
  config: { handle: "issued-handle" },
  lifecycle: "one_shot",
  schedule: { interval_seconds: 1, jitter_seconds: 0 },
  expires_at: "2026-09-03T00:00:00.000Z",
  observation_schema: {
    type: "object", additionalProperties: false, required: ["handle", "identity", "status"],
    properties: { handle: { type: "string" }, identity: { type: "string" }, status: { enum: ["running", "exited"] } },
  },
  event_data_schema: {
    type: "object", additionalProperties: false, required: ["handle", "identity", "status"],
    properties: { handle: { type: "string" }, identity: { type: "string" }, status: { const: "exited" } },
  },
  locales: {
    "en-US": { name: "Process exit", description: "Wait for one process to exit.", permissions: "Reads one authorized process identity.", remediation: "Issue a new process Handle." },
    "zh-CN": { name: "进程退出", description: "等待一个进程退出。", permissions: "读取一个已授权的进程身份。", remediation: "请重新签发进程 Handle。" },
  },
  ...overrides,
});

async function fixture({ authorize = ({ authorization }) => authorization.sessionId === "owner", clock = () => new Date("2026-09-02T00:00:00.000Z"), receiptTtlMs } = {}) {
  const root = await mkdtemp(join(tmpdir(), "relay-custom-bundle-"));
  const capabilities = new RelayMonitorCapabilityRegistry(new Context());
  let status = "running";
  capabilities.registerCapabilityProvider({
    api_version: 1, id: "fixture.process", provider_version: 1,
    operations: { status: {
      class: "read",
      parameters: { type: "object", additionalProperties: false, required: ["handle"], properties: { handle: { const: "issued-handle" } } },
      result: { type: "object", additionalProperties: false, required: ["handle", "identity", "status"], properties: {
        handle: { type: "string" }, identity: { type: "string" }, status: { enum: ["running", "exited"] },
      } },
    } },
    authorize,
    async execute() { return { handle: "issued-handle", identity: "host:pid:start", status }; },
  });
  const artifacts = new MonitorArtifactStore(root);
  let id = 0;
  const custom = new RelayCustomMonitorBundles({
    artifacts, capabilities, sandbox: new MonitorBundleSandbox(),
    clock, idFactory: () => String(++id), ...(receiptTtlMs === undefined ? {} : { receiptTtlMs }),
  });
  return { root, artifacts, custom, capabilities, setStatus(value) { status = value; } };
}

test("MB03-001/004/005: validation stores immutable content-addressed source and issues an owner-bound receipt", async () => {
  const f = await fixture();
  const first = await f.custom.validate({ manifest: manifest(), source, authorization: { sessionId: "owner", cwd: "/work/a" } });
  const second = await f.custom.validate({ manifest: manifest(), source, authorization: { sessionId: "owner", cwd: "/work/a" } });
  assert.equal(first.artifactHash, second.artifactHash);
  assert.notEqual(first.validationId, second.validationId);
  assert.equal(await f.artifacts.read(first.artifactHash), source);
  assert.equal((await f.artifacts.readReceipt(first.validationId)).manifest.type_id, "custom.process-exit");
  await writeFile(f.artifacts.pathFor(first.artifactHash), "tampered", "utf8");
  await assert.rejects(f.artifacts.read(first.artifactHash), error => error?.errorClass === "artifact_tampered");
  await chmod(f.root, 0o700);
});

test("MB03-001: authorized custom catalog entries persist, localize, and redact grant arguments", async () => {
  const f = await fixture();
  const receipt = await f.custom.validate({ manifest: manifest(), source, authorization: { sessionId: "owner", cwd: "/work/a" } });
  const reloaded = new RelayCustomMonitorBundles({
    artifacts: f.artifacts, capabilities: f.capabilities, sandbox: new MonitorBundleSandbox(),
    clock: () => new Date("2026-09-02T00:00:00.000Z"), idFactory: () => "reloaded",
  });
  assert.deepEqual(await reloaded.listBundleTypes({ authorization: { sessionId: "other" } }), []);
  const [entry] = await reloaded.listBundleTypes({ locale: "zh-CN", authorization: { sessionId: "owner" } });
  assert.equal(entry.name, "进程退出");
  assert.equal(entry.origin.kind, "agent");
  assert.equal(entry.artifact_hash, receipt.artifactHash);
  assert.equal(entry.reusable, false);
  assert.doesNotMatch(JSON.stringify(entry), /issued-handle|\/work\/a/u);
});

test("MB03-002: project scope reuses inside the canonical boundary and rejects parent-prefix, sibling, and symlink escape", async () => {
  const projectArea = await mkdtemp(join(tmpdir(), "relay-project-scope-"));
  const project = join(projectArea, "project");
  const child = join(project, "child");
  const sibling = join(projectArea, "sibling");
  const prefix = join(projectArea, "project-escape");
  await Promise.all([mkdir(child, { recursive: true }), mkdir(sibling), mkdir(prefix)]);
  const escape = join(project, "outside-link");
  await symlink(sibling, escape);
  const canonicalProject = await realpath(project);
  const f = await fixture({ authorize: ({ authorization }) => authorization.projectRoot === canonicalProject || authorization.projectRoot?.startsWith(`${canonicalProject}/`) });
  const receipt = await f.custom.validate({
    manifest: manifest({ scope: "project" }), source, authorization: { sessionId: "owner", cwd: project },
  });
  for (const [cwd, visible] of [[child, true], [projectArea, false], [sibling, false], [prefix, false], [escape, false]]) {
    const entries = await f.custom.listBundleTypes({ authorization: { sessionId: "coworker", cwd } });
    assert.equal(entries.length > 0, visible, `unexpected project visibility for ${cwd}`);
  }
  let proposal;
  const installed = await f.custom.install({
    validationId: receipt.validationId, sessionId: "coworker", authorization: { sessionId: "coworker", cwd: child },
    taskSummary: "等待", resumePrompt: "继续", async registerWaits(value) { proposal = value; return { monitors: value.monitors, waits: value.waits }; },
  });
  assert.equal(proposal.sessionId, "coworker");
  assert.equal(proposal.monitors[0].artifact.authorization.sessionId, "coworker");
  assert.equal(proposal.monitors[0].artifact.origin.creator_session, "owner");
  assert.equal(proposal.monitors[0].artifact.origin.scope, "project");
  const repeated = await f.custom.install({
    validationId: receipt.validationId, sessionId: "coworker", authorization: { sessionId: "coworker", cwd: child },
    taskSummary: "ignored", resumePrompt: "ignored", registerWaits() { throw new Error("must not register twice"); },
  });
  assert.deepEqual(repeated.monitorIds, installed.monitorIds);
  await assert.rejects(f.custom.install({
    validationId: receipt.validationId, sessionId: "attacker", authorization: { sessionId: "attacker", cwd: sibling },
    taskSummary: "x", resumePrompt: "x", registerWaits() {},
  }), error => error?.errorClass === "owner_mismatch");
});

test("MB03-003/008: manifest expiry, schema, schedule, Event, capability, and module failures install nothing", async () => {
  const f = await fixture();
  const invalid = [
    manifest({ expires_at: undefined }),
    manifest({ expires_at: "2026-09-01T00:00:00Z" }),
    manifest({ expires_at: "2026-10-03T00:00:00Z" }),
    manifest({ event_types: ["bad"] }),
    manifest({ capability_grants: [] }),
    manifest({ schedule: { interval_seconds: 0 } }),
    manifest({ observation_schema: { type: "object", unknown: true } }),
  ];
  for (const value of invalid) await assert.rejects(f.custom.validate({ manifest: value, source, authorization: { sessionId: "owner" } }));
  await assert.rejects(f.custom.validate({ manifest: manifest(), source: "globalThis.monitor={}", authorization: { sessionId: "owner" } }), /export/u);
});

test("MB03-001/006/007 and MB04-002/010: installed custom runtime baselines, brokers exact grant, and emits only declared schema-valid Event", async () => {
  const f = await fixture();
  const receipt = await f.custom.validate({ manifest: manifest(), source, authorization: { sessionId: "owner" } });
  let proposal;
  const installed = await f.custom.install({
    validationId: receipt.validationId, sessionId: "owner", taskSummary: "等待进程退出", resumePrompt: "继续后续处理",
    async registerWaits(value) { proposal = value; return {
      monitors: [{ monitor_id: "older-monitor", next_check_at: "2026-09-01T00:00:00.000Z" }, ...value.monitors.map(m => ({ ...m, next_check_at: "2026-09-02T00:00:01.000Z" }))],
      waits: [{ wait_id: "older-wait" }, ...value.waits],
    }; },
  });
  assert.equal(installed.artifactHash, receipt.artifactHash);
  assert.deepEqual(installed.monitorIds, [proposal.monitors[0].monitor_id]);
  assert.deepEqual(installed.waitIds, [proposal.waits[0].wait_id]);
  assert.equal(proposal.monitors[0].artifact.sha256, receipt.artifactHash);
  assert.equal(proposal.monitors[0].artifact.authorization.sessionId, "owner");
  const provider = f.custom.createRuntimeProvider();
  const baseline = await provider.observe({ monitor: proposal.monitors[0] });
  assert.equal(baseline.status, "running");
  assert.deepEqual(await provider.detect({ monitor: proposal.monitors[0], previous: null, current: baseline }), []);
  f.setStatus("exited");
  const current = await provider.observe({ monitor: proposal.monitors[0] });
  const [event] = await provider.detect({ monitor: proposal.monitors[0], previous: baseline, current });
  assert.equal(event.type, "process.exited");
  assert.equal(event.key, "issued-handle:host:pid:start");
  const repeated = await f.custom.install({
    validationId: receipt.validationId, sessionId: "owner", taskSummary: "again", resumePrompt: "again", registerWaits() {},
  });
  assert.deepEqual(repeated.monitorIds, installed.monitorIds, "same-owner retry returns the durable install identity");
});

test("MB08-003: another Session cannot install a validation receipt and baseline failure keeps it retryable", async () => {
  const f = await fixture();
  const receipt = await f.custom.validate({ manifest: manifest(), source, authorization: { sessionId: "owner" } });
  await assert.rejects(f.custom.install({
    validationId: receipt.validationId, sessionId: "attacker", taskSummary: "x", resumePrompt: "x", registerWaits() {},
  }), error => error?.errorClass === "owner_mismatch");
  await assert.rejects(f.custom.install({
    validationId: receipt.validationId, sessionId: "owner", taskSummary: "x", resumePrompt: "x",
    async registerWaits() { throw new Error("baseline failed"); },
  }), /baseline failed/u);
  const retried = await f.custom.install({
    validationId: receipt.validationId, sessionId: "owner", taskSummary: "x", resumePrompt: "x",
    async registerWaits(value) { return { monitors: value.monitors, waits: value.waits }; },
  });
  assert.equal(retried.validationId, receipt.validationId);
});

test("MB08-003 restart: persisted validation installs the same immutable artifact after Host restart", async () => {
  const f = await fixture();
  const receipt = await f.custom.validate({ manifest: manifest(), source, authorization: { sessionId: "owner" } });
  const reloaded = new RelayCustomMonitorBundles({
    artifacts: f.artifacts, capabilities: f.capabilities, sandbox: new MonitorBundleSandbox(),
    clock: () => new Date("2026-09-02T00:00:00.000Z"), idFactory: () => "after-restart",
  });
  let proposal;
  const installed = await reloaded.install({
    validationId: receipt.validationId, sessionId: "owner", taskSummary: "等待", resumePrompt: "继续",
    async registerWaits(value) { proposal = value; return { monitors: value.monitors, waits: value.waits }; },
  });
  assert.equal(installed.artifactHash, receipt.artifactHash);
  assert.equal(proposal.monitors[0].artifact.sha256, receipt.artifactHash);
});

test("MB08-003 concurrency: simultaneous install retries converge on one proposal and one registration", async () => {
  const f = await fixture();
  const receipt = await f.custom.validate({ manifest: manifest(), source, authorization: { sessionId: "owner" } });
  let registrations = 0;
  const install = () => f.custom.install({
    validationId: receipt.validationId, sessionId: "owner", taskSummary: "等待", resumePrompt: "继续",
    async registerWaits(value) {
      registrations += 1;
      await new Promise(resolve => setImmediate(resolve));
      return { monitors: value.monitors, waits: value.waits };
    },
  });
  const [left, right] = await Promise.all([install(), install()]);
  assert.equal(registrations, 1);
  assert.deepEqual(left.monitorIds, right.monitorIds);
});

test("MB03-006: custom v1 rejects a multi-Event result before the Events store boundary", async () => {
  const f = await fixture();
  const multi = `globalThis.monitor={
    observe(c){return {provider:"fixture.process",operation:"status",arguments:{handle:c.config.handle}}},
    detect(p,c){return [{type:"process.exited",key:"one",data:c},{type:"process.exited",key:"two",data:c}]}
  }`;
  const receipt = await f.custom.validate({ manifest: manifest(), source: multi, authorization: { sessionId: "owner" } });
  let proposal;
  await f.custom.install({ validationId: receipt.validationId, sessionId: "owner", taskSummary: "x", resumePrompt: "x",
    async registerWaits(value) { proposal = value; return { monitors: value.monitors, waits: value.waits }; } });
  const runtime = f.custom.createRuntimeProvider();
  await assert.rejects(runtime.detect({ monitor: proposal.monitors[0], previous: { status: "running" }, current: {
    handle: "issued-handle", identity: "host:pid:start", status: "exited",
  } }), error => error?.errorClass === "invalid_event");
});

test("MB03-009: update is atomic, keeps identity, and rollback cannot expand capabilities", async () => {
  const f = await fixture();
  const original = await f.custom.validate({ manifest: manifest(), source, authorization: { sessionId: "owner" } });
  let installedProposal;
  await f.custom.install({ validationId: original.validationId, sessionId: "owner", taskSummary: "wait", resumePrompt: "continue",
    async registerWaits(value) { installedProposal = value; return { monitors: value.monitors, waits: value.waits }; } });
  const firstMonitor = installedProposal.monitors[0];
  const firstVersion = {
    version_id: "version-1", artifact_hash: firstMonitor.artifact.version_sha256,
    manifest: { observer: firstMonitor.observer, detector: firstMonitor.detector, schedule: firstMonitor.schedule,
      retry: firstMonitor.retry, capabilities: firstMonitor.capabilities, artifact: firstMonitor.artifact },
  };
  let current = { ...firstMonitor, monitor_id: firstMonitor.monitor_id, session_id: "owner", state: "active", version: 1,
    active_version_id: "version-1", artifact_hash: firstVersion.artifact_hash, versions: [firstVersion] };
  const replacementManifest = manifest({ config: { handle: "issued-handle", revision: 2 } });
  const replacement = await f.custom.validate({ manifest: replacementManifest, source: `${source}\n// revision 2`, authorization: { sessionId: "owner" } });
  const rebaselineCalls = [];
  const callbacks = {
    async inspectMonitor() { return current; },
    async rebaselineMonitor(monitorId, proposal, options) {
      rebaselineCalls.push({ monitorId, proposal, options });
      const existing = current.versions.find(version => version.artifact_hash === proposal.artifact.version_sha256);
      const version = existing ?? { version_id: "version-2", artifact_hash: proposal.artifact.version_sha256,
        manifest: { observer: proposal.observer, detector: proposal.detector, schedule: proposal.schedule,
          retry: proposal.retry, capabilities: proposal.capabilities, artifact: proposal.artifact } };
      current = { ...current, ...proposal, artifact_hash: version.artifact_hash, active_version_id: version.version_id,
        version: current.version + 1, versions: existing ? current.versions : [...current.versions, version] };
      return current;
    },
  };
  const updated = await f.custom.update({ validationId: replacement.validationId, monitorId: current.monitor_id,
    sessionId: "owner", expectedVersion: 1, ...callbacks });
  assert.equal(updated.previousVersionId, "version-1");
  assert.equal(updated.activeVersionId, "version-2");
  assert.equal(rebaselineCalls[0].proposal.artifact.sha256, replacement.artifactHash);
  assert.notEqual(rebaselineCalls[0].proposal.artifact.version_sha256, firstMonitor.artifact.version_sha256,
    "immutable version identity must include manifest/config, not only source bytes");
  assert.equal(rebaselineCalls[0].options.expectedVersion, 1);

  const failedReceipt = await f.custom.validate({ manifest: manifest({ config: { handle: "issued-handle", revision: 3 } }),
    source: `${source}\n// revision 3`, authorization: { sessionId: "owner" } });
  const beforeFailure = structuredClone(current);
  await assert.rejects(f.custom.update({ validationId: failedReceipt.validationId, monitorId: current.monitor_id,
    sessionId: "owner", inspectMonitor: async () => current, async rebaselineMonitor() { throw new Error("baseline failed"); } }), /baseline failed/u);
  assert.deepEqual(current, beforeFailure, "failed update must leave the old active version untouched");

  const rolledBack = await f.custom.rollback({ monitorId: current.monitor_id, versionId: "version-1", sessionId: "owner",
    expectedVersion: 2, ...callbacks });
  assert.equal(rolledBack.activeVersionId, "version-1");
  assert.equal(rebaselineCalls.at(-1).proposal.artifact.sha256, original.artifactHash);
  const expanded = structuredClone(current);
  expanded.artifact = structuredClone(expanded.artifact);
  expanded.artifact.manifest = { ...expanded.artifact.manifest, capability_grants: [] };
  await assert.rejects(f.custom.rollback({ monitorId: expanded.monitor_id, versionId: "version-1", sessionId: "owner",
    inspectMonitor: async () => expanded, rebaselineMonitor() { throw new Error("must not execute"); } }),
  error => error?.errorClass === "capability_expansion");
});

test("MB03-010: expiry cleanup removes only unreferenced artifacts and never deletes shared active content", async () => {
  let now = new Date("2026-09-02T00:00:00.000Z");
  const f = await fixture({ clock: () => now, receiptTtlMs: 60_000 });
  const first = await f.custom.validate({ manifest: manifest({ expires_at: "2026-09-02T00:02:00.000Z" }), source,
    authorization: { sessionId: "owner" } });
  const second = await f.custom.validate({ manifest: manifest({ expires_at: "2026-09-02T00:03:00.000Z" }), source,
    authorization: { sessionId: "owner" } });
  assert.equal(first.artifactHash, second.artifactHash);
  now = new Date("2026-09-02T00:01:01.000Z");
  const protectedByActive = await f.custom.cleanupExpired({ activeArtifactHashes: [first.artifactHash] });
  assert.equal(protectedByActive.deletedReceiptIds.length, 2, "expired uninstalled validation receipts are collected");
  assert.deepEqual(protectedByActive.deletedArtifactHashes, []);
  await access(f.artifacts.pathFor(first.artifactHash));
  const released = await f.custom.cleanupExpired({ activeArtifactHashes: [] });
  assert.deepEqual(released.deletedArtifactHashes, [first.artifactHash], "a later pass collects the orphan after the active reference ends");
  await assert.rejects(access(f.artifacts.pathFor(first.artifactHash)), error => error?.code === "ENOENT");

  const third = await f.custom.validate({ manifest: manifest({ expires_at: "2026-09-02T00:03:00.000Z" }), source,
    authorization: { sessionId: "owner" } });
  now = new Date("2026-09-02T00:03:01.000Z");
  const deleted = await f.custom.cleanupExpired();
  assert.deepEqual(deleted.deletedReceiptIds, [third.validationId]);
  assert.deepEqual(deleted.deletedArtifactHashes, [third.artifactHash]);
  await assert.rejects(access(f.artifacts.pathFor(third.artifactHash)), error => error?.code === "ENOENT");
});
