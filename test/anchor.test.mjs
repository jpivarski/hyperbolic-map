// The anchored camera under compound motion.
//
// Walking in one direction is the easy case. These tests do what a user does: change direction
// constantly, mix short hops that stay inside one tile with long hauls that cross hundreds, reverse,
// zoom, and come back. The invariant throughout is that NOTHING may depend on how far the camera has
// travelled -- so most assertions compare a far-away state against the state at the origin and demand
// they be indistinguishable, rather than merely both finite.

import test from "node:test";
import assert from "node:assert/strict";

import { Isom } from "../src/core/isom.js";
import { ViewState } from "../src/core/view.js";
import { RegularTiling, BinaryTiling } from "../src/data/atlas/tiling.js";
import { Anchor } from "../src/data/atlas/anchor.js";
import { normaliseOptionsForTesting } from "../src/viewport.js";

const REGULARS = [
  { p: 8, q: 3, frameSymmetry: 4 },
  { p: 8, q: 3 },
  { p: 7, q: 3 },
  { p: 5, q: 4 },
  { p: 4, q: 5 },
  { p: 6, q: 4 },
  { p: 3, q: 7 },
  { p: 12, q: 3 },
  { p: 9, q: 4 },
  { p: 5, q: 5 },
];

const maxEntry = (m) => Math.max(Math.abs(m.ar), Math.abs(m.ai), Math.abs(m.br), Math.abs(m.bi));

// Two matrices are the same isometry iff they agree up to overall sign: SU(1,1) double-covers the
// isometry group and an edge half-turn squares to -I.
function sameIsometry(a, b, tol = 1e-11) {
  const plus = Math.max(Math.abs(a.ar - b.ar), Math.abs(a.ai - b.ai), Math.abs(a.br - b.br), Math.abs(a.bi - b.bi));
  const minus = Math.max(Math.abs(a.ar + b.ar), Math.abs(a.ai + b.ai), Math.abs(a.br + b.br), Math.abs(a.bi + b.bi));
  return Math.min(plus, minus) < tol;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// The signature of a neighbourhood: the multiset of relative frames, rounded. For a homogeneous tiling
// this is what must be independent of the camera's position.
function signature(anchor, matrix, radius, maxTiles) {
  return anchor
    .neighbourhood(matrix, radius, maxTiles)
    .map((t) => [t.rel.ar, t.rel.ai, t.rel.br, t.rel.bi].map((v) => v.toFixed(11)).join(","))
    .sort()
    .join("|");
}

// Drive the camera through a compound itinerary, re-anchoring as a real frame loop would.
function compoundWalk(tiling, seed, legs, perLeg) {
  const anchor = new Anchor(tiling);
  const rand = rng(seed);
  let V = Isom.identity();
  let worstV = 0;
  let worstRel = 0;
  for (let leg = 0; leg < legs; leg++) {
    // A new direction and a new step size each leg: short hops and long hauls interleaved.
    const bearing = rand() * Math.PI * 2;
    const size = 0.01 + rand() * 0.14;
    const step = Isom.translationToDisk(-size * Math.cos(bearing), -size * Math.sin(bearing));
    for (let i = 0; i < perLeg; i++) {
      V = step.mul(V);
      const { shift } = anchor.reanchor(V);
      V = V.mul(shift).normalize();
      worstV = Math.max(worstV, maxEntry(V));
    }
    // Occasionally reverse, which is where accumulated state would show up.
    if (rand() < 0.35) {
      const back = Isom.translationToDisk(size * Math.cos(bearing), size * Math.sin(bearing));
      for (let i = 0; i < perLeg; i++) {
        V = back.mul(V);
        const { shift } = anchor.reanchor(V);
        V = V.mul(shift).normalize();
        worstV = Math.max(worstV, maxEntry(V));
      }
    }
    for (const t of anchor.neighbourhood(V, 0.7, 120)) worstRel = Math.max(worstRel, maxEntry(t.rel));
  }
  return { anchor, V, worstV, worstRel };
}

test("compound motion in many directions keeps the view matrix O(1)", () => {
  for (const spec of REGULARS) {
    const t = new RegularTiling(spec);
    const r = compoundWalk(t, 991 + spec.p * 31 + spec.q, 40, 30);
    assert.ok(
      r.anchor.reanchorCount > 50,
      `{${spec.p},${spec.q}} only crossed ${r.anchor.reanchorCount} tiles -- the walk is not exercising anything`,
    );
    assert.ok(
      r.worstV < 10,
      `{${spec.p},${spec.q}} max|V| reached ${r.worstV} over ${r.anchor.reanchorCount} crossings`,
    );
    assert.ok(Number.isFinite(r.worstRel) && r.worstRel < 1e4, `{${spec.p},${spec.q}} relative frames grew to ${r.worstRel}`);
  }
  const b = new BinaryTiling();
  const rb = compoundWalk(b, 4242, 40, 30);
  assert.ok(rb.anchor.reanchorCount > 50, `binary only crossed ${rb.anchor.reanchorCount} cells`);
  assert.ok(rb.worstV < 10, `binary max|V| reached ${rb.worstV}`);
});

test("after compound motion the neighbourhood is still identical to the origin's", () => {
  // The strongest statement available for a homogeneous tiling: having wandered a long way by a
  // complicated route, the local picture must be exactly what it was at the start.
  for (const spec of REGULARS) {
    const t = new RegularTiling(spec);
    const reference = signature(new Anchor(t), Isom.identity(), 0.7, 120);
    const r = compoundWalk(t, 55 + spec.p, 30, 25);
    // Re-centre the camera on its own tile so the comparison is of the same view, not the same drift.
    const got = signature(r.anchor, Isom.identity(), 0.7, 120);
    assert.equal(
      got,
      reference,
      `{${spec.p},${spec.q}} neighbourhood differs after ${r.anchor.reanchorCount} tile crossings`,
    );
  }
});

test("long hauls in eight directions all behave the same", () => {
  // A direction-dependent bug -- a sign error in one generator, say -- would show as one bearing
  // behaving differently from the others. Compare all eight against each other, not against a constant.
  for (const spec of [{ p: 8, q: 3, frameSymmetry: 4 }, { p: 7, q: 3 }, { p: 5, q: 4 }, { p: 3, q: 7 }]) {
    const t = new RegularTiling(spec);
    const reference = signature(new Anchor(t), Isom.identity(), 0.7, 120);
    for (let k = 0; k < 8; k++) {
      const bearing = (2 * Math.PI * k) / 8;
      const anchor = new Anchor(t);
      let V = Isom.identity();
      const step = Isom.translationToDisk(-0.12 * Math.cos(bearing), -0.12 * Math.sin(bearing));
      for (let i = 0; i < 400; i++) {
        V = step.mul(V);
        const { shift } = anchor.reanchor(V);
        V = V.mul(shift).normalize();
      }
      assert.ok(anchor.reanchorCount > 20, `{${spec.p},${spec.q}} bearing ${k} crossed only ${anchor.reanchorCount}`);
      assert.equal(
        signature(anchor, Isom.identity(), 0.7, 120),
        reference,
        `{${spec.p},${spec.q}} bearing ${k} ends in a different-looking neighbourhood`,
      );
      assert.ok(maxEntry(V) < 10, `{${spec.p},${spec.q}} bearing ${k}: max|V| = ${maxEntry(V)}`);
    }
  }
});

test("the camera tile always CONTAINS the view centre", () => {
  // The invariant that makes re-anchoring canonical: after re-anchoring, the view centre is inside the
  // camera tile, not merely near it. That is what stops the camera tile from depending on the route
  // taken. The nearest-centre descent needs a strict-improvement margin or a view on a boundary would
  // oscillate, so the descent finishes on the exact containment predicate instead.
  for (const spec of REGULARS) {
    const t = new RegularTiling(spec);
    const anchor = new Anchor(t);
    let V = Isom.identity();
    const rand = rng(5 + spec.p);
    let bad = 0;
    let frames = 0;
    for (let leg = 0; leg < 25; leg++) {
      const b = rand() * Math.PI * 2;
      const step = Isom.translationToDisk(-0.09 * Math.cos(b), -0.09 * Math.sin(b));
      for (let i = 0; i < 18; i++) {
        V = step.mul(V);
        const { shift } = anchor.reanchor(V);
        V = V.mul(shift).normalize();
        const c = anchor.viewCentreLocal(V, [0, 0, 0]);
        frames++;
        if (!t.containsLocal(c[0], c[1], 1e-9)) bad++;
      }
    }
    assert.equal(bad, 0, `{${spec.p},${spec.q}}: ${bad}/${frames} frames where the camera tile did not contain the view centre`);
  }
});

test("a geometric round trip restores the view exactly", () => {
  // Checked at a MODERATE distance on purpose. The only way to verify "the view came back" is to
  // reconstruct the global view -- V_c . F_c^-1 -- and that product is ill-conditioned far out, which is
  // the entire premise of this design. An earlier version of this test walked ~40 hyperbolic units and
  // then reported a discrepancy of 0.27; the discrepancy was in the TEST's own reconstruction, whose
  // left-factor accumulator had itself drifted to 1.3e-1. Measure it where it can be measured.
  for (const spec of REGULARS) {
    const t = new RegularTiling(spec);
    for (const [legs, size, per] of [[12, 0.05, 4], [24, 0.04, 3], [40, 0.03, 3]]) {
      const anchor = new Anchor(t);
      let V = Isom.identity();
      const rand = rng(17 + legs + spec.p);
      const bearings = [];
      for (let leg = 0; leg < legs; leg++) {
        const b = rand() * Math.PI * 2;
        bearings.push(b);
        const step = Isom.translationToDisk(-size * Math.cos(b), -size * Math.sin(b));
        for (let i = 0; i < per; i++) {
          V = step.mul(V);
          const { shift } = anchor.reanchor(V);
          V = V.mul(shift).normalize();
        }
      }
      for (let leg = bearings.length - 1; leg >= 0; leg--) {
        const step = Isom.translationToDisk(size * Math.cos(bearings[leg]), size * Math.sin(bearings[leg]));
        for (let i = 0; i < per; i++) {
          V = step.mul(V);
          const { shift } = anchor.reanchor(V);
          V = V.mul(shift).normalize();
        }
      }
      const global = V.mul(t.globalFrameForTesting(anchor.address).inverse());
      const off = Math.min(
        Math.max(Math.abs(global.ar - 1), Math.abs(global.ai), Math.abs(global.br), Math.abs(global.bi)),
        Math.max(Math.abs(global.ar + 1), Math.abs(global.ai), Math.abs(global.br), Math.abs(global.bi)),
      );
      assert.ok(
        off < 1e-11,
        `{${spec.p},${spec.q}} legs=${legs}: the view did not return, off by ${off.toExponential(3)}`,
      );
    }
  }
});

test("binary addresses round-trip EXACTLY, however long the walk", () => {
  // Integer addresses are canonical, so there is nothing to drift. Also exercises longitudes far past
  // float64's exact integer range, which is why they are BigInt.
  const t = new BinaryTiling();
  const anchor = new Anchor(t);
  let V = Isom.identity();
  const rand = rng(99);
  const legs = [];
  for (let leg = 0; leg < 12; leg++) {
    const b = rand() * Math.PI * 2;
    const n = 5 + Math.floor(rand() * 25);
    legs.push({ b, n });
    const step = Isom.translationToDisk(-0.1 * Math.cos(b), -0.1 * Math.sin(b));
    for (let i = 0; i < n; i++) {
      V = step.mul(V);
      const { shift } = anchor.reanchor(V);
      V = V.mul(shift).normalize();
    }
  }
  const away = { ...anchor.address };
  assert.ok(
    away.lon > 1000000000n || away.lon < -1000000000n,
    `expected a longitude well past float32 range, got ${away.lon}`,
  );
  for (let leg = legs.length - 1; leg >= 0; leg--) {
    const { b, n } = legs[leg];
    const step = Isom.translationToDisk(0.1 * Math.cos(b), 0.1 * Math.sin(b));
    for (let i = 0; i < n; i++) {
      V = step.mul(V);
      const { shift } = anchor.reanchor(V);
      V = V.mul(shift).normalize();
    }
  }
  assert.ok(
    t.addressEquals(anchor.address, t.originAddress()),
    `binary went to (${away.lat},${away.lon}) over ${anchor.reanchorCount} crossings and returned to ` +
      `(${anchor.address.lat},${anchor.address.lon}) instead of the origin`,
  );
});

test("KNOWN LIMIT: a regular tiling's word address can drift over a long round trip", () => {
  // Documented rather than asserted away, because it is a real property of word addressing.
  //
  // A {p,q} address is a word over the generators, reduced only freely (g g^-1 -> e). The group also has
  // braid relations, so two words can name one tile without being freely equal -- and if the inbound
  // path differs from the outbound one anywhere, the leftover is a relator that free reduction cannot
  // cancel. Measured over ~100 tile crossings out and back: 4 of 8 tilings return to the origin word and
  // the rest end 4 to 15 symbols away.
  //
  // What this does NOT affect: the geometry. The camera tile still contains the view centre and the
  // picture is still a function of the view, because the view is the address AND the matrix together --
  // the preceding tests pin both. What it affects is tile IDENTITY, so a position-dependent {p,q}
  // dataset could see the same tile handed a different key after a round trip. The binary tiling is
  // immune (canonical integer addresses), and the shipped Escher atlas is immune (identical data in
  // every tile). notes/open-questions.md records the Coxeter shortlex automaton as the rigorous fix.
  //
  // The assertion is that the drift stays SMALL. If it ever became unbounded, that would be a genuine
  // regression -- the walk failing to reduce at all.
  let worst = 0;
  for (const spec of REGULARS) {
    const t = new RegularTiling(spec);
    const anchor = new Anchor(t);
    let V = Isom.identity();
    const rand = rng(31 + spec.p);
    const legs = [];
    for (let leg = 0; leg < 12; leg++) {
      const b = rand() * Math.PI * 2;
      const n = 5 + Math.floor(rand() * 25);
      legs.push({ b, n });
      const step = Isom.translationToDisk(-0.1 * Math.cos(b), -0.1 * Math.sin(b));
      for (let i = 0; i < n; i++) {
        V = step.mul(V);
        const { shift } = anchor.reanchor(V);
        V = V.mul(shift).normalize();
      }
    }
    const outLen = anchor.address.len;
    for (let leg = legs.length - 1; leg >= 0; leg--) {
      const { b, n } = legs[leg];
      const step = Isom.translationToDisk(0.1 * Math.cos(b), 0.1 * Math.sin(b));
      for (let i = 0; i < n; i++) {
        V = step.mul(V);
        const { shift } = anchor.reanchor(V);
        V = V.mul(shift).normalize();
      }
    }
    const drift = anchor.address.len;
    worst = Math.max(worst, drift);
    assert.ok(
      drift <= 40,
      `{${spec.p},${spec.q}} went out ${outLen} symbols over ${anchor.reanchorCount} crossings and came ` +
        `back ${drift} symbols from the origin -- drift should be small, not proportional to the walk`,
    );
  }
  assert.ok(worst < 40, `worst drift ${worst}`);
});

test("re-anchoring cannot oscillate, even with the view exactly on a tile boundary", () => {
  // A view sitting precisely on the perpendicular bisector of two tile centres is equidistant from
  // both. Without a strict-improvement margin the camera would swap between them forever, and
  // `reanchor` would never return.
  for (const spec of [{ p: 8, q: 3, frameSymmetry: 4 }, { p: 7, q: 3 }, { p: 5, q: 4 }]) {
    const t = new RegularTiling(spec);
    const psi = t.metrics.inradius;
    for (let k = 0; k < t.generatorCount(); k++) {
      const anchor = new Anchor(t);
      // Put the view centre exactly on edge k's midpoint, i.e. exactly on the bisector.
      const c = t.generator(k).applyToDisk(0, 0, [0, 0]);
      const bearing = Math.atan2(c[1], c[0]);
      const r = Math.sinh(psi / 2);
      const V = Isom.translationToLocal(r * Math.cos(bearing), r * Math.sin(bearing)).inverse();
      const { steps } = anchor.reanchor(V);
      assert.ok(steps < 64, `{${spec.p},${spec.q}} edge ${k}: re-anchor used ${steps} steps`);
    }
  }
  // And the degenerate case: a view centred exactly on a tile centre must not move at all.
  const t = new RegularTiling({ p: 5, q: 4 });
  const anchor = new Anchor(t);
  const { steps } = anchor.reanchor(Isom.identity());
  assert.equal(steps, 0, "a view centred on its own tile must not re-anchor");
});

test("the binary camera survives compound motion including deep descents", () => {
  // Descending doubles the longitude each step, so a long descent is where a non-BigInt address would
  // silently lose exactness. Drive down, sideways, and back up, then check the address is exact.
  const t = new BinaryTiling();
  const anchor = new Anchor(t);
  let address = t.originAddress();
  const path = [];
  const rand = rng(8899);
  for (let i = 0; i < 400; i++) {
    const nbrs = t.neighbours(address);
    // Bias downward so the longitude really grows.
    const pick = rand() < 0.6 ? nbrs[2 + Math.floor(rand() * 2)] : nbrs[Math.floor(rand() * nbrs.length)];
    path.push(pick.gen);
    address = pick.address;
  }
  assert.ok(address.lat < -50n, `expected a deep descent, got latitude ${address.lat}`);
  assert.ok(
    address.lon > (1n << 40n) || address.lon < -(1n << 40n),
    `expected a longitude past float64 exactness, got ${address.lon}`,
  );
  // What the binary neighbourhood may and may not depend on, stated precisely -- an earlier version of
  // this test got it wrong and compared against longitude 0.
  //
  // The parent step is chosen by the longitude's PARITY (a cell is either the left or the right child of
  // its parent), and a walk that ascends k levels consults k successive parities. So the local picture
  // genuinely depends on the low bits of the longitude -- the binary tiling is only weakly aperiodic and
  // is NOT homogeneous. What it must not depend on is the LATITUDE, which is its exact symmetry
  // (z -> 2z maps cell (lat, lon) to (lat+1, lon), preserving lon and hence every bit of it), nor on the
  // high bits of the longitude.
  const far = new Anchor(t, { address });
  const shiftedLat = new Anchor(t, { address: { lat: address.lat + 500n, lon: address.lon } });
  assert.equal(
    signature(far, Isom.identity(), 0.6, 200),
    signature(shiftedLat, Isom.identity(), 0.6, 200),
    "binary neighbourhood depends on LATITUDE, which is its exact symmetry and must not matter",
  );
  const highBits = new Anchor(t, { address: { lat: address.lat, lon: address.lon + (1n << 30n) } });
  assert.equal(
    signature(far, Isom.identity(), 0.6, 200),
    signature(highBits, Isom.identity(), 0.6, 200),
    "binary neighbourhood depends on HIGH longitude bits, which a bounded walk cannot reach",
  );
  // Walk the path back and confirm exactness.
  for (let i = path.length - 1; i >= 0; i--) {
    const want = t.inverseGenerator(path[i]);
    const nb = t.neighbours(address).find((n) => n.gen === want);
    assert.ok(nb, `no neighbour with generator ${want}`);
    address = nb.address;
  }
  assert.equal(address.lat, 0n);
  assert.equal(address.lon, 0n);
  assert.ok(anchor.reanchorCount === 0);
});

test("neighbourhood cost does not grow with distance", () => {
  // Not a benchmark -- a shape check. The walk is bounded by the VISIBLE radius, so its work must be the
  // same at 5000 tiles as at 0. If this ever regressed, something would be scanning from the origin.
  const t = new RegularTiling({ p: 7, q: 3 });
  const counts = [];
  for (const walk of [0, 50, 500, 5000]) {
    const anchor = new Anchor(t);
    for (let i = 0; i < walk; i++) anchor.address = t.extendAddress(anchor.address, i % t.generatorCount());
    counts.push(anchor.neighbourhood(Isom.identity(), 0.7, 200).length);
  }
  assert.ok(new Set(counts).size === 1, `tile counts differ by distance: ${counts.join(", ")}`);
});

test("REGRESSION: the camera can move in every direction, from every parity of cell", () => {
  // A refactor made `stepToward` name a GENERATOR rather than an index into the neighbour list. For the
  // binary tiling that cannot work: the parent step comes in two parities, so an odd-longitude cell
  // offers only PARENT_ODD and a request for PARENT_EVEN found nothing. The camera could then never move
  // UP, and chased downward instead -- max|V| reached 2.6e24 and the latitude ran to several hundred
  // digits before anything noticed.
  //
  // Caught by driving all eight directions rather than one, which is why this test does the same.
  const tilings = [
    ["binary", new BinaryTiling()],
    ...REGULARS.map((spec) => [`{${spec.p},${spec.q}}`, new RegularTiling(spec)]),
  ];
  for (const [name, t] of tilings) {
    for (let k = 0; k < 8; k++) {
      const bearing = (2 * Math.PI * k) / 8;
      // Start from BOTH parities of binary cell, since that is what the bug depended on.
      const starts = name === "binary"
        ? [{ lat: 0n, lon: 0n }, { lat: 0n, lon: 1n }, { lat: -3n, lon: 7n }, { lat: 4n, lon: -5n }]
        : [t.originAddress()];
      for (const start of starts) {
        const anchor = new Anchor(t, { address: start });
        let V = Isom.identity();
        const step = Isom.translationToDisk(0.05 * Math.cos(bearing), 0.05 * Math.sin(bearing));
        let totalSteps = 0;
        for (let i = 0; i < 300; i++) {
          V = step.mul(V);
          const r = anchor.reanchor(V);
          totalSteps += r.steps;
          V = V.mul(r.shift).normalize();
        }
        const c = anchor.viewCentreLocal(V, [0, 0, 0]);
        assert.ok(
          t.containsLocal(c[0], c[1], 1e-9),
          `${name} bearing ${k} from ${t.addressToString(start)}: camera lost the view centre`,
        );
        assert.ok(
          maxEntry(V) < 10,
          `${name} bearing ${k} from ${t.addressToString(start)}: max|V| = ${maxEntry(V)}`,
        );
        // Each move is well under one tile, so re-anchoring must be cheap. A cycling descent shows up
        // here as a step count orders of magnitude too large -- it was 143,407 for 500 moves once.
        assert.ok(
          totalSteps < 300 * 4,
          `${name} bearing ${k}: ${totalSteps} re-anchor steps for 300 small moves -- the descent is thrashing`,
        );
      }
    }
  }
});

test("re-anchoring is cheap: one step per tile crossed, not more", () => {
  // The cost model the design assumes. If this regresses, something is cycling.
  for (const [name, t] of [["binary", new BinaryTiling()], ["{8,3}", new RegularTiling({ p: 8, q: 3 })], ["{3,7}", new RegularTiling({ p: 3, q: 7 })]]) {
    const anchor = new Anchor(t);
    let V = Isom.identity();
    let steps = 0;
    const step = Isom.translationToDisk(-0.03, 0.011);
    for (let i = 0; i < 500; i++) {
      V = step.mul(V);
      const r = anchor.reanchor(V);
      steps += r.steps;
      V = V.mul(r.shift).normalize();
    }
    assert.equal(steps, anchor.reanchorCount, `${name}: step count and crossing count must agree`);
    assert.ok(steps < 200, `${name}: ${steps} re-anchor steps for 500 small moves`);
  }
});

test("re-anchoring mid-gesture keeps a pinch's grabbed points pinned", () => {
  // Two pieces of view state live in the frame's DOMAIN rather than on the screen, and a re-anchor
  // changes the frame under them:
  //
  //   * a pinch's grabbed points, recorded by beginPinch in the frame current at that moment;
  //   * the compass target, since northOf() applies the matrix to it.
  //
  // ViewState.rebase pulls both back through the shift. Without that, re-anchoring in the middle of a
  // pinch makes the solver pin the wrong points and the picture jumps out from under the fingers. This
  // is hard to provoke through the browser -- a pinch that zooms in moves the view centre less, in
  // hyperbolic terms, than the same gesture panning -- so it is checked directly here.
  const t = new RegularTiling({ p: 5, q: 4 });
  const g = t.generator(0);

  for (const [f1, f2, h1, h2] of [
    [[-0.30, 0.05], [0.30, -0.05], [-0.45, 0.10], [0.42, -0.12]],
    [[0.10, 0.28], [-0.15, -0.22], [0.18, 0.40], [-0.26, -0.33]],
  ]) {
    const view = new ViewState({ zoom: 1, minZoom: 0.1, maxZoom: 100 });

    // The pinch, driven WITHOUT any re-anchor, as the reference.
    const plain = new ViewState({ zoom: 1, minZoom: 0.1, maxZoom: 100 });
    plain.beginPinch(f1[0], f1[1], f2[0], f2[1]);
    plain.updatePinch(h1[0], h1[1], h2[0], h2[1], true, true);
    const refLive = plain.liveMatrix.clone();
    const refZoom = plain.liveZoom;

    // The same pinch, but the camera re-anchors between the grab and the update.
    view.beginPinch(f1[0], f1[1], f2[0], f2[1]);
    view.rebase(g);
    view.updatePinch(h1[0], h1[1], h2[0], h2[1], true, true);

    // The zoom solve must be unaffected: it depends only on the grabbed points' mutual distance, which
    // is frame-independent.
    assert.ok(
      Math.abs(view.liveZoom - refZoom) < 1e-12,
      `zoom differs after rebase: ${view.liveZoom} vs ${refZoom}`,
    );
    // And the resulting view must be the same VIEW, differing only by the frame it is expressed in --
    // i.e. liveMatrix should equal the reference times the shift.
    const want = refLive.mul(g);
    assert.ok(
      sameIsometry(view.liveMatrix, want, 1e-10),
      "the pinch result differs from the un-rebased one by more than the change of frame",
    );
  }
});

test("rebase keeps the compass target on the ideal boundary", () => {
  // The compass target is an IDEAL point. Pulling it back through a shift and letting it drift inside
  // the disk would quietly turn "north" into a reference to an ordinary interior point, and the drift
  // would compound one re-anchor at a time.
  const t = new RegularTiling({ p: 6, q: 4 });
  const view = new ViewState({ zoom: 1 });
  let worst = 0;
  for (let i = 0; i < 2000; i++) {
    view.rebase(t.generator(i % t.generatorCount()));
    const r = Math.hypot(view.compassTargetX, view.compassTargetY);
    worst = Math.max(worst, Math.abs(r - 1));
  }
  assert.ok(worst < 1e-9, `compass target drifted off the boundary by ${worst} over 2000 re-anchors`);
});

test("an atlas refuses to be combined with a global data source", () => {
  // In atlas mode the view matrix is expressed in the CAMERA TILE's frame, so a source whose coordinates
  // are global has no correct placement: measured, a point at the global origin lands 0.93 disk units
  // away -- most of the way across the disk -- after sixty small pans. Drawing it properly would mean
  // composing the camera's global frame, the ill-conditioned product this design removes. So the
  // combination is refused, loudly, rather than rendered wrong.
  //
  // No expressiveness is lost: `layers` covers screen-space overlays and the atlas callback covers
  // anything belonging to a tile.
  const tiling = new RegularTiling({ p: 5, q: 4 });
  const atlas = { tiling, tileData: () => ({ drawables: [] }) };
  assert.throws(
    () => normaliseOptionsForTesting({ atlas, data: [{ type: "path", points: [[0, 0], [1, 0]] }] }),
    /cannot be combined with `data`/,
  );
  assert.throws(
    () => normaliseOptionsForTesting({ atlas, data: { drawables: [{ type: "path", points: [[0, 0]] }] } }),
    /cannot be combined with `data`/,
  );
  assert.throws(
    () => normaliseOptionsForTesting({ atlas, dataProvider: async () => ({ drawables: [] }) }),
    /cannot be combined with `data`/,
  );
  // The defaults must NOT trip the guard: `data` defaults to an empty list and every atlas demo relies
  // on that.
  assert.doesNotThrow(() => normaliseOptionsForTesting({ atlas }));
  assert.doesNotThrow(() => normaliseOptionsForTesting({ atlas, data: [] }));
  assert.doesNotThrow(() => normaliseOptionsForTesting({ data: [{ type: "path", points: [[0, 0]] }] }));
});
