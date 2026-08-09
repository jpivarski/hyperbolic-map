// src/index.d.ts is hand-written, so the thing that will actually go wrong is drift: a name added to
// the barrel and not to the declarations, or left in the declarations after being removed. These
// tests are the same shape as test/bundle.test.mjs's surface check -- equality in BOTH directions,
// because a one-directional check is exactly how the bundle came to expose a name the ESM entry did
// not.
//
// Zero dependencies on purpose: `npm test` must keep working offline. The deeper check, that the
// declarations are internally coherent and that the wrong things fail to compile, is
// `npm run typecheck` (dev/typecheck/), which needs tsc and therefore the network.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DTS = ROOT + "src/index.d.ts";

// Exported VALUE names only. `export interface`, `export type` and `export declare type` are types:
// they have no runtime existence, and declaring one is not a promise that `import` can resolve it.
// SourceSet and TileSymmetryError are deliberately in that second category.
function declaredValueNames(text) {
  const names = new Set();
  const re = /^export\s+(?:declare\s+)?(?:abstract\s+)?(class|function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(text)) !== null) names.add(m[2]);
  return names;
}

function declaredTypeNames(text) {
  const names = new Set();
  const re = /^export\s+(?:declare\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(text)) !== null) names.add(m[1]);
  return names;
}

test("package.json points at a declaration file that exists", () => {
  const pkg = JSON.parse(readFileSync(ROOT + "package.json", "utf8"));
  // Both spellings: `exports` is what node16/nodenext/bundler resolution reads, the top-level
  // `types` is what a consumer still on node10 resolution reads. Promising types at a path that
  // does not exist is worse than promising none, which is why this checks the file and not just
  // the string.
  assert.equal(pkg.types, "./src/index.d.ts", "top-level `types` is missing or wrong");
  assert.equal(pkg.exports["."].types, "./src/index.d.ts", "`exports[\".\"].types` is missing or wrong");
  const keys = Object.keys(pkg.exports["."]);
  assert.equal(keys[0], "types", `"types" must come first in the exports condition, got ${keys.join(", ")}`);
  for (const rel of [pkg.types, pkg.exports["."].types, pkg.exports["."].default]) {
    assert.ok(existsSync(ROOT + rel.replace(/^\.\//, "")), `${rel} does not exist`);
  }
  // It ships: `files` includes "src", which covers it. Guard the premise rather than the effect.
  assert.ok(pkg.files.includes("src"), "`files` must include src/ for the declarations to ship");
});

test("the declarations export exactly what the barrel does", async () => {
  const text = readFileSync(DTS, "utf8");
  const declared = declaredValueNames(text);
  const actual = new Set(Object.keys(await import("../src/index.js")));

  const missing = [...actual].filter((n) => !declared.has(n)).sort();
  assert.deepEqual(missing, [], `exported by src/index.js but not declared in src/index.d.ts: ${missing.join(", ")}`);

  const extra = [...declared].filter((n) => !actual.has(n)).sort();
  assert.deepEqual(extra, [], `declared in src/index.d.ts but not exported by src/index.js: ${extra.join(", ")}`);
});

test("names that exist only at run time are declared as types, not as values", () => {
  const text = readFileSync(DTS, "utf8");
  const values = declaredValueNames(text);
  const types = declaredTypeNames(text);
  // Reachable through the public API -- `viewport.sources`, a thrown error, `onGestureStart`'s
  // argument -- but not exported. A consumer needs the shape; declaring them as classes would be a
  // promise `import { SourceSet }` cannot keep.
  for (const name of ["SourceSet", "TileSymmetryError", "GestureMode"]) {
    assert.ok(types.has(name), `${name} should be declared as a type`);
    assert.ok(!values.has(name), `${name} must NOT be declared as a value: it is not exported at run time`);
  }
});

test("the declared version type matches what the module actually exports", async () => {
  const text = readFileSync(DTS, "utf8");
  assert.match(text, /^export const VERSION: string;$/m, "VERSION should be declared as a plain string");
  const esm = await import("../src/index.js");
  assert.equal(typeof esm.VERSION, "string");
});

test("the declarations are invisible to the bundler and the source checker", () => {
  // Both walk src/ filtering on `.js`, so a `.d.ts` cannot be swept into the browser bundle or
  // linted as if it were a module. If either ever switches to a broader filter this fails here
  // rather than by emitting TypeScript into dist/.
  for (const dev of ["dev/build.mjs", "dev/check-bundle.mjs"]) {
    const src = readFileSync(ROOT + dev, "utf8");
    assert.match(src, /name\.endsWith\("\.js"\)/, `${dev} no longer filters src/ on .js`);
  }
  const bundle = ROOT + "dist/hyperbolic-map.iife.js";
  if (existsSync(bundle)) {
    assert.ok(!readFileSync(bundle, "utf8").includes("export interface"), "declarations leaked into the bundle");
  }
});
