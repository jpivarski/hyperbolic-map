// Coordinate conversions.
//
// The last three tests are regressions against real numerical failures: a double cancellation near
// the half-plane basepoint, and a denominator reaching exactly zero inside the dungeon's own data
// range. Each pins the CORRECT closed-form answer at an input where a naive form breaks, so they keep
// their teeth without needing the broken formula to compare against.
//
// Throughout, the comparison is against an independent oracle -- the half-plane -> disk map stated
// directly -- rather than against a rearrangement of the formula being tested.

import test from "node:test";
import assert from "node:assert/strict";

import { halfPlaneToLocal, localToHalfPlane, localToDisk, diskToLocal } from "../src/core/coords.js";
import { halfPlaneToDiskDirect, diskToHalfPlaneDirect } from "./helpers.mjs";

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const uni = (r, lo, hi) => lo + (hi - lo) * r();

// Independent reference: half-plane -> disk -> local, built only from the stated map.
function referenceHalfPlaneToLocal(hx, hy) {
  const z = halfPlaneToDiskDirect(hx, hy);
  const k = 1 / Math.sqrt(1 - z[0] * z[0] - z[1] * z[1]);
  return [z[0] * k, z[1] * k];
}
function referenceLocalToHalfPlane(x, y) {
  const w = Math.sqrt(1 + x * x + y * y);
  return diskToHalfPlaneDirect(x / w, y / w);
}

test("halfPlaneToLocal implements z -> i(z-i)/(z+i), then /sqrt(1-|Z|^2)", () => {
  const r = rng(51);
  let worst = 0;
  for (let i = 0; i < 40000; i++) {
    const x = uni(r, -30, 30);
    const y = Math.exp(uni(r, -3, 3));
    const got = halfPlaneToLocal(x, y, [0, 0]);
    const ref = referenceHalfPlaneToLocal(x, y);
    worst = Math.max(worst, Math.hypot(got[0] - ref[0], got[1] - ref[1]) / Math.max(1, Math.hypot(...ref)));
  }
  // 1e-10 rather than machine precision because the REFERENCE is the weaker side here: it forms
  // 1/sqrt(1 - |Z|^2), which cancels as |Z| approaches 1. The implementation under test avoids that
  // cancellation, so the residual (measured ~1.3e-12) is the oracle's error, not ours.
  assert.ok(worst < 1e-10, `max rel err ${worst}`);
});

test("the landmarks of the half-plane convention", () => {
  // i -> the origin; the point at infinity -> the TOP of the disk; 0 -> the bottom.
  const atI = halfPlaneToLocal(0, 1, [0, 0]);
  assert.ok(Math.hypot(atI[0], atI[1]) < 1e-12, "i must map to the origin");
  const high = localToDisk(...halfPlaneToLocal(0, 1e8, [0, 0]), [0, 0]);
  assert.ok(high[1] > 0.999, `infinity should approach +i, got ${high}`);
  const low = localToDisk(...halfPlaneToLocal(0, 1e-8, [0, 0]), [0, 0]);
  assert.ok(low[1] < -0.999, `0 should approach -i, got ${low}`);
});

test("half-plane <-> local round-trip is limited only by conditioning, not by the formulas", () => {
  // A fixed error threshold is the wrong test here. Converting through the disk necessarily forms
  // 1 - tanh(d/2), whose value falls off like 4*exp(-d), so the best any implementation can do is a
  // relative error of about eps / (1 - tanh(d/2)). That is a property of the disk coordinate, not of
  // the code.
  //
  // So assert against that limit: the measured error must sit within a small multiple of the
  // theoretical floor at every distance. This catches a genuinely bad formula (the 2011 ones are
  // orders of magnitude worse, or infinite) while not pretending precision exists where it cannot.
  //
  // It also quantifies the case for the atlas: at d = 20 the floor is already ~1e-7, and tile-local
  // coordinates simply never get there.
  const r = rng(52);
  let worstRatio = 0;
  let worstErr = 0;
  let worstD = 0;
  for (let i = 0; i < 40000; i++) {
    const x = uni(r, -1e4, 1e4);
    const y = uni(r, -1e4, 1e4);
    const hp = localToHalfPlane(x, y, [0, 0]);
    assert.ok(
      Number.isFinite(hp[0]) && Number.isFinite(hp[1]) && hp[1] > 0,
      `bad half-plane point ${hp} from (${x}, ${y})`,
    );
    const back = halfPlaneToLocal(hp[0], hp[1], [0, 0]);
    const err = Math.hypot(back[0] - x, back[1] - y) / Math.hypot(x, y);
    const d = 2 * Math.asinh(Math.hypot(x, y));
    const floor = Number.EPSILON / (1 - Math.tanh(d / 2));
    if (err / floor > worstRatio) {
      worstRatio = err / floor;
      worstErr = err;
      worstD = d;
    }
  }
  // Measured: about 2x the floor. 500x leaves generous headroom while still being a real bound.
  assert.ok(
    worstRatio < 500,
    `error ${worstErr} at d = ${worstD} is ${worstRatio}x the conditioning floor`,
  );
});

test("half-plane and local round-trip is essentially exact near the origin", () => {
  // Where the conditioning is benign, the formulas must be too.
  const r = rng(522);
  let worst = 0;
  for (let i = 0; i < 20000; i++) {
    const x = uni(r, -2, 2);
    const y = uni(r, -2, 2);
    const hp = localToHalfPlane(x, y, [0, 0]);
    const back = halfPlaneToLocal(hp[0], hp[1], [0, 0]);
    worst = Math.max(worst, Math.hypot(back[0] - x, back[1] - y) / Math.hypot(x, y));
  }
  assert.ok(worst < 1e-14, `max relative round-trip error ${worst}`);
});

test("localToHalfPlane agrees with the independent oracle", () => {
  const r = rng(53);
  let worst = 0;
  for (let i = 0; i < 40000; i++) {
    const x = uni(r, -200, 200);
    const y = uni(r, -200, 200);
    const got = localToHalfPlane(x, y, [0, 0]);
    const ref = referenceLocalToHalfPlane(x, y);
    worst = Math.max(worst, Math.hypot(got[0] - ref[0], got[1] - ref[1]) / Math.max(1e-12, Math.hypot(...ref)));
  }
  assert.ok(worst < 1e-9, `max rel err ${worst}`);
});

test("disk and local round-trip", () => {
  const r = rng(54);
  let worst = 0;
  for (let i = 0; i < 40000; i++) {
    const x = uni(r, -100, 100);
    const y = uni(r, -100, 100);
    const z = localToDisk(x, y, [0, 0]);
    const back = diskToLocal(z[0], z[1], [0, 0]);
    worst = Math.max(worst, Math.hypot(back[0] - x, back[1] - y) / Math.hypot(x, y));
  }
  assert.ok(worst < 1e-10, `max rel err ${worst}`);
});

// ---------------------------------------------------------------------------------------------
// REGRESSIONS. Each pins a value at an input where a plausible formulation breaks down.
// ---------------------------------------------------------------------------------------------

test("REGRESSION: halfPlaneToLocal does not collapse to zero near the basepoint", () => {
  // Subtracting before dividing here loses every significant digit and returns EXACTLY 0.
  for (const eps of [1e-2, 1e-4, 1e-6, 1e-8, 1e-10, 1e-13]) {
    const y = 1 + eps;
    const got = halfPlaneToLocal(0, y, [0, 0]);
    const radius = Math.hypot(got[0], got[1]);
    const expected = Math.sinh(Math.abs(Math.log(y)) / 2);
    assert.ok(radius > 0, `returned exactly zero at y = 1 + ${eps}`);
    assert.ok(
      Math.abs(radius - expected) / expected < 1e-12,
      `at y = 1 + ${eps}: got ${radius}, expected ${expected}`,
    );
  }
});

test("REGRESSION: localToHalfPlane stays finite inside the dungeon's data range", () => {
  // The dungeon data reaches y = 11711.92, and a denominator written as a difference of large
  // like-signed terms reaches exactly 0.0 by y ~ 1e4 -- silently, as Infinity rather than an error.
  for (const y of [1e4, 11711.92, 1e6, 1e8]) {
    const got = localToHalfPlane(0, y, [0, 0]);
    assert.ok(Number.isFinite(got[1]) && got[1] > 0, `not finite at y = ${y}: ${got}`);
    // On the imaginary axis the half-plane height is exactly e^d with d = 2 asinh(y).
    const expected = Math.exp(2 * Math.asinh(y));
    assert.ok(Math.abs(got[1] - expected) / expected < 1e-12, `at y = ${y}: got ${got[1]}, expected ${expected}`);
  }
  for (const y of [-1e4, -1e8]) {
    const got = localToHalfPlane(0, y, [0, 0]);
    assert.ok(Number.isFinite(got[1]) && got[1] > 0, `not finite at y = ${y}: ${got}`);
  }
});

test("REGRESSION: the far dungeon corner survives a full round trip", () => {
  // Straight through the pipeline the dungeon actually uses: half-plane art -> local -> back.
  const size = Math.pow(2, -20);
  for (const [hx, hy] of [[size * 0.5, size], [size * 1.5, 2 * size], [1e6, 4e6]]) {
    const local = halfPlaneToLocal(hx, hy, [0, 0]);
    assert.ok(Number.isFinite(local[0]) && Number.isFinite(local[1]), `local not finite for (${hx}, ${hy})`);
    const back = localToHalfPlane(local[0], local[1], [0, 0]);
    const err = Math.hypot(back[0] - hx, back[1] - hy) / Math.hypot(hx, hy);
    assert.ok(err < 1e-9, `round trip for (${hx}, ${hy}) off by ${err}`);
  }
});
