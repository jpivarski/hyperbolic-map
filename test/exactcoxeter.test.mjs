// The exact Coxeter representation: relations, special points, rotations, inverses, serialization.
//
// Faithfulness (Tits) is the theorem that lets matrix equality DEFINE tile identity, so the tests
// here are about proving the matrices really are the group they claim to be, over more tilings than
// the library actually ships.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExactCoxeter, exactIdentity, exactMatMul, exactMatPow, exactMatVec, exactMatEquals,
  exactDet3, exactInverse3, serializeExactMatrix, exactVecEquals, exactBilinear,
} from "../src/data/atlas/exactcoxeter.js";

// The eight the library ships, plus two it does not, to prove the construction is general and not
// tuned to the built-ins.
const SHIPPED = [[8, 3], [7, 3], [5, 4], [4, 5], [6, 4], [3, 7], [12, 3], [9, 4]];
const EXTRA = [[5, 5], [10, 4], [4, 6], [13, 3]];
const ALL = [...SHIPPED, ...EXTRA];

test("the Coxeter relations hold exactly, for shipped and unshipped tilings alike", () => {
  // buildExactCoxeter runs checkCoxeterRelations itself, so reaching here at all is the assertion;
  // this test exists to make the coverage explicit and to name the tilings.
  for (const [p, q] of ALL) {
    assert.doesNotThrow(() => buildExactCoxeter(p, q), `{${p},${q}}`);
  }
});

test("REGRESSION: {8,3}, {7,3} and {3,7} are the ones the lambda bug broke", () => {
  // With lambda_q written as D_{N/q}(mu) and the n=3 shortcut, N/q truncates and (Sb Sc)^q != I.
  // These three are exactly the tilings where q = 3 or p = 3, so they are the tripwire.
  for (const [p, q] of [[8, 3], [7, 3], [3, 7], [12, 3]]) {
    const cx = buildExactCoxeter(p, q);
    const I = exactIdentity(cx.R);
    assert.ok(exactMatEquals(cx.R, exactMatPow(cx.R, exactMatMul(cx.R, cx.Sb, cx.Sc), q), I),
      `{${p},${q}}: (Sb Sc)^${q} = I`);
    assert.ok(exactMatEquals(cx.R, exactMatPow(cx.R, exactMatMul(cx.R, cx.Sa, cx.Sb), p), I),
      `{${p},${q}}: (Sa Sb)^${p} = I`);
    // and lambda for the 3 side really is the integer 1
    const three = q === 3 ? cx.lambdaQ : cx.lambdaP;
    assert.ok(cx.R.equals(three, cx.R.fromInt(1)), `{${p},${q}}: 2cos(pi/3) should be exactly 1`);
  }
});

test("the relations have the RIGHT order, not merely some order", () => {
  // (Sa Sb)^p = I is weak on its own -- it also holds for any divisor. Assert p is the true order,
  // or a wrong lambda that happened to give a smaller rotation would slip through.
  for (const [p, q] of ALL) {
    const cx = buildExactCoxeter(p, q);
    const I = exactIdentity(cx.R);
    const ab = exactMatMul(cx.R, cx.Sa, cx.Sb);
    const bc = exactMatMul(cx.R, cx.Sb, cx.Sc);
    for (let k = 1; k < p; k++) {
      assert.ok(!exactMatEquals(cx.R, exactMatPow(cx.R, ab, k), I), `{${p},${q}}: (Sa Sb)^${k} = I too early`);
    }
    for (let k = 1; k < q; k++) {
      assert.ok(!exactMatEquals(cx.R, exactMatPow(cx.R, bc, k), I), `{${p},${q}}: (Sb Sc)^${k} = I too early`);
    }
  }
});

test("rho = Sb.Sa has order p and its powers are all distinct", () => {
  for (const [p, q] of ALL) {
    const cx = buildExactCoxeter(p, q);
    const I = exactIdentity(cx.R);
    assert.ok(exactMatEquals(cx.R, exactMatPow(cx.R, cx.rho, p), I), `{${p},${q}}: rho^p = I`);
    const seen = [];
    for (let k = 0; k < p; k++) {
      const Rk = exactMatPow(cx.R, cx.rho, k);
      for (const prev of seen) assert.ok(!exactMatEquals(cx.R, Rk, prev), `{${p},${q}}: rho^${k} repeats`);
      seen.push(Rk);
      // every power fixes the tile centre -- that is what makes it a stabiliser candidate
      assert.ok(exactVecEquals(cx.R, exactMatVec(cx.R, Rk, cx.vO), cx.vO), `{${p},${q}}: rho^${k} moves vO`);
    }
  }
});

test("inverses come from the adjugate and are exact", () => {
  for (const [p, q] of ALL) {
    const cx = buildExactCoxeter(p, q);
    const I = exactIdentity(cx.R);
    const words = [cx.Sa, cx.Sb, cx.Sc, cx.rho, exactMatMul(cx.R, cx.Sa, cx.Sc),
      exactMatMul(cx.R, exactMatMul(cx.R, cx.rho, cx.Sb), cx.Sc)];
    for (const M of words) {
      const det = exactDet3(cx.R, M);
      assert.ok(cx.R.equals(det, cx.R.one()) || cx.R.equals(det, cx.R.neg(cx.R.one())),
        `{${p},${q}}: det should be +-1, got ${cx.R.toNumber(det)}`);
      const inv = exactInverse3(cx.R, M);
      assert.ok(exactMatEquals(cx.R, exactMatMul(cx.R, M, inv), I), `{${p},${q}}: M.inv != I`);
      assert.ok(exactMatEquals(cx.R, exactMatMul(cx.R, inv, M), I), `{${p},${q}}: inv.M != I`);
    }
  }
});

test("serialization is injective, stable, and cannot collide across tilings", () => {
  const seen = new Map();
  for (const [p, q] of ALL) {
    const cx = buildExactCoxeter(p, q);
    const m = p;
    const words = [exactIdentity(cx.R), cx.Sa, cx.rho, exactMatMul(cx.R, cx.Sa, cx.Sc)];
    for (const M of words) {
      const s = serializeExactMatrix(cx.R, M, p, q, m);
      assert.equal(s, serializeExactMatrix(cx.R, M, p, q, m), "not stable");
      assert.ok(s.startsWith(`${p},${q},${m}|`), "missing the tiling prefix");
      if (seen.has(s)) {
        const prev = seen.get(s);
        assert.ok(prev.p === p && prev.q === q, `id ${s} collides across tilings`);
        assert.ok(exactMatEquals(cx.R, prev.M, M), `id ${s} collides within {${p},${q}}`);
      }
      seen.set(s, { p, q, M });
    }
    // The identity of two DIFFERENT tilings must not share an id even though the matrix is I.
    assert.notEqual(
      serializeExactMatrix(cx.R, exactIdentity(cx.R), p, q, m),
      serializeExactMatrix(cx.R, exactIdentity(cx.R), p, q, m === 1 ? 2 : 1),
      "the m in the prefix must be part of the id",
    );
  }
});

test("the bilinear form is preserved by the whole group, not just the generators", () => {
  // A product of form-preserving maps preserves the form, so this is a consistency check on the
  // matrix arithmetic itself rather than on the geometry.
  for (const [p, q] of [[8, 3], [5, 4], [3, 7]]) {
    const cx = buildExactCoxeter(p, q);
    const { R, G } = cx;
    let s = 12345;
    const gens = [cx.Sa, cx.Sb, cx.Sc];
    let M = exactIdentity(R);
    for (let i = 0; i < 40; i++) {
      s = (s * 1103515245 + 12345) % 2147483648;
      M = exactMatMul(R, M, gens[s % 3]);
      const Mt = [0, 1, 2].map((a) => [0, 1, 2].map((b) => M[b][a]));
      assert.ok(exactMatEquals(R, exactMatMul(R, Mt, exactMatMul(R, G, M)), G),
        `{${p},${q}}: step ${i} does not preserve the form`);
    }
    // vO stays timelike however far the word goes
    const img = exactMatVec(R, M, cx.vO);
    assert.ok(R.toNumber(exactBilinear(R, G, img, img)) < 0, "image of vO left the light cone");
  }
});

test("coefficient size grows linearly in word length, so ids stay tractable", () => {
  // The cost model the design rests on: bits per coefficient grow like the distance, not like an
  // exponential. If this were superlinear, far-out ids would be unusable.
  const cx = buildExactCoxeter(8, 3);
  const { R } = cx;
  // Two DIFFERENT edge half-turns. One of them alone is an involution -- (Sa Sc)^2 = I is a Coxeter
  // relation -- so repeating a single step goes nowhere; their product is a genuine translation.
  const ht = exactMatMul(R, cx.Sa, cx.Sc);
  const rhoInv = exactMatPow(R, cx.rho, 7);
  const step = exactMatMul(R, ht, exactMatMul(R, exactMatMul(R, cx.rho, ht), rhoInv));
  let M = exactIdentity(R);
  const bits = [];
  for (let i = 1; i <= 60; i++) {
    M = exactMatMul(R, M, step);
    let worst = 0;
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        for (const c of M[a][b]) {
          const n = (c < 0n ? -c : c).toString(2).length;
          if (n > worst) worst = n;
        }
      }
    }
    bits.push(worst);
  }
  assert.ok(bits[59] > bits[9], "coefficients are not growing at all -- is the walk moving?");
  // Linear, not quadratic: doubling the word length should roughly double the bit length.
  const ratio = bits[59] / bits[29];
  assert.ok(ratio > 1.5 && ratio < 2.6, `bit growth ratio ${ratio.toFixed(2)} is not linear-ish`);
});
