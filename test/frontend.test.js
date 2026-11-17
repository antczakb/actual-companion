import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("browser script parses (a typo here would blank the whole page)", () => {
  const r = spawnSync(process.execPath, ["--check", new URL("../public/app.js", import.meta.url).pathname], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});
