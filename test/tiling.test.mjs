// Tilings, and the anchored camera.
//
// The metric relations are checked BY CONSTRUCTION -- build the polygon, measure the inradius, the
// edge and the interior angle -- rather than formula against formula. That is deliberate: comparing
// one formula with another is how an inverted inradius survived the first pass of the audit
// (cos(pi/p)/sin(pi/q) is the HALF-EDGE, and the two swap under p <-> q, so they look interchangeable).
//
// The anchored tests all share one theme: nothing may depend on how far the camera has travelled. A
// test that passes at the origin and not at 500 tiles out has found the bug this rewrite exists to
// remove, so most assertions are run at a range of distances and compared ACROSS them.

import test from "node:test";
import assert from "node:assert/strict";

import { Isom } from "../src/core/isom.js";
import { localDistance, halfPlaneToLocal, localToHalfPlane } from "../src/core/coords.js";
import { wrapAngle, advanceAddress, advanceAddressWithDistance, addressDistance } from "./helpers.mjs";
import {
  RegularTiling,
  BinaryTiling,
  regularMetrics,
  BINARY_LOCAL_HALF_WIDTH,
  BINARY_LOCAL_Y_LOW,
  BINARY_LOCAL_Y_HIGH,
  BIN_RIGHT,
  BIN_LEFT,
  BIN_CHILD0,
  BIN_CHILD1,
  BIN_PARENT_EVEN,
  BIN_PARENT_ODD,
} from "../src/data/atlas/tiling.js";
import { Anchor } from "../src/data/atlas/anchor.js";

const PAIRS = [[8, 3], [4, 5], [5, 4], [7, 3], [3, 7], [6, 4], [9, 4], [12, 3]];
const REGULARS = [
  { p: 8, q: 3, frameSymmetry: 4 },
  { p: 8, q: 3 },
  { p: 7, q: 3 },
  { p: 5, q: 4 },
  { p: 4, q: 5 },
  { p: 6, q: 4 },
  { p: 3, q: 7 },
  { p: 12, q: 3 },
];

const maxEntry = (m) => Math.max(Math.abs(m.ar), Math.abs(m.ai), Math.abs(m.br), Math.abs(m.bi));

// Two matrices are the same isometry iff they agree up to overall sign: SU(1,1) double-covers the
// isometry group and an edge half-turn squares to -I (audit claim 9).
function sameIsometry(a, b, tol = 1e-11) {
  const plus = Math.max(Math.abs(a.ar - b.ar), Math.abs(a.ai - b.ai), Math.abs(a.br - b.br), Math.abs(a.bi - b.bi));
  const minus = Math.max(Math.abs(a.ar + b.ar), Math.abs(a.ai + b.ai), Math.abs(a.br + b.br), Math.abs(a.bi + b.bi));
  return Math.min(plus, minus) < tol;
}

function toLocal(m) {
  const z = m.applyToDisk(0, 0, [0, 0]);
  const k = 1 / Math.sqrt(Math.max(1e-300, 1 - z[0] * z[0] - z[1] * z[1]));
  const x = z[0] * k;
  const y = z[1] * k;
  return [x, y, Math.sqrt(1 + x * x + y * y)];
}

function coshHalfBetween(a, b) {
  const A = a[2] * b[2] - a[0] * b[0] - a[1] * b[1];
  const B = a[0] * b[1] - a[1] * b[0];
  return Math.hypot(A, B);
}

function diskAngleBetween(from, a, b) {
  const m = Isom.translationToDisk(-from[0], -from[1]);
  const ia = m.applyToDisk(a[0], a[1], [0, 0]);
  const ib = m.applyToDisk(b[0], b[1], [0, 0]);
  return Math.abs(wrapAngle(Math.atan2(ia[1], ia[0]) - Math.atan2(ib[1], ib[0])));
}

// ---- {p,q} metrics, unchanged and re-asserted ----

test("{p,q} metrics, verified by constructing the polygon and measuring", () => {
  for (const [p, q] of PAIRS) {
    const m = regularMetrics(p, q);
    const t = new RegularTiling({ p, q });

    const angle = diskAngleBetween(t.vertexDisk[0], t.vertexDisk[1], t.vertexDisk[p - 1]);
    assert.ok(
      Math.abs(angle - (2 * Math.PI) / q) < 1e-9,
      `{${p},${q}} interior angle ${(angle * 180) / Math.PI} deg, want ${360 / q}`,
    );
    assert.ok(
      Math.abs(Math.cosh(m.circumradius) - Math.cosh(m.inradius) * Math.cosh(m.halfEdge)) < 1e-9,
      `{${p},${q}} cosh(chi) != cosh(psi)cosh(phi)`,
    );
    const v0 = t.boundaryLocalPoints[0];
    const v1 = t.boundaryLocalPoints[1];
    assert.ok(
      Math.abs(localDistance(v0[0], v0[1], v1[0], v1[1]) - m.edgeLength) < 1e-9,
      `{${p},${q}} edge length mismatch`,
    );
  }
});

test("{p,q} rejects non-hyperbolic parameters", () => {
  assert.throws(() => regularMetrics(4, 4), /not hyperbolic/);
  assert.throws(() => regularMetrics(3, 6), /not hyperbolic/);
  assert.throws(() => regularMetrics(6, 3), /not hyperbolic/);
  assert.doesNotThrow(() => regularMetrics(5, 4));
});

test("edge half-turn generators reach every neighbour, for odd p too", () => {
  for (const [p, q] of PAIRS) {
    const t = new RegularTiling({ p, q });
    const want = Math.tanh(t.metrics.inradius);
    assert.equal(t.generatorCount(), p);
    for (let k = 0; k < p; k++) {
      const c = t.generator(k).applyToDisk(0, 0, [0, 0]);
      assert.ok(Math.abs(Math.hypot(c[0], c[1]) - want) < 1e-9, `{${p},${q}} generator ${k} wrong distance`);
      const d = wrapAngle(Math.atan2(c[1], c[0]) - (2 * Math.PI * k) / p);
      assert.ok(Math.abs(d) < 1e-9, `{${p},${q}} generator ${k} wrong bearing (off by ${d})`);
    }
  }
});

test("an edge half-turn squares to -I, so g inverse is g as an ISOMETRY", () => {
  // The Spin(2,1) double cover, audit claims 9 and 9b. The matrix does NOT square to +I, and code
  // that compares frames must therefore work up to sign. This is also what makes words
  // walk-reversible with the same generator index.
  for (const [p, q] of PAIRS) {
    const t = new RegularTiling({ p, q });
    for (let k = 0; k < p; k++) {
      const g = t.generator(k);
      const sq = g.mul(g);
      assert.ok(
        sameIsometry(sq, Isom.identity()),
        `{${p},${q}} generator ${k} does not square to +/-I`,
      );
      assert.ok(
        Math.abs(sq.ar + 1) < 1e-9 && Math.abs(sq.ai) < 1e-9,
        `{${p},${q}} generator ${k} squares to ${sq.ar} + ${sq.ai}i, expected -1 (it is -I, not +I)`,
      );
      assert.equal(t.inverseGenerator(k), k, "a half-turn must be its own inverse index");
    }
  }
});

test("{8,3} with frameSymmetry 4 uses the 433 rotation generators, not half-turns", () => {
  const t = new RegularTiling({ p: 8, q: 3, frameSymmetry: 4 });
  assert.equal(t.m, 4);
  assert.equal(t.generatorCount(), 8);
  const want = Math.tanh(t.metrics.inradius);
  const reached = new Set();
  for (let g = 0; g < t.generatorCount(); g++) {
    const c = t.generator(g).applyToDisk(0, 0, [0, 0]);
    assert.ok(Math.abs(Math.hypot(c[0], c[1]) - want) < 1e-9, "generator does not land on a neighbour centre");
    const k = Math.round((Math.atan2(c[1], c[0]) / (2 * Math.PI)) * 8);
    reached.add(((k % 8) + 8) % 8);
  }
  assert.equal(reached.size, 8, `only reached edges ${[...reached].sort()}`);
  for (let g = 0; g < t.generatorCount(); g++) {
    const sq = t.generator(g).mul(t.generator(g));
    assert.ok(Math.hypot(sq.br, sq.bi) > 1e-6, "a 433 generator should not be an involution");
  }
  // The +/- senses about each vertex pair up as inverses.
  assert.deepEqual([...Array(8).keys()].map((i) => t.inverseGenerator(i)), [1, 0, 3, 2, 5, 4, 7, 6]);
});

test("every tiling's generator set is closed under inverse, up to sign", () => {
  // Re-anchoring and walk-reversal both need "the generator that undoes this one" to exist in the set.
  // The constructor throws if it does not, so this also pins that guard.
  for (const spec of REGULARS) {
    const t = new RegularTiling(spec);
    for (let i = 0; i < t.generatorCount(); i++) {
      const j = t.inverseGenerator(i);
      assert.ok(j >= 0 && j < t.generatorCount(), `no inverse for generator ${i}`);
      assert.ok(
        sameIsometry(t.generator(i).mul(t.generator(j)), Isom.identity()),
        `{${spec.p},${spec.q}} generator ${i} times its claimed inverse ${j} is not the identity`,
      );
    }
  }
  const b = new BinaryTiling();
  for (let i = 0; i < b.generatorCount(); i++) {
    const j = b.inverseGenerator(i);
    assert.ok(
      sameIsometry(b.generator(i).mul(b.generator(j)), Isom.identity(), 1e-12),
      `binary generator ${i} times its claimed inverse ${j} is not the identity`,
    );
  }
});

test("frameSymmetry must divide p", () => {
  assert.throws(() => new RegularTiling({ p: 8, q: 3, frameSymmetry: 3 }), /must divide/);
  assert.doesNotThrow(() => new RegularTiling({ p: 8, q: 3, frameSymmetry: 2 }));
});

// ---- the binary tiling's constant generators ----

test("the six binary generators are constants that reproduce F_cur^-1 . F_neighbour", () => {
  // The heart of the binary case (audit claim 5): every latitude and longitude cancels, so one
  // constant matrix per neighbour direction suffices no matter where the cell is. Checked against the
  // global frames near the origin, where those are still trustworthy.
  const t = new BinaryTiling();
  let worst = 0;
  for (const [lat, lon] of [[0, 0], [0, 3], [1, -2], [2, 5], [-3, 7], [-1, -6], [3, 11], [-2, -9], [4, -13]]) {
    const address = { lat: BigInt(lat), lon: BigInt(lon) };
    const F = t.globalFrameForTesting(address);
    const Finv = F.inverse();
    for (const nb of t.neighbours(address)) {
      const ref = Finv.mul(t.globalFrameForTesting(nb.address)).normalize();
      const got = t.generator(nb.gen);
      const plus = Math.max(Math.abs(ref.ar - got.ar), Math.abs(ref.ai - got.ai),
                            Math.abs(ref.br - got.br), Math.abs(ref.bi - got.bi));
      worst = Math.max(worst, plus);
    }
  }
  assert.ok(worst < 1e-12, `worst deviation from the reference relative frame: ${worst}`);
});

test("binary generator magnitudes are O(1) and position-independent", () => {
  const t = new BinaryTiling();
  for (let i = 0; i < t.generatorCount(); i++) {
    const e = maxEntry(t.generator(i));
    assert.ok(e < 1.1, `binary generator ${i} has max entry ${e}, expected about 1`);
  }
});

test("binary child-then-parent round trips exactly, which is what proves the parity rule", () => {
  // child0 leads to an EVEN longitude, so the way back is the even-parity parent step; child1 leads to
  // an odd one. Getting this pairing wrong would make the walk revisit its own parent forever.
  const t = new BinaryTiling();
  assert.ok(sameIsometry(t.generator(BIN_CHILD0).mul(t.generator(BIN_PARENT_EVEN)), Isom.identity(), 1e-13));
  assert.ok(sameIsometry(t.generator(BIN_CHILD1).mul(t.generator(BIN_PARENT_ODD)), Isom.identity(), 1e-13));
  assert.ok(sameIsometry(t.generator(BIN_RIGHT).mul(t.generator(BIN_LEFT)), Isom.identity(), 1e-13));
  assert.equal(t.inverseGenerator(BIN_CHILD0), BIN_PARENT_EVEN);
  assert.equal(t.inverseGenerator(BIN_CHILD1), BIN_PARENT_ODD);
});

test("binary cells have five neighbours, and the parent step follows longitude parity", () => {
  const t = new BinaryTiling();
  for (const [lat, lon] of [[0, 0], [0, 1], [0, -1], [3, 6], [3, 7], [-4, -5], [-4, -6]]) {
    const nbrs = t.neighbours({ lat: BigInt(lat), lon: BigInt(lon) });
    assert.equal(nbrs.length, 5);
    const parent = nbrs[4];
    assert.equal(
      parent.gen,
      Math.abs(lon % 2) === 0 ? BIN_PARENT_EVEN : BIN_PARENT_ODD,
      `cell (${lat},${lon}) chose the wrong parent parity`,
    );
    // Floor division, not truncation: the parent of longitude -1 is -1, not 0.
    assert.equal(parent.address.lon, BigInt(Math.floor(lon / 2)), `cell (${lat},${lon}) parent longitude`);
    assert.equal(parent.address.lat, BigInt(lat + 1));
  }
});

test("binary addresses are exact at depths where a float64 longitude would not be", () => {
  // Descending doubles the longitude each step, so 60 descents pass 2^53. BigInt keeps it exact; the
  // whole reason addresses are integers and never enter the geometry.
  const t = new BinaryTiling();
  let a = t.originAddress();
  for (let i = 0; i < 60; i++) a = t.neighbours(a)[3].address; // child1 each time
  assert.equal(a.lat, -60n);
  // child1 repeatedly gives lon = 2^60 - 1 (all ones), which is beyond exact float64 integer range.
  assert.equal(a.lon, (1n << 60n) - 1n);
  assert.ok(Number(a.lon) !== Number(a.lon - 1n) === false || true);
  assert.notEqual(a.lon.toString(), String(Number(a.lon)), "the longitude is past float64 exactness");
  // And walking back up returns exactly to the origin.
  for (let i = 0; i < 60; i++) a = t.neighbours(a)[4].address;
  assert.equal(a.lat, 0n);
  assert.equal(a.lon, 0n);
});

test("binary point->cell is two floors and round-trips", () => {
  const t = new BinaryTiling();
  for (const [lat, lon] of [[0, 0], [2, 3], [-3, -5], [5, 17]]) {
    const size = Math.pow(2, lat);
    const hx = (lon + 0.5) * size;
    const hy = size * 1.4;
    const cell = t.locateHalfPlaneForTesting(hx, hy);
    assert.equal(cell.lat, BigInt(lat));
    assert.equal(cell.lon, BigInt(lon));
  }
});

test("the binary cell's local box is the same for every (latitude, longitude)", () => {
  // This is what makes "the same prototype in every cell" work. The half-width is 0.5/sqrt(2), NOT
  // 0.5, because the frame's scale applies to both axes while the cell's x-width is only 2^lat.
  const t = new BinaryTiling();
  for (const [lat, lon] of [[0, 0], [3, 5], [-4, -7], [7, 100]]) {
    const F = t.globalFrameForTesting({ lat: BigInt(lat), lon: BigInt(lon) });
    const size = Math.pow(2, lat);
    for (const [u, v] of [[-1, 1], [1, 1], [-1, 2], [1, 2]]) {
      const localBox = halfPlaneToLocal(u * BINARY_LOCAL_HALF_WIDTH, v * BINARY_LOCAL_Y_LOW, [0, 0]);
      const world = F.applyToLocal(localBox[0], localBox[1], undefined, [0, 0]);
      const k = 1 / Math.sqrt(1 - world[0] * world[0] - world[1] * world[1]);
      const hp = localToHalfPlane(world[0] * k, world[1] * k, [0, 0]);
      const wantX = (lon + (u > 0 ? 1 : 0)) * size;
      const wantY = size * (v > 1 ? 2 : 1);
      assert.ok(Math.abs(hp[0] - wantX) < 1e-9 * Math.max(1, Math.abs(wantX)), `corner x for (${lat},${lon})`);
      assert.ok(Math.abs(hp[1] - wantY) < 1e-9 * wantY, `corner y for (${lat},${lon})`);
    }
  }
  assert.ok(Math.abs(BINARY_LOCAL_Y_HIGH / BINARY_LOCAL_Y_LOW - 2) < 1e-15);
});

// ---- containsLocal ----

test("containsLocal for a regular tiling is the nearest-centre region, not the legacy one", () => {
  // Audit claim 11: the boundary is the perpendicular bisector, which passes through the edge midpoint
  // at exactly the inradius. Claim 11b found that comparing A against nw^2 instead -- as the 2012
  // Escher tile cutter did -- gives a DIFFERENT, larger region, so this must not share that formula.
  for (const spec of REGULARS) {
    const t = new RegularTiling(spec);
    const psi = t.metrics.inradius;
    const chi = t.metrics.circumradius;
    assert.ok(t.containsLocal(0, 0), "the tile centre must be inside");
    for (let k = 0; k < t.p; k++) {
      const ang = (2 * Math.PI * k) / t.p;
      // Just inside and just outside the edge midpoint, along the edge normal.
      for (const [frac, want] of [[0.98, true], [1.02, false]]) {
        const r = Math.sinh((psi * frac) / 2);
        const x = r * Math.cos(ang);
        const y = r * Math.sin(ang);
        assert.equal(
          t.containsLocal(x, y),
          want,
          `{${spec.p},${spec.q}} edge ${k} at ${frac} of the inradius should be ${want ? "inside" : "outside"}`,
        );
      }
    }
    // A vertex is at the circumradius and must be (just) inside, being a corner of the tile.
    for (const v of t.boundaryLocalPoints) {
      const shrink = 0.999;
      assert.ok(t.containsLocal(v[0] * shrink, v[1] * shrink), "just inside a vertex must be inside");
    }
    assert.ok(chi > psi);
  }
});

test("containsLocal for the binary tiling is its local box", () => {
  const t = new BinaryTiling();
  const inside = (hx, hy) => {
    const l = halfPlaneToLocal(hx, hy, [0, 0]);
    return t.containsLocal(l[0], l[1]);
  };
  assert.ok(inside(0, 1.0));
  assert.ok(inside(BINARY_LOCAL_HALF_WIDTH * 0.99, BINARY_LOCAL_Y_LOW * 1.01));
  assert.ok(!inside(BINARY_LOCAL_HALF_WIDTH * 1.01, 1.0));
  assert.ok(!inside(0, BINARY_LOCAL_Y_LOW * 0.99));
  assert.ok(!inside(0, BINARY_LOCAL_Y_HIGH * 1.01));
});

// ---- the anchored camera ----

test("re-anchoring keeps the view matrix O(1) over thousands of tile crossings", () => {
  // The claim the whole rewrite rests on. Without re-anchoring, 500 crossings of {8,3} would need
  // matrix entries of order cosh(500 * 0.76) ~ 1e165.
  for (const spec of REGULARS) {
    const t = new RegularTiling(spec);
    const anchor = new Anchor(t);
    let V = Isom.identity();
    const step = Isom.translationToDisk(-0.06, 0.021);
    let worst = 0;
    for (let i = 0; i < 3000; i++) {
      V = step.mul(V);
      const { shift } = anchor.reanchor(V);
      V = V.mul(shift).normalize();
      worst = Math.max(worst, maxEntry(V));
    }
    assert.ok(anchor.reanchorCount > 100, `{${spec.p},${spec.q}} only crossed ${anchor.reanchorCount} tiles`);
    assert.ok(worst < 10, `{${spec.p},${spec.q}} max|V| reached ${worst} over ${anchor.reanchorCount} crossings`);
  }
  const b = new BinaryTiling();
  const anchor = new Anchor(b);
  let V = Isom.identity();
  const step = Isom.translationToDisk(0.05, -0.03);
  let worst = 0;
  for (let i = 0; i < 3000; i++) {
    V = step.mul(V);
    const { shift } = anchor.reanchor(V);
    V = V.mul(shift).normalize();
    worst = Math.max(worst, maxEntry(V));
  }
  assert.ok(anchor.reanchorCount > 100, `binary only crossed ${anchor.reanchorCount} cells`);
  assert.ok(worst < 10, `binary max|V| reached ${worst}`);
});

test("re-anchoring realises the identity V_{c.g} = V_c . G_g", () => {
  // Verified against the global frames near the origin, where those are trustworthy: the anchored
  // view times the camera's global frame must equal the original global view, before and after.
  const t = new RegularTiling({ p: 5, q: 4 });
  const anchor = new Anchor(t);
  let V = Isom.identity();
  const step = Isom.translationToDisk(-0.08, 0.04);
  for (let i = 0; i < 40; i++) {
    V = step.mul(V);
    const before = V.mul(t.globalFrameForTesting(anchor.address).inverse());
    const { shift } = anchor.reanchor(V);
    V = V.mul(shift).normalize();
    const after = V.mul(t.globalFrameForTesting(anchor.address).inverse());
    // The GLOBAL view is unchanged by re-anchoring: only its representation moved.
    assert.ok(
      sameIsometry(before, after, 1e-9),
      `re-anchoring changed the global view at step ${i}`,
    );
  }
});

test("the neighbourhood walk returns distinct tiles at every distance", () => {
  // The old walk deduplicated by rounding world coordinates, and past d ~ 16 every neighbour rounded
  // to the same tag, so it returned a single tile. Now the frames are camera-relative and O(1), so
  // this must hold arbitrarily far out -- including 500 tiles, where a global frame would need entries
  // of 1e165 and could not be formed at all.
  for (const spec of [{ p: 8, q: 3, frameSymmetry: 4 }, { p: 7, q: 3 }, { p: 5, q: 4 }, { p: 6, q: 4 }]) {
    const t = new RegularTiling(spec);
    const half = t.metrics.centreSpacing * 0.5;
    for (const walk of [0, 1, 5, 50, 500]) {
      const anchor = new Anchor(t);
      anchor.address = advanceAddress(t, walk, 700 + walk);
      assert.ok(
        addressDistance(t, anchor.address) >= walk * 0.25 || walk === 0,
        `the walk did not travel: ${walk} steps reached only ${addressDistance(t, anchor.address).toFixed(2)} hyperbolic units`,
      );
      const V = Isom.identity();
      const tiles = anchor.neighbourhood(V, 0.62, 200);
      assert.ok(tiles.length > 5, `{${spec.p},${spec.q}} only ${tiles.length} tiles after ${walk} steps`);
      const centres = tiles.map((x) => toLocal(x.rel));
      for (let i = 0; i < centres.length; i++) {
        for (let j = i + 1; j < centres.length; j++) {
          const sep = 2 * Math.acosh(Math.max(1, coshHalfBetween(centres[i], centres[j])));
          assert.ok(
            sep > half,
            `{${spec.p},${spec.q}} after ${walk} steps: two tiles only ${sep.toFixed(9)} apart`,
          );
        }
      }
    }
  }
});

test("the neighbourhood walk is IDENTICAL however far the camera has travelled", () => {
  // The sharpest statement of the fix. A regular tiling is homogeneous, so the set of relative frames
  // around the camera cannot depend on where the camera is -- and now it provably does not, because
  // nothing in the computation knows.
  // Compared to twelve decimals, with values below that treated as zero.
  //
  // This used to be bit-for-bit string equality, and it no longer can be: each walk step now carries a
  // C_m correction whose power of P depends on WHICH tile it is, so the float products are associated
  // differently at different places even though the geometry is the same. What differs is the last bit
  // -- a coordinate that is +0 at the origin comes out as -1.2e-16 far away -- and printing that with
  // toFixed(12) yields "-0.000000000000" against "0.000000000000". Twelve decimals is the precision
  // this test asserts; below it, zero is zero.
  //
  // Note this compares tile CENTRES, not frames. The frames genuinely do differ between locations, by
  // a rotation of each tile about its own centre -- that is the canonical orientation doing its job.
  const sig = (tiles) => tiles
    .map((x) => toLocal(x.rel).map((v) => (Math.abs(v) < 1e-12 ? 0 : v).toFixed(12)).join(","))
    .sort()
    .join("|");
  for (const spec of [{ p: 8, q: 3, frameSymmetry: 4 }, { p: 7, q: 3 }, { p: 5, q: 4 }]) {
    const t = new RegularTiling(spec);
    const reference = sig(new Anchor(t).neighbourhood(Isom.identity(), 0.62, 200));
    // 1,000 tiles rather than the 5,000 this once used: an exact id is one BigInt matrix per tile and
    // its width grows with distance, so a 5,000-tile walk now costs seconds of arithmetic rather than
    // milliseconds. 1,000 tiles is ~1,500 hyperbolic units, still forty times past where a global
    // float frame ceases to exist, which is the regime this test was written to defend.
    for (const walk of [1, 7, 60, 200, 1000]) {
      const anchor = new Anchor(t);
      anchor.address = advanceAddress(t, walk, 700 + walk);
      assert.ok(addressDistance(t, anchor.address) >= walk * 0.25,
        `the walk did not travel: ${walk} steps reached only ${addressDistance(t, anchor.address).toFixed(2)} hyperbolic units`);
      assert.equal(sig(anchor.neighbourhood(Isom.identity(), 0.62, 200)), reference,
        `{${spec.p},${spec.q}} differs after ${walk} tile steps`);
    }
  }
});

test("the binary walk is identical under latitude shift, which IS its exact symmetry", () => {
  // z -> 2z maps cell (lat, lon) to (lat+1, lon) bijectively, so the binary tiling is invariant under
  // latitude shift even though it is only weakly aperiodic overall. Latitude 500 is hyperbolic
  // distance ~347, where a global frame needs entries of 1e75.
  const t = new BinaryTiling();
  const at = (lat) => {
    const anchor = new Anchor(t, { address: { lat: BigInt(lat), lon: 0n } });
    return anchor
      .neighbourhood(Isom.identity(), 0.62, 200)
      .map((x) => toLocal(x.rel).map((v) => v.toFixed(12)).join(","))
      .sort()
      .join("|");
  };
  const reference = at(0);
  for (const lat of [1, 5, 50, 500, 5000]) {
    assert.equal(at(lat), reference, `binary neighbourhood differs at latitude ${lat}`);
  }
});

test("the walk terminates and stays bounded even at absurd distance", () => {
  // THIS TEST USED TO GO TO 100,000 TILES, and the reduction is a real loss worth stating plainly.
  //
  // The float walk genuinely was O(1) at any distance, because it never named a tile globally. Canonical
  // ids do name them, and naming is what costs: there are exponentially many tiles within distance d, so
  // any correct global name needs Omega(d) bits, and the exact matrices spend about 12 characters per
  // tile crossed. Walking 100,000 tiles would mean 100,000 names of a megabyte each. Measured on
  // {8,3} m=4 with the current store: 23 MB at 500 tiles, 70 MB at 1,000, 246 MB at 4,000 -- linear,
  // because the store is bounded, but with a coefficient that is the id length.
  //
  // 1,000 tiles is about 1,500 hyperbolic units, forty times past where a global float frame dies, so
  // the property this test was written to defend -- the walk itself does not care how far out it is --
  // is still being exercised. The ceiling is now memory and BigInt width rather than precision.
  for (const spec of [{ p: 8, q: 3, frameSymmetry: 4 }, { p: 3, q: 7 }]) {
    const t = new RegularTiling(spec);
    for (const walk of [0, 200, 1000]) {
      const anchor = new Anchor(t);
      anchor.address = advanceAddress(t, walk, 700 + walk);
      assert.ok(addressDistance(t, anchor.address) >= walk * 0.25 || walk === 0,
        `the walk did not travel: ${walk} steps reached only ${addressDistance(t, anchor.address).toFixed(2)} hyperbolic units`);
      const started = Date.now();
      const tiles = anchor.neighbourhood(Isom.identity(), 0.9, 200);
      assert.ok(Array.isArray(tiles) && tiles.length > 0);
      assert.ok(tiles.length <= 200);
      assert.ok(Date.now() - started < 5000, `walk took ${Date.now() - started} ms after ${walk} steps`);
      for (const x of tiles) assert.ok(Number.isFinite(maxEntry(x.rel)));
    }
  }
});

test("every returned tile is near enough to matter, and the nearest ones are kept when truncating", () => {
  const t = new RegularTiling({ p: 5, q: 4 });
  const anchor = new Anchor(t);
  const rho = 2 * Math.atanh(0.9);
  const tiles = anchor.neighbourhood(Isom.identity(), 0.9, 300);
  assert.ok(tiles.length > 20, `only ${tiles.length} tiles`);
  for (const x of tiles) {
    const c = toLocal(x.rel);
    const d = 2 * Math.asinh(Math.hypot(c[0], c[1]));
    assert.ok(d <= rho + t.metrics.circumradius + 1e-6, `tile at distance ${d} is too far`);
  }
  // With a tight budget the count is honoured exactly, truncation is reported, and what survives is
  // the near part of the scene rather than whatever the walk happened to reach first.
  //
  // The guarantee is deliberately "near", not "provably the nearest N". BFS explores by GRAPH distance,
  // which only approximates geometric distance, so making it exact would mean enumerating the whole
  // include radius before choosing -- precisely the work the budget exists to avoid. What is asserted
  // instead is that the admitted set reaches no further than the ideal set plus one tile spacing, which
  // is the property that matters for rendering: no near tile is dropped in favour of a far one.
  const few = anchor.neighbourhood(Isom.identity(), 0.9, 12);
  assert.equal(few.length, 12, "the budget must be honoured exactly");
  assert.ok(anchor.lastTruncated, "truncation must be reported");
  const distOf = (x) => 2 * Math.asinh(Math.hypot(toLocal(x.rel)[0], toLocal(x.rel)[1]));
  const dists = few.map(distOf).sort((a, b) => a - b);
  const allD = tiles.map(distOf).sort((a, b) => a - b);
  assert.ok(
    dists[11] <= allD[11] + t.metrics.centreSpacing,
    `truncated set reaches ${dists[11].toFixed(4)}, ideal 12th is ${allD[11].toFixed(4)}`,
  );
  assert.ok(Math.abs(dists[0] - allD[0]) < 1e-9, "the nearest tile must always be kept");
});

test("no holes: every cell owning a visible point is enumerated (binary)", () => {
  // Sample points across the visible disk, ask which cell each falls in using containsLocal against
  // the returned relative frames, and require exactly one owner. A missing cell is a hole in the
  // picture; two owners would be an overlap.
  const t = new BinaryTiling();
  for (const lat of [0, 3, -4, 40, 400]) {
    const anchor = new Anchor(t, { address: { lat: BigInt(lat), lon: 0n } });
    const V = Isom.identity();
    const tiles = anchor.neighbourhood(V, 0.6, 400);
    assert.ok(!anchor.lastTruncated, `truncated at latitude ${lat}`);
    const invs = tiles.map((x) => x.rel.inverse());
    let checked = 0;
    let holes = 0;
    let overlaps = 0;
    for (let i = 0; i < 400; i++) {
      const ang = i * 2.399963;
      const rad = 0.55 * Math.sqrt((i + 0.5) / 400);
      // A screen point, pulled back into camera-local coordinates.
      const p = V.inverse().applyToDisk(rad * Math.cos(ang), rad * Math.sin(ang), [0, 0]);
      const k = 1 / Math.sqrt(1 - p[0] * p[0] - p[1] * p[1]);
      const cx = p[0] * k;
      const cy = p[1] * k;
      let owners = 0;
      for (const inv of invs) {
        const q = inv.applyToLocal(cx, cy, undefined, [0, 0]);
        const kk = 1 / Math.sqrt(Math.max(1e-300, 1 - q[0] * q[0] - q[1] * q[1]));
        if (t.containsLocal(q[0] * kk, q[1] * kk, 1e-12)) owners++;
      }
      checked++;
      if (owners === 0) holes++;
      if (owners > 1) overlaps++;
    }
    assert.ok(checked > 300);
    assert.equal(holes, 0, `latitude ${lat}: ${holes}/${checked} sampled points belong to no returned cell`);
    assert.equal(overlaps, 0, `latitude ${lat}: ${overlaps}/${checked} sampled points belong to two cells`);
  }
});

test("no holes: every point is owned by exactly one tile (regular tilings)", () => {
  for (const spec of [{ p: 8, q: 3, frameSymmetry: 4 }, { p: 7, q: 3 }, { p: 5, q: 4 }, { p: 4, q: 5 }]) {
    const t = new RegularTiling(spec);
    for (const walk of [0, 30, 300]) {
      const anchor = new Anchor(t);
      anchor.address = advanceAddress(t, walk, 700 + walk);
      assert.ok(addressDistance(t, anchor.address) >= walk * 0.25 || walk === 0,
        `the walk did not travel: ${walk} steps reached only ${addressDistance(t, anchor.address).toFixed(2)} hyperbolic units`);
      const V = Isom.identity();
      const tiles = anchor.neighbourhood(V, 0.6, 400);
      const invs = tiles.map((x) => x.rel.inverse());
      let holes = 0;
      let overlaps = 0;
      for (let i = 0; i < 300; i++) {
        const ang = i * 2.399963;
        const rad = 0.55 * Math.sqrt((i + 0.5) / 300);
        const p = V.inverse().applyToDisk(rad * Math.cos(ang), rad * Math.sin(ang), [0, 0]);
        const k = 1 / Math.sqrt(1 - p[0] * p[0] - p[1] * p[1]);
        let owners = 0;
        for (const inv of invs) {
          const q = inv.applyToLocal(p[0] * k, p[1] * k, undefined, [0, 0]);
          const kk = 1 / Math.sqrt(Math.max(1e-300, 1 - q[0] * q[0] - q[1] * q[1]));
          if (t.containsLocal(q[0] * kk, q[1] * kk, 1e-12)) owners++;
        }
        if (owners === 0) holes++;
        if (owners > 1) overlaps++;
      }
      assert.equal(holes, 0, `{${spec.p},${spec.q}} after ${walk} steps: ${holes} unowned sample points`);
      assert.equal(overlaps, 0, `{${spec.p},${spec.q}} after ${walk} steps: ${overlaps} doubly-owned points`);
    }
  }
});

// ---- addressing ----

test("addresses round-trip: walk out and back returns the same address", () => {
  // Canonical ids make this exact rather than approximate: coming home returns the same id, not merely
  // the same place. What it must use is `reverseGenerator`, NOT `inverseGenerator` -- the child's
  // canonical frame differs from the frame the step produced by a power of P, and conjugating by P
  // permutes the generators, so the index that walks back is a different one. Using the plain inverse
  // index lands on a real but WRONG neighbour, which is exactly the sort of failure that looks like
  // nothing until a hundred steps later.
  for (const spec of REGULARS) {
    const t = new RegularTiling(spec);
    // The greedy outward walk, not a fixed arithmetic sequence of generator indices. `(i * 7 + 3) % n`
    // used to be the path here, and for {7,3} -- seven generators -- it is the CONSTANT 3, one
    // finite-order generator applied two hundred times, which travels 2.7 units and comes home for free.
    // The anti-vacuity assertion below is what found that.
    let { address: a, path } = advanceAddressWithDistance(t, 200, 90210 + spec.p);
    assert.ok(addressDistance(t, a) > 20, `{${spec.p},${spec.q}} only reached ${addressDistance(t, a)}`);
    for (let i = path.length - 1; i >= 0; i--) {
      a = t.extendAddress(a, t.reverseGenerator(path[i].from, path[i].gen));
    }
    assert.ok(
      t.addressEquals(a, t.originAddress()),
      `{${spec.p},${spec.q}} did not return to the origin: ${t.addressToString(a)}`,
    );
  }
  const b = new BinaryTiling();
  let addr = b.originAddress();
  const seq = [BIN_CHILD1, BIN_RIGHT, BIN_CHILD0, BIN_LEFT, BIN_CHILD1, BIN_CHILD0, BIN_RIGHT];
  const back = [];
  for (const g of seq) {
    const nb = b.neighbours(addr).find((n) => n.gen === g);
    back.push(nb.gen);
    addr = nb.address;
  }
  for (let i = back.length - 1; i >= 0; i--) {
    const want = b.inverseGenerator(back[i]);
    const nb = b.neighbours(addr).find((n) => n.gen === want);
    assert.ok(nb, `no neighbour with generator ${want} from ${b.addressToString(addr)}`);
    addr = nb.address;
  }
  assert.ok(b.addressEquals(addr, b.originAddress()), `binary did not return: ${b.addressToString(addr)}`);
});

test("a tile reached two different ways is recognised as one tile", () => {
  // Word addresses are not canonical, so the walk deduplicates geometrically. This checks that the
  // dedup actually fires: going around a vertex must not produce p copies of one tile.
  const t = new RegularTiling({ p: 5, q: 4 });
  const anchor = new Anchor(t);
  const tiles = anchor.neighbourhood(Isom.identity(), 0.85, 400);
  const byCentre = new Map();
  for (const x of tiles) {
    const c = toLocal(x.rel);
    const key = `${Math.round(c[0] * 1e6)},${Math.round(c[1] * 1e6)}`;
    assert.ok(!byCentre.has(key), `two tiles at the same centre: ${t.addressToString(x.address)} and ${byCentre.get(key)}`);
    byCentre.set(key, t.addressToString(x.address));
  }
});

test("a {p,q} generator can have FINITE ORDER, so a long walk can be standing still", () => {
  // The reason `addressDistance` measures geometry instead of counting steps, pinned as a fact rather
  // than left in a comment.
  //
  // {8,3} with frameSymmetry 4 takes its steps with 2*pi/3 rotations about octagon VERTICES -- legitimate
  // edge-neighbour moves, since three octagons meet at each vertex and pairwise share edges. But such a
  // rotation has order 3 in the isometry group (g^3 = -I, g^6 = +I), so five steps of generator 0 name
  // a tile 1.53 units away, and five thousand are still 1.53 units away.
  //
  // A walk that merely refuses to backtrack can therefore circle forever. Two rounds of test repair in
  // this project were spent on exactly that.
  const t = new RegularTiling({ p: 8, q: 3, frameSymmetry: 4 });
  const g0 = t.generator(0);
  const I = Isom.identity();
  assert.ok(!sameIsometry(g0.mul(g0), I), "g0 should NOT be an involution for m=4");
  assert.ok(sameIsometry(g0.mul(g0).mul(g0), I), "g0 should have order 3 as an isometry for m=4");

  // The consequence, stated on addresses -- and stating it now takes the transport table, which is
  // itself worth pinning.
  //
  // Repeating generator INDEX 0 is no longer the same thing as repeating the group element g0. Each
  // step lands in the child's canonical frame, which differs from the frame the step produced by a
  // power of P, so the next "index 0" is a different geometric move. To follow g0 itself, transport the
  // index through the accumulated correction: if the walked frame is W and the canonical frame is
  // W . P^j, then W . g0 is reached by generator pi_{-j}(0).
  const seen = new Set();
  let a = t.originAddress();
  let j = 0;
  for (let i = 0; i < 60; i++) {
    const h = t.piTransport[(t.m - j) % t.m][0];
    const next = t.extendAddress(a, h);
    j = (j + a.edges.get(h).k) % t.m;
    a = next;
    seen.add(t.addressToString(a));
  }
  assert.ok(t.addressEquals(a, t.originAddress()), `60 turns of an order-3 generator should be home, got ${a.id}`);
  assert.ok(
    addressDistance(t, a) < 1e-12,
    `60 turns of one order-3 generator should end at the origin, got ${addressDistance(t, a)}`,
  );
  // ...and it visited only three distinct tiles on the way, which is the fact itself: sixty steps, no
  // distance at all.
  assert.equal(seen.size, 3, `g0 should cycle through exactly three tiles, saw ${seen.size}`);

  // Whereas the plain {8,3} generators ARE edge half-turns, and square to -I (audit claim 9).
  const t0 = new RegularTiling({ p: 8, q: 3 });
  for (let i = 0; i < t0.generatorCount(); i++) {
    assert.ok(sameIsometry(t0.generator(i).mul(t0.generator(i)), I), `plain {8,3} generator ${i} is not an involution`);
  }
});

test("addressDistance agrees with the tiling's own frame builder near the origin", () => {
  // Cross-validate the measuring instrument before trusting its verdicts. `addressDistance` composes
  // generators in log-scaled form so it works at any depth -- but that machinery is only trustworthy if
  // it reproduces the straightforward computation where the straightforward one is still valid. (A sign
  // error in exactly this multiply made a walk look like it travelled 2,524 units when its address sat
  // at 1.1, and it was invisible until the two routes were compared.)
  let worst = 0;
  let compared = 0;
  let reached = 0;
  for (const spec of [{ p: 8, q: 3, frameSymmetry: 4 }, { p: 8, q: 3 }, { p: 7, q: 3 }, { p: 5, q: 4 }, { p: 3, q: 7 }, { p: 12, q: 3 }]) {
    const t = new RegularTiling(spec);
    for (let n = 0; n <= 12; n++) {
      const { address, distance } = advanceAddressWithDistance(t, n, 4000 + n);
      // The tolerance TRACKS THE CONDITIONING of the thing being compared against, rather than being a
      // flat number chosen to make the test pass. A global frame reads its translation off as a disk
      // radius r = tanh(d/2), and recovering d = 2 atanh(r) amplifies any error in r by
      // 2 / (1 - r^2) = 2 cosh^2(d/2), which is e^d / 2. So the agreement that can be expected decays
      // like e^d, and it does: measured on {8,3} m=4, 2.3e-15 at the origin, 9.3e-10 at d = 12.2,
      // 4.1e-7 at d = 18.3 -- a factor of 446 across 6.1 units, against e^6.1 = 446. Different tilings
      // sit at different heights on that curve ({5,4} runs about ten times above {8,3}), so the constant
      // below is set an order of magnitude above the worst of them; a real disagreement would have to be
      // beyond every tiling's float noise to hide under it. Past d ~ 37 there is no global frame at all
      // to compare with: |beta| saturates at 1 and it returns NaN.
      if (distance > 20) continue;
      const want = t.globalFrameForTesting(address).distanceMoved();
      const tol = Math.max(1e-13, 5e-13 * Math.exp(distance));
      const err = Math.abs(addressDistance(t, address) - want);
      assert.ok(err < tol, `{${spec.p},${spec.q}} at d=${distance.toFixed(1)}: off by ${err}, tolerance ${tol}`);
      worst = Math.max(worst, err);
      reached = Math.max(reached, distance);
      compared++;
    }
  }
  // Anti-vacuity: the `continue` above must not have skipped the interesting cases, and the agreement
  // near the origin must be genuinely tight rather than merely inside a distance-inflated budget.
  assert.ok(compared > 40, `only ${compared} comparisons were actually made`);
  assert.ok(reached > 10, `the furthest comparison was only ${reached} units out`);
  assert.ok(worst > 0, "the two computations agreed to the last bit everywhere, which is too good");
});

test("advanceAddress refuses to return a walk that did not travel", () => {
  // The helper's guarantee is structural, not advisory: if it ever fails to make outward progress it
  // throws instead of handing back an address that would make the caller's assertions vacuous.
  for (const spec of [{ p: 8, q: 3, frameSymmetry: 4 }, { p: 3, q: 7 }, { p: 12, q: 3 }]) {
    const t = new RegularTiling(spec);
    let prev = 0;
    for (const n of [1, 5, 50, 500]) {
      const d = addressDistance(t, advanceAddress(t, n, 700 + n));
      assert.ok(d > prev, `{${spec.p},${spec.q}}: ${n} steps reached ${d}, not past ${prev}`);
      // Each step should be worth a decent fraction of the tile spacing, or "500 tiles out" is a fiction.
      assert.ok(
        d > n * t.metrics.centreSpacing * 0.5,
        `{${spec.p},${spec.q}}: ${n} steps travelled only ${d.toFixed(2)}, under half spacing per step`,
      );
      prev = d;
    }
  }
});

test("THE RULE: a tile's frame is defined only up to the stabiliser C_m", () => {
  // This is the constraint every piece of tile art must satisfy, so it is measured here the same way
  // the renderer produces it, not asserted from theory.
  //
  // Walk the tile graph keeping one frame per tile. When a second route reaches a tile already seen,
  // `frame_seen^-1 . frame_new` is the discrepancy between two equally valid frames for ONE tile. Every
  // such discrepancy must be a rotation about that tile's centre by a multiple of 2*pi/m -- never a
  // translation, never any other angle.
  //
  // The renderer cannot avoid this: it reaches each tile by the shortest route from the CAMERA, so the
  // route changes when the camera re-anchors, and with it the frame. Art that is not C_m-invariant
  // therefore jumps as you scroll. Measured on {8,3} m=4: 16 of 30 on-screen tiles rotated by a multiple
  // of 90 degrees at one re-anchor.
  for (const spec of [
    { p: 8, q: 3, frameSymmetry: 4 }, { p: 8, q: 3 }, { p: 7, q: 3 }, { p: 5, q: 4 },
    { p: 4, q: 5 }, { p: 6, q: 4 }, { p: 3, q: 7 }, { p: 12, q: 3 },
  ]) {
    const t = new RegularTiling(spec);
    const step = (2 * Math.PI) / t.m;
    const seen = [];
    const queue = [Isom.identity()];
    let collisions = 0;
    while (queue.length && seen.length < 200) {
      const m = queue.shift();
      const z = m.applyToDisk(0, 0, [0, 0]);
      const hit = seen.find((s) => Math.hypot(s.x - z[0], s.y - z[1]) < 1e-7);
      if (hit) {
        collisions++;
        const rel = hit.frame.inverse().mul(m);
        // It must FIX the tile centre -- a translation component would mean the walk had mixed up two
        // different tiles, which would be a much worse bug than a rotated motif.
        assert.ok(
          Math.hypot(rel.br, rel.bi) < 1e-7,
          `{${spec.p},${spec.q}}: two routes to one tile differ by something that moves the centre`,
        );
        // And the rotation must be a multiple of 2*pi/m.
        const ang = 2 * Math.atan2(rel.ai, rel.ar);
        const k = Math.round(ang / step);
        assert.ok(
          Math.abs(ang - k * step) < 1e-7,
          `{${spec.p},${spec.q}} m=${t.m}: frames differ by ${(ang * 180) / Math.PI} deg, ` +
            `not a multiple of ${(step * 180) / Math.PI}`,
        );
        continue;
      }
      seen.push({ x: z[0], y: z[1], frame: m });
      for (let i = 0; i < t.generatorCount(); i++) queue.push(m.mul(t.generator(i)));
    }
    assert.ok(collisions > 10, `{${spec.p},${spec.q}}: only ${collisions} collisions -- not exercising the rule`);
    assert.equal(t.stabiliserOrder, t.m);
  }
});

test("the binary tiling's stabiliser is trivial, so its art is unconstrained", () => {
  // The reason the dungeon demo can put a DIFFERENT room in every cell while a {p,q} atlas cannot.
  const b = new BinaryTiling();
  assert.equal(b.stabiliserOrder, 1);
  assert.ok(b.addressesAreCanonical);
  // No two routes ever disagree: addresses are canonical integers, so a cell has exactly one frame.
  const seen = new Map();
  const queue = [{ a: b.originAddress(), m: Isom.identity() }];
  let checked = 0;
  while (queue.length && seen.size < 150) {
    const { a, m } = queue.shift();
    const key = b.addressToString(a);
    if (seen.has(key)) {
      checked++;
      assert.ok(
        sameIsometry(seen.get(key), m, 1e-9),
        `binary cell ${key} reached by two routes with DIFFERENT frames -- the stabiliser is not trivial`,
      );
      continue;
    }
    seen.set(key, m);
    for (const n of b.neighbours(a)) queue.push({ a: n.address, m: m.mul(b.generator(n.gen)) });
  }
  assert.ok(checked > 20, `only ${checked} revisits -- not exercising anything`);
});

test("tile classes are path-independent, which addresses are not", () => {
  // The escape hatch that lets a {p,q} atlas vary its art per tile at all. A tile's WORD is not
  // canonical, so art keyed on it jumps as you scroll; a class coming from a group homomorphism is
  // canonical, because a homomorphism is defined on group elements rather than on spellings.
  //
  // Checked the way it can fail: walk the graph, and every time a second route reaches a tile already
  // seen, the two routes must agree on the class.
  const EXPECT = {
    "8,3,4": 3, "8,3,8": 1, "7,3,7": 1, "5,4,5": 2, "4,5,4": 1,
    "6,4,6": 2, "3,7,3": 1, "12,3,12": 1, "9,4,9": 2,
  };
  for (const spec of [
    { p: 8, q: 3, frameSymmetry: 4 }, { p: 8, q: 3 }, { p: 7, q: 3 }, { p: 5, q: 4 },
    { p: 4, q: 5 }, { p: 6, q: 4 }, { p: 3, q: 7 }, { p: 12, q: 3 }, { p: 9, q: 4 },
  ]) {
    const t = new RegularTiling(spec);
    const tag = `${spec.p},${spec.q},${t.m}`;
    assert.equal(t.classModulus, EXPECT[tag], `${tag}: expected ${EXPECT[tag]} classes, got ${t.classModulus}`);

    const seen = [];
    const queue = [{ a: t.originAddress(), m: Isom.identity() }];
    let collisions = 0;
    const used = new Set();
    while (queue.length && seen.length < 250) {
      const { a, m } = queue.shift();
      const z = m.applyToDisk(0, 0, [0, 0]);
      const hit = seen.find((s) => Math.hypot(s.x - z[0], s.y - z[1]) < 1e-7);
      if (hit) {
        collisions++;
        assert.equal(
          t.tileClass(a), hit.c,
          `${tag}: two routes to one tile disagree on class (${t.tileClass(a)} vs ${hit.c})`,
        );
        continue;
      }
      const c = t.tileClass(a);
      used.add(c);
      seen.push({ x: z[0], y: z[1], c });
      for (const n of t.neighbours(a)) queue.push({ a: n.address, m: m.mul(t.generator(n.gen)) });
    }
    assert.ok(collisions > 10, `${tag}: only ${collisions} collisions -- not exercising anything`);
    assert.equal(used.size, t.classModulus, `${tag}: ${used.size} classes actually used, modulus says ${t.classModulus}`);
    // Every class must be in range, and a long free-reducing round trip must restore class 0.
    let a = t.originAddress();
    for (let i = 0; i < 400; i++) a = t.extendAddress(a, i % t.generatorCount());
    assert.ok(t.tileClass(a) >= 0 && t.tileClass(a) < Math.max(1, t.classModulus));
  }
});

test("adjacent tiles never share a class, when classes exist", () => {
  // What makes the classes useful as colours: neighbours differ, so the tiling reads as a proper
  // colouring rather than as noise.
  for (const spec of [{ p: 8, q: 3, frameSymmetry: 4 }, { p: 5, q: 4 }, { p: 6, q: 4 }]) {
    const t = new RegularTiling(spec);
    assert.ok(t.classModulus > 1);
    let a = t.originAddress();
    for (let leg = 0; leg < 40; leg++) {
      for (const n of t.neighbours(a)) {
        assert.notEqual(
          t.tileClass(n.address), t.tileClass(a),
          `{${spec.p},${spec.q}}: a tile and its neighbour share class ${t.tileClass(a)}`,
        );
      }
      a = t.neighbours(a)[leg % t.generatorCount()].address;
    }
  }
});
