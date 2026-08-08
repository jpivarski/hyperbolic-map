// The browser bundle is produced by concatenation, with no bundler (see dev/build.mjs). That is
// only safe because dev/check-bundle.mjs constrains the source style, so these tests guard the
// arrangement end to end: the bundle must evaluate in a clean realm, expose the same surface as the
// ESM entry point, and actually compute the same answers.

import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BUNDLE = ROOT + "dist/hyperbolic-map.iife.js";

function buildIfNeeded() {
  if (!existsSync(BUNDLE)) {
    execFileSync("node", ["dev/build.mjs"], { cwd: ROOT, stdio: "pipe" });
  }
  return readFileSync(BUNDLE, "utf8");
}

function loadBundle() {
  const src = buildIfNeeded();
  // A bare context: no Node globals. If the source ever reaches for a Node API this fails here.
  const ctx = vm.createContext({});
  vm.runInContext(src, ctx);
  return ctx.HyperbolicMap;
}

test("the bundle evaluates in a clean realm", () => {
  const H = loadBundle();
  assert.ok(H, "global HyperbolicMap was not defined");
  assert.equal(typeof H.VERSION, "string");
});

test("the bundle exposes everything the ESM entry point exports", async () => {
  const H = loadBundle();
  const esm = await import("../src/index.js");
  const missing = Object.keys(esm).filter((k) => !(k in H));
  assert.deepEqual(missing, [], `names missing from the bundle: ${missing.join(", ")}`);
});

test("the bundle computes the same answers as the ESM source", async () => {
  const H = loadBundle();
  const esm = await import("../src/index.js");

  // A composition with two non-trivial translation parts, which is where a mis-signed
  // composeInto would show up.
  const build = (mod) =>
    mod.Isom.rotation(0.83)
      .mul(mod.Isom.translationToLocal(1.7, -0.9))
      .mul(mod.Isom.translationToLocal(-0.4, 2.2));
  const a = build(H).applyToLocal(0.6, -1.1, undefined, [0, 0]);
  const b = build(esm).applyToLocal(0.6, -1.1, undefined, [0, 0]);
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-15, `bundle ${a} vs esm ${b}`);
});

test("the far-field precision fix survives the bundling", () => {
  const H = loadBundle();
  // Recentring the view on a point puts it at the disk center. The 2011 polynomial put this
  // particular point on the disk boundary instead; see notes/su11-core.md.
  const x = 0;
  const y = 11711.92;
  const out = H.Isom.translationToLocal(x, y).inverse().applyToLocal(x, y, undefined, [0, 0]);
  assert.ok(Math.hypot(out[0], out[1]) < 1e-9);
});
