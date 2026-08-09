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
import { RegularTiling } from "../src/data/atlas/tiling.js";
import { exactMulCount, resetExactMulCount } from "../src/data/atlas/exactring.js";

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

// ---- naming ----
//
// The other cost in a frame, and the one with a completely different shape: giving each newly reached
// tile its exact global id. It happens once per edge ever traversed and never again, so it does not
// show up in a steady-state frame at all -- it shows up as the first frame, and as the spike when a
// pan crosses into ground never visited. That is what this measures, and why it is timed per tile
// rather than per second.
//
// `exactMulCount` is reported alongside: it is the algorithm's own work counter, so a change that
// speeds this up while leaving the count alone is an arithmetic improvement, and one that moves the
// count has changed what is being computed.
const NAMING = [
  { p: 8, q: 3, frameSymmetry: 4 },
  { p: 7, q: 3 },
  { p: 3, q: 7 },
  { p: 12, q: 3 },
];
const naming = [];
for (const spec of NAMING) {
  const c0 = process.hrtime.bigint();
  const tiling = new RegularTiling(spec);
  const c1 = process.hrtime.bigint();
  resetExactMulCount();
  const seen = new Set([tiling.addressToString(tiling.originAddress())]);
  let frontier = [tiling.originAddress()];
  while (seen.size < 500 && frontier.length) {
    const next = [];
    for (const a of frontier) {
      for (const nb of tiling.neighbors(a)) {
        const k = tiling.addressToString(nb.address);
        if (!seen.has(k)) {
          seen.add(k);
          next.push(nb.address);
        }
      }
    }
    frontier = next;
  }
  const c2 = process.hrtime.bigint();
  naming.push({
    label: `{${spec.p},${spec.q}} m=${spec.frameSymmetry || spec.p}`,
    constructMs: Number(c1 - c0) / 1e6,
    nameMs: Number(c2 - c1) / 1e6,
    tiles: seen.size,
    muls: exactMulCount(),
  });
}

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
console.log("  naming tiles (exact ids; once per tile ever, never per frame)");
for (const n of naming) {
  console.log(
    `  ${n.label.padEnd(12)} build ${n.constructMs.toFixed(1).padStart(6)} ms   ` +
      `name ${n.tiles} tiles ${n.nameMs.toFixed(1).padStart(6)} ms   ` +
      `${n.muls.toLocaleString().padStart(9)} ring muls, ${(n.nameMs * 1e6 / n.muls).toFixed(0).padStart(4)} ns each`,
  );
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
