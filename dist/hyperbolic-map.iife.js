/* hyperbolic-map 0.1.1 - https://github.com/jpivarski/hyperbolic-map
 * Built by dev/build.mjs (concatenation in dependency order; no bundler).
 * Generated file - do not edit. Edit src/ and run `npm run build`.
 */
(function (global) {
"use strict";

// ===== src/version.js =====
// The library's version, as a literal.
//
// It has to be a literal: `src/` is loaded directly by browsers as ES modules, so it cannot read
// `package.json` at run time, and the browser bundle is plain concatenation with nothing to
// substitute. The copy in `package.json` is what npm publishes, so there are necessarily two, and
// `dev/check-bundle.mjs` fails the build if they ever disagree.
const VERSION = "0.1.1";

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

  // The view as an offset B in local coordinates plus a rotation R, applied as Rot(R) . T(B) --
  // rotation AFTER translation. Order matters. This is what the `offsetX`/`offsetY`/`rotation`
  // options mean.
  static fromOffsetRotation(bx, by, rotation) {
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
  // the top of the disk). Geodesics through the disk center are straight diameters, so this is
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

  // The view center in local coordinates: the point that this isometry sends to the origin.
  centerLocal(out) {
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
  // it is clearer, and better conditioned, to form the disk image directly and normalize it.
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

// A point is inside screen radius `tau` of the view center iff cosh(d/2) < 1/sqrt(1 - tau^2).
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

  // Take the first point as the center and the furthest distance as the radius. Not the minimal
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

// Can any point of `cap` be visible within screen radius `tau` of the view center `(cx, cy, cw)`?
//
// Reject iff d(capCenter, viewCenter) > rho + capRadius, where rho = 2 artanh(tau). Precompute
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
    this.matrix = matrix ? matrix.clone() : Isom.fromOffsetRotation(offsetX, offsetY, rotation);
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

  // Re-express the view in a NEIGHBORING tile's frame. `shift` is the generator carrying the new
  // frame's coordinates into the old one's, so the matrices gain it on the right and everything stored
  // in the frame's DOMAIN has to be pulled back through its inverse.
  //
  // This is the part that is easy to miss, and it bites only in atlas mode. Two pieces of view state
  // live in the frame's domain rather than on the screen:
  //
  //   * a pinch's grabbed points. `beginPinch` records where the two fingers grabbed, as coordinates in
  //     the frame current at that moment. Re-anchor mid-pinch without converting them and the solver
  //     pins the wrong points -- the picture jumps out from under the fingers.
  //   * the compass target. `northOf` applies the matrix to it, so it too is a point in the domain.
  //
  // A pan's anchor and a rim-rotation's start angle are SCREEN quantities and need no conversion; the
  // stored compass bearing is a screen angle too.
  rebase(shift) {
    this.matrix = this.matrix.mul(shift).normalize();
    this.liveMatrix = this.liveMatrix.mul(shift).normalize();
    const inv = shift.inverse();
    const t = inv.applyToIdeal(this.compassTargetX, this.compassTargetY, [0, 0]);
    const norm = Math.hypot(t[0], t[1]);
    if (norm > 0) {
      // Keep it exactly on the boundary circle: it is an IDEAL point, and letting it drift inside would
      // slowly turn the compass into a reference to an ordinary interior point.
      this.compassTargetX = t[0] / norm;
      this.compassTargetY = t[1] / norm;
    }
    const g = this.gesture;
    if (g && g.kind === "pinch") {
      const a = inv.applyToDisk(g.d1x, g.d1y, [0, 0]);
      g.d1x = a[0];
      g.d1y = a[1];
      const b = inv.applyToDisk(g.d2x, g.d2y, [0, 0]);
      g.d2x = b[0];
      g.d2y = b[1];
    }
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
      // gives up pinning the grabbed point: a rotation about the screen center moves it. That
      // trade-off is inherent to compass mode and matches the 2011 behavior.
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
      // "auto" follows window.devicePixelRatio. A fixed number overrides it, which is what the
      // pixel-exact capture harnesses pass so that a canvas is the size they asked for.
      devicePixelRatio = "auto",
      // width / height. When set, the HEIGHT IS DERIVED from the width and `height` is refused, so
      // the canvas can follow a fluid container without the page having to compute pixel sizes.
      // With `autoResize`, that makes the widget responsive: `aspectRatio: 1` in a full-width
      // container gives a square that tracks the column.
      //
      // Deriving height from width, rather than fitting inside a box, is what avoids a feedback
      // loop: the canvas is the only thing giving the container its height, so measuring that height
      // back would oscillate. Only the width is ever read.
      aspectRatio = null,
    } = options || {};

    if (aspectRatio !== null && height !== null && height !== undefined) {
      throw new Error(
        "hyperbolic-map: `aspectRatio` derives the height from the width, so `height` cannot also be " +
          "given. Drop one of them.",
      );
    }
    if (aspectRatio !== null && !(aspectRatio > 0 && Number.isFinite(aspectRatio))) {
      throw new Error(`hyperbolic-map: aspectRatio must be a positive number, got ${aspectRatio}`);
    }

    this.autoResize = autoResize;
    this.dprOption = devicePixelRatio;
    this.aspectRatio = aspectRatio;

    // The container's width WHILE IT IS STILL EMPTY. This has to be read before the canvas goes in,
    // because a container that sizes itself to its contents -- an inline-block, a float, anything
    // `width: fit-content` -- reports the canvas's width back once there is a canvas in it, and so
    // looks perfectly healthy while being useless. Empty, such a container is 0 wide, which is the
    // signal. A block-level container gives the same answer before and after, so nothing is lost.
    let emptyHostWidth = null;
    if (canvas) {
      this.canvas = canvas;
    } else {
      const host = typeof container === "string" ? document.querySelector(container) : container;
      if (!host) throw new Error("hyperbolic-map: no container element found");
      this.host = host;
      emptyHostWidth = host.clientWidth;
      this.canvas = document.createElement("canvas");
      this.canvas.style.display = "block";
      host.appendChild(this.canvas);
    }

    // With `aspectRatio` the width comes from the container, so a container with no width of its own
    // is a silent failure: the widget takes the fresh canvas's default 300 px, and if it also
    // shrink-wraps, the ResizeObserver then reads that same 300 back forever and nothing ever moves.
    // Worth a warning rather than a throw -- a container inside a hidden tab is legitimately 0 wide
    // at construction and fixes itself on the first resize.
    if (aspectRatio && !width && emptyHostWidth === 0 && typeof console !== "undefined") {
      console.warn(
        "hyperbolic-map: `aspectRatio` takes the width from the container, but the container is 0 px " +
          "wide when empty, so the widget cannot tell how big to be. A container that sizes itself to " +
          "its contents (display: inline-block, a float, width: fit-content) will size itself to the " +
          "canvas instead, and the widget will never resize. Give it `display: block` and a width, or " +
          "pass an explicit `width`. (Harmless if the container is merely hidden right now.)",
      );
    }

    this.cssWidth =
      width || emptyHostWidth || (this.host ? this.host.clientWidth : this.canvas.clientWidth) || 400;
    this.cssHeight = aspectRatio
      ? this.cssWidth / aspectRatio
      : height || (this.host ? this.host.clientHeight : this.canvas.clientHeight) || this.cssWidth;

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
      if (this.aspectRatio) {
        // Width only. The container's height comes FROM the canvas, so reading it back and resizing
        // to it would oscillate; and because nothing here depends on the observed height, the resize
        // this triggers cannot re-enter -- the width is unchanged by it.
        if (w > 0 && w !== this.cssWidth) {
          this.resize(w, w / this.aspectRatio);
          onResize();
        }
        return;
      }
      const h = target.clientHeight;
      if (w > 0 && h > 0 && (w !== this.cssWidth || h !== this.cssHeight)) {
        this.resize(w, h);
        onResize();
      }
    });
    this.resizeObserver.observe(target);
  }

  // The disk radius in CSS pixels for a given zoom. Sized by the SMALLER side, so the disk always
  // fits: sizing by width on both axes would clip it top and bottom on a portrait canvas.
  radiusFor(zoom) {
    return (zoom * Math.min(this.cssWidth, this.cssHeight)) / 2;
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
// center, so any sub-segment is the MINOR arc. Normalizing the angle difference into (-pi, pi] and
// sweeping that way is therefore always right.

// Result object, reused by the caller to avoid allocating per edge.
//
// `anticlockwise` is the one British spelling in this library, and it is deliberate: that is the
// name the HTML specification gives the sixth argument of `CanvasRenderingContext2D.arc()`, which
// this field is passed straight into. Spelling it the American way here would make the call site
// read `ctx.arc(..., arc.counterclockwise)` and hide the correspondence.
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
// An edge is drawn as a straight chord only when it is visually straight: `sagittaTolerance`, in disk
// units, is the largest bulge that may be flattened away. A fixed chord-LENGTH threshold would be
// zoom-independent and therefore visibly wrong when zoomed in, since the same chord bulges further
// across the screen the closer it is to the center. Pass sagittaTolerance = 0 to always use an arc.
function geodesicArc(x1, y1, x2, y2, out, sagittaTolerance) {
  const denom = x1 * y2 - x2 * y1;
  const dist2 = (x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2);

  if (Math.abs(denom) <= DEGENERATE) {
    // Collinear with the origin: the geodesic is a diameter.
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
  //   d > 0 means increasing theta (counter-clockwise in the math frame), which is DECREASING
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
// Compiling does the work that would otherwise be repeated every frame: the companion
// w = sqrt(1 + x^2 + y^2) for each point, the resolved style, and a Minkowski bounding cap for
// cheap culling.
//
// Point flags rather than move/line commands: a point's flag string describes the edge LEAVING that
// point. "L" strokes it; absent means the edge still participates in the fill but is not stroked.
// "P" draws a marker at the point. The fill path always closes. A move/line model cannot express a
// closed fill with a disconnected stroke without duplicating geometry, which is why this is the
// format.

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

// Resolved styles are INTERNED: identical styles share one frozen object.
//
// They were not, and the cost was quietly large. The Escher scene has about half a dozen distinct
// appearances but was compiling 38,640 separate style objects, one per drawable -- measured, the
// count of distinct style objects exactly equalled the count of drawables in all three datasets.
// That is pure memory bloat, it defeats identity comparison in the renderer's canvas-state cache,
// and it makes it impossible to spot runs of same-styled shapes.
//
// The table is module-scope so that the atlas, which compiles each tile separately, shares one set
// across every tile. It is capped: a pathological generator emitting a unique color per shape would
// otherwise grow it without bound, and falling back to unshared objects is merely the old behavior.
const styleTable = new Map();
const STYLE_TABLE_LIMIT = 4096;

const STYLE_KEYS = [
  "fill", "stroke", "lineWidth", "lineCap", "lineJoin", "miterLimit",
  "markerRadius", "markerFill", "align", "baseline", "font",
];

function internStyle(out) {
  let key = "";
  for (let i = 0; i < STYLE_KEYS.length; i++) key += out[STYLE_KEYS[i]] + "\u0001";
  const hit = styleTable.get(key);
  if (hit) return hit;
  // Frozen so that a later mutation cannot silently restyle every drawable that shares it. Anything
  // that varies per drawable (a marker's radius) has to be folded in BEFORE interning, not written
  // onto the resolved style afterwards.
  const frozen = Object.freeze(out);
  if (styleTable.size < STYLE_TABLE_LIMIT) styleTable.set(key, frozen);
  return frozen;
}

function resolveStyle(spec, styleSheet, extra) {
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
  if (extra !== undefined) Object.assign(out, extra);
  return internStyle(out);
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
  }
}

function compileOne(src, styleSheet) {
  if (!src) return null;

  if (src.type === "path") {
    const pts = src.points;
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
    return out;
  }

  if (src.type === "marker") {
    const out = new Drawable("marker");
    out.xs = new Float64Array([src.at[0]]);
    out.ys = new Float64Array([src.at[1]]);
    out.ws = new Float64Array([localCompanion(src.at[0], src.at[1])]);
    // Fold the radius in BEFORE interning: styles are shared and frozen, so mutating one here would
    // change the radius of every marker that happens to look the same.
    out.style = resolveStyle(src, styleSheet, src.radius !== undefined ? { markerRadius: src.radius } : undefined);
    out.cap = Cap.enclosing(out.xs, out.ys, 0, 1);
    return out;
  }

  return null;
}

// Accepts an array of drawables, or a {version, coordinates, drawables} document.
function compileDrawables(data, styleSheet) {
  let list;
  if (Array.isArray(data)) list = data;
  else if (data && Array.isArray(data.drawables)) list = data.drawables;
  else if (data == null) list = [];
  else throw new TypeError("expected an array of drawables or a { drawables: [...] } document");

  const out = [];
  for (let i = 0; i < list.length; i++) {
    // A falsy entry skips rather than truncating: a generator that returns a hole in its output
    // should lose one shape, not everything after it.
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

// Text sizing. A text drawable carries an `up` vector rather than a pixel height, so its size is a
// dimensionless MULTIPLIER applied to a base font: the glyphs scale with the geometry, which is the
// only thing that makes sense when the projection compresses distance towards the rim. The base is
// 14pt = 14 * 96/72 px. Reading the multiplier as a pixel height instead makes every glyph
// sub-pixel and silently drops all the text.
const FONT_SCALE = 0.05;
const BASE_FONT_PX = (14 * 96) / 72;

const scratch = [0, 0];
const arc = new Arc();

// Projected-vertex scratch, grown on demand and reused for every path in every frame.
//
// Allocating `new Float64Array(n)` twice per path instead would be 77,280 typed arrays per frame on
// the Escher scene, and it shows up exactly where you would expect: a median frame of 63 ms with a p95
// of 261 ms, the tail being garbage collection. The buffers are module-scope because drawPath is never
// re-entered -- it does not call back into the renderer.
let vertX = new Float64Array(1024);
let vertY = new Float64Array(1024);
function ensureVertexCapacity(n) {
  if (n <= vertX.length) return;
  let cap = vertX.length;
  while (cap < n) cap *= 2;
  vertX = new Float64Array(cap);
  vertY = new Float64Array(cap);
}

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
    this.subPixelSkipped = 0;
    this.verticesDecimated = 0;
  }
}

// Culling is always the same test, so it is not an option: reject a whole drawable up front with a
// 6-multiply Minkowski test against its precomputed bounding cap. The obvious alternative -- keep an
// edge only if one of its two projected endpoints is inside the draw radius -- is both wrong and
// slower: it drops long edges that cross the visible region without either endpoint inside it, and it
// can only run after all the projection work has already been done.

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
    // Forget any cached canvas state: the background, rim, layers and user hooks below all set
    // styles on this same context, and a caller may have touched it between frames too.
    this.forgetCanvasState();

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
      sagittaTolerancePx = 0.25,
      minTextPx = 3,
      minFeaturePx = 0,
      decimateTolerancePx = 0,
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
          sagittaTolerancePx,
          minTextPx,
          minFeaturePx,
          decimateTolerancePx,
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

  // The per-drawable style cache is only valid while nothing else writes to the context, so every
  // path that does must clear it. Cheaper to be blunt about this than to reason case by case: a
  // stale cache means a shape silently painted in the previous shape's color.
  forgetCanvasState() {
    this.lastFill = null;
    this.lastStroke = null;
    this.lastLineWidth = null;
    this.lastLineCap = null;
    this.lastLineJoin = null;
    this.lastMiterLimit = null;
  }

  drawContent(ctx, view, scene, matrix, opts) {
    // Each pass may be wrapped in save()/clip()/restore() by the caller, which restores canvas state
    // wholesale, so the cache cannot survive a pass boundary either.
    this.forgetCanvasState();

    const stats = this.stats;
    const m = matrix || view.matrix;
    const scale = view.radius;
    const shiftX = view.cx;
    const shiftY = view.cy;
    const drawRadius = view.drawRadius;

    // Everything the cap test needs, computed once per frame.
    const center = m.centerLocal([0, 0]);
    const cX = center[0];
    const cY = center[1];
    const cW = Math.sqrt(1 + cX * cX + cY * cY);
    const capCache = new Map();

    const minFeaturePx = opts.minFeaturePx || 0;
    // The sagitta tolerance is given in pixels; convert to disk units for this frame's zoom.
    const sagittaTolerance = opts.sagittaTolerancePx / scale;

    stats.drawables += scene.length;

    for (let di = 0; di < scene.length; di++) {
      const d = scene[di];

      let thr = capCache.get(d.cap.radius);
      if (thr === undefined) {
        thr = capThreshold(Math.min(drawRadius, 0.999999), d.cap.radius);
        capCache.set(d.cap.radius, thr);
      }
      // cosh(d/2)^2 between the view center and this drawable's bounding cap -- the same quantity
      // the visibility test needs, so compute it once and use it twice.
      const cap = d.cap;
      const A = cap.w * cW - cap.x * cX - cap.y * cY;
      const B = cap.x * cY - cap.y * cX;
      const ch2 = A * A + B * B;
      if (ch2 > thr * thr) continue;

      // Sub-pixel gate. In the Poincare disk the Euclidean and hyperbolic metrics differ by
      // (1 - |z|^2)/2, and |z| = tanh(d/2) gives 1 - |z|^2 = 1/cosh^2(d/2) = 1/ch2 -- so the cap's
      // on-screen DIAMETER is capRadius * scale / ch2, with no extra projection whatsoever.
      //
      // This matters far more in the hyperbolic plane than it would on a map: measured on the
      // Escher scene at its default view, 59% of the 38,640 shapes project to under one pixel, and
      // they carry 45% of all vertices. They are crushed against the rim where the projection
      // compresses infinite area into a finite ring.
      //
      // The STROKE has to be counted, not just the geometry. A shape 0.3 px across drawn with a
      // 2 px stroke still paints a 2 px mark, so a gate on the fill's size alone erases marks that
      // are plainly visible. Measured before this was added: at a panned view, 0.17% of color
      // channels changed, some by a full 255, while a control comparing two identical renders
      // differed by exactly nothing -- so those were real losses, not rasterizer noise.
      //
      // Default 0, i.e. off. The viewport raises it only while a gesture is in flight.
      if (minFeaturePx > 0) {
        const st = d.style;
        const inkPx =
          (cap.radius * scale) / ch2 + (st.stroke && st.stroke !== "none" ? st.lineWidth : 0);
        if (inkPx < minFeaturePx) {
          stats.subPixelSkipped++;
          continue;
        }
      }
      stats.survivors++;

      if (d.kind === "path") this.drawPath(ctx, d, m, scale, shiftX, shiftY, sagittaTolerance, opts);
      else if (d.kind === "text") this.drawText(ctx, d, m, scale, shiftX, shiftY, opts);
      else if (d.kind === "marker") this.drawMarker(ctx, d, m, scale, shiftX, shiftY);
    }
  }

  drawPath(ctx, d, m, scale, shiftX, shiftY, sagittaTolerance, opts) {
    const stats = this.stats;
    const decimate = opts.decimateTolerancePx || 0;
    const decimate2 = decimate * decimate;
    const n = d.xs.length;
    if (n < 2) return;

    // Project every vertex exactly once. The 2011 code projected each vertex twice -- once as the
    // start of its own edge and once as the end of the previous one.
    ensureVertexCapacity(n);
    const px = vertX;
    const py = vertY;
    for (let i = 0; i < n; i++) {
      m.applyToLocal(d.xs[i], d.ys[i], d.ws[i], scratch);
      px[i] = scratch[0];
      py[i] = scratch[1];
    }
    stats.pointsProjected += n;
    stats.drawn++;

    const style = d.style;
    const last = d.closed ? n : n - 1;

    // Build the fill path (all edges, closed) and the stroke path (only flagged edges).
    const doFill = style.fill && style.fill !== "none";
    const doStroke = style.stroke && style.stroke !== "none";

    if (doFill) {
      ctx.beginPath();
      ctx.moveTo(px[0] * scale + shiftX, -py[0] * scale + shiftY);
      // Decimate: drop a vertex that lands within `decimate` pixels of the last one actually emitted.
      //
      // In the hyperbolic plane this is not a marginal saving. The projection crushes unbounded area
      // into the rim, so most shapes arrive tiny: measured on the Escher scene at its default view,
      // 59% of edges are shorter than half a pixel and 39% shorter than a quarter. Each one costs a
      // JS-to-C++ lineTo, and there are 264,000 of them per frame, which is why 57% of the frame is
      // spent inside the rasterizer rather than in our own code.
      //
      // The last vertex is always emitted, so the outline still closes exactly where it should, and
      // the tolerance is compared against the last EMITTED point rather than the previous vertex so
      // that a long run of small steps cannot accumulate into a visible drift.
      let ex = px[0] * scale;
      let ey = py[0] * scale;
      for (let i = 0; i < last; i++) {
        const j = (i + 1) % n;
        if (decimate > 0 && i < last - 1) {
          const dx = px[j] * scale - ex;
          const dy = py[j] * scale - ey;
          if (dx * dx + dy * dy < decimate2) {
            stats.verticesDecimated++;
            continue;
          }
        }
        this.edgeTo(ctx, px[i], py[i], px[j], py[j], scale, shiftX, shiftY, sagittaTolerance);
        ex = px[j] * scale;
        ey = py[j] * scale;
      }
      ctx.closePath();
      // Assigning a canvas style property is not free in Chrome even when the value is unchanged --
      // it re-parses the CSS color string. Styles are interned at compile time and the data is
      // depth-sorted, so consecutive drawables very often share one, and skipping the redundant
      // assignment is measurable on scenes with tens of thousands of shapes.
      if (this.lastFill !== style.fill) {
        ctx.fillStyle = style.fill;
        this.lastFill = style.fill;
      }
      // No save()/clip()/restore() here. The 2011 code built this path, clipped to it, rebuilt the
      // identical path, and filled -- but fill INTERSECT clip == fill, so the clip was a no-op and
      // the path was constructed twice.
      ctx.fill();
      stats.canvasCalls++;
    }

    if (doStroke) {
      ctx.beginPath();
      let penAt = -1;
      let sx0 = 0;
      let sy0 = 0;
      for (let i = 0; i < last; i++) {
        if (!(d.flags[i] & FLAG_STROKE)) continue;
        const j = (i + 1) % n;
        if (penAt !== i) {
          ctx.moveTo(px[i] * scale + shiftX, -py[i] * scale + shiftY);
          sx0 = px[i] * scale;
          sy0 = py[i] * scale;
        } else if (decimate > 0 && i < last - 1 && (d.flags[j] & FLAG_STROKE)) {
          // Only decimate INSIDE a run of stroked edges, and never the run's last edge: dropping the
          // vertex where a run ends would move the end of a visible line.
          const dx = px[j] * scale - sx0;
          const dy = py[j] * scale - sy0;
          if (dx * dx + dy * dy < decimate2) {
            stats.verticesDecimated++;
            penAt = j;
            continue;
          }
        }
        this.edgeTo(ctx, px[i], py[i], px[j], py[j], scale, shiftX, shiftY, sagittaTolerance);
        sx0 = px[j] * scale;
        sy0 = py[j] * scale;
        penAt = j;
      }
      if (this.lastStroke !== style.stroke) {
        ctx.strokeStyle = style.stroke;
        this.lastStroke = style.stroke;
      }
      if (this.lastLineWidth !== style.lineWidth) {
        ctx.lineWidth = style.lineWidth;
        this.lastLineWidth = style.lineWidth;
      }
      if (this.lastLineCap !== style.lineCap) {
        ctx.lineCap = style.lineCap;
        this.lastLineCap = style.lineCap;
      }
      if (this.lastLineJoin !== style.lineJoin) {
        ctx.lineJoin = style.lineJoin;
        this.lastLineJoin = style.lineJoin;
      }
      if (this.lastMiterLimit !== style.miterLimit) {
        ctx.miterLimit = style.miterLimit;
        this.lastMiterLimit = style.miterLimit;
      }
      ctx.stroke();
      stats.canvasCalls++;
    }

    // Vertex markers.
    let hasMarker = false;
    for (let i = 0; i < n; i++) if (d.flags[i] & FLAG_MARKER) { hasMarker = true; break; }
    if (hasMarker) {
      this.lastFill = null;
      // The 2011 code read the marker radius out of the FILL COLOR field, giving ctx.arc a string
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

  edgeTo(ctx, x1, y1, x2, y2, scale, shiftX, shiftY, sagittaTolerance) {
    geodesicArc(x1, y1, x2, y2, arc, sagittaTolerance);
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
    const sizePx = scale * FONT_SCALE * Math.hypot(ux - ax, uy - ay) * BASE_FONT_PX;
    if (!(sizePx > opts.minTextPx)) {
      stats.textSkipped++;
      return;
    }

    ctx.save();
    ctx.fillStyle = d.style.fill && d.style.fill !== "none" ? d.style.fill : "#000000";
    this.lastFill = null;
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
    this.lastFill = null;
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
// Defense in depth here, because any single mechanism can be defeated:
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
    // Keep the raw client position too. The pinch has to re-map its fingers against the COMMITTED
    // zoom rather than the live one (see handleMove), and a stored disk coordinate cannot be
    // converted after the fact.
    this.pointers.set(e.pointerId, { x, y, clientX: e.clientX, clientY: e.clientY });
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
      // Re-map both fingers against the just-committed zoom, for the same reason handleMove does:
      // the first finger's stored coordinate was taken at whatever the live zoom was then, which a
      // wheel-zoom during the one-finger pan could have changed.
      const z = this.view.zoom;
      const [s1x, s1y] = this.host.toDisk(p1, z);
      const [s2x, s2y] = this.host.toDisk(p2, z);
      this.view.beginPinch(s1x, s1y, s2x, s2y);
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
    const p = this.pointers.get(e.pointerId);
    p.x = x;
    p.y = y;
    p.clientX = e.clientX;
    p.clientY = e.clientY;
    if (e.preventDefault) e.preventDefault();

    if (this.mode === MODE_PAN) {
      // Clamp rather than ignore. Ignoring a cursor past the rim is what made the 2011 drag freeze
      // there and then resume from the stale position; clamping keeps the gesture continuous.
      const [cx, cy] = clampToRadius(x, y, this.options.interactRadius);
      this.view.updatePan(cx, cy);
      this.changed();
    } else if (this.mode === MODE_ROTATE) {
      this.view.updateRotate(x, y);
      this.changed();
    } else if (this.mode === MODE_PINCH && this.pointers.size >= 2) {
      // Pan and rotate work in the CURRENT frame's screen coordinates, so they want the live zoom --
      // that is what keeps a wheel-zoom in the middle of a drag consistent, one of the 2011 bugs.
      // The pinch solver is different: it is handed finger positions measured against the zoom in
      // force when the gesture began and divides by the scale it solves for. Feeding it live-zoom
      // coordinates applies the scale twice.
      //
      // The symptom was subtle because the error is proportional to |scale - 1|: a twist that barely
      // changed the zoom drifted 2.7 px, while a spread to 1.5x drifted 30 px, so the fingers slid
      // out from under the picture only on vigorous pinches. Re-map both fingers here against the
      // committed zoom, which is exactly what beginPinch recorded them in.
      const [p1, p2] = [...this.pointers.values()];
      const z = this.view.zoom;
      const [q1x, q1y] = this.host.toDisk(p1, z);
      const [q2x, q2y] = this.host.toDisk(p2, z);
      this.view.updatePinch(
        q1x, q1y, q2x, q2y,
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
      // behavior.
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

    // Normalize across deltaMode: 0 = pixels, 1 = lines, 2 = pages.
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
// Data sources: the single-patch half of the library's data model.
//
// There are two data models, and they are not two ways of doing one thing:
//
//   SourceSet (here)  data indexed by the VIEW -- "give me what is visible from here". Global
//                     coordinates, fetched with a significance gate and an AbortSignal.
//   Atlas             data indexed by the TILE -- "give me tile k". Tile-local coordinates, cached
//                     per tile.
//
// Both answer questions the other cannot, so both exist. What they share is the far side: each
// produces a list of {drawables, matrix} PASSES for one frame, and one renderer draws them. That
// shared `passes(view)` shape is why HyperbolicViewport.render() is a single loop over pass
// producers rather than a branch on which mode it is in.
//
// A source supplies compiled drawables for the current view. Two flavors:
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
    // Do not ask again until the view center has moved by this fraction of the visible radius, or
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
  // project the previous request's center under the CURRENT view and see how far it has drifted from
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
    const center = view.matrix.centerLocal([0, 0]);
    const cw = Math.sqrt(1 + center[0] ** 2 + center[1] ** 2);
    this.lastRequest = { cx: center[0], cy: center[1], cw: cw, zoom: view.zoom };
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
      center: [center[0], center[1]],
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

// The named sources of a single-patch viewport, drawn in insertion order.
//
// Each source may carry its own extra isometry, composed on the RIGHT so its drawables stay in their
// own frame -- which is how the clock demo rotates its hands in O(1) per tick instead of rebuilding
// every drawable.
class SourceSet {
  constructor(options = {}) {
    this.styleSheet = options.styleSheet;
    // Called when an async source resolves, so the viewport can schedule a frame.
    this.onInvalidate = options.onInvalidate || null;
    this.entries = new Map();
  }

  // The pass-producer interface, shared with Atlas. `onReady` is accepted and ignored: a source
  // signals arrival through its own onLoad rather than per frame.
  passes(view /* , onReady */) {
    const out = [];
    for (const entry of this.entries.values()) {
      const drawables = entry.source.get(view);
      if (!drawables || drawables.length === 0) continue;
      out.push({
        drawables: drawables,
        matrix: entry.transform ? view.matrix.mul(entry.transform) : view.matrix,
      });
    }
    return out;
  }

  add(name, data, opts = {}) {
    const source = typeof data === "function"
      ? new CallbackSource(data, {
        styleSheet: this.styleSheet,
        onLoad: () => this.onInvalidate && this.onInvalidate(),
      })
      : new StaticSource(data, this.styleSheet);
    this.entries.set(name, { source: source, transform: opts.transform || null });
    return source;
  }

  remove(name) {
    const entry = this.entries.get(name);
    if (entry && entry.source.destroy) entry.source.destroy();
    this.entries.delete(name);
  }

  has(name) {
    return this.entries.has(name);
  }

  // Replace a static source's data in place where possible, so its transform survives.
  setData(name, data) {
    const entry = this.entries.get(name);
    if (entry && entry.source instanceof StaticSource) {
      entry.source.setData(data, this.styleSheet);
      return;
    }
    this.entries.set(name, {
      source: new StaticSource(data, this.styleSheet),
      transform: entry ? entry.transform : null,
    });
  }

  setTransform(name, isom) {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`hyperbolic-map: no source named "${name}"`);
    entry.transform = isom;
  }

  // Force every async source to re-request, bypassing the throttle and the significance gate.
  refresh(view) {
    for (const entry of this.entries.values()) {
      if (entry.source.refresh) entry.source.refresh(view);
    }
  }

  destroy() {
    for (const entry of this.entries.values()) if (entry.source.destroy) entry.source.destroy();
  }
}

// ===== src/data/atlas/anchor.js =====
// The anchored camera: the piece that keeps every number small.
//
// The view is stored NOT as an isometry of the world, but as an isometry of the camera tile's own
// frame:
//
//     V_c := V . F_c        so that   screen = V_c(p)   for p in camera-tile-local coordinates
//
// and any other tile's contribution is
//
//     net = V_c . R          where R = F_c^-1 . F_k is that tile's frame RELATIVE to the camera,
//
// built by multiplying one constant generator per step of the walk. `V` and `F_k` never exist
// numerically, which is the entire point: at binary cell (500, 0) the global frame has entries of
// 1.08e75, and forming `V . F_k` to get an O(1) screen position destroys every digit.
//
// Two identities make this work, both proved in dev/audit_atlas_math.py:
//
//   re-anchor   crossing into c' = c.g  =>  V_c' = V_c . G_g          (claim 3)
//   telescoping R_{c -> c.w} = G_w1 . G_w2 . ...                       (claim 4)
//
// The first is what bounds the view: whenever the camera would drift far from its tile, it changes
// tile instead, and the matrix is multiplied by one O(1) generator. Measured: 1,256 tile crossings of
// {8,3} leave max|V_c| at 1.105. Without it, 500 crossings would need entries of order 1e165.
//
// Note the camera tile does NOT have to be the tile containing the view center. It only has to be
// NEAR it, so that V_c stays O(1) and the walk starts nearby. Tile identity comes from the walk's
// addresses, not from which tile the camera picked, so a greedy nearest-center rule is sufficient and
// works uniformly for tilings whose cells are not Voronoi cells of their centers (the binary one).

// The camera holds only its ADDRESS. The camera-relative view matrix lives in the ViewState, which
// already owns committed-versus-live bookkeeping, and is passed in. Duplicating it here would mean two
// copies to keep in step, and a gesture rewrites the live matrix every frame.
class Anchor {
  constructor(tiling, options = {}) {
    this.tiling = tiling;
    this.address = options.address !== undefined && options.address !== null
      ? options.address
      : tiling.originAddress();
    this.reanchorCount = 0;
    this.lastTruncated = false;
    this._buf = [0, 0];
  }

  atOrigin() {
    return this.tiling.addressEquals(this.address, this.tiling.originAddress());
  }

  // The view center expressed in camera-tile-local coordinates: V_c^-1(0). All small numbers.
  viewCenterLocal(matrix, out) {
    const inv = matrix.inverse();
    inv.applyToDisk(0, 0, this._buf);
    const zx = this._buf[0];
    const zy = this._buf[1];
    const k = 1 / Math.sqrt(Math.max(1e-300, 1 - zx * zx - zy * zy));
    const x = zx * k;
    const y = zy * k;
    out[0] = x;
    out[1] = y;
    out[2] = Math.sqrt(1 + x * x + y * y);
    return out;
  }

  // Move the camera to whichever neighbor's center is nearest the view center, repeatedly.
  //
  // Every quantity here is in camera-local coordinates, so nothing knows or cares how far the camera
  // has traveled. Bounded iteration because a single frame can only move the view a little; the
  // limit exists so a pathological setCamera cannot spin.
  // Returns the accumulated RIGHT factor: the caller must replace its matrix with matrix.mul(shift),
  // and must apply the same shift to any other representation of the same view (the ViewState keeps a
  // committed and a live copy). Returning the shift rather than mutating a matrix is what makes
  // re-anchoring safe in the middle of a gesture: `updatePan` builds the live matrix by
  // LEFT-multiplying the committed one, so a right factor applied to both is exactly consistent and
  // the grabbed screen point stays pinned.
  // `maxSteps` is generous on purpose. Each step is a couple of dozen flops, and the camera may have
  // to catch up a long way at once -- a gesture that ran while rendering was throttled, or a
  // setCamera to a distant tile. Being unable to catch up is what lets V grow, so the bound exists
  // only to guarantee termination, not to ration work.
  reanchor(matrix, maxSteps = 4096) {
    const c = [0, 0, 0];
    let shift = Isom.identity();
    let current = matrix;
    let steps = 0;
    // Monotonicity guard. Each step must bring the view center strictly closer to the camera tile's
    // center; that is what makes the descent terminate. Enforcing it here rather than trusting each
    // tiling's rule means a tiling with a subtly non-monotone `stepToward` degrades to "stop early"
    // instead of spinning to the iteration cap -- which is what a 2-cycle looks like: 4,096 steps on a
    // single camera move.
    let previous = Infinity;
    for (; steps < maxSteps; steps++) {
      this.viewCenterLocal(current, c);
      if (!(c[2] < previous)) break;
      previous = c[2];
      // Ask the tiling which way to go. Each tiling answers with an EXACT, monotone rule -- the most
      // violated half-plane for a regular tiling, the box test for a binary cell -- so the descent
      // cannot cycle. It must be the TILING's rule and not a generic nearest-center comparison with a
      // tolerance: that suits Voronoi cells but not binary ones, and mixing it with a containment check
      // makes the two rules fight -- measured, 500 small camera moves then cost 143,407 re-anchor steps
      // against about 30.
      //
      // The answer is an INDEX INTO the neighbor list, which is why the list's order is part of the
      // Tiling contract. Naming a generator instead cannot work for the binary tiling, whose parent
      // step has two parities: an odd-longitude cell offers only PARENT_ODD, so a request for
      // PARENT_EVEN finds nothing and the camera can never move up at all.
      const nbrs = this.tiling.neighbors(this.address);
      const dir = this.tiling.stepToward(c[0], c[1]);
      if (dir < 0 || dir >= nbrs.length) break;
      const chosen = nbrs[dir];
      // stepFrame, not generator: on a {p,q} tiling the step carries the C_m correction that lands
      // in the neighbor's CANONICAL frame, so V_c is always the view in the anchor's canonical
      // frame rather than in whichever frame the route happened to produce.
      const g = this.tiling.stepFrame(this.address, chosen.gen);
      shift = shift.mul(g).normalize();
      current = current.mul(g).normalize();
      this.address = chosen.address;
      this.reanchorCount++;
    }
    return { steps, shift };
  }

  // Which tile contains a given point of the CAMERA TILE's local frame, and where that point sits in
  // that tile's own coordinates?
  //
  // The same descent `reanchor` performs, but without moving the camera -- so it answers "what is under
  // the cursor?" without side effects. Everything stays camera-relative, so it is as accurate at 200,000
  // tiles from the origin as at the origin.
  locateFromCameraLocal(x, y, maxSteps = 4096) {
    let address = this.address;
    let rel = Isom.identity();
    let px = x;
    let py = y;
    let previous = Infinity;
    for (let step = 0; step < maxSteps; step++) {
      const w = Math.sqrt(1 + px * px + py * py);
      if (!(w < previous)) break;
      previous = w;
      const nbrs = this.tiling.neighbors(address);
      const dir = this.tiling.stepToward(px, py);
      if (dir < 0 || dir >= nbrs.length) break;
      const g = this.tiling.stepFrame(address, nbrs[dir].gen);
      rel = rel.mul(g).normalize();
      address = nbrs[dir].address;
      // Re-express the point in the new tile's frame.
      const inv = g.inverse();
      const out = inv.applyToLocal(px, py, w, this._buf);
      const k = 1 / Math.sqrt(Math.max(1e-300, 1 - out[0] * out[0] - out[1] * out[1]));
      px = out[0] * k;
      py = out[1] * k;
    }
    return { address, local: [px, py], rel };
  }

  // Tiles that can be on screen, each with its frame RELATIVE to the camera.
  //
  // Breadth-first from the camera tile, starting at the identity and multiplying by one constant
  // generator per step. Two radii: a tile is INCLUDED when its circumscribed disk meets the visible
  // disk, and the walk CONTINUES through a slightly larger radius so a tile touching only at a corner
  // is still reachable through a neighbor that was itself included.
  //
  // Returns [{ address, rel }] with `rel` mapping tile-local coordinates into camera-local ones.
  neighborhood(matrix, visibleRadius, maxTiles = 256) {
    this.lastTruncated = false;
    const tiling = this.tiling;
    const rho = 2 * Math.atanh(Math.min(visibleRadius, 0.9995));
    const chi = tiling.metrics.circumradius;
    const spacing = tiling.metrics.centerSpacing;
    const includeCosh = Math.cosh((rho + chi) / 2);
    const walkCosh = Math.cosh((rho + chi + spacing) / 2);

    const c = this.viewCenterLocal(matrix, [0, 0, 0]);
    const cx = c[0];
    const cy = c[1];
    const cw = c[2];

    const buf = this._buf;
    // cosh(d/2) from the view center to a tile center, both in camera-local coordinates.
    const coshHalfTo = (rel) => {
      rel.applyToDisk(0, 0, buf);
      const k = 1 / Math.sqrt(Math.max(1e-300, 1 - buf[0] * buf[0] - buf[1] * buf[1]));
      const tx = buf[0] * k;
      const ty = buf[1] * k;
      const tw = Math.sqrt(1 + tx * tx + ty * ty);
      const A = tw * cw - tx * cx - ty * cy;
      const B = tx * cy - ty * cx;
      return Math.hypot(A, B);
    };

    // Deduplication, on the ADDRESS. Every tiling hands out canonical addresses -- the binary one by
    // construction from (lat, lon), a regular one because its id is an exact integer name for the tile
    // -- so the key IS the identity and a Set is the whole answer.
    //
    // Note what is NOT here: no geometric comparison, no rounding of centers into buckets, no "these
    // two are within a quarter of a tile spacing so call them the same". Deciding identity by proximity
    // has a distance ceiling wherever it is done, because two distinct tiles eventually sit closer
    // together than the error in the numbers describing them. The exact id has no threshold in it.
    const seenAddress = new Set();
    const alreadySeen = (key) => {
      if (seenAddress.has(key)) return true;
      seenAddress.add(key);
      return false;
    };

    const out = [];
    const dist = [];
    const queue = [{ address: this.address, rel: Isom.identity() }];
    // Gather twice the budget so that, when truncating, there is something to choose between:
    // admitting in BFS discovery order instead lets a one-ULP view change swap which rim tile is last,
    // which shows up as a tile flickering between otherwise identical frames. BFS explores by GRAPH
    // distance, which only approximates geometric distance, so over-gathering is what makes the
    // nearest-first choice meaningful rather than nominal.
    const gatherLimit = Math.max(maxTiles + 8, maxTiles * 2);
    // A hard bound on dequeues, separate from the bound on results: every admitted tile pushes its
    // neighbors, so a dedup failure would otherwise grow the queue geometrically while `out` never
    // fills. Degrading to fewer tiles is acceptable; not returning is not.
    let examined = 0;
    const maxExamined = 24 * maxTiles + 512;

    while (queue.length && out.length < gatherLimit) {
      if (++examined > maxExamined) {
        this.lastTruncated = true;
        break;
      }
      const node = queue.shift();
      if (alreadySeen(tiling.addressKey(node.address))) continue;
      const ch = coshHalfTo(node.rel);
      if (ch > walkCosh) continue;
      if (ch <= includeCosh) {
        out.push(node);
        dist.push(ch);
      }
      // Look before naming. `tiling.generator(g)` moves the tile CENTER exactly where the real step
      // does -- they differ only by a rotation about that center -- so a candidate costs 4 float
      // multiplies to test, and only the survivors are turned into addresses. Naming is the expensive
      // half: on a regular tiling an address is an exact integer object costing ~117 ring multiplies to
      // build. Which tiles are RETURNED is unaffected, since a rejected candidate would be dropped by
      // this same test on dequeue.
      //
      // HONEST SCOPE, measured rather than assumed: this saves nothing on the Escher atlas, because
      // there the walk stops on the TILE BUDGET (`gatherLimit`) long before anything falls outside
      // `walkCosh`, so no candidate is ever rejected. It pays when the visible radius is what binds --
      // a small `maxTiles`, or zoomed in far enough that few tiles are on screen.
      const gens = tiling.neighborGens(node.address);
      for (let i = 0; i < gens.length; i++) {
        const g = gens[i];
        const probe = node.rel.mul(tiling.generator(g));
        if (coshHalfTo(probe) > walkCosh) continue;
        queue.push({
          address: tiling.extendAddress(node.address, g),
          rel: node.rel.mul(tiling.stepFrame(node.address, g)),
        });
      }
    }

    // Always honor the budget, and note that the condition is on the RESULT and not on the queue.
    // Truncating only when candidates remain would let a walk that gathered past maxTiles and then ran
    // out return MORE tiles than asked for -- a silent overrun for a caller sizing its cache to
    // maxTiles.
    if (out.length > maxTiles) {
      this.lastTruncated = true;
      const order = out.map((_, i) => i).sort((i, j) => dist[i] - dist[j]);
      return order.slice(0, maxTiles).map((i) => out[i]);
    }
    if (queue.length) this.lastTruncated = this.lastTruncated || out.length >= maxTiles;
    return out;
  }

  // Largest absolute matrix entry of a camera-relative view. Exposed because it is the single number
  // that shows this design working: it must stay O(1) no matter how far the camera has traveled.
  static maxEntry(m) {
    return Math.max(Math.abs(m.ar), Math.abs(m.ai), Math.abs(m.br), Math.abs(m.bi));
  }
}

// ===== src/data/atlas/symmetry.js =====
// Does a tile's artwork have C_m rotational symmetry? An OPT-IN LINT, for art that is meant to.
//
// This measures; it does not enforce. Tile frames are canonical -- a tile's frame is a function of the
// tile and not of the route the walk took to it -- so asymmetric art draws identically however you
// scroll, and there is no correctness requirement here for it to check.
//
// What it is FOR is art whose symmetry is part of its meaning. The Escher atlas traces one 90-degree
// sector of a fish and repeats it four times by exact rotation: that C_4 symmetry is what makes the
// result Escher's pattern rather than a different one, and if an edit ever breaks it the picture is
// wrong in a way no other check would notice. Switch this on for such art and leave it off otherwise.
// See notes/tilings.md and docs/MATH.md section 6.
//
// The check is deliberately on the RAW drawables in tile-local coordinates: a rotation about the tile
// center is an ordinary Euclidean rotation there, so this is exact and needs no geometry.

// A style key: two drawables can only be images of one another if they look the same.
function styleKey(d) {
  return [
    d.type || "path",
    d.fill || "",
    d.stroke || "",
    d.lineWidth == null ? "" : d.lineWidth,
    d.closed ? "c" : "o",
    d.lineCap || "",
    d.radius == null ? "" : d.radius,
  ].join("|");
}

function pointsOf(d) {
  if (d.points) return d.points;
  if (d.at) return [d.at];
  if (d.from && d.to) return [d.from, d.to];
  return null;
}

// The largest distance by which any point of the artwork fails to land on the artwork after rotating by
// 2*pi/m about the tile center. Zero means exactly invariant.
//
// Matching is per-drawable and style-aware: a rotated shape must map onto a shape of the SAME color and
// kind. Matching only the union of points would let a green fish land on a blue one and call the picture
// symmetric, which is precisely the failure that matters -- the shapes can be symmetric while the
// coloring is not, and the coloring is what you see.
function tileSymmetryResidual(drawables, m) {
  if (!drawables || !drawables.length || !(m > 1)) return { residual: 0, checked: 0, offender: null };
  const angle = (2 * Math.PI) / m;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);

  // Index drawables by style, with a coarse grid on their centroid.
  const byStyle = new Map();
  const items = [];
  for (let i = 0; i < drawables.length; i++) {
    const pts = pointsOf(drawables[i]);
    if (!pts || !pts.length) continue;
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      cx += p[0];
      cy += p[1];
    }
    cx /= pts.length;
    cy /= pts.length;
    const item = { i, pts, cx, cy, key: styleKey(drawables[i]) };
    items.push(item);
    let bucket = byStyle.get(item.key);
    if (!bucket) {
      bucket = [];
      byStyle.set(item.key, bucket);
    }
    bucket.push(item);
  }

  let residual = 0;
  let offender = null;
  for (const item of items) {
    // Where this shape must land.
    const rcx = item.cx * ca - item.cy * sa;
    const rcy = item.cx * sa + item.cy * ca;
    const bucket = byStyle.get(item.key) || [];
    // The best candidate is the same-style shape with the same point count whose centroid is nearest.
    let best = Infinity;
    for (const cand of bucket) {
      if (cand.pts.length !== item.pts.length) continue;
      if (Math.hypot(cand.cx - rcx, cand.cy - rcy) > 0.35) continue;
      // Hausdorff-style: every rotated point must be close to some point of the candidate.
      let worstPt = 0;
      for (const p of item.pts) {
        const qx = p[0] * ca - p[1] * sa;
        const qy = p[0] * sa + p[1] * ca;
        let near = Infinity;
        for (const o of cand.pts) {
          const dd = Math.hypot(o[0] - qx, o[1] - qy);
          if (dd < near) near = dd;
        }
        if (near > worstPt) worstPt = near;
        if (worstPt >= best) break;
      }
      if (worstPt < best) best = worstPt;
    }
    if (best > residual) {
      residual = best;
      offender = item.i;
    }
  }
  return { residual: Number.isFinite(residual) ? residual : Infinity, checked: items.length, offender };
}

// What the lint reports. Written out in full because the symptom ("some tiles flip as I scroll")
// gives no hint at all about the cause.
//
// An INFINITE residual is a different finding from a large one, and saying "worst mismatch Infinity"
// on its own sends people looking for a coordinate that blew up. It means the search found no
// candidate at all: some shape has no counterpart of the same style and the same number of points
// anywhere near where the rotation sends it. In practice that is a COLORING that is less symmetric
// than the outlines -- four fish rotate onto each other but are painted four different colors, so a
// green one is asked to land on a blue one -- or a shape hand-drawn a second time with a different
// number of nodes instead of being rotated.
function tileSymmetryMessage(residual, m, tilingName, offender) {
  const where = offender == null ? "" : ` (drawable ${offender})`;
  const finding = Number.isFinite(residual)
    ? `worst mismatch ${residual.toExponential(2)} in tile-local units${where}`
    : `one or more shapes have no counterpart at all${where}: nothing of the same color, kind and ` +
      `point count lies where the rotation sends them`;
  return (
    `hyperbolic-map: this tile's artwork is not invariant under rotation by 360/${m} degrees about the ` +
    `tile center -- ${finding}.\n` +
    `  ${tilingName} has tile stabilizer C_${m}. This is a LINT, not an error: tile frames are canonical, ` +
    `so asymmetric art\n` +
    `  is stable as you scroll, and you only asked to be told because this art is meant to be ` +
    `C_${m}-symmetric.\n` +
    `  Build it from one wedge repeated ${m} times, or set atlas.checkTileSymmetry to "warn" or "off".`
  );
}

// The lint's failure, when it is set to "throw".
//
// A distinct type because the atlas has to tell it apart from a TILE failing. A tile whose data will
// not load is one tile among hundreds: it is reported and skipped, and the map carries on. A lint the
// caller deliberately set to "throw" is a statement about the ARTWORK, and downgrading it to a skipped
// tile turns the loudest setting into the quietest one -- a single tile silently missing, which is
// exactly the sort of thing nobody notices until it is the tile under the cursor.
class TileSymmetryError extends Error {
  constructor(message) {
    super(message);
    this.name = "TileSymmetryError";
  }
}

// ===== src/data/atlas/atlas.js =====
// The atlas: an independent coordinate patch per tile.
//
// Why this exists, in two use cases:
//
//   * Data far from the origin loses precision when expressed in one global patch. At hyperbolic
//     distance 20 a disk coordinate is 1 - 3.6e-9, so there are only ~7 significant digits left in
//     the quantity that matters. Splitting the data into tiles means every coordinate is small and
//     measured from its own tile's center.
//
//     Crucially, the tile's frame is never expressed relative to the WORLD either. Everything here is
//     relative to the camera's own tile -- see anchor.js -- because a global frame has entries of
//     order cosh(d/2) (1.08e75 at binary cell (500, 0)) and multiplying it by an equally large view
//     matrix to obtain an O(1) screen position cancels away every digit. That was the original design
//     and it is why this was rebuilt.
//   * A repeating pattern becomes genuinely infinite: return the same tile data for every key.
//
// The tile -> data mapping is a callback that returns DATA, not URLs, so it can fetch, synthesise, or
// compose overlays. Rotation into each tile's frame is the library's job, never the callback's: the
// callback only ever sees and returns tile-local coordinates.

const CLIP_AUTO = "auto";
const CLIP_ALWAYS = "always";
const CLIP_NEVER = "never";

const atlasArc = new Arc();

// Every key the constructor destructures below. Kept beside it, and asserted against it by
// test/anchor.test.mjs, so that adding an option there without adding it here turns the new option
// into an error rather than into a default.
const ATLAS_OPTIONS = new Set([
  "tiling",
  "tileData",
  "clip",
  "cacheSize",
  "maxTiles",
  "styleSheet",
  "onTileLoad",
  "onTileError",
  "checkTileSymmetry",
  "tileSymmetryTolerance",
  "lodPx",
]);

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
      // "off" | "warn" | "throw". An OPT-IN LINT, off by default.
      //
      // Tile frames are canonical, so asymmetric art is perfectly stable and there is nothing here to
      // enforce. Switch it on when the art is MEANT to be C_m-symmetric -- a repeating pattern like the
      // Escher atlas, where losing the symmetry means the pattern is no longer the one being drawn --
      // and it will tell you when it has drifted.
      checkTileSymmetry = "off",
      tileSymmetryTolerance = 1e-6,
      // Below this on-screen tile radius (in CSS pixels) a tile draws its `lod` art instead of its full
      // art, if it supplied any. See passes().
      lodPx = 11,
    } = options;
    // Typos are an error here for the same reason they are for the viewport's own options: a
    // destructure silently ignores what it does not recognize, so `maxTiels: 5` would leave the
    // default in place and the only symptom would be "why is this not working".
    const unknown = Object.keys(options).filter((k) => !ATLAS_OPTIONS.has(k));
    if (unknown.length) {
      throw new Error(`hyperbolic-map: unknown atlas option(s): ${unknown.join(", ")}`);
    }
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
    this.checkTileSymmetry = checkTileSymmetry;
    this.lodPx = lodPx;
    this.tileSymmetryTolerance = tileSymmetryTolerance;
    // Populated by the first symmetry check: { residual, checked, ok }. Exposed so a demo page can show
    // it and so tests can assert on it.
    this.tileSymmetry = null;
    this._symmetryChecked = false;
    // The message to keep throwing once the lint has failed in "throw" mode. See verifyTileSymmetry.
    this._symmetryFailure = null;

    // key string -> {drawables, withinTile} once resolved
    this.cache = new Map();
    // key string -> promise, so concurrent frames do not issue duplicate requests
    this.pending = new Map();
    // The camera. Owned here so that the tiling, the walk and the cache all share one notion of where
    // "here" is.
    this.anchor = new Anchor(tiling);
    // Scratch, and the tile's circumradius in LOCAL coordinates -- used to measure a tile's screen size
    // for the level-of-detail switch, once per tile per frame.
    this._c0 = [0, 0];
    this._c1 = [0, 0];
    this.tileLocalRadius = Math.sinh((tiling.metrics.circumradius || 1) / 2);
    // Compiled art, memoized on the IDENTITY of the object the callback returned.
    //
    // A repeating atlas hands back one of a few shared objects for every tile -- the Escher atlas has
    // twelve, one per element of its color symmetry -- so compiling per tile would redo identical work.
    // Keying on object
    // identity collapses that to a map lookup without needing to know anything about the provider, and
    // is what keeps a burst of cache misses cheap: 160 tiles compiled from scratch cost 125 ms against
    // a 16 ms median frame. A provider that builds a fresh object every call simply misses this memo
    // and pays the compile, which is correct.
    this._compiled = typeof WeakMap === "function" ? new WeakMap() : null;
  }

  // The symmetry lint. See symmetry.js for what it measures and when it is worth switching on.
  //
  // Only meaningful for tilings with a non-trivial stabilizer: the binary tiling has none, so C_1
  // symmetry is vacuous and this is skipped entirely.
  verifyTileSymmetry(data) {
    if (this.checkTileSymmetry === "off") return;
    if (this._symmetryChecked) {
      // Measured already; the answer is a property of the art, so it is not re-measured. But a "throw"
      // that fired once and then let every later frame through would leave the page in a state that is
      // neither working nor visibly broken: the art is still wrong, and the only evidence is one tile
      // missing from the first frame. Keep throwing.
      if (this._symmetryFailure) throw new TileSymmetryError(this._symmetryFailure);
      return;
    }
    const m = this.tiling.stabilizerOrder;
    if (!(m > 1)) {
      this._symmetryChecked = true;
      return;
    }
    const drawables = data && data.drawables;
    if (!drawables || !drawables.length) return; // an empty tile says nothing; wait for a real one
    if (data.coordinates && data.coordinates !== "local") {
      // The check is only exact in tile-local coordinates, where the stabilizer is a plain Euclidean
      // rotation. Say so rather than reporting a number that means nothing.
      this._symmetryChecked = true;
      this.tileSymmetry = { skipped: `coordinates "${data.coordinates}" are not tile-local`, ok: true };
      return;
    }
    this._symmetryChecked = true;
    const { residual, checked, offender } = tileSymmetryResidual(drawables, m);
    const ok = residual <= this.tileSymmetryTolerance;
    this.tileSymmetry = { residual, checked, offender, m, ok };
    if (ok) return;
    const name = this.tiling.p
      ? `{${this.tiling.p},${this.tiling.q}}${this.tiling.m !== this.tiling.p ? ` with frameSymmetry ${this.tiling.m}` : ""}`
      : "this tiling";
    const msg = tileSymmetryMessage(residual, m, name, offender);
    if (this.checkTileSymmetry === "throw") {
      this._symmetryFailure = msg;
      throw new TileSymmetryError(msg);
    }
    if (typeof console !== "undefined") console.warn(msg);
  }

  // Ask for a tile's data. Returns the compiled drawables if they are ready, or null while a request
  // is outstanding. A failing tile is reported and then skipped, so one bad tile cannot take the map
  // down. The single exception is the symmetry lint set to "throw", which is a deliberate request for
  // a hard error about the artwork rather than about this tile; see verifyTileSymmetry.
  request(address, keyString, rel, onReady) {
    const hit = this.cache.get(keyString);
    if (hit) {
      // Refresh LRU position.
      this.cache.delete(keyString);
      this.cache.set(keyString, hit);
      return hit;
    }
    if (this.pending.has(keyString)) return null;

    // What the callback is told about the tile. Deliberately NOT a world frame -- there is no such
    // thing here any more -- but the tile's address plus its position relative to the camera, which is
    // all a provider can meaningfully use. The contract is unchanged in the way that matters: the
    // callback returns data in TILE-LOCAL coordinates and the library places it.
    const tile = {
      address: address,
      // The readable identifier, for filenames and logging. Built here, on a cache miss, rather than
      // per frame.
      id: this.tiling.addressToString(address),
      // The tile's CLASS, in [0, classCount). The only per-tile variation a {p,q} atlas may safely use:
      // unlike `address`, it is the same whichever route the walk took, so art keyed on it does not jump
      // when the camera re-anchors. `classCount` is 1 when the tiling admits no such invariant, in which
      // case every tile must look the same. See RegularTiling.tileClass.
      classIndex: this.tiling.tileClass ? this.tiling.tileClass(address) : 0,
      classCount: this.tiling.classModulus || 1,
      // The tile's element of a declared COLOR SYMMETRY: the permutation this tile applies to the
      // caller's colors, and the same thing as a dense index. Null and 0 when none was declared.
      // Unlike `classIndex` this survives a non-abelian group and does not have to kill the tile
      // stabilizer, which is what lets a repeating atlas draw Escher's four-color Circle Limit III
      // rather than one color per tile. See RegularTiling.colorPermutation.
      colorPermutation: this.tiling.colorPermutation ? this.tiling.colorPermutation(address) : null,
      colorIndex: this.tiling.colorIndex ? this.tiling.colorIndex(address) : 0,
      colorCount: this.tiling.colorCount || 1,
      relativeFrame: rel.clone(),
      centerRelativeDisk: rel.applyToDisk(0, 0, [0, 0]),
    };

    // A SYNCHRONOUS callback must be served in THIS frame.
    //
    // Going through a promise even for data already in hand costs a frame, and a tile that is not drawn
    // for one frame is a tile that visibly blinks. Tiles enter at the rim continuously while panning,
    // 1-3 per frame, so this is not a rare event -- it is the difference between a clean edge and a
    // shimmering one. Asynchronous providers cannot avoid the first frame; synchronous ones should not
    // pay for it.
    let result;
    try {
      result = this.tileData(tile);
    } catch (err) {
      this.failTile(keyString, tile, err);
      return this.cache.get(keyString) || null;
    }
    if (!result || typeof result.then !== "function") {
      try {
        return this.acceptTile(keyString, tile, result);
      } catch (err) {
        if (err instanceof TileSymmetryError) throw err;
        this.failTile(keyString, tile, err);
        return this.cache.get(keyString) || null;
      }
    }

    const p = result
      .then((data) => {
        this.pending.delete(keyString);
        this.acceptTile(keyString, tile, data);
        if (onReady) onReady();
      })
      .catch((err) => {
        this.pending.delete(keyString);
        // An asynchronous provider cannot be handed a synchronous throw, so a fatal lint surfaces here
        // as an unhandled rejection. That is loud, which is what "throw" asked for, and it is still
        // better than the alternative of one quietly blank tile.
        if (err instanceof TileSymmetryError) throw err;
        this.failTile(keyString, tile, err);
      });
    this.pending.set(keyString, p);
    return null;
  }

  // Compile a tile's data, cache it, and return the entry. Shared by the synchronous and asynchronous
  // paths so they cannot drift apart.
  acceptTile(keyString, tile, data) {
    if (data == null) {
      const empty = { drawables: [], withinTile: true };
      this.cache.set(keyString, empty);
      return empty;
    }
    // Run the symmetry lint once, on the first tile that carries artwork. Once, not per tile: the
    // answer is a property of the art, and the check is O(shapes^2).
    this.verifyTileSymmetry(data);
    let entry = this._compiled && typeof data === "object" ? this._compiled.get(data) : null;
    if (!entry) {
      entry = {
        drawables: compileDrawables(data, this.styleSheet),
        withinTile: !!(data && data.withinTile),
        // Optional level of detail: a cheap stand-in used when the tile is small on screen. Compiled
        // here so switching between them per frame costs nothing.
        lod: data.lod
          ? compileDrawables({ version: 1, coordinates: data.coordinates || "local", drawables: data.lod }, this.styleSheet)
          : null,
        lodPx: typeof data.lodPx === "number" ? data.lodPx : this.lodPx,
      };
      if (this._compiled && typeof data === "object") this._compiled.set(data, entry);
    }
    this.cache.set(keyString, entry);
    while (this.cache.size > this.cacheSize) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
    if (this.onTileLoad) this.onTileLoad(tile, entry.drawables);
    return entry;
  }

  failTile(keyString, tile, err) {
    // Cache the failure as empty so a broken tile is not retried every frame.
    this.cache.set(keyString, { drawables: [], withinTile: true });
    if (this.onTileError) this.onTileError(tile, err);
    // `tile.id` is the readable address, not `keyString`: cache keys are folded hashes for speed, and
    // "tile 9303484400662374000 failed" tells a caller nothing they can act on.
    else if (typeof console !== "undefined") console.error(`hyperbolic-map: tile ${tile.id} failed`, err);
  }

  // Build the render passes for the current view: one per visible tile, each with its own matrix and
  // clip path.
  // The tiles the last render used, each with the composed matrix that placed it. Kept so overlays and
  // diagnostics can work in the same frames the renderer used; a global frame is not available to them
  // and recomputing one is exactly what this design exists to avoid.
  //
  // Populated by passes(); `net` maps tile-local coordinates straight to screen-disk coordinates.
  lastTiles = [];

  passes(view, onReady) {
    // `view.matrix` is the CAMERA-RELATIVE view when an atlas is present; the viewport re-anchors
    // before every render so this stays O(1).
    const Vc = view.matrix;
    let tiles = this.anchor.neighborhood(Vc, view.effectiveRadius, this.maxTiles);
    // PAINTER'S ORDER, if the tiling defines one. Applied to a COPY and only after the neighborhood
    // has been chosen: the walk admits tiles nearest-first and `maxTiles` truncates the tail, so
    // reordering before that would change WHICH tiles are drawn, not just the order they are drawn in.
    // Matters only when art overlaps, i.e. when not clipping; see binaryDrawOrder.
    if (this.tiling.compareForDrawing) {
      tiles = tiles.slice().sort(this.tiling.compareForDrawing);
    }
    const out = [];
    this.lastTiles = [];
    for (const t of tiles) {
      // `addressKey` is the CACHE key: O(1) per tile. The human-readable string is built only on a
      // miss, inside request(), because far from the origin it is thousands of characters long and
      // producing 200 of them per frame cost ~20 ms.
      const keyString = this.tiling.addressKey(t.address);
      const entry = this.request(t.address, keyString, t.rel, onReady);
      if (!entry || entry.drawables.length === 0) continue;
      // The composition the whole rewrite is about: camera-relative view times camera-relative tile
      // frame. Both factors O(1); no world frame is ever formed.
      const net = Vc.mul(t.rel);

      // LEVEL OF DETAIL. Most tiles on screen are tiny -- measured on the Escher atlas, 122 of 200 had a
      // screen radius under 8 px -- and submitting a few hundred shapes for an 8 px tile is most of the
      // frame. Drawing 46,600 shapes cost 37 ms; the same frame with everything culled cost 6.4 ms, so
      // it really is the drawing, and per-drawable culling cannot help because the shapes are each about
      // a pixel rather than sub-pixel.
      let drawables = entry.drawables;
      if (entry.lod && entry.lod.length) {
        net.applyToDisk(0, 0, this._c0);
        net.applyToLocal(this.tileLocalRadius, 0, undefined, this._c1);
        const px = Math.hypot(this._c1[0] - this._c0[0], this._c1[1] - this._c0[1]) * view.radius;
        if (px < entry.lodPx) drawables = entry.lod;
      }
      // `id` is LAZY. Overlays and diagnostics want the readable string, but most frames never look at
      // it, and building 200 of them costs ~20 ms once the words are thousands of symbols long.
      const tiling = this.tiling;
      this.lastTiles.push({
        address: t.address,
        get id() { return tiling.addressToString(this.address); },
        net: net,
        rel: t.rel,
      });
      const wantClip =
        this.clip === CLIP_ALWAYS || (this.clip === CLIP_AUTO && !entry.withinTile);
      out.push({
        drawables: drawables,
        matrix: net,
        clip: wantClip ? this.clipPathFor(net) : null,
      });
    }
    return out;
  }

  // A clip region for one tile, expressed as a callback that traces the boundary into a canvas path.
  // Kept as a closure so the renderer does not need to know about tiling shapes.
  clipPathFor(net) {
    const b = this.tiling.boundaryLocal();
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

// Clip to a binary-tiling cell.
//
// The cell has FOUR sides and they are not alike: two are horocycles (y = const, circles internally
// tangent to the disk boundary) and two are GEODESICS (x = const, circles orthogonal to it -- audit
// claim 13). The first version sampled the horocyclic sides with twelve segments each, which is
// plenty, but joined the two geodesic sides with a single straight lineTo.
//
// That was wrong by a measurable amount. The chord cuts inside the true arc by a sagitta of 0.004889
// disk units, which is 1.5 px at zoom 1, 3.3 px at the dungeon's default zoom 2.2, and 9.1 px at
// zoom 6 -- a visible band along every vertical cell boundary, and exactly the "clipping in the wrong
// places" symptom. So both kinds of side are now sampled, each to a target pixel sagitta.
//
// Sampling in the tile's own half-plane and projecting each sample is what keeps this exact: every
// sample lies ON the true curve, so the only error is the polyline's departure from it between
// samples, which the step count controls.
function binaryCellClip(net, box) {
  const hw = box.halfWidth;
  const yLow = box.yLow;
  const yHigh = box.yHigh;

  return (ctx, view) => {
    const scale = view.radius;
    const sx = view.cx;
    const sy = view.cy;
    const buf = [0, 0];

    // Segment counts from the on-screen size of each side, so a zoomed-in cell is subdivided more.
    // The 0.25 px target matches the renderer's own arc tolerance.
    const spanPx = 2 * hw * scale;
    const risePx = (yHigh - yLow) * scale;
    const horoSteps = Math.max(8, Math.min(64, Math.ceil(Math.sqrt(spanPx / 0.25))));
    const geoSteps = Math.max(8, Math.min(64, Math.ceil(Math.sqrt(risePx / 0.25))));

    const emit = (hx, hy, first) => {
      const l = halfPlaneToLocal(hx, hy, buf);
      net.applyToLocal(l[0], l[1], undefined, buf);
      const X = buf[0] * scale + sx;
      const Y = -buf[1] * scale + sy;
      if (first) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    };

    ctx.beginPath();
    // Bottom horocycle, left to right.
    for (let i = 0; i <= horoSteps; i++) emit(-hw + (2 * hw * i) / horoSteps, yLow, i === 0);
    // Right geodesic, bottom to top. Sampled logarithmically in y: the half-plane metric is dy/y, so
    // equal hyperbolic steps are equal RATIOS, and uniform sampling in y would crowd the samples at
    // the top while leaving the bottom coarse.
    for (let i = 1; i <= geoSteps; i++) emit(hw, yLow * Math.pow(yHigh / yLow, i / geoSteps), false);
    // Top horocycle, right to left.
    for (let i = 1; i <= horoSteps; i++) emit(hw - (2 * hw * i) / horoSteps, yHigh, false);
    // Left geodesic, top to bottom.
    for (let i = 1; i < geoSteps; i++) emit(-hw, yHigh * Math.pow(yLow / yHigh, i / geoSteps), false);
    ctx.closePath();
    ctx.clip();
  };
}

// ===== src/viewport.js =====
// HyperbolicViewport -- the public widget.
//
// Everything outside the Poincare disk is the page's business, not the library's. The library draws
// the disk fill and the rim annulus; anything else (a world-turtle behind the disk, a star field,
// a compass rose on top) goes through `layers` or the `onBeforeDraw`/`onAfterDraw` hooks. There are
// deliberately no background-image or shell-image options: they would bake one example's art into
// the library, and a layer does the same job without the library knowing what the art is.

const DEFAULT_OPTIONS = {
  container: null,
  canvas: null,
  width: null,
  height: null,
  // width / height. Derives the height from the width, so the canvas can follow a fluid container;
  // refuses to coexist with `height`. With `autoResize` this is what makes the widget responsive.
  aspectRatio: null,
  autoResize: false,
  devicePixelRatio: "auto",

  data: null,
  dataProvider: null,
  atlas: null,
  // Start the camera on a given tile ADDRESS, with the initial view expressed in that tile's own
  // frame. Atlas mode only; the way to open far from the origin without forming a global coordinate.
  anchor: null,
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

  sagittaTolerancePx: 0.25,
  // Skip shapes whose projected diameter is below this many pixels. Zero at rest, so a still frame
  // is always drawn in full; `interactMinFeaturePx` applies only while a gesture is in flight, when
  // the rim fringe is moving and its exact density cannot be read anyway. Set both to 0 to disable.
  minFeaturePx: 0,
  interactMinFeaturePx: 0.5,
  // Drop a vertex that projects within this many pixels of the last one emitted. The hyperbolic
  // projection crushes unbounded area into the rim, so most shapes arrive far smaller than a pixel
  // and most of their vertices are redundant at screen resolution.
  decimateTolerancePx: 0.25,
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

// Exported for tests: option validation is pure, so it can be checked without a DOM.
function normalizeOptionsForTesting(userOptions) {
  return normalizeOptions(userOptions);
}

function normalizeOptions(userOptions) {
  const opts = Object.assign({}, DEFAULT_OPTIONS);
  const unknown = [];
  for (const key of Object.keys(userOptions || {})) {
    if (key in DEFAULT_OPTIONS) {
      opts[key] = userOptions[key];
    } else {
      unknown.push(key);
    }
  }
  // Typos in option names are a common and silent source of "why is this not working", so they are
  // an error rather than being ignored.
  if (unknown.length) {
    throw new Error(`hyperbolic-map: unknown option(s): ${unknown.join(", ")}`);
  }

  // An atlas and an ordinary data source cannot coexist. Refused here rather than drawn wrong.
  //
  // In atlas mode `view.matrix` is the view expressed in the CAMERA TILE's frame. An ordinary source's
  // coordinates are global, so drawing them with that matrix misplaces them as soon as the camera leaves
  // the origin tile -- measured, a point at the global origin lands 0.93 disk units away, most of the
  // way across the disk, after sixty small pans. Drawing them correctly would mean composing the
  // camera's global frame, which is exactly the ill-conditioned product this design exists to avoid.
  //
  // Nothing is lost: `layers` covers anything that belongs in screen space (a compass rose, the turtle
  // in the dungeon demo) and the atlas `tileData` callback covers anything that belongs to a tile.
  if (opts.atlas) {
    const d = opts.data;
    const hasOwnData =
      opts.dataProvider ||
      (Array.isArray(d) && d.length > 0) ||
      (d && Array.isArray(d.drawables) && d.drawables.length > 0);
    if (hasOwnData) {
      throw new Error(
        "hyperbolic-map: `atlas` cannot be combined with `data` or `dataProvider`. An atlas view is " +
          "anchored to a tile, so global coordinates have no fixed meaning in it. Put per-tile content " +
          "in the atlas `tileData` callback, and screen-space overlays in `layers`.",
      );
    }
  }
  return opts;
}

class HyperbolicViewport {
  constructor(userOptions) {
    const opts = normalizeOptions(userOptions);
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

    // Named sources, drawn in insertion order. See SourceSet: this is the VIEW-indexed half of the
    // data model, and it produces render passes through the same `passes(view)` interface the atlas
    // does.
    this.sources = new SourceSet({
      styleSheet: this.styleSheet,
      onInvalidate: () => this.invalidate(),
    });
    this.sources.add("default", opts.dataProvider ? opts.dataProvider : (opts.data || []));

    // The atlas, if configured, contributes one render pass per visible tile. It is the TILE-indexed
    // half of the data model; see src/data/source.js for why both exist.
    this.atlas = null;
    if (opts.atlas) {
      this.atlas = new Atlas(
        Object.assign({ styleSheet: this.styleSheet }, opts.atlas),
      );
      // `anchor` starts the camera on a given tile, with the initial view expressed in THAT tile's
      // frame. This is how a demo opens somewhere far from the origin without ever forming a global
      // coordinate for it -- contrast `center`, which is a global local-coordinate pair and therefore
      // only usable near the origin.
      if (opts.anchor !== undefined && opts.anchor !== null) {
        this.atlas.anchor.address = opts.anchor;
      }
    }

    // Everything that can contribute drawables to a frame, in draw order. Both implement
    // `passes(view, onReady)`, so render() does not branch on which mode this viewport is in.
    this.passProducers = this.atlas ? [this.sources, this.atlas] : [this.sources];
    // Bound once: passed to every producer each frame, so no closure is allocated per frame.
    this._onPassReady = () => this.invalidate();

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
          // Re-anchor on every view CHANGE, not only when a frame is drawn.
          //
          // "V_c stays O(1)" has to be an invariant of the view state, not something a render happens
          // to restore. Renders are rAF-coalesced and rAF can be throttled to about 1 Hz in a
          // backgrounded tab -- and then a drag accumulates dozens of tiles of motion with no
          // re-anchoring at all. Measured with rendering throttled: max|V| reached 8.9e+74 and the disk
          // went empty, which is exactly the failure this whole design removes, reintroduced through
          // the scheduler. Re-anchoring is a handful of flops, so doing it per input event is free.
          this.reanchorCamera();
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

  // Keep the camera anchored to a tile near the view center.
  //
  // This is what bounds the view matrix. `reanchor` returns a RIGHT factor, applied to BOTH the
  // committed and the live matrix: `updatePan` builds the live matrix by left-multiplying the
  // committed one, so a common right factor is exactly consistent and a gesture in flight keeps its
  // grabbed point pinned. Without this the matrix grows like cosh(d/2) and by 500 tiles out would need
  // entries of order 1e165.
  reanchorCamera() {
    if (!this.atlas) return;
    const { steps, shift } = this.atlas.anchor.reanchor(this.view.liveMatrix);
    if (steps === 0) return;
    // Not just the matrices: a pinch's grabbed points and the compass target live in the frame's domain
    // and have to be pulled back through the shift too. See ViewState.rebase.
    this.view.rebase(shift);
  }

  render() {
    if (this.destroyed) return;
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    this.reanchorCamera();
    const view = this.surface.buildView(this.view, this.options);
    // One loop over pass producers. A pass is {drawables, matrix, clip?}: the sources contribute one
    // per named source, the atlas one per visible tile, and the renderer below cannot tell which is
    // which. That join is what keeps single-patch and atlas mode from being two implementations.
    const passes = [];
    const onReady = this._onPassReady;
    for (const producer of this.passProducers) {
      const got = producer.passes(view, onReady);
      for (let i = 0; i < got.length; i++) passes.push(got[i]);
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
      sagittaTolerancePx: this.options.sagittaTolerancePx,
      decimateTolerancePx: this.options.decimateTolerancePx,
      // Quality snaps back the moment the gesture ends, so what the user studies is always the full
      // scene; only the frames they are actively dragging through are simplified.
      minFeaturePx: this.view.gesture
        ? this.options.interactMinFeaturePx
        : this.options.minFeaturePx,
      minTextPx: this.options.minTextPx,
    });
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    this.stats.frameMs = t1 - t0;
    // How far the view center has traveled from the data origin, in hyperbolic units. Exposed
    // because in SINGLE-PATCH mode it is the one number that predicts precision trouble: a float64
    // SU(1,1) matrix has entries of order cosh(d/2), so by d ~ 37 the entries reach 1e8, |a|^2 reaches
    // 1e16, and one ULP of that exceeds the spacing between adjacent tiles.
    //
    // In ATLAS mode that ceiling does not apply, because no global quantity is ever formed: the
    // distance traveled is carried by the tile ADDRESS and the matrix stays camera-relative. See
    // docs/MATH.md section 6.
    if (this.atlas) {
      // In atlas mode the view matrix is camera-relative, so its "distance" is a local quantity of
      // order the visible radius -- not the distance traveled, which is now unbounded and is carried
      // by the ADDRESS instead. `maxViewEntry` is the number that demonstrates the design: it must
      // stay O(1) however far the camera goes.
      this.stats.anchorAddress = this.atlas.tiling.addressToString(this.atlas.anchor.address);
      this.stats.maxViewEntry = Anchor.maxEntry(this.view.liveMatrix);
      this.stats.reanchorCount = this.atlas.anchor.reanchorCount;
      this.stats.viewDistance = this.view.liveMatrix.distanceMoved();
    } else {
      this.stats.viewDistance = this.view.liveMatrix.distanceMoved();
    }
    if (this.options.onFrame) this.options.onFrame(this.stats);
  }

  // ---- mode guards ----
  //
  // Three rules, in one place, because they are one idea: some methods are meaningful in single-patch
  // mode, some only in atlas mode, and the global-coordinate ones stop being meaningful part-way
  // through an atlas session. A fourth guard -- `atlas` cannot be combined with `data` -- is in
  // normalizeOptions(), because it can be decided before anything is built.
  //
  // Each one refuses rather than returning a number that is quietly wrong, and each names the method
  // to use instead.

  // Atlas-only methods.
  requireAtlas(method, alternative) {
    if (!this.atlas) {
      throw new Error(`hyperbolic-map: ${method}() requires an atlas; use ${alternative} instead`);
    }
  }

  // Single-patch-only methods. A source's coordinates are global, and in atlas mode the view matrix is
  // camera-relative, so there is no correct way to place them.
  refuseInAtlasMode(method, why) {
    if (this.atlas) {
      throw new Error(
        `hyperbolic-map: ${method} is not available in atlas mode -- ${why}. Use the atlas ` +
          "`tileData` callback for tile content, or `layers` for screen-space overlays.",
      );
    }
  }

  // Global-coordinate accessors are only meaningful while the camera is anchored to the origin tile.
  // Past that there is no numerically representable global frame, which is the whole reason the atlas
  // is anchored -- so refuse rather than mislead.
  assertGlobalCoordinatesUsable(fn) {
    if (this.atlas && !this.atlas.anchor.atOrigin()) {
      const at = this.atlas.tiling.addressToString(this.atlas.anchor.address);
      throw new Error(
        `hyperbolic-map: ${fn}() is defined in GLOBAL coordinates, but the camera is anchored to tile ` +
          `${at}, where a global frame has entries far too large to represent. Its meaning is ` +
          `unchanged and it still works while anchored to the origin tile. Use getCamera(), ` +
          `setCamera() or panToTile() instead.`,
      );
    }
  }

  // ---- public API ----

  // Force every async source to re-request for the current view, bypassing the throttle and the
  // significance gate.
  refreshSources() {
    if (this.destroyed) return;
    this.sources.refresh(this.surface.buildView(this.view, this.options));
    this.invalidate();
  }

  getView() {
    this.assertGlobalCoordinatesUsable("getView");
    return {
      center: this.view.liveMatrix.centerLocal([0, 0]),
      zoom: this.view.liveZoom,
      rotation: this.view.liveMatrix.screenRotation(),
      bearing: this.view.north(),
      interacting: !!this.view.gesture,
    };
  }

  // ---- the anchored camera API ----
  //
  // These are the atlas-aware accessors. They are NEW NAMES on purpose: `getMatrix`/`setMatrix`/
  // `panTo`/`getView` keep exactly the meaning they always had (global coordinates), so no existing
  // caller silently changes behavior. Instead those four throw once the camera has left the origin
  // tile, where a global coordinate can no longer be represented -- a loud failure rather than a
  // plausible wrong number.

  // The complete view: which tile the camera is anchored to, plus the view within that tile's frame.
  getCamera() {
    return {
      address: this.atlas ? this.atlas.anchor.address : null,
      matrix: this.view.liveMatrix.clone(),
      zoom: this.view.liveZoom,
      // Screen quantities, so they mean the same thing in either mode -- and they are the only parts of
      // getView() that survive in atlas mode, where a global center does not exist.
      rotation: this.view.liveMatrix.screenRotation(),
      bearing: this.view.north(),
      interacting: !!this.view.gesture,
    };
  }

  // Restore a view captured by getCamera(). Exact round trip.
  setCamera(camera) {
    if (this.atlas && camera.address !== undefined && camera.address !== null) {
      this.atlas.anchor.address = camera.address;
    }
    this.view.matrix = camera.matrix.clone().normalize();
    this.view.liveMatrix = this.view.matrix.clone();
    if (camera.zoom !== undefined) this.view.setZoom(camera.zoom);
    this.view.gesture = null;
    this.reanchorCamera();
    this.invalidate();
  }

  // Put a given TILE-LOCAL point of a given tile at the center of the view. The atlas-mode equivalent
  // of panTo, and the only form that stays meaningful arbitrarily far out.
  panToTile(address, local = [0, 0]) {
    this.requireAtlas("panToTile", "panTo()");
    this.atlas.anchor.address = address;
    this.view.matrix = this.panMatrix(local[0], local[1]);
    this.view.liveMatrix = this.view.matrix.clone();
    this.view.gesture = null;
    this.invalidate();
  }

  // The view isometry that puts (x, y) at the center WITHOUT turning the map.
  //
  // Panning must not rotate. Building the pure translation alone would silently reset the screen
  // rotation to zero, which is invisible on a page that never rotates and jarring on one that does:
  // dungeon-man.html opens at rotation pi (its art is drawn upside down in the cell frame), so a pan
  // that reset the angle would flip the whole dungeon over. In atlas mode the rotation is expressed in the
  // anchor tile's frame, so carrying the same angle across to the new anchor is exactly right -- the
  // camera keeps its orientation relative to the tiling, and tile art stays the way up it was.
  panMatrix(x, y) {
    // translationToLocal(...).inverse() has a real positive `a`, hence screenRotation exactly 0, so
    // left-multiplying by Rot(theta) sets the total screen rotation to theta.
    const theta = this.view.matrix.screenRotation();
    const moved = Isom.translationToLocal(x, y).inverse();
    return theta === 0 ? moved : Isom.rotation(theta).mul(moved).normalize();
  }

  getMatrix() {
    this.assertGlobalCoordinatesUsable("getMatrix");
    return this.view.liveMatrix.clone();
  }

  setMatrix(isom) {
    this.assertGlobalCoordinatesUsable("setMatrix");
    this.view.matrix = isom.clone().normalize();
    this.view.liveMatrix = this.view.matrix.clone();
    this.invalidate();
  }

  setZoom(z) {
    this.view.setZoom(z);
    this.reanchorCamera();
    this.invalidate();
  }

  setRotation(theta) {
    const current = this.view.matrix.screenRotation();
    this.view.matrix = Isom.rotation(theta - current).mul(this.view.matrix).normalize();
    this.view.liveMatrix = this.view.matrix.clone();
    this.reanchorCamera();
    this.invalidate();
  }

  // Put the given local point at the center of the view. GLOBAL local coordinates -- see
  // assertGlobalCoordinatesUsable; panToTile() is the atlas-mode form.
  panTo(x, y) {
    this.assertGlobalCoordinatesUsable("panTo");
    this.view.matrix = this.panMatrix(x, y);
    this.view.liveMatrix = this.view.matrix.clone();
    this.invalidate();
  }

  setData(data, name = "default") {
    this.refuseInAtlasMode("setData", "a source's coordinates are global, and an atlas view is anchored to a tile");
    this.sources.setData(name, data);
    this.invalidate();
  }

  addSource(name, data, opts = {}) {
    this.refuseInAtlasMode(
      `addSource(${JSON.stringify(name)})`,
      "a source's coordinates are global, and an atlas view is anchored to a tile",
    );
    const source = this.sources.add(name, data, opts);
    this.invalidate();
    return source;
  }

  removeSource(name) {
    this.sources.remove(name);
    this.invalidate();
  }

  // Apply an extra isometry to one source without recompiling its drawables. O(1) per change.
  setSourceTransform(name, isom) {
    this.refuseInAtlasMode("setSourceTransform", "there are no global sources in an atlas to transform");
    this.sources.setTransform(name, isom);
    this.invalidate();
  }

  // Local coordinates <-> screen pixels, both in whatever frame the VIEW is expressed in. In
  // single-patch mode that is the global frame; in atlas mode it is the current anchor tile's frame, so
  // pair them with `getCamera().address`. For "which tile is under this pixel", use tileAtScreen.
  toScreen(x, y) {
    return this.surface.buildView(this.view, this.options).toScreen(x, y);
  }

  fromScreen(sx, sy) {
    return this.surface.buildView(this.view, this.options).fromScreen(sx, sy);
  }

  // Which tile is under this screen pixel, and where in that tile's own coordinates? Atlas mode only.
  //
  // The natural picking question, and the one an application actually asks. Answered entirely in
  // camera-relative terms, so it is as accurate 200,000 tiles from the origin as at the origin --
  // whereas converting a pixel to a global coordinate and locating from there could not work at all.
  // Returns null if the pixel is outside the disk.
  tileAtScreen(sx, sy) {
    this.requireAtlas("tileAtScreen", "fromScreen()");
    const view = this.surface.buildView(this.view, this.options);
    const local = view.fromScreen(sx, sy);
    if (!local) return null;
    const tiling = this.atlas.tiling;

    // Answer with the tile the RENDERER just used, whenever the point is on one of them.
    //
    // Resolving against the drawn set rather than descending independently. Both name the same tile --
    // addresses are canonical, so there is only one name to give -- but this way the answer comes with
    // the very `local` coordinates and the very frame the renderer used, so a caller correlating a pick
    // with `atlas.lastTiles` gets an exact match, and a point within rounding of a boundary is resolved
    // by the exact containment test rather than by the descent's oscillation tolerance.
    for (const t of this.atlas.lastTiles) {
      const q = t.net.inverse().applyToDisk(
        (sx - view.cx) / view.radius,
        -(sy - view.cy) / view.radius,
        [0, 0],
      );
      const k = 1 / Math.sqrt(Math.max(1e-300, 1 - q[0] * q[0] - q[1] * q[1]));
      const lx = q[0] * k;
      const ly = q[1] * k;
      if (tiling.containsLocal(lx, ly)) {
        return { address: t.address, id: t.id, local: [lx, ly] };
      }
    }

    // Outside the drawn set -- beyond the tile budget, or before the first render. Fall back to the
    // descent, which is still geometrically correct.
    const found = this.atlas.anchor.locateFromCameraLocal(local[0], local[1]);
    return { address: found.address, id: tiling.addressToString(found.address), local: found.local };
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
    this.sources.destroy();
    for (const layer of this.layers) if (layer.detach) layer.detach();
    this.surface.destroy();
  }
}

// ===== src/data/atlas/exactring.js =====
// Exact arithmetic in Z[mu], mu = 2*cos(pi/N).
//
// WHY EXACT. A {p,q} tile's identity is a group element, and comparing group elements through their
// float matrices is what breaks at hyperbolic distance ~37: the entries grow like cosh(d/2), one ULP
// of |a|^2 exceeds the spacing between adjacent tile centers, and the walk starts to disagree with
// itself about which tiles it has already seen (measured; see notes/open-questions.md). Integers do
// not have a distance ceiling, so identity is decided here and only rendering is left to floats.
//
// WHY THIS RING. Every entry of the Coxeter Gram matrix is one of {2, 0, -2cos(pi/p), -2cos(pi/q)},
// and both cosines live in Z[mu] with N = lcm(p, q). The reflection matrices then have entries in
// Z[mu] with NO denominators and no square roots, so products stay integral forever. (SU(1,1) would
// need sinh(psi) = sqrt(cosh^2 - 1), a much bigger ring, and would carry the +-M double cover.)
//
// Coefficient bit-length grows linearly in distance, about 1.44 bits per unit, so an id far out is
// large but never unbounded in the way a float is imprecise.

// Multiplications performed, for the steady-state assertion that a rendered frame does no exact work
// at all. Exact arithmetic is supposed to happen once per newly discovered tile and never per frame,
// and that is a claim worth being able to measure rather than believe.
let ringMulCount = 0;

function exactMulCount() {
  return ringMulCount;
}

function resetExactMulCount() {
  ringMulCount = 0;
}

// ---- integer polynomial helpers, all over BigInt coefficient arrays, low degree first ----

function polyTrim(a) {
  let n = a.length;
  while (n > 1 && a[n - 1] === 0n) n--;
  return n === a.length ? a : a.slice(0, n);
}

function polyMul(a, b) {
  const out = new Array(a.length + b.length - 1).fill(0n);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0n) continue;
    for (let j = 0; j < b.length; j++) {
      if (b[j] !== 0n) out[i + j] += a[i] * b[j];
    }
  }
  return polyTrim(out);
}

// Exact division a / b over Z. Every use here divides exactly (cyclotomic recursion), so a remainder
// is a bug rather than a case to handle.
function polyDivExact(a, b) {
  const q = new Array(Math.max(1, a.length - b.length + 1)).fill(0n);
  const r = a.slice();
  const lead = b[b.length - 1];
  for (let i = r.length - b.length; i >= 0; i--) {
    const c = r[i + b.length - 1] / lead;
    if (c * lead !== r[i + b.length - 1]) throw new Error("hyperbolic-map: inexact polynomial division");
    q[i] = c;
    for (let j = 0; j < b.length; j++) r[i + j] -= c * b[j];
  }
  for (const v of r) {
    if (v !== 0n) throw new Error("hyperbolic-map: polynomial division left a remainder");
  }
  return polyTrim(q);
}

// Phi_n(z), by Phi_n = (z^n - 1) / prod_{d | n, d < n} Phi_d.
function cyclotomicCoeffs(n, memo) {
  const cache = memo || new Map();
  if (cache.has(n)) return cache.get(n);
  let num = new Array(n + 1).fill(0n);
  num[0] = -1n;
  num[n] = 1n;
  for (let d = 1; d < n; d++) {
    if (n % d === 0) num = polyDivExact(num, cyclotomicCoeffs(d, cache));
  }
  cache.set(n, num);
  return num;
}

// Dickson polynomial D_k, defined by D_k(2*cos t) = 2*cos(k t). D_0 = 2, D_1 = x,
// D_k = x*D_{k-1} - D_{k-2}. This is how one cosine is expressed in terms of another.
function dicksonCoeffs(k) {
  if (k === 0) return [2n];
  let prev = [2n];
  let cur = [0n, 1n];
  for (let i = 2; i <= k; i++) {
    const next = polyMul([0n, 1n], cur);
    for (let j = 0; j < prev.length; j++) next[j] -= prev[j];
    prev = cur;
    cur = polyTrim(next);
  }
  return cur;
}

// The minimal polynomial of mu = 2*cos(pi/N): monic, degree phi(2N)/2, integer coefficients.
//
// Phi_{2N} is palindromic for 2N >= 6 (always, since p, q >= 3), so writing it as
// sum_j c_j z^j with degree 2m and using z^j + z^-j = D_j(z + 1/z) collapses it to
// C(x) = c_m + sum_{j=1..m} c_{m+j} D_j(x).
function minPolyFor2Cos(N) {
  if (!(Number.isInteger(N) && N >= 3)) {
    throw new Error(`hyperbolic-map: minPolyFor2Cos needs an integer N >= 3, got ${N}`);
  }
  const phi = cyclotomicCoeffs(2 * N);
  const deg = phi.length - 1;
  if (deg % 2 !== 0) throw new Error(`hyperbolic-map: Phi_${2 * N} has odd degree ${deg}`);
  const m = deg / 2;
  const out = new Array(m + 1).fill(0n);
  out[0] = phi[m];
  for (let j = 1; j <= m; j++) {
    const d = dicksonCoeffs(j);
    for (let i = 0; i < d.length; i++) out[i] += phi[m + j] * d[i];
  }
  const trimmed = polyTrim(out);
  if (trimmed[trimmed.length - 1] !== 1n) {
    throw new Error(`hyperbolic-map: minimal polynomial for 2cos(pi/${N}) is not monic`);
  }
  return trimmed;
}

// The largest magnitude a Number coefficient is allowed to hold. Every intermediate below is an
// integer, and every integer of magnitude <= 2^53 is exactly representable as a double, so an
// operation is exact as long as its result cannot exceed that. Holding stored values to 2^52 leaves
// one doubling of headroom, which is what makes each individual check below sufficient.
const SMALL_LIMIT = 2 ** 52;

// An element is a plain array of `deg` integers, ALWAYS fully reduced. There is no division anywhere
// in this ring -- the minimal polynomial is monic, so reduction is repeated subtraction of a shifted
// multiple. Needing a denominator would mean a formula is wrong.
//
// TWO REPRESENTATIONS, ONE VALUE. The coefficients are either all `number` or all `bigint`, never
// mixed within one element. Doubles are 2.5-3x faster and coefficients start tiny, but they grow
// about 2 bits per tile step and BigInt is the only thing with no ceiling -- so an element is born
// small and is PROMOTED, permanently, the first time an operation would leave the exactly-integral
// range. It is never demoted: which representation an element carries is a function of its history,
// not of its value, and two elements holding the same value may differ in it.
//
// That is safe only because everything a caller can observe is representation-independent, and each
// of those is load-bearing:
//
//   * `serialize` -- String(5) and String(5n) are both "5", and a Number coefficient can never reach
//     1e21 where exponent notation would start. This one decides the text of every public tile id.
//   * `cmp` -- JavaScript's `<` between a Number and a BigInt is defined to compare the mathematical
//     values exactly, with no coercion. This one decides which member of a coset is canonical, and
//     therefore which id every tile gets.
//   * `equals` / `isZero` -- both `0` and `0n` are falsy, and mixed pairs fall back to `<`.
//   * `toNumber` -- Number() of either.
//
// Methods accept elements in either representation from outside, including hand-built BigInt arrays,
// and an operation on a BigInt input returns a BigInt result.
class ExactRing {
  constructor(N) {
    this.N = N;
    this.poly = minPolyFor2Cos(N);
    this.deg = this.poly.length - 1;
    this.muFloat = 2 * Math.cos(Math.PI / N);
    // The Number mirror of the minimal polynomial, and the bound the small path checks against.
    // `polyMaxAbs` is the factor by which one reduction step can inflate a coefficient, so requiring
    // |f| * polyMaxAbs <= SMALL_LIMIT before a step is what keeps that step's arithmetic exact.
    this.polyNum = this.poly.map(Number);
    this.polyMaxAbs = this.polyNum.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    // If the polynomial itself did not fit, there is no small path at all. Never true for any {p,q}
    // this library builds, but the code must not depend on that.
    this.smallOk = this.polyNum.every(Number.isSafeInteger) && this.polyMaxAbs > 0;
    // Scratch for the small convolution, reused. Only ever read back within one `mulSmall` call.
    this.scratch = new Array(2 * this.deg - 1);
  }

  zero() {
    return new Array(this.deg).fill(this.smallOk ? 0 : 0n);
  }

  one() {
    const v = this.zero();
    v[0] = this.smallOk ? 1 : 1n;
    return v;
  }

  fromInt(k) {
    const v = this.zero();
    v[0] = this.smallOk && Number.isSafeInteger(k) && Math.abs(k) <= SMALL_LIMIT ? Number(k) : BigInt(k);
    return v;
  }

  // mu itself. For deg 1 the ring is just Z and mu is the rational root: x + poly[0] = 0.
  mu() {
    if (this.deg === 1) return this.smallOk ? [-this.polyNum[0]] : [-this.poly[0]];
    const v = this.zero();
    v[1] = this.smallOk ? 1 : 1n;
    return v;
  }

  // Reduce a raw convolution (length up to 2*deg-1) modulo the minimal polynomial. Big path only:
  // the small path reduces in place inside `mulSmall`, and this stays BigInt-in/BigInt-out so that
  // a caller holding a hand-built BigInt array gets one back.
  reduce(raw) {
    const c = raw.map(toBig);
    const poly = this.poly;
    for (let i = c.length - 1; i >= this.deg; i--) {
      const f = c[i];
      if (f === 0n) continue;
      c[i] = 0n;
      for (let j = 0; j < this.deg; j++) c[i - this.deg + j] -= f * poly[j];
    }
    const out = new Array(this.deg);
    for (let i = 0; i < this.deg; i++) out[i] = c[i] === undefined ? 0n : c[i] + 0n;
    return out;
  }

  // Is this element in the small representation? Only the first coefficient needs asking: an element
  // is all one type or all the other, and `deg >= 1` always.
  isSmall(a) {
    return typeof a[0] === "number";
  }

  add(a, b) {
    const deg = this.deg;
    const out = new Array(deg);
    if (this.isSmall(a) && this.isSmall(b)) {
      for (let i = 0; i < deg; i++) {
        // Both operands are integers of magnitude <= SMALL_LIMIT, so the true sum is <= 2^53 and the
        // double holds it exactly. Only the RESULT can be out of range, and then we start over.
        const v = a[i] + b[i];
        if (v > SMALL_LIMIT || v < -SMALL_LIMIT) return this.addBig(a, b);
        out[i] = v;
      }
      return out;
    }
    return this.addBig(a, b);
  }

  sub(a, b) {
    const deg = this.deg;
    const out = new Array(deg);
    if (this.isSmall(a) && this.isSmall(b)) {
      for (let i = 0; i < deg; i++) {
        const v = a[i] - b[i];
        if (v > SMALL_LIMIT || v < -SMALL_LIMIT) return this.subBig(a, b);
        out[i] = v;
      }
      return out;
    }
    return this.subBig(a, b);
  }

  addBig(a, b) {
    const out = new Array(this.deg);
    for (let i = 0; i < this.deg; i++) out[i] = toBig(a[i]) + toBig(b[i]);
    return out;
  }

  subBig(a, b) {
    const out = new Array(this.deg);
    for (let i = 0; i < this.deg; i++) out[i] = toBig(a[i]) - toBig(b[i]);
    return out;
  }

  neg(a) {
    const out = new Array(this.deg);
    // `0 - x` rather than `-x`, so a zero coefficient comes back as +0 rather than -0. Both serialize
    // as "0" and compare equal, but there is no reason to carry the oddity around.
    if (this.isSmall(a)) {
      for (let i = 0; i < this.deg; i++) out[i] = 0 - a[i];
    } else {
      for (let i = 0; i < this.deg; i++) out[i] = 0n - a[i];
    }
    return out;
  }

  mul(a, b) {
    ringMulCount++;
    if (this.isSmall(a) && this.isSmall(b)) {
      const small = this.mulSmall(a, b);
      if (small !== null) return small;
    }
    return this.mulBig(a, b);
  }

  // The small path. Returns null -- having written nothing anyone can see -- if any step would have
  // left the exactly-integral range, and `mul` then redoes the whole thing in BigInt.
  //
  // Every bail-out below tests a value that is still EXACT. That is the invariant the whole scheme
  // rests on: a check that fired after the arithmetic had already rounded would be too late, so each
  // one is placed where the next operation, not the last, is the one that could overflow.
  mulSmall(a, b) {
    const deg = this.deg;
    const raw = this.scratch;
    // One bound for the whole convolution: every product is at most amax*bmax and every raw
    // coefficient is a sum of at most `deg` of them. `Math.max(|a|) * Math.max(|b|) * deg` is itself
    // computed in doubles, but a product that large is either exact or comfortably over the line, so
    // the comparison decides correctly either way.
    let amax = 0;
    let bmax = 0;
    for (let i = 0; i < deg; i++) {
      const x = a[i] < 0 ? -a[i] : a[i];
      if (x > amax) amax = x;
      const y = b[i] < 0 ? -b[i] : b[i];
      if (y > bmax) bmax = y;
    }
    if (amax * bmax * deg > SMALL_LIMIT) return null;

    const n = 2 * deg - 1;
    for (let i = 0; i < n; i++) raw[i] = 0;
    for (let i = 0; i < deg; i++) {
      const ai = a[i];
      if (ai === 0) continue;
      for (let j = 0; j < deg; j++) {
        const bj = b[j];
        if (bj !== 0) raw[i + j] += ai * bj;
      }
    }

    const poly = this.polyNum;
    const pmax = this.polyMaxAbs;
    for (let i = n - 1; i >= deg; i--) {
      const f = raw[i];
      if (f === 0) continue;
      // Each `f * poly[j]` must itself be exact before it can be subtracted.
      if ((f < 0 ? -f : f) * pmax > SMALL_LIMIT) return null;
      raw[i] = 0;
      for (let j = 0; j < deg; j++) {
        const pj = poly[j];
        if (pj === 0) continue;
        // |raw[k]| <= SMALL_LIMIT and |f*pj| <= SMALL_LIMIT, so the difference is at most 2^53 and is
        // exact. Refusing to store it above the limit is what keeps the invariant for the next step.
        const v = raw[i - deg + j] - f * pj;
        if (v > SMALL_LIMIT || v < -SMALL_LIMIT) return null;
        raw[i - deg + j] = v;
      }
    }

    const out = new Array(deg);
    for (let i = 0; i < deg; i++) out[i] = raw[i];
    return out;
  }

  mulBig(a, b) {
    const deg = this.deg;
    const raw = new Array(2 * deg - 1).fill(0n);
    for (let i = 0; i < deg; i++) {
      const ai = toBig(a[i]);
      if (ai === 0n) continue;
      for (let j = 0; j < deg; j++) {
        const bj = toBig(b[j]);
        if (bj !== 0n) raw[i + j] += ai * bj;
      }
    }
    return this.reduce(raw);
  }

  isZero(a) {
    // Both `0` and `0n` are falsy, so this needs no type test.
    for (let i = 0; i < this.deg; i++) {
      if (a[i]) return false;
    }
    return true;
  }

  equals(a, b) {
    const deg = this.deg;
    if (typeof a[0] === typeof b[0]) {
      for (let i = 0; i < deg; i++) {
        if (a[i] !== b[i]) return false;
      }
      return true;
    }
    // Mixed representations. `<` between a Number and a BigInt compares mathematical values exactly,
    // so "neither is less" is equality without coercing either side.
    for (let i = 0; i < deg; i++) {
      if (a[i] < b[i] || b[i] < a[i]) return false;
    }
    return true;
  }

  // A TOTAL ORDER on ring elements. This is not a mathematical order (the ring is not ordered in any
  // way that respects the arithmetic) -- it is an arbitrary but FIXED tie-break, and it is what
  // decides which member of a tile's coset becomes the canonical one. Changing it silently renames
  // every id in every user cache, so it is fixed forever: lowest coefficient first.
  //
  // Written with `<` in both directions rather than `!==` then `<`, because the two operands may be
  // in different representations and `5 !== 5n` while `5 < 5n` and `5n < 5` are both false. The
  // language defines Number-to-BigInt relational comparison as exact, so this orders VALUES and the
  // canonical choice cannot depend on which representation an element happens to carry.
  cmp(a, b) {
    for (let i = 0; i < this.deg; i++) {
      if (a[i] < b[i]) return -1;
      if (b[i] < a[i]) return 1;
    }
    return 0;
  }

  // D_k(mu) = 2*cos(k*pi/N), as a ring element.
  dicksonOfMu(k) {
    if (k === 0) return this.fromInt(2);
    const mu = this.mu();
    let prev = this.fromInt(2);
    let cur = mu;
    for (let i = 2; i <= k; i++) {
      const next = this.sub(this.mul(mu, cur), prev);
      prev = cur;
      cur = next;
    }
    return cur;
  }

  // lambda_n = 2*cos(pi/n), as a ring element.
  //
  // TRAP, and the reason this is a method with an assert rather than an inline D_{N/n}(mu): the
  // Dickson identity needs n to DIVIDE N. The n = 3 shortcut (take N = p when q = 3, halving the
  // ring degree) breaks that -- with N = 8 and n = 3, N/n truncates to 2 and D_2(mu) is sqrt(2),
  // not 1. That silently produced a wrong Gram matrix and the Coxeter relations failed for {8,3},
  // {7,3} and {3,7}. 2*cos(pi/3) = 1 is rational and lives in every ring, so it is returned as the constant.
  lambdaFor(n) {
    if (this.N % n === 0) return this.dicksonOfMu(this.N / n);
    if (n === 3) return this.fromInt(1);
    throw new Error(
      `hyperbolic-map: 2cos(pi/${n}) is not expressible in Z[2cos(pi/${this.N})]: ${n} does not divide ${this.N}`,
    );
  }

  // Float value, for tests and for the calibration intertwiner ONLY. Never for identity.
  toNumber(a) {
    let s = 0;
    for (let i = this.deg - 1; i >= 0; i--) s = s * this.muFloat + Number(a[i]);
    return s;
  }

  // The serialized form of one element. Fixed, unambiguous, and part of the public id.
  //
  // Must not depend on the representation: `(5).toString()` and `(5n).toString()` are both "5", and a
  // Number coefficient is an integer bounded by 2^52, far below the 1e21 where `toString` would
  // switch to exponent notation. `|| 0` collapses `-0` and `-0n` onto "0".
  serialize(a) {
    let s = "";
    for (let i = 0; i < this.deg; i++) {
      if (i) s += ",";
      s += (a[i] || 0).toString();
    }
    return s;
  }
}

// A coefficient as a BigInt, whichever representation it arrived in.
function toBig(x) {
  return typeof x === "bigint" ? x : BigInt(x);
}

// ===== src/data/atlas/exactcoxeter.js =====
// The Coxeter group [p,q] in its geometric (reflection) representation, exactly, over Z[mu].
//
// WHY THIS REPRESENTATION. Tits' theorem (Humphreys, Reflection Groups and Coxeter Groups, 5.3-5.4)
// says the geometric representation is FAITHFUL: two words give the same matrix if and only if they
// are the same group element. That turns matrix equality into a DEFINITION of tile identity rather
// than a heuristic with a tolerance -- which is the whole point, since the float version of the same
// question breaks down at hyperbolic distance ~37.
//
// It also has no double cover. SU(1,1) represents each isometry as +-M and every comparison in the
// float code has to be "up to sign"; here each isometry is one matrix.
//
// GEOMETRY, matching the library's conventions exactly (RegularTiling puts vertices at angles
// pi/p + 2*pi*k/p, so edge MIDPOINTS land on 2*pi*k/p and edge 0's midpoint is on the +x axis):
//
//     mirror a = the x-axis                  (through the center O and the edge-0 midpoint M)
//     mirror b = the line at angle pi/p      (through O and vertex V0)
//     mirror c = the edge-0 geodesic         (through M and V0)
//
// with m(a,b) = p, m(b,c) = q, m(a,c) = 2.
//
// Composition is matrix product = apply the RIGHTMOST first, which is the same convention as
// Isom.mul. That is asserted rather than assumed; see the calibration in exactcalib.js.

// The DOUBLED Gram matrix, G = 2B. Doubling is what keeps everything integral: the entries are
// 2 and -2cos(pi/n), never a half.
function gramMatrix(R, lambdaP, lambdaQ) {
  const Z = R.zero();
  const two = R.fromInt(2);
  return [
    [two, R.neg(lambdaP), Z],
    [R.neg(lambdaP), two, R.neg(lambdaQ)],
    [Z, R.neg(lambdaQ), two],
  ];
}

// S_i = I - e_i . (row i of G), acting on column coordinate vectors.
function reflectionMatrix(R, G, i) {
  const rows = [];
  for (let r = 0; r < 3; r++) {
    const row = [];
    for (let c = 0; c < 3; c++) {
      const delta = r === c ? R.one() : R.zero();
      row.push(r === i ? R.sub(delta, G[i][c]) : delta);
    }
    rows.push(row);
  }
  return rows;
}

function exactIdentity(R) {
  return [
    [R.one(), R.zero(), R.zero()],
    [R.zero(), R.one(), R.zero()],
    [R.zero(), R.zero(), R.one()],
  ];
}

function exactMatMul(R, A, B) {
  const out = [];
  for (let i = 0; i < 3; i++) {
    const row = [];
    for (let j = 0; j < 3; j++) {
      row.push(R.add(R.add(R.mul(A[i][0], B[0][j]), R.mul(A[i][1], B[1][j])), R.mul(A[i][2], B[2][j])));
    }
    out.push(row);
  }
  return out;
}

function exactMatVec(R, A, v) {
  const out = [];
  for (let i = 0; i < 3; i++) {
    out.push(R.add(R.add(R.mul(A[i][0], v[0]), R.mul(A[i][1], v[1])), R.mul(A[i][2], v[2])));
  }
  return out;
}

function exactMatPow(R, A, n) {
  let out = exactIdentity(R);
  let base = A;
  let k = n;
  while (k > 0) {
    if (k & 1) out = exactMatMul(R, out, base);
    base = exactMatMul(R, base, base);
    k >>= 1;
  }
  return out;
}

function exactMatEquals(R, A, B) {
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (!R.equals(A[i][j], B[i][j])) return false;
    }
  }
  return true;
}

// Determinant and adjugate. Inverses go through the ADJUGATE and never through elimination: these
// matrices have det = +-1 exactly, so the adjugate is the inverse up to that sign and the whole
// computation stays denominator-free. Needing to divide would mean something is wrong.
function exactDet3(R, A) {
  const t = (i, j, k, l) => R.sub(R.mul(A[i][j], A[k][l]), R.mul(A[i][l], A[k][j]));
  return R.add(
    R.sub(R.mul(A[0][0], t(1, 1, 2, 2)), R.mul(A[0][1], t(1, 0, 2, 2))),
    R.mul(A[0][2], t(1, 0, 2, 1)),
  );
}

function exactInverse3(R, A) {
  const det = exactDet3(R, A);
  const one = R.one();
  const negOne = R.neg(one);
  let sign;
  if (R.equals(det, one)) sign = 1;
  else if (R.equals(det, negOne)) sign = -1;
  else throw new Error("hyperbolic-map: exact inverse needs det = +-1; this matrix is not unimodular");
  const cof = (i, j) => {
    const r = [0, 1, 2].filter((x) => x !== i);
    const c = [0, 1, 2].filter((x) => x !== j);
    const minor = R.sub(R.mul(A[r[0]][c[0]], A[r[1]][c[1]]), R.mul(A[r[0]][c[1]], A[r[1]][c[0]]));
    return (i + j) % 2 === 0 ? minor : R.neg(minor);
  };
  // adjugate is the TRANSPOSE of the cofactor matrix
  const out = [];
  for (let i = 0; i < 3; i++) {
    const row = [];
    for (let j = 0; j < 3; j++) row.push(sign === 1 ? cof(j, i) : R.neg(cof(j, i)));
    out.push(row);
  }
  return out;
}

// The serialized form of a matrix: a `p,q,m` prefix so different tilings can never collide, then the
// nine entries row-major, each as `deg` decimal BigInt coefficients. Delimiters are unambiguous at
// every level. Used for tests and diagnostics; the tile id is the shorter vector form below.
function serializeExactMatrix(R, A, p, q, m) {
  let s = `${p},${q},${m}|`;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (i || j) s += ";";
      s += R.serialize(A[i][j]);
    }
  }
  return s;
}

// THE PUBLIC TILE ID, so its shape is fixed forever. Same prefix, then three entries.
//
// The id is the serialized TILE CENTER v = F.v_O, not the whole frame F. Three ring elements instead
// of nine is a third of the memory and a third of the work, and nothing is lost: P fixes v_O, so every
// frame in a tile's coset gives the SAME vector, and distinct tiles have distinct centers. The id is
// therefore canonical automatically -- it does not depend on the coset tie-break at all, which is why
// the round-trip tests below check the canonical FRAME separately rather than inferring it from the id.
function serializeExactVector(R, v, p, q, m) {
  return `${p},${q},${m}|${R.serialize(v[0])};${R.serialize(v[1])};${R.serialize(v[2])}`;
}

// Everything exact about one {p,q}: the ring, the mirrors, the special points, and the rotations.
function buildExactCoxeter(p, q) {
  // The n = 3 shortcut: 2cos(pi/3) = 1 is rational, so it costs nothing in ANY ring, and taking
  // N = p when q = 3 halves the ring degree ({8,3}: 4 instead of 8). ExactRing.lambdaFor knows that
  // 3 does not divide N in that case and returns the constant rather than a truncated Dickson.
  let N;
  if (q === 3) N = p;
  else if (p === 3) N = q;
  else N = (p * q) / gcdInt(p, q);

  const R = new ExactRing(N);
  const lambdaP = R.lambdaFor(p);
  const lambdaQ = R.lambdaFor(q);
  const G = gramMatrix(R, lambdaP, lambdaQ);
  const Sa = reflectionMatrix(R, G, 0);
  const Sb = reflectionMatrix(R, G, 1);
  const Sc = reflectionMatrix(R, G, 2);

  // The three special points, each the intersection of two mirrors and so fixed by both.
  const two = R.fromInt(2);
  const four = R.fromInt(4);
  const vO = [R.mul(lambdaP, lambdaQ), R.mul(two, lambdaQ), R.sub(four, R.mul(lambdaP, lambdaP))];
  const vM = [lambdaP, two, lambdaQ];
  const vV = [R.sub(four, R.mul(lambdaQ, lambdaQ)), R.mul(two, lambdaP), R.mul(lambdaP, lambdaQ)];

  // rho = Sb.Sa is the rotation by +2*pi/p about the tile center (counter-clockwise in the disk).
  // Verified in calibration rather than trusted here.
  const rho = exactMatMul(R, Sb, Sa);

  const out = { p, q, N, R, G, Sa, Sb, Sc, vO, vM, vV, lambdaP, lambdaQ, rho };
  checkCoxeterRelations(out);
  return out;
}

function gcdInt(a, b) {
  let x = a;
  let y = b;
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

// The defining relations, exactly. These run at construction for every tiling, so a ring or Gram
// mistake cannot reach the renderer: this is the check that caught the truncated-Dickson bug.
function checkCoxeterRelations(cx) {
  const { R, G, Sa, Sb, Sc, vO, vM, vV, p, q } = cx;
  const I = exactIdentity(R);
  const must = (cond, what) => {
    if (!cond) throw new Error(`hyperbolic-map: {${p},${q}} exact Coxeter check failed: ${what}`);
  };
  must(exactMatEquals(R, exactMatPow(R, Sa, 2), I), "Sa^2 = I");
  must(exactMatEquals(R, exactMatPow(R, Sb, 2), I), "Sb^2 = I");
  must(exactMatEquals(R, exactMatPow(R, Sc, 2), I), "Sc^2 = I");
  must(exactMatEquals(R, exactMatPow(R, exactMatMul(R, Sa, Sb), p), I), `(Sa Sb)^${p} = I`);
  must(exactMatEquals(R, exactMatPow(R, exactMatMul(R, Sb, Sc), q), I), `(Sb Sc)^${q} = I`);
  must(exactMatEquals(R, exactMatPow(R, exactMatMul(R, Sa, Sc), 2), I), "(Sa Sc)^2 = I");
  // Each reflection preserves the form: S^T G S = G.
  for (const [S, name] of [[Sa, "Sa"], [Sb, "Sb"], [Sc, "Sc"]]) {
    const St = [0, 1, 2].map((i) => [0, 1, 2].map((j) => S[j][i]));
    must(exactMatEquals(R, exactMatMul(R, St, exactMatMul(R, G, S)), G), `${name}^T G ${name} = G`);
  }
  // The special points are where the mirrors meet.
  must(exactVecEquals(R, exactMatVec(R, Sa, vO), vO) && exactVecEquals(R, exactMatVec(R, Sb, vO), vO),
    "vO fixed by Sa and Sb");
  must(exactVecEquals(R, exactMatVec(R, Sa, vM), vM) && exactVecEquals(R, exactMatVec(R, Sc, vM), vM),
    "vM fixed by Sa and Sc");
  must(exactVecEquals(R, exactMatVec(R, Sb, vV), vV) && exactVecEquals(R, exactMatVec(R, Sc, vV), vV),
    "vV fixed by Sb and Sc");
  // ...and all three are inside the light cone. The doubled form means timelike is < 0.
  for (const [v, name] of [[vO, "vO"], [vM, "vM"], [vV, "vV"]]) {
    must(R.toNumber(exactBilinear(R, G, v, v)) < 0, `${name} is timelike`);
  }
}

function exactVecEquals(R, u, v) {
  return R.equals(u[0], v[0]) && R.equals(u[1], v[1]) && R.equals(u[2], v[2]);
}

function exactBilinear(R, G, u, v) {
  let s = R.zero();
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) s = R.add(s, R.mul(R.mul(G[i][j], u[i]), v[j]));
  }
  return s;
}

// ===== src/data/atlas/exactcalib.js =====
// Calibration: tying the exact Coxeter matrices to the library's float SU(1,1) isometries.
//
// Every convention this file could get wrong -- which way rho turns, which exact word is which walk
// generator, whether P is +2pi/m or -2pi/m, whether matrix product means the same as Isom.mul -- is
// DISCOVERED here by comparing actions on sample points, not asserted from a comment. The audit
// already caught one composition-order bug in this codebase (math-audit claim 2); the cure is to make
// the convention an executed match rather than a belief.
//
// Comparing ACTIONS rather than matrix entries also sidesteps the SU(1,1) +-M double cover for free:
// +M and -M act identically, and the exact representation has no sign ambiguity at all.
//
// Nothing in here runs per frame. It runs once per tiling, at construction.

// A float map from the exact hyperboloid model to the Poincare disk, pinned to the library's frame:
// the tile center at the origin, the edge-0 midpoint on the +x axis, vertex 0 at angle +pi/p.
function buildIntertwiner(cx) {
  const { R, G, vO, vM, vV } = cx;
  const B = [0, 1, 2].map((i) => [0, 1, 2].map((j) => R.toNumber(G[i][j]) / 2));
  const bl = (u, v) => {
    let s = 0;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) s += B[i][j] * u[i] * v[j];
    }
    return s;
  };
  const f = (v) => [R.toNumber(v[0]), R.toNumber(v[1]), R.toNumber(v[2])];
  const o = f(vO);
  const mm = f(vM);
  const vv = f(vV);

  // e0 timelike and unit; e1, e2 spacelike, B-orthogonal, signed so that vM has a positive e1
  // coordinate and vV a positive e2 coordinate. Those two sign choices are what fix the frame.
  const e0 = o.map((c) => c / Math.sqrt(-bl(o, o)));
  let t = [0, 1, 2].map((i) => mm[i] + bl(mm, e0) * e0[i]);
  let e1 = t.map((c) => c / Math.sqrt(bl(t, t)));
  if (bl(mm, e1) < 0) e1 = e1.map((c) => -c);
  let u = [0, 1, 2].map((i) => vv[i] + bl(vv, e0) * e0[i] - bl(vv, e1) * e1[i]);
  let e2 = u.map((c) => c / Math.sqrt(bl(u, u)));
  if (bl(vv, e2) < 0) e2 = e2.map((c) => -c);

  // exact (or float) hyperboloid vector -> disk
  const toDisk = (vec) => {
    const w = typeof vec[0] === "number" ? vec : f(vec);
    const s = Math.sqrt(-bl(w, w));
    const T = -bl(w, e0) / s;
    return [bl(w, e1) / s / (1 + T), bl(w, e2) / s / (1 + T)];
  };
  // disk point -> hyperboloid vector, so an exact matrix can be applied to an arbitrary point.
  // B(e0,e0) = -1, so T = -B(v,e0) means the e0 COMPONENT is +T, not -T; with that sign
  // B(v,v) = -T^2 + X^2 + Y^2 = -1 identically. (Getting it backwards puts the point on the wrong
  // sheet and every generator match fails.)
  const fromDisk = (zx, zy) => {
    const k = 1 / (1 - zx * zx - zy * zy);
    const T = (1 + zx * zx + zy * zy) * k;
    const X = 2 * zx * k;
    const Y = 2 * zy * k;
    return [0, 1, 2].map((i) => T * e0[i] + X * e1[i] + Y * e2[i]);
  };
  // The action of an exact matrix on a disk point, as a float Mobius map.
  const actOnDisk = (M, zx, zy) => {
    const v = fromDisk(zx, zy);
    const img = [0, 1, 2].map((i) =>
      R.toNumber(M[i][0]) * v[0] + R.toNumber(M[i][1]) * v[1] + R.toNumber(M[i][2]) * v[2]);
    return toDisk(img);
  };
  return { R, toDisk, fromDisk, actOnDisk, bl, e0, e1, e2 };
}

// Sample points chosen to be generic: the origin (which pins the translation part) plus two
// off-axis points (which pin the rotation part and would not detect a reflection on their own).
const PROBES = [[0, 0], [0.3, 0], [0.2, 0.1], [-0.15, 0.22]];

function actionsAgree(actA, actB, tol) {
  for (const [zx, zy] of PROBES) {
    const a = actA(zx, zy);
    const b = actB(zx, zy);
    if (!(Math.hypot(a[0] - b[0], a[1] - b[1]) < tol)) return false;
  }
  return true;
}

// Match each float generator to an exact word, by ACTION. Returns the exact matrices in the same
// index order as `tiling.generators`, so the two representations stay interchangeable.
//
// Throws if any generator is unmatched or if two generators match the same word: a silent
// mis-assignment here would corrupt every id downstream, and there is no later check that would
// notice.
function matchGenerators(cx, generators, p, m, tol) {
  const eps = tol || 1e-9;
  const { R, rho, Sa, Sb, Sc } = cx;
  const inter = buildIntertwiner(cx);
  const rhoInv = exactMatPow(R, rho, p - 1);

  // Candidate exact words, built the same two ways RegularTiling builds its float generators.
  const candidates = [];
  if (m === p) {
    const ht = exactMatMul(R, Sa, Sc); // half-turn about the edge-0 midpoint
    for (let k = 0; k < p; k++) {
      candidates.push(exactMatMul(R, exactMatMul(R, exactMatPow(R, rho, k), ht), exactMatPow(R, rhoInv, k)));
    }
  } else {
    const vr = exactMatMul(R, Sb, Sc); // rotation about vertex 0
    const vrInv = exactMatMul(R, Sc, Sb);
    for (let k = 0; k < p; k += p / m) {
      for (const w of [vr, vrInv]) {
        candidates.push(exactMatMul(R, exactMatMul(R, exactMatPow(R, rho, k), w), exactMatPow(R, rhoInv, k)));
      }
    }
  }

  const out = new Array(generators.length).fill(null);
  const used = new Array(candidates.length).fill(-1);
  for (let i = 0; i < generators.length; i++) {
    const g = generators[i];
    const floatAct = (zx, zy) => g.applyToDisk(zx, zy, [0, 0]);
    let found = -1;
    for (let c = 0; c < candidates.length; c++) {
      if (actionsAgree(floatAct, (zx, zy) => inter.actOnDisk(candidates[c], zx, zy), eps)) {
        if (found >= 0) {
          throw new Error(`hyperbolic-map: generator ${i} matches two exact words (${found} and ${c})`);
        }
        found = c;
      }
    }
    if (found < 0) throw new Error(`hyperbolic-map: generator ${i} matches no exact word`);
    if (used[found] >= 0) {
      throw new Error(`hyperbolic-map: generators ${used[found]} and ${i} match the same exact word`);
    }
    used[found] = i;
    out[i] = candidates[found];
  }
  return { exactGenerators: out, intertwiner: inter };
}

// Which sign of rotation the exact P corresponds to. P is rho^(p/m), a rotation by 2*pi/m about the
// tile center; whether that reads as Isom.rotation(+2pi/m) or (-2pi/m) depends on conventions this
// file refuses to guess. Returns +1 or -1.
function calibrateSpin(inter, P, m, Isom, tol) {
  const eps = tol || 1e-9;
  const pAct = (zx, zy) => inter.actOnDisk(P, zx, zy);
  for (const sign of [1, -1]) {
    const rot = Isom.rotation((sign * 2 * Math.PI) / m);
    if (actionsAgree(pAct, (zx, zy) => rot.applyToDisk(zx, zy, [0, 0]), eps)) return sign;
  }
  throw new Error(`hyperbolic-map: exact P does not act as a rotation by +-2pi/${m}`);
}

// Pin the composition order: exact matrix product must mean the same as Isom.mul (apply the right
// factor first). Uses a deliberately NON-COMMUTING pair, or the test would pass either way.
function checkMultiplyOrder(cx, inter, exactA, exactB, isomA, isomB, tol) {
  const eps = tol || 1e-9;
  const { R } = cx;
  const prod = exactMatMul(R, exactA, exactB);
  const swapped = exactMatMul(R, exactB, exactA);
  const viaIsom = isomA.mul(isomB);
  const agrees = actionsAgree(
    (zx, zy) => inter.actOnDisk(prod, zx, zy),
    (zx, zy) => viaIsom.applyToDisk(zx, zy, [0, 0]),
    eps,
  );
  const commutes = actionsAgree(
    (zx, zy) => inter.actOnDisk(prod, zx, zy),
    (zx, zy) => inter.actOnDisk(swapped, zx, zy),
    eps,
  );
  if (commutes) throw new Error("hyperbolic-map: MUL_ORDER probe used a commuting pair, so it proves nothing");
  if (!agrees) throw new Error("hyperbolic-map: exact matrix product disagrees with Isom.mul ordering");
  return true;
}

// The float isometry corresponding to an exact matrix, built from the library's own primitives.
//
// The exact matrix lives in the hyperboloid basis and the library in SU(1,1), so this goes through the
// ORTHOGONAL FRAME rather than through matrix entries. Write L for the matrix of the isometry in the
// frame (e0, e1, e2) and decompose it as translation-then-rotation,
//
//     L = Rot(alpha) . Boost_x(d) . Rot(psi),      theta = alpha + psi
//
// Column 0 is (cosh d, sinh d cos alpha, sinh d sin alpha), which gives d and alpha; row 0 is
// (cosh d, sinh d cos psi, -sinh d sin psi), which gives psi. Both come straight out of atan2 and
// hypot on entries of L, with nothing large ever subtracted from anything large.
//
// Reading L is what makes this accurate. The same decomposition can be had by sending a probe point
// through the map and transporting it back through the translation to read the angle, and that route
// is unusable: the probe lands within 1e-9 of the boundary and coming back cancels cosh(d)-sized
// quantities, costing eight digits by d = 7 -- enough to make the re-anchoring identity look broken
// when only its measuring instrument was.
//
// Row 0 degenerates when the translation part is small (it is all sinh d), so near d = 0 psi comes
// instead from row 2 of Rot(-alpha).L, which is (0, sin psi, cos psi) for ANY alpha when d = 0 -- so
// the meaningless alpha that atan2 returns there cancels out of theta = alpha + psi.
function exactToIsom(inter, M, Isom, movePointToPoint) {
  const { R, bl, e0, e1, e2 } = inter;
  const column = (e) => {
    const v = [0, 1, 2].map((i) =>
      R.toNumber(M[i][0]) * e[0] + R.toNumber(M[i][1]) * e[1] + R.toNumber(M[i][2]) * e[2]);
    // frame components: e0 is timelike (B(e0,e0) = -1), so its coefficient carries a minus sign
    return [-bl(v, e0), bl(v, e1), bl(v, e2)];
  };
  const L = [column(e0), column(e1), column(e2)]; // L[j] is COLUMN j
  // An orientation-reversing element has no SU(1,1) representative at all. The walk never builds one
  // -- every generator is a product of two reflections -- so this is a guard, not a case to handle.
  //
  // Taken EXACTLY, and that is not fussiness. The float determinant of an isometry is a difference of
  // products of entries of size cosh(d), so by d = 23 it is 1 computed as a difference of numbers near
  // 1e30: pure noise, with a sign that flips at random. A float version of this guard rejects perfectly
  // good frames.
  const det = exactDet3(R, M);
  if (!R.equals(det, R.one())) {
    throw new Error("hyperbolic-map: exactToIsom needs an orientation-preserving element; this one reflects");
  }
  const alpha = Math.atan2(L[0][2], L[0][1]);
  let psi;
  if (Math.hypot(L[1][0], L[2][0]) > 1) {
    psi = Math.atan2(-L[2][0], L[1][0]);
  } else {
    const sa = Math.sin(alpha);
    const ca = Math.cos(alpha);
    psi = Math.atan2(-sa * L[1][1] + ca * L[1][2], -sa * L[2][1] + ca * L[2][2]);
  }
  // tanh(d/2) = sinh d / (1 + cosh d), which is the disk radius of the image of the origin.
  const rad = Math.hypot(L[0][1], L[0][2]) / (1 + L[0][0]);
  const beta = [rad * Math.cos(alpha), rad * Math.sin(alpha)];
  const out = movePointToPoint(0, 0, beta[0], beta[1]).mul(Isom.rotation(alpha + psi)).normalize();
  // HONEST LIMIT, and a loud one. The exact matrix is good at any distance, but a float SU(1,1)
  // isometry is not: past |beta| ~ 1 - 1e-16 the disk coordinate saturates, the hyperboloid norm
  // sqrt(-B(w,w)) cancels catastrophically, and this returns NaN. Measured on {12,3}: twelve random
  // walk steps reach |beta| = 0.9999998 and the next one is NaN.
  //
  // Nothing on the render path calls this -- the walk composes floats incrementally with periodic
  // renormalization, which is exactly why it does not have this problem. But a caller converting a
  // faraway tile's frame in one go deserves an error rather than a silently poisoned matrix.
  if (!Number.isFinite(out.ar) || !Number.isFinite(out.ai) ||
      !Number.isFinite(out.br) || !Number.isFinite(out.bi)) {
    throw new Error(
      "hyperbolic-map: exactToIsom is out of float range -- this tile is too far away to express as " +
        "a single SU(1,1) matrix relative to the origin. Use the anchored walk instead.",
    );
  }
  return out;
}

// ===== src/data/atlas/tiling.js =====
// Tilings of the hyperbolic plane: GLOBAL names, LOCAL geometry.
//
// A tiling supplies, for each tile: a canonical ADDRESS, the list of its neighbors' addresses with
// the index of the generator that reaches each, and a table of CONSTANT generator matrices. Those two
// halves answer different questions and are built out of different arithmetic, which is the central
// design decision here:
//
//   IDENTITY is exact and global. A tile's address names the tile itself, the same name by every
//   route and at every distance, so tile art may depend on it. It is an integer object -- the tile's
//   center in the Coxeter reflection representation of [p,q], over Z[2cos(pi/N)] with BigInt
//   coefficients -- because a name has to be decided by equality, and float equality of far-apart
//   frames is not a usable notion of "the same tile".
//
//   GEOMETRY is float and relative. A tiling never supplies a tile's frame relative to the world
//   origin, because that frame has entries of order cosh(d/2) -- 1.08e75 for binary cell (500, 0) --
//   and multiplying it by an equally large view matrix to get an O(1) screen position destroys every
//   digit. The renderer starts at the camera's own tile with the identity and multiplies by one
//   constant generator per step of the walk (see anchor.js), so every matrix on the path from a tile's
//   own JSON coordinates to the screen is O(1) whatever the camera's absolute position.
//
// The two meet in `stepFrame`: the float step that accompanies an edge is the one that lands in the
// neighbor's canonical frame.
//
// Proved in dev/audit_atlas_math.py (31/31), recorded in notes/math-audit.md. Load-bearing results:
//
//   * appending a generator multiplies the frame on the RIGHT, F_{c.g} = F_c . G_g, so the relative
//     frame of a neighbor IS that generator and a walk telescopes to a plain product (claims 3, 3b, 4);
//   * every binary neighbor step is a position-independent constant -- all lat and lon cancel
//     symbolically -- while the GENERAL relative frame is not, so it must never be used (claims 5, 5b);
//   * an edge half-turn squares to -I, not +I, so g^-1 = -g is the SAME isometry and every matrix
//     comparison here must be up to sign (claims 9, 9b);
//   * the tile membership test is "nearest center wins", whose boundary is the perpendicular bisector
//     and passes through the edge midpoint at exactly the inradius (claims 11, 11c).
//
// All metric relations were verified BY CONSTRUCTION -- build the polygon and measure -- rather than
// formula against formula, which is how an inverted inradius slipped through once. See notes/tilings.md.

// How much of the discovered tile graph a RegularTiling keeps. See `storeNode` for why there is a
// budget at all. The floor is comfortably larger than any one frame's working set (a 200-tile
// neighborhood with its fringe), so ordinary panning never evicts anything it is about to want; the
// character budget is what bounds memory once ids grow long far from the origin.
const NODE_FLOOR = 4096;
const ID_CHAR_BUDGET = 4e6;

// The `kind` tag on what `boundaryLocal()` returns, saying how to trace the edges. A {p,q} tile is
// bounded by geodesics -- circles orthogonal to the unit circle. The binary cell is its own kind
// ("binary-cell"), because two of its four sides are horocycles and Atlas traces it specially.
const EDGE_GEODESIC = "geodesic";

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
    centerSpacing: 2 * psi,
  };
}

// Two matrices represent the SAME isometry iff they agree up to an overall sign: SU(1,1) double-covers
// the isometry group, and an edge half-turn squares to -I rather than +I (audit claim 9). Any code
// that compares generators or frames must go through this.
function sameIsometry(a, b, tol = 1e-12) {
  const plus = Math.max(Math.abs(a.ar - b.ar), Math.abs(a.ai - b.ai),
                        Math.abs(a.br - b.br), Math.abs(a.bi - b.bi));
  const minus = Math.max(Math.abs(a.ar + b.ar), Math.abs(a.ai + b.ai),
                         Math.abs(a.br + b.br), Math.abs(a.bi + b.bi));
  return Math.min(plus, minus) < tol;
}

// Work out how many tile classes a {p,q,m} walk group admits, and VERIFY it.
//
// The candidate modulus comes from the abelianisation (see RegularTiling.tileClass), but a candidate is
// not a proof: the assignment is only a homomorphism if it respects every relator, and getting that
// wrong would reintroduce exactly the bug the class exists to avoid -- a tile changing appearance when
// the camera re-anchors. So the candidate is checked by walking the tile graph and requiring every pair
// of routes to one tile to agree, and it degrades to a single class if it does not.
//
// Cached per {p,q,m}, and the cache earns its keep: the walk is a few hundred tiles of exact integer
// arithmetic, 41 ms for {8,3} m=4, and tilings get built repeatedly by tests and demo pages.
const TILE_CLASS_CACHE = new Map();

function regularTileClass(p, q, m, generators, inverseIndex, exact, exactGenerators) {
  const cacheKey = `${p},${q},${m}`;
  const hit = TILE_CLASS_CACHE.get(cacheKey);
  if (hit) return hit;

  // phi(g) = +1 on one generator of each inverse pair and -1 on the other. For m == p every generator
  // is its own inverse, so +1 and -1 must agree, which is what forces 2*phi = 0 there.
  const step = generators.map((_, i) => (inverseIndex[i] === i || i % 2 === 0 ? 1 : -1));
  const candidate = m < p ? q : (q % 2 === 0 ? 2 : 1);

  let modulus = 1;
  if (candidate > 1) {
    const R = exact.R;
    const norm = step.map((s) => ((s % candidate) + candidate) % candidate);
    // Tiles are recognized by their exact id -- the serialized center M.v_O -- so "two routes reached
    // one tile" is decided by integer equality and not by how close two centers came. The center is
    // fixed by the stabilizer, so the RAW product serves as the id directly and none of this has to
    // canonicalize anything: one matmul and one mat-vec per edge.
    const seen = new Map();
    const queue = [{ M: exactIdentity(R), c: 0 }];
    let consistent = true;
    let collisions = 0;
    while (queue.length && seen.size < 300 && consistent) {
      const node = queue.shift();
      const id = serializeExactVector(R, exactMatVec(R, node.M, exact.vO), p, q, m);
      if (seen.has(id)) {
        collisions++;
        if (seen.get(id) !== node.c) consistent = false;
        continue;
      }
      seen.set(id, node.c);
      for (let i = 0; i < generators.length; i++) {
        queue.push({ M: exactMatMul(R, node.M, exactGenerators[i]), c: (node.c + norm[i]) % candidate });
      }
    }
    // Require real evidence: a walk that never revisited a tile has proved nothing.
    if (consistent && collisions > 10) modulus = candidate;
  }

  const out = {
    modulus,
    step: step.map((s) => (modulus > 1 ? ((s % modulus) + modulus) % modulus : 0)),
  };
  TILE_CLASS_CACHE.set(cacheKey, out);
  return out;
}

// ---- color symmetry: a homomorphism from the walk group into a permutation group -------------
//
// A tile CLASS (above) is the special case of this that the library can discover on its own: a
// homomorphism onto Z/n that kills the stabilizer, so it descends to tiles and is one integer per
// tile. A color symmetry is the general case, and it is the caller's to declare, because nothing
// about {p,q} chooses it -- it is a property of the picture.
//
// The motivating case is Escher's Circle Limit III. Its four fish colors are not a property of the
// tile: every motion of the tiling permutes them, so the color of a fish is
//
//     palette[ phi(F)[ that fish's base color ] ]
//
// with F the tile's canonical frame and phi a homomorphism into A_4. Repeating one tile's art
// everywhere cannot express that, and a tile class cannot either -- {8,3} m=4 admits only Z/3, while
// the group needed has 12 elements and is not abelian.
//
// THE PART A TILE CLASS DOES NOT NEED. phi does NOT kill the stabilizer: phi(P) is the swap of the two
// colors an octagon shows. That is not a problem, it is the point -- and it is why this could not have
// worked before tile frames became canonical. Choosing the other coset representative F.P rotates the
// art by 2*pi/m AND sends phi(F) to phi(F).phi(P), and the two cancel exactly, so the picture drawn is
// the same either way. The one thing that must hold is that the SAME F decides both, which it does:
// the art is placed by the walk in F's frame and the color is read off F's label.
//
// Concretely the accumulation carries the canonical fold's P^k, which the cyclic case can drop:
//
//     F_child = F_parent . Gx[g] . P^k    =>    phi_child = phi_parent . phi(G_g) . phi(P)^k
//
// Elements are interned as dense indices with a Cayley table, so a walk step is two array lookups and
// allocates nothing -- the same cost as the tile class's integer addition.
const COLOR_GROUP_CAP = 4096;

function permIsValid(p, n) {
  if (!Array.isArray(p) || p.length !== n) return false;
  const seen = new Array(n).fill(false);
  for (const v of p) {
    if (!Number.isInteger(v) || v < 0 || v >= n || seen[v]) return false;
    seen[v] = true;
  }
  return true;
}

// a after b: (a o b)[c] = a[b[c]]. Matches the group's own order, since phi(XY) = phi(X) o phi(Y).
function permCompose(a, b) {
  const out = new Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[b[i]];
  return out;
}

function permInverse(a) {
  const out = new Array(a.length);
  for (let i = 0; i < a.length; i++) out[a[i]] = i;
  return out;
}

function permEquals(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Validate a declared color symmetry and compile it to integer tables.
//
// The cheap algebraic conditions are checked first and separately, each with its own message, because
// "your permutations are not a homomorphism" is not something a caller can act on. They are necessary
// but NOT sufficient -- a set can satisfy all of them and still fail on a longer relator -- so the walk
// afterwards is the actual proof, exactly as for the tile class.
//
// Unlike the tile class this THROWS instead of degrading. A class is something the library discovers,
// so falling back to one class is honest; a color symmetry is something the caller asserted, and
// quietly ignoring it would paint the picture wrong in a way that looks deliberate.
const COLOR_SYMMETRY_CACHE = new Map();

function regularColorSymmetry(spec, p, q, m, generators, inverseIndex, piTransport, extendFor) {
  const n = spec.colors;
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`hyperbolic-map: colorSymmetry.colors must be a positive integer, got ${spec.colors}`);
  }
  const gens = spec.generators;
  if (!Array.isArray(gens) || gens.length !== generators.length) {
    throw new Error(
      `hyperbolic-map: colorSymmetry.generators must have one permutation per walk generator ` +
        `(${generators.length} for {${p},${q}} m=${m}), got ${Array.isArray(gens) ? gens.length : typeof gens}`,
    );
  }
  for (let g = 0; g < gens.length; g++) {
    if (!permIsValid(gens[g], n)) {
      throw new Error(
        `hyperbolic-map: colorSymmetry.generators[${g}] is not a permutation of ${n} colors: ` +
          JSON.stringify(gens[g]),
      );
    }
  }
  const stab = spec.stabilizer || spec.stabilizer;
  if (!permIsValid(stab, n)) {
    throw new Error(
      `hyperbolic-map: colorSymmetry.stabilizer is not a permutation of ${n} colors: ${JSON.stringify(stab)}`,
    );
  }

  const cacheKey = `${p},${q},${m}|${n}|${gens.map((x) => x.join("")).join(",")}|${stab.join("")}`;
  const hit = COLOR_SYMMETRY_CACHE.get(cacheKey);
  if (hit) return hit;

  const identity = [];
  for (let i = 0; i < n; i++) identity.push(i);

  // phi(P)^m = 1, because P^m is the identity of the group.
  const stabPowPerm = [identity];
  for (let k = 1; k < m; k++) stabPowPerm.push(permCompose(stabPowPerm[k - 1], stab));
  if (!permEquals(permCompose(stabPowPerm[m - 1], stab), identity)) {
    throw new Error(
      `hyperbolic-map: colorSymmetry.stabilizer must have order dividing ${m} -- it is the image of the ` +
        `2*pi/${m} rotation about a tile center, and P^${m} is the identity. Got ${JSON.stringify(stab)}.`,
    );
  }
  // phi respects the inverse pairing of the generators.
  for (let g = 0; g < gens.length; g++) {
    if (!permEquals(gens[inverseIndex[g]], permInverse(gens[g]))) {
      throw new Error(
        `hyperbolic-map: colorSymmetry.generators[${inverseIndex[g]}] must be the inverse of ` +
          `generators[${g}], since generator ${inverseIndex[g]} is the inverse walk step. Expected ` +
          `${JSON.stringify(permInverse(gens[g]))}, got ${JSON.stringify(gens[inverseIndex[g]])}.`,
      );
    }
  }
  // Conjugating a generator by P permutes the generator set (see piTransport), so phi must agree.
  for (let j = 1; j < m; j++) {
    const inv = permInverse(stabPowPerm[j]);
    for (let g = 0; g < gens.length; g++) {
      const want = permCompose(permCompose(stabPowPerm[j], gens[g]), inv);
      const h = piTransport[j][g];
      if (!permEquals(gens[h], want)) {
        throw new Error(
          `hyperbolic-map: colorSymmetry is inconsistent with the tiling: P^${j}.G_${g}.P^-${j} is ` +
            `G_${h}, so generators[${h}] must be ${JSON.stringify(want)}, but it is ` +
            `${JSON.stringify(gens[h])}.`,
        );
      }
    }
  }

  // Enumerate the generated group and build its Cayley table. The BFS closes under every generator
  // image and the stabilizer image, which is exactly the set of labels any walk can produce.
  const index = new Map([[identity.join(","), 0]]);
  const elements = [identity];
  const seeds = gens.concat([stab]);
  for (let i = 0; i < elements.length; i++) {
    for (const s of seeds) {
      const prod = permCompose(elements[i], s);
      const key = prod.join(",");
      if (!index.has(key)) {
        if (elements.length >= COLOR_GROUP_CAP) {
          throw new Error(
            `hyperbolic-map: colorSymmetry generates a group of more than ${COLOR_GROUP_CAP} elements. ` +
              "That is almost always a typo in one permutation: a color symmetry's group is small (12 " +
              "for Circle Limit III's A_4).",
          );
        }
        index.set(key, elements.length);
        elements.push(prod);
      }
    }
  }
  const size = elements.length;
  const table = [];
  for (let i = 0; i < size; i++) {
    const row = new Int32Array(size);
    for (let j = 0; j < size; j++) row[j] = index.get(permCompose(elements[i], elements[j]).join(","));
    table.push(row);
  }
  const genIndex = gens.map((g) => index.get(g.join(",")));
  const stabPow = stabPowPerm.map((s) => index.get(s.join(",")));

  // THE PROOF. Everything above is necessary; only this is sufficient. Walk the real tile graph,
  // accumulate labels the way the walk will, and require every pair of routes to one tile to agree.
  const seen = new Map();
  const queue = [{ node: extendFor.origin, col: 0 }];
  let collisions = 0;
  while (queue.length && seen.size < 400) {
    const cur = queue.shift();
    const prev = seen.get(cur.node.id);
    if (prev !== undefined) {
      collisions++;
      if (prev !== cur.col) {
        throw new Error(
          `hyperbolic-map: colorSymmetry is not a homomorphism -- two routes to one tile of ` +
            `{${p},${q}} m=${m} give different colors (${JSON.stringify(elements[prev])} and ` +
            `${JSON.stringify(elements[cur.col])}). Every relator of the walk group must be respected, ` +
            "not only the generator relations that were checked above.",
        );
      }
      continue;
    }
    seen.set(cur.node.id, cur.col);
    for (let g = 0; g < generators.length; g++) {
      const edge = extendFor.edge(cur.node, g);
      queue.push({ node: edge.node, col: table[table[cur.col][genIndex[g]]][stabPow[edge.k]] });
    }
  }
  // A walk that never revisited a tile has proved nothing; the same guard the tile class uses.
  if (collisions <= 10) {
    throw new Error(
      `hyperbolic-map: could not verify colorSymmetry -- the walk over {${p},${q}} m=${m} closed on ` +
        `itself only ${collisions} times, which is not evidence.`,
    );
  }

  const out = { colors: n, size, elements, table, genIndex, stabPow };
  COLOR_SYMMETRY_CACHE.set(cacheKey, out);
  return out;
}

class RegularTiling {
  // `frameSymmetry` (m, a divisor of p) is the rotational symmetry the tile art is promised to have.
  // It selects the walk group so that the tile stabilizer is C_m, which is what makes "the same data
  // in every tile" produce a consistent pattern. See notes/tilings.md and
  // notes/escher-circle-limit-iii.md -- for Circle Limit III this must be 4, not 8, and using the
  // default half-turn generators there would silently shred the pattern.
  constructor({ p, q, frameSymmetry = null, colorSymmetry = null } = {}) {
    this.metrics = regularMetrics(p, q);
    this.p = p;
    this.q = q;
    this.m = frameSymmetry || p;
    // Only m = p and m = p/2 are usable, and dividing p is NOT enough.
    //
    // m = p takes its steps with half-turns about edge midpoints: p generators, one per edge, so every
    // neighbor is one step away. m < p takes them with rotations about VERTICES, two generators per
    // vertex (the two senses), at the m vertices whose index is a multiple of p/m -- so 2m generators
    // reaching 2m of the p edges. Covering the plane needs 2m >= p, and since m divides p and m < p
    // forces m <= p/2, the only m < p that works is exactly p/2.
    //
    // Anything smaller silently produces a tiling that cannot reach most of its own neighbors. It does
    // not throw and it does not look obviously wrong at a glance: measured on {8,3} with m = 2, the
    // walk reaches edges 0, 1, 4 and 5 only, a 0.75-radius view returns 5 tiles where it should return
    // 17, and the rest of the disk renders as background. `containsLocal` agrees with it -- the Voronoi
    // test is built from the generator set, so it sees 4 half-planes instead of 8 and hands the gaps to
    // whichever tile is nearest -- which means picking claims ground that nothing draws.
    if (!(this.m === p || 2 * this.m === p)) {
      throw new Error(
        `hyperbolic-map: frameSymmetry ${this.m} cannot tile {${p},${q}}: only ${p}` +
          (p % 2 === 0 ? ` and ${p / 2}` : "") +
          ` work. m = p steps by edge half-turns and m = p/2 by vertex rotations; a smaller m reaches ` +
          `only ${2 * this.m} of the ${p} neighbors and leaves the rest of the plane unreachable.`,
      );
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

    // Generators. Constant matrices, built once here and never rebuilt.
    if (this.m === p) {
      // Half-turn about each edge midpoint. Always a symmetry of {p,q} -- it is the "2" of the
      // (2,p,q) triangle group -- including for ODD p. (Only pure TRANSLATIONS between adjacent
      // tiles need even p; do not confuse the two.) Each is an involution AS AN ISOMETRY: the matrix
      // squares to -I, so g^-1 = -g, and the edge back to the parent carries the same index in the
      // child (before the canonical frame correction; see reverseGenerator).
      const g0 = new Isom(0, Math.cosh(psi), 0, -Math.sinh(psi));
      this.generators = [];
      for (let k = 0; k < p; k++) {
        const s = Isom.rotation((2 * Math.PI * k) / p);
        this.generators.push(s.mul(g0).mul(Isom.rotation((-2 * Math.PI * k) / p)));
      }
    } else {
      // The half-turn is generally outside the subgroup with stabilizer C_m, so use rotations about
      // the vertices instead. Every m-th vertex is a "class A" vertex; rotating about one by
      // +/- 2*pi/q reaches the two tiles across the edges incident there, which covers all p
      // neighbors.
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
    }

    // THE TILE STABILIZER, C_m: the rotations about this tile's own center that lie in the walk group.
    //
    // This is the single most important thing to know before writing tile art, so it is a first-class
    // part of the contract rather than an internal detail. A tile's frame is only defined UP TO this
    // rotation -- the walk reaches a tile by whatever route is shortest from the camera, and different
    // routes differ by an element of C_m -- so art that is not invariant under it will visibly jump when
    // the camera crosses a tile boundary. Measured on {8,3} m=4: 16 of 30 on-screen tiles rotate by a
    // multiple of 90 degrees at the instant of re-anchoring.
    //
    // Verified by walking the tile graph and collecting frame_seen^-1 . frame_new at every collision:
    // every discrepancy observed is a rotation by a multiple of 2*pi/m. See test/tiling.test.mjs.
    this.stabilizerOrder = this.m;
    this.selfRotation = Isom.rotation((2 * Math.PI) / this.m);

    // Which generator undoes each generator. The set is closed under inverse UP TO SIGN in both
    // cases: for m = p every generator is its own inverse; for m < p the +/- senses about each vertex
    // pair up. Verified in the constructor rather than assumed, because a wrong entry here would send
    // `reverseGenerator` to the wrong neighbor and a walk could never retrace its own steps.
    this.inverseIndex = this.generators.map((g, i) => {
      const gi = g.inverse();
      for (let j = 0; j < this.generators.length; j++) {
        if (sameIsometry(gi, this.generators[j])) return j;
      }
      throw new Error(`hyperbolic-map: {${p},${q}} generator ${i} has no inverse in the set`);
    });

    // Neighbor tile CENTERS in this tile's own local coordinates, for the membership test. Constant.
    this.neighborCentersLocal = this.generators.map((g) => {
      const z = g.applyToDisk(0, 0, [0, 0]);
      const k = 1 / Math.sqrt(1 - z[0] * z[0] - z[1] * z[1]);
      const x = z[0] * k;
      const y = z[1] * k;
      return [x, y, Math.sqrt(1 + x * x + y * y)];
    });

    // The tile boundary in tile-local coordinates: p geodesic edges between consecutive vertices.
    this.boundaryLocalPoints = this.vertexDisk.map(([zx, zy]) => {
      const k = 1 / Math.sqrt(1 - zx * zx - zy * zy);
      return [zx * k, zy * k];
    });

    // ---- EXACT IDENTITY AND ORIENTATION ----
    //
    // A tile-with-frame is an element of the walk group, and two routes to one tile differ by an
    // element of the stabilizer C_m. So a TILE is a coset F.C_m, and its canonical representative --
    // the lexicographically least matrix in that coset -- is simultaneously its unique id and its
    // canonical orientation. One object solves identity and orientation together.
    //
    // Computed in the Coxeter reflection representation over Z[mu] with BigInt entries. Integers are
    // what make this work at any distance: a float frame at hyperbolic distance ~37 has entries whose
    // one-ulp spacing exceeds the gap between adjacent tile centers, so no float test can decide
    // whether two frames name one tile out there. Integers have no such ceiling.
    //
    // WHAT IT COSTS, measured on the Escher atlas ({8,3} m=4, 200 tiles, 560 px):
    //
    //   * naming happens once per tile ever, not per frame. Across a 200-frame pan, 197 frames do ZERO
    //     ring multiplies and the median frame is 16.4 ms. `exactMulCount()` is exported so that claim
    //     can be measured rather than believed.
    //   * a frame that reaches tiles never seen before pays for all of them at once: ~1,800 edges
    //     around a 200-tile view at ~117 ring multiplies each. The first frame of all costs 250 ms, and
    //     the frame where a pan first crosses into unexplored ground costs ~130 ms. Panning back over
    //     ground already walked costs nothing.
    //
    // The 117 divides as 27 for F_parent . G_g, 9 for the id vector, and 27(m-1) to canonicalize -- so
    // canonicalization dominates and grows with m. Lex-min over the m images of v_M instead of over
    // matrices would make that 9m + 27, worth doing if {12,3} ever matters; it renames every tile, so
    // it is not worth doing casually.
    this.exact = buildExactCoxeter(p, q);
    const matched = matchGenerators(this.exact, this.generators, p, this.m);
    this.exactGenerators = matched.exactGenerators;
    this.intertwiner = matched.intertwiner;
    this.exactP = exactMatPow(this.exact.R, this.exact.rho, p / this.m);
    // Whether the exact P reads as a +2pi/m or -2pi/m rotation is discovered, never assumed.
    this.spin = calibrateSpin(this.intertwiner, this.exactP, this.m, Isom);

    this.exactPPow = [exactIdentity(this.exact.R)];
    for (let k = 1; k < this.m; k++) {
      this.exactPPow.push(exactMatMul(this.exact.R, this.exactPPow[k - 1], this.exactP));
    }
    // Float rotations by 2*pi*k/m about a tile's own center, precomputed: the walk multiplies by one
    // of these on every step and must never build them per frame.
    this.rotP = [];
    for (let k = 0; k < this.m; k++) {
      this.rotP.push(Isom.rotation((this.spin * 2 * Math.PI * k) / this.m));
    }

    // The transport permutation. Conjugating by P permutes the generator set -- they are built as
    // rho^k . base . rho^-k with k closed under adding p/m -- so
    //
    //     P^j . Gx[g] . P^-j = Gx[pi[j][g]]
    //
    // exactly, with no leftover rotation -- pi is a pure permutation of generator indices, and the
    // search below throws rather than assume it. The walk forward does not need this table, because
    // folding P^k into each step keeps every frame canonical. Stepping BACK does: see reverseGenerator.
    this.piTransport = [];
    this.piInverse = [];
    for (let j = 0; j < this.m; j++) {
      const row = new Array(this.generators.length).fill(-1);
      const inv = new Array(this.generators.length).fill(-1);
      const Pj = this.exactPPow[j];
      const PjInv = this.exactPPow[(this.m - j) % this.m];
      for (let g = 0; g < this.generators.length; g++) {
        const conj = exactMatMul(this.exact.R, exactMatMul(this.exact.R, Pj, this.exactGenerators[g]), PjInv);
        let found = -1;
        for (let h = 0; h < this.exactGenerators.length; h++) {
          if (exactMatEquals(this.exact.R, conj, this.exactGenerators[h])) {
            found = h;
            break;
          }
        }
        if (found < 0) {
          throw new Error(
            `hyperbolic-map: {${p},${q}} m=${this.m}: P^${j} does not permute the generators, so the ` +
              "walk group is not what this construction assumes",
          );
        }
        row[g] = found;
        inv[found] = g;
      }
      if (inv.includes(-1)) throw new Error(`hyperbolic-map: transport row ${j} is not a permutation`);
      this.piTransport.push(row);
      this.piInverse.push(inv);
    }

    // The tile-class homomorphism. See tileClass() for what it is for and why it is sound. It comes
    // after the exact machinery because verifying it means recognizing when two routes have reached one
    // tile, and that is decided by the exact id.
    const cls = regularTileClass(p, q, this.m, this.generators, this.inverseIndex, this.exact,
      this.exactGenerators);
    this.classModulus = cls.modulus;
    this.classStep = cls.step;

    // Every tile ever discovered, keyed by its canonical id. Nodes are persistent and shared, so
    // reaching a tile by a second route returns the SAME object -- which is what makes the id, the
    // frame and the tile-data cache slot route-independent.
    this.nodes = new Map();
    this.idChars = 0;
    this.rootNode = this.internNode(exactIdentity(this.exact.R), 0, 0);

    // The declared color symmetry, if there is one. See regularColorSymmetry.
    this.color = null;
    this.colorCount = 1;
    if (colorSymmetry) {
      this.color = regularColorSymmetry(colorSymmetry, p, q, this.m, this.generators, this.inverseIndex,
        this.piTransport, {
          origin: this.rootNode,
          edge: (node, g) => {
            this.extendAddress(node, g);
            return node.edges.get(g);
          },
        });
      this.colorCount = this.color.size;
      // Verifying it built a few hundred nodes while `this.color` was still null, so their labels are
      // all zero. Start the store again now that labels can be computed; nothing outside has seen it.
      this.nodes = new Map();
      this.idChars = 0;
      this.rootNode = this.internNode(exactIdentity(this.exact.R), 0, 0);
    }
  }

  // Compare two exact matrices in a fixed total order: row-major, entrywise, using the ring's own
  // order. This is what "lexicographically least" means, and it is what picks the canonical coset
  // representative -- so it is frozen. Changing it renames every id in every cache.
  cmpExact(A, B) {
    const R = this.exact.R;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const c = R.cmp(A[i][j], B[i][j]);
        if (c !== 0) return c;
      }
    }
    return 0;
  }

  // The tile id of ANY frame for a tile: the serialized center M.v_O.
  //
  // P fixes v_O, so every frame in the coset gives the same vector and the id needs no canonicalization
  // at all -- which is why it can be computed before deciding whether the tile is new, and why the
  // tile-class walk can use raw products. Distinct tiles have distinct centers, so it is injective.
  idExact(M) {
    const R = this.exact.R;
    return serializeExactVector(R, exactMatVec(R, M, this.exact.vO), this.p, this.q, this.m);
  }

  // The canonical representative of the coset M.C_m, and which power of P got us there.
  //
  // Two routes to one tile give M and M.P^j; the candidate sets {M.P^k} and {M.P^j.P^k} are the SAME
  // SET, so the minimum over them is identical. That is the entire proof that a tile's frame does not
  // depend on the route -- no automaton, no normal form, no parent heuristic.
  //
  // Canonicalizing over C_m and NOT the full C_p matters: a canonical frame must stay inside the set of
  // frames the walk can actually produce. Over C_p, roughly half of {8,3} m=4's tiles would be turned
  // by an odd multiple of 45 degrees, which is not a symmetry of the C_4 walk group, and the Escher
  // pattern would shatter into a misaligned variant.

  canonicalExact(M) {
    const R = this.exact.R;
    const I = exactIdentity(R);
    let bestK = 0;
    let best = M;
    // IDENTITY-FIRST TIE-BREAK. Only the origin tile's coset contains I, and letting I win its own
    // coset makes the origin tile's canonical frame exactly the identity. Any fixed rule would be
    // equally canonical, but this one is worth the two comparisons: without it the origin canonicalizes
    // to whichever P^k sorts first -- P^2, a half-turn, for {8,3} m=4 -- and the entire picture is then
    // turned by a constant relative to the unanchored global frame, so `globalFrameForTesting` and the
    // walk disagree about where the origin tile is pointing.
    if (this.cmpExact(M, I) === 0) return { F: I, k: 0 };
    for (let k = 1; k < this.m; k++) {
      const cand = exactMatMul(R, M, this.exactPPow[k]);
      if (this.cmpExact(cand, I) === 0) return { F: cand, k };
      if (this.cmpExact(cand, best) < 0) {
        best = cand;
        bestK = k;
      }
    }
    return { F: best, k: bestK };
  }

  // Look up or create the node for the coset of M.
  internNode(M, cls, col) {
    const id = this.idExact(M);
    const hit = this.nodes.get(id);
    if (hit) return hit;
    const { F } = this.canonicalExact(M);
    return this.storeNode({ F, id, cls, col, edges: new Map() });
  }

  // Add a node to the store and keep the store bounded.
  //
  // WHY BOUNDED. An id is one string per tile ever visited and its length grows linearly with distance
  // (measured on {8,3} m=4: about 12 characters per tile crossed), so retaining every node makes the
  // memory of a long pan grow like the SQUARE of the distance traveled -- 93 MB at 1,000 tiles out,
  // 734 MB at 4,000. That is a property of naming tiles globally at all, not of this encoding: there
  // are exponentially many tiles within distance d, so any correct global name needs Omega(d) bits.
  //
  // Eviction is safe because nothing anywhere depends on node object identity -- `addressEquals`
  // compares ids, and re-deriving an evicted node costs one canonicalization. Evicting also CLEARS the
  // dropped node's edges, so a dropped node cannot keep the rest of its subtree alive through a live
  // neighbor's edge cache.
  //
  // The budget is on retained id characters rather than node count, because that is the thing that
  // actually grows; the floor on count is what keeps a frame's working set resident so that steady-state
  // panning still does no exact arithmetic at all.
  storeNode(node) {
    this.nodes.set(node.id, node);
    this.idChars += node.id.length;
    while (this.nodes.size > NODE_FLOOR && this.idChars > ID_CHAR_BUDGET) {
      // Map iterates in insertion order, so this drops the least recently created node.
      const oldest = this.nodes.keys().next();
      if (oldest.done) break;
      const victim = this.nodes.get(oldest.value);
      if (victim === this.rootNode) {
        // The origin is inserted first, so it would block every eviction; move it to the back instead.
        // It is kept forever because `originAddress()` hands it out and losing its edges would make
        // every route through the origin redo exact work.
        this.nodes.delete(oldest.value);
        this.nodes.set(oldest.value, victim);
        continue;
      }
      this.nodes.delete(oldest.value);
      this.idChars -= victim.id.length;
      victim.edges.clear();
    }
    return node;
  }

  // ---- addressing ----
  //
  // An address is a NODE in the tile graph: { F, id, cls, edges }, with F the tile's canonical exact
  // frame and `id` its canonical name. A node names the TILE, not a route to it: two routes to one
  // tile return the same id, the same frame and the same tile-data cache slot, which is what lets tile
  // art be fully asymmetric and depend on its own address.
  //
  // Treat an address as opaque. `id` is stable and safe to persist as a key, but it is not a coordinate
  // and there is no way back from the string to a node -- keep the object if you need to return to a
  // tile (see viewport.getCamera).

  originAddress() {
    return this.rootNode;
  }

  // The id IS the key, and reading it is a field access: canonicalization happened once, when the node
  // was created, and never happens again for that tile.
  addressKey(address) {
    return address.id;
  }

  addressToString(address) {
    return address.id;
  }

  addressEquals(a, b) {
    return a === b || a.id === b.id;
  }

  // Step to a neighbor. Nodes are interned, so the second route to a tile returns the same object.
  //
  // The edge also records the float step to use: not the bare generator, but the generator followed
  // by the rotation that lands in the CHILD'S canonical frame. Folding the correction into the step
  // is what keeps every frame the walk produces canonical, so nothing downstream has to know that a
  // correction happened -- `net` is already right, and clipping, picking and boundary overlays are
  // untouched (the tile polygon is C_p-invariant and P is in C_p).
  //
  // Exact arithmetic happens HERE, once per edge ever traversed, and never again.
  extendAddress(address, gen) {
    const hit = address.edges.get(gen);
    if (hit) return hit.node;
    const R = this.exact.R;
    const M = exactMatMul(R, address.F, this.exactGenerators[gen]);
    const id = this.idExact(M);
    const { F, k } = this.canonicalExact(M);
    let child = this.nodes.get(id);
    if (!child) {
      const n = this.classModulus;
      const cls = n > 1 ? (((address.cls + this.classStep[gen]) % n) + n) % n : 0;
      // The color label carries the canonical fold's P^k as well as the generator, because phi(P) is
      // not the identity -- see regularColorSymmetry. Two table lookups, no allocation.
      const c = this.color;
      const col = c ? c.table[c.table[address.col][c.genIndex[gen]]][c.stabPow[k]] : 0;
      child = this.storeNode({ F, id, cls, col, edges: new Map() });
    }
    // F_child = F_parent . Gx[gen] . P^k, so the float step is the generator then that rotation.
    const step = this.generators[gen].mul(this.rotP[k]).normalize();
    address.edges.set(gen, { node: child, k, step });
    return child;
  }

  // The float isometry for one walk step, in canonical frames. The walk uses this instead of
  // generator(gen); the difference is the C_m correction folded in.
  stepFrame(address, gen) {
    const hit = address.edges.get(gen);
    if (hit) return hit.step;
    this.extendAddress(address, gen);
    return address.edges.get(gen).step;
  }

  // Which generators lead out of this tile, WITHOUT building any of the neighbors.
  //
  // This exists so the walk can decide whether it wants a neighbor before paying for it. Naming a
  // tile costs exact integer arithmetic -- one matmul, m-1 more to canonicalize, and a mat-vec for the
  // id -- and the walk discards most of what it looks at: it explores about eight candidates per tile
  // and keeps a couple of hundred in total. Measured on the Escher atlas before this existed, a frame
  // that crossed a tile boundary named ~800 new tiles, spent 210,000 ring multiplies and took 154 ms
  // against a 17 ms median. The center of a neighbor can be found from the plain generator, with no
  // exact work at all, which is enough to reject it.
  neighborGens() {
    if (!this._gensAll) {
      this._gensAll = [];
      for (let g = 0; g < this.generators.length; g++) this._gensAll.push(g);
    }
    return this._gensAll;
  }

  neighbors(address) {
    const out = [];
    for (let g = 0; g < this.generators.length; g++) {
      out.push({ address: this.extendAddress(address, g), gen: g });
    }
    return out;
  }

  generator(i) {
    return this.generators[i];
  }

  inverseGenerator(i) {
    return this.inverseIndex[i];
  }

  // The generator that steps from `extendAddress(address, gen)` BACK to `address`.
  //
  // NOT `inverseGenerator(gen)`, and this is the one place where canonical frames cost something. The
  // child's canonical frame is F_p . Gx[g] . P^k, so a step h out of the child reads as
  //
  //     F_p . Gx[g] . P^k . Gx[h]  =  F_p . Gx[g] . Gx[pi_k(h)] . P^k
  //
  // which lands back on the parent exactly when pi_k(h) is the inverse of g. Applying the plain
  // inverse index instead lands on a DIFFERENT neighbor of the child -- a real tile, so nothing
  // throws; the walk just quietly fails to come home. (`inverseGenerator` still means what it always
  // meant: the index whose isometry is the inverse. It is the frame that moved, not the name.)
  reverseGenerator(address, gen) {
    const hit = address.edges.get(gen) || (this.extendAddress(address, gen), address.edges.get(gen));
    return this.piInverse[hit.k][this.inverseIndex[gen]];
  }

  generatorCount() {
    return this.generators.length;
  }

  // ---- tile classes: a cheap, meaningful grouping of tiles ----
  //
  // A class is a coloring of the tiling by a group HOMOMORPHISM phi: Gamma -> Z/n that kills the
  // stabilizer C_m, so it descends to tiles. Art may key on the tile's own id, so a class is not the
  // only per-tile variation available any more -- what it still is, is the STRUCTURED one: adjacent
  // tiles never share a class, so it reads as a proper coloring of the tiling rather than as noise,
  // and it costs one integer addition per walk step instead of a string lookup.
  //
  // What n can be is fixed by the abelianisation of the walk group, and it is small:
  //
  //   m < p  (vertex-rotation generators, e.g. Circle Limit III's {8,3} m=4): phi(g) has order q,
  //          giving Z/q -- THREE classes for {8,3} m=4. Geometrically it is a proper 3-coloring of the
  //          octagons: the three meeting at any vertex all differ.
  //   m == p (edge half-turn generators): phi(g) has order dividing 2, and going around a vertex forces
  //          q*phi(g) = 0 too, so there are two classes when q is EVEN ({5,4}, {6,4}) and only one when
  //          q is odd ({8,3}, {7,3}, {3,7}, {12,3}).
  //
  // Verified, not assumed: the modulus is confirmed by walking the tile graph and checking that every
  // pair of routes to one tile agrees, and it falls back to 1 if it does not. Cached per {p,q,m}.
  tileClass(address) {
    return this.classModulus > 1 ? address.cls : 0;
  }

  // ---- color symmetry ----
  //
  // The permutation this tile applies to the caller's colors, or null if no colorSymmetry was declared.
  // A function of the TILE: two routes give the same permutation, because they give the same canonical
  // frame. Do not mutate the returned array -- it is the interned group element, shared by every tile
  // that carries it.
  colorPermutation(address) {
    return this.color ? this.color.elements[address.col] : null;
  }

  // The same thing as a dense index in [0, colorCount). What art keyed on the color symmetry should
  // cache on: a repeating atlas has one recolored copy per group element and no more, so this is the
  // key that keeps `Atlas`'s compile memo hitting.
  colorIndex(address) {
    return this.color ? address.col : 0;
  }

  // ---- geometry, all in tile-local coordinates ----

  // Is this tile-local point inside this tile? A regular tiling's tiles are exactly the Voronoi cells
  // of their centers, so the test is "closer to my center than to any neighbor's".
  //
  // cosh(d/2) to my own center (the local origin) is just w, and to a neighbor center N it is
  // sqrt(A^2 + B^2) with A = w*nw - x*nx - y*ny and B = x*ny - y*nx. Audit claim 11 proves the
  // boundary of this test passes through the edge midpoint at exactly the inradius.
  //
  // NOTE: the tempting near-miss is to compare A against nw^2 instead. That is a different, LARGER
  // region -- at the edge midpoint its value is -0.63 at the {8,3} inradius instead of zero (audit
  // claim 11b, dev/audit_atlas_math.py). The 2012 Escher tile cutter used it, harmlessly, because it
  // deliberately over-included and relied on render-time clipping; here it would be wrong.
  containsLocal(x, y, tol = 0) {
    const w = Math.sqrt(1 + x * x + y * y);
    const own = w * w;
    for (let i = 0; i < this.neighborCentersLocal.length; i++) {
      const [nx, ny, nw] = this.neighborCentersLocal[i];
      const A = w * nw - x * nx - y * ny;
      const B = x * ny - y * nx;
      if (A * A + B * B < own - tol) return false;
    }
    return true;
  }

  // Which neighbor to move to, to get closer to containing this tile-local point? Returns an INDEX
  // INTO `neighbors(address)`, or -1 if the point is already inside.
  //
  // An index into the neighbor list, not a generator index. Those coincide here but not for the binary
  // tiling, whose parent step comes in two parities -- and naming a generator there produced a real bug:
  // `stepToward` said PARENT_EVEN, an odd-longitude cell offered only PARENT_ODD, the lookup failed, and
  // the camera could never move UP. It then chased downward forever: max|V| reached 2.6e24 and the
  // latitude ran to several hundred digits.
  //
  // A regular tiling's tiles are the Voronoi cells of their centers, so:
  //
  //   * stop when the point is INSIDE -- the exact predicate, no tolerance, so a point sitting on a
  //     bisector counts as inside and cannot make the camera oscillate between two tiles;
  //   * otherwise step to the NEAREST neighbor center. Not inside means some neighbor's center is
  //     strictly nearer, so the distance to the containing tile strictly decreases every step. That is
  //     what makes the descent monotone, hence terminating.
  //
  // Stepping to the most VIOLATED half-plane instead sounds equivalent and is not: violation magnitude
  // is not a distance, so the descent is not monotone in it. Measured on {7,3}, that variant took 4,127
  // re-anchor steps for 300 small camera moves -- it was cycling.
  stepToward(x, y) {
    // A RELATIVE tolerance on the containment test, not an exact one. A point lying within rounding of a
    // bisector is genuinely ambiguous: each of the two tiles computes the other as a hair nearer, and the
    // camera ping-pongs. Measured on {7,3}: one camera move in forty hit the iteration cap at 4,096
    // steps while every other took one. Treating "within 1e-11 of the boundary" as inside removes the
    // ambiguity, and the error it admits -- the camera tile being a neighbor of the containing one for
    // points a hair from the edge -- is harmless, since the camera tile only has to be NEAR.
    if (this.containsLocal(x, y, 1e-11 * (1 + x * x + y * y))) return -1;
    const w = Math.sqrt(1 + x * x + y * y);
    let best = w * w;
    let pick = -1;
    for (let i = 0; i < this.neighborCentersLocal.length; i++) {
      const [nx, ny, nw] = this.neighborCentersLocal[i];
      const A = w * nw - x * nx - y * ny;
      const B = x * ny - y * nx;
      const d = A * A + B * B;
      if (d < best) {
        best = d;
        pick = i;
      }
    }
    return pick;
  }

  boundaryLocal() {
    return { kind: EDGE_GEODESIC, points: this.boundaryLocalPoints };
  }

  // DIAGNOSTIC ONLY -- the global frame, entries of order cosh(d/2). Never call this on the render
  // path; it exists so tests can compare the anchored machinery against the naive computation in the
  // near-origin regime where the naive one is still trustworthy, and so the mpmath oracle has
  // something to check. Deliberately named to be greppable.
  globalFrameForTesting(address) {
    // Now exact underneath: the node carries its canonical frame as an integer matrix, and this is
    // just the float image of it. Still diagnostic-only -- the entries grow like cosh(d/2), which is
    // precisely why the render path composes relative frames instead.
    return exactToIsom(this.intertwiner, address.F, Isom, movePointToPoint);
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
// edge-to-edge -- each cell has FIVE neighbors (one parent, two children, two lateral), because a
// cell's bottom edge is the union of its two children's top edges.
//
// It is also only weakly aperiodic: monohedral but NOT tile-transitive, its symmetry group being
// essentially <z -> 2z>. So it cannot produce a seamless group-invariant pattern the way {p,q} can --
// but z -> 2z maps cell (lat, lon) to cell (lat+1, lon) bijectively, so LATITUDE SHIFT is an exact
// symmetry, and that is what the far-field invariance diagnostic uses.
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

// Generator indices. Six, not five: the parent step depends on the current cell's longitude PARITY,
// and splitting it that way is what keeps both variants constant.
const BIN_RIGHT = 0;
const BIN_LEFT = 1;
const BIN_CHILD0 = 2;
const BIN_CHILD1 = 3;
const BIN_PARENT_EVEN = 4;
const BIN_PARENT_ODD = 5;

// The half-plane map z -> S z + T, conjugated into SU(1,1) by the Cayley transform C = [[i,1],[1,i]].
// Verified symbolically (audit claim 6): a = (S + 1 + iT)/(2 sqrt S), b = (T + i(S - 1))/(2 sqrt S),
// and |a|^2 - |b|^2 = 1 identically. Checked symbolically rather than trusted, because a hand
// derivation swaps b's real and imaginary parts very easily and the result still looks plausible.
function isomFromScaleShift(S, T) {
  const rs = Math.sqrt(S);
  const inv = 1 / rs;
  return new Isom((rs + inv) / 2, (T * inv) / 2, (T * inv) / 2, (rs - inv) / 2).normalize();
}

// The six CONSTANT neighbor steps, each mapping NEIGHBOR-local coordinates into CURRENT-cell-local
// coordinates. Every latitude and longitude cancels; audit claim 5 proves it symbolically and claims
// 5c-5e confirm the parity rule by showing child-then-parent round trips are exactly the identity.
const R2 = Math.SQRT2;
const BINARY_GENERATORS = [];
BINARY_GENERATORS[BIN_RIGHT] = isomFromScaleShift(1, 1 / R2);
BINARY_GENERATORS[BIN_LEFT] = isomFromScaleShift(1, -1 / R2);
BINARY_GENERATORS[BIN_CHILD0] = isomFromScaleShift(0.5, -0.25 / R2);
BINARY_GENERATORS[BIN_CHILD1] = isomFromScaleShift(0.5, 0.25 / R2);
BINARY_GENERATORS[BIN_PARENT_EVEN] = isomFromScaleShift(2, 0.5 / R2);
BINARY_GENERATORS[BIN_PARENT_ODD] = isomFromScaleShift(2, -0.5 / R2);

// child0 leads to a cell whose longitude is EVEN (2*lon), so the way back from there is the
// even-parity parent step -- and vice versa. This pairing is what claims 5c and 5d verify.
const BINARY_INVERSE = [];
BINARY_INVERSE[BIN_RIGHT] = BIN_LEFT;
BINARY_INVERSE[BIN_LEFT] = BIN_RIGHT;
BINARY_INVERSE[BIN_CHILD0] = BIN_PARENT_EVEN;
BINARY_INVERSE[BIN_CHILD1] = BIN_PARENT_ODD;
BINARY_INVERSE[BIN_PARENT_EVEN] = BIN_CHILD0;
BINARY_INVERSE[BIN_PARENT_ODD] = BIN_CHILD1;

// Painter's order for unclipped art, as a three-character code.
//
// Without `clip`, neighboring cells' art overlaps on purpose -- the dungeon's floor plates span the
// corner where four cells meet and its doors cross cell boundaries -- so WHICH cell paints last decides
// what you see at every seam. The atlas's own walk order is nearest-first from the camera, which is
// fine for culling but is camera-dependent: pan a little and two overlapping cells can swap, so seams
// flip as you move. Sorting by the ADDRESS instead is stable, because addresses are exact BigInts and
// the relative order of any two cells never changes.
//
//   character 1  'H' sorts by longitude first, 'V' by latitude first
//   character 2  the direction of that first key:  '>' increasing, '<' decreasing
//   character 3  the direction of the second key:  '>' increasing, '<' decreasing
//
// So all eight are "H>>", "H><", "H<>", "H<<", "V>>", "V><", "V<>", "V<<". Later in the order paints
// later, i.e. on top.
function binaryDrawOrder(code) {
  const m = /^([HV])([<>])([<>])$/.exec(String(code));
  if (!m) {
    throw new Error(
      `hyperbolic-map: drawOrder must be one of H>> H>< H<> H<< V>> V>< V<> V<<, got ${JSON.stringify(code)}`,
    );
  }
  const latFirst = m[1] === "V";
  const firstSign = m[2] === ">" ? 1 : -1;
  const secondSign = m[3] === ">" ? 1 : -1;
  const latSign = latFirst ? firstSign : secondSign;
  const lonSign = latFirst ? secondSign : firstSign;
  // BigInt comparison, so this stays exact at any depth -- a float64 longitude would start tying
  // distinct cells together about fifty levels down, and ties here mean an arbitrary paint order.
  return (a, b) => {
    const p = latFirst
      ? [a.address.lat, b.address.lat, latSign]
      : [a.address.lon, b.address.lon, lonSign];
    if (p[0] !== p[1]) return p[0] < p[1] ? -p[2] : p[2];
    const s = latFirst
      ? [a.address.lon, b.address.lon, lonSign]
      : [a.address.lat, b.address.lat, latSign];
    if (s[0] !== s[1]) return s[0] < s[1] ? -s[2] : s[2];
    return 0;
  };
}

class BinaryTiling {
  constructor(options) {
    // `drawOrder` only matters when the atlas is NOT clipping; with clipping there is no overlap to
    // resolve. Default null = the atlas's own nearest-first walk order, which is what this tiling did
    // before the option existed, so no existing page changes appearance by accident.
    const { drawOrder = null } = options || {};
    this.drawOrder = drawOrder;
    this.compareForDrawing = drawOrder === null ? null : binaryDrawOrder(drawOrder);

    // Center spacing: the distance between a cell's center and its lateral neighbor's, used to size
    // the walk radius. Measured from the generator rather than asserted.
    const g = BINARY_GENERATORS[BIN_RIGHT];
    this.metrics = {
      centerSpacing: 2 * Math.asinh(Math.hypot(g.br, g.bi)),
      // A cell's own extent, playing the role of a circumradius: the farthest corner of the local box.
      circumradius: (() => {
        let worst = 0;
        for (const hx of [-BINARY_LOCAL_HALF_WIDTH, BINARY_LOCAL_HALF_WIDTH]) {
          for (const hy of [BINARY_LOCAL_Y_LOW, BINARY_LOCAL_Y_HIGH]) {
            const l = halfPlaneToLocal(hx, hy, [0, 0]);
            worst = Math.max(worst, 2 * Math.asinh(Math.hypot(l[0], l[1])));
          }
        }
        return worst;
      })(),
    };
    // The stabilizer is TRIVIAL: a binary cell's frame is z -> S z + T in the half-plane, and no
    // non-identity element of the walk group fixes a cell. So a cell's frame is unique, its address is
    // unique, and tile art here is under NO symmetry constraint -- any asymmetric art is fine, and art
    // may differ from cell to cell. This is why the binary tiling scrolls smoothly with artwork that
    // would tear a {p,q} tiling apart, and it is the reason the dungeon demo can put a different room in
    // every cell.
    this.stabilizerOrder = 1;
    this.selfRotation = Isom.identity();
    // No homomorphism needed: (lat, lon) is canonical, so a caller may key art on the ADDRESS itself and
    // give every cell something different. `classModulus` exists only to keep the tile object uniform.
    this.classModulus = 1;
    // Nor a color symmetry, for the same reason and one more: a color symmetry earns its keep by
    // permuting art that repeats, and nothing here has to repeat. Present so the tile object is uniform.
    this.colorCount = 1;
  }

  tileClass() {
    return 0;
  }

  colorPermutation() {
    return null;
  }

  colorIndex() {
    return 0;
  }

  // ---- addressing ----
  //
  // BigInt, because descending one latitude DOUBLES the longitude index: fifty descents pass 2^50 and
  // a float64 longitude stops being exact. Addresses are identity only and never enter the geometry,
  // so BigInt costs nothing on the render path.

  originAddress() {
    return { lat: 0n, lon: 0n };
  }

  addressToString(address) {
    // Memoized on the address object. BigInt toString is not free, and a deep descent makes the
    // longitude very long indeed.
    if (address.str === undefined || address.str === null) {
      address.str = `${address.lat},${address.lon}`;
    }
    return address.str;
  }

  addressKey(address) {
    return this.addressToString(address);
  }

  addressEquals(a, b) {
    return a.lat === b.lat && a.lon === b.lon;
  }

  // Which generators lead out of this cell, WITHOUT building any of the neighbors. See the note on
  // RegularTiling.neighborGens. The parent step is the one that varies: a cell offers PARENT_EVEN or
  // PARENT_ODD according to its own longitude parity, never both.
  neighborGens(address) {
    const even = (address.lon & 1n) === 0n;
    return [BIN_RIGHT, BIN_LEFT, BIN_CHILD0, BIN_CHILD1, even ? BIN_PARENT_EVEN : BIN_PARENT_ODD];
  }

  // The neighbor reached by one generator. Same arithmetic as `neighbors`, one entry at a time, so a
  // caller that has already decided which way it is going does not build the other four.
  //
  // A cell has only ONE parent, and which of PARENT_EVEN / PARENT_ODD names it depends on the cell's
  // own longitude parity. Asking for the wrong one is a caller error rather than a different cell:
  // saying PARENT_EVEN from an odd-longitude cell once made the camera unable to move up at all, and it
  // then chased downward until the latitude ran to several hundred digits. So it throws.
  extendAddress(address, gen) {
    const { lat, lon } = address;
    const even = (lon & 1n) === 0n;
    switch (gen) {
      case BIN_RIGHT: return { lat, lon: lon + 1n };
      case BIN_LEFT: return { lat, lon: lon - 1n };
      case BIN_CHILD0: return { lat: lat - 1n, lon: lon * 2n };
      case BIN_CHILD1: return { lat: lat - 1n, lon: lon * 2n + 1n };
      case BIN_PARENT_EVEN:
      case BIN_PARENT_ODD: {
        if ((gen === BIN_PARENT_EVEN) !== even) {
          throw new Error(
            `hyperbolic-map: cell (${lat},${lon}) has longitude parity ${even ? "even" : "odd"}, so its ` +
              `parent is reached by ${even ? "BIN_PARENT_EVEN" : "BIN_PARENT_ODD"}, not generator ${gen}`,
          );
        }
        // Floor division: BigInt / truncates toward zero, so -1n/2n is 0n where the parent of cell -1
        // must be cell -1. Off-by-one here would break the western hemisphere only.
        return { lat: lat + 1n, lon: lon >= 0n ? lon / 2n : -((-lon + 1n) / 2n) };
      }
      default:
        throw new Error(`hyperbolic-map: unknown binary generator ${gen}`);
    }
  }

  // The ORDER of this list is part of the contract: `stepToward` returns an index into it.
  neighbors(address) {
    const { lat, lon } = address;
    // Floor division for negative longitudes: BigInt / truncates toward zero, so -1n/2n is 0n where
    // the parent of cell -1 must be cell -1. Off-by-one here would break the western hemisphere only,
    // which is precisely the kind of asymmetry a diagnostic with hashed colors makes obvious.
    const half = lon >= 0n ? lon / 2n : -((-lon + 1n) / 2n);
    const even = (lon & 1n) === 0n;
    return [
      { address: { lat, lon: lon + 1n }, gen: BIN_RIGHT },
      { address: { lat, lon: lon - 1n }, gen: BIN_LEFT },
      { address: { lat: lat - 1n, lon: lon * 2n }, gen: BIN_CHILD0 },
      { address: { lat: lat - 1n, lon: lon * 2n + 1n }, gen: BIN_CHILD1 },
      { address: { lat: lat + 1n, lon: half }, gen: even ? BIN_PARENT_EVEN : BIN_PARENT_ODD },
    ];
  }

  generator(i) {
    return BINARY_GENERATORS[i];
  }

  inverseGenerator(i) {
    return BINARY_INVERSE[i];
  }

  // No stabilizer, so no frame correction, so stepping back really is the inverse generator. Present
  // so a caller can walk back on either tiling without asking which one it has.
  //
  // The one wrinkle is the parent step's two parities: PARENT_EVEN and PARENT_ODD are inverse to
  // CHILD0 and CHILD1 respectively, and a cell offers only the one that matches its own longitude, so
  // callers must still look the returned index up in `neighbors` rather than assume it is present.
  reverseGenerator(address, gen) {
    return BINARY_INVERSE[gen];
  }

  // The stabilizer is trivial here, so a cell's frame is unique and the walk step is just the
  // generator -- no canonical correction exists to fold in. Present so the walk can call the same
  // method on either tiling.
  stepFrame(address, gen) {
    return BINARY_GENERATORS[gen];
  }

  generatorCount() {
    return BINARY_GENERATORS.length;
  }

  // ---- geometry ----

  // The cell is exactly its local half-plane box, so membership is two comparisons after one stable
  // conversion. Not a Voronoi test: binary cells are not the Voronoi cells of their centers, which is
  // why this cannot share the regular tiling's implementation.
  containsLocal(x, y, tol = 0) {
    const hp = localToHalfPlane(x, y, [0, 0]);
    if (!(hp[1] > 0) || !Number.isFinite(hp[0])) return false;
    return (
      hp[0] >= -BINARY_LOCAL_HALF_WIDTH - tol &&
      hp[0] <= BINARY_LOCAL_HALF_WIDTH + tol &&
      hp[1] >= BINARY_LOCAL_Y_LOW - tol &&
      hp[1] <= BINARY_LOCAL_Y_HIGH + tol
    );
  }

  // Which neighbor to move to, to get closer to containing this tile-local point? Returns an INDEX
  // INTO `neighbors(address)` -- see the note on RegularTiling.stepToward for why an index and not a
  // generator -- or -1 if the point is inside.
  //
  // The binary cell is a BOX in its own half-plane, so this reads the box test directly and is exact.
  // It cannot be done with the regular tiling's nearest-center rule, because binary cells are NOT the
  // Voronoi cells of their centers -- and mixing the two rules made the descent CYCLE: measured, 500
  // small camera moves cost 143,407 re-anchor steps (hitting the iteration cap every time) where a
  // regular tiling needed 28.
  //
  // Order matters for termination. Lateral steps first: each shifts x by exactly the cell width, so
  // |x| strictly decreases and the horizontal part finishes. Only then move vertically, where each step
  // halves or doubles the scale and so converges geometrically. A vertical step can put x out of range
  // again, and the next iteration fixes it laterally.
  stepToward(x, y) {
    const hp = localToHalfPlane(x, y, [0, 0]);
    const hx = hp[0];
    const hy = hp[1];
    if (!(hy > 0) || !Number.isFinite(hx)) return -1;
    // Indices into the list `neighbors()` builds: 0 right, 1 left, 2 child0, 3 child1, 4 parent.
    if (hx < -BINARY_LOCAL_HALF_WIDTH) return 1;
    if (hx > BINARY_LOCAL_HALF_WIDTH) return 0;
    if (hy < BINARY_LOCAL_Y_LOW) return hx < 0 ? 2 : 3;
    if (hy > BINARY_LOCAL_Y_HIGH) return 4;
    return -1;
  }

  boundaryLocal() {
    return {
      kind: "binary-cell",
      halfWidth: BINARY_LOCAL_HALF_WIDTH,
      yLow: BINARY_LOCAL_Y_LOW,
      yHigh: BINARY_LOCAL_Y_HIGH,
    };
  }

  // Point -> cell, in WORLD half-plane coordinates. Diagnostic and data-preparation use only: it
  // needs absolute coordinates by definition, so it is not on the render path.
  locateHalfPlaneForTesting(hx, hy) {
    const lat = Math.floor(Math.log2(hy));
    const lon = Math.floor(hx * Math.pow(2, -lat));
    return { lat: BigInt(lat), lon: BigInt(lon) };
  }

  // DIAGNOSTIC ONLY -- the global frame, entries of order cosh(d/2) (1.08e75 at cell (500, 0)).
  // See RegularTiling.globalFrameForTesting.
  globalFrameForTesting(address) {
    const lat = Number(address.lat);
    const lon = Number(address.lon);
    return isomFromScaleShift(Math.pow(2, lat + 0.5), (lon + 0.5) * Math.pow(2, lat));
  }
}

// ===== src/index.js =====
// hyperbolic-map -- public surface.
//
// This file is a barrel: it only re-exports. dev/build.mjs uses the names imported here to decide
// what the browser bundle exposes on the global `HyperbolicMap` object, so anything intended to be
// public must be listed here.
//
// Imports must stay one-per-line and single-line (see dev/check-bundle.mjs): the builder strips
// import lines individually, so a multi-line import would leave fragments behind.

// The exact machinery behind canonical tile ids. Not needed to USE a tiling -- an id is just the string
// `addressToString` hands you -- but exported so that the claim can be checked from outside: build the
// Coxeter group for any {p,q} and see that the relations hold, or watch `exactMulCount` stay flat across
// a rendered frame, which is the assertion that no exact arithmetic happens per frame.

global.HyperbolicMap = {
  VERSION: VERSION,
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
  DEFAULT_STYLE: DEFAULT_STYLE,
  StaticSource: StaticSource,
  CallbackSource: CallbackSource,
  Renderer: Renderer,
  Surface: Surface,
  PointerInput: PointerInput,
  clampToRadius: clampToRadius,
  geodesicArc: geodesicArc,
  Arc: Arc,
  Atlas: Atlas,
  CLIP_AUTO: CLIP_AUTO,
  CLIP_ALWAYS: CLIP_ALWAYS,
  CLIP_NEVER: CLIP_NEVER,
  Anchor: Anchor,
  RegularTiling: RegularTiling,
  BinaryTiling: BinaryTiling,
  binaryDrawOrder: binaryDrawOrder,
  regularMetrics: regularMetrics,
  BINARY_LOCAL_HALF_WIDTH: BINARY_LOCAL_HALF_WIDTH,
  BINARY_LOCAL_Y_LOW: BINARY_LOCAL_Y_LOW,
  BINARY_LOCAL_Y_HIGH: BINARY_LOCAL_Y_HIGH,
  BIN_RIGHT: BIN_RIGHT,
  BIN_LEFT: BIN_LEFT,
  BIN_CHILD0: BIN_CHILD0,
  BIN_CHILD1: BIN_CHILD1,
  BIN_PARENT_EVEN: BIN_PARENT_EVEN,
  BIN_PARENT_ODD: BIN_PARENT_ODD,
  ExactRing: ExactRing,
  minPolyFor2Cos: minPolyFor2Cos,
  exactMulCount: exactMulCount,
  resetExactMulCount: resetExactMulCount,
  buildExactCoxeter: buildExactCoxeter,
  serializeExactVector: serializeExactVector,
};
})(typeof globalThis !== "undefined" ? globalThis : self);
