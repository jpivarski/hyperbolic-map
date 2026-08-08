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

import { exactMatMul, exactMatPow, exactMatVec, exactIdentity, exactBilinear, exactDet3 } from "./exactcoxeter.js";

// A float map from the exact hyperboloid model to the Poincare disk, pinned to the library's frame:
// the tile centre at the origin, the edge-0 midpoint on the +x axis, vertex 0 at angle +pi/p.
export function buildIntertwiner(cx) {
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
export function matchGenerators(cx, generators, p, m, tol) {
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
// tile centre; whether that reads as Isom.rotation(+2pi/m) or (-2pi/m) depends on conventions this
// file refuses to guess. Returns +1 or -1.
export function calibrateSpin(cx, inter, P, m, Isom, tol) {
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
export function checkMultiplyOrder(cx, inter, exactA, exactB, isomA, isomB, tol) {
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
// This replaced an earlier version that transported a probe point at radius 0.5 back through the
// translation and read the angle there. That is the same decomposition done the expensive way: the
// probe lands within 1e-9 of the boundary and coming back cancels cosh(d)-sized quantities, which cost
// eight digits by d = 7 and made the re-anchoring identity test fail on its own measuring instrument.
//
// Row 0 degenerates when the translation part is small (it is all sinh d), so near d = 0 psi comes
// instead from row 2 of Rot(-alpha).L, which is (0, sin psi, cos psi) for ANY alpha when d = 0 -- so
// the meaningless alpha that atan2 returns there cancels out of theta = alpha + psi.
export function exactToIsom(inter, M, Isom, movePointToPoint) {
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
  // 1e30: pure noise, with a sign that flips at random. The first version of this guard rejected
  // perfectly good frames for exactly that reason.
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
  // renormalisation, which is exactly why it does not have this problem. But a caller converting a
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
