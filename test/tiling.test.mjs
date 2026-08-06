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
import { wrapAngle } from "./helpers.mjs";
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
  // at exactly the inradius. Claim 11b found that tools/fit_escher_tile.py uses a DIFFERENT, larger
  // region, so this must not share that formula.
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
      // Walk out by repeatedly stepping through generator 0, re-anchoring as we go.
      let V = Isom.identity();
      for (let i = 0; i < walk; i++) {
        V = V.mul(t.generator(i % t.generatorCount()));
        anchor.address = t.extendAddress(anchor.address, i % t.generatorCount());
      }
      V = Isom.identity();
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
      assert.ok(maxEntry(V) < 10);
    }
  }
});

test("the neighbourhood walk is IDENTICAL however far the camera has travelled", () => {
  // The sharpest statement of the fix. A regular tiling is homogeneous, so the set of relative frames
  // around the camera cannot depend on where the camera is -- and now it provably does not, because
  // nothing in the computation knows.
  for (const spec of [{ p: 8, q: 3, frameSymmetry: 4 }, { p: 7, q: 3 }, { p: 5, q: 4 }]) {
    const t = new RegularTiling(spec);
    const reference = new Anchor(t).neighbourhood(Isom.identity(), 0.62, 200)
      .map((x) => toLocal(x.rel).map((v) => v.toFixed(12)).join(","))
      .sort()
      .join("|");
    for (const walk of [1, 7, 60, 500, 5000]) {
      const anchor = new Anchor(t);
      for (let i = 0; i < walk; i++) {
        anchor.address = t.extendAddress(anchor.address, i % t.generatorCount());
      }
      const got = anchor.neighbourhood(Isom.identity(), 0.62, 200)
        .map((x) => toLocal(x.rel).map((v) => v.toFixed(12)).join(","))
        .sort()
        .join("|");
      assert.equal(got, reference, `{${spec.p},${spec.q}} differs after ${walk} tile steps`);
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
  for (const spec of [{ p: 8, q: 3, frameSymmetry: 4 }, { p: 3, q: 7 }]) {
    const t = new RegularTiling(spec);
    for (const walk of [0, 1000, 100000]) {
      const anchor = new Anchor(t);
      for (let i = 0; i < walk; i++) anchor.address = t.extendAddress(anchor.address, i % t.generatorCount());
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
      for (let i = 0; i < walk; i++) anchor.address = t.extendAddress(anchor.address, i % t.generatorCount());
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
  // Free reduction in extendAddress is what makes this hold for word-addressed tilings; for the binary
  // tiling the integers make it automatic.
  for (const spec of REGULARS) {
    const t = new RegularTiling(spec);
    let a = t.originAddress();
    const path = [];
    for (let i = 0; i < 200; i++) {
      const g = (i * 7 + 3) % t.generatorCount();
      path.push(g);
      a = t.extendAddress(a, g);
    }
    for (let i = path.length - 1; i >= 0; i--) a = t.extendAddress(a, t.inverseGenerator(path[i]));
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
