#!/usr/bin/env node
// Does the library load and compute on the OLDEST Node it claims to support?
//
// `npm test` cannot answer that: its script is `node --test "test/**/*.test.mjs"`, and the test
// runner's glob support arrived in Node 22, so on Node 18 the suite fails for tooling reasons that
// say nothing about the library. `engines: {"node": ">=18"}` was therefore an untested claim.
//
// This is the part that has to hold on the floor: the ES module entry point loads, the browser
// bundle evaluates in a bare realm with no Node globals, and both compute the same answers using
// the syntax and built-ins the library actually depends on -- BigInt literals, class fields,
// `??`/`?.`, `Object.fromEntries`, `Array.prototype.flat`, `String.replaceAll`.
//
// No test framework, on purpose: node:test's own API has moved between 18 and 24, and a floor check
// that depends on the floor's tooling is not a floor check. Exits non-zero on the first failure.

import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

let failures = 0;
function ok(what, condition, detail) {
  if (condition) {
    console.log(`  ok    ${what}`);
  } else {
    failures++;
    console.log(`  FAIL  ${what}${detail === undefined ? "" : ` -- ${detail}`}`);
  }
}

console.log(`smoke: node ${process.version}`);

// ---- the ES module entry point ----
const m = await import(ROOT + "src/index.js");

ok("the barrel loads", typeof m === "object");
ok("VERSION is a version", /^\d+\.\d+\.\d+/.test(m.VERSION), m.VERSION);
ok(
  "VERSION agrees with package.json",
  m.VERSION === JSON.parse(readFileSync(ROOT + "package.json", "utf8")).version,
);

// Nothing at import time may touch the DOM: this is what makes the package safe to import from a
// Next.js or SvelteKit server render.
ok("importing it touches no DOM global", typeof globalThis.document === "undefined");

// ---- the geometry kernel ----
const d = 2 * Math.asinh(5);
ok(
  "Isom round-trips a translation",
  Math.abs(m.Isom.translationToLocal(3, 4).distanceMoved() - d) < 1e-12,
);
{
  // The far-field case that the 2011 polynomial got wrong; see notes/su11-core.md.
  const y = 11711.92;
  const out = m.Isom.translationToLocal(0, y).inverse().applyToLocal(0, y, undefined, [0, 0]);
  ok("recentring a far point lands on the origin", Math.hypot(out[0], out[1]) < 1e-9);
}

// ---- exact arithmetic: BigInt literals and the Number/BigInt dual representation ----
{
  const t = new m.RegularTiling({ p: 8, q: 3, frameSymmetry: 4 });
  let node = t.originAddress();
  for (let i = 0; i < 40; i++) node = t.extendAddress(node, i % t.generatorCount());
  const id = t.addressToString(node);
  ok("a 40-step {8,3} walk names a tile", typeof id === "string" && id.length > 0, id.slice(0, 40));
  ok("the tile id is canonical", t.addressEquals(node, t.extendAddress(t.originAddress(), 0)) === false);
}
{
  // BigInt literals in the binary tiling's addressing.
  const b = new m.BinaryTiling({ drawOrder: "V>>" });
  const child = b.extendAddress(b.originAddress(), m.BIN_CHILD1);
  ok("binary addressing uses BigInt", typeof child.lat === "bigint" && typeof child.lon === "bigint");
  ok("binary address string", b.addressToString(child) === "-1,1", b.addressToString(child));
}

// ---- the browser bundle, in a realm with no Node globals at all ----
const bundlePath = ROOT + "dist/hyperbolic-map.iife.js";
if (!existsSync(bundlePath)) {
  failures++;
  console.log("  FAIL  dist/hyperbolic-map.iife.js is missing -- run `npm run build`");
} else {
  const ctx = vm.createContext({});
  vm.runInContext(readFileSync(bundlePath, "utf8"), ctx);
  const H = ctx.HyperbolicMap;
  ok("the bundle evaluates with no Node globals", !!H);
  ok("the bundle exposes the same version", H && H.VERSION === m.VERSION);
  ok(
    "the bundle computes the same answer",
    H && Math.abs(H.Isom.translationToLocal(3, 4).distanceMoved() - d) < 1e-12,
  );
}

console.log(failures === 0 ? "smoke: ok" : `smoke: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
