/* hyperbolic-map-widget 0.1.0 - https://github.com/jpivarski/hyperbolic-map-widget
 * Built by tools/build.mjs (concatenation in dependency order; no bundler).
 * Generated file - do not edit. Edit src/ and run `npm run build`.
 */
(function (global) {
"use strict";

// ===== src/core/isom.js =====
// Orientation-preserving isometries of the hyperbolic plane, as SU(1,1) matrices.
//
//     M = [[ a, b ],   with  |a|^2 - |b|^2 = 1,   acting on the Poincare disk by
//          [ b*, a* ]]        z -> (a z + b) / (b* z + a*)
//
// Stored as four doubles. Note SU(1,1) double-covers the isometry group: +M and -M are the same
// isometry, so a "rotation by 2*pi" is -I, not I.
//
// The load-bearing fact (see notes/su11-core.md): a data point in local coordinates IS an
// isometry. The point (x, y) with w = sqrt(1 + x^2 + y^2) corresponds to (a, b) = (w, x + iy),
// which satisfies the determinant condition identically and maps the origin to (x + iy)/w --
// exactly that point's Poincare-disk coordinate. Projecting a point under a view is therefore
// reading off the corner ratio of a matrix product, which is what `applyToLocal` does.

// A point at hyperbolic distance d from the origin has local radius sinh(d/2) and companion
// w = cosh(d/2). This is an algebraic identity, not an approximation: see notes/math-audit.md.
function localCompanion(x, y) {
  return Math.sqrt(1 + x * x + y * y);
}

class Isom {
  constructor(ar, ai, br, bi) {
    this.ar = ar;
    this.ai = ai;
    this.br = br;
    this.bi = bi;
  }

  static identity() {
    return new Isom(1, 0, 0, 0);
  }

  // Rotation of the disk about the origin by `theta`. Half-angle because this is the spin
  // double cover, not a typo.
  static rotation(theta) {
    return new Isom(Math.cos(theta / 2), Math.sin(theta / 2), 0, 0);
  }

  // The pure translation carrying the origin to the disk point (bx, by), |b| < 1.
  static translationToDisk(bx, by) {
    const k = 1 / Math.sqrt(1 - bx * bx - by * by);
    return new Isom(k, 0, bx * k, by * k);
  }

  // The pure translation carrying the origin to the point with local coordinates (x, y).
  // This is the identity noted above: (w, x + iy) is already in SU(1,1).
  static translationToLocal(x, y) {
    return new Isom(localCompanion(x, y), 0, x, y);
  }

  // Translation by hyperbolic distance `dist` along screen direction `bearing`.
  static translation(dist, bearing) {
    const s = Math.sinh(dist / 2);
    return new Isom(Math.cosh(dist / 2), 0, s * Math.cos(bearing), s * Math.sin(bearing));
  }

  // The 2011 option set stored the view as an offset B in local coordinates plus a rotation R,
  // applied as Rot(R) . T(B) -- rotation AFTER translation. Order matters.
  static fromLegacyView(bx, by, rotation) {
    return Isom.rotation(rotation).mul(Isom.translationToLocal(bx, by));
  }

  clone() {
    return new Isom(this.ar, this.ai, this.br, this.bi);
  }

  // this . other  (i.e. apply `other` first, then `this`)
  mul(other) {
    const out = new Isom(0, 0, 0, 0);
    Isom.composeInto(out, this, other);
    return out;
  }

  // Allocation-free composition for hot paths. `out` may alias neither `m` nor `n`.
  //
  //   a = m.a n.a + m.b conj(n.b)
  //   b = m.a n.b + m.b conj(n.a)
  //
  // Expand carefully: m.b conj(n.a) = (mbr + i mbi)(nar - i nai)
  //                                = (mbr nar + mbi nai) + i (mbi nar - mbr nai).
  // Getting those two signs wrong is invisible whenever either operand is a pure rotation
  // (b = 0), which is most of the easy test cases -- the group-law test is what catches it.
  static composeInto(out, m, n) {
    out.ar = m.ar * n.ar - m.ai * n.ai + m.br * n.br + m.bi * n.bi;
    out.ai = m.ar * n.ai + m.ai * n.ar + m.bi * n.br - m.br * n.bi;
    out.br = m.ar * n.br - m.ai * n.bi + m.br * n.ar + m.bi * n.ai;
    out.bi = m.ar * n.bi + m.ai * n.br + m.bi * n.ar - m.br * n.ai;
    return out;
  }

  inverse() {
    return new Isom(this.ar, -this.ai, -this.br, -this.bi);
  }

  // Project back onto the group manifold.
  //
  // Deliberately NOT `divide by sqrt(det)`: at hyperbolic distance 20, |a|^2 and |b|^2 are both
  // about 5e8 and their difference (which should be exactly 1) has already lost 8 digits, so that
  // route only restores det = 1 +/- 1e-8. Re-factoring through the polar form recomputes the
  // diagonal FROM the off-diagonal, which lands on the manifold by construction.
  normalize() {
    const modA = Math.hypot(this.ar, this.ai);
    if (!(modA > 0) || !Number.isFinite(modA)) return this;
    const theta = 2 * Math.atan2(this.ai, this.ar);
    // Polar decomposition M = Rot(theta) . T(beta), so beta = b * conj(a)/|a| = b * e^{-i theta/2}.
    // Note |beta| = |b|: this is a LOCAL coordinate (sinh(d/2)), not a disk coordinate.
    const betaR = (this.br * this.ar + this.bi * this.ai) / modA;
    const betaI = (this.bi * this.ar - this.br * this.ai) / modA;
    const modBeta2 = betaR * betaR + betaI * betaI;
    // The rebuilt diagonal is sqrt(1 + |beta|^2). Once |beta| exceeds about 1e8 (hyperbolic distance
    // ~37) the `1` is below the ulp of |beta|^2 and the sum is exactly |beta|^2, so the square root
    // just returns |beta| -- at which point |a| (which we already have to full precision, with no
    // cancellation, from hypot) is the better answer. Both agree to ~1/(2|a|^2).
    const w = modBeta2 > 1e15 ? modA : Math.sqrt(1 + modBeta2);
    const c = Math.cos(theta / 2);
    const s = Math.sin(theta / 2);
    this.ar = c * w;
    this.ai = s * w;
    this.br = c * betaR - s * betaI;
    this.bi = c * betaI + s * betaR;
    return this;
  }

  // How far off the manifold we are. Diagnostics only: at large |b| this cannot be evaluated to
  // better than about 1e-7 absolute, because it is a difference of two numbers near 5e8.
  detError() {
    return this.ar * this.ar + this.ai * this.ai - this.br * this.br - this.bi * this.bi - 1;
  }

  // ---- actions ----

  // The hot kernel. Maps a point given in LOCAL coordinates straight to its Poincare-disk
  // position under this isometry, writing into `out` (a 2-element array or typed array) to avoid
  // allocating. Pass `w` if it is already known -- it is precomputed at ingest, which is why this
  // has no sqrt in the common case.
  applyToLocal(x, y, w, out) {
    const ww = w === undefined ? localCompanion(x, y) : w;
    const { ar, ai, br, bi } = this;
    const nr = ar * x - ai * y + br * ww;
    const ni = ar * y + ai * x + bi * ww;
    const dr = ar * ww + br * x + bi * y;
    const di = br * y - bi * x - ai * ww;
    const s = 1 / (dr * dr + di * di);
    out[0] = (nr * dr + ni * di) * s;
    out[1] = (ni * dr - nr * di) * s;
    return out;
  }

  applyToDisk(zx, zy, out) {
    const { ar, ai, br, bi } = this;
    const nr = ar * zx - ai * zy + br;
    const ni = ar * zy + ai * zx + bi;
    const dr = br * zx + bi * zy + ar;
    const di = br * zy - bi * zx - ai;
    const s = 1 / (dr * dr + di * di);
    out[0] = (nr * dr + ni * di) * s;
    out[1] = (ni * dr - nr * di) * s;
    return out;
  }

  // Ideal (boundary) points, |w| = 1. Used for the compass: the half-plane's point at infinity
  // is the boundary point +i.
  applyToIdeal(wx, wy, out) {
    const { ar, ai, br, bi } = this;
    const nr = ar * wx - ai * wy + br;
    const ni = ar * wy + ai * wx + bi;
    const dr = br * wx + bi * wy + ar;
    const di = br * wy - bi * wx - ai;
    const s = 1 / (dr * dr + di * di);
    out[0] = (nr * dr + ni * di) * s;
    out[1] = (ni * dr - nr * di) * s;
    return out;
  }

  // ---- readouts ----

  // Screen bearing of the half-plane's "north" (its ideal point, which this convention places at
  // the top of the disk). Geodesics through the disk centre are straight diameters, so this is
  // just the argument of the image of that boundary point. Verified equal to the 2011
  // `halfPlaneOrientation` to 7e-13 -- a simplification, not a bug fix.
  north() {
    const out = [0, 0];
    this.applyToIdeal(0, 1, out);
    return Math.atan2(out[1], out[0]);
  }

  // Total screen rotation, i.e. the 2011 `rotation`.
  screenRotation() {
    return 2 * Math.atan2(this.ai, this.ar);
  }

  // Where the origin goes, in disk coordinates.
  originImageDisk(out) {
    const modA2 = this.ar * this.ar + this.ai * this.ai;
    const inv = 1 / Math.sqrt(modA2);
    // b / conj(a) has modulus |b|/|a|; compute directly to keep it stable.
    const s = inv * inv;
    out[0] = (this.br * this.ar - this.bi * -this.ai) * s;
    out[1] = (this.bi * this.ar + this.br * -this.ai) * s;
    return out;
  }

  // The view centre in local coordinates: the point that this isometry sends to the origin.
  centreLocal(out) {
    const inv = this.inverse();
    inv.applyToDisk(0, 0, out);
    const r2 = out[0] * out[0] + out[1] * out[1];
    const k = 1 / Math.sqrt(1 - r2);
    out[0] *= k;
    out[1] *= k;
    return out;
  }

  // Hyperbolic distance from the origin to this isometry's image of the origin.
  //
  // Read from |b| = sinh(d/2), not |a| = cosh(d/2): cosh(d/2) rounds to exactly 1.0 for any
  // d below about 3e-8, so the acosh route silently reports zero for small translations. sinh is
  // well conditioned at both ends.
  distanceMoved() {
    return 2 * Math.asinh(Math.hypot(this.br, this.bi));
  }
}

// The pure translation carrying disk point p to disk point f.
//
// Solving (z_P + beta)/(conj(beta) z_P + 1) = z_F gives beta = (c + k conj(c))/(1 - |k|^2) with
// c = z_F - z_P and k = z_F z_P. Two complex multiplies. Recompute this from the gesture anchor
// every frame rather than accumulating, so drag error never compounds.
function movePointToPoint(px, py, fx, fy) {
  const cr = fx - px;
  const ci = fy - py;
  const kr = fx * px - fy * py;
  const ki = fx * py + fy * px;
  const denom = 1 - (kr * kr + ki * ki);
  // k conj(c)
  const mr = kr * cr + ki * ci;
  const mi = ki * cr - kr * ci;
  const betaR = (cr + mr) / denom;
  const betaI = (ci + mi) / denom;
  return Isom.translationToDisk(betaR, betaI);
}

// ===== src/core/coords.js =====
// Conversions between the three coordinate systems.
//
//   local       (x, y) with companion w = sqrt(1 + x^2 + y^2); radius = sinh(d/2), w = cosh(d/2).
//               Called "hyperShadow" in the 2011 code. These are SU(1,1) matrix entries --
//               see notes/su11-core.md.
//   disk        the Poincare disk, z = (x + iy)/w, |z| = tanh(d/2). What gets drawn.
//   halfPlane   the Poincare upper half-plane. Some 2011 source art was authored here, and the
//               binary tiling is defined here.
//
// Convention, pinned: the half-plane -> disk map is exactly  z -> i (z - i) / (z + i).  The extra
// factor of i (beyond the bare Cayley transform) puts the half-plane's point at infinity at the
// TOP of the disk rather than at +1, which is why "latitude increases upward" reads correctly on
// screen. Landmarks: i -> 0, infinity -> +i, 0 -> -i.
//
// Both half-plane conversions below are CORRECTED forms. The 2011 originals were algebraically right
// but numerically catastrophic, in ways that mattered for the shipped data. See notes/math-audit.md;
// checkpoint A in the git history has the originals if you want to see them fail.

function localToDisk(x, y, out) {
  const w = localCompanion(x, y);
  out[0] = x / w;
  out[1] = y / w;
  return out;
}

function diskToLocal(zx, zy, out) {
  const k = 1 / Math.sqrt(1 - zx * zx - zy * zy);
  out[0] = zx * k;
  out[1] = zy * k;
  return out;
}

// Hyperbolic distance from the origin to a point given in local coordinates.
function localRadiusToDistance(r) {
  return 2 * Math.asinh(r);
}

function distanceToLocalRadius(d) {
  return Math.sinh(d / 2);
}

// Hyperbolic distance between two points given in local coordinates.
//
// cosh(d/2) = |w1 w2 - conj(zeta1) zeta2|  -- the MODULUS of a complex quantity. Taking only the
// real part is wrong (see notes/math-audit.md); it under-estimates the distance by up to 19.6.
function localDistance(x1, y1, x2, y2) {
  const w1 = localCompanion(x1, y1);
  const w2 = localCompanion(x2, y2);
  const a = w1 * w2 - x1 * x2 - y1 * y2;
  const b = x1 * y2 - x2 * y1;
  return 2 * Math.acosh(Math.max(1, Math.hypot(a, b)));
}

// ---- half-plane <-> local ----

// The 2011 version computed sinh(d/2) as
//
//     sqrt((s+ + s-)/(s+ - s-))/2 - sqrt((s+ - s-)/(s+ + s-))/2
//
// with s+ = |z + i| and s- = |z - i|. Near the basepoint i both radicals tend to 1, so `s+ - s-`
// cancels and then `(u - 1/u)/2` cancels again -- a DOUBLE cancellation. Measured: 4.4e-5 relative
// error at d/2 = 5e-7, and it returns EXACTLY ZERO for d/2 below about 5e-9.
//
// The whole expression collapses to t/sqrt(1 - t^2) with t = |z - i|/|z + i| = tanh(d/2), which has
// a single, benign cancellation and is exact to machine precision at every scale. That matters here
// because the dungeon and relativity art were authored in half-plane coordinates and pass through
// the basepoint region.
function halfPlaneToLocal(px, py, out) {
  // t = |z - i| / |z + i| = tanh(d/2)
  const minus = Math.hypot(px, py - 1);
  const plus = Math.hypot(px, py + 1);
  if (plus === 0) {
    out[0] = 0;
    out[1] = 0;
    return out;
  }
  let t = minus / plus;
  if (t === 0) {
    out[0] = 0;
    out[1] = 0;
    return out;
  }
  if (t >= 1) t = 1 - Number.EPSILON;
  const sinhHalf = t / Math.sqrt((1 - t) * (1 + t));

  // Direction: the map is z -> i(z - i)/(z + i), so the phase is that of i(z - i)(conj(z) - i)... but
  // it is clearer, and better conditioned, to form the disk image directly and normalise it.
  //   (z - i)/(z + i), then multiply by i
  const nr = px;
  const ni = py - 1;
  const dr = px;
  const di = py + 1;
  const dd = dr * dr + di * di;
  const qr = (nr * dr + ni * di) / dd;
  const qi = (ni * dr - nr * di) / dd;
  const zx = -qi;
  const zy = qr;
  const mod = Math.hypot(zx, zy);
  if (mod === 0) {
    out[0] = 0;
    out[1] = 0;
    return out;
  }
  out[0] = (sinhHalf * zx) / mod;
  out[1] = (sinhHalf * zy) / mod;
  return out;
}

// The 2011 version used denom = 2r^2 + 1 - 2yw with w = sqrt(1 + r^2). For y > 0 the `+1` is lost
// once 2yw is large, and in IEEE doubles denom reaches exactly 0.0 by y ~ 1e4 -- which is INSIDE the
// dungeon dataset's range (it reaches y = 11711.92). In Java that produced Infinity rather than
// throwing, so it failed silently.
//
// Multiplying through by the conjugate gives an algebraically identical, all-positive form:
//
//     denom = (4 x^2 w^2 + 1) / (2 r^2 + 1 + 2 y w)
//
// For y <= 0 the original expression is already all-positive, and the rewritten one is the one that
// cancels, so branch on the sign. Verified finite and correct to ~1e-15 out to y = 1e8 both ways.
function localToHalfPlane(px, py, out) {
  const r2 = px * px + py * py;
  const w = Math.sqrt(r2 + 1.0);
  const denom =
    py > 0.0
      ? (4.0 * px * px * w * w + 1.0) / (2.0 * r2 + 1.0 + 2.0 * py * w)
      : 2.0 * r2 + 1.0 - 2.0 * py * w;
  out[0] = (2.0 * px * w) / denom;
  out[1] = 1.0 / denom;
  return out;
}

// ===== src/core/minkowski.js =====
// Exact visibility tests in local coordinates, with no division and no sqrt.
//
// The SU(1,1)-invariant Hermitian form on two points gives their distance directly:
//
//     cosh(d/2) = | w1 w2 - conj(zeta1) zeta2 |          zeta = x + iy
//
// Note the MODULUS of a COMPLEX quantity. Writing
//
//     A = w1 w2 - x1 x2 - y1 y2        B = x1 y2 - x2 y1
//
// gives cosh(d/2) = sqrt(A^2 + B^2), so comparisons can be done on A^2 + B^2 against a squared
// threshold: six multiplies, no division, no sqrt.
//
// WARNING, recorded because it nearly shipped: using A alone is WRONG. It drops the imaginary
// part and under-estimates cosh(d/2) by up to 19.6 in testing. Because it under-estimates, it
// over-includes rather than wrongly rejecting -- so it "works" while silently drawing far too
// much. See notes/math-audit.md.

// cosh(d/2) between two points in local coordinates. `w1`/`w2` may be passed if already known.
function coshHalfDistance(x1, y1, w1, x2, y2, w2) {
  const ww1 = w1 === undefined ? localCompanion(x1, y1) : w1;
  const ww2 = w2 === undefined ? localCompanion(x2, y2) : w2;
  const a = ww1 * ww2 - x1 * x2 - y1 * y2;
  const b = x1 * y2 - x2 * y1;
  return Math.hypot(a, b);
}

// Squared form, for hot comparisons.
function coshHalfDistanceSquared(x1, y1, w1, x2, y2, w2) {
  const a = w1 * w2 - x1 * x2 - y1 * y2;
  const b = x1 * y2 - x2 * y1;
  return a * a + b * b;
}

// A point is inside screen radius `tau` of the view centre iff cosh(d/2) < 1/sqrt(1 - tau^2).
// This returns the SQUARED threshold, so callers can compare against
// coshHalfDistanceSquared without a sqrt.
function screenRadiusToThresholdSquared(tau) {
  return 1 / (1 - tau * tau);
}

// A bounding cap: every point of a drawable lies within hyperbolic radius `radius` of the local
// point (x, y). Correct by the triangle inequality for any enclosing choice, so the trivial
// construction below is safe (just not minimal).
class Cap {
  constructor(x, y, radius) {
    this.x = x;
    this.y = y;
    this.w = localCompanion(x, y);
    this.radius = radius;
  }

  // Take the first point as the centre and the furthest distance as the radius. Not the minimal
  // enclosing cap, but correctness does not depend on minimality -- only on enclosure.
  static enclosing(xs, ys, start, count) {
    if (count <= 0) return new Cap(0, 0, 0);
    const cx = xs[start];
    const cy = ys[start];
    const cw = localCompanion(cx, cy);
    let maxCosh = 1;
    for (let i = start + 1; i < start + count; i++) {
      const c = coshHalfDistance(cx, cy, cw, xs[i], ys[i], undefined);
      if (c > maxCosh) maxCosh = c;
    }
    return new Cap(cx, cy, 2 * Math.acosh(maxCosh));
  }
}

// Can any point of `cap` be visible within screen radius `tau` of the view centre `(cx, cy, cw)`?
//
// Reject iff d(capCentre, viewCentre) > rho + capRadius, where rho = 2 artanh(tau). Precompute
// cosh((rho + capRadius)/2) per cap-radius value; here it is passed in as `coshHalfSum`.
function capMayBeVisible(cap, cx, cy, cw, coshHalfSum) {
  const a = cap.w * cw - cap.x * cx - cap.y * cy;
  const b = cap.x * cy - cap.y * cx;
  return a * a + b * b <= coshHalfSum * coshHalfSum;
}

// cosh((rho + r)/2) where rho = 2 artanh(tau) is the visible hyperbolic radius.
function capThreshold(tau, capRadius) {
  const rho = 2 * Math.atanh(Math.min(tau, 1 - 1e-15));
  return Math.cosh((rho + capRadius) / 2);
}

// ===== src/core/view.js =====
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

const ROTATION_PARALLEL_TRANSPORT = "parallel-transport";
const ROTATION_COMPASS = "compass";

class ViewState {
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

// ===== src/render/surface.js =====
// The canvas surface: sizing, devicePixelRatio, and the read-only `view` descriptor that gets
// handed to the renderer and to every hook.
//
// All library drawing is done in CSS pixels. The device-pixel transform is applied once here, so
// nothing downstream has to know about it.

class Surface {
  constructor(options) {
    const {
      container = null,
      canvas = null,
      width = null,
      height = null,
      autoResize = false,
      // "auto" follows window.devicePixelRatio. The 2011 code had no notion of this, so its
      // canvases were blurry on HiDPI displays; pass 1 to reproduce that.
      devicePixelRatio = "auto",
      // "min" sizes the disk by min(width, height) so it always fits. The 2011 code used the
      // canvas WIDTH for both axes, which overflows vertically on a portrait canvas. That is a
      // behaviour difference, not a bug, so both are available.
      radiusBasis = "min",
    } = options || {};

    this.autoResize = autoResize;
    this.dprOption = devicePixelRatio;
    this.radiusBasis = radiusBasis;

    if (canvas) {
      this.canvas = canvas;
    } else {
      const host = typeof container === "string" ? document.querySelector(container) : container;
      if (!host) throw new Error("hyperbolic-map: no container element found");
      this.host = host;
      this.canvas = document.createElement("canvas");
      this.canvas.style.display = "block";
      host.appendChild(this.canvas);
    }

    this.cssWidth = width || (this.host ? this.host.clientWidth : this.canvas.clientWidth) || 400;
    this.cssHeight = height || (this.host ? this.host.clientHeight : this.canvas.clientHeight) || this.cssWidth;

    this.context = this.canvas.getContext("2d");
    this.resizeObserver = null;
    this.applySize();
  }

  dpr() {
    if (this.dprOption === "auto") {
      return typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1;
    }
    return this.dprOption || 1;
  }

  applySize() {
    const ratio = this.dpr();
    this.canvas.width = Math.max(1, Math.round(this.cssWidth * ratio));
    this.canvas.height = Math.max(1, Math.round(this.cssHeight * ratio));
    this.canvas.style.width = `${this.cssWidth}px`;
    this.canvas.style.height = `${this.cssHeight}px`;
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  resize(w, h) {
    this.cssWidth = w;
    this.cssHeight = h;
    this.applySize();
  }

  observe(onResize) {
    if (!this.autoResize || typeof ResizeObserver === "undefined") return;
    const target = this.host || this.canvas;
    this.resizeObserver = new ResizeObserver(() => {
      const w = target.clientWidth;
      const h = target.clientHeight;
      if (w > 0 && h > 0 && (w !== this.cssWidth || h !== this.cssHeight)) {
        this.resize(w, h);
        onResize();
      }
    });
    this.resizeObserver.observe(target);
  }

  // The disk radius in CSS pixels for a given zoom.
  radiusFor(zoom) {
    const basis = this.radiusBasis === "width" ? this.cssWidth : Math.min(this.cssWidth, this.cssHeight);
    return (zoom * basis) / 2;
  }

  // Build the descriptor passed to the renderer and to hooks. Reuses one object so that a redraw
  // does not allocate.
  buildView(viewState, opts) {
    const zoom = viewState.liveZoom;
    const radius = this.radiusFor(zoom);
    const v = this._view || (this._view = {});
    v.width = this.cssWidth;
    v.height = this.cssHeight;
    v.ctxScale = this.dpr();
    v.cx = this.cssWidth / 2;
    v.cy = this.cssHeight / 2;
    v.radius = radius;
    v.zoom = zoom;
    v.matrix = viewState.liveMatrix;
    v.rotation = viewState.liveMatrix.screenRotation();
    v.bearing = viewState.north();
    v.drawRadius = opts.drawRadius;
    v.interactRadius = opts.interactRadius;
    // How much of the disk can actually be on screen. At high zoom only a fraction of it is, and
    // culling against the disk instead of the viewport is wasted work.
    v.effectiveRadius = Math.min(
      opts.drawRadius,
      Math.hypot(this.cssWidth, this.cssHeight) / (2 * radius),
    );
    v.interacting = !!viewState.gesture;
    v.toScreen = (x, y) => {
      const out = [0, 0];
      viewState.liveMatrix.applyToLocal(x, y, undefined, out);
      return [out[0] * radius + v.cx, -out[1] * radius + v.cy];
    };
    v.fromScreen = (sx, sy) => {
      const zx = (sx - v.cx) / radius;
      const zy = -(sy - v.cy) / radius;
      if (zx * zx + zy * zy >= 1) return null;
      const inv = viewState.liveMatrix.inverse();
      const out = inv.applyToDisk(zx, zy, [0, 0]);
      const k = 1 / Math.sqrt(1 - out[0] * out[0] - out[1] * out[1]);
      return [out[0] * k, out[1] * k];
    };
    return v;
  }

  // Pointer position in disk coordinates, or null if the event is outside the canvas rect.
  //
  // Uses getBoundingClientRect rather than the 2011 `pageX - canvas.offsetLeft`, which is wrong
  // whenever the canvas is nested inside a positioned element or the page is scrolled. And it uses
  // the LIVE zoom: the 2011 code divided by the committed zoom while drawing with the live one, so
  // wheel-zooming during a drag desynchronised the pointer from the picture.
  eventToDisk(event, zoom) {
    const rect = this.canvas.getBoundingClientRect();
    const radius = this.radiusFor(zoom);
    const x = (event.clientX - rect.left - this.cssWidth / 2) / radius;
    const y = -(event.clientY - rect.top - this.cssHeight / 2) / radius;
    return [x, y];
  }

  destroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.host && this.canvas.parentNode === this.host) this.host.removeChild(this.canvas);
  }
}

// ===== src/render/geodesic.js =====
// Geodesic edges in the Poincare disk.
//
// A geodesic through two interior points is an arc of the unique circle through them that is
// orthogonal to the unit circle. Writing that circle as
//
//     x^2 + y^2 + a x + b y + c = 0
//
// orthogonality to the unit circle holds exactly when c = 1 (and then it is a real circle whenever
// a^2 + b^2 > 4, which is automatic for two distinct interior points not collinear with the origin).
// Solving for a and b through the two points gives the closed form below.
//
// Special case: when the two points are collinear with the origin, the determinant x1*y2 - x2*y1
// vanishing is exactly that condition, and the geodesic really is a straight diameter. So the
// "degenerate" branch is not an approximation -- it is the correct answer there.
//
// Sweep direction: the whole in-disk portion of a geodesic subtends 2*atan(1/r) < pi at the arc's
// centre, so any sub-segment is the MINOR arc. Normalising the angle difference into (-pi, pi] and
// sweeping that way is therefore always right.

// Result object, reused by the caller to avoid allocating per edge.
class Arc {
  constructor() {
    this.straight = true;
    this.cx = 0;
    this.cy = 0;
    this.r = 0;
    this.startAngle = 0;
    this.endAngle = 0;
    this.anticlockwise = false;
  }
}

const DEGENERATE = 1e-10;

// Compute the geodesic from (x1, y1) to (x2, y2), both in disk coordinates, into `out`.
//
// `straightIfShorterThan` is a chord-length threshold in DISK units below which the edge is drawn as
// a straight line. Pass 0 to always use an arc. The 2011 code used a fixed 0.1, which is
// zoom-independent and therefore visibly wrong when zoomed in; `sagittaTolerance` (in the same disk
// units) replaces it with a curvature-aware test. Pass sagittaTolerance = 0 to disable it.
function geodesicArc(x1, y1, x2, y2, out, straightIfShorterThan, sagittaTolerance) {
  const denom = x1 * y2 - x2 * y1;
  const dist2 = (x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2);

  if (Math.abs(denom) <= DEGENERATE) {
    // Collinear with the origin: the geodesic is a diameter.
    out.straight = true;
    return out;
  }
  if (straightIfShorterThan > 0 && dist2 <= straightIfShorterThan * straightIfShorterThan) {
    out.straight = true;
    return out;
  }

  const a = (-x1 * x1 * y2 + x2 * x2 * y1 - y1 * y1 * y2 + y1 * y2 * y2 + y1 - y2) / denom;
  const b = (x1 * x1 * x2 - x1 * x2 * x2 - x1 * y2 * y2 - x1 + x2 * y1 * y1 + x2) / denom;
  const cx = -0.5 * a;
  const cy = -0.5 * b;
  const r2 = 0.25 * (a * a + b * b) - 1;
  if (!(r2 > 0)) {
    out.straight = true;
    return out;
  }
  const r = Math.sqrt(r2);

  if (sagittaTolerance > 0) {
    // Sagitta of the arc: how far the arc departs from its chord. If that is below the tolerance
    // the chord is indistinguishable from the arc, so draw a line and save the work.
    const halfChord2 = 0.25 * dist2;
    if (halfChord2 < r2) {
      const sagitta = r - Math.sqrt(r2 - halfChord2);
      if (sagitta <= sagittaTolerance) {
        out.straight = true;
        return out;
      }
    }
  }

  // Angles here are in the y-up mathematical frame. The caller flips y for canvas, which negates
  // them, and that flip also reverses the sweep sense -- so get this right or every arc goes the
  // long way round, outside the disk.
  //
  //   canvas angle       = -theta
  //   signed short sweep = d = wrap(theta2 - theta1) in (-pi, pi]
  //   d > 0 means increasing theta (counter-clockwise in the maths frame), which is DECREASING
  //   canvas angle, which is what canvas calls anticlockwise = true.
  //
  // With delta = theta1 - theta2 = -d, that is `anticlockwise = delta < 0`.
  const phi1 = Math.atan2(y1 - cy, x1 - cx);
  const phi2 = Math.atan2(y2 - cy, x2 - cx);
  let delta = phi1 - phi2;
  while (delta >= Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;

  out.straight = false;
  out.cx = cx;
  out.cy = cy;
  out.r = r;
  out.startAngle = phi1;
  out.endAngle = phi2;
  out.anticlockwise = delta < 0;
  return out;
}

// ===== src/data/drawable.js =====
// Parse and compile drawables.
//
// Input is either the v2 schema (documented in README.md) or the 2011 shape, which is detected and
// converted. Compiling does the work that would otherwise be repeated every frame: the companion
// w = sqrt(1 + x^2 + y^2) for each point, the resolved style, and a Minkowski bounding cap for
// cheap culling.
//
// Point flags, preserved from the 2011 format rather than "modernised" into move/line commands: a
// point's flag string describes the edge LEAVING that point. "L" strokes it; absent means the edge
// still participates in the fill but is not stroked. "P" draws a marker at the point. The fill path
// always closes. A move/line model cannot express a closed fill with a disconnected stroke without
// duplicating geometry, which is why this is kept as-is.

const FLAG_STROKE = 1;
const FLAG_MARKER = 2;

const DEFAULT_STYLE = {
  fill: "none",
  stroke: "#000000",
  lineWidth: 1.0,
  lineCap: "butt",
  lineJoin: "miter",
  miterLimit: 4.0,
  markerRadius: 3.5,
  markerFill: "#000000",
  align: "center",
  baseline: "alphabetic",
  font: "sans-serif",
};

function resolveStyle(spec, styleSheet) {
  const base = spec.class && styleSheet && styleSheet[spec.class] ? styleSheet[spec.class] : (styleSheet && styleSheet.default) || DEFAULT_STYLE;
  const out = Object.assign({}, DEFAULT_STYLE, base);
  if (spec.fill !== undefined) out.fill = spec.fill;
  if (spec.stroke !== undefined) out.stroke = spec.stroke;
  if (spec.lineWidth !== undefined) out.lineWidth = spec.lineWidth;
  if (spec.lineCap !== undefined) out.lineCap = spec.lineCap;
  if (spec.lineJoin !== undefined) out.lineJoin = spec.lineJoin;
  if (spec.miterLimit !== undefined) out.miterLimit = spec.miterLimit;
  if (spec.markerRadius !== undefined) out.markerRadius = spec.markerRadius;
  if (spec.markerFill !== undefined) out.markerFill = spec.markerFill;
  if (spec.align !== undefined) out.align = spec.align;
  if (spec.baseline !== undefined) out.baseline = spec.baseline;
  if (spec.font !== undefined) out.font = spec.font;
  return out;
}

// A single compiled drawable.
class Drawable {
  constructor(kind) {
    this.kind = kind; // "path" | "text" | "marker"
    this.xs = null;
    this.ys = null;
    this.ws = null;
    this.flags = null;
    this.closed = true;
    this.text = null;
    this.style = DEFAULT_STYLE;
    this.cap = null;
    this.visibleFrom = 0;
    this.visibleTo = 1;
  }
}

// Convert a 2011-shaped drawable into the v2 shape. Exported so callers with legacy data can
// convert explicitly; `compileDrawables` also detects and applies it automatically.
function readLegacyDrawable(d) {
  if (d.type === "polygon") {
    const points = [];
    for (const p of d.d) {
      if (p.length > 2 && p[2]) points.push([p[0], p[1], p[2]]);
      else points.push([p[0], p[1]]);
    }
    const out = { type: "path", points: points, closed: true };
    if (d.fillStyle !== undefined) out.fill = d.fillStyle;
    if (d.strokeStyle !== undefined) out.stroke = d.strokeStyle;
    if (d.lineWidth !== undefined) out.lineWidth = d.lineWidth;
    if (d.lineCap !== undefined) out.lineCap = d.lineCap;
    if (d.lineJoin !== undefined) out.lineJoin = d.lineJoin;
    if (d.miterLimit !== undefined) out.miterLimit = d.miterLimit;
    if (d.class !== undefined) out.class = d.class;
    return out;
  }
  if (d.type === "text") {
    const out = {
      type: "text",
      text: d.d,
      at: [d.ax, d.ay],
      up: [d.upx, d.upy],
    };
    if (d.fillStyle !== undefined) out.fill = d.fillStyle;
    if (d.textAlign !== undefined) out.align = d.textAlign;
    if (d.textBaseline !== undefined) out.baseline = d.textBaseline;
    if (d.font !== undefined) out.font = d.font;
    if (d.class !== undefined) out.class = d.class;
    return out;
  }
  return null;
}

function isLegacy(d) {
  return d && (d.type === "polygon" || (d.type === "text" && d.ax !== undefined));
}

function compileOne(spec, styleSheet) {
  const src = isLegacy(spec) ? readLegacyDrawable(spec) : spec;
  if (!src) return null;

  if (src.type === "path" || src.type === "polygon") {
    const pts = src.points || src.d;
    const n = pts.length;
    if (n === 0) return null;
    const out = new Drawable("path");
    out.xs = new Float64Array(n);
    out.ys = new Float64Array(n);
    out.ws = new Float64Array(n);
    out.flags = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      out.xs[i] = p[0];
      out.ys[i] = p[1];
      out.ws[i] = localCompanion(p[0], p[1]);
      const f = p.length > 2 && typeof p[2] === "string" ? p[2].toLowerCase() : "";
      let bits = 0;
      if (f.indexOf("l") !== -1) bits |= FLAG_STROKE;
      if (f.indexOf("p") !== -1) bits |= FLAG_MARKER;
      out.flags[i] = bits;
    }
    out.closed = src.closed !== false;
    out.style = resolveStyle(src, styleSheet);
    out.cap = Cap.enclosing(out.xs, out.ys, 0, n);
    if (src.visibleFrom !== undefined) out.visibleFrom = src.visibleFrom;
    if (src.visibleTo !== undefined) out.visibleTo = src.visibleTo;
    return out;
  }

  if (src.type === "text") {
    const out = new Drawable("text");
    const at = src.at;
    const up = src.up;
    out.xs = new Float64Array([at[0], up[0]]);
    out.ys = new Float64Array([at[1], up[1]]);
    out.ws = new Float64Array([localCompanion(at[0], at[1]), localCompanion(up[0], up[1])]);
    out.text = String(src.text);
    out.style = resolveStyle(src, styleSheet);
    out.cap = Cap.enclosing(out.xs, out.ys, 0, 2);
    if (src.visibleFrom !== undefined) out.visibleFrom = src.visibleFrom;
    if (src.visibleTo !== undefined) out.visibleTo = src.visibleTo;
    return out;
  }

  if (src.type === "marker") {
    const out = new Drawable("marker");
    out.xs = new Float64Array([src.at[0]]);
    out.ys = new Float64Array([src.at[1]]);
    out.ws = new Float64Array([localCompanion(src.at[0], src.at[1])]);
    out.style = resolveStyle(src, styleSheet);
    if (src.radius !== undefined) out.style.markerRadius = src.radius;
    out.cap = Cap.enclosing(out.xs, out.ys, 0, 1);
    return out;
  }

  return null;
}

// Accepts an array of drawables, or a {version, drawables} document, in either schema.
function compileDrawables(data, styleSheet) {
  let list;
  if (Array.isArray(data)) list = data;
  else if (data && Array.isArray(data.drawables)) list = data.drawables;
  else if (data == null) list = [];
  else throw new TypeError("expected an array of drawables or a { drawables: [...] } document");

  const out = [];
  for (let i = 0; i < list.length; i++) {
    // The 2011 renderer used `while (drawable = nextDrawable())`, so a falsy entry silently
    // truncated the whole stream. Skip and keep going instead.
    if (!list[i]) continue;
    const c = compileOne(list[i], styleSheet);
    if (c) out.push(c);
  }
  return out;
}

// ===== src/render/renderer.js =====
// The draw pipeline.
//
// Stage order, which is also the hook order and is what lets an example page draw things like a
// world-turtle behind the disk without the library knowing anything about turtles:
//
//   1  clear
//   2  layers with z < 0, then onBeforeDraw          <- outside the disk, e.g. stars, turtle shell
//   3  the disk fill (opaque, so it hides step 2 inside the disk)
//   4  content
//   5  the rim annulus
//   6  layers with z > 0, then onAfterDraw           <- overlays
//
// Coordinates: the library works in CSS pixels throughout. The surface applies the
// devicePixelRatio transform once, so nothing here has to think about it.

// The 2011 constants, for the faithful-port mode.
const LEGACY_MAX_STRAIGHT_LINE_LENGTH = 0.1;
const FONT_SCALE = 0.05;
// The 2011 renderer set a fixed `14pt sans-serif` font and then applied `ctx.scale(size, size)`, so
// its `size` was a dimensionless MULTIPLIER, not a pixel height -- and its MIN_TEXT_SIZE = 0.5 was a
// multiplier too. 14pt is 14 * 96/72 px. Reading `size` as pixels makes every glyph sub-pixel and
// silently drops all the text, which is exactly what happened on the first attempt at this port.
const LEGACY_BASE_FONT_PX = (14 * 96) / 72;

const scratch = [0, 0];
const arc = new Arc();

class RenderStats {
  constructor() {
    this.reset();
  }
  reset() {
    this.drawables = 0;
    this.survivors = 0;
    this.drawn = 0;
    this.pointsProjected = 0;
    this.canvasCalls = 0;
    this.textDrawn = 0;
    this.textSkipped = 0;
  }
}

// Culling modes.
//   "endpoints" reproduces the 2011 test: keep an edge only if one of its two projected endpoints
//               is inside the draw radius. This WRONGLY DROPS long edges that cross the visible
//               region without either endpoint inside it, and it also runs after all the projection
//               work, so it saves nothing. Kept so the defect can be seen and compared.
//   "cap"       rejects a whole drawable up front with a 6-multiply Minkowski test against its
//               precomputed bounding cap. Correct, and far cheaper.
const CULL_ENDPOINTS = "endpoints";
const CULL_CAP = "cap";

class Renderer {
  constructor() {
    this.stats = new RenderStats();
  }

  // `view` is the read-only geometry descriptor built by the surface:
  //   { cx, cy, radius, zoom, rotation, width, height, drawRadius, interactRadius, matrix, ... }
  // `passes` is an array of { drawables, matrix }: one entry per source, each with the matrix its
  // coordinates should be drawn with.
  draw(ctx, view, passes, options) {
    const stats = this.stats;
    stats.reset();

    const {
      background = "#ffffff",
      pageBackground = null,
      rimFill = "#f5d6ab",
      rimStroke = "#000000",
      rimLineWidth = 1.5,
      layers = [],
      onBeforeDraw = null,
      onAfterDraw = null,
      onDrawBackground = null,
      onDrawRim = null,
      cullMode = CULL_CAP,
      arcMode = "sagitta",
      sagittaTolerancePx = 0.25,
      minTextPx = 3,
      minFeaturePx = 0,
    } = options || {};

    ctx.clearRect(0, 0, view.width, view.height);

    if (pageBackground) {
      ctx.fillStyle = pageBackground;
      ctx.fillRect(0, 0, view.width, view.height);
    }

    for (const layer of layers) if ((layer.z || 0) < 0) layer.draw(ctx, view);
    if (onBeforeDraw) onBeforeDraw(ctx, view);

    // The disk interior. Opaque, which is what confines the "outside" layers to the outside.
    if (onDrawBackground) {
      onDrawBackground(ctx, view);
    } else if (background && background !== "none") {
      ctx.fillStyle = background;
      ctx.beginPath();
      ctx.arc(view.cx, view.cy, view.radius, 0, 2 * Math.PI);
      ctx.fill();
    }

    if (passes && passes.length) {
      for (const pass of passes) {
        // A pass may carry a clip region: that is how atlas tiles abut without overlapping. Each is
        // a closure that traces the tile boundary and calls ctx.clip(), so the renderer stays
        // ignorant of tiling shapes (geodesic polygons vs. horocyclic cells).
        if (pass.clip) {
          ctx.save();
          pass.clip(ctx, view);
        }
        this.drawContent(ctx, view, pass.drawables, pass.matrix, {
          cullMode,
          arcMode,
          sagittaTolerancePx,
          minTextPx,
          minFeaturePx,
        });
        if (pass.clip) ctx.restore();
      }
    }

    // The rim annulus. Its inner edge is the INTERACTION radius, because that ring is what the user
    // drags to rotate -- drawing it there is what makes the affordance visible. It is painted after
    // the content, so it also masks anything drawn beyond it.
    if (onDrawRim) {
      onDrawRim(ctx, view);
    } else {
      const inner = view.interactRadius * view.radius;
      if (rimFill && rimFill !== "none") {
        ctx.fillStyle = rimFill;
        ctx.beginPath();
        ctx.arc(view.cx, view.cy, view.radius, 0, 2 * Math.PI);
        ctx.arc(view.cx, view.cy, inner, 2 * Math.PI, 0, true);
        ctx.fill();
      }
      if (rimStroke && rimStroke !== "none") {
        ctx.strokeStyle = rimStroke;
        ctx.lineWidth = rimLineWidth;
        ctx.beginPath();
        ctx.arc(view.cx, view.cy, view.radius, 0, 2 * Math.PI);
        ctx.stroke();
        if (view.interactRadius < 1) {
          ctx.beginPath();
          ctx.arc(view.cx, view.cy, inner, 0, 2 * Math.PI);
          ctx.stroke();
        }
      }
    }

    for (const layer of layers) if ((layer.z || 0) >= 0) layer.draw(ctx, view);
    if (onAfterDraw) onAfterDraw(ctx, view);
  }

  drawContent(ctx, view, scene, matrix, opts) {
    const stats = this.stats;
    const m = matrix || view.matrix;
    const scale = view.radius;
    const shiftX = view.cx;
    const shiftY = view.cy;
    const drawRadius = view.drawRadius;
    const drawRadius2 = drawRadius * drawRadius;

    // Everything the cap test needs, computed once per frame.
    const centre = m.centreLocal([0, 0]);
    const cX = centre[0];
    const cY = centre[1];
    const cW = Math.sqrt(1 + cX * cX + cY * cY);
    const inDiskThreshold2 = screenRadiusToThresholdSquared(Math.min(drawRadius, 0.999999));
    const capCache = new Map();

    const straightIfShorterThan = opts.arcMode === "fixed" ? LEGACY_MAX_STRAIGHT_LINE_LENGTH : 0;
    // The sagitta tolerance is given in pixels; convert to disk units for this frame's zoom.
    const sagittaTolerance = opts.arcMode === "fixed" ? 0 : opts.sagittaTolerancePx / scale;

    stats.drawables += scene.length;

    for (let di = 0; di < scene.length; di++) {
      const d = scene[di];

      if (opts.cullMode === CULL_CAP) {
        let thr = capCache.get(d.cap.radius);
        if (thr === undefined) {
          thr = capThreshold(Math.min(drawRadius, 0.999999), d.cap.radius);
          capCache.set(d.cap.radius, thr);
        }
        if (!capMayBeVisible(d.cap, cX, cY, cW, thr)) continue;
      }
      stats.survivors++;

      if (d.kind === "path") this.drawPath(ctx, d, m, scale, shiftX, shiftY, drawRadius2, straightIfShorterThan, sagittaTolerance, opts, inDiskThreshold2, cX, cY, cW);
      else if (d.kind === "text") this.drawText(ctx, d, m, scale, shiftX, shiftY, opts);
      else if (d.kind === "marker") this.drawMarker(ctx, d, m, scale, shiftX, shiftY);
    }
  }

  drawPath(ctx, d, m, scale, shiftX, shiftY, drawRadius2, straightIfShorterThan, sagittaTolerance, opts, inDiskThreshold2, cX, cY, cW) {
    const stats = this.stats;
    const n = d.xs.length;
    if (n < 2) return;

    // Project every vertex exactly once. The 2011 code projected each vertex twice -- once as the
    // start of its own edge and once as the end of the previous one.
    const px = new Float64Array(n);
    const py = new Float64Array(n);
    let anyInside = false;
    for (let i = 0; i < n; i++) {
      m.applyToLocal(d.xs[i], d.ys[i], d.ws[i], scratch);
      px[i] = scratch[0];
      py[i] = scratch[1];
      if (px[i] * px[i] + py[i] * py[i] < drawRadius2) anyInside = true;
    }
    stats.pointsProjected += n;

    if (opts.cullMode === CULL_ENDPOINTS && !anyInside) return;
    stats.drawn++;

    const style = d.style;
    const last = d.closed ? n : n - 1;

    // Build the fill path (all edges, closed) and the stroke path (only flagged edges).
    const doFill = style.fill && style.fill !== "none";
    const doStroke = style.stroke && style.stroke !== "none";

    if (doFill) {
      ctx.beginPath();
      ctx.moveTo(px[0] * scale + shiftX, -py[0] * scale + shiftY);
      for (let i = 0; i < last; i++) {
        const j = (i + 1) % n;
        this.edgeTo(ctx, px[i], py[i], px[j], py[j], scale, shiftX, shiftY, straightIfShorterThan, sagittaTolerance);
      }
      ctx.closePath();
      ctx.fillStyle = style.fill;
      // No save()/clip()/restore() here. The 2011 code built this path, clipped to it, rebuilt the
      // identical path, and filled -- but fill INTERSECT clip == fill, so the clip was a no-op and
      // the path was constructed twice.
      ctx.fill();
      stats.canvasCalls++;
    }

    if (doStroke) {
      ctx.beginPath();
      let penAt = -1;
      for (let i = 0; i < last; i++) {
        if (!(d.flags[i] & FLAG_STROKE)) continue;
        const j = (i + 1) % n;
        if (penAt !== i) ctx.moveTo(px[i] * scale + shiftX, -py[i] * scale + shiftY);
        this.edgeTo(ctx, px[i], py[i], px[j], py[j], scale, shiftX, shiftY, straightIfShorterThan, sagittaTolerance);
        penAt = j;
      }
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = style.lineWidth;
      ctx.lineCap = style.lineCap;
      ctx.lineJoin = style.lineJoin;
      ctx.miterLimit = style.miterLimit;
      ctx.stroke();
      stats.canvasCalls++;
    }

    // Vertex markers.
    let hasMarker = false;
    for (let i = 0; i < n; i++) if (d.flags[i] & FLAG_MARKER) { hasMarker = true; break; }
    if (hasMarker) {
      // The 2011 code read the marker radius out of the FILL COLOUR field, giving ctx.arc a string
      // radius, hence NaN, hence no markers at all. None of the four shipped datasets uses marker
      // flags, so it was unobservable there -- but it is fixed here rather than reproduced.
      ctx.fillStyle = style.markerFill;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (!(d.flags[i] & FLAG_MARKER)) continue;
        const sx = px[i] * scale + shiftX;
        const sy = -py[i] * scale + shiftY;
        ctx.moveTo(sx + style.markerRadius, sy);
        ctx.arc(sx, sy, style.markerRadius, 0, 2 * Math.PI);
      }
      ctx.fill();
      stats.canvasCalls++;
    }
  }

  edgeTo(ctx, x1, y1, x2, y2, scale, shiftX, shiftY, straightIfShorterThan, sagittaTolerance) {
    geodesicArc(x1, y1, x2, y2, arc, straightIfShorterThan, sagittaTolerance);
    if (arc.straight) {
      ctx.lineTo(x2 * scale + shiftX, -y2 * scale + shiftY);
    } else {
      // Canvas y points down, so a mathematical angle theta becomes -theta and the sweep sense
      // flips with it.
      ctx.arc(
        arc.cx * scale + shiftX,
        -arc.cy * scale + shiftY,
        arc.r * scale,
        -arc.startAngle,
        -arc.endAngle,
        arc.anticlockwise,
      );
    }
  }

  drawText(ctx, d, m, scale, shiftX, shiftY, opts) {
    const stats = this.stats;
    m.applyToLocal(d.xs[0], d.ys[0], d.ws[0], scratch);
    const ax = scratch[0];
    const ay = scratch[1];
    m.applyToLocal(d.xs[1], d.ys[1], d.ws[1], scratch);
    const ux = scratch[0];
    const uy = scratch[1];
    stats.pointsProjected += 2;

    // The up-vector's projected length sets the size, so text shrinks with the hyperbolic
    // foreshortening exactly like the geometry around it.
    const sizePx = scale * FONT_SCALE * Math.hypot(ux - ax, uy - ay) * LEGACY_BASE_FONT_PX;
    if (!(sizePx > opts.minTextPx)) {
      stats.textSkipped++;
      return;
    }

    ctx.save();
    ctx.fillStyle = d.style.fill && d.style.fill !== "none" ? d.style.fill : "#000000";
    ctx.textAlign = d.style.align;
    ctx.textBaseline = d.style.baseline;
    // A real font size, not ctx.scale() on a fixed 14pt font: scaling also scales stroke widths and
    // defeats font hinting.
    ctx.font = `${sizePx}px ${d.style.font}`;
    ctx.translate(ax * scale + shiftX, -ay * scale + shiftY);
    ctx.rotate(-Math.atan2(uy - ay, ux - ax) + Math.PI / 2);
    ctx.fillText(d.text, 0, 0);
    ctx.restore();
    stats.textDrawn++;
    stats.canvasCalls++;
  }

  drawMarker(ctx, d, m, scale, shiftX, shiftY) {
    m.applyToLocal(d.xs[0], d.ys[0], d.ws[0], scratch);
    this.stats.pointsProjected++;
    ctx.fillStyle = d.style.markerFill;
    ctx.beginPath();
    ctx.arc(scratch[0] * scale + shiftX, -scratch[1] * scale + shiftY, d.style.markerRadius, 0, 2 * Math.PI);
    ctx.fill();
    this.stats.canvasCalls++;
  }
}

// ===== src/input/pointer.js =====
// Gesture recognition, on Pointer Events only.
//
// One code path for mouse, touch and pen. `touch-action: none` on the canvas suppresses the
// browser's own panning and zooming, and `pointercancel` subsumes `touchcancel`, so no separate
// touch listeners are needed.
//
// ---------------------------------------------------------------------------------------------
// THE STUCK-DRAG FIX
//
// In the 2011 code `mousedown`, `mousemove` and `mouseup` were all bound to the canvas. Releasing
// the button anywhere outside the canvas therefore never delivered `mouseup`, `isMouseScrolling`
// stayed true, and the map kept following the cursor on re-entry with no button held.
//
// A second, compounding defect: `updateOffset` was GATED on the cursor being inside the interaction
// radius, so dragging past the rim silently froze the pan instead of clamping it -- and then
// resumed from where it froze. Together these are what made the bug feel erratic.
//
// Defence in depth here, because any single mechanism can be defeated:
//   1. setPointerCapture on pointerdown, so moves and the release are delivered even off-canvas;
//   2. end the gesture on pointerup, pointercancel AND lostpointercapture;
//   3. in pointermove, if a mouse reports buttons === 0 the button is already up (this catches a
//      release swallowed by a native drag, an alert, or devtools stealing focus);
//   4. window blur and document visibilitychange cancel;
//   5. every active pointer is tracked in a Map, so destroy() can release captures deterministically.
// ---------------------------------------------------------------------------------------------

const MODE_IDLE = "idle";
const MODE_PAN = "pan";
const MODE_ROTATE = "rotate";
const MODE_PINCH = "pinch";

// Clamp a disk point to a given radius, preserving direction. Used instead of ignoring
// out-of-range positions, which is what froze the 2011 pan.
function clampToRadius(x, y, radius) {
  const r = Math.hypot(x, y);
  if (r <= radius || r === 0) return [x, y];
  const k = radius / r;
  return [x * k, y * k];
}

class PointerInput {
  // `host` abstracts the DOM so this is testable in Node:
  //   { element, window, document, toDisk(event) -> [x, y] }
  constructor(host, viewState, options, callbacks) {
    this.host = host;
    this.view = viewState;
    this.options = options;
    this.callbacks = callbacks || {};
    this.pointers = new Map();
    this.mode = MODE_IDLE;
    this.disposed = false;

    const el = host.element;
    if (el.style) {
      el.style.touchAction = "none";
      el.style.userSelect = "none";
      el.style.webkitTapHighlightColor = "transparent";
    }

    this.onPointerDown = (e) => this.handleDown(e);
    this.onPointerMove = (e) => this.handleMove(e);
    this.onPointerUp = (e) => this.handleUp(e);
    this.onPointerCancel = (e) => this.handleCancel(e);
    this.onLostCapture = (e) => this.handleCancel(e);
    this.onWheel = (e) => this.handleWheel(e);
    this.onBlur = () => this.cancelAll();
    this.onVisibility = () => {
      if (host.document && host.document.hidden) this.cancelAll();
    };
    this.onContextMenu = () => this.cancelAll();

    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointercancel", this.onPointerCancel);
    el.addEventListener("lostpointercapture", this.onLostCapture);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("contextmenu", this.onContextMenu);
    if (host.window) host.window.addEventListener("blur", this.onBlur);
    if (host.document) host.document.addEventListener("visibilitychange", this.onVisibility);
  }

  changed() {
    if (this.callbacks.onChange) this.callbacks.onChange();
  }

  gestureEnded() {
    if (this.callbacks.onGestureEnd) this.callbacks.onGestureEnd();
  }

  handleDown(e) {
    if (this.disposed) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!this.options.interactive) return;

    const [x, y] = this.host.toDisk(e, this.view.liveZoom);
    const r2 = x * x + y * y;
    if (r2 >= 1) return; // outside the disk entirely: not ours, do not capture

    try {
      this.host.element.setPointerCapture(e.pointerId);
    } catch (err) {
      // Some environments (and the test double) do not implement capture; the window-level
      // fallbacks still cover us.
    }
    this.pointers.set(e.pointerId, { x, y });
    if (e.preventDefault) e.preventDefault();

    const interact = this.options.interactRadius;
    if (this.pointers.size === 1) {
      if (r2 < interact * interact) {
        if (!this.options.allowPan) return;
        this.mode = MODE_PAN;
        this.view.beginPan(x, y);
      } else {
        // In the annulus between the interaction radius and the disk edge.
        if (!this.options.allowRotate || !this.options.rimRotate) return;
        this.mode = MODE_ROTATE;
        this.view.beginRotate(x, y);
      }
      if (this.callbacks.onGestureStart) this.callbacks.onGestureStart(this.mode);
    } else if (this.pointers.size === 2) {
      const [p1, p2] = [...this.pointers.values()];
      // Commit whatever the single-pointer gesture achieved, then start the pinch from there.
      this.view.commit();
      this.mode = MODE_PINCH;
      this.view.beginPinch(p1.x, p1.y, p2.x, p2.y);
      if (this.callbacks.onGestureStart) this.callbacks.onGestureStart(this.mode);
    }
    this.changed();
  }

  handleMove(e) {
    if (this.disposed) return;
    if (!this.pointers.has(e.pointerId)) return;

    // Guard 3: a mouse with no buttons held has already been released, whatever events did or did
    // not arrive.
    if (e.pointerType === "mouse" && e.buttons === 0) {
      this.endPointer(e.pointerId);
      return;
    }

    const [x, y] = this.host.toDisk(e, this.view.liveZoom);
    this.pointers.get(e.pointerId).x = x;
    this.pointers.get(e.pointerId).y = y;
    if (e.preventDefault) e.preventDefault();

    if (this.mode === MODE_PAN) {
      // Clamp rather than ignore. Ignoring is what made the 2011 drag freeze past the rim and then
      // resume from the stale position.
      const [cx, cy] = this.options.panClamp
        ? clampToRadius(x, y, this.options.interactRadius)
        : [x, y];
      if (!this.options.panClamp && cx * cx + cy * cy >= this.options.interactRadius ** 2) return;
      this.view.updatePan(cx, cy);
      this.changed();
    } else if (this.mode === MODE_ROTATE) {
      this.view.updateRotate(x, y);
      this.changed();
    } else if (this.mode === MODE_PINCH && this.pointers.size >= 2) {
      const [p1, p2] = [...this.pointers.values()];
      this.view.updatePinch(
        p1.x, p1.y, p2.x, p2.y,
        this.options.allowZoom,
        this.options.allowRotate,
      );
      this.changed();
    }
  }

  handleUp(e) {
    if (this.disposed) return;
    this.endPointer(e.pointerId);
  }

  handleCancel(e) {
    if (this.disposed) return;
    this.endPointer(e.pointerId);
  }

  endPointer(pointerId) {
    if (!this.pointers.has(pointerId)) return;
    this.pointers.delete(pointerId);
    try {
      this.host.element.releasePointerCapture(pointerId);
    } catch (err) {
      /* not captured, or unsupported */
    }

    if (this.pointers.size === 0) {
      this.view.commit();
      this.mode = MODE_IDLE;
      this.changed();
      this.gestureEnded();
    } else if (this.pointers.size === 1 && this.mode === MODE_PINCH) {
      // Lifting one of two fingers resumes a one-finger pan from the survivor, matching the 2011
      // behaviour.
      this.view.commit();
      const p = [...this.pointers.values()][0];
      if (p.x * p.x + p.y * p.y < this.options.interactRadius ** 2 && this.options.allowPan) {
        this.mode = MODE_PAN;
        this.view.beginPan(p.x, p.y);
      } else {
        this.mode = MODE_IDLE;
      }
      this.changed();
    }
  }

  cancelAll() {
    if (this.disposed) return;
    if (this.pointers.size === 0 && this.mode === MODE_IDLE) return;
    for (const id of [...this.pointers.keys()]) {
      try {
        this.host.element.releasePointerCapture(id);
      } catch (err) {
        /* ignore */
      }
    }
    this.pointers.clear();
    this.view.commit();
    this.mode = MODE_IDLE;
    this.changed();
    this.gestureEnded();
  }

  handleWheel(e) {
    if (this.disposed) return;
    // Unlike 2011, allowZoom actually gates the wheel. There, the option was consulted only in the
    // two-finger path, so `allowZoom: false` pages were still wheel-zoomable.
    if (!this.options.interactive || !this.options.allowZoom || !this.options.wheelZoom) return;
    const [x, y] = this.host.toDisk(e, this.view.liveZoom);
    if (x * x + y * y >= this.options.drawRadius ** 2) return;
    if (e.preventDefault) e.preventDefault();

    // Normalise across deltaMode: 0 = pixels, 1 = lines, 2 = pages.
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 16;
    else if (e.deltaMode === 2) delta *= 100;
    // Wheel up (negative deltaY) zooms in.
    const steps = -delta / 120;
    this.view.zoomBy(Math.pow(this.options.wheelZoomStep, steps));
    this.changed();
    if (!this.view.gesture) this.gestureEnded();
  }

  destroy() {
    this.disposed = true;
    const el = this.host.element;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointercancel", this.onPointerCancel);
    el.removeEventListener("lostpointercapture", this.onLostCapture);
    el.removeEventListener("wheel", this.onWheel);
    el.removeEventListener("contextmenu", this.onContextMenu);
    if (this.host.window) this.host.window.removeEventListener("blur", this.onBlur);
    if (this.host.document) this.host.document.removeEventListener("visibilitychange", this.onVisibility);
    for (const id of [...this.pointers.keys()]) {
      try {
        el.releasePointerCapture(id);
      } catch (err) {
        /* ignore */
      }
    }
    this.pointers.clear();
  }
}

// ===== src/data/source.js =====
// Data sources.
//
// A source supplies compiled drawables for the current view. Three flavours:
//
//   StaticSource    a fixed array, compiled once.
//   CallbackSource  an async function of the view, with caching, in-flight de-duplication and
//                   AbortSignal cancellation.
//
// The 2011 client re-fetched only on mouseup/touchend, which is the whole reason distant elements
// appeared only after the drag was released. Here the source is consulted every frame; the throttle
// and the significance gate keep that cheap, and results arrive and render mid-gesture.

class StaticSource {
  constructor(data, styleSheet) {
    this.drawables = compileDrawables(data, styleSheet);
    this.transform = null;
  }
  // Same array whatever the view: culling happens in the renderer.
  get(/* view */) {
    return this.drawables;
  }
  setData(data, styleSheet) {
    this.drawables = compileDrawables(data, styleSheet);
  }
}

class CallbackSource {
  constructor(fn, options = {}) {
    this.fn = fn;
    this.styleSheet = options.styleSheet;
    // Do not ask again until the view centre has moved by this fraction of the visible radius, or
    // the zoom has changed by this fraction. Without a gate, a per-frame source would issue a
    // request every frame of a drag.
    this.moveFraction = options.moveFraction !== undefined ? options.moveFraction : 0.25;
    this.zoomFraction = options.zoomFraction !== undefined ? options.zoomFraction : 0.1;
    this.throttleMs = options.throttleMs !== undefined ? options.throttleMs : 120;

    this.drawables = [];
    this.lastRequest = null; // {cx, cy, cw, zoom}
    this.lastRequestTime = -Infinity;
    this.inFlight = null;
    this.controller = null;
    this.onLoad = options.onLoad || null;
    this.onError = options.onError || null;
  }

  // Has the view changed enough to be worth asking again?
  //
  // The gate is measured ON SCREEN, not in hyperbolic distance. The first version compared the
  // hyperbolic distance moved against 2*artanh(drawRadius) -- but drawRadius is 1.0 by default, and
  // artanh(1) is infinite: the whole hyperbolic plane is inside the disk. That made the threshold
  // about 7.3 hyperbolic units, so a provider was effectively asked exactly ONCE, at construction,
  // and never again however far the user scrolled. Content simply never arrived.
  //
  // What actually matters is whether the previously-requested region has slid off the screen. So:
  // project the previous request's centre under the CURRENT view and see how far it has drifted from
  // the middle, as a fraction of the disk radius. That is bounded, scale-free, and directly
  // meaningful, and it behaves sensibly at every zoom.
  needsRequest(view, now) {
    if (!this.lastRequest) return true;
    if (now - this.lastRequestTime < this.throttleMs) return false;
    const prev = this.lastRequest;
    if (Math.abs(view.zoom - prev.zoom) / prev.zoom > this.zoomFraction) return true;
    const out = view.matrix.applyToLocal(prev.cx, prev.cy, prev.cw, [0, 0]);
    const drift = Math.hypot(out[0], out[1]);
    return drift > this.moveFraction * Math.min(view.drawRadius, view.effectiveRadius || view.drawRadius);
  }

  get(view, now) {
    const t = now === undefined ? (typeof performance !== "undefined" ? performance.now() : Date.now()) : now;
    if (this.needsRequest(view, t)) this.request(view, t);
    return this.drawables;
  }

  // Ask again regardless of the gate. Called when a gesture ends, so the view the user actually
  // stopped on is never left showing throttled-away data: the throttle can otherwise swallow the
  // last movement of a drag and leave the final frame stale until the user moves again.
  refresh(view) {
    const t = typeof performance !== "undefined" ? performance.now() : Date.now();
    this.request(view, t);
  }

  request(view, now) {
    const centre = view.matrix.centreLocal([0, 0]);
    const cw = Math.sqrt(1 + centre[0] ** 2 + centre[1] ** 2);
    this.lastRequest = { cx: centre[0], cy: centre[1], cw: cw, zoom: view.zoom };
    this.lastRequestTime = now;

    // Supersede any request still outstanding.
    if (this.controller) {
      try {
        this.controller.abort();
      } catch (err) {
        /* ignore */
      }
    }
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    this.controller = controller;

    const req = {
      centre: [centre[0], centre[1]],
      zoom: view.zoom,
      drawRadius: view.drawRadius,
      // How much of the disk can actually be on screen at this zoom. At zoom 3 on a square canvas
      // only |z| < 0.47 is visible, so a provider that used drawRadius would fetch ~4x too much.
      visibleRadius: view.effectiveRadius,
      signal: controller ? controller.signal : undefined,
    };

    const p = Promise.resolve()
      .then(() => this.fn(req))
      .then((data) => {
        if (this.controller !== controller) return; // superseded
        this.drawables = compileDrawables(data, this.styleSheet);
        if (this.onLoad) this.onLoad(this.drawables);
      })
      .catch((err) => {
        if (err && (err.name === "AbortError" || err.name === "CanceledError")) return;
        if (this.onError) this.onError(err);
        else if (typeof console !== "undefined") console.error("hyperbolic-map: data source failed", err);
      });
    this.inFlight = p;
    return p;
  }

  destroy() {
    if (this.controller) {
      try {
        this.controller.abort();
      } catch (err) {
        /* ignore */
      }
    }
    this.controller = null;
  }
}

// ===== src/data/atlas/tiling.js =====
// Tilings of the hyperbolic plane.
//
// A tiling supplies, for each tile: an integer key, the isometry carrying tile-local coordinates into
// the world, and the tile's boundary (for clipping). Two are built in.
//
// All the metric relations below were verified BY CONSTRUCTION -- build the polygon and measure --
// rather than formula against formula, which is how an inverted inradius slipped through the first
// time. See notes/tilings.md.

// Boundary edge kinds. Geodesics are circles orthogonal to the unit circle; horocycles are circles
// internally TANGENT to it. The binary tiling needs both.
const EDGE_GEODESIC = "geodesic";
const EDGE_HOROCYCLE = "horocycle";

// ---------------------------------------------------------------------------------------------
// Regular {p, q}
// ---------------------------------------------------------------------------------------------

// At curvature K = -1, for a regular p-gon with vertex angle 2*pi/q:
//
//     circumradius   cosh(chi) = cot(pi/p) * cot(pi/q)
//     inradius       cosh(psi) = cos(pi/q) / sin(pi/p)
//     half-edge      cosh(phi) = cos(pi/p) / sin(pi/q)
//     check          cosh(chi) = cosh(psi) * cosh(phi)
//
// TRAP: cos(pi/p)/sin(pi/q) is the HALF-EDGE, not the inradius. The two swap under p <-> q and
// coincide for self-dual {p,p}, so an inverted formula survives casual checking.
function regularMetrics(p, q) {
  if (!(1 / p + 1 / q < 0.5)) {
    throw new Error(`hyperbolic-map: {${p},${q}} is not hyperbolic (need 1/p + 1/q < 1/2)`);
  }
  const chi = Math.acosh(1 / (Math.tan(Math.PI / p) * Math.tan(Math.PI / q)));
  const psi = Math.acosh(Math.cos(Math.PI / q) / Math.sin(Math.PI / p));
  const phi = Math.acosh(Math.cos(Math.PI / p) / Math.sin(Math.PI / q));
  return {
    p,
    q,
    circumradius: chi,
    inradius: psi,
    halfEdge: phi,
    edgeLength: 2 * phi,
    centreSpacing: 2 * psi,
  };
}

class RegularTiling {
  // `frameSymmetry` (m, a divisor of p) is the rotational symmetry the tile art is promised to have.
  // It selects the walk group so that the tile stabiliser is C_m, which is what makes "the same data
  // in every tile" produce a consistent pattern. See notes/tilings.md and
  // notes/escher-circle-limit-iii.md -- for Circle Limit III this must be 4, not 8, and using the
  // default half-turn generators there would silently shred the pattern.
  constructor({ p, q, frameSymmetry = null } = {}) {
    this.metrics = regularMetrics(p, q);
    this.p = p;
    this.q = q;
    this.m = frameSymmetry || p;
    if (p % this.m !== 0) {
      throw new Error(`hyperbolic-map: frameSymmetry ${this.m} must divide p = ${p}`);
    }

    const psi = this.metrics.inradius;
    const chi = this.metrics.circumradius;

    // Vertices at angles pi/p + 2*pi*k/p, so that EDGE MIDPOINTS land on 2*pi*k/p (edge 0's midpoint
    // is on the +x axis).
    this.vertexDisk = [];
    for (let k = 0; k < p; k++) {
      const a = Math.PI / p + (2 * Math.PI * k) / p;
      this.vertexDisk.push([Math.tanh(chi / 2) * Math.cos(a), Math.tanh(chi / 2) * Math.sin(a)]);
    }

    // Generators.
    if (this.m === p) {
      // Half-turn about each edge midpoint. Always a symmetry of {p,q} -- it is the "2" of the
      // (2,p,q) triangle group -- including for ODD p. (Only pure TRANSLATIONS between adjacent
      // tiles need even p; do not confuse the two.) Each is an involution, so the edge back to the
      // parent carries the same index in the child, which makes words walk-reversible for free.
      const g0 = new Isom(0, Math.cosh(psi), 0, -Math.sinh(psi));
      this.generators = [];
      for (let k = 0; k < p; k++) {
        const s = Isom.rotation((2 * Math.PI * k) / p);
        this.generators.push(s.mul(g0).mul(Isom.rotation((-2 * Math.PI * k) / p)));
      }
    } else {
      // The half-turn is generally outside the subgroup with stabiliser C_m, so use rotations about
      // the vertices instead. Every m-th vertex is a "class A" vertex; rotating about one by
      // +/- 2*pi/q reaches the two tiles across the edges incident there, which covers all p
      // neighbours.
      const order = this.q;
      this.generators = [];
      for (let k = 0; k < p; k += p / this.m) {
        const v = this.vertexDisk[k];
        for (const sense of [1, -1]) {
          this.generators.push(
            Isom.translationToDisk(v[0], v[1])
              .mul(Isom.rotation((sense * 2 * Math.PI) / order))
              .mul(Isom.translationToDisk(-v[0], -v[1])),
          );
        }
      }
      // The tile's own rotation, which the art must respect.
      this.selfRotation = Isom.rotation((2 * Math.PI) / this.m);
    }

    // The tile boundary in tile-local coordinates: p geodesic edges between consecutive vertices.
    this.boundaryLocal = this.vertexDisk.map(([zx, zy]) => {
      const k = 1 / Math.sqrt(1 - zx * zx - zy * zy);
      return [zx * k, zy * k];
    });
  }

  keyToString(key) {
    return key.length === 0 ? "root" : key.join(".");
  }

  frame(key) {
    let m = Isom.identity();
    for (let i = 0; i < key.length; i++) {
      m = m.mul(this.generators[key[i]]);
      // Renormalise periodically: entries grow like exp(depth * inradius), and the product drifts
      // off the manifold at O(n * eps) without it.
      if ((i & 7) === 7) m.normalize();
    }
    return m.normalize();
  }

  boundary(/* key */) {
    return { kind: EDGE_GEODESIC, points: this.boundaryLocal };
  }

  neighbourCount() {
    return this.generators.length;
  }

  // Tiles whose polygon can be on screen.
  //
  // Breadth-first from the tile containing the view centre, following generators, deduplicating by
  // rounded tile centre. BFS from the ROOT would be hopeless -- a tile at hyperbolic distance 20 sits
  // behind about e^20 others -- so the walk starts where the camera is.
  //
  // Two radii matter: tiles are INCLUDED if their circumscribed disk meets the visible disk, and the
  // walk CONTINUES through a slightly larger radius, so that a tile touching only at a vertex is
  // still reachable via a neighbour that was itself included.
  visible(viewMatrix, visibleRadius, maxTiles = 256) {
    const rho = 2 * Math.atanh(Math.min(visibleRadius, 0.9995));
    const chi = this.metrics.circumradius;
    const includeCosh = Math.cosh((rho + chi) / 2);
    const walkCosh = Math.cosh((rho + chi + this.metrics.centreSpacing) / 2);

    // The view centre in world local coordinates, and its companion.
    const c = viewMatrix.centreLocal([0, 0]);
    const cx = c[0];
    const cy = c[1];
    const cw = Math.sqrt(1 + cx * cx + cy * cy);

    // cosh(d/2) between a tile centre (as local coords) and the view centre -- the modulus form.
    const buf = [0, 0];
    const coshHalfTo = (frame) => {
      frame.applyToDisk(0, 0, buf);
      const k = 1 / Math.sqrt(1 - buf[0] * buf[0] - buf[1] * buf[1]);
      const tx = buf[0] * k;
      const ty = buf[1] * k;
      const tw = Math.sqrt(1 + tx * tx + ty * ty);
      const A = tw * cw - tx * cx - ty * cy;
      const B = tx * cy - ty * cx;
      return Math.hypot(A, B);
    };

    const start = this.locate(viewMatrix, maxTiles);
    const seen = new Set();
    const out = [];
    const queue = [start];
    const mark = (frame) => {
      frame.applyToDisk(0, 0, buf);
      // Adjacent tile centres are separated by tanh(inradius) in disk coordinates near the origin and
      // by ~e^-d far out, so quantise relative to the local spacing rather than absolutely.
      return `${Math.round(buf[0] * 1e7)},${Math.round(buf[1] * 1e7)}`;
    };

    while (queue.length && out.length < maxTiles) {
      const key = queue.shift();
      const frame = this.frame(key);
      const tag = mark(frame);
      if (seen.has(tag)) continue;
      seen.add(tag);
      const ch = coshHalfTo(frame);
      if (ch > walkCosh) continue;
      if (ch <= includeCosh) out.push(key);
      for (let g = 0; g < this.generators.length; g++) queue.push(key.concat([g]));
    }
    return out;
  }

  // The tile containing the view centre, found by greedy descent: repeatedly step to whichever
  // neighbour brings the tile centre closer to the target. O(depth), which is what makes this usable
  // far from the origin.
  locate(viewMatrix, maxSteps = 256) {
    const c = viewMatrix.centreLocal([0, 0]);
    const cx = c[0];
    const cy = c[1];
    const cw = Math.sqrt(1 + cx * cx + cy * cy);
    const buf = [0, 0];
    const distTo = (frame) => {
      frame.applyToDisk(0, 0, buf);
      const k = 1 / Math.sqrt(1 - buf[0] * buf[0] - buf[1] * buf[1]);
      const tx = buf[0] * k;
      const ty = buf[1] * k;
      const tw = Math.sqrt(1 + tx * tx + ty * ty);
      const A = tw * cw - tx * cx - ty * cy;
      const B = tx * cy - ty * cx;
      return Math.hypot(A, B);
    };

    let key = [];
    let best = distTo(Isom.identity());
    for (let step = 0; step < maxSteps; step++) {
      let bestG = -1;
      let bestD = best;
      const base = this.frame(key);
      for (let g = 0; g < this.generators.length; g++) {
        const d = distTo(base.mul(this.generators[g]));
        if (d < bestD - 1e-12) {
          bestD = d;
          bestG = g;
        }
      }
      if (bestG < 0) break;
      key = key.concat([bestG]);
      best = bestD;
    }
    return key;
  }
}

// ---------------------------------------------------------------------------------------------
// Binary (Boroczky) tiling
// ---------------------------------------------------------------------------------------------

// In the upper half-plane, cell (latitude, longitude) is
//
//     x in [longitude * 2^latitude, (longitude + 1) * 2^latitude]
//     y in [2^latitude, 2^(latitude + 1)]
//
// Every cell is congruent, of hyperbolic area exactly 1/2. Cells are NOT regular polygons and NOT
// convex: two sides are geodesics (x = const) and two are horocycles (y = const). The tiling is not
// edge-to-edge -- each cell has FIVE neighbours (one parent, two children, two lateral), because a
// cell's bottom edge is the union of its two children's top edges.
//
// It is also only weakly aperiodic: monohedral but NOT tile-transitive, its symmetry group being
// essentially <z -> 2z>. So it cannot produce a seamless group-invariant pattern the way {p,q} can.
// What it does give is a well-defined per-cell frame and O(1) point-to-cell lookup, which is exactly
// what a map database wants -- and why the 2011 server used it.
//
// Tile-local coordinates: every cell is the SAME box in its own frame,
//
//     x in +/- 1/(2*sqrt(2)),   y in [2^-0.5, 2^0.5]
//
// The half-width is 0.5/sqrt(2), NOT 0.5, because the frame's scale factor applies to both axes while
// the cell's x-width is only 2^latitude. That (lat, lon)-independence is what makes "the same
// prototype in every cell" work.
const BINARY_LOCAL_HALF_WIDTH = 0.5 / Math.SQRT2;
const BINARY_LOCAL_Y_LOW = 1 / Math.SQRT2;
const BINARY_LOCAL_Y_HIGH = Math.SQRT2;

class BinaryTiling {
  constructor() {
    this.frameCache = new Map();
  }

  keyToString(key) {
    return `${key[0]},${key[1]}`;
  }

  // Point -> cell, in half-plane coordinates. Two floors.
  locateHalfPlane(hx, hy) {
    const latitude = Math.floor(Math.log2(hy));
    const longitude = Math.floor(hx * Math.pow(2, -latitude));
    return [latitude, longitude];
  }

  // The isometry taking tile-local coordinates to the world.
  //
  // In the half-plane it is z -> s*z + t with s = 2^(lat+0.5) and t = (lon+0.5)*2^lat, which sends
  // the basepoint i to the cell's hyperbolic centre. Conjugating by the Cayley transform
  // C = [[i, 1], [1, i]] lands directly in SU(1,1) form -- verified with zero deviation.
  frame(key) {
    const cacheKey = this.keyToString(key);
    const hit = this.frameCache.get(cacheKey);
    if (hit) return hit.clone();

    const [lat, lon] = key;
    const s = Math.pow(2, lat + 0.5);
    const t = (lon + 0.5) * Math.pow(2, lat);
    // C * [[sqrt(s), t/sqrt(s)], [0, 1/sqrt(s)]] * C^-1, worked out in closed form.
    //   a = ((s + 1) + i*t) / (2*sqrt(s)) ... derived below by direct multiplication
    const rs = Math.sqrt(s);
    const inv = 1 / rs;
    // Worked out by hand and checked against the matrix product. With C = [[i,1],[1,i]] (which is
    // z -> i(z-i)/(z+i)) and det C = -2, so C^-1 = [[-i/2, 1/2],[1/2, -i/2]]:
    //
    //   a = (sqrt(s) + 1/sqrt(s))/2  +  i * t/(2 sqrt(s))
    //   b =            t/(2 sqrt(s)) +  i * (sqrt(s) - 1/sqrt(s))/2
    //
    // and |a|^2 - |b|^2 = ((sqrt(s)+1/sqrt(s))^2 - (sqrt(s)-1/sqrt(s))^2)/4 = 1 identically.
    // (First attempt had b's real and imaginary parts swapped, which a direct comparison against
    // C*A*C^-1 caught immediately -- worth doing rather than trusting the algebra.)
    const ar = (rs + inv) / 2;
    const ai = (t * inv) / 2;
    const br = (t * inv) / 2;
    const bi = (rs - inv) / 2;
    const m = new Isom(ar, ai, br, bi).normalize();
    this.frameCache.set(cacheKey, m);
    return m.clone();
  }

  // The cell boundary in tile-local coordinates: two geodesic sides and two horocyclic sides. Given
  // in the tile's own HALF-PLANE box, which the renderer maps through the frame.
  boundary(/* key */) {
    return {
      kind: "binary-cell",
      halfWidth: BINARY_LOCAL_HALF_WIDTH,
      yLow: BINARY_LOCAL_Y_LOW,
      yHigh: BINARY_LOCAL_Y_HIGH,
    };
  }

  // The five neighbours of a cell.
  neighbours(key) {
    const [lat, lon] = key;
    return [
      [lat + 1, Math.floor(lon / 2)],
      [lat - 1, 2 * lon],
      [lat - 1, 2 * lon + 1],
      [lat, lon - 1],
      [lat, lon + 1],
    ];
  }

  // Cells whose box meets the visible disk.
  //
  // The visible set is a hyperbolic disk of radius rho about the view centre, and in the half-plane a
  // hyperbolic disk is an ordinary EUCLIDEAN circle: centre (px, py*cosh(rho)), radius py*sinh(rho).
  // So the band-by-band intersection is exact and closed-form, with no sampling at all. For the
  // latitude band y in [y0, y1], the widest x occurs at whichever y in the band is nearest the
  // circle's centre, giving half-width sqrt(R^2 - dy^2).
  //
  // Two separate bugs lived here, and the second was caused by fixing the first badly:
  //
  //   * The 2011 routine evaluated the x-extent at y = 2^latitude, the BOTTOM of the band, and so
  //     missed about 46% of the cells it should have returned -- hence its "fix missing rooms"
  //     commit. Using the widest y in the band is the fix.
  //   * My first version over-corrected, taking ONE global bounding box over the whole visible disk
  //     and reusing it for every band. That is over-inclusive, which sounds safe, but the bands are
  //     walked from the smallest latitude upward against a hard maxCells budget -- and the smallest
  //     band has the smallest cells, so it has the most of them. Measured: at zoom 0.4 the routine
  //     returned 512 cells ALL IN ONE BAND and nothing whatsoever for the bands actually covering
  //     the screen. Zooming out made the dungeon vanish.
  //
  // So the budget is now spent nearest-first: cells are gathered with their distance from the view
  // centre and sorted, so a truncation drops the farthest cells rather than every cell above some
  // arbitrary latitude. `lastTruncated` records whether that happened, because a silently capped
  // enumeration reads exactly like a rendering bug.
  visible(viewMatrix, visibleRadius, maxCells = 512) {
    const rho = 2 * Math.atanh(Math.min(visibleRadius, 0.9995));
    const centre = viewMatrix.centreLocal([0, 0]);
    const hp = [0, 0];
    localToHalfPlaneInto(centre[0], centre[1], hp);
    const px = hp[0];
    const py = hp[1];
    this.lastTruncated = false;
    if (!Number.isFinite(px) || !Number.isFinite(py) || py <= 0) return [];

    const cy = py * Math.cosh(rho);
    const R = py * Math.sinh(rho);
    // cy - R = py*exp(-rho) and cy + R = py*exp(rho), both strictly positive, so the logs are safe.
    const latMin = Math.floor(Math.log2(py) - rho / Math.LN2);
    const latMax = Math.floor(Math.log2(py) + rho / Math.LN2);

    // Each band contributes an interval of longitudes. Rather than materialise them all and sort --
    // a wide view puts over five thousand cells in a single band, so that is both slow and, with a
    // budget, wrong -- keep a frontier of one candidate per side per band and repeatedly take the
    // globally nearest. The full visible set is still emitted whenever it fits in the budget; when it
    // does not, what survives is the nearest maxCells, which is what the user can actually see.
    const bands = [];
    for (let lat = latMin; lat <= latMax; lat++) {
      const size = Math.pow(2, lat);
      // Distance from the visible circle's centre to this band, zero if the centre lies inside it.
      const dy = Math.max(0, size - cy, cy - size * 2);
      if (dy >= R) continue;
      const hw = Math.sqrt((R - dy) * (R + dy));
      const lo = Math.floor((px - hw) / size);
      const hi = Math.floor((px + hw) / size);
      const start = Math.min(hi, Math.max(lo, Math.floor(px / size)));
      bands.push({ lat, size, my: size * 1.5, lo, hi, left: start - 1, right: start });
    }

    // cosh(d) - 1 between the view centre and a cell centre, in half-plane coordinates: monotone in
    // the hyperbolic distance, and free of both sqrt and log.
    //
    // Ranking by Euclidean distance from the circle's centre (px, cy) instead is a trap I fell into:
    // (px, cy) is the centre of the visible circle as drawn in the half-plane, which is NOT the view
    // centre -- it sits cosh(rho) times higher. For a wide view that is a factor of millions, so
    // "nearest the circle centre" picks out the cells hugging the far rim. Measured on the dungeon at
    // zoom 1.2: all 220 cells came back at hyperbolic distance 20.87, every one beyond the renderer's
    // cull radius, and the disk went completely blank.
    const rank = (b, lon) => {
      const dx = (lon + 0.5) * b.size - px;
      const dh = b.my - py;
      return (dx * dx + dh * dh) / (2 * py * b.my);
    };

    const out = [];
    for (;;) {
      let best = -1;
      let bestRank = Infinity;
      let bestLon = 0;
      let bestRight = false;
      for (let i = 0; i < bands.length; i++) {
        const b = bands[i];
        if (b.right <= b.hi) {
          const r = rank(b, b.right);
          if (r < bestRank) { bestRank = r; best = i; bestLon = b.right; bestRight = true; }
        }
        if (b.left >= b.lo) {
          const r = rank(b, b.left);
          if (r < bestRank) { bestRank = r; best = i; bestLon = b.left; bestRight = false; }
        }
      }
      if (best < 0) break; // every visible cell has been emitted
      if (out.length >= maxCells) { this.lastTruncated = true; break; }
      out.push([bands[best].lat, bestLon]);
      if (bestRight) bands[best].right++;
      else bands[best].left--;
    }
    return out;
  }
}

// Local module helper so `visible` does not allocate.
function localToHalfPlaneInto(px, py, out) {
  const r2 = px * px + py * py;
  const w = Math.sqrt(r2 + 1.0);
  const denom =
    py > 0.0
      ? (4.0 * px * px * w * w + 1.0) / (2.0 * r2 + 1.0 + 2.0 * py * w)
      : 2.0 * r2 + 1.0 - 2.0 * py * w;
  out[0] = (2.0 * px * w) / denom;
  out[1] = 1.0 / denom;
  return out;
}

// The half-plane point at the centre of a binary cell, for callers that want it.
function binaryCellCentreLocal(lat, lon) {
  return halfPlaneToLocal((lon + 0.5) * Math.pow(2, lat), Math.pow(2, lat + 0.5), [0, 0]);
}

// ===== src/data/atlas/atlas.js =====
// The atlas: an independent coordinate patch per tile.
//
// Why this exists, in two use cases:
//
//   * Data far from the origin loses precision when expressed in one global patch. At hyperbolic
//     distance 20 a disk coordinate is 1 - 3.6e-9, so there are only ~7 significant digits left in
//     the quantity that matters. Splitting the data into tiles means every coordinate is small and
//     measured from its own tile's centre, and the tile's frame is built by multiplying generator
//     matrices rather than derived from a huge number.
//   * A repeating pattern becomes genuinely infinite: return the same tile data for every key.
//
// The tile -> data mapping is a callback that returns DATA, not URLs, so it can fetch, synthesise, or
// compose overlays. Rotation into each tile's frame is the library's job, never the callback's: the
// callback only ever sees and returns tile-local coordinates.

const CLIP_AUTO = "auto";
const CLIP_ALWAYS = "always";
const CLIP_NEVER = "never";

const atlasArc = new Arc();

class Atlas {
  constructor(options = {}) {
    const {
      tiling,
      tileData,
      clip = CLIP_AUTO,
      cacheSize = 512,
      maxTiles = 256,
      styleSheet = null,
      onTileLoad = null,
      onTileError = null,
    } = options;
    if (!tiling) throw new Error("hyperbolic-map: atlas needs a tiling");
    if (typeof tileData !== "function") throw new Error("hyperbolic-map: atlas needs a tileData callback");

    this.tiling = tiling;
    this.tileData = tileData;
    this.clip = clip;
    this.cacheSize = cacheSize;
    this.maxTiles = maxTiles;
    this.styleSheet = styleSheet;
    this.onTileLoad = onTileLoad;
    this.onTileError = onTileError;

    // key string -> {drawables, withinTile} once resolved
    this.cache = new Map();
    // key string -> promise, so concurrent frames do not issue duplicate requests
    this.pending = new Map();
    this.frames = new Map();
  }

  frameFor(keyString, key) {
    let f = this.frames.get(keyString);
    if (!f) {
      f = this.tiling.frame(key);
      this.frames.set(keyString, f);
    }
    return f;
  }

  // Ask for a tile's data. Returns the compiled drawables if they are ready, or null while a request
  // is outstanding. Never throws: a failing tile is reported and then skipped.
  request(key, keyString, onReady) {
    const hit = this.cache.get(keyString);
    if (hit) {
      // Refresh LRU position.
      this.cache.delete(keyString);
      this.cache.set(keyString, hit);
      return hit;
    }
    if (this.pending.has(keyString)) return null;

    const frame = this.frameFor(keyString, key);
    const centre = frame.applyToDisk(0, 0, [0, 0]);
    const tile = {
      key: key.slice ? key.slice() : key,
      id: keyString,
      centreDisk: centre,
      orientation: frame.screenRotation(),
      frame: frame.clone(),
    };

    const p = Promise.resolve()
      .then(() => this.tileData(tile))
      .then((data) => {
        this.pending.delete(keyString);
        if (data == null) {
          this.cache.set(keyString, { drawables: [], withinTile: true });
          return;
        }
        const entry = {
          drawables: compileDrawables(data, this.styleSheet),
          withinTile: !!(data && data.withinTile),
        };
        this.cache.set(keyString, entry);
        while (this.cache.size > this.cacheSize) {
          const oldest = this.cache.keys().next().value;
          this.cache.delete(oldest);
        }
        if (this.onTileLoad) this.onTileLoad(tile, entry.drawables);
        if (onReady) onReady();
      })
      .catch((err) => {
        this.pending.delete(keyString);
        // Cache the failure as empty so a broken tile is not retried every frame.
        this.cache.set(keyString, { drawables: [], withinTile: true });
        if (this.onTileError) this.onTileError(tile, err);
        else if (typeof console !== "undefined") console.error(`hyperbolic-map: tile ${keyString} failed`, err);
      });
    this.pending.set(keyString, p);
    return null;
  }

  // Build the render passes for the current view: one per visible tile, each with its own matrix and
  // clip path.
  passes(view, onReady) {
    const keys = this.tiling.visible(view.matrix, view.effectiveRadius, this.maxTiles);
    const out = [];
    for (const key of keys) {
      const keyString = this.tiling.keyToString(key);
      const entry = this.request(key, keyString, onReady);
      if (!entry || entry.drawables.length === 0) continue;
      const frame = this.frameFor(keyString, key);
      const net = view.matrix.mul(frame);
      const wantClip =
        this.clip === CLIP_ALWAYS || (this.clip === CLIP_AUTO && !entry.withinTile);
      out.push({
        drawables: entry.drawables,
        matrix: net,
        clip: wantClip ? this.clipPathFor(key, net) : null,
      });
    }
    return out;
  }

  // A clip region for one tile, expressed as a callback that traces the boundary into a canvas path.
  // Kept as a closure so the renderer does not need to know about tiling shapes.
  clipPathFor(key, net) {
    const b = this.tiling.boundary(key);
    if (b.kind === "binary-cell") return binaryCellClip(net, b);
    return polygonClip(net, b.points);
  }
}

// Clip to a hyperbolic polygon: p geodesic arcs through the projected vertices.
function polygonClip(net, localPoints) {
  return (ctx, view) => {
    const scale = view.radius;
    const sx = view.cx;
    const sy = view.cy;
    const n = localPoints.length;
    const px = new Float64Array(n);
    const py = new Float64Array(n);
    const buf = [0, 0];
    for (let i = 0; i < n; i++) {
      net.applyToLocal(localPoints[i][0], localPoints[i][1], undefined, buf);
      px[i] = buf[0];
      py[i] = buf[1];
    }
    ctx.beginPath();
    ctx.moveTo(px[0] * scale + sx, -py[0] * scale + sy);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      geodesicArc(px[i], py[i], px[j], py[j], atlasArc, 0, 0.25 / scale);
      if (atlasArc.straight) {
        ctx.lineTo(px[j] * scale + sx, -py[j] * scale + sy);
      } else {
        ctx.arc(
          atlasArc.cx * scale + sx,
          -atlasArc.cy * scale + sy,
          atlasArc.r * scale,
          -atlasArc.startAngle,
          -atlasArc.endAngle,
          atlasArc.anticlockwise,
        );
      }
    }
    ctx.closePath();
    ctx.clip();
  };
}

// Clip to a binary-tiling cell. Its two vertical sides are geodesics and its two horizontal sides are
// HOROCYCLES (circles internally tangent to the disk boundary), so this cannot reuse the polygon path
// builder. Approximating each horocyclic side by a short polyline is exact enough at any zoom -- a
// horocycle is very flat over one cell's width -- and avoids having to solve for tangency on screen.
function binaryCellClip(net, box) {
  const hw = box.halfWidth;
  const yLow = box.yLow;
  const yHigh = box.yHigh;
  const STEPS = 12;
  // Trace the box boundary in the tile's own half-plane coordinates.
  const ring = [];
  for (let i = 0; i <= STEPS; i++) ring.push([-hw + (2 * hw * i) / STEPS, yLow]);
  ring.push([hw, yLow]);
  for (let i = 0; i <= STEPS; i++) ring.push([hw - (2 * hw * i) / STEPS, yHigh]);
  ring.push([-hw, yHigh]);

  const local = ring.map(([hx, hy]) => halfPlaneToLocal(hx, hy, [0, 0]));

  return (ctx, view) => {
    const scale = view.radius;
    const sx = view.cx;
    const sy = view.cy;
    const buf = [0, 0];
    ctx.beginPath();
    for (let i = 0; i < local.length; i++) {
      net.applyToLocal(local[i][0], local[i][1], undefined, buf);
      const X = buf[0] * scale + sx;
      const Y = -buf[1] * scale + sy;
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    }
    ctx.closePath();
    ctx.clip();
  };
}

// ===== src/viewport.js =====
// HyperbolicViewport -- the public widget.
//
// Everything outside the Poincare disk is the page's business, not the library's. The library draws
// the disk fill and the rim annulus; anything else (a world-turtle behind the disk, a star field,
// a compass rose on top) goes through `layers` or the `onBeforeDraw`/`onAfterDraw` hooks. That is
// why the 2011 `backgroundImage`, `shellImage` and `shellImageScale` options are gone: they baked
// one example's art into the library.

const DEFAULT_OPTIONS = {
  container: null,
  canvas: null,
  width: null,
  height: null,
  autoResize: false,
  devicePixelRatio: "auto",
  radiusBasis: "min",

  data: null,
  dataProvider: null,
  atlas: null,
  styles: null,

  center: null,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  zoom: 0.95,
  minZoom: 0.5,
  maxZoom: null,

  interactive: true,
  allowPan: true,
  allowZoom: true,
  allowRotate: true,
  rimRotate: true,
  panClamp: true,
  wheelZoom: true,
  wheelZoomStep: 1.1,
  rotationMode: ROTATION_PARALLEL_TRANSPORT,
  compassTarget: [0, 1],

  interactRadius: 0.9,
  drawRadius: 1.0,

  background: "#ffffff",
  pageBackground: null,
  rimFill: "#f5d6ab",
  rimStroke: "#000000",
  rimLineWidth: 1.5,

  cullMode: CULL_CAP,
  arcMode: "sagitta",
  sagittaTolerancePx: 0.25,
  minTextPx: 3,

  layers: null,
  onBeforeDraw: null,
  onAfterDraw: null,
  onDrawBackground: null,
  onDrawRim: null,
  onViewChange: null,
  onGestureStart: null,
  onGestureEnd: null,
  onFrame: null,
};

// The 2011 option names, mapped to their replacements. Accepted with a one-time warning so the
// original example pages keep working.
const LEGACY_ALIASES = {
  initialOffsetX: "offsetX",
  initialOffsetY: "offsetY",
  initialRotation: "rotation",
  initialZoom: "zoom",
  viewThreshold: "interactRadius",
  downloadThreshold: null, // superseded by the source's own gating
  zoomMouseWheel: "wheelZoomStep",
  backgroundColor: "background",
  rimFillStyle: "rimFill",
  rimStrokeStyle: "rimStroke",
  backgroundImage: null, // now a layer; see docs/demo/layers.js
  shellImage: null,
  shellImageScale: null,
};

let warnedLegacy = false;

function normaliseOptions(userOptions) {
  const opts = Object.assign({}, DEFAULT_OPTIONS);
  const unknown = [];
  for (const key of Object.keys(userOptions || {})) {
    if (key in DEFAULT_OPTIONS) {
      opts[key] = userOptions[key];
    } else if (key in LEGACY_ALIASES) {
      const target = LEGACY_ALIASES[key];
      if (!warnedLegacy && typeof console !== "undefined") {
        warnedLegacy = true;
        console.warn(
          "hyperbolic-map: 2011 option names are deprecated. See the alias table in README.md.",
        );
      }
      if (target) opts[target] = userOptions[key];
    } else {
      unknown.push(key);
    }
  }
  // Typos in option names are a common and silent source of "why is this not working", so they are
  // an error rather than being ignored.
  if (unknown.length) {
    throw new Error(`hyperbolic-map: unknown option(s): ${unknown.join(", ")}`);
  }
  return opts;
}

class HyperbolicViewport {
  constructor(userOptions) {
    const opts = normaliseOptions(userOptions);
    this.options = opts;

    this.styleSheet = Object.assign({ default: Object.assign({}, DEFAULT_STYLE) }, opts.styles || {});

    this.surface = new Surface(opts);
    this.renderer = new Renderer();

    let offsetX = opts.offsetX;
    let offsetY = opts.offsetY;
    if (opts.center) {
      offsetX = -opts.center[0];
      offsetY = -opts.center[1];
    }
    this.view = new ViewState({
      offsetX: offsetX,
      offsetY: offsetY,
      rotation: opts.rotation,
      zoom: opts.zoom,
      minZoom: opts.minZoom,
      maxZoom: opts.maxZoom,
      rotationMode: opts.rotationMode,
      compassTargetX: opts.compassTarget[0],
      compassTargetY: opts.compassTarget[1],
    });

    // Named sources, drawn in insertion order. Each may carry its own extra isometry, which is how
    // the clock demo rotates its hands in O(1) per tick instead of rebuilding every drawable.
    this.sources = new Map();
    if (opts.dataProvider) {
      this.sources.set("default", {
        source: new CallbackSource(opts.dataProvider, {
          styleSheet: this.styleSheet,
          onLoad: () => this.invalidate(),
        }),
        transform: null,
      });
    } else {
      this.sources.set("default", {
        source: new StaticSource(opts.data || [], this.styleSheet),
        transform: null,
      });
    }

    // The atlas, if configured, contributes one render pass per visible tile.
    this.atlas = null;
    if (opts.atlas) {
      this.atlas = new Atlas(
        Object.assign({ styleSheet: this.styleSheet }, opts.atlas),
      );
    }

    this.layers = (opts.layers || []).slice().sort((a, b) => (a.z || 0) - (b.z || 0));
    for (const layer of this.layers) if (layer.attach) layer.attach(this);

    this.frameHandle = null;
    this.destroyed = false;
    this.stats = this.renderer.stats;

    this.input = new PointerInput(
      {
        element: this.surface.canvas,
        window: typeof window !== "undefined" ? window : null,
        document: typeof document !== "undefined" ? document : null,
        toDisk: (e, zoom) => this.surface.eventToDisk(e, zoom),
      },
      this.view,
      opts,
      {
        onChange: () => {
          this.invalidate();
          if (opts.onViewChange) opts.onViewChange(this.getView());
        },
        onGestureStart: (mode) => opts.onGestureStart && opts.onGestureStart(mode),
        onGestureEnd: () => {
          // The throttle can swallow the last movement of a drag, leaving the frame the user
          // actually stopped on showing data fetched for an earlier position. Always ask again on
          // gesture end so the final view is never stale.
          this.refreshSources();
          if (opts.onGestureEnd) opts.onGestureEnd(this.getView());
        },
      },
    );

    this.surface.observe(() => this.invalidate());
    this.render();
  }

  // Request a redraw, coalesced to one per animation frame. Input handlers only mutate state and
  // call this; the 2011 code redrew synchronously per mousemove, which on a 120 Hz mouse meant 120
  // full redraws a second.
  invalidate() {
    if (this.destroyed || this.frameHandle !== null) return;
    const raf = typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
    this.frameHandle = raf(() => {
      this.frameHandle = null;
      this.render();
    });
  }

  render() {
    if (this.destroyed) return;
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const view = this.surface.buildView(this.view, this.options);
    // One entry per source: its drawables plus the matrix to draw them with. A source transform is
    // composed on the right, so its drawables' coordinates stay in their own frame.
    const passes = [];
    for (const entry of this.sources.values()) {
      const drawables = entry.source.get(view);
      if (!drawables || drawables.length === 0) continue;
      passes.push({
        drawables: drawables,
        matrix: entry.transform ? view.matrix.mul(entry.transform) : view.matrix,
      });
    }
    if (this.atlas) {
      for (const p of this.atlas.passes(view, () => this.invalidate())) passes.push(p);
    }
    this.renderer.draw(this.surface.context, view, passes, {
      background: this.options.background,
      pageBackground: this.options.pageBackground,
      rimFill: this.options.rimFill,
      rimStroke: this.options.rimStroke,
      rimLineWidth: this.options.rimLineWidth,
      layers: this.layers,
      onBeforeDraw: this.options.onBeforeDraw,
      onAfterDraw: this.options.onAfterDraw,
      onDrawBackground: this.options.onDrawBackground,
      onDrawRim: this.options.onDrawRim,
      cullMode: this.options.cullMode,
      arcMode: this.options.arcMode,
      sagittaTolerancePx: this.options.sagittaTolerancePx,
      minTextPx: this.options.minTextPx,
    });
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    this.stats.frameMs = t1 - t0;
    if (this.options.onFrame) this.options.onFrame(this.stats);
  }

  // ---- public API ----

  // Force every async source to re-request for the current view, bypassing the throttle and the
  // significance gate.
  refreshSources() {
    if (this.destroyed) return;
    const view = this.surface.buildView(this.view, this.options);
    for (const entry of this.sources.values()) {
      if (entry.source.refresh) entry.source.refresh(view);
    }
    this.invalidate();
  }

  getView() {
    return {
      center: this.view.liveMatrix.centreLocal([0, 0]),
      zoom: this.view.liveZoom,
      rotation: this.view.liveMatrix.screenRotation(),
      bearing: this.view.north(),
      interacting: !!this.view.gesture,
    };
  }

  getMatrix() {
    return this.view.liveMatrix.clone();
  }

  setMatrix(isom) {
    this.view.matrix = isom.clone().normalize();
    this.view.liveMatrix = this.view.matrix.clone();
    this.invalidate();
  }

  setZoom(z) {
    this.view.setZoom(z);
    this.invalidate();
  }

  setRotation(theta) {
    const current = this.view.matrix.screenRotation();
    this.view.matrix = Isom.rotation(theta - current).mul(this.view.matrix).normalize();
    this.view.liveMatrix = this.view.matrix.clone();
    this.invalidate();
  }

  // Put the given local point at the centre of the view.
  panTo(x, y) {
    this.view.matrix = Isom.translationToLocal(x, y).inverse();
    this.view.liveMatrix = this.view.matrix.clone();
    this.invalidate();
  }

  setData(data, name = "default") {
    const entry = this.sources.get(name);
    if (entry && entry.source instanceof StaticSource) {
      entry.source.setData(data, this.styleSheet);
    } else {
      this.sources.set(name, { source: new StaticSource(data, this.styleSheet), transform: entry ? entry.transform : null });
    }
    this.invalidate();
  }

  addSource(name, data, opts = {}) {
    const source = typeof data === "function"
      ? new CallbackSource(data, { styleSheet: this.styleSheet, onLoad: () => this.invalidate() })
      : new StaticSource(data, this.styleSheet);
    this.sources.set(name, { source: source, transform: opts.transform || null });
    this.invalidate();
    return source;
  }

  removeSource(name) {
    const entry = this.sources.get(name);
    if (entry && entry.source.destroy) entry.source.destroy();
    this.sources.delete(name);
    this.invalidate();
  }

  // Apply an extra isometry to one source without recompiling its drawables. O(1) per change.
  setSourceTransform(name, isom) {
    const entry = this.sources.get(name);
    if (!entry) throw new Error(`hyperbolic-map: no source named "${name}"`);
    entry.transform = isom;
    this.invalidate();
  }

  toScreen(x, y) {
    return this.surface.buildView(this.view, this.options).toScreen(x, y);
  }

  fromScreen(sx, sy) {
    return this.surface.buildView(this.view, this.options).fromScreen(sx, sy);
  }

  resize(w, h) {
    this.surface.resize(w, h);
    this.invalidate();
  }

  destroy() {
    this.destroyed = true;
    if (this.frameHandle !== null) {
      const cancel = typeof cancelAnimationFrame !== "undefined" ? cancelAnimationFrame : clearTimeout;
      cancel(this.frameHandle);
      this.frameHandle = null;
    }
    this.input.destroy();
    for (const entry of this.sources.values()) if (entry.source.destroy) entry.source.destroy();
    for (const layer of this.layers) if (layer.detach) layer.detach();
    this.surface.destroy();
  }
}

// ===== src/index.js =====
// hyperbolic-map-widget -- public surface.
//
// This file is a barrel: it only re-exports. tools/build.mjs uses the names imported here to decide
// what the browser bundle exposes on the global `HyperbolicMap` object, so anything intended to be
// public must be listed here.
//
// Imports must stay one-per-line and single-line (see tools/check-bundle.mjs): the builder strips
// import lines individually, so a multi-line import would leave fragments behind.

global.HyperbolicMap = {
  Isom: Isom,
  localCompanion: localCompanion,
  movePointToPoint: movePointToPoint,
  localToDisk: localToDisk,
  diskToLocal: diskToLocal,
  localRadiusToDistance: localRadiusToDistance,
  distanceToLocalRadius: distanceToLocalRadius,
  localDistance: localDistance,
  halfPlaneToLocal: halfPlaneToLocal,
  localToHalfPlane: localToHalfPlane,
  Cap: Cap,
  coshHalfDistance: coshHalfDistance,
  coshHalfDistanceSquared: coshHalfDistanceSquared,
  screenRadiusToThresholdSquared: screenRadiusToThresholdSquared,
  capMayBeVisible: capMayBeVisible,
  capThreshold: capThreshold,
  ViewState: ViewState,
  ROTATION_PARALLEL_TRANSPORT: ROTATION_PARALLEL_TRANSPORT,
  ROTATION_COMPASS: ROTATION_COMPASS,
  HyperbolicViewport: HyperbolicViewport,
  DEFAULT_OPTIONS: DEFAULT_OPTIONS,
  compileDrawables: compileDrawables,
  readLegacyDrawable: readLegacyDrawable,
  DEFAULT_STYLE: DEFAULT_STYLE,
  StaticSource: StaticSource,
  CallbackSource: CallbackSource,
  Renderer: Renderer,
  CULL_CAP: CULL_CAP,
  CULL_ENDPOINTS: CULL_ENDPOINTS,
  Surface: Surface,
  PointerInput: PointerInput,
  clampToRadius: clampToRadius,
  geodesicArc: geodesicArc,
  Arc: Arc,
  Atlas: Atlas,
  CLIP_AUTO: CLIP_AUTO,
  CLIP_ALWAYS: CLIP_ALWAYS,
  CLIP_NEVER: CLIP_NEVER,
  RegularTiling: RegularTiling,
  BinaryTiling: BinaryTiling,
  regularMetrics: regularMetrics,
  binaryCellCentreLocal: binaryCellCentreLocal,
  BINARY_LOCAL_HALF_WIDTH: BINARY_LOCAL_HALF_WIDTH,
  BINARY_LOCAL_Y_LOW: BINARY_LOCAL_Y_LOW,
  BINARY_LOCAL_Y_HIGH: BINARY_LOCAL_Y_HIGH,
  VERSION: "0.1.0",
};
})(typeof globalThis !== "undefined" ? globalThis : self);
