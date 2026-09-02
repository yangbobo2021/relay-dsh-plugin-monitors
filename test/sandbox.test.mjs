import assert from "node:assert/strict";
import test from "node:test";

import { MonitorBundleSandbox } from "../src/sandbox.mjs";

const validSource = `
globalThis.monitor = {
  observe(context) {
    return { provider: "fixture.read", operation: "status", arguments: { handle: context.config.handle } };
  },
  detect(previous, current) {
    if (!previous || previous.status === current.status) return [];
    return [{ type: "fixture.exited", key: current.handle + ":" + current.status, data: current }];
  },
};`;

test("MB04-001/005: QuickJS WASM validates and runs a bounded Monitor contract", async () => {
  const sandbox = new MonitorBundleSandbox();
  assert.deepEqual(await sandbox.validate(validSource), { valid: true, runtime: "quickjs-wasm", contract_version: 1 });
  assert.deepEqual(await sandbox.observe(validSource, { config: { handle: "handle-1" } }), {
    provider: "fixture.read", operation: "status", arguments: { handle: "handle-1" },
  });
  assert.deepEqual(await sandbox.detect(validSource, { handle: "handle-1", status: "running" }, { handle: "handle-1", status: "exited" }), [{
    type: "fixture.exited", key: "handle-1:exited", data: { handle: "handle-1", status: "exited" },
  }]);
});

test("MB04-001: sandbox has no ambient host, I/O, clock, randomness, timer, or module authority", async () => {
  const sandbox = new MonitorBundleSandbox();
  const source = `globalThis.monitor = {
    observe() { return Object.fromEntries(["process","require","fetch","WebSocket","WebAssembly","Date","performance","setTimeout","queueMicrotask"].map(name => [name, typeof globalThis[name]]).concat([["random", typeof Math.random]])); },
    detect() { return []; },
  };`;
  const result = await sandbox.observe(source, {});
  assert.deepEqual(new Set(Object.values(result)), new Set(["undefined"]));
  for (const attack of [
    `globalThis.monitor={observe(){return process.env},detect(){return[]}}`,
    `import value from "node:fs"; globalThis.monitor={observe(){return value},detect(){return[]}}`,
    `globalThis.monitor={observe(){return require("node:fs")},detect(){return[]}}`,
  ]) await assert.rejects(sandbox.observe(attack, {}), error => error?.errorClass === "execution_failed");
});

test("MB04-005/007: infinite CPU, memory pressure, invalid exports, and oversized output fail with stable redacted classes", async () => {
  const cpuSandbox = new MonitorBundleSandbox({ wallClockMs: 5 });
  await assert.rejects(cpuSandbox.observe(`globalThis.monitor={observe(){while(true){}},detect(){return[]}}`, {}), error => error?.errorClass === "resource_limit");
  const memorySandbox = new MonitorBundleSandbox({ wallClockMs: 100, memoryBytes: 1024 * 1024 });
  await assert.rejects(memorySandbox.observe(`globalThis.monitor={observe(){return "x".repeat(2000000)},detect(){return[]}}`, {}), error => error?.errorClass === "resource_limit");
  const contractSandbox = new MonitorBundleSandbox({ outputBytes: 64 });
  await assert.rejects(contractSandbox.validate(`globalThis.monitor={observe(){return {}}}`), error => error?.errorClass === "invalid_module");
  await assert.rejects(contractSandbox.detect(`globalThis.monitor={observe(){return {}},detect(){return {}}}`, null, {}), error => error?.errorClass === "invalid_output");
  await assert.rejects(contractSandbox.observe(`globalThis.monitor={observe(){return "${"x".repeat(65)}"},detect(){return[]}}`, {}), error => error?.errorClass === "output_limit");
});
