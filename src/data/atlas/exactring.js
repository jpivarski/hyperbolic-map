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

export function exactMulCount() {
  return ringMulCount;
}

export function resetExactMulCount() {
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
export function minPolyFor2Cos(N) {
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

// An element is a plain array of `deg` BigInts, ALWAYS fully reduced. There is no division anywhere
// in this ring -- the minimal polynomial is monic, so reduction is repeated subtraction of a shifted
// multiple. Needing a denominator would mean a formula is wrong.
export class ExactRing {
  constructor(N) {
    this.N = N;
    this.poly = minPolyFor2Cos(N);
    this.deg = this.poly.length - 1;
    this.muFloat = 2 * Math.cos(Math.PI / N);
  }

  zero() {
    return new Array(this.deg).fill(0n);
  }

  one() {
    const v = this.zero();
    v[0] = 1n;
    return v;
  }

  fromInt(k) {
    const v = this.zero();
    v[0] = BigInt(k);
    return v;
  }

  // mu itself. For deg 1 the ring is just Z and mu is the rational root: x + poly[0] = 0.
  mu() {
    if (this.deg === 1) return [-this.poly[0]];
    const v = this.zero();
    v[1] = 1n;
    return v;
  }

  // Reduce a raw convolution (length up to 2*deg-1) modulo the minimal polynomial.
  reduce(raw) {
    const c = raw.slice();
    for (let i = c.length - 1; i >= this.deg; i--) {
      const f = c[i];
      if (f === 0n) continue;
      c[i] = 0n;
      for (let j = 0; j < this.deg; j++) c[i - this.deg + j] -= f * this.poly[j];
    }
    const out = new Array(this.deg);
    for (let i = 0; i < this.deg; i++) out[i] = c[i] === undefined ? 0n : c[i] + 0n;
    return out;
  }

  add(a, b) {
    const out = new Array(this.deg);
    for (let i = 0; i < this.deg; i++) out[i] = a[i] + b[i];
    return out;
  }

  sub(a, b) {
    const out = new Array(this.deg);
    for (let i = 0; i < this.deg; i++) out[i] = a[i] - b[i];
    return out;
  }

  neg(a) {
    const out = new Array(this.deg);
    for (let i = 0; i < this.deg; i++) out[i] = -a[i];
    return out;
  }

  mul(a, b) {
    ringMulCount++;
    const raw = new Array(2 * this.deg - 1).fill(0n);
    for (let i = 0; i < this.deg; i++) {
      if (a[i] === 0n) continue;
      for (let j = 0; j < this.deg; j++) {
        if (b[j] !== 0n) raw[i + j] += a[i] * b[j];
      }
    }
    return this.reduce(raw);
  }

  isZero(a) {
    for (let i = 0; i < this.deg; i++) {
      if (a[i] !== 0n) return false;
    }
    return true;
  }

  equals(a, b) {
    for (let i = 0; i < this.deg; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  // A TOTAL ORDER on ring elements. This is not a mathematical order (the ring is not ordered in any
  // way that respects the arithmetic) -- it is an arbitrary but FIXED tie-break, and it is what
  // decides which member of a tile's coset becomes the canonical one. Changing it silently renames
  // every id in every user cache, so it is fixed forever: lowest coefficient first.
  cmp(a, b) {
    for (let i = 0; i < this.deg; i++) {
      if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    }
    return 0;
  }

  // D_k(mu) = 2*cos(k*pi/N), as a ring element.
  dicksonOfMu(k) {
    if (k === 0) return this.fromInt(2);
    let prev = this.fromInt(2);
    let cur = this.mu();
    for (let i = 2; i <= k; i++) {
      const next = this.sub(this.mul(this.mu(), cur), prev);
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
  serialize(a) {
    let s = "";
    for (let i = 0; i < this.deg; i++) {
      if (i) s += ",";
      s += (a[i] === 0n ? 0n : a[i]).toString();
    }
    return s;
  }
}
