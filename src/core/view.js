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
  // !! CHECKPOINT A !!  This is a faithful port of the 2011 `updateTransformation`, including its
  // defect: it averages the two fingers' LOCAL coordinates, and separately their screen
  // coordinates, and neither arithmetic mean is a hyperbolic midpoint. Measured drift on realistic
  // gestures is up to 25.7 px per finger and 20.1 px at the midpoint (620 px canvas).
  //
  // Checkpoint B replaces this with an exact solve. The pinch is exactly determined -- 4 unknowns
  // (zoom plus a 3-parameter isometry) against 4 constraints (two fingers, two coordinates each) --
  // so both fingers can be pinned. See notes/math-audit.md.

  beginPinch(f1x, f1y, f2x, f2y) {
    const k1 = 1 / Math.sqrt(1 - f1x * f1x - f1y * f1y);
    const k2 = 1 / Math.sqrt(1 - f2x * f2x - f2y * f2y);
    this.gesture = {
      kind: "pinch",
      p1x: f1x * k1,
      p1y: f1y * k1,
      p2x: f2x * k2,
      p2y: f2y * k2,
      angle: Math.atan2(f1y - f2y, f1x - f2x),
      separation: Math.hypot(f1x - f2x, f1y - f2y),
      bearing: this.northOf(this.matrix),
    };
    this.liveZoom = this.zoom;
  }

  updatePinch(g1x, g1y, g2x, g2y, allowZoom = true, allowRotate = true) {
    const g = this.gesture;
    if (!g || g.kind !== "pinch") return;

    let scale = allowZoom ? Math.hypot(g1x - g2x, g1y - g2y) / g.separation : 1;
    const angle = allowRotate ? Math.atan2(g1y - g2y, g1x - g2x) - g.angle : 0;

    // Clamp the scale rather than the resulting zoom, so the geometry stays consistent with the
    // zoom actually applied.
    if (this.minZoom != null && scale * this.zoom < this.minZoom) scale = this.minZoom / this.zoom;
    if (this.maxZoom != null && scale * this.zoom > this.maxZoom) scale = this.maxZoom / this.zoom;

    const cx = (g.p1x + g.p2x) / 2;
    const cy = (g.p1y + g.p2y) / 2;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const cxp = scale * (ca * cx - sa * cy);
    const cyp = scale * (sa * cx + ca * cy);

    this.liveZoom = scale * this.zoom;

    // Reproduce the legacy composition: treat the transformed midpoint as a view-frame local
    // point and carry it to the screen midpoint.
    const wp = Math.sqrt(1 + cxp * cxp + cyp * cyp);
    const anchorDiskX = cxp / wp;
    const anchorDiskY = cyp / wp;
    const targetX = (g1x + g2x) / 2;
    const targetY = (g1y + g2y) / 2;
    const moved = movePointToPoint(anchorDiskX, anchorDiskY, targetX, targetY).mul(
      Isom.rotation(angle).mul(this.matrix),
    );

    if (this.rotationMode === ROTATION_COMPASS) {
      const correction = g.bearing - this.northOf(moved);
      this.liveMatrix = Isom.rotation(correction).mul(moved);
    } else {
      this.liveMatrix = moved;
    }
  }
}
