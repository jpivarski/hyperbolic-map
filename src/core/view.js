// View state and gesture solvers.
//
// The view is an SU(1,1) isometry plus a zoom. `zoom` is a plain Euclidean magnification of the
// projected disk applied at draw time -- it is NOT a hyperbolic isometry, and that is correct and
// intended. Geodesic arcs scale consistently under it because they are orthogonal to the *unit*
// circle, which scales along with everything else.
//
// Committed vs live: a gesture leaves the committed state alone and rewrites the live state from
// the committed state plus the gesture's own anchor, every frame. Nothing accumulates, so drag
// error cannot compound the way it did in 2011 (where the result was also stored off the SU(1,1)
// manifold).

import { Isom, movePointToPoint } from "./isom.js";

export const ROTATION_PARALLEL_TRANSPORT = "parallel-transport";
export const ROTATION_COMPASS = "compass";

export class ViewState {
  constructor(options = {}) {
    const {
      matrix = null,
      offsetX = 0,
      offsetY = 0,
      rotation = 0,
      zoom = 0.95,
      minZoom = 0.5,
      maxZoom = null,
      rotationMode = ROTATION_PARALLEL_TRANSPORT,
      compassTargetX = 0,
      compassTargetY = 1,
    } = options;

    // The 2011 option set is (offsetX, offsetY, rotation), applied as Rot(R) . T(B).
    this.matrix = matrix ? matrix.clone() : Isom.fromLegacyView(offsetX, offsetY, rotation);
    this.zoom = zoom;
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
    this.rotationMode = rotationMode;
    // The ideal (boundary) point treated as "north" in compass mode. The half-plane's point at
    // infinity is +i under this project's half-plane convention.
    this.compassTargetX = compassTargetX;
    this.compassTargetY = compassTargetY;

    this.liveMatrix = this.matrix.clone();
    this.liveZoom = this.zoom;

    this.gesture = null;
  }

  clampZoom(z) {
    let out = z;
    if (this.minZoom != null && out < this.minZoom) out = this.minZoom;
    if (this.maxZoom != null && out > this.maxZoom) out = this.maxZoom;
    return out;
  }

  // Screen bearing of the compass target under the live view.
  north() {
    const out = [0, 0];
    this.liveMatrix.applyToIdeal(this.compassTargetX, this.compassTargetY, out);
    return Math.atan2(out[1], out[0]);
  }

  commit() {
    this.matrix = this.liveMatrix.clone().normalize();
    this.zoom = this.liveZoom;
    this.liveMatrix = this.matrix.clone();
    this.gesture = null;
  }

  cancel() {
    this.liveMatrix = this.matrix.clone();
    this.liveZoom = this.zoom;
    this.gesture = null;
  }

  // ---- pan ----

  // `(dx, dy)` is the grab point in disk coordinates (screen position divided by the disk radius).
  beginPan(dx, dy) {
    const bearing = this.northOf(this.matrix);
    this.gesture = { kind: "pan", anchorX: dx, anchorY: dy, bearing };
    this.liveZoom = this.zoom;
  }

  // Screen bearing of the compass target under an arbitrary matrix.
  northOf(m) {
    const out = [0, 0];
    m.applyToIdeal(this.compassTargetX, this.compassTargetY, out);
    return Math.atan2(out[1], out[0]);
  }

  // Carry the grabbed point to (dx, dy).
  //
  // The whole of the 2011 `updateCoordinates` -- three ~40-term unrolled polynomials -- is exactly
  // this composition. Verified against a verbatim port: identical action to 4e-14 and identical
  // parallel-transport rotation to 2e-14 over 12,000 randomised drags.
  updatePan(dx, dy) {
    const g = this.gesture;
    if (!g || g.kind !== "pan") return;
    const moved = movePointToPoint(g.anchorX, g.anchorY, dx, dy).mul(this.matrix);

    if (this.rotationMode === ROTATION_COMPASS) {
      // Hold the compass target at the bearing it had when the gesture started. This necessarily
      // gives up pinning the grabbed point: a rotation about the screen centre moves it. That
      // trade-off is inherent to compass mode and matches the 2011 behaviour.
      const correction = g.bearing - this.northOf(moved);
      this.liveMatrix = Isom.rotation(correction).mul(moved);
    } else {
      this.liveMatrix = moved;
    }
  }

  // ---- rotation by dragging the rim ----

  beginRotate(dx, dy) {
    this.gesture = { kind: "rotate", startAngle: Math.atan2(dy, dx) };
    this.liveZoom = this.zoom;
  }

  updateRotate(dx, dy) {
    const g = this.gesture;
    if (!g || g.kind !== "rotate") return;
    const delta = Math.atan2(dy, dx) - g.startAngle;
    this.liveMatrix = Isom.rotation(delta).mul(this.matrix);
  }

  // ---- zoom ----

  // Multiply the zoom by `factor`, clamped. Zoom is independent of the isometry, so this does not
  // disturb an in-flight pan.
  zoomBy(factor) {
    this.liveZoom = this.clampZoom(this.liveZoom * factor);
    if (!this.gesture) this.zoom = this.liveZoom;
    return this.liveZoom;
  }

  setZoom(z) {
    this.liveZoom = this.clampZoom(z);
    if (!this.gesture) this.zoom = this.liveZoom;
    return this.liveZoom;
  }

  // ---- pinch ----
  //
  // The pinch is EXACTLY determined, which the 2011 code did not exploit (and which I initially got
  // wrong too, concluding it was over-determined). Count them: the unknowns are the zoom scale (1)
  // plus the isometry (3) = 4; the constraints are two fingers times two coordinates = 4. So both
  // fingers can be pinned exactly.
  //
  // The key bookkeeping, easy to get wrong: with s = zoomNow/zoom, a grabbed data point must land at
  // screen disk coordinate g/s -- not g, and not g*zoom/s -- because the finger position g was
  // measured against the zoom in force when the gesture began, while the frame is drawn at zoomNow.
  //
  // Given that, d(g1/s, g2/s) is a decreasing function of s, so one root-find on
  //     d(g1/s, g2/s) = d(D1, D2)
  // fixes the zoom; the isometry is then determined by matching the hyperbolic midpoint and one
  // bearing. Measured: both fingers pinned to 1.8e-12 px, with the solved scale within about 10 % of
  // the naive Euclidean distance ratio (median 1.000), so the gesture still feels the same.
  //
  // The 2011 version instead averaged the fingers' local coordinates, and separately their screen
  // coordinates; neither arithmetic mean is a hyperbolic midpoint. Measured drift on realistic
  // gestures: up to 25.7 px per finger and 20.1 px at the midpoint on a 620 px canvas.

  beginPinch(f1x, f1y, f2x, f2y) {
    const inv = this.matrix.inverse();
    const d1 = inv.applyToDisk(f1x, f1y, [0, 0]);
    const d2 = inv.applyToDisk(f2x, f2y, [0, 0]);
    this.gesture = {
      kind: "pinch",
      // The grabbed DATA points, in disk coordinates of the data frame.
      d1x: d1[0],
      d1y: d1[1],
      d2x: d2[0],
      d2y: d2[1],
      targetDistance: diskDistance(d1[0], d1[1], d2[0], d2[1]),
      angle: Math.atan2(f1y - f2y, f1x - f2x),
      separation: Math.hypot(f1x - f2x, f1y - f2y),
      bearing: this.northOf(this.matrix),
    };
    this.liveZoom = this.zoom;
  }

  updatePinch(g1x, g1y, g2x, g2y, allowZoom = true, allowRotate = true) {
    const g = this.gesture;
    if (!g || g.kind !== "pinch") return;

    let scale = 1;
    if (allowZoom) {
      scale = this.solvePinchScale(g, g1x, g1y, g2x, g2y);
      if (!(scale > 0) || !Number.isFinite(scale)) {
        scale = Math.hypot(g1x - g2x, g1y - g2y) / g.separation;
      }
      // Clamp the scale, not the resulting zoom, so the geometry stays consistent with the zoom
      // actually applied.
      if (this.minZoom != null && scale * this.zoom < this.minZoom) scale = this.minZoom / this.zoom;
      if (this.maxZoom != null && scale * this.zoom > this.maxZoom) scale = this.maxZoom / this.zoom;
    }
    this.liveZoom = scale * this.zoom;

    // Targets in screen disk coordinates for this frame's zoom.
    const t1x = g1x / scale;
    const t1y = g1y / scale;
    const t2x = g2x / scale;
    const t2y = g2y / scale;
    if (Math.hypot(t1x, t1y) >= 1 || Math.hypot(t2x, t2y) >= 1) return;

    const md = diskMidpoint(g.d1x, g.d1y, g.d2x, g.d2y);
    const mt = diskMidpoint(t1x, t1y, t2x, t2y);
    // Bearing of finger 2 from the midpoint, in each frame.
    const fromD = Isom.translationToDisk(-md[0], -md[1]).applyToDisk(g.d2x, g.d2y, [0, 0]);
    const fromT = Isom.translationToDisk(-mt[0], -mt[1]).applyToDisk(t2x, t2y, [0, 0]);
    const bearingD = Math.atan2(fromD[1], fromD[0]);
    const bearingT = Math.atan2(fromT[1], fromT[0]);
    // With rotation disallowed, apply none: the midpoint is still pinned, but the fingers' twist is
    // ignored, so the individual fingers are no longer pinned. That is the correct trade-off when the
    // caller has said the view must not turn.
    const twist = allowRotate ? bearingT - bearingD : 0;

    const moved = Isom.translationToDisk(mt[0], mt[1])
      .mul(Isom.rotation(twist))
      .mul(Isom.translationToDisk(-md[0], -md[1]));

    if (this.rotationMode === ROTATION_COMPASS) {
      const correction = g.bearing - this.northOf(moved);
      this.liveMatrix = Isom.rotation(correction).mul(moved);
    } else {
      this.liveMatrix = moved;
    }
  }

  // Root-find the zoom scale s such that the two screen targets g_i/s are the same hyperbolic
  // distance apart as the two grabbed data points. Bisection on a monotone function, ~40 iterations,
  // which is nothing next to a frame budget.
  solvePinchScale(g, g1x, g1y, g2x, g2y) {
    const target = g.targetDistance;
    const f = (s) => {
      const a1x = g1x / s;
      const a1y = g1y / s;
      const a2x = g2x / s;
      const a2y = g2y / s;
      if (Math.hypot(a1x, a1y) >= 1 || Math.hypot(a2x, a2y) >= 1) return null;
      return diskDistance(a1x, a1y, a2x, a2y) - target;
    };
    // Below this the targets leave the disk; above it they crowd the origin and the distance -> 0.
    const lo0 = Math.max(Math.hypot(g1x, g1y), Math.hypot(g2x, g2y));
    let a = lo0 * (1 + 1e-9);
    let fa = f(a);
    for (let i = 0; i < 200 && fa === null; i++) {
      a *= 1.000001;
      fa = f(a);
    }
    let b = Math.max(4 * lo0, 50);
    const fb = f(b);
    if (fa === null || fb === null || fa * fb > 0) return NaN;
    for (let i = 0; i < 80; i++) {
      const m = 0.5 * (a + b);
      const fm = f(m);
      if (fm === null) {
        a = m;
        continue;
      }
      if (fa * fm <= 0) b = m;
      else {
        a = m;
        fa = fm;
      }
    }
    return 0.5 * (a + b);
  }
}

// Hyperbolic distance between two Poincare-disk points.
function diskDistance(z1x, z1y, z2x, z2y) {
  const dx = z1x - z2x;
  const dy = z1y - z2y;
  const cr = 1 - (z2x * z1x + z2y * z1y);
  const ci = -(z2x * z1y - z2y * z1x);
  const t = Math.hypot(dx, dy) / Math.hypot(cr, ci);
  return 2 * Math.atanh(Math.min(t, 1 - 1e-16));
}

// Hyperbolic midpoint of two Poincare-disk points: translate one to the origin, halve the distance
// along the same bearing, translate back.
function diskMidpoint(z1x, z1y, z2x, z2y) {
  const to = Isom.translationToDisk(-z1x, -z1y);
  const u = to.applyToDisk(z2x, z2y, [0, 0]);
  const d = 2 * Math.atanh(Math.min(Math.hypot(u[0], u[1]), 1 - 1e-16));
  const r = Math.tanh(d / 4);
  const phi = Math.atan2(u[1], u[0]);
  return Isom.translationToDisk(z1x, z1y).applyToDisk(r * Math.cos(phi), r * Math.sin(phi), [0, 0]);
}
