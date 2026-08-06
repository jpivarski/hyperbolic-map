// Turns the ledger in notes/math-audit.md into executable assertions.
//
// Each test names the ledger claim it pins. If one of these fails, update the ledger with the new
// evidence rather than loosening the threshold -- the thresholds here are the measured values from
// the audit, not aspirations.

import test from "node:test";
import assert from "node:assert/strict";

import { Isom, localCompanion, movePointToPoint } from "../src/core/isom.js";
import { localToDisk, diskToLocal, localDistance } from "../src/core/coords.js";
import {
  Cap,
  coshHalfDistance,
  screenRadiusToThresholdSquared,
  coshHalfDistanceSquared,
  capMayBeVisible,
  capThreshold,
} from "../src/core/minkowski.js";
import { internalToScreen, diskDistance } from "./legacy-reference.mjs";

// Deterministic PRNG so failures are reproducible.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const uni = (r, lo, hi) => lo + (hi - lo) * r();

test("local radius is sinh(d/2) and the companion is cosh(d/2)", () => {
  const r = rng(1);
  let worstR = 0;
  let worstW = 0;
  for (let i = 0; i < 20000; i++) {
    const x = uni(r, -50, 50);
    const y = uni(r, -50, 50);
    const w = localCompanion(x, y);
    const z = localToDisk(x, y, [0, 0]);
    const d = diskDistance(0, 0, z[0], z[1]);
    const rad = Math.hypot(x, y);
    // At d ~ 10 the float64 oracle's own atanh error dominates, so compare loosely here; the
    // exact statement is proved algebraically (w^2 - r^2 = 1) and was verified in 90-digit
    // arithmetic during the audit.
    worstR = Math.max(worstR, Math.abs(rad - Math.sinh(d / 2)) / Math.sinh(d / 2));
    worstW = Math.max(worstW, Math.abs(w - Math.cosh(d / 2)) / w);
  }
  assert.ok(worstR < 1e-11, `sinh(d/2) rel err ${worstR}`);
  assert.ok(worstW < 1e-11, `cosh(d/2) rel err ${worstW}`);
});

test("the algebraic identity w^2 - r^2 = 1 holds exactly", () => {
  const r = rng(2);
  for (let i = 0; i < 20000; i++) {
    const x = uni(r, -1e4, 1e4);
    const y = uni(r, -1e4, 1e4);
    const w = localCompanion(x, y);
    const err = Math.abs(w * w - (x * x + y * y) - 1) / (w * w);
    assert.ok(err < 1e-15, `det identity rel err ${err} at (${x}, ${y})`);
  }
});

test("projection is the Poincare disk, tanh(d/2), not the Klein disk tanh(d)", () => {
  const z = localToDisk(1, 1, [0, 0]);
  const d = diskDistance(0, 0, z[0], z[1]);
  const mod = Math.hypot(z[0], z[1]);
  assert.ok(Math.abs(mod - Math.tanh(d / 2)) < 1e-12);
  assert.ok(Math.abs(mod - Math.tanh(d)) > 1e-3, "must not coincide with the Klein model");
});

test("disk <-> local round-trips", () => {
  const r = rng(3);
  for (let i = 0; i < 20000; i++) {
    const x = uni(r, -30, 30);
    const y = uni(r, -30, 30);
    const z = localToDisk(x, y, [0, 0]);
    const back = diskToLocal(z[0], z[1], [0, 0]);
    const e = Math.hypot(back[0] - x, back[1] - y) / Math.max(1, Math.hypot(x, y));
    assert.ok(e < 1e-12, `round-trip rel err ${e}`);
  }
});

test("SU(1,1) group laws", () => {
  const r = rng(4);
  const out = [0, 0];
  for (let i = 0; i < 5000; i++) {
    const m = Isom.rotation(uni(r, -Math.PI, Math.PI)).mul(
      Isom.translationToLocal(uni(r, -3, 3), uni(r, -3, 3)),
    );
    const n = Isom.rotation(uni(r, -Math.PI, Math.PI)).mul(
      Isom.translationToLocal(uni(r, -3, 3), uni(r, -3, 3)),
    );
    // (m n) n^-1 = m
    const composed = m.mul(n).mul(n.inverse());
    assert.ok(Math.abs(composed.detError()) < 1e-9);
    const zx = uni(r, -0.8, 0.8);
    const zy = uni(r, -0.5, 0.5);
    const a = m.applyToDisk(zx, zy, [0, 0]);
    const b = composed.applyToDisk(zx, zy, out);
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-10);
  }
});

test("+M and -M are the same isometry (the double cover)", () => {
  const m = Isom.rotation(0.7).mul(Isom.translationToLocal(1.3, -0.4));
  const neg = new Isom(-m.ar, -m.ai, -m.br, -m.bi);
  const a = m.applyToDisk(0.3, 0.21, [0, 0]);
  const b = neg.applyToDisk(0.3, 0.21, [0, 0]);
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-15);
});

test("the fused kernel equals the 2011 internalToScreen where that is well conditioned", () => {
  const r = rng(5);
  let worst = 0;
  const out = [0, 0];
  for (let i = 0; i < 20000; i++) {
    const bx = uni(r, -5, 5);
    const by = uni(r, -5, 5);
    const rot = uni(r, -Math.PI, Math.PI);
    const x = uni(r, -5, 5);
    const y = uni(r, -5, 5);
    const m = Isom.fromLegacyView(bx, by, rot);
    m.applyToLocal(x, y, undefined, out);
    const ref = internalToScreen(x, y, bx, by, rot);
    worst = Math.max(worst, Math.hypot(out[0] - ref[0], out[1] - ref[1]));
  }
  assert.ok(worst < 1e-10, `max abs err ${worst}`);
});

test("the fused kernel survives the far dungeon point where the 2011 polynomial does not", () => {
  // Ledger: recentring on (0, 11711.92) (d ~ 20.1) puts the point at the disk CENTRE. The 2011
  // polynomial lands it on the boundary instead -- 310 px wrong on a 620 px canvas.
  const x = 0;
  const y = 11711.92;
  const m = Isom.translationToLocal(x, y).inverse();
  const out = m.applyToLocal(x, y, undefined, [0, 0]);
  const ours = Math.hypot(out[0], out[1]);
  const ref = internalToScreen(x, y, -x, -y, 0);
  const theirs = Math.hypot(ref[0], ref[1]);
  assert.ok(ours < 1e-9, `expected the point at the disk centre, got radius ${ours}`);
  assert.ok(theirs > 0.5, `expected the legacy formula to fail here, but it gave radius ${theirs}`);
});

test("isometries preserve hyperbolic distance", () => {
  const r = rng(6);
  let worst = 0;
  for (let i = 0; i < 10000; i++) {
    const m = Isom.rotation(uni(r, -Math.PI, Math.PI)).mul(
      Isom.translationToLocal(uni(r, -4, 4), uni(r, -4, 4)),
    );
    const p = [uni(r, -4, 4), uni(r, -4, 4)];
    const q = [uni(r, -4, 4), uni(r, -4, 4)];
    const a = m.applyToLocal(p[0], p[1], undefined, [0, 0]);
    const b = m.applyToLocal(q[0], q[1], undefined, [0, 0]);
    const before = localDistance(p[0], p[1], q[0], q[1]);
    const after = diskDistance(a[0], a[1], b[0], b[1]);
    worst = Math.max(worst, Math.abs(before - after));
  }
  assert.ok(worst < 1e-9, `max distance distortion ${worst}`);
});

test("movePointToPoint carries p to f", () => {
  const r = rng(7);
  let worst = 0;
  for (let i = 0; i < 20000; i++) {
    const px = uni(r, -0.9, 0.9);
    const py = uni(r, -0.9, 0.9);
    const fx = uni(r, -0.9, 0.9);
    const fy = uni(r, -0.9, 0.9);
    if (Math.hypot(px, py) > 0.95 || Math.hypot(fx, fy) > 0.95) continue;
    const m = movePointToPoint(px, py, fx, fy);
    const out = m.applyToDisk(px, py, [0, 0]);
    worst = Math.max(worst, Math.hypot(out[0] - fx, out[1] - fy));
  }
  assert.ok(worst < 1e-10, `max err ${worst}`);
});

test("normalize lands on the manifold by construction, even at large |b|", () => {
  const r = rng(8);
  let worst = 0;
  for (let i = 0; i < 20000; i++) {
    const m = Isom.rotation(uni(r, -Math.PI, Math.PI)).mul(
      Isom.translationToLocal(uni(r, -3e4, 3e4), uni(r, -3e4, 3e4)),
    );
    const before = m.applyToDisk(0.4, -0.2, [0, 0]);
    m.normalize();
    const after = m.applyToDisk(0.4, -0.2, [0, 0]);
    // The constructive statement: |a| == sqrt(1 + |b|^2). Checking detError() instead would be
    // measuring a difference of two numbers near 5e8, which cannot resolve better than ~1e-7.
    const modA = Math.hypot(m.ar, m.ai);
    const modB = Math.hypot(m.br, m.bi);
    worst = Math.max(worst, Math.abs(modA - Math.sqrt(1 + modB * modB)) / modA);
    assert.ok(Math.hypot(before[0] - after[0], before[1] - after[1]) < 1e-9, "action changed");
  }
  assert.ok(worst < 1e-15, `|a| vs sqrt(1+|b|^2) rel err ${worst}`);
});

test("north() equals the 2011 halfPlaneOrientation", async () => {
  const { halfPlaneOrientation } = await import("./legacy-reference.mjs");
  const r = rng(9);
  let worst = 0;
  for (let i = 0; i < 10000; i++) {
    const bx = uni(r, -4, 4);
    const by = uni(r, -4, 4);
    const rot = uni(r, -Math.PI, Math.PI);
    const mine = Isom.fromLegacyView(bx, by, rot).north();
    const theirs = halfPlaneOrientation(bx, by, rot);
    // halfPlaneOrientation returns a line direction, so it is only defined mod pi.
    let d = ((mine - theirs + Math.PI) % (2 * Math.PI)) - Math.PI;
    d = Math.min(Math.abs(d), Math.abs(Math.abs(d) - Math.PI));
    worst = Math.max(worst, d);
  }
  assert.ok(worst < 1e-9, `max bearing err ${worst} rad`);
});

test("cosh(d/2) needs the MODULUS, not just the real part", () => {
  const r = rng(10);
  let worstModulus = 0;
  let worstRealOnly = 0;
  for (let i = 0; i < 20000; i++) {
    const p = [uni(r, -4, 4), uni(r, -4, 4)];
    const q = [uni(r, -4, 4), uni(r, -4, 4)];
    const w1 = localCompanion(p[0], p[1]);
    const w2 = localCompanion(q[0], q[1]);
    const ref = Math.cosh(localDistance(p[0], p[1], q[0], q[1]) / 2);
    const modulus = coshHalfDistance(p[0], p[1], w1, q[0], q[1], w2);
    const realOnly = w1 * w2 - p[0] * q[0] - p[1] * q[1];
    worstModulus = Math.max(worstModulus, Math.abs(modulus - ref) / ref);
    worstRealOnly = Math.max(worstRealOnly, Math.abs(realOnly - ref));
  }
  assert.ok(worstModulus < 1e-9, `modulus form rel err ${worstModulus}`);
  // Pin the defect so nobody "simplifies" back to the real part.
  assert.ok(worstRealOnly > 1, `real-part-only form should be badly wrong, was off by ${worstRealOnly}`);
});

test("the in-disk visibility test is exact", () => {
  const r = rng(11);
  let disagreements = 0;
  for (let i = 0; i < 40000; i++) {
    const tau = uni(r, 0.4, 0.97);
    const cx = uni(r, -0.85, 0.85);
    const cy = uni(r, -0.85, 0.85);
    if (Math.hypot(cx, cy) >= 0.85) continue;
    const px = uni(r, -0.99, 0.99);
    const py = uni(r, -0.99, 0.99);
    if (Math.hypot(px, py) >= 0.99) continue;
    // ground truth: move the view centre to the origin, then compare |z| with tau
    const view = Isom.translationToDisk(cx, cy).inverse();
    const z = view.applyToDisk(px, py, [0, 0]);
    const truth = Math.hypot(z[0], z[1]) < tau;

    const pl = diskToLocal(px, py, [0, 0]);
    const cl = diskToLocal(cx, cy, [0, 0]);
    const test =
      coshHalfDistanceSquared(
        pl[0], pl[1], localCompanion(pl[0], pl[1]),
        cl[0], cl[1], localCompanion(cl[0], cl[1]),
      ) < screenRadiusToThresholdSquared(tau);
    if (truth !== test) disagreements++;
  }
  assert.equal(disagreements, 0);
});

test("cap rejection never rejects an overlapping cap", () => {
  const r = rng(12);
  let falseRejections = 0;
  for (let i = 0; i < 40000; i++) {
    const tau = uni(r, 0.4, 0.95);
    const cl = [uni(r, -2, 2), uni(r, -2, 2)];
    const ql = [uni(r, -3, 3), uni(r, -3, 3)];
    const capRadius = uni(r, 0.01, 2.5);
    const cap = new Cap(ql[0], ql[1], capRadius);
    const cw = localCompanion(cl[0], cl[1]);
    const visible = capMayBeVisible(cap, cl[0], cl[1], cw, capThreshold(tau, capRadius));
    const rho = 2 * Math.atanh(tau);
    const overlaps = localDistance(ql[0], ql[1], cl[0], cl[1]) <= rho + capRadius + 1e-12;
    if (!visible && overlaps) falseRejections++;
  }
  assert.equal(falseRejections, 0);
});

test("Cap.enclosing actually encloses", () => {
  const r = rng(13);
  for (let trial = 0; trial < 400; trial++) {
    const n = 3 + Math.floor(uni(r, 0, 12));
    const xs = [];
    const ys = [];
    for (let i = 0; i < n; i++) {
      xs.push(uni(r, -6, 6));
      ys.push(uni(r, -6, 6));
    }
    const cap = Cap.enclosing(xs, ys, 0, n);
    for (let i = 0; i < n; i++) {
      const d = localDistance(cap.x, cap.y, xs[i], ys[i]);
      assert.ok(d <= cap.radius + 1e-9, `point ${i} at ${d} outside cap radius ${cap.radius}`);
    }
  }
});
