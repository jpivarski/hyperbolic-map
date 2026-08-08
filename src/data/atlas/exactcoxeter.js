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
//     mirror a = the x-axis                  (through the centre O and the edge-0 midpoint M)
//     mirror b = the line at angle pi/p      (through O and vertex V0)
//     mirror c = the edge-0 geodesic         (through M and V0)
//
// with m(a,b) = p, m(b,c) = q, m(a,c) = 2.
//
// Composition is matrix product = apply the RIGHTMOST first, which is the same convention as
// Isom.mul. That is asserted rather than assumed; see the calibration in exactcalib.js.

import { ExactRing } from "./exactring.js";

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

export function exactIdentity(R) {
  return [
    [R.one(), R.zero(), R.zero()],
    [R.zero(), R.one(), R.zero()],
    [R.zero(), R.zero(), R.one()],
  ];
}

export function exactMatMul(R, A, B) {
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

export function exactMatVec(R, A, v) {
  const out = [];
  for (let i = 0; i < 3; i++) {
    out.push(R.add(R.add(R.mul(A[i][0], v[0]), R.mul(A[i][1], v[1])), R.mul(A[i][2], v[2])));
  }
  return out;
}

export function exactMatPow(R, A, n) {
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

export function exactMatEquals(R, A, B) {
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
export function exactDet3(R, A) {
  const t = (i, j, k, l) => R.sub(R.mul(A[i][j], A[k][l]), R.mul(A[i][l], A[k][j]));
  return R.add(
    R.sub(R.mul(A[0][0], t(1, 1, 2, 2)), R.mul(A[0][1], t(1, 0, 2, 2))),
    R.mul(A[0][2], t(1, 0, 2, 1)),
  );
}

export function exactInverse3(R, A) {
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
export function serializeExactMatrix(R, A, p, q, m) {
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
// The id is the serialized TILE CENTRE v = F.v_O, not the whole frame F. Three ring elements instead
// of nine is a third of the memory and a third of the work, and nothing is lost: P fixes v_O, so every
// frame in a tile's coset gives the SAME vector, and distinct tiles have distinct centres. The id is
// therefore canonical automatically -- it does not depend on the coset tie-break at all, which is why
// the round-trip tests below check the canonical FRAME separately rather than inferring it from the id.
export function serializeExactVector(R, v, p, q, m) {
  return `${p},${q},${m}|${R.serialize(v[0])};${R.serialize(v[1])};${R.serialize(v[2])}`;
}

// Everything exact about one {p,q}: the ring, the mirrors, the special points, and the rotations.
export function buildExactCoxeter(p, q) {
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

  // rho = Sb.Sa is the rotation by +2*pi/p about the tile centre (counter-clockwise in the disk).
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
export function checkCoxeterRelations(cx) {
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

export function exactVecEquals(R, u, v) {
  return R.equals(u[0], v[0]) && R.equals(u[1], v[1]) && R.equals(u[2], v[2]);
}

export function exactBilinear(R, G, u, v) {
  let s = R.zero();
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) s = R.add(s, R.mul(R.mul(G[i][j], u[i]), v[j]));
  }
  return s;
}
