// The anchored camera under compound motion.
//
// Walking in one direction is the easy case. These tests do what a user does: change direction
// constantly, mix short hops that stay inside one tile with long hauls that cross hundreds, reverse,
// zoom, and come back. The invariant throughout is that NOTHING may depend on how far the camera has
// travelled -- so most assertions compare a far-away state against the state at the origin and demand
// they be indistinguishable, rather than merely both finite.

import test from "node:test";
import assert from "node:assert/strict";

import { advanceAddress, addressDistance, wrapAngle } from "./helpers.mjs";

import { Isom } from "../src/core/isom.js";
import { ViewState, ROTATION_COMPASS } from "../src/core/view.js";
import { RegularTiling, BinaryTiling } from "../src/data/atlas/tiling.js";
import { Anchor } from "../src/data/atlas/anchor.js";
import { Atlas } from "../src/data/atlas/atlas.js";
import { tileSymmetryResidual, tileSymmetryMessage } from "../src/data/atlas/symmetry.js";
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

// Where a tile sits, as a sortable key. Sub-1e-11 magnitudes are printed as +0 so that a -1.2e-16
// coordinate does not read as a different place from +0.
function centreKey(rel) {
  const z = rel.applyToDisk(0, 0, [0, 0]);
  return z.map((v) => (Math.abs(v) < 1e-11 ? 0 : v).toFixed(11)).join(",");
}

// The neighbourhood as {centres, byCentre}: the sorted set of tile positions, and each position's
// frame.
//
// Positions and frames have to be looked at separately now, and that is the whole point of canonical
// orientation. A regular tiling is homogeneous, so the POSITIONS around any tile are the same as
// around the origin -- that is still exactly true and is what these tests check. The FRAMES are not:
// a tile's frame is now an absolute property of that tile rather than of the route to it, so the same
// arrangement seen from a different place has each tile turned by some multiple of 2*pi/m about its
// own centre. `frameDefects` measures those turns and insists they are exactly that.
function layout(anchor, matrix, radius, maxTiles) {
  const byCentre = new Map();
  for (const t of anchor.neighbourhood(matrix, radius, maxTiles)) byCentre.set(centreKey(t.rel), t.rel);
  return { centres: [...byCentre.keys()].sort().join("|"), byCentre };
}

// For every tile the two layouts share, the angle between the two frames. Both frames send the tile's
// own centre to the same point, so their ratio fixes that centre and is a pure rotation about it.
function frameDefects(a, b) {
  const out = [];
  for (const [key, relA] of a.byCentre) {
    const relB = b.byCentre.get(key);
    if (!relB) continue;
    const d = relA.inverse().mul(relB).normalize();
    // A rotation is [[e^{i t/2}, 0], [0, e^{-i t/2}]] up to sign, acting as z -> e^{i t} z.
    out.push({ key, angle: 2 * Math.atan2(d.ai, d.ar), translation: Math.hypot(d.br, d.bi) });
  }
  return out;
}

// Assert that two layouts describe the same arrangement of tiles, differing only by each tile's own
// stabiliser rotation.
function assertSameArrangement(t, ref, got, what) {
  assert.equal(got.centres, ref.centres, `${what}: the tiles are in different places`);
  const defects = frameDefects(ref, got);
  assert.ok(defects.length > 5, `${what}: only ${defects.length} tiles compared`);
  const quantum = (2 * Math.PI) / t.m;
  for (const d of defects) {
    assert.ok(d.translation < 1e-9, `${what}: frames at ${d.key} differ by a TRANSLATION of ${d.translation}`);
    const off = Math.abs(wrapAngle(d.angle - Math.round(d.angle / quantum) * quantum));
    assert.ok(off < 1e-9, `${what}: frames at ${d.key} differ by ${d.angle}, not a multiple of 2pi/${t.m}`);
  }
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

test("after compound motion the neighbourhood is still the same arrangement of tiles", () => {
  // The strongest statement available for a homogeneous tiling: having wandered a long way by a
  // complicated route, the local picture must be what it was at the start.
  //
  // "Identical" up to each tile's own stabiliser rotation, not identical byte for byte, and the
  // difference is the point of canonical orientation rather than a weakening. Lex-min over the coset
  // is not equivariant under translating the whole tiling, so the canonical frame of a tile far out is
  // not the translate of the canonical frame of the corresponding tile here. What IS preserved is
  // everything geometric: the same tiles in the same places, each turned about its own centre by a
  // multiple of 2*pi/m -- which is exactly the freedom the tile stabiliser has always had.
  for (const spec of REGULARS) {
    const t = new RegularTiling(spec);
    const reference = layout(new Anchor(t), Isom.identity(), 0.7, 120);
    const r = compoundWalk(t, 55 + spec.p, 30, 25);
    // Re-centre the camera on its own tile so the comparison is of the same view, not the same drift.
    const got = layout(r.anchor, Isom.identity(), 0.7, 120);
    assertSameArrangement(t, reference, got, `{${spec.p},${spec.q}} after ${r.anchor.reanchorCount} crossings`);
  }
});

test("long hauls in eight directions all behave the same", () => {
  // A direction-dependent bug -- a sign error in one generator, say -- would show as one bearing
  // behaving differently from the others. Compare all eight against each other, not against a constant.
  for (const spec of [{ p: 8, q: 3, frameSymmetry: 4 }, { p: 7, q: 3 }, { p: 5, q: 4 }, { p: 3, q: 7 }]) {
    const t = new RegularTiling(spec);
    const reference = layout(new Anchor(t), Isom.identity(), 0.7, 120);
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
      assertSameArrangement(t, reference, layout(anchor, Isom.identity(), 0.7, 120),
        `{${spec.p},${spec.q}} bearing ${k}`);
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

test("a regular tiling's address does not drift over a long round trip", () => {
  // The assertion is EQUALITY, not a bound on the drift, and that is the point: an id is a canonical
  // coset representative rather than a record of the route taken, so a camera that wanders out along
  // one path and back along another comes home to the same id and the same orientation. Nothing here
  // needs a tolerance.
  //
  // Up to nine legs, about a hundred tile crossings. Not further, and the reason is the CAMERA, not
  // the addressing: the view matrix is rebased at every crossing, and the residual error of an
  // out-and-back excursion grows with how far out it went. Measured on {4,5}, the view returns to
  // within 2.8e-12 of where it started after 3 legs, 7.8e-8 after 6, 9.9e-4 after 9 and 0.12 after 12
  // -- and 0.12 is most of a tile, so at twelve legs the camera really has ended up somewhere else and
  // the address is right to say so. (Checked against the pre-canonical code: 1.5e-12, 1.5e-8, 2.4e-3,
  // 0.13. Same drift, so it is the float excursion and not the exact ids.) The residual is asserted
  // below, so this cannot quietly become a test of nothing.
  for (const spec of REGULARS) {
    for (const legCount of [3, 6, 9]) {
      const t = new RegularTiling(spec);
      const anchor = new Anchor(t);
      let V = Isom.identity();
      const rand = rng(31 + spec.p);
      const legs = [];
      for (let leg = 0; leg < legCount; leg++) {
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
      // Anti-vacuity: the outbound trip must actually have crossed tiles, or coming home is free.
      const crossings = anchor.reanchorCount;
      assert.ok(crossings > legCount, `{${spec.p},${spec.q}} only crossed ${crossings} tiles outbound`);
      const away = anchor.address;
      assert.ok(!t.addressEquals(away, t.originAddress()), `{${spec.p},${spec.q}} never left the origin`);
      for (let leg = legs.length - 1; leg >= 0; leg--) {
        const { b, n } = legs[leg];
        const step = Isom.translationToDisk(0.1 * Math.cos(b), 0.1 * Math.sin(b));
        for (let i = 0; i < n; i++) {
          V = step.mul(V);
          const { shift } = anchor.reanchor(V);
          V = V.mul(shift).normalize();
        }
      }
      const residual = V.applyToDisk(0, 0, [0, 0]);
      assert.ok(
        Math.hypot(residual[0], residual[1]) < 1e-2,
        `{${spec.p},${spec.q}} the CAMERA did not come back: residual ${Math.hypot(residual[0], residual[1])}`,
      );
      assert.ok(
        t.addressEquals(anchor.address, t.originAddress()),
        `{${spec.p},${spec.q}} went out over ${crossings} crossings and came back to a different tile`,
      );
    }
  }
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
    anchor.address = advanceAddress(t, walk, 700 + walk);
    assert.ok(addressDistance(t, anchor.address) >= walk * 0.25 || walk === 0,
      `the walk did not travel: ${walk} steps reached only ${addressDistance(t, anchor.address).toFixed(2)} hyperbolic units`);
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
    // Cycling generator indices is fine HERE: this only needs a sequence of frame changes, not a walk
    // that travels, and rebase does not free-reduce anything.
    view.rebase(t.generator(i % t.generatorCount()));
    const r = Math.hypot(view.compassTargetX, view.compassTargetY);
    worst = Math.max(worst, Math.abs(r - 1));
  }
  assert.ok(worst < 1e-9, `compass target drifted off the boundary by ${worst} over 2000 re-anchors`);
});

test("rebase leaves the compass BEARING numerically unchanged", () => {
  // The test above is necessary but far too weak on its own, and that is worth stating: a rebase that
  // forgot the compass target entirely would still pass it, since an untouched target sits on the
  // boundary forever. Measured in the browser, that exact omission drives north 3.105 rad off -- north
  // ends up pointing very nearly south -- over sixty gestures, while the real code drifts by 0.
  //
  // The invariant with teeth is that a rebase is a change of COORDINATES and must not move anything
  // physical. `north()` applies the matrix to the target, and
  //
  //     M' (shift^-1 tau)  =  (M . shift)(shift^-1 tau)  =  M tau
  //
  // so the screen bearing has to come out the same. That is what compass mode preserves per gesture, so
  // if a rebase perturbs it the view visibly turns as the camera crosses a tile edge.
  const t = new RegularTiling({ p: 8, q: 3, frameSymmetry: 4 });
  for (const target of [[0, 1], [0.6, -0.8], [-1, 0]]) {
    const view = new ViewState({
      zoom: 1,
      rotationMode: ROTATION_COMPASS,
      compassTargetX: target[0],
      compassTargetY: target[1],
    });
    // Somewhere generic, so the bearing is not preserved by accidental symmetry.
    view.beginPan(0.11, -0.07);
    view.updatePan(0.31, 0.19);
    view.commit();

    const before = view.north();
    let worst = 0;
    for (let i = 0; i < 500; i++) {
      view.rebase(t.generator(i % t.generatorCount()));
      let d = Math.abs(view.north() - before);
      d = Math.min(d, 2 * Math.PI - d);
      worst = Math.max(worst, d);
    }
    assert.ok(
      worst < 1e-9,
      `compass bearing moved by ${worst} rad over 500 re-anchors with target ${target}`,
    );
  }
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

test("compass mode survives re-anchoring: north keeps pointing the same way", () => {
  // Compass mode holds a chosen ideal point at a fixed screen bearing. The target is a point in the
  // frame's DOMAIN, so re-anchoring has to carry it along -- otherwise "north" silently becomes a
  // different direction each time the camera changes tile, and the map slowly rotates.
  //
  // For the BINARY tiling this is more than a technicality: its frames are z -> s z + t, which all fix
  // the half-plane's point at infinity, so north is genuinely the same direction in every cell and the
  // compass is a meaningful notion however far you travel.
  for (const [name, tiling] of [["binary", new BinaryTiling()], ["{5,4}", new RegularTiling({ p: 5, q: 4 })]]) {
    const view = new ViewState({ zoom: 1, rotationMode: "compass" });
    const anchor = new Anchor(tiling);
    const start = view.north();
    let worst = 0;
    const rand = rng(1234);
    for (let leg = 0; leg < 20; leg++) {
      const bearing = rand() * Math.PI * 2;
      const gx = 0.35 * Math.cos(bearing);
      const gy = 0.35 * Math.sin(bearing);
      view.beginPan(gx, gy);
      for (let i = 1; i <= 6; i++) {
        // Drag the grabbed point towards the opposite side, in steps.
        view.updatePan(gx - (2 * gx * i) / 6, gy - (2 * gy * i) / 6);
        const { steps, shift } = anchor.reanchor(view.liveMatrix);
        if (steps) view.rebase(shift);
        // Compass mode's whole promise: the target stays at the bearing it had when the drag began.
        worst = Math.max(worst, Math.abs(wrapPi(view.north() - start)));
      }
      view.commit();
    }
    assert.ok(anchor.reanchorCount > 5, `${name}: only ${anchor.reanchorCount} tile crossings`);
    assert.ok(
      worst < 1e-6,
      `${name}: north drifted by ${worst} radians over ${anchor.reanchorCount} crossings`,
    );
  }
});

function wrapPi(a) {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

test("zoom extremes far from the origin behave as they do at it", () => {
  // Zoom is a plain magnification, not an isometry, so it should not interact with the anchoring at all.
  // Checked rather than assumed: the visible radius feeds the walk radius, so a zoom extreme is also a
  // tile-count extreme, and that is where a budget or a truncation bug would show.
  for (const spec of [{ p: 8, q: 3, frameSymmetry: 4 }, { p: 3, q: 7 }]) {
    const t = new RegularTiling(spec);
    const reference = {};
    for (const radius of [0.2, 0.5, 0.8, 0.95, 0.999]) {
      const anchor = new Anchor(t);
      const tiles = anchor.neighbourhood(Isom.identity(), radius, 300);
      reference[radius] = tiles.length;
      assert.ok(tiles.length > 0, `{${spec.p},${spec.q}} radius ${radius}: no tiles`);
      assert.ok(tiles.length <= 300, `{${spec.p},${spec.q}} radius ${radius}: budget exceeded`);
    }
    // The same counts must come out arbitrarily far away.
    for (const walk of [500, 5000]) {
      const anchor = new Anchor(t);
      anchor.address = advanceAddress(t, walk, 700 + walk);
      assert.ok(addressDistance(t, anchor.address) >= walk * 0.25 || walk === 0,
        `the walk did not travel: ${walk} steps reached only ${addressDistance(t, anchor.address).toFixed(2)} hyperbolic units`);
      for (const radius of [0.2, 0.5, 0.8, 0.95, 0.999]) {
        const n = anchor.neighbourhood(Isom.identity(), radius, 300).length;
        assert.equal(
          n,
          reference[radius],
          `{${spec.p},${spec.q}} radius ${radius}: ${n} tiles at ${walk} out vs ${reference[radius]} at the origin`,
        );
      }
    }
  }
});

test("clip auto honours a tile's withinTile promise", () => {
  // `clip: "auto"` exists so a provider that knows its art stays inside the tile can skip the clip and
  // the save/restore around it. Worth pinning because the wrong branch is invisible in the common case:
  // art that already fits looks the same clipped or not, so only art that OVERFLOWS distinguishes them.
  const tiling = new RegularTiling({ p: 5, q: 4 });
  const outside = [[0.9, 0.0], [0.0, 0.9], [-0.9, 0.0]]; // well beyond the tile
  const mk = (clip, withinTile) =>
    new Atlas({
      tiling,
      clip,
      maxTiles: 12,
      tileData: () => ({
        withinTile,
        drawables: [{ type: "path", points: outside, closed: true, fill: "#123456" }],
      }),
    });

  const view = { matrix: Isom.identity(), effectiveRadius: 0.5 };
  const drain = async (atlas) => {
    for (let i = 0; i < 8; i++) {
      atlas.passes(view, () => {});
      if (!atlas.pending.size) break;
      await Promise.all([...atlas.pending.values()]);
    }
    return atlas.passes(view, () => {});
  };

  return (async () => {
    const always = await drain(mk("always", false));
    assert.ok(always.length > 0);
    assert.ok(always.every((p) => typeof p.clip === "function"), '"always" must clip every pass');

    const never = await drain(mk("never", false));
    assert.ok(never.every((p) => p.clip === null), '"never" must clip none');

    const autoNo = await drain(mk("auto", false));
    assert.ok(autoNo.every((p) => typeof p.clip === "function"), '"auto" must clip when withinTile is false');

    const autoYes = await drain(mk("auto", true));
    assert.ok(autoYes.every((p) => p.clip === null), '"auto" must skip the clip when withinTile is true');
  })();
});

test("the tile cache evicts without ever serving another tile's data", () => {
  // Cache keys are a 53-bit hash of the address, not the address string, because the string is thousands
  // of characters far from the origin. That is safe only if distinct tiles get distinct keys, so check
  // it directly over a large neighbourhood -- a collision would silently paint one tile with another's
  // data, which for position-dependent content would be a real corruption.
  for (const spec of [{ p: 8, q: 3, frameSymmetry: 4 }, { p: 5, q: 4 }, { p: 3, q: 7 }]) {
    const t = new RegularTiling(spec);
    const seen = new Map();
    let collisions = 0;
    // Every tile within a wide walk of the origin, plus the same set 5,000 tiles out.
    for (const walk of [0, 5000]) {
      const anchor = new Anchor(t);
      anchor.address = advanceAddress(t, walk, 700 + walk);
      assert.ok(addressDistance(t, anchor.address) >= walk * 0.25 || walk === 0,
        `the walk did not travel: ${walk} steps reached only ${addressDistance(t, anchor.address).toFixed(2)} hyperbolic units`);
      for (const tile of anchor.neighbourhood(Isom.identity(), 0.97, 1500)) {
        const key = t.addressKey(tile.address);
        const str = t.addressToString(tile.address);
        if (seen.has(key) && seen.get(key) !== str) collisions++;
        seen.set(key, str);
      }
    }
    assert.ok(seen.size > 400, `{${spec.p},${spec.q}}: only ${seen.size} distinct keys sampled`);
    assert.equal(collisions, 0, `{${spec.p},${spec.q}}: ${collisions} hash collisions among ${seen.size} tiles`);
  }
  // The binary tiling keys on its canonical string, so collisions are impossible by construction; check
  // the memoisation returns a stable value rather than rebuilding differently.
  const b = new BinaryTiling();
  const addr = { lat: -40n, lon: 123456789012345678901234567890n };
  assert.equal(b.addressKey(addr), b.addressKey(addr));
  assert.equal(b.addressToString(addr), "-40,123456789012345678901234567890");
});

test("synchronous tile data is drawn in the SAME frame, not the next one", () => {
  // The flicker. Going through a promise even for data already in hand costs a frame, and on a {p,q}
  // tiling that frame is visible: word addresses are not canonical, so a re-anchor renames many tiles
  // at once, every renamed tile misses the cache, and every one of them vanishes for exactly one frame.
  // Measured in the browser on {7,3}: 26 tiles disappeared together on the single re-anchor frame.
  const tiling = new RegularTiling({ p: 7, q: 3 });
  const atlas = new Atlas({
    tiling,
    maxTiles: 40,
    checkTileSymmetry: "off",
    tileData: () => ({ drawables: [{ type: "path", points: [[0, 0], [0.1, 0], [0.05, 0.1]], closed: true, fill: "#123456" }] }),
  });
  const view = { matrix: Isom.identity(), effectiveRadius: 0.5, radius: 200 };
  const wanted = atlas.anchor.neighbourhood(Isom.identity(), 0.5, 40).length;
  assert.ok(wanted > 5, `only ${wanted} tiles -- not exercising anything`);
  // The VERY FIRST pass, with a cold cache, must already draw everything.
  const passes = atlas.passes(view, () => {});
  assert.equal(passes.length, wanted, `first frame drew ${passes.length} of ${wanted} tiles`);
  assert.equal(atlas.pending.size, 0, "a synchronous provider should leave nothing pending");
});

test("an asynchronous provider still works, and still resolves", async () => {
  const tiling = new RegularTiling({ p: 5, q: 4 });
  let calls = 0;
  const atlas = new Atlas({
    tiling,
    maxTiles: 12,
    checkTileSymmetry: "off",
    tileData: () => {
      calls++;
      return Promise.resolve({ drawables: [{ type: "path", points: [[0, 0], [0.1, 0], [0.05, 0.1]], closed: true, fill: "#abc" }] });
    },
  });
  const view = { matrix: Isom.identity(), effectiveRadius: 0.5, radius: 200 };
  assert.equal(atlas.passes(view, () => {}).length, 0, "async data cannot be ready on the first frame");
  assert.ok(atlas.pending.size > 0);
  for (let i = 0; i < 8 && atlas.pending.size; i++) await Promise.all([...atlas.pending.values()]);
  assert.ok(atlas.passes(view, () => {}).length > 5, "async data should be drawn once resolved");
  assert.ok(calls > 5);
});

test("compiled art is memoised on the identity of the returned object", () => {
  // What turns a re-anchor from a 125 ms stall into nothing. The walk renames many tiles at once, so
  // they all miss the address-keyed cache together -- but a provider obeying the rule returns one of a
  // few shared objects, and those are already compiled.
  const tiling = new RegularTiling({ p: 8, q: 3, frameSymmetry: 4 });
  const shared = [0, 1, 2].map((k) => ({
    drawables: [{ type: "path", points: [[0, 0], [0.1, 0], [0.05, 0.1]], closed: true, fill: `#00000${k}` }],
  }));
  const atlas = new Atlas({
    tiling, maxTiles: 60, checkTileSymmetry: "off",
    tileData: (t) => shared[t.classIndex % 3],
  });
  const view = { matrix: Isom.identity(), effectiveRadius: 0.5, radius: 200 };
  const passes = atlas.passes(view, () => {});
  assert.ok(passes.length > 5);
  // However many tiles were drawn, there are only three distinct compiled drawable arrays.
  const distinct = new Set(passes.map((p) => p.drawables));
  assert.ok(distinct.size <= 3, `${distinct.size} distinct compiled arrays for 3 shared data objects`);
  // And re-requesting under a brand-new key reuses the compiled entry rather than rebuilding it.
  const before = [...distinct][0];
  atlas.cache.clear();
  const again = atlas.passes(view, () => {});
  assert.ok(again.some((p) => p.drawables === before), "clearing the address cache should not recompile");
});

test("a small tile draws its lod art instead of its full art", () => {
  const tiling = new RegularTiling({ p: 8, q: 3, frameSymmetry: 4 });
  const full = [];
  for (let i = 0; i < 40; i++) full.push({ type: "path", points: [[0, 0], [0.05, 0], [0.02, 0.05]], closed: true, fill: "#111" });
  const data = {
    drawables: full,
    lod: [{ type: "path", points: [[0, 0], [0.3, 0], [0.15, 0.3]], closed: true, fill: "#222" }],
    lodPx: 12,
  };
  const atlas = new Atlas({ tiling, maxTiles: 120, checkTileSymmetry: "off", tileData: () => data });
  // A big canvas: every tile is large, so nothing should be simplified.
  const big = atlas.passes({ matrix: Isom.identity(), effectiveRadius: 0.6, radius: 4000 }, () => {});
  assert.ok(big.length > 5);
  assert.ok(big.every((p) => p.drawables.length === 40), "no tile should use lod art on a huge canvas");
  // A tiny canvas: every tile is small, so all of them should be.
  const small = atlas.passes({ matrix: Isom.identity(), effectiveRadius: 0.6, radius: 20 }, () => {});
  assert.ok(small.length > 5);
  assert.ok(small.every((p) => p.drawables.length === 1), "every tile should use lod art on a tiny canvas");
  // And a realistic one should use both, which is the case that actually happens: the walk reaches the
  // rim, where tiles compress towards a point, so the near ones are large and the far ones are not.
  const mid = atlas.passes({ matrix: Isom.identity(), effectiveRadius: 0.97, radius: 260 }, () => {});
  const lodCount = mid.filter((p) => p.drawables.length === 1).length;
  assert.ok(lodCount > 0 && lodCount < mid.length, `mixed canvas used lod for ${lodCount} of ${mid.length}`);
});

test("a fatal symmetry lint is fatal, and does not degrade to one silently missing tile", () => {
  // The lint's throw used to be raised inside acceptTile, which request() wraps in the try/catch that
  // turns a TILE failure into a skipped tile. So the strictest setting produced the mildest symptom:
  // the first tile requested -- the one under the camera -- was cached empty and never drawn, every
  // later tile skipped the already-run check and drew fine, and the only trace was a console.error.
  // On escher.html that was a single blank octagon in the middle of an otherwise perfect
  // Circle Limit III. A lint and a broken tile are different kinds of failure and must not share a
  // handler.
  const tiling = new RegularTiling({ p: 8, q: 3, frameSymmetry: 4 });
  // Deliberately not C_4-symmetric: one wedge, no rotated copies.
  const lopsided = {
    drawables: [{ type: "path", points: [[0.2, 0], [0.4, 0], [0.3, 0.2]], closed: true, fill: "#123456" }],
  };
  const view = { matrix: Isom.identity(), effectiveRadius: 0.5, radius: 200 };

  const fatal = new Atlas({ tiling, maxTiles: 40, checkTileSymmetry: "throw", tileData: () => lopsided });
  assert.throws(() => fatal.passes(view, () => {}), /not invariant under rotation by 360\/4/);
  // And on EVERY later frame, not just the first. A page that threw once and then rendered would be
  // neither working nor visibly broken.
  assert.throws(() => fatal.passes(view, () => {}), /not invariant under rotation by 360\/4/);
  assert.equal(fatal.cache.size, 0, "a lint failure is about the art, so no tile should be cached empty");

  // "warn" says the same thing and draws everything.
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (m) => warnings.push(String(m));
  let drawn;
  try {
    const lenient = new Atlas({ tiling, maxTiles: 40, checkTileSymmetry: "warn", tileData: () => lopsided });
    drawn = lenient.passes(view, () => {});
    assert.equal(lenient.passes(view, () => {}).length, drawn.length, "the second frame should match the first");
  } finally {
    console.warn = realWarn;
  }
  const wanted = new Atlas({ tiling, maxTiles: 40, checkTileSymmetry: "off", tileData: () => lopsided })
    .passes(view, () => {}).length;
  assert.ok(wanted > 5, `only ${wanted} tiles -- not exercising anything`);
  assert.equal(drawn.length, wanted, `"warn" drew ${drawn.length} of ${wanted} tiles`);
  assert.equal(warnings.length, 1, `warned ${warnings.length} times; the answer is a property of the art`);

  // A tile whose DATA fails is still reported and skipped -- that path must not have been made fatal
  // along with the lint.
  const failures = [];
  const broken = new Atlas({
    tiling, maxTiles: 40, checkTileSymmetry: "off",
    onTileError: (t, err) => failures.push(err),
    tileData: () => { throw new Error("no such tile"); },
  });
  assert.equal(broken.passes(view, () => {}).length, 0);
  assert.ok(failures.length > 5, `${failures.length} tiles reported; a broken tile should be skipped, not thrown`);
});

test("the lint distinguishes a shape that is merely off from one with no counterpart at all", () => {
  // "worst mismatch Infinity" reads like a coordinate blew up. It means the search found no candidate:
  // nothing of the same style with the same point count lies where the rotation sends the shape. That
  // is what a C_2 COLOURING of C_4 outlines looks like -- four fish rotate onto each other but are
  // painted four different colours -- and it is a different thing to go and fix.
  const wedge = (a) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [[0.3, 0], [0.4, 0.05], [0.35, 0.15]].map(([x, y]) => [x * c - y * s, x * s + y * c]);
  };
  const quarter = [0, 1, 2, 3].map((k) => (k * Math.PI) / 2);

  // Same colour everywhere and exactly rotated: clean.
  const exact = quarter.map((a) => ({ type: "path", points: wedge(a), closed: true, fill: "#0a0" }));
  assert.ok(tileSymmetryResidual(exact, 4).residual < 1e-12, "an exactly rotated wedge is invariant to float noise");

  // Same colour, one corner nudged: a finite, quotable residual.
  const nudged = exact.map((d, i) => (i === 2 ? { ...d, points: d.points.map(([x, y], j) => (j === 0 ? [x + 0.002, y] : [x, y])) } : d));
  const off = tileSymmetryResidual(nudged, 4);
  assert.ok(off.residual > 1e-6 && off.residual < 0.01, `residual ${off.residual} should be small and finite`);
  assert.match(tileSymmetryMessage(off.residual, 4, "{8,3}", off.offender), /worst mismatch 2\.00e-3/);

  // Exact outlines, four different colours: no counterpart at all.
  const recoloured = quarter.map((a, k) => ({ type: "path", points: wedge(a), closed: true, fill: `#0a${k}` }));
  const none = tileSymmetryResidual(recoloured, 4);
  assert.equal(none.residual, Infinity);
  const msg = tileSymmetryMessage(none.residual, 4, "{8,3}", none.offender);
  assert.match(msg, /no counterpart at all \(drawable \d\)/);
  assert.doesNotMatch(msg, /Infinity/);
});

test("the atlas hands a tile its color-symmetry element, and tiles sharing one share compiled art", () => {
  // A repeating atlas returns one of a FEW data objects, and the compile memo keys on their identity.
  // A colour symmetry has to preserve that: there are twelve colourings of the whole plane and no more,
  // so twelve compiled copies is the whole cost, however far you scroll.
  const mul = (a, b) => a.map((_, i) => a[b[i]]);
  const inv = (a) => { const r = a.slice(); a.forEach((v, i) => { r[v] = i; }); return r; };
  const P = [1, 0, 3, 2];
  const gens = new Array(8);
  gens[0] = [2, 0, 1, 3];
  gens[1] = inv(gens[0]);
  for (let g = 0; g < 6; g++) gens[g + 2] = mul(mul(P, gens[g]), inv(P));
  const tiling = new RegularTiling({
    p: 8, q: 3, frameSymmetry: 4,
    colorSymmetry: { colors: 4, generators: gens, stabiliser: P },
  });
  const PALETTE = ["#ffeeaa", "#afe9af", "#ffaaaa", "#afc6e9"];
  const variants = new Map();
  const seenTiles = [];
  const atlas = new Atlas({
    tiling, maxTiles: 200, checkTileSymmetry: "off",
    tileData: (t) => {
      seenTiles.push(t);
      let v = variants.get(t.colorIndex);
      if (!v) {
        // Exactly what the demo does: the drawable's fill is a ROLE, resolved through this tile's
        // permutation.
        v = { drawables: [0, 1, 2, 3].map((role) => ({
          type: "path", closed: true, fill: PALETTE[t.colorPermutation[role]],
          points: [[0, 0], [0.1 * (role + 1), 0], [0.05, 0.1]],
        })) };
        variants.set(t.colorIndex, v);
      }
      return v;
    },
  });
  const passes = atlas.passes({ matrix: Isom.identity(), effectiveRadius: 0.96, radius: 400 }, () => {});
  assert.ok(passes.length > 40, `only ${passes.length} tiles drawn`);

  // Every tile was told its element, consistently with the tiling itself.
  assert.equal(seenTiles.length, passes.length);
  for (const t of seenTiles) {
    assert.equal(t.colorCount, 12);
    assert.equal(t.colorIndex, tiling.colorIndex(t.address));
    assert.deepEqual(t.colorPermutation, tiling.colorPermutation(t.address));
  }
  const indices = new Set(seenTiles.map((t) => t.colorIndex));
  assert.ok(indices.size > 6, `only ${indices.size} of 12 colourings appeared in one view`);

  // ...and the compiled art collapses to one array per colouring, not one per tile.
  const distinct = new Set(passes.map((p) => p.drawables));
  assert.equal(distinct.size, indices.size,
    `${distinct.size} compiled arrays for ${indices.size} colourings -- the memo is not hitting`);

  // A tiling without one reports null rather than a fake identity, so art can tell the difference.
  const plain = new Atlas({
    tiling: new RegularTiling({ p: 7, q: 3 }), maxTiles: 8, checkTileSymmetry: "off",
    tileData: (t) => {
      assert.equal(t.colorPermutation, null);
      assert.equal(t.colorCount, 1);
      return { drawables: [{ type: "path", points: [[0, 0], [0.1, 0], [0.05, 0.1]], closed: true, fill: "#123" }] };
    },
  });
  assert.ok(plain.passes({ matrix: Isom.identity(), effectiveRadius: 0.4, radius: 200 }, () => {}).length > 0);
});
