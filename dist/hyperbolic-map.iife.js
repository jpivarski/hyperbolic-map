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
    // beta = b * conj(a) / |a|  -- the exact translation part
    const betaR = (this.br * this.ar + this.bi * this.ai) / modA;
    const betaI = (this.bi * this.ar - this.br * this.ai) / modA;
    const modBeta2 = betaR * betaR + betaI * betaI;
    // sqrt(1 + |beta|^2) loses the 1 once |beta| ~ 1e8 (d ~ 37); use the factored form there.
    const w = modBeta2 > 1e15 ? Math.sqrt((modA - 1) * (modA + 1)) : Math.sqrt(1 + modBeta2);
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
  distanceMoved() {
    return 2 * Math.acosh(Math.max(1, Math.hypot(this.ar, this.ai)));
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
// !! CHECKPOINT A !!  The two half-plane conversions below are faithful ports of the 2011
// formulas, INCLUDING their numerical defects, so that this commit can be compared against the
// original. Both are replaced with stable forms at checkpoint B. See notes/math-audit.md:
//   * halfPlaneToLocal returns exactly 0 near the half-plane basepoint i (double cancellation).
//   * localToHalfPlane divides by zero at y >~ 1e4, which is INSIDE the dungeon data range
//     (max y = 11711.92). In Java this silently produced Infinity.

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

// ---- half-plane <-> local (CHECKPOINT A: faithful 2011 ports, defects included) ----

function halfPlaneToLocal(px, py, out) {
  const sqrtplus = Math.sqrt(px * px + py * py + 2.0 * py + 1.0);
  const sqrtminus = Math.sqrt(px * px + py * py - 2.0 * py + 1.0);
  const sinheta =
    Math.sqrt((sqrtplus + sqrtminus) / (sqrtplus - sqrtminus)) / 2.0 -
    Math.sqrt((sqrtplus - sqrtminus) / (sqrtminus + sqrtplus)) / 2.0;

  const denom = Math.sqrt(Math.pow(2.0 * px, 2) + Math.pow(px * px + py * py - 1.0, 2));
  let cosphi;
  let sinphi;
  if (px === 0.0 && py === 1.0) {
    cosphi = 0.0;
    sinphi = 1.0;
  } else {
    cosphi = (2.0 * px) / denom;
    sinphi = (px * px + py * py - 1.0) / denom;
  }

  out[0] = sinheta * cosphi;
  out[1] = sinheta * sinphi;
  return out;
}

function localToHalfPlane(px, py, out) {
  const w = Math.sqrt(px * px + py * py + 1.0);
  const denom = 2.0 * (px * px + py * py) + 1.0 - 2.0 * py * w;
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
  VERSION: "0.1.0",
};
})(typeof globalThis !== "undefined" ? globalThis : self);
