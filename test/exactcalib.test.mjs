// Calibration: the exact representation against the library's float one.
//
// These tests ARE the convention documentation. Every one of them would be a comment in a worse
// codebase ("rho turns counter-clockwise", "matrix product is Isom.mul order"), and comments do not
// fail when someone changes the other side.

import test from "node:test";
import assert from "node:assert/strict";

import { Isom, movePointToPoint } from "../src/core/isom.js";
import { RegularTiling, regularMetrics } from "../src/data/atlas/tiling.js";
import { buildExactCoxeter, exactMatMul, exactMatPow, exactMatVec, exactIdentity, exactMatEquals } from "../src/data/atlas/exactcoxeter.js";
import { buildIntertwiner, matchGenerators, calibrateSpin, checkMultiplyOrder, exactToIsom } from "../src/data/atlas/exactcalib.js";

const SPECS = [
  { p: 8, q: 3, frameSymmetry: 4 },
  { p: 8, q: 3 },
  { p: 7, q: 3 },
  { p: 5, q: 4 },
  { p: 4, q: 5 },
  { p: 6, q: 4 },
  { p: 3, q: 7 },
  { p: 12, q: 3 },
  { p: 9, q: 4 },
];

const near = (a, b, tol) => Math.hypot(a[0] - b[0], a[1] - b[1]) < (tol || 1e-9);

test("the intertwiner lands on the library's frame: edge 0 on +x, vertex 0 at +pi/p", () => {
  for (const spec of SPECS) {
    const { p, q } = spec;
    const cx = buildExactCoxeter(p, q);
    const inter = buildIntertwiner(cx);
    const met = regularMetrics(p, q);

    const zM = inter.toDisk(cx.vM);
    const zV = inter.toDisk(cx.vV);
    const zO = inter.toDisk(cx.vO);

    assert.ok(near(zO, [0, 0], 1e-12), `{${p},${q}}: tile center is not at the disk origin`);
    // edge-0 midpoint: at the inradius, on the +x axis
    assert.ok(Math.abs(Math.hypot(...zM) - Math.tanh(met.inradius / 2)) < 1e-9, `{${p},${q}}: |zM|`);
    assert.ok(Math.abs(Math.atan2(zM[1], zM[0])) < 1e-9, `{${p},${q}}: edge-0 midpoint is off the +x axis`);
    // vertex 0: at the circumradius, at angle +pi/p
    assert.ok(Math.abs(Math.hypot(...zV) - Math.tanh(met.circumradius / 2)) < 1e-9, `{${p},${q}}: |zV|`);
    assert.ok(Math.abs(Math.atan2(zV[1], zV[0]) - Math.PI / p) < 1e-9, `{${p},${q}}: vertex 0 angle`);
  }
});

test("rho turns counter-clockwise by exactly +2pi/p", () => {
  for (const spec of SPECS) {
    const { p, q } = spec;
    const cx = buildExactCoxeter(p, q);
    const inter = buildIntertwiner(cx);
    const turned = inter.toDisk(exactMatVec(cx.R, cx.rho, cx.vM));
    const ang = Math.atan2(turned[1], turned[0]);
    assert.ok(Math.abs(ang - (2 * Math.PI) / p) < 1e-9,
      `{${p},${q}}: rho takes the edge-0 midpoint to ${(ang * 180) / Math.PI} deg, want ${360 / p}`);
  }
});

test("the edge-0 half-turn moves the tile center to the edge-0 neighbor", () => {
  // Sa.Sc is the half-turn about the edge-0 midpoint, so it must send the center a full center
  // spacing along the +x axis -- that is what makes it a walk step and not merely a symmetry.
  for (const spec of SPECS) {
    const { p, q } = spec;
    const cx = buildExactCoxeter(p, q);
    const inter = buildIntertwiner(cx);
    const met = regularMetrics(p, q);
    const moved = inter.toDisk(exactMatVec(cx.R, exactMatMul(cx.R, cx.Sa, cx.Sc), cx.vO));
    assert.ok(Math.abs(Math.hypot(...moved) - Math.tanh(met.inradius)) < 1e-9, `{${p},${q}}: distance`);
    assert.ok(Math.abs(Math.atan2(moved[1], moved[0])) < 1e-9, `{${p},${q}}: not along +x`);
  }
});

test("every float walk generator matches exactly one exact word, and vice versa", () => {
  // The bijection is the load-bearing part: a silent mis-assignment would corrupt every id and
  // nothing downstream would notice.
  for (const spec of SPECS) {
    const t = new RegularTiling(spec);
    const cx = buildExactCoxeter(spec.p, spec.q);
    const { exactGenerators } = matchGenerators(cx, t.generators, spec.p, t.m);
    assert.equal(exactGenerators.length, t.generators.length, `{${spec.p},${spec.q}}: count`);
    for (const M of exactGenerators) assert.ok(M, "an unmatched generator slipped through");
    // distinct words
    for (let i = 0; i < exactGenerators.length; i++) {
      for (let j = i + 1; j < exactGenerators.length; j++) {
        const same = exactMatEquals(cx.R, exactGenerators[i], exactGenerators[j]);
        assert.ok(!same, `{${spec.p},${spec.q}}: generators ${i} and ${j} got the same exact word`);
      }
    }
  }
});

test("the matched exact generators reproduce the float ones as Mobius maps", () => {
  // Matching found a correspondence; this checks the correspondence is actually right, on points
  // other than the ones used to match.
  for (const spec of SPECS) {
    const t = new RegularTiling(spec);
    const cx = buildExactCoxeter(spec.p, spec.q);
    const { exactGenerators, intertwiner } = matchGenerators(cx, t.generators, spec.p, t.m);
    let worst = 0;
    for (let i = 0; i < t.generators.length; i++) {
      for (const z of [[0.42, -0.11], [-0.05, 0.37], [0.6, 0.25], [-0.3, -0.3]]) {
        const a = t.generators[i].applyToDisk(z[0], z[1], [0, 0]);
        const b = intertwiner.actOnDisk(exactGenerators[i], z[0], z[1]);
        worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1]));
      }
    }
    assert.ok(worst < 1e-9, `{${spec.p},${spec.q}}: worst generator action mismatch ${worst}`);
  }
});

test("SPIN and MUL_ORDER are pinned by executed comparison, not by assumption", () => {
  for (const spec of SPECS) {
    const t = new RegularTiling(spec);
    const cx = buildExactCoxeter(spec.p, spec.q);
    const { exactGenerators, intertwiner } = matchGenerators(cx, t.generators, spec.p, t.m);
    const P = exactMatPow(cx.R, cx.rho, spec.p / t.m);

    const spin = calibrateSpin(intertwiner, P, t.m, Isom);
    assert.ok(spin === 1 || spin === -1, `{${spec.p},${spec.q}}: SPIN`);

    // P must act as selfRotation (up to the spin sign), since that is what the library calls it.
    const self = Isom.rotation((spin * 2 * Math.PI) / t.m);
    for (const z of [[0.3, 0.1], [-0.2, 0.4]]) {
      const a = intertwiner.actOnDisk(P, z[0], z[1]);
      const b = self.applyToDisk(z[0], z[1], [0, 0]);
      assert.ok(near(a, b), `{${spec.p},${spec.q}}: P is not selfRotation`);
    }

    // Composition order. checkMultiplyOrder REFUSES a commuting pair, so find one that does not
    // commute: for m < p, generators 2j and 2j+1 are CCW/CW about the same vertex and are inverses,
    // which is precisely the pair that would make this test vacuous.
    let pinned = false;
    for (let i = 0; i < t.generators.length && !pinned; i++) {
      for (let j = i + 1; j < t.generators.length && !pinned; j++) {
        try {
          checkMultiplyOrder(cx, intertwiner, exactGenerators[i], exactGenerators[j],
            t.generators[i], t.generators[j]);
          pinned = true;
        } catch (e) {
          if (!/commuting pair/.test(e.message)) throw e;   // a real ordering mismatch must surface
        }
      }
    }
    assert.ok(pinned, `{${spec.p},${spec.q}}: no non-commuting generator pair found to pin MUL_ORDER`);
  }
});

test("exactToIsom round-trips: exact matrix -> float isometry -> same action", () => {
  for (const spec of SPECS) {
    const t = new RegularTiling(spec);
    const cx = buildExactCoxeter(spec.p, spec.q);
    const { exactGenerators, intertwiner } = matchGenerators(cx, t.generators, spec.p, t.m);
    let s = 777;
    let M = exactIdentity(cx.R);
    let worst = 0;
    let nearest = 1; // smallest (1 - |beta|) reached, i.e. how ill-conditioned it got
    // Six steps, not twelve: this conversion is only defined inside float range, and {12,3} has a
    // large center spacing so twelve random steps land past it. The out-of-range case is asserted
    // separately below.
    for (let step = 0; step < 6; step++) {
      s = (s * 1103515245 + 12345) % 2147483648;
      M = exactMatMul(cx.R, M, exactGenerators[s % exactGenerators.length]);
      const iso = exactToIsom(intertwiner, M, Isom, movePointToPoint);
      const beta = intertwiner.actOnDisk(M, 0, 0);
      nearest = Math.min(nearest, 1 - Math.hypot(beta[0], beta[1]));
      for (const z of [[0, 0], [0.35, -0.2], [-0.1, 0.45]]) {
        const a = intertwiner.actOnDisk(M, z[0], z[1]);
        const b = iso.applyToDisk(z[0], z[1], [0, 0]);
        worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1]));
      }
    }
    // The tolerance tracks the CONDITIONING rather than being a flat number. A disk coordinate at
    // |beta| = 1 - d carries about eps/d of resolution, so the achievable accuracy degrades as the
    // walk approaches the boundary -- {9,4} reaches 5.3e-9 after six steps and that is correct
    // behavior, not a defect. A flat tolerance here would either fail on the far tilings or be so
    // loose that it stopped testing the near ones.
    const tol = Math.max(1e-12, 2e-13 / Math.max(nearest, 1e-9));
    assert.ok(worst < tol,
      `{${spec.p},${spec.q}}: exactToIsom worst ${worst.toExponential(2)} exceeds ${tol.toExponential(2)} ` +
        `at 1-|beta| = ${nearest.toExponential(2)}`);
  }
});

test("FAITHFULNESS: exact equality matches float action equality on random words", () => {
  // Tits' theorem is what lets matrix equality define identity. This is the empirical cross-check:
  // over many random words, two exact matrices are equal if and only if the two float Mobius maps
  // agree. Either direction failing would sink the whole design.
  for (const spec of [{ p: 8, q: 3, frameSymmetry: 4 }, { p: 7, q: 3 }, { p: 5, q: 4 }]) {
    const t = new RegularTiling(spec);
    const cx = buildExactCoxeter(spec.p, spec.q);
    const { exactGenerators, intertwiner } = matchGenerators(cx, t.generators, spec.p, t.m);
    let s = 20260807;
    const rnd = (n) => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s % n;
    };
    const words = [];
    for (let w = 0; w < 120; w++) {
      let M = exactIdentity(cx.R);
      let iso = Isom.identity();
      const len = 1 + rnd(8);
      for (let i = 0; i < len; i++) {
        const g = rnd(exactGenerators.length);
        M = exactMatMul(cx.R, M, exactGenerators[g]);
        iso = iso.mul(t.generators[g]).normalize();
      }
      words.push({ M, iso });
    }
    let bothAgree = 0;
    let exactEq = 0;
    for (let i = 0; i < words.length; i++) {
      for (let j = i + 1; j < words.length; j++) {
        const ex = exactMatEquals(cx.R, words[i].M, words[j].M);
        let fl = true;
        for (const z of [[0, 0], [0.3, 0.2], [-0.25, 0.1]]) {
          const a = words[i].iso.applyToDisk(z[0], z[1], [0, 0]);
          const b = words[j].iso.applyToDisk(z[0], z[1], [0, 0]);
          if (!near(a, b, 1e-9)) fl = false;
        }
        assert.equal(ex, fl,
          `{${spec.p},${spec.q}}: words ${i},${j} -- exact equal ${ex} but float equal ${fl}`);
        if (ex) exactEq++;
        bothAgree++;
      }
    }
    // Anti-vacuity: if no two words ever coincided, the "only if" half is untested.
    assert.ok(exactEq > 0, `{${spec.p},${spec.q}}: no coincidences among ${bothAgree} pairs, test is vacuous`);
  }
});

test("exactToIsom refuses out of float range instead of returning NaN", () => {
  // The limit is real and documented; what matters is that it announces itself. Before the guard
  // this returned a matrix full of NaN and the caller found out much later.
  const t = new RegularTiling({ p: 12, q: 3 });
  const cx = buildExactCoxeter(12, 3);
  const { exactGenerators, intertwiner } = matchGenerators(cx, t.generators, 12, t.m);
  let M = exactIdentity(cx.R);
  // Walk straight out: alternating two different generators translates rather than spinning.
  let threw = null;
  for (let i = 0; i < 40 && !threw; i++) {
    M = exactMatMul(cx.R, M, exactGenerators[i % 2 === 0 ? 0 : 2]);
    try {
      const iso = exactToIsom(intertwiner, M, Isom, movePointToPoint);
      assert.ok(Number.isFinite(iso.ar), "returned a non-finite matrix without throwing");
    } catch (e) {
      threw = e;
    }
  }
  assert.ok(threw, "walking far enough should eventually exceed float range");
  assert.match(threw.message, /out of float range/);
});
