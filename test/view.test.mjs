// Gesture solvers, tested differentially against the verbatim 2011 port where a 2011 equivalent
// exists, and against first principles where it does not.

import test from "node:test";
import assert from "node:assert/strict";

import { Isom } from "../src/core/isom.js";
import { ViewState, ROTATION_COMPASS } from "../src/core/view.js";
import { updateCoordinates, halfPlaneOrientation, diskDistance } from "./legacy-reference.mjs";

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const uni = (r, lo, hi) => lo + (hi - lo) * r();
function wrap(x) {
  let y = x % (2 * Math.PI);
  if (y > Math.PI) y -= 2 * Math.PI;
  if (y < -Math.PI) y += 2 * Math.PI;
  return y;
}

test("pan matches the 2011 updateCoordinates exactly, in action and in rotation", () => {
  const r = rng(21);
  let worstAction = 0;
  let worstRot = 0;
  let n = 0;
  for (let i = 0; i < 8000; i++) {
    const bx = uni(r, -3, 3);
    const by = uni(r, -3, 3);
    const rot = uni(r, -Math.PI, Math.PI);
    const f0x = uni(r, -0.8, 0.8);
    const f0y = uni(r, -0.8, 0.8);
    const fx = uni(r, -0.8, 0.8);
    const fy = uni(r, -0.8, 0.8);
    if (Math.hypot(f0x, f0y) >= 0.8 || Math.hypot(fx, fy) >= 0.8) continue;
    n++;

    const view = new ViewState({ offsetX: bx, offsetY: by, rotation: rot });
    view.beginPan(f0x, f0y);
    view.updatePan(fx, fy);

    const k = Math.sqrt(1 - f0x * f0x - f0y * f0y);
    const [nbx, nby, nrot] = updateCoordinates(
      bx, by, fx, fy, f0x / k, f0y / k, Math.cos(rot), Math.sin(rot),
    );
    const legacy = Isom.fromLegacyView(nbx, nby, nrot);

    for (const p of [[0.3, -0.2], [1.7, 0.9], [-2.2, 0.4]]) {
      const a = view.liveMatrix.applyToLocal(p[0], p[1], undefined, [0, 0]);
      const b = legacy.applyToLocal(p[0], p[1], undefined, [0, 0]);
      worstAction = Math.max(worstAction, Math.hypot(a[0] - b[0], a[1] - b[1]));
    }
    // screenRotation is 2*arg(a), so the SU(1,1) double cover shows as a 2*pi offset.
    worstRot = Math.max(worstRot, Math.abs(wrap(view.liveMatrix.screenRotation() - nrot)));
  }
  assert.ok(n > 3000, `too few trials: ${n}`);
  assert.ok(worstAction < 1e-10, `max action difference ${worstAction}`);
  assert.ok(worstRot < 1e-9, `max rotation difference ${worstRot}`);
});

test("pan keeps the grabbed data point under the cursor", () => {
  const r = rng(22);
  let worst = 0;
  for (let i = 0; i < 8000; i++) {
    const view = new ViewState({
      offsetX: uni(r, -4, 4),
      offsetY: uni(r, -4, 4),
      rotation: uni(r, -Math.PI, Math.PI),
    });
    const f0x = uni(r, -0.85, 0.85);
    const f0y = uni(r, -0.85, 0.85);
    const fx = uni(r, -0.85, 0.85);
    const fy = uni(r, -0.85, 0.85);
    if (Math.hypot(f0x, f0y) >= 0.85 || Math.hypot(fx, fy) >= 0.85) continue;

    // the data point currently under (f0x, f0y)
    const grabbed = view.matrix.inverse().applyToDisk(f0x, f0y, [0, 0]);
    view.beginPan(f0x, f0y);
    view.updatePan(fx, fy);
    const now = view.liveMatrix.applyToDisk(grabbed[0], grabbed[1], [0, 0]);
    worst = Math.max(worst, Math.hypot(now[0] - fx, now[1] - fy));
  }
  assert.ok(worst < 1e-9, `max drift ${worst}`);
});

test("pan is an isometry: it does not distort distances", () => {
  const r = rng(23);
  let worst = 0;
  for (let i = 0; i < 4000; i++) {
    const view = new ViewState({
      offsetX: uni(r, -3, 3),
      offsetY: uni(r, -3, 3),
      rotation: uni(r, -Math.PI, Math.PI),
    });
    view.beginPan(uni(r, -0.6, 0.6), uni(r, -0.6, 0.6));
    view.updatePan(uni(r, -0.6, 0.6), uni(r, -0.6, 0.6));
    const p = [uni(r, -3, 3), uni(r, -3, 3)];
    const q = [uni(r, -3, 3), uni(r, -3, 3)];
    const before = [
      view.matrix.applyToLocal(p[0], p[1], undefined, [0, 0]),
      view.matrix.applyToLocal(q[0], q[1], undefined, [0, 0]),
    ];
    const after = [
      view.liveMatrix.applyToLocal(p[0], p[1], undefined, [0, 0]),
      view.liveMatrix.applyToLocal(q[0], q[1], undefined, [0, 0]),
    ];
    const d0 = diskDistance(before[0][0], before[0][1], before[1][0], before[1][1]);
    const d1 = diskDistance(after[0][0], after[0][1], after[1][0], after[1][1]);
    worst = Math.max(worst, Math.abs(d0 - d1));
  }
  assert.ok(worst < 1e-9, `max distortion ${worst}`);
});

test("compass mode holds north fixed across a multi-step drag", () => {
  const r = rng(24);
  let worst = 0;
  for (let trial = 0; trial < 500; trial++) {
    const view = new ViewState({
      offsetX: uni(r, -2, 2),
      offsetY: uni(r, -2, 2),
      rotation: uni(r, -Math.PI, Math.PI),
      rotationMode: ROTATION_COMPASS,
    });
    const target = view.northOf(view.matrix);
    view.beginPan(uni(r, -0.6, 0.6), uni(r, -0.6, 0.6));
    for (let step = 0; step < 8; step++) {
      view.updatePan(uni(r, -0.6, 0.6), uni(r, -0.6, 0.6));
      worst = Math.max(worst, Math.abs(wrap(view.north() - target)));
    }
  }
  assert.ok(worst < 1e-9, `north drifted by ${worst} rad`);
});

test("compass north agrees with the 2011 halfPlaneOrientation", () => {
  const r = rng(25);
  let worst = 0;
  for (let i = 0; i < 5000; i++) {
    const bx = uni(r, -4, 4);
    const by = uni(r, -4, 4);
    const rot = uni(r, -Math.PI, Math.PI);
    const view = new ViewState({ offsetX: bx, offsetY: by, rotation: rot });
    const mine = view.north();
    const theirs = halfPlaneOrientation(bx, by, rot);
    // halfPlaneOrientation returns a line direction, defined only mod pi.
    const d = Math.abs(wrap(mine - theirs));
    worst = Math.max(worst, Math.min(d, Math.abs(d - Math.PI)));
  }
  assert.ok(worst < 1e-9, `max bearing difference ${worst} rad`);
});

test("rim rotation turns the view by exactly the angle swept", () => {
  const r = rng(26);
  let worst = 0;
  for (let i = 0; i < 5000; i++) {
    const view = new ViewState({
      offsetX: uni(r, -2, 2),
      offsetY: uni(r, -2, 2),
      rotation: uni(r, -Math.PI, Math.PI),
    });
    const a0 = uni(r, -Math.PI, Math.PI);
    const a1 = uni(r, -Math.PI, Math.PI);
    view.beginRotate(0.95 * Math.cos(a0), 0.95 * Math.sin(a0));
    view.updateRotate(0.92 * Math.cos(a1), 0.92 * Math.sin(a1));
    const got = wrap(view.liveMatrix.screenRotation() - view.matrix.screenRotation());
    worst = Math.max(worst, Math.abs(wrap(got - (a1 - a0))));
  }
  assert.ok(worst < 1e-9, `max rotation error ${worst} rad`);
});

test("zoom clamps to minZoom/maxZoom", () => {
  const view = new ViewState({ zoom: 1, minZoom: 0.5, maxZoom: 10 });
  view.zoomBy(100);
  assert.equal(view.liveZoom, 10);
  view.setZoom(0.001);
  assert.equal(view.liveZoom, 0.5);
  const unbounded = new ViewState({ zoom: 1, minZoom: null, maxZoom: null });
  unbounded.zoomBy(1000);
  assert.equal(unbounded.liveZoom, 1000);
});

test("commit/cancel keep the committed state and the live state separate", () => {
  const view = new ViewState({ offsetX: 0.3, offsetY: -0.2, rotation: 0.4, zoom: 1 });
  const before = view.matrix.clone();
  view.beginPan(0.1, 0.1);
  view.updatePan(0.5, -0.3);
  // committed untouched mid-gesture
  assert.ok(Math.abs(view.matrix.ar - before.ar) < 1e-15);
  view.cancel();
  assert.ok(Math.abs(view.liveMatrix.ar - before.ar) < 1e-15);

  view.beginPan(0.1, 0.1);
  view.updatePan(0.5, -0.3);
  const live = view.liveMatrix.clone();
  view.commit();
  const p = [1.1, -0.7];
  const a = view.matrix.applyToLocal(p[0], p[1], undefined, [0, 0]);
  const b = live.applyToLocal(p[0], p[1], undefined, [0, 0]);
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-12, "commit changed the transform");
  assert.equal(view.gesture, null);
});

test("commit renormalises, so repeated gestures cannot drift off the manifold", () => {
  // A hyperbolic random walk escapes linearly, so 1000 unconstrained pans reach hyperbolic
  // distance ~670 -- far beyond anything a user could do, but a good stress test of the
  // representation. The point of this test is that the OFF-MANIFOLD error stays at machine
  // precision the whole way; growing |a| is expected, drifting off SU(1,1) would not be.
  const r = rng(27);
  const view = new ViewState({ offsetX: 0, offsetY: 0, rotation: 0 });
  let worst = 0;
  for (let i = 0; i < 1000; i++) {
    view.beginPan(uni(r, -0.7, 0.7), uni(r, -0.7, 0.7));
    view.updatePan(uni(r, -0.7, 0.7), uni(r, -0.7, 0.7));
    view.commit();
    const modA = Math.hypot(view.matrix.ar, view.matrix.ai);
    const modB = Math.hypot(view.matrix.br, view.matrix.bi);
    assert.ok(Number.isFinite(modA) && Number.isFinite(modB), `overflowed at gesture ${i}`);
    worst = Math.max(worst, Math.abs(modA - Math.sqrt(1 + modB * modB)) / modA);
  }
  // Measured: ~3e-14 by the end, at |a| ~ 1e145 (a few hundred ulps at that magnitude) and not
  // growing systematically. Threshold set with headroom rather than tuned to just pass.
  assert.ok(worst < 1e-12, `off-manifold by ${worst}`);
});

test("the representation overflows only past hyperbolic distance ~1400", () => {
  // The hard ceiling of a single global patch: |a| = cosh(d/2), and a double overflows at ~1.8e308,
  // so d ~ 2*acosh(1.8e308) ~ 1419. Recorded as a test so the limit is a known quantity rather
  // than a surprise, and because it is one of the structural arguments for the atlas -- tile-local
  // coordinates never form a number anywhere near this.
  const ok = Isom.translation(1400, 0.3);
  assert.ok(Number.isFinite(ok.ar) && Number.isFinite(ok.br), "d = 1400 should still be finite");
  const overflowed = Isom.translation(1440, 0.3);
  assert.ok(!Number.isFinite(overflowed.ar), "d = 1440 is expected to overflow");
  // Well inside the range anything real uses, the round trip is exact.
  const m = Isom.translation(40, 1.1);
  assert.ok(Math.abs(m.distanceMoved() - 40) < 1e-9, `distanceMoved gave ${m.distanceMoved()}`);
});

// ---- checkpoint B: the exact pinch solve ----

test("the pinch pins BOTH fingers exactly", () => {
  // The 2011 version drifted up to 25.7 px per finger on gestures like these. See
  // notes/math-audit.md for why the problem is exactly determined rather than over-determined.
  const r = rng(41);
  let worst = 0;
  let solved = 0;
  for (let i = 0; i < 4000; i++) {
    const view = new ViewState({
      offsetX: uni(r, -1.5, 1.5),
      offsetY: uni(r, -1.5, 1.5),
      rotation: uni(r, -Math.PI, Math.PI),
      zoom: 0.95,
      minZoom: null,
      maxZoom: null,
    });
    // Two fingers a realistic distance apart, then a realistic pinch/twist/slide.
    const cx = uni(r, -0.35, 0.35);
    const cy = uni(r, -0.35, 0.35);
    const sep = uni(r, 0.15, 0.45);
    const th = uni(r, 0, 2 * Math.PI);
    const f1 = [cx + (sep / 2) * Math.cos(th), cy + (sep / 2) * Math.sin(th)];
    const f2 = [cx - (sep / 2) * Math.cos(th), cy - (sep / 2) * Math.sin(th)];
    if (Math.hypot(...f1) > 0.6 || Math.hypot(...f2) > 0.6) continue;
    const sc = uni(r, 0.85, 1.18);
    const dth = uni(r, -0.25, 0.25);
    const mv = [uni(r, -0.06, 0.06), uni(r, -0.06, 0.06)];
    const g1 = [cx + mv[0] + ((sc * sep) / 2) * Math.cos(th + dth), cy + mv[1] + ((sc * sep) / 2) * Math.sin(th + dth)];
    const g2 = [cx + mv[0] - ((sc * sep) / 2) * Math.cos(th + dth), cy + mv[1] - ((sc * sep) / 2) * Math.sin(th + dth)];
    if (Math.hypot(...g1) > 0.7 || Math.hypot(...g2) > 0.7) continue;

    // Where the grabbed data points are, before the gesture.
    const inv = view.matrix.inverse();
    const d1 = inv.applyToDisk(f1[0], f1[1], [0, 0]);
    const d2 = inv.applyToDisk(f2[0], f2[1], [0, 0]);

    view.beginPinch(f1[0], f1[1], f2[0], f2[1]);
    view.updatePinch(g1[0], g1[1], g2[0], g2[1]);
    solved++;

    // Pixel check on a 620 px canvas: the data point must appear where the finger now is.
    const s = view.liveZoom / view.zoom;
    for (const [d, g] of [[d1, g1], [d2, g2]]) {
      const z = view.liveMatrix.applyToDisk(d[0], d[1], [0, 0]);
      const px = Math.hypot(z[0] * view.liveZoom * 310 - g[0] * view.zoom * 310,
                            z[1] * view.liveZoom * 310 - g[1] * view.zoom * 310);
      worst = Math.max(worst, px);
    }
  }
  assert.ok(solved > 500, `only ${solved} pinches exercised`);
  assert.ok(worst < 0.01, `max finger drift ${worst} px`);
});

test("the pinch respects minZoom/maxZoom", () => {
  const view = new ViewState({ zoom: 1, minZoom: 0.9, maxZoom: 1.1 });
  view.beginPinch(-0.1, 0, 0.1, 0);
  view.updatePinch(-0.5, 0, 0.5, 0); // a big spread
  assert.ok(view.liveZoom <= 1.1 + 1e-12, `zoom ${view.liveZoom} exceeded maxZoom`);
  view.beginPinch(-0.4, 0, 0.4, 0);
  view.updatePinch(-0.02, 0, 0.02, 0); // a big squeeze
  assert.ok(view.liveZoom >= 0.9 - 1e-12, `zoom ${view.liveZoom} below minZoom`);
});

test("allowZoom:false in a pinch leaves the zoom alone", () => {
  const view = new ViewState({ zoom: 1, minZoom: null, maxZoom: null });
  view.beginPinch(-0.1, 0, 0.1, 0);
  view.updatePinch(-0.4, 0, 0.4, 0, false, true);
  assert.equal(view.liveZoom, 1);
});
