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
export function localCompanion(x, y) {
  return Math.sqrt(1 + x * x + y * y);
}

export class Isom {
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
export function movePointToPoint(px, py, fx, fy) {
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
