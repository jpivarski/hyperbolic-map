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

// ---- half-plane <-> local (CHECKPOINT A: faithful 2011 ports, defects included) ----

export function halfPlaneToLocal(px, py, out) {
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

export function localToHalfPlane(px, py, out) {
  const w = Math.sqrt(px * px + py * py + 1.0);
  const denom = 2.0 * (px * px + py * py) + 1.0 - 2.0 * py * w;
  out[0] = (2.0 * px * w) / denom;
  out[1] = 1.0 / denom;
  return out;
}
