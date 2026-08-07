#!/usr/bin/env node
// Build dist/hyperbolic-map.iife.js by concatenating src/ in dependency order.
//
// There is no bundler dependency: tools/check-bundle.mjs constrains the source style so that
// stripping the import lines and the `export ` keyword, then concatenating in topological
// order, is a valid transform. Run `npm run build` (which checks first).
//
// Also emits a .min.js twin by stripping comments and redundant whitespace only — no identifier
// mangling, so no JS parser is needed.

import { readdirSync, readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");
const DIST = join(ROOT, "dist");
const ENTRY = join(SRC, "index.js");
const GLOBAL_NAME = "HyperbolicMap";

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".js")) out.push(p);
  }
  return out;
}

const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*"([^"]+)"\s*;?$/;
const EXPORT_RE = /^export\s+(?:class|function|const|let|async\s+function)\s+([A-Za-z_$][\w$]*)/;

// ---- parse every module: its deps, its exported names, and its body ----
const modules = new Map(); // absolute path -> {deps: [abs], exports: [name], body: string}
for (const file of walk(SRC)) {
  // Drop `export { ... };` re-export blocks (only the barrel has them). In a single-scope
  // bundle a re-export is meaningless, and leaving the braces behind would be a syntax error.
  const text = readFileSync(file, "utf8").replace(/^export\s*\{[\s\S]*?\};?\s*$/gm, "");
  const lines = text.split("\n");
  const deps = [];
  const exports = [];
  const body = [];
  for (const raw of lines) {
    const m = raw.match(IMPORT_RE);
    if (m) {
      deps.push(resolve(dirname(file), m[2]));
      continue; // drop the import; the bundle shares one scope
    }
    const em = raw.match(EXPORT_RE);
    if (em) exports.push(em[1]);
    body.push(raw.replace(/^export\s+/, ""));
  }
  modules.set(file, { deps, exports, body: body.join("\n") });
}

if (!modules.has(ENTRY)) {
  console.error(`build: missing entry point ${relative(ROOT, ENTRY)}`);
  process.exit(1);
}

// ---- topological sort (depth-first, with cycle detection) ----
const order = [];
const state = new Map(); // path -> "visiting" | "done"
function visit(file, stack) {
  const s = state.get(file);
  if (s === "done") return;
  if (s === "visiting") {
    console.error("build: import cycle: " + [...stack, file].map((f) => relative(ROOT, f)).join(" -> "));
    process.exit(1);
  }
  const mod = modules.get(file);
  if (!mod) {
    console.error(`build: import of unknown module ${relative(ROOT, file)} (from ${stack.map((f) => relative(ROOT, f)).join(" -> ")})`);
    process.exit(1);
  }
  state.set(file, "visiting");
  for (const d of mod.deps) visit(d, [...stack, file]);
  state.set(file, "done");
  order.push(file);
}
// Start from the entry so unreachable modules are reported rather than silently bundled.
visit(ENTRY, []);
for (const file of modules.keys()) {
  if (!state.has(file)) {
    console.warn(`build: warning — ${relative(ROOT, file)} is not reachable from src/index.js and was omitted`);
  }
}

// ---- what index.js re-exports becomes the global surface ----
// index.js is a barrel: it imports the names it intends to be public and re-exports them, so the
// import list there is the public surface.
const publicNames = modules.get(ENTRY).exports.slice();
const entryImports = readFileSync(ENTRY, "utf8")
  .split("\n")
  .map((l) => l.match(IMPORT_RE))
  .filter(Boolean)
  .flatMap((m) => m[1].split(",").map((s) => s.trim()).filter(Boolean));
for (const n of entryImports) if (!publicNames.includes(n)) publicNames.push(n);

const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

const parts = [];
parts.push(`/* hyperbolic-map-widget ${version} - https://github.com/jpivarski/hyperbolic-map-widget
 * Built by tools/build.mjs (concatenation in dependency order; no bundler).
 * Generated file - do not edit. Edit src/ and run \`npm run build\`.
 */`);
parts.push(`(function (global) {`);
parts.push(`"use strict";`);
for (const file of order) {
  parts.push(`\n// ===== ${relative(ROOT, file)} =====`);
  parts.push(modules.get(file).body.replace(/\n{3,}/g, "\n\n").trim());
}
parts.push(`\nglobal.${GLOBAL_NAME} = {`);
parts.push(publicNames.map((n) => `  ${n}: ${n},`).join("\n"));
parts.push(`  VERSION: ${JSON.stringify(version)},`);
parts.push(`};`);
parts.push(`})(typeof globalThis !== "undefined" ? globalThis : self);`);

const out = parts.join("\n") + "\n";

// ---- whitespace/comment-only minification (no parser, no mangling) ----
function minify(src) {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const lines = noBlock.split("\n").map((l) => {
    // Only strip a // comment when it cannot be inside a string or regex on that line.
    const i = l.indexOf("//");
    if (i >= 0) {
      const before = l.slice(0, i);
      const quotes = (before.match(/["'`]/g) || []).length;
      if (quotes % 2 === 0 && !before.includes("://")) return before.trimEnd();
    }
    return l.trimEnd();
  });
  return lines.filter((l) => l.trim() !== "").join("\n") + "\n";
}

mkdirSync(DIST, { recursive: true });
writeFileSync(join(DIST, "hyperbolic-map.iife.js"), out);
writeFileSync(join(DIST, "hyperbolic-map.min.js"), minify(out));

// The examples load their own copy so that docs/ works straight from file:// with no build step.
// This copy MUST happen here rather than in the npm "build" script: running `node tools/build.mjs`
// on its own is the natural thing to do, and when the copy lived only in package.json that left
// docs/lib stale. Every browser test then silently measured the OLD bundle -- which cost a full
// debugging cycle chasing a bug that had already been fixed.
mkdirSync(join(ROOT, "docs", "lib"), { recursive: true });
writeFileSync(join(ROOT, "docs", "lib", "hyperbolic-map.iife.js"), out);

const kb = (s) => (s.length / 1024).toFixed(1) + " kB";
console.log(`build: ${order.length} module(s) -> dist/hyperbolic-map.iife.js (${kb(out)}), .min.js (${kb(minify(out))}), docs/lib/`);
console.log(`build: global ${GLOBAL_NAME} exposes ${publicNames.length} name(s): ${publicNames.join(", ")}`);
