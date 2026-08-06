// Verbatim ports of the 2011 formulas, used as a differential-test oracle.
//
// This is NOT library code and is never shipped. Its whole purpose is to let the tests prove that
// the rewrite is behaviour-preserving rather than merely plausible. Translated line-for-line from
// OLD/hyperbolic-storage-space/WebContent/HyperbolicViewport.js and
// OLD/hyperbolic-storage-space/src/org/hyperbolicstorage/GeographicalTiles.java, defects included.
//
// Do not "clean up" anything in this file. Its value is that it is unfaithful to nothing.

// HyperbolicViewport.js:3-23
export function halfPlane_to_hyperShadow(x, y) {
  const sqrtplus = Math.sqrt(x * x + y * y + 2.0 * y + 1.0);
  const sqrtminus = Math.sqrt(x * x + y * y - 2.0 * y + 1.0);
  const sinheta =
    Math.sqrt((sqrtplus + sqrtminus) / (sqrtplus - sqrtminus)) / 2.0 -
    Math.sqrt((sqrtplus - sqrtminus) / (sqrtminus + sqrtplus)) / 2.0;

  const denom = Math.sqrt(Math.pow(2.0 * x, 2) + Math.pow(x * x + y * y - 1.0, 2));
  let cosphi;
  let sinphi;
  if (x === 0.0 && y === 1.0) {
    cosphi = 0.0;
    sinphi = 1.0;
  } else {
    cosphi = (2.0 * x) / denom;
    sinphi = (x * x + y * y - 1.0) / denom;
  }

  return [sinheta * cosphi, sinheta * sinphi];
}

// GeographicalTiles.java:75-81
export function hyperShadow_to_halfPlane(px, py) {
  const pone = Math.sqrt(px * px + py * py + 1.0);
  const denom = 2.0 * (px * px + py * py) + 1.0 - 2.0 * py * pone;
  return [(2.0 * px * pone) / denom, 1.0 / denom];
}

// HyperbolicViewport.js:557-570. `rotationCosNow`/`rotationSinNow` are passed explicitly here.
export function internalToScreen(preal, pimag, offsetReal, offsetImag, rotation) {
  const pone = Math.sqrt(1.0 + preal * preal + pimag * pimag);
  const Br = offsetReal;
  const Bi = offsetImag;
  const bone = Math.sqrt(1.0 + Br * Br + Bi * Bi);
  let real =
    -Bi * Bi * preal * pone +
    2.0 * Bi * Br * pimag * pone +
    Br * Br * preal * pone +
    Br * pimag * pimag * bone +
    Br * preal * preal * bone +
    Br * bone * (pimag * pimag + preal * preal + 1.0) +
    preal * (Bi * Bi + Br * Br + 1.0) * pone;
  let imag =
    Bi * Bi * pimag * pone +
    2.0 * Bi * Br * preal * pone +
    Bi * pimag * pimag * bone +
    Bi * preal * preal * bone +
    Bi * bone * (pimag * pimag + preal * preal + 1.0) -
    Br * Br * pimag * pone +
    pimag * (Bi * Bi + Br * Br + 1.0) * pone;
  const denom =
    Bi * Bi * pimag * pimag +
    Bi * Bi * preal * preal +
    2.0 * Bi * pimag * bone * pone +
    Br * Br * pimag * pimag +
    Br * Br * preal * preal +
    2.0 * Br * preal * bone * pone +
    (Bi * Bi + Br * Br + 1.0) * (pimag * pimag + preal * preal + 1.0);

  real /= denom;
  imag /= denom;

  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  return [c * real - s * imag, c * imag + s * real];
}

// HyperbolicViewport.js:607-635.
//
// Semantic trap, recorded in notes/legacy-decoded.md: (Pr, Pi) is the mousedown position expressed
// in the VIEW frame (screen disk coordinate divided by sqrt(1 - r^2)), NOT the data point under the
// cursor. (Fr, Fi) is the current cursor position in screen disk coordinates. (Br, Bi) and
// (Rr, Ri) are the COMMITTED offset and rotation.
export function updateCoordinates(Br, Bi, Fr, Fi, Pr, Pi, Rr, Ri) {
  const pone = Math.sqrt(Pr * Pr + Pi * Pi + 1.0);

  let dBr =
    (-(Fi * Pr + Fr * Pi) *
      (-Fi * pone + Pi - ((Fi * Pr + Fr * Pi) * (-Fr * pone + Pr)) / (-Fi * Pi + Fr * Pr - pone))) /
      ((-Fi * Pi + Fr * Pr - pone) *
        (Fi * Pi -
          Fr * Pr -
          ((Fi * Pr + Fr * Pi) * (Fi * Pr + Fr * Pi)) / (-Fi * Pi + Fr * Pr - pone) -
          pone)) +
    (-Fr * pone + Pr) / (-Fi * Pi + Fr * Pr - pone);
  let dBi =
    (-Fi * pone + Pi - ((Fi * Pr + Fr * Pi) * (-Fr * pone + Pr)) / (-Fi * Pi + Fr * Pr - pone)) /
    (Fi * Pi -
      Fr * Pr -
      ((Fi * Pr + Fr * Pi) * (Fi * Pr + Fr * Pi)) / (-Fi * Pi + Fr * Pr - pone) -
      pone);

  const dBoneMinus = Math.sqrt(1.0 - dBr * dBr - dBi * dBi);
  dBr = dBr / dBoneMinus;
  dBi = dBi / dBoneMinus;

  const dBone = Math.sqrt(1.0 + dBr * dBr + dBi * dBi);
  const Bone = Math.sqrt(1.0 + Br * Br + Bi * Bi);

  let real =
    -Bi * Bi * Ri * dBi * dBone -
    Bi * Bi * Rr * dBr * dBone -
    2.0 * Bi * Br * Ri * dBr * dBone +
    2.0 * Bi * Br * Rr * dBi * dBone +
    Br * Br * Ri * dBi * dBone +
    Br * Br * Rr * dBr * dBone +
    Br * Ri * Ri * Bone * dBone * dBone +
    Br * Rr * Rr * Bone * dBone * dBone +
    Br * dBi * dBi * Bone +
    Br * dBr * dBr * Bone +
    Ri * dBi * Bone * Bone * dBone +
    Rr * dBr * Bone * Bone * dBone;
  let imag =
    -Bi * Bi * Ri * dBr * dBone +
    Bi * Bi * Rr * dBi * dBone +
    2.0 * Bi * Br * Ri * dBi * dBone +
    2.0 * Bi * Br * Rr * dBr * dBone +
    Bi * Ri * Ri * Bone * dBone * dBone +
    Bi * Rr * Rr * Bone * dBone * dBone +
    Bi * dBi * dBi * Bone +
    Bi * dBr * dBr * Bone +
    Br * Br * Ri * dBr * dBone -
    Br * Br * Rr * dBi * dBone -
    Ri * dBr * Bone * Bone * dBone +
    Rr * dBi * Bone * Bone * dBone;
  let denom =
    Bi * Bi * dBi * dBi +
    Bi * Bi * dBr * dBr -
    2.0 * Bi * Ri * dBr * Bone * dBone +
    2.0 * Bi * Rr * dBi * Bone * dBone +
    Br * Br * dBi * dBi +
    Br * Br * dBr * dBr +
    2.0 * Br * Ri * dBi * Bone * dBone +
    2.0 * Br * Rr * dBr * Bone * dBone +
    Ri * Ri * Bone * Bone * dBone * dBone +
    Rr * Rr * Bone * Bone * dBone * dBone;
  denom = Math.sqrt(denom * denom - real * real - imag * imag);

  const outBr = real / denom;
  const outBi = imag / denom;

  real =
    -2.0 * Bi * Bi * Ri * dBi * dBr +
    Bi * Bi * Rr * dBi * dBi -
    Bi * Bi * Rr * dBr * dBr +
    2.0 * Bi * Br * Ri * dBi * dBi -
    2.0 * Bi * Br * Ri * dBr * dBr +
    4.0 * Bi * Br * Rr * dBi * dBr +
    Bi * Ri * Ri * dBi * Bone * dBone +
    Bi * Rr * Rr * dBi * Bone * dBone +
    Bi * dBi * Bone * dBone +
    2.0 * Br * Br * Ri * dBi * dBr -
    Br * Br * Rr * dBi * dBi +
    Br * Br * Rr * dBr * dBr +
    Br * Ri * Ri * dBr * Bone * dBone +
    Br * Rr * Rr * dBr * Bone * dBone +
    Br * dBr * Bone * dBone +
    Rr * Bone * Bone * dBone * dBone;
  imag =
    -Bi * Bi * Ri * dBi * dBi +
    Bi * Bi * Ri * dBr * dBr -
    2.0 * Bi * Bi * Rr * dBi * dBr -
    4.0 * Bi * Br * Ri * dBi * dBr +
    2.0 * Bi * Br * Rr * dBi * dBi -
    2.0 * Bi * Br * Rr * dBr * dBr -
    Bi * Ri * Ri * dBr * Bone * dBone -
    Bi * Rr * Rr * dBr * Bone * dBone -
    Bi * dBr * Bone * dBone +
    Br * Br * Ri * dBi * dBi -
    Br * Br * Ri * dBr * dBr +
    2.0 * Br * Br * Rr * dBi * dBr +
    Br * Ri * Ri * dBi * Bone * dBone +
    Br * Rr * Rr * dBi * Bone * dBone +
    Br * dBi * Bone * dBone +
    Ri * Bone * Bone * dBone * dBone;

  return [outBr, outBi, Math.atan2(imag, real)];
}

// HyperbolicViewport.js:572-605. `rotation` stands in for rotationCosNow/rotationSinNow.
export function halfPlaneOrientation(offsetReal, offsetImag, rotation, a = 0.5) {
  const Bone = Math.sqrt(1.0 + offsetReal * offsetReal + offsetImag * offsetImag);
  const Br = offsetReal / Bone;
  const Bi = offsetImag / Bone;
  const pts = [];
  for (const sgn of [1, -1]) {
    const p = Math.atan2(sgn * (Bi * Bi + 2 * Bi - Br * Br + 1), sgn * (2 * Bi * Br + 2 * Br));
    const d =
      Bi * Bi * a * a - 2 * Bi * Bi * a * Math.sin(p) + Bi * Bi - 4 * Bi * Br * a * Math.cos(p) +
      2 * Bi * a * a - 4 * Bi * a * Math.sin(p) + 2 * Bi + Br * Br * a * a +
      2 * Br * Br * a * Math.sin(p) + Br * Br - 4 * Br * a * Math.cos(p) + a * a -
      2 * a * Math.sin(p) + 1;
    const x =
      (-2 * Bi * Bi * a * Math.cos(p) + 4 * Bi * Br * a * Math.sin(p) +
        2 * Br * Br * a * Math.cos(p) - 2 * Br * a * a - 2 * Br + 2 * a * Math.cos(p)) / d;
    const y =
      (Bi * Bi * a * a - Bi * Bi + Br * Br * a * a - Br * Br - a * a + 1) / d;
    const [px, py] = halfPlane_to_hyperShadow(x, y);
    pts.push(internalToScreen(px, py, offsetReal, offsetImag, rotation));
  }
  return Math.atan2(pts[0][1] - pts[1][1], pts[0][0] - pts[1][0]);
}

// GeographicalTiles.java:90-112
export function centralCircle(offsetx, offsety, a) {
  const Bone = Math.sqrt(1.0 + offsetx * offsetx + offsety * offsety);
  const Br = offsetx / Bone;
  const Bi = offsety / Bone;
  const pts = [];
  for (const sgn of [1, -1]) {
    const p = Math.atan2(sgn * (Bi * Bi + 2 * Bi - Br * Br + 1), sgn * (2 * Bi * Br + 2 * Br));
    const d =
      Bi * Bi * a * a - 2 * Bi * Bi * a * Math.sin(p) + Bi * Bi - 4 * Bi * Br * a * Math.cos(p) +
      2 * Bi * a * a - 4 * Bi * a * Math.sin(p) + 2 * Bi + Br * Br * a * a +
      2 * Br * Br * a * Math.sin(p) + Br * Br - 4 * Br * a * Math.cos(p) + a * a -
      2 * a * Math.sin(p) + 1;
    const x =
      (-2 * Bi * Bi * a * Math.cos(p) + 4 * Bi * Br * a * Math.sin(p) +
        2 * Br * Br * a * Math.cos(p) - 2 * Br * a * a - 2 * Br + 2 * a * Math.cos(p)) / d;
    const y = (Bi * Bi * a * a - Bi * Bi + Br * Br * a * a - Br * Br - a * a + 1) / d;
    pts.push([x, y]);
  }
  return {
    centerx: (pts[0][0] + pts[1][0]) / 2.0,
    centery: (pts[0][1] + pts[1][1]) / 2.0,
    radius: Math.abs(pts[1][1] - pts[0][1]) / 2.0,
  };
}

// GeographicalTiles.java:83-88
export function tileIndex(hx, hy) {
  const latitude = Math.floor(Math.log(hy) / Math.LN2);
  const longitude = Math.floor(hx * Math.pow(2, -latitude));
  return [latitude, longitude];
}

// GeographicalTiles.java:124-137 -- retains the band-bottom defect.
export function longitudeRange(circle, latitude) {
  const y = Math.pow(2, latitude);
  let discr = Math.pow(circle.radius, 2) - Math.pow(y - circle.centery, 2);
  if (discr <= 0) return null;
  discr = Math.sqrt(discr);
  return [Math.floor((circle.centerx - discr) / y), Math.ceil((circle.centerx + discr) / y)];
}

// ---- independent oracles, NOT ports: used to judge the ports ----

// Hyperbolic distance in the Poincare disk. Cross-validated during the audit against the
// hyperboloid inner product and the half-plane formula (agreement 8.2e-13).
export function diskDistance(z1x, z1y, z2x, z2y) {
  const dx = z1x - z2x;
  const dy = z1y - z2y;
  // 1 - conj(z2) z1
  const cr = 1 - (z2x * z1x + z2y * z1y);
  const ci = -(z2x * z1y - z2y * z1x);
  const t = Math.hypot(dx, dy) / Math.hypot(cr, ci);
  return 2 * Math.atanh(Math.min(t, 1 - 1e-16));
}

// The half-plane -> disk map this project uses, stated directly: z -> i (z - i) / (z + i).
export function halfPlaneToDiskDirect(hx, hy) {
  // (z - i) / (z + i)
  const nr = hx;
  const ni = hy - 1;
  const dr = hx;
  const di = hy + 1;
  const dd = dr * dr + di * di;
  const qr = (nr * dr + ni * di) / dd;
  const qi = (ni * dr - nr * di) / dd;
  // times i
  return [-qi, qr];
}

export function diskToHalfPlaneDirect(zx, zy) {
  // w = (1 - i z) / (z - i)
  const nr = 1 + zy;
  const ni = -zx;
  const dr = zx;
  const di = zy - 1;
  const dd = dr * dr + di * di;
  return [(nr * dr + ni * di) / dd, (ni * dr - nr * di) / dd];
}
