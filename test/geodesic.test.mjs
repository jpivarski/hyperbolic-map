// Geodesic arcs, checked against first principles AND against the 2011 edge computation.
//
// The differential test here exists because I got the sweep sense backwards on the first attempt:
// the canvas y-flip negates the angles, which also reverses the sweep direction, so every arc took
// the MAJOR arc and swept outside the disk. It is the kind of error that unit tests on the circle
// parameters alone would not catch, because the circle was right -- only the direction was wrong.

import test from "node:test";
import assert from "node:assert/strict";

import { geodesicArc, Arc } from "../src/render/geodesic.js";

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const uni = (r, lo, hi) => lo + (hi - lo) * r();

// The 2011 arc computation, verbatim from HyperbolicViewport.js:806-827, which worked. Angles are
// already in the canvas (y-down) frame there.
function legacyEdge(x1, y1, x2, y2) {
  const denom = x1 * y2 - x2 * y1;
  const dist2 = (x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2);
  if (!(Math.abs(denom) > 1e-10) || !(dist2 > 0.01)) return null;
  const a = (-x1 * x1 * y2 + x2 * x2 * y1 - y1 * y1 * y2 + y1 * y2 * y2 + y1 - y2) / denom;
  const b = (x1 * x1 * x2 - x1 * x2 * x2 - x1 * y2 * y2 - x1 + x2 * y1 * y1 + x2) / denom;
  const cx = -0.5 * a;
  const cy = -0.5 * b;
  const r2 = -1 + 0.25 * (a * a + b * b);
  const phi1 = -Math.atan2(y1 - cy, x1 - cx);
  const phi2 = -Math.atan2(y2 - cy, x2 - cx);
  let deltaphi = phi1 - phi2;
  while (deltaphi >= Math.PI) deltaphi -= 2 * Math.PI;
  while (deltaphi < -Math.PI) deltaphi += 2 * Math.PI;
  return { cx, cy, r: Math.sqrt(r2), phi1, phi2, anticlockwise: deltaphi > 0 };
}

test("the arc circle is orthogonal to the unit circle and passes through both points", () => {
  const r = rng(31);
  const out = new Arc();
  let checked = 0;
  for (let i = 0; i < 50000; i++) {
    const x1 = uni(r, -0.98, 0.98);
    const y1 = uni(r, -0.98, 0.98);
    const x2 = uni(r, -0.98, 0.98);
    const y2 = uni(r, -0.98, 0.98);
    if (Math.hypot(x1, y1) >= 0.98 || Math.hypot(x2, y2) >= 0.98) continue;
    geodesicArc(x1, y1, x2, y2, out, 0, 0);
    if (out.straight) continue;
    checked++;
    // Orthogonality: d^2 = r^2 + 1. Tolerances must be RELATIVE: when the two points are nearly
    // collinear with the origin the geodesic is nearly a diameter, so the orthogonal circle's
    // radius runs to millions and an absolute tolerance is meaningless. (Measured worst case:
    // r = 2.8e6, relative residual 1.3e-16.) Such edges are visually straight anyway, and the
    // sagitta test in the renderer turns them into lines.
    const d2 = out.cx * out.cx + out.cy * out.cy;
    const scale = out.r * out.r + 1;
    assert.ok(Math.abs(d2 - scale) / scale < 1e-12, "not orthogonal to the unit circle");
    assert.ok(Math.abs(Math.hypot(x1 - out.cx, y1 - out.cy) - out.r) / out.r < 1e-12, "misses point 1");
    assert.ok(Math.abs(Math.hypot(x2 - out.cx, y2 - out.cy) - out.r) / out.r < 1e-12, "misses point 2");
  }
  assert.ok(checked > 20000, `only ${checked} arcs exercised`);
});

test("the sweep matches the 2011 canvas parameters exactly (sweep sense included)", () => {
  const r = rng(32);
  const out = new Arc();
  let checked = 0;
  for (let i = 0; i < 50000; i++) {
    const x1 = uni(r, -0.95, 0.95);
    const y1 = uni(r, -0.95, 0.95);
    const x2 = uni(r, -0.95, 0.95);
    const y2 = uni(r, -0.95, 0.95);
    if (Math.hypot(x1, y1) >= 0.95 || Math.hypot(x2, y2) >= 0.95) continue;
    const legacy = legacyEdge(x1, y1, x2, y2);
    // Match the legacy short-edge rule so the comparison is like for like.
    geodesicArc(x1, y1, x2, y2, out, 0.1, 0);
    if (legacy === null) {
      assert.ok(out.straight, "we drew an arc where 2011 drew a line");
      continue;
    }
    assert.ok(!out.straight, "we drew a line where 2011 drew an arc");
    checked++;
    assert.ok(Math.abs(out.cx - legacy.cx) < 1e-9);
    assert.ok(Math.abs(out.cy - legacy.cy) < 1e-9);
    assert.ok(Math.abs(out.r - legacy.r) < 1e-9);
    // Our angles are in the maths frame; the renderer negates them for canvas.
    assert.ok(Math.abs(-out.startAngle - legacy.phi1) < 1e-9, "start angle");
    assert.ok(Math.abs(-out.endAngle - legacy.phi2) < 1e-9, "end angle");
    assert.equal(out.anticlockwise, legacy.anticlockwise, "SWEEP SENSE");
  }
  assert.ok(checked > 10000, `only ${checked} arcs compared`);
});

test("the swept arc stays inside the unit disk", () => {
  // This is the property the sweep-sense bug violated: taking the major arc sends the curve outside
  // the disk, which on screen looked like fish scattered across the whole canvas.
  const r = rng(33);
  const out = new Arc();
  let checked = 0;
  for (let i = 0; i < 20000; i++) {
    const x1 = uni(r, -0.9, 0.9);
    const y1 = uni(r, -0.9, 0.9);
    const x2 = uni(r, -0.9, 0.9);
    const y2 = uni(r, -0.9, 0.9);
    if (Math.hypot(x1, y1) >= 0.9 || Math.hypot(x2, y2) >= 0.9) continue;
    geodesicArc(x1, y1, x2, y2, out, 0, 0);
    if (out.straight) continue;
    checked++;
    // Walk the arc the way canvas would and check every sample is inside the disk.
    let a0 = out.startAngle;
    let a1 = out.endAngle;
    // In the maths frame, anticlockwise (in canvas terms) means increasing theta.
    if (out.anticlockwise) {
      while (a1 < a0) a1 += 2 * Math.PI;
    } else {
      while (a1 > a0) a1 -= 2 * Math.PI;
    }
    const steps = 24;
    for (let s = 0; s <= steps; s++) {
      const t = a0 + ((a1 - a0) * s) / steps;
      const px = out.cx + out.r * Math.cos(t);
      const py = out.cy + out.r * Math.sin(t);
      assert.ok(
        Math.hypot(px, py) <= 1 + 1e-9,
        `arc left the disk at |z| = ${Math.hypot(px, py)} (endpoints (${x1},${y1})-(${x2},${y2}))`,
      );
    }
  }
  assert.ok(checked > 5000, `only ${checked} arcs walked`);
});

test("points collinear with the origin give a straight diameter, not an arc", () => {
  const out = new Arc();
  for (const theta of [0, 0.7, -2.1, Math.PI / 2]) {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    geodesicArc(0.8 * c, 0.8 * s, -0.6 * c, -0.6 * s, out, 0, 0);
    assert.ok(out.straight, "the geodesic through the origin is a diameter");
  }
});

test("the sagitta test only straightens edges that are visually straight", () => {
  const out = new Arc();
  const r = rng(34);
  for (let i = 0; i < 20000; i++) {
    const x1 = uni(r, -0.9, 0.9);
    const y1 = uni(r, -0.9, 0.9);
    const x2 = uni(r, -0.9, 0.9);
    const y2 = uni(r, -0.9, 0.9);
    if (Math.hypot(x1, y1) >= 0.9 || Math.hypot(x2, y2) >= 0.9) continue;
    const tol = 1e-3;
    const exact = geodesicArc(x1, y1, x2, y2, new Arc(), 0, 0);
    const approx = geodesicArc(x1, y1, x2, y2, out, 0, tol);
    if (exact.straight || !approx.straight) continue;
    // It chose to straighten: verify the true sagitta really is within tolerance.
    const chord = Math.hypot(x1 - x2, y1 - y2);
    const sagitta = exact.r - Math.sqrt(Math.max(0, exact.r * exact.r - 0.25 * chord * chord));
    assert.ok(sagitta <= tol + 1e-12, `straightened an edge whose sagitta is ${sagitta} > ${tol}`);
  }
});
