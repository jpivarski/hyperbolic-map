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

import { localCompanion } from "./isom.js";

export function localToDisk(x, y, out) {
  const w = localCompanion(x, y);
  out[0] = x / w;
  out[1] = y / w;
  return out;
}

export function diskToLocal(zx, zy, out) {
  const k = 1 / Math.sqrt(1 - zx * zx - zy * zy);
  out[0] = zx * k;
  out[1] = zy * k;
  return out;
}

// Hyperbolic distance from the origin to a point given in local coordinates.
export function localRadiusToDistance(r) {
  return 2 * Math.asinh(r);
}

export function distanceToLocalRadius(d) {
  return Math.sinh(d / 2);
}

// Hyperbolic distance between two points given in local coordinates.
//
// cosh(d/2) = |w1 w2 - conj(zeta1) zeta2|  -- the MODULUS of a complex quantity. Taking only the
// real part is wrong (see notes/math-audit.md); it under-estimates the distance by up to 19.6.
export function localDistance(x1, y1, x2, y2) {
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
export function halfPlaneToLocal(px, py, out) {
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
export function localToHalfPlane(px, py, out) {
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
