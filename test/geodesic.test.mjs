// Geodesic arcs, checked against first principles.
//
// The sweep-sense test earns its length. The sweep was backwards on the first attempt: the canvas
// y-flip negates the angles, which also reverses the sweep direction, so every arc took the MAJOR
// arc and swept outside the disk. Tests on the circle PARAMETERS alone cannot catch that -- the
// circle was right, only the direction was wrong -- so the test below reconstructs the sweep the way
// canvas would walk it, and carries a negative control proving the opposite sense would fail.

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
    geodesicArc(x1, y1, x2, y2, out, 0);
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

// Reconstruct the walk canvas performs for ctx.arc(cx, cy, r, -start, -end, anticlockwise), back in
// the math frame. Canvas sweeps from start to end in INCREASING canvas-angle unless anticlockwise,
// and canvas angles are the negation of ours -- so `anticlockwise` means increasing math angle.
function sweepExtent(arc, flip) {
  const a0 = arc.startAngle;
  let a1 = arc.endAngle;
  if (arc.anticlockwise !== flip) {
    while (a1 < a0) a1 += 2 * Math.PI;
  } else {
    while (a1 > a0) a1 -= 2 * Math.PI;
  }
  return [a0, a1];
}

test("the sweep runs from p1 to p2 the short way round (SWEEP SENSE)", () => {
  const r = rng(32);
  const out = new Arc();
  let checked = 0;
  let controlFailures = 0;
  for (let i = 0; i < 50000; i++) {
    const x1 = uni(r, -0.95, 0.95);
    const y1 = uni(r, -0.95, 0.95);
    const x2 = uni(r, -0.95, 0.95);
    const y2 = uni(r, -0.95, 0.95);
    if (Math.hypot(x1, y1) >= 0.95 || Math.hypot(x2, y2) >= 0.95) continue;
    geodesicArc(x1, y1, x2, y2, out, 0);
    if (out.straight) continue;
    checked++;

    const [a0, a1] = sweepExtent(out, false);

    // 1. It starts at p1 and ends at p2, in that order -- not the other way round.
    const s0 = [out.cx + out.r * Math.cos(a0), out.cy + out.r * Math.sin(a0)];
    const s1 = [out.cx + out.r * Math.cos(a1), out.cy + out.r * Math.sin(a1)];
    assert.ok(Math.hypot(s0[0] - x1, s0[1] - y1) < 1e-9 * Math.max(1, out.r), "sweep does not start at p1");
    assert.ok(Math.hypot(s1[0] - x2, s1[1] - y2) < 1e-9 * Math.max(1, out.r), "sweep does not end at p2");

    // 2. It takes the MINOR arc. A geodesic chord subtends less than a half turn of its orthogonal
    //    circle, so the extent is strictly under pi; the major arc is exactly the old bug.
    const extent = Math.abs(a1 - a0);
    assert.ok(extent < Math.PI + 1e-9, `swept the major arc: extent ${extent} rad`);

    // 3. NEGATIVE CONTROL. Flipping the sense must break something, or this test blesses anything.
    //    The flipped walk covers 2*pi - extent, so it must exceed pi and must leave the disk (the
    //    orthogonal circle meets the unit circle, so its far side is outside).
    const [f0, f1] = sweepExtent(out, true);
    let flippedLeftDisk = false;
    for (let k = 0; k <= 24; k++) {
      const t = f0 + ((f1 - f0) * k) / 24;
      if (Math.hypot(out.cx + out.r * Math.cos(t), out.cy + out.r * Math.sin(t)) > 1 + 1e-9) {
        flippedLeftDisk = true;
        break;
      }
    }
    if (flippedLeftDisk && Math.abs(f1 - f0) > Math.PI - 1e-9) controlFailures++;
  }
  assert.ok(checked > 10000, `only ${checked} arcs swept`);
  // The control must fire on essentially every arc. If it did not, the assertions above are vacuous.
  assert.ok(
    controlFailures > checked * 0.99,
    `NEGATIVE CONTROL: reversing the sweep was detectably wrong on only ${controlFailures}/${checked} arcs`,
  );
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
    geodesicArc(x1, y1, x2, y2, out, 0);
    if (out.straight) continue;
    checked++;
    // Walk the arc the way canvas would and check every sample is inside the disk.
    let a0 = out.startAngle;
    let a1 = out.endAngle;
    // In the math frame, anticlockwise (in canvas terms) means increasing theta.
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
    geodesicArc(0.8 * c, 0.8 * s, -0.6 * c, -0.6 * s, out, 0);
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
    const exact = geodesicArc(x1, y1, x2, y2, new Arc(), 0);
    const approx = geodesicArc(x1, y1, x2, y2, out, tol);
    if (exact.straight || !approx.straight) continue;
    // It chose to straighten: verify the true sagitta really is within tolerance.
    const chord = Math.hypot(x1 - x2, y1 - y2);
    const sagitta = exact.r - Math.sqrt(Math.max(0, exact.r * exact.r - 0.25 * chord * chord));
    assert.ok(sagitta <= tol + 1e-12, `straightened an edge whose sagitta is ${sagitta} > ${tol}`);
  }
});
