import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Monitors has only a public Events peer and no Event persistence implementation", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const host = await readFile(new URL("../host-plugin.js", import.meta.url), "utf8");
  const acceptance = await readFile(new URL("../docs/acceptance-scenarios.md", import.meta.url), "utf8");
  assert.equal(manifest.peerDependencies["relay-dsh-plugin-events"], "0.2.0-rc.1");
  assert.match(host, /ctx\.inject\(\["relayEvents"\]/);
  assert.doesNotMatch(host, /SQLite|RelayStore|codex|claude/);
  for (let id = 1; id <= 18; id += 1) assert.match(acceptance, new RegExp(`MON-${String(id).padStart(3, "0")}`));
});
