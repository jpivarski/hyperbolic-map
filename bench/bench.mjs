#!/usr/bin/env node
// Micro-benchmarks for the two hot kernels: point projection and cap culling.
//
// These are the loops that dominate a frame, so they are worth guarding against regression
// independently of whole-frame timing (which needs a browser and a GPU).
//
// READ THIS BEFORE QUOTING ANY NUMBER FROM HERE.
//
// The script prints the machine's load average alongside its results and REFUSES to present them as
// meaningful when the machine is busy. A microbenchmark on a contended machine measures the
// contention. If it says the machine is busy, it is not a soft warning: re-run it later.
//
// Usage:  npm run bench  [-- --force]

import { readFileSync } from "node:fs";
import { Isom, localCompanion } from "../src/core/isom.js";
import { Cap, capMayBeVisible, capThreshold } from "../src/core/minkowski.js";

const FORCE = process.argv.includes("--force");
const CORES = (() => {
  try {
    return readFileSync("/proc/cpuinfo", "utf8").split("\n").filter((l) => l.startsWith("processor")).length || 1;
  } catch {
    return 1;
  }
})();

function loadAverage() {
  try {
    const [one, five, fifteen] = readFileSync("/proc/loadavg", "utf8").split(" ").slice(0, 3).map(Number);
    return { one, five, fifteen };
  } catch {
    return null;
  }
}

function busy(load) {
  // More than a quarter of the cores busy with something else is enough to make these numbers lies.
  return load !== null && load.one > Math.max(1, CORES * 0.25);
}

function timeIt(label, iterations, fn) {
  fn(Math.min(iterations, 10000)); // warm up
  const t0 = process.hrtime.bigint();
  const sink = fn(iterations);
  const t1 = process.hrtime.bigint();
  const ns = Number(t1 - t0);
  return { label, iterations, totalMs: ns / 1e6, perSecond: (iterations / ns) * 1e9, sink };
}

// ---- fixtures ----
const N = 1 << 16;
const xs = new Float64Array(N);
const ys = new Float64Array(N);
const ws = new Float64Array(N);
for (let i = 0; i < N; i++) {
  const t = (i / N) * 2 * Math.PI * 13;
  const r = 0.01 + 6 * (i / N);
  xs[i] = r * Math.cos(t);
  ys[i] = r * Math.sin(t);
  ws[i] = localCompanion(xs[i], ys[i]);
}
const view = Isom.rotation(0.4).mul(Isom.translationToLocal(0.7, -1.3));
const out = [0, 0];

const caps = [];
for (let i = 0; i < N; i += 16) caps.push(new Cap(xs[i], ys[i], 0.2));
const thr = capThreshold(0.9, 0.2);

const results = [
  timeIt("project points (applyToLocal, w precomputed)", 4_000_000, (n) => {
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const j = i & (N - 1);
      view.applyToLocal(xs[j], ys[j], ws[j], out);
      acc += out[0];
    }
    return acc;
  }),
  timeIt("project points (w recomputed each time)", 4_000_000, (n) => {
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const j = i & (N - 1);
      view.applyToLocal(xs[j], ys[j], undefined, out);
      acc += out[0];
    }
    return acc;
  }),
  timeIt("cap culling test", 20_000_000, (n) => {
    let kept = 0;
    const m = caps.length;
    for (let i = 0; i < n; i++) {
      if (capMayBeVisible(caps[i % m], 0.7, -1.3, localCompanion(0.7, -1.3), thr)) kept++;
    }
    return kept;
  }),
  timeIt("compose two isometries", 5_000_000, (n) => {
    const a = Isom.translationToLocal(0.3, 0.4);
    const b = Isom.rotation(0.2);
    const dst = Isom.identity();
    for (let i = 0; i < n; i++) Isom.composeInto(dst, a, b);
    return dst.ar;
  }),
];

const before = loadAverage();
const after = loadAverage();

console.log("");
console.log("hyperbolic-map microbenchmarks");
console.log(`  node ${process.version}, ${CORES} cores`);
if (before) {
  console.log(`  load average ${before.one.toFixed(2)} / ${before.five.toFixed(2)} / ${before.fifteen.toFixed(2)}`);
}
console.log("");

const wide = Math.max(...results.map((r) => r.label.length));
for (const r of results) {
  const per = r.perSecond;
  const rate = per > 1e6 ? `${(per / 1e6).toFixed(1)} M/s` : `${(per / 1e3).toFixed(1)} k/s`;
  console.log(`  ${r.label.padEnd(wide)}  ${rate.padStart(10)}   (${r.totalMs.toFixed(0)} ms for ${r.iterations.toLocaleString()})`);
}
console.log("");

if (busy(after) && !FORCE) {
  console.log("  ** THESE NUMBERS ARE NOT USABLE **");
  console.log(`  Load average is ${after.one.toFixed(2)} on ${CORES} cores: something else is running.`);
  console.log("  A microbenchmark under contention measures the contention. Re-run when idle.");
  console.log("  (Pass --force to suppress this, but do not then quote the numbers.)");
  console.log("");
  process.exitCode = 2;
} else if (before) {
  console.log("  Machine looked idle; numbers should be comparable across runs on this host.");
  console.log("");
}
