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
import { diskDistance, wrapAngle } from "./helpers.mjs";

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

test("REGRESSION: recentring on a far point puts it exactly at the disk center", () => {
  // Ledger: the dungeon reaches (0, 11711.92), d ~ 20.1. Expanding the projection into a polynomial
  // in the offset lands this on the boundary instead -- 310 px wrong on a 620 px canvas -- because
  // the terms that must cancel are each of order y^2 while their difference is O(1).
  //
  // The center assertion is exact at any magnitude: the recentered point is a fixed point, so there
  // is nothing left to cancel. The neighbor assertion is where the conditioning shows, and it is
  // checked against the LAW rather than a flat tolerance -- error ~ eps * w^2, where w = cosh(d/2)
  // is the largest matrix entry. That is the whole reason single-patch mode has a usable range at
  // all (it runs out near w ~ 1e8, where the products reach 1e16 and the answer is 0/0), and the
  // reason the atlas never forms a global frame. Measured ratios to eps*w^2 over the cases below:
  // 0.93, 0.93, 0.44, 0.49 -- a bound of 4x is real headroom, not a rubber stamp.
  const EPS = Number.EPSILON;
  for (const [x, y] of [[0, 11711.92], [0, -11711.92], [8000, 8000], [1e6, -3e6]]) {
    const t = Isom.translationToLocal(x, y);
    const m = t.inverse();

    const out = m.applyToLocal(x, y, undefined, [0, 0]);
    assert.ok(
      Math.hypot(out[0], out[1]) < 1e-9,
      `recentered on (${x}, ${y}) but it landed at radius ${Math.hypot(out[0], out[1])}`,
    );

    // And it is genuinely the isometry that moved it, not a collapse of everything onto the origin:
    // a point at hyperbolic distance 1 from there must come back at radius tanh(1/2).
    const away = t.applyToLocal(Math.sinh(0.5), 0, undefined, [0, 0]);
    const awayLocal = diskToLocal(away[0], away[1], [0, 0]);
    const back = m.applyToLocal(awayLocal[0], awayLocal[1], undefined, [0, 0]);
    const r = Math.hypot(back[0], back[1]);
    const w2 = 1 + x * x + y * y;
    const tol = Math.max(1e-12, 4 * EPS * w2);
    assert.ok(
      Math.abs(r - Math.tanh(0.5)) < tol,
      `at (${x}, ${y}) a unit-distance neighbor landed at radius ${r}, ` +
        `expected ${Math.tanh(0.5)} to within ${tol}`,
    );
  }
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

test("north() is the screen bearing of the ideal point straight up", () => {
  // north() is applyToIdeal(0, 1), i.e. where the boundary point at the top of the disk has been
  // carried to. Checked three ways: the two cases where the answer is known exactly, and against
  // an independent route -- applyToLocal on a point far out along that same geodesic, which must
  // converge to the same bearing.
  assert.ok(Math.abs(new Isom(1, 0, 0, 0).north() - Math.PI / 2) < 1e-15, "identity should look north");

  const r = rng(9);
  for (let i = 0; i < 200; i++) {
    const rot = uni(r, -Math.PI, Math.PI);
    // A pure rotation of the view turns the bearing to every ideal point by the same angle.
    const got = Isom.rotation(rot).north();
    const want = wrapAngle(Math.PI / 2 + rot);
    assert.ok(Math.abs(wrapAngle(got - want)) < 1e-12, `rotation ${rot}: north ${got}, expected ${want}`);
  }

  let worst = 0;
  for (let i = 0; i < 10000; i++) {
    const bx = uni(r, -4, 4);
    const by = uni(r, -4, 4);
    const rot = uni(r, -Math.PI, Math.PI);
    const m = Isom.fromOffsetRotation(bx, by, rot);
    const far = m.applyToLocal(0, 1e9, undefined, [0, 0]);
    const viaLimit = Math.atan2(far[1], far[0]);
    worst = Math.max(worst, Math.abs(wrapAngle(m.north() - viaLimit)));
  }
  assert.ok(worst < 1e-6, `north() disagrees with the far-point limit by ${worst} rad`);
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
    // ground truth: move the view center to the origin, then compare |z| with tau
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

test("normalize is stable across the whole representable range", () => {
  // Spot-check both branches of the diagonal rebuild, across the whole USABLE range.
  //
  // The usable ceiling is set by the ACTION, not the representation. applyTo* forms
  // dr*dr + di*di, which overflows once the matrix entries pass ~1e154, i.e. cosh(d/2) ~ 1e154,
  // i.e. hyperbolic distance ~710 -- half the ~1420 at which the entries themselves overflow.
  // Beyond that the result is NaN rather than merely imprecise.
  //
  // Rescaling the denominator would fix it at the cost of two divisions per point in the hottest
  // loop in the library, which is not a trade worth making for distances no data can reach: e^710
  // is past any conceivable map, and the dungeon's own extreme is 20. Documented rather than fixed;
  // if that ever changes, scale by max(|dr|, |di|) before dividing.
  for (const d of [0, 1e-8, 1, 10, 20, 37, 40, 100, 400, 700]) {
    const m = Isom.translation(d, 0.7).mul(Isom.rotation(0.3));
    const beforeCenter = m.applyToDisk(0.2, -0.1, [0, 0]);
    m.normalize();
    const afterCenter = m.applyToDisk(0.2, -0.1, [0, 0]);
    assert.ok(Number.isFinite(m.ar) && Number.isFinite(m.br), `not finite at d = ${d}`);
    const modA = Math.hypot(m.ar, m.ai);
    const modB = Math.hypot(m.br, m.bi);
    // The constructive manifold condition.
    const rel = Math.abs(modA - Math.sqrt(1 + modB * modB)) / modA;
    assert.ok(rel < 1e-15, `off-manifold by ${rel} at d = ${d}`);
    // And the action must not have moved.
    assert.ok(
      Math.hypot(beforeCenter[0] - afterCenter[0], beforeCenter[1] - afterCenter[1]) < 1e-12,
      `normalize changed the action at d = ${d}`,
    );
    if (d > 0) assert.ok(Math.abs(m.distanceMoved() - d) / d < 1e-9, `distance drifted at d = ${d}`);
  }
});
