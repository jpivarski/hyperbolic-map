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
export class ExactRing {
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
