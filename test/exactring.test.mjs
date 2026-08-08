// The exact ring Z[mu], mu = 2*cos(pi/N).
//
// This is the layer identity rests on, so it is tested against closed forms and against floats
// rather than against itself. Every fixture below was derived independently in sympy before the
// implementation existed.

import test from "node:test";
import assert from "node:assert/strict";

import { ExactRing, minPolyFor2Cos, exactMulCount, resetExactMulCount } from "../src/data/atlas/exactring.js";

const polyStr = (c) => c.map((v) => v.toString()).join(",");

test("the minimal polynomial of 2cos(pi/N) matches the closed forms", () => {
  // Low degree first. 2N = 8 -> x^2 - 2 (mu = sqrt 2); 2N = 6 -> x - 1 (mu = 1, the ring is Z).
  const EXPECT = {
    3: "-1,1", //                    x - 1
    4: "-2,0,1", //                  x^2 - 2
    5: "-1,-1,1", //                 x^2 - x - 1
    8: "2,0,-4,0,1", //              x^4 - 4x^2 + 2
    24: "1,0,-16,0,20,0,-8,0,1", //  x^8 - 8x^6 + 20x^4 - 16x^2 + 1
  };
  for (const [N, want] of Object.entries(EXPECT)) {
    assert.equal(polyStr(minPolyFor2Cos(Number(N))), want, `N = ${N}`);
  }
});

test("the minimal polynomial actually annihilates 2cos(pi/N), and is monic", () => {
  // The fixtures above only pin five values; this pins the construction itself over a wide range.
  for (let N = 3; N <= 30; N++) {
    const c = minPolyFor2Cos(N);
    assert.equal(c[c.length - 1], 1n, `N = ${N} not monic`);
    const mu = 2 * Math.cos(Math.PI / N);
    let v = 0;
    for (let i = c.length - 1; i >= 0; i--) v = v * mu + Number(c[i]);
    // Scale the tolerance by the coefficient size: high-degree polynomials have big coefficients and
    // an absolute epsilon would be meaningless.
    const scale = c.reduce((s, x) => s + Math.abs(Number(x)), 0);
    assert.ok(Math.abs(v) < 1e-9 * Math.max(1, scale), `N = ${N}: C(mu) = ${v}`);
  }
});

test("ring degree is phi(2N)/2, and the n=3 shortcut is what makes {8,3} cheap", () => {
  const totient = (n) => {
    let r = n;
    for (let f = 2; f * f <= n; f++) {
      if (n % f === 0) {
        while (n % f === 0) n /= f;
        r -= r / f;
      }
    }
    if (n > 1) r -= r / n;
    return r;
  };
  for (let N = 3; N <= 30; N++) {
    assert.equal(new ExactRing(N).deg, totient(2 * N) / 2, `N = ${N}`);
  }
  // The reason the shortcut is worth taking at all.
  assert.equal(new ExactRing(8).deg, 4, "{8,3} with N = 8");
  assert.equal(new ExactRing(24).deg, 8, "{8,3} without the shortcut, N = lcm(8,3) = 24");
});

test("Dickson gives the right cosine: D_k(mu) = 2cos(k*pi/N)", () => {
  for (const N of [4, 5, 7, 8, 12, 20]) {
    const R = new ExactRing(N);
    for (let k = 0; k <= N; k++) {
      const got = R.toNumber(R.dicksonOfMu(k));
      const want = 2 * Math.cos((k * Math.PI) / N);
      assert.ok(Math.abs(got - want) < 1e-9, `N = ${N}, k = ${k}: ${got} vs ${want}`);
    }
  }
});

test("REGRESSION: lambdaFor(3) is the rational 1, not D_{N/3}(mu)", () => {
  // The trap this method exists for. The Dickson identity needs n | N, but the n = 3 shortcut takes
  // N = p when q = 3, and then 3 does NOT divide N. Written as D_{N/n}(mu) with integer division,
  // {8,3} evaluates D_2(mu) = mu^2 - 2 = sqrt(2) instead of 1, and the Coxeter relations silently
  // fail. Caught by checking the relations for {8,3}, {7,3} and {3,7}; pinned here at the source.
  for (const N of [7, 8, 10, 11]) {
    const R = new ExactRing(N);
    assert.ok(N % 3 !== 0, `N = ${N} must NOT be divisible by 3 for this to be the interesting case`);
    assert.ok(R.equals(R.lambdaFor(3), R.fromInt(1)), `N = ${N}: lambdaFor(3) should be exactly 1`);
    // and the thing it must not be
    const wrong = R.dicksonOfMu(Math.floor(N / 3));
    assert.ok(!R.equals(R.lambdaFor(3), wrong) || Math.abs(R.toNumber(wrong) - 1) < 1e-12,
      `N = ${N}: lambdaFor(3) coincides with the truncated-Dickson answer, so this test proves nothing`);
  }
  // When 3 genuinely divides N the general path is used and must still be right.
  const R9 = new ExactRing(9);
  assert.ok(Math.abs(R9.toNumber(R9.lambdaFor(3)) - 1) < 1e-12);
  assert.ok(Math.abs(R9.toNumber(R9.lambdaFor(9)) - 2 * Math.cos(Math.PI / 9)) < 1e-12);
  // And an inexpressible cosine must throw rather than return something plausible.
  assert.throws(() => new ExactRing(8).lambdaFor(5), /does not divide/);
});

test("arithmetic agrees with float evaluation, and stays reduced", () => {
  const R = new ExactRing(12);
  let s = 1;
  for (let i = 0; i < 500; i++) s = (s * 1103515245 + 12345) % 2147483648;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return BigInt((s % 21) - 10);
  };
  for (let trial = 0; trial < 400; trial++) {
    const a = Array.from({ length: R.deg }, rnd);
    const b = Array.from({ length: R.deg }, rnd);
    for (const [op, f] of [["add", (x, y) => x + y], ["sub", (x, y) => x - y], ["mul", (x, y) => x * y]]) {
      const got = R.toNumber(R[op](a, b));
      const want = f(R.toNumber(a), R.toNumber(b));
      assert.ok(Math.abs(got - want) < 1e-6 * Math.max(1, Math.abs(want)), `${op}: ${got} vs ${want}`);
    }
    // reduced means: exactly `deg` coefficients, and reducing again changes nothing
    const prod = R.mul(a, b);
    assert.equal(prod.length, R.deg);
    assert.deepEqual(R.reduce(prod), prod, "reduction is not idempotent");
  }
});

test("cmp is a strict total order", () => {
  // It decides which coset member becomes canonical, so it has to be a real order: antisymmetric,
  // transitive, and total. A subtly broken comparator would make ids route-dependent again.
  const R = new ExactRing(8);
  let s = 987654321;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return BigInt((s % 7) - 3);
  };
  const xs = Array.from({ length: 60 }, () => Array.from({ length: R.deg }, rnd));
  for (const a of xs) {
    assert.equal(R.cmp(a, a), 0, "not reflexive-zero");
    for (const b of xs) {
      // `=== ` and not assert.equal: Object.is(0, -0) is false, and -cmp(b,a) is -0 when equal.
      assert.ok(R.cmp(a, b) === -R.cmp(b, a), "not antisymmetric");
      assert.equal(R.cmp(a, b) === 0, R.equals(a, b), "cmp and equals disagree");
      for (const c of xs) {
        if (R.cmp(a, b) < 0 && R.cmp(b, c) < 0) assert.ok(R.cmp(a, c) < 0, "not transitive");
      }
    }
  }
  const sorted = xs.slice().sort((a, b) => R.cmp(a, b));
  for (let i = 1; i < sorted.length; i++) assert.ok(R.cmp(sorted[i - 1], sorted[i]) <= 0);
});

test("serialize is injective and stable, and normalizes -0n", () => {
  const R = new ExactRing(8);
  const seen = new Map();
  let s = 4242;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return BigInt((s % 5) - 2);
  };
  for (let i = 0; i < 500; i++) {
    const a = Array.from({ length: R.deg }, rnd);
    const k = R.serialize(a);
    if (seen.has(k)) assert.ok(R.equals(seen.get(k), a), `serialize collision: ${k}`);
    seen.set(k, a);
    assert.equal(R.serialize(a), k, "serialize is not stable");
  }
  const negZero = R.zero();
  negZero[0] = -0n;
  assert.equal(R.serialize(negZero), R.serialize(R.zero()), "-0n must serialize as 0");
});

test("the multiply counter tracks exact work, so 'no BigInt work per frame' is measurable", () => {
  // The instrument the steady-state assertion depends on. If this counter did not move, that
  // assertion would pass trivially.
  const R = new ExactRing(8);
  resetExactMulCount();
  assert.equal(exactMulCount(), 0);
  R.mul(R.mu(), R.mu());
  assert.equal(exactMulCount(), 1);
  R.add(R.mu(), R.mu());
  R.sub(R.mu(), R.mu());
  assert.equal(exactMulCount(), 1, "add/sub must not count as exact multiplies");
  R.dicksonOfMu(5);
  assert.ok(exactMulCount() > 1, "dicksonOfMu should do real work");
});
