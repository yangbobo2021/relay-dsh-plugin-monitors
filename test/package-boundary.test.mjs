import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Monitors has only a public Events peer and no Event persistence implementation", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const host = await readFile(new URL("../host-plugin.js", import.meta.url), "utf8");
  const controller = await readFile(new URL("../src/controller.mjs", import.meta.url), "utf8");
  const observers = await readFile(new URL("../src/observer-registry.mjs", import.meta.url), "utf8");
  const detectors = await readFile(new URL("../src/detectors.mjs", import.meta.url), "utf8");
  const agentBridge = await readFile(new URL("../agent-bridge.js", import.meta.url), "utf8");
  const acceptance = await readFile(new URL("../docs/acceptance-scenarios.md", import.meta.url), "utf8");
  assert.equal(manifest.peerDependencies["relay-dsh-plugin-events"], "0.2.1");
  assert.match(host, /ctx\.inject\(\["relayEvents"\]/);
  assert.doesNotMatch(host, /SQLite|RelayStore|codex|claude/);
  for (const source of [host, controller, observers, detectors, agentBridge]) {
    assert.doesNotMatch(source, /relay_schedule_timer|createTimerWait|deadline_reached|timer\.elapsed/u,
      "Monitor Core must not contain the Time extension implementation");
  }
  for (let id = 1; id <= 20; id += 1) assert.match(acceptance, new RegExp(`MON-${String(id).padStart(3, "0")}`));
  for (let id = 1; id <= 10; id += 1) assert.match(acceptance, new RegExp(`MB01-${String(id).padStart(3, "0")}`));
  for (let id = 1; id <= 6; id += 1) assert.match(acceptance, new RegExp(`MB02-${String(id).padStart(3, "0")}`));
  assert.match(acceptance, /MB08-001/u);
  assert.match(acceptance, /MB08-002/u);
});
