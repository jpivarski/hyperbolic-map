#!/usr/bin/env node
// Enforce the source constraints that let tools/build.mjs concatenate src/ into a browser
// bundle without a bundler dependency. Run via `npm run check` (and automatically by `npm run
// build`). If this passes, plain concatenation in dependency order is a valid transform.
//
// The constraints are deliberately narrow. They are not style preferences: each one exists
// because the concatenating builder cannot handle the general case.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");

const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*"([^"]+)"\s*;?$/;
const EXPORT_RE = /^export\s+(?:class|function|const|let|async\s+function)\s+([A-Za-z_$][\w$]*)/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".js")) out.push(p);
  }
  return out;
}

const problems = [];
function fail(file, line, msg) {
  problems.push(`${relative(ROOT, file)}${line ? `:${line}` : ""}  ${msg}`);
}

const files = walk(SRC).sort();
if (files.length === 0) fail(SRC, 0, "no .js files found under src/");

// name -> file that exports it, for cross-module collision detection
const exportedBy = new Map();

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");

  // Whole-file prohibitions. Dynamic import defeats static ordering; top-level await
  // cannot run inside the IIFE wrapper.
  if (/\bimport\s*\(/.test(text)) fail(file, 0, "dynamic import() is not allowed");
  if (/^\s*await\s/m.test(text) && !/^\s*(?:async|\/\/)/m.test(text)) {
    // Cheap check: a top-level `await` at indentation zero.
    lines.forEach((l, i) => {
      if (/^await\s/.test(l)) fail(file, i + 1, "top-level await is not allowed");
    });
  }
  // `export { ... }` lists are allowed ONLY in the barrel (src/index.js), where they are the
  // ESM public surface. tools/build.mjs strips that block for the browser bundle, since the
  // bundle shares one scope and re-export is meaningless there.
  const isBarrel = file === join(SRC, "index.js");
  if (!isBarrel && /^export\s*\{/m.test(text)) {
    lines.forEach((l, i) => {
      if (/^export\s*\{/.test(l)) fail(file, i + 1, "`export { ... }` lists are allowed only in src/index.js; use `export class|function|const|let`");
    });
  }
  if (/^export\s+default\b/m.test(text)) fail(file, 0, "`export default` is not allowed");
  if (/^export\s+\*/m.test(text)) fail(file, 0, "`export *` re-exports are not allowed");

  let seenNonImport = false;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    const n = i + 1;

    if (line.startsWith("import")) {
      const m = raw.match(IMPORT_RE);
      if (!m) {
        fail(file, n, 'import must be a single line of the exact form: import { a, b } from "./path.js";');
        return;
      }
      const spec = m[2];
      if (!spec.startsWith(".")) fail(file, n, `imports must be package-relative, got "${spec}"`);
      if (!spec.endsWith(".js")) fail(file, n, `import specifier must end in .js, got "${spec}"`);
      if (seenNonImport) fail(file, n, "all imports must appear before any other code");
      return;
    }

    if (line !== "" && !line.startsWith("//") && !line.startsWith("*") && !line.startsWith("/*")) {
      seenNonImport = true;
    }

    const em = raw.match(EXPORT_RE);
    if (em) {
      const name = em[1];
      if (exportedBy.has(name)) {
        fail(file, n, `duplicate exported identifier "${name}" (also in ${relative(ROOT, exportedBy.get(name))}) — the bundle shares one scope`);
      } else {
        exportedBy.set(name, file);
      }
    }
  });
}

if (problems.length) {
  console.error(`check-bundle: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error("  " + p);
  console.error(`
These constraints let tools/build.mjs produce the browser bundle by concatenation, with no
bundler dependency. See AGENTS.md.`);
  process.exit(1);
}

console.log(`check-bundle: ok — ${files.length} module(s), ${exportedBy.size} exported name(s), no collisions`);
