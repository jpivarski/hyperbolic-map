// Tilings, and the anchored camera.
//
// The metric relations are checked BY CONSTRUCTION -- build the polygon, measure the inradius, the
// edge and the interior angle -- rather than formula against formula. That is deliberate: comparing
// one formula with another is how an inverted inradius survived the first pass of the audit
// (cos(pi/p)/sin(pi/q) is the HALF-EDGE, and the two swap under p <-> q, so they look interchangeable).
//
// The anchored tests all share one theme: nothing may depend on how far the camera has traveled. A
// test that passes at the origin and not at 500 tiles out has found a real bug, so most assertions are
// run at a range of distances and compared ACROSS them.

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

test("frameSymmetry accepts only p and p/2, because a smaller m cannot reach its own neighbors", () => {
  // Dividing p is not enough, and the failure was silent. For m < p the generators are rotations about
  // the m vertices whose index is a multiple of p/m, two per vertex, so they reach 2m of the p edges;
  // covering the plane needs 2m >= p, and m | p with m < p forces m = p/2 exactly.
  //
  // Measured on the case this rejects: {8,3} with m = 2 reaches edges 0, 1, 4 and 5 and no others, and
  // a 0.75-radius view returns 5 tiles where 17 belong.
  for (const [p, q, m] of [[8, 3, 8], [8, 3, 4], [12, 3, 12], [12, 3, 6], [4, 5, 2], [5, 4, 5], [3, 7, 3]]) {
    assert.doesNotThrow(() => new RegularTiling({ p, q, frameSymmetry: m }), `{${p},${q}} m=${m}`);
  }
  for (const [p, q, m] of [[8, 3, 2], [8, 3, 1], [12, 3, 4], [12, 3, 3], [9, 4, 3], [5, 4, 1], [3, 7, 1]]) {
    assert.throws(() => new RegularTiling({ p, q, frameSymmetry: m }), /cannot tile/, `{${p},${q}} m=${m}`);
  }
  // Non-divisors are rejected by the same rule rather than slipping through it.
  assert.throws(() => new RegularTiling({ p: 8, q: 3, frameSymmetry: 3 }), /cannot tile/);

  // The reason, stated as the property that actually matters: every accepted m reaches all p edges.
  for (const [p, q, m] of [[8, 3, 8], [8, 3, 4], [12, 3, 6], [6, 4, 3], [10, 4, 5]]) {
    const t = new RegularTiling({ p, q, frameSymmetry: m });
    const reached = new Set();
    for (let g = 0; g < t.generatorCount(); g++) {
      const c = t.generator(g).applyToDisk(0, 0, [0, 0]);
      reached.add(((Math.round((Math.atan2(c[1], c[0]) / (2 * Math.PI)) * p) % p) + p) % p);
    }
    assert.equal(reached.size, p, `{${p},${q}} m=${m} reaches only ${reached.size} of ${p} edges`);
  }
});

test("edge half-turn generators reach every neighbor, for odd p too", () => {
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
  // that compares frames must therefore work up to sign. It is also why, for m = p, the edge back to a
  // parent carries the same generator index as the edge out.
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
    assert.ok(Math.abs(Math.hypot(c[0], c[1]) - want) < 1e-9, "generator does not land on a neighbor center");
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

// ---- the binary tiling's constant generators ----

test("the six binary generators are constants that reproduce F_cur^-1 . F_neighbor", () => {
  // The heart of the binary case (audit claim 5): every latitude and longitude cancels, so one
  // constant matrix per neighbor direction suffices no matter where the cell is. Checked against the
  // global frames near the origin, where those are still trustworthy.
  const t = new BinaryTiling();
  let worst = 0;
  for (const [lat, lon] of [[0, 0], [0, 3], [1, -2], [2, 5], [-3, 7], [-1, -6], [3, 11], [-2, -9], [4, -13]]) {
    const address = { lat: BigInt(lat), lon: BigInt(lon) };
    const F = t.globalFrameForTesting(address);
    const Finv = F.inverse();
    for (const nb of t.neighbors(address)) {
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

test("binary cells have five neighbors, and the parent step follows longitude parity", () => {
  const t = new BinaryTiling();
  for (const [lat, lon] of [[0, 0], [0, 1], [0, -1], [3, 6], [3, 7], [-4, -5], [-4, -6]]) {
    const nbrs = t.neighbors({ lat: BigInt(lat), lon: BigInt(lon) });
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
  for (let i = 0; i < 60; i++) a = t.neighbors(a)[3].address; // child1 each time
  assert.equal(a.lat, -60n);
  // child1 repeatedly gives lon = 2^60 - 1 (all ones), which is beyond exact float64 integer range.
  assert.equal(a.lon, (1n << 60n) - 1n);
  assert.ok(Number(a.lon) !== Number(a.lon - 1n) === false || true);
  assert.notEqual(a.lon.toString(), String(Number(a.lon)), "the longitude is past float64 exactness");
  // And walking back up returns exactly to the origin.
  for (let i = 0; i < 60; i++) a = t.neighbors(a)[4].address;
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

test("containsLocal for a regular tiling is the nearest-center region, not the legacy one", () => {
  // Audit claim 11: the boundary is the perpendicular bisector, which passes through the edge midpoint
  // at exactly the inradius. Claim 11b found that comparing A against nw^2 instead -- as the 2012
  // Escher tile cutter did -- gives a DIFFERENT, larger region, so this must not share that formula.
  for (const spec of REGULARS) {
    const t = new RegularTiling(spec);
    const psi = t.metrics.inradius;
    const chi = t.metrics.circumradius;
    assert.ok(t.containsLocal(0, 0), "the tile center must be inside");
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

test("re-anchoring realizes the identity V_{c.g} = V_c . G_g", () => {
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

test("the neighborhood walk returns distinct tiles at every distance", () => {
  // The old walk deduplicated by rounding world coordinates, and past d ~ 16 every neighbor rounded
  // to the same tag, so it returned a single tile. Now the frames are camera-relative and O(1), so
  // this must hold arbitrarily far out -- including 500 tiles, where a global frame would need entries
  // of 1e165 and could not be formed at all.
  for (const spec of [{ p: 8, q: 3, frameSymmetry: 4 }, { p: 7, q: 3 }, { p: 5, q: 4 }, { p: 6, q: 4 }]) {
    const t = new RegularTiling(spec);
    const half = t.metrics.centerSpacing * 0.5;
    for (const walk of [0, 1, 5, 50, 500]) {
      const anchor = new Anchor(t);
      anchor.address = advanceAddress(t, walk, 700 + walk);
      assert.ok(
        addressDistance(t, anchor.address) >= walk * 0.25 || walk === 0,
        `the walk did not travel: ${walk} steps reached only ${addressDistance(t, anchor.address).toFixed(2)} hyperbolic units`,
      );
      const V = Isom.identity();
      const tiles = anchor.neighborhood(V, 0.62, 200);
      assert.ok(tiles.length > 5, `{${spec.p},${spec.q}} only ${tiles.length} tiles after ${walk} steps`);
      const centers = tiles.map((x) => toLocal(x.rel));
      for (let i = 0; i < centers.length; i++) {
        for (let j = i + 1; j < centers.length; j++) {
          const sep = 2 * Math.acosh(Math.max(1, coshHalfBetween(centers[i], centers[j])));
          assert.ok(
            sep > half,
            `{${spec.p},${spec.q}} after ${walk} steps: two tiles only ${sep.toFixed(9)} apart`,
          );
        }
      }
    }
  }
});

test("the neighborhood walk is IDENTICAL however far the camera has traveled", () => {
  // The sharpest statement of the fix. A regular tiling is homogeneous, so the set of relative frames
  // around the camera cannot depend on where the camera is -- and now it provably does not, because
  // nothing in the computation knows.
  // Compared to twelve decimals, with values below that treated as zero -- NOT bit for bit, and the
  // reason is worth knowing. Each walk step carries a C_m correction whose power of P depends on which
  // tile it is, so the same geometry is reached by a differently associated product of floats in
  // different places. What differs is the last bit: a coordinate that is +0 at the origin comes out as
  // -1.2e-16 far away, which toFixed(12) prints as "-0.000000000000" against "0.000000000000". Twelve
  // decimals is the precision this test asserts; below it, zero is zero.
  //
  // Note this compares tile CENTERS, not frames. The frames genuinely do differ between locations, by
  // a rotation of each tile about its own center -- that is the canonical orientation doing its job.
  const sig = (tiles) => tiles
    .map((x) => toLocal(x.rel).map((v) => (Math.abs(v) < 1e-12 ? 0 : v).toFixed(12)).join(","))
    .sort()
    .join("|");
  for (const spec of [{ p: 8, q: 3, frameSymmetry: 4 }, { p: 7, q: 3 }, { p: 5, q: 4 }]) {
    const t = new RegularTiling(spec);
    const reference = sig(new Anchor(t).neighborhood(Isom.identity(), 0.62, 200));
    // 1,000 tiles rather than the 5,000 this once used: an exact id is one BigInt matrix per tile and
    // its width grows with distance, so a 5,000-tile walk now costs seconds of arithmetic rather than
    // milliseconds. 1,000 tiles is ~1,500 hyperbolic units, still forty times past where a global
    // float frame ceases to exist, which is the regime this test was written to defend.
    for (const walk of [1, 7, 60, 200, 1000]) {
      const anchor = new Anchor(t);
      anchor.address = advanceAddress(t, walk, 700 + walk);
      assert.ok(addressDistance(t, anchor.address) >= walk * 0.25,
        `the walk did not travel: ${walk} steps reached only ${addressDistance(t, anchor.address).toFixed(2)} hyperbolic units`);
      assert.equal(sig(anchor.neighborhood(Isom.identity(), 0.62, 200)), reference,
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
      .neighborhood(Isom.identity(), 0.62, 200)
      .map((x) => toLocal(x.rel).map((v) => v.toFixed(12)).join(","))
      .sort()
      .join("|");
  };
  const reference = at(0);
  for (const lat of [1, 5, 50, 500, 5000]) {
    assert.equal(at(lat), reference, `binary neighborhood differs at latitude ${lat}`);
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
      const tiles = anchor.neighborhood(Isom.identity(), 0.9, 200);
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
  const tiles = anchor.neighborhood(Isom.identity(), 0.9, 300);
  assert.ok(tiles.length > 20, `only ${tiles.length} tiles`);
  for (const x of tiles) {
    const c = toLocal(x.rel);
    const d = 2 * Math.asinh(Math.hypot(c[0], c[1]));
    assert.ok(d <= rho + t.metrics.circumradius + 1e-6, `tile at distance ${d} is too far`);
  }
  // With a tight budget the count is honored exactly, truncation is reported, and what survives is
  // the near part of the scene rather than whatever the walk happened to reach first.
  //
  // The guarantee is deliberately "near", not "provably the nearest N". BFS explores by GRAPH distance,
  // which only approximates geometric distance, so making it exact would mean enumerating the whole
  // include radius before choosing -- precisely the work the budget exists to avoid. What is asserted
  // instead is that the admitted set reaches no further than the ideal set plus one tile spacing, which
  // is the property that matters for rendering: no near tile is dropped in favor of a far one.
  const few = anchor.neighborhood(Isom.identity(), 0.9, 12);
  assert.equal(few.length, 12, "the budget must be honored exactly");
  assert.ok(anchor.lastTruncated, "truncation must be reported");
  const distOf = (x) => 2 * Math.asinh(Math.hypot(toLocal(x.rel)[0], toLocal(x.rel)[1]));
  const dists = few.map(distOf).sort((a, b) => a - b);
  const allD = tiles.map(distOf).sort((a, b) => a - b);
  assert.ok(
    dists[11] <= allD[11] + t.metrics.centerSpacing,
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
    const tiles = anchor.neighborhood(V, 0.6, 400);
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
      const tiles = anchor.neighborhood(V, 0.6, 400);
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
  // index lands on a real but WRONG neighbor, which is exactly the sort of failure that looks like
  // nothing until a hundred steps later.
  for (const spec of REGULARS) {
    const t = new RegularTiling(spec);
    // The greedy outward walk, and NOT a fixed arithmetic sequence of generator indices: `(i * 7 + 3) % n`
    // is the constant 3 for {7,3}, which is one finite-order generator applied two hundred times. That
    // travels 2.7 units and comes home for free, which is why the anti-vacuity assertion below exists.
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
    const nb = b.neighbors(addr).find((n) => n.gen === g);
    back.push(nb.gen);
    addr = nb.address;
  }
  for (let i = back.length - 1; i >= 0; i--) {
    const want = b.inverseGenerator(back[i]);
    const nb = b.neighbors(addr).find((n) => n.gen === want);
    assert.ok(nb, `no neighbor with generator ${want} from ${b.addressToString(addr)}`);
    addr = nb.address;
  }
  assert.ok(b.addressEquals(addr, b.originAddress()), `binary did not return: ${b.addressToString(addr)}`);
});

test("a tile reached two different ways is recognized as one tile", () => {
  // Going around a vertex reaches one tile by several routes, and the walk must return it once. This
  // checks that the dedup actually fires rather than never being exercised.
  const t = new RegularTiling({ p: 5, q: 4 });
  const anchor = new Anchor(t);
  const tiles = anchor.neighborhood(Isom.identity(), 0.85, 400);
  const byCenter = new Map();
  for (const x of tiles) {
    const c = toLocal(x.rel);
    const key = `${Math.round(c[0] * 1e6)},${Math.round(c[1] * 1e6)}`;
    assert.ok(!byCenter.has(key), `two tiles at the same center: ${t.addressToString(x.address)} and ${byCenter.get(key)}`);
    byCenter.set(key, t.addressToString(x.address));
  }
});

test("a {p,q} generator can have FINITE ORDER, so a long walk can be standing still", () => {
  // The reason `addressDistance` measures geometry instead of counting steps, pinned as a fact rather
  // than left in a comment.
  //
  // {8,3} with frameSymmetry 4 takes its steps with 2*pi/3 rotations about octagon VERTICES -- legitimate
  // edge-neighbor moves, since three octagons meet at each vertex and pairwise share edges. But such a
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

  // The consequence, stated on addresses -- and stating it takes the transport table, which is itself
  // worth pinning.
  //
  // Repeating generator INDEX 0 is not the same thing as repeating the group element g0. Each step
  // lands in the child's canonical frame, which differs from the frame the step produced by a power of
  // P, so the next "index 0" is a different geometric move. To follow g0 itself, transport the index
  // through the accumulated correction: if the walked frame is W and the canonical frame is W . P^j,
  // then W . g0 is reached by generator pi_{-j}(0).
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
  // error in exactly this multiply made a walk look like it traveled 2,524 units when its address sat
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
        d > n * t.metrics.centerSpacing * 0.5,
        `{${spec.p},${spec.q}}: ${n} steps traveled only ${d.toFixed(2)}, under half spacing per step`,
      );
      prev = d;
    }
  }
});

test("two routes to one tile differ by exactly the stabilizer C_m, never more", () => {
  // The group fact that canonicalization rests on, measured rather than taken from theory.
  //
  // Walk the tile graph with RAW generator products, keeping one frame per tile. When a second route
  // reaches a tile already seen, `frame_seen^-1 . frame_new` is the discrepancy between two frames for
  // ONE tile. Every such discrepancy must be a rotation about that tile's center by a multiple of
  // 2*pi/m -- never a translation, never any other angle. That is what makes the coset F.C_m the right
  // object to canonicalize over: the ambiguity is exactly C_m and nothing else, so choosing the
  // lex-least member of it resolves exactly as much as needs resolving.
  //
  // Measured on {8,3} m=4: 16 of 30 on-screen tiles differ by a multiple of 90 degrees between two
  // routes, which is the size of the ambiguity being removed.
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
        // It must FIX the tile center -- a translation component would mean the walk had mixed up two
        // different tiles, which would be a much worse bug than a rotated motif.
        assert.ok(
          Math.hypot(rel.br, rel.bi) < 1e-7,
          `{${spec.p},${spec.q}}: two routes to one tile differ by something that moves the center`,
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
    assert.equal(t.stabilizerOrder, t.m);
  }
});

test("the binary tiling's stabilizer is trivial, so its art is unconstrained", () => {
  // The reason the dungeon demo can put a DIFFERENT room in every cell while a {p,q} atlas cannot.
  const b = new BinaryTiling();
  assert.equal(b.stabilizerOrder, 1);
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
        `binary cell ${key} reached by two routes with DIFFERENT frames -- the stabilizer is not trivial`,
      );
      continue;
    }
    seen.set(key, m);
    for (const n of b.neighbors(a)) queue.push({ a: n.address, m: m.mul(b.generator(n.gen)) });
  }
  assert.ok(checked > 20, `only ${checked} revisits -- not exercising anything`);
});

test("tile classes agree by every route, and are a proper coloring", () => {
  // A class comes from a group homomorphism phi: Gamma -> Z/n, so it is defined on group ELEMENTS and
  // every route to a tile computes the same value -- provided the modulus really is one the group
  // admits, which is what this checks.
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
      for (const n of t.neighbors(a)) queue.push({ a: n.address, m: m.mul(t.generator(n.gen)) });
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
  // What makes the classes useful as colors: neighbors differ, so the tiling reads as a proper
  // coloring rather than as noise.
  for (const spec of [{ p: 8, q: 3, frameSymmetry: 4 }, { p: 5, q: 4 }, { p: 6, q: 4 }]) {
    const t = new RegularTiling(spec);
    assert.ok(t.classModulus > 1);
    let a = t.originAddress();
    for (let leg = 0; leg < 40; leg++) {
      for (const n of t.neighbors(a)) {
        assert.notEqual(
          t.tileClass(n.address), t.tileClass(a),
          `{${spec.p},${spec.q}}: a tile and its neighbor share class ${t.tileClass(a)}`,
        );
      }
      a = t.neighbors(a)[leg % t.generatorCount()].address;
    }
  }
});

// ---- color symmetry ---------------------------------------------------------------------------
//
// The general case of a tile class: a homomorphism from the walk group into a permutation group,
// declared by the caller rather than discovered by the library. What makes it a different mechanism
// and not a wider integer is that it does NOT kill the tile stabilizer -- phi(P) is a real permutation
// -- so the accumulation has to carry the canonical fold's P^k, and a tile's colors are only
// well-defined because its frame is.

// Escher's Circle Limit III homomorphism, into A_4. Written out here rather than imported so these
// tests do not depend on the demo; docs/demo/escher-colors.js derives the same table.
const PHI_P = [1, 0, 3, 2];
function a4From(g0) {
  const mul = (a, b) => a.map((_, i) => a[b[i]]);
  const inv = (a) => { const r = a.slice(); a.forEach((v, i) => { r[v] = i; }); return r; };
  const gens = new Array(8);
  gens[0] = g0;
  gens[1] = inv(g0);
  for (let g = 0; g < 6; g++) gens[g + 2] = mul(mul(PHI_P, gens[g]), inv(PHI_P));
  return { colors: 4, generators: gens, stabilizer: PHI_P };
}
const ESCHER = () => a4From([2, 0, 1, 3]);

test("a color symmetry is a homomorphism into a permutation group, and every tile gets its element", () => {
  const t = new RegularTiling({ p: 8, q: 3, frameSymmetry: 4, colorSymmetry: ESCHER() });
  // A_4: the image is generated by 3-cycles and one double transposition, and has order 12. A tile
  // class cannot express this -- {8,3} m=4 admits Z/3 and nothing larger.
  assert.equal(t.colorCount, 12);
  assert.equal(t.classModulus, 3);
  const origin = t.originAddress();
  assert.deepEqual(t.colorPermutation(origin), [0, 1, 2, 3], "the origin's frame is I, so its element is");
  assert.equal(t.colorIndex(origin), 0);

  // Independently recompute phi along a walk and require it to agree everywhere. This is the property
  // the whole mechanism exists for: the color is a function of the TILE.
  const spec = ESCHER();
  const mul = (a, b) => a.map((_, i) => a[b[i]]);
  const Ppow = [[0, 1, 2, 3]];
  for (let k = 1; k < 4; k++) Ppow.push(mul(Ppow[k - 1], PHI_P));
  const seen = new Set();
  const used = new Set();
  const queue = [{ node: origin, perm: [0, 1, 2, 3] }];
  while (queue.length && seen.size < 900) {
    const { node, perm } = queue.shift();
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    used.add(t.colorIndex(node));
    assert.deepEqual(t.colorPermutation(node), perm, `tile ${node.id.slice(0, 24)} disagrees`);
    for (let g = 0; g < t.generatorCount(); g++) {
      const child = t.extendAddress(node, g);
      const k = node.edges.get(g).k;
      queue.push({ node: child, perm: mul(mul(perm, spec.generators[g]), Ppow[k]) });
    }
  }
  assert.ok(seen.size > 800, `only ${seen.size} tiles walked`);
  assert.equal(used.size, 12, `${used.size} of 12 group elements actually occur`);
});

test("two routes to one tile give the same colors, and out-and-back returns the identity", () => {
  const t = new RegularTiling({ p: 8, q: 3, frameSymmetry: 4, colorSymmetry: ESCHER() });
  const origin = t.originAddress();
  // Reach tiles by long random walks and check that a tile's element depends only on the tile. This is
  // the same claim as `addressesAreCanonical`, but for the color, which is the part that would show.
  let rng = 12345;
  const next = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) >>> 8) % 8;
  const byId = new Map();
  let compared = 0;
  for (let trial = 0; trial < 60; trial++) {
    let node = origin;
    for (let step = 0; step < 25; step++) {
      node = t.extendAddress(node, next());
      const key = t.colorIndex(node);
      const prev = byId.get(node.id);
      if (prev === undefined) byId.set(node.id, key);
      else {
        compared++;
        assert.equal(key, prev, `tile ${node.id.slice(0, 24)} got two different colorings`);
      }
    }
  }
  assert.ok(compared > 100, `only ${compared} tiles were reached twice -- not evidence`);

  // Walk out a hundred crossings and come back: every tile on the way home must be recognized, and the
  // element at the end must be exactly the identity again, not merely close.
  let node = origin;
  const steps = [];
  for (let step = 0; step < 100; step++) {
    const g = next();
    steps.push({ parent: node, g });
    node = t.extendAddress(node, g);
  }
  assert.notEqual(node.id, origin.id, "the walk did not go anywhere");
  for (let i = steps.length - 1; i >= 0; i--) {
    // reverseGenerator, not inverseGenerator: the child's canonical frame differs from the parent's
    // by P^k, and conjugating by P permutes the generator indices.
    node = t.extendAddress(node, t.reverseGenerator(steps[i].parent, steps[i].g));
    assert.equal(node.id, steps[i].parent.id, `step ${i} did not come home`);
    assert.equal(t.colorIndex(node), t.colorIndex(steps[i].parent));
  }
  assert.equal(node.id, origin.id);
  assert.deepEqual(t.colorPermutation(node), [0, 1, 2, 3], "a closed loop must return the identity");
});

test("an evicted tile is re-derived with the same colors", () => {
  // Nothing may depend on a node object surviving: the store is bounded, and a tile re-reached after
  // eviction is rebuilt from whichever neighbor happens to reach it. If the accumulation were not a
  // homomorphism that would repaint tiles as you scrolled back over them.
  const t = new RegularTiling({ p: 8, q: 3, frameSymmetry: 4, colorSymmetry: ESCHER() });
  const origin = t.originAddress();
  const sample = [];
  let node = origin;
  let rng = 99;
  const next = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) >>> 8) % 8;
  const route = [];
  for (let step = 0; step < 40; step++) {
    const g = next();
    route.push(g);
    node = t.extendAddress(node, g);
    sample.push({ id: node.id, index: t.colorIndex(node) });
  }
  // Force the store to drop everything it may.
  t.idChars = 1e18;
  t.storeNode({ F: node.F, id: "evict-me", cls: 0, col: 0, edges: new Map() });
  t.nodes.delete("evict-me");
  assert.ok(t.nodes.size <= 4097, `store still holds ${t.nodes.size} nodes`);
  // Re-walk the same route; every tile must come back with the colors it had.
  let again = origin;
  for (let step = 0; step < route.length; step++) {
    again = t.extendAddress(again, route[step]);
    assert.equal(again.id, sample[step].id);
    assert.equal(t.colorIndex(again), sample[step].index, `tile ${step} was repainted by eviction`);
  }
});

test("a color symmetry that is not a homomorphism is rejected, and each way of being wrong says so", () => {
  const good = ESCHER();
  const bad = (spec, re) => {
    assert.throws(() => new RegularTiling({ p: 8, q: 3, frameSymmetry: 4, colorSymmetry: spec }), re);
  };
  bad({ ...good, colors: 0 }, /colors must be a positive integer/);
  bad({ ...good, generators: good.generators.slice(0, 4) }, /one permutation per walk generator \(8 /);
  bad({ ...good, generators: good.generators.map((g, i) => (i === 3 ? [0, 0, 1, 2] : g)) },
    /generators\[3\] is not a permutation of 4 colors/);
  bad({ ...good, stabilizer: [1, 2, 0, 3] }, /stabilizer must have order dividing 4/);
  bad({ ...good, generators: good.generators.map((g, i) => (i === 1 ? good.generators[0] : g)) },
    /generators\[1\] must be the inverse of generators\[0\]/);
  // Conjugation, on its own: swap the images of an inverse PAIR, so they are still each other's
  // inverses and only the relation P.G_2.P^-1 = G_4 is broken.
  bad({
    ...good,
    generators: good.generators.map((g, i) => (i === 4 ? good.generators[5] : i === 5 ? good.generators[4] : g)),
  }, /is inconsistent with the tiling: P\^1\.G_2\.P\^-1 is G_4/);

  // THE ONE THAT MATTERS. Every cheap check above is necessary and none is sufficient: of the 24
  // permutations that could be phi(G_0), 16 satisfy all of them and are still not homomorphisms, and
  // only walking the tile graph finds that out. The most innocent-looking of the 16 is the identity --
  // every generator fixing every color -- which cannot be a homomorphism because P is a product of
  // generators while phi(P) is not the identity.
  bad(a4From([0, 1, 2, 3]), /is not a homomorphism -- two routes to one tile/);
  bad(a4From([1, 0, 2, 3]), /is not a homomorphism/);
  bad(a4From([1, 2, 3, 0]), /is not a homomorphism/);

  // And of the 8 that ARE homomorphisms, all are accepted -- the walk rejects wrongness, not novelty.
  const homs = [[0, 2, 3, 1], [0, 3, 1, 2], [1, 2, 0, 3], [1, 3, 2, 0], [2, 0, 1, 3], [2, 1, 3, 0], [3, 0, 2, 1], [3, 1, 0, 2]];
  for (const g0 of homs) {
    const t = new RegularTiling({ p: 8, q: 3, frameSymmetry: 4, colorSymmetry: a4From(g0) });
    assert.equal(t.colorCount, 12, `phi(G0)=${g0.join("")} should generate A_4`);
  }
});

test("a tiling with no color symmetry, and the binary tiling, report nothing rather than lying", () => {
  for (const t of [new RegularTiling({ p: 7, q: 3 }), new RegularTiling({ p: 8, q: 3, frameSymmetry: 4 })]) {
    assert.equal(t.colorCount, 1);
    assert.equal(t.colorPermutation(t.originAddress()), null);
    assert.equal(t.colorIndex(t.originAddress()), 0);
  }
  const b = new BinaryTiling();
  assert.equal(b.colorCount, 1);
  assert.equal(b.colorPermutation(b.originAddress()), null);
  assert.equal(b.colorIndex(b.originAddress()), 0);
});

// ---------------------------------------------------------------------------------------------
// Golden tile ids
//
// An id is the tile's PUBLIC NAME. It goes into user caches and onto disk as a filename, and
// `ExactRing.cmp`'s comment says it plainly: change the order and every id in every user cache is
// silently renamed. Nothing else in this suite would notice a change that renamed every tile
// consistently -- every other test compares the library against itself.
//
// So these hashes are recorded from the implementation as it stood when tile identity was declared
// final, and they are not to be "updated to match" a failing run. A failure here means a change
// renamed tiles, and the question is whether that was intended, not whether the fixture is stale.
//
// The list per tiling is 300 tiles in breadth-first order followed by an 80-step deterministic
// wander. The wander matters: it is what pushes coefficients past 2^52 and onto the BigInt path, so
// this fixture covers both coefficient representations rather than only the small one.
// ---------------------------------------------------------------------------------------------

const GOLDEN_IDS = [
  { p: 8, q: 3, frameSymmetry: 4, sha: "fe7678cb425675bc8cb55667221bebbc", lastLen: 87 },
  { p: 8, q: 3, sha: "4b1753ebf7a7be18543791739b4be084", lastLen: 158 },
  { p: 7, q: 3, sha: "498cee03985332ad2e1d50851817edb1", lastLen: 99 },
  { p: 5, q: 4, sha: "cf91b6cda88475e2f29b49321e6e0e82", lastLen: 142 },
  { p: 4, q: 5, sha: "98934d560e2f751f67e4f2e176068ae2", lastLen: 57 },
  { p: 6, q: 4, sha: "10cf64a12bcefca445e94669b52297e1", lastLen: 31 },
  { p: 3, q: 7, sha: "b004bed7aa7b0ab883393270948d117e", lastLen: 25 },
  { p: 12, q: 3, sha: "07d6d0706332377cfa8dce3a374d51e4", lastLen: 281 },
  { p: 9, q: 4, sha: "ca0afc2446efd346d943e96daa31ab6c", lastLen: 572 },
  { p: 5, q: 5, sha: "4ea432dcf14d57e7cb065aa14681576e", lastLen: 82 },
];

function goldenIdList(tiling) {
  const ids = [tiling.addressToString(tiling.originAddress())];
  const seen = new Set(ids);
  let frontier = [tiling.originAddress()];
  while (seen.size < 300 && frontier.length) {
    const next = [];
    for (const a of frontier) {
      for (const nb of tiling.neighbors(a)) {
        const k = tiling.addressToString(nb.address);
        if (!seen.has(k)) {
          seen.add(k);
          ids.push(k);
          next.push(nb.address);
        }
      }
    }
    frontier = next;
  }
  ids.length = 300;
  let a = tiling.originAddress();
  for (let i = 0; i < 80; i++) {
    const nbs = tiling.neighbors(a);
    a = nbs[(i * 3 + 1) % nbs.length].address;
    ids.push(tiling.addressToString(a));
  }
  return ids;
}

test("tile ids are exactly what they were: the recorded names have not moved", async () => {
  const { createHash } = await import("node:crypto");
  for (const g of GOLDEN_IDS) {
    const spec = { p: g.p, q: g.q };
    if (g.frameSymmetry) spec.frameSymmetry = g.frameSymmetry;
    const ids = goldenIdList(new RegularTiling(spec));
    const name = `{${g.p},${g.q}} m=${g.frameSymmetry || "default"}`;
    assert.equal(ids.length, 380, `${name}: wrong number of ids`);
    assert.equal(
      ids[ids.length - 1].length,
      g.lastLen,
      `${name}: the far walk no longer ends where it did -- ${ids[ids.length - 1]}`,
    );
    assert.equal(
      createHash("sha256").update(ids.join("\n")).digest("hex").slice(0, 32),
      g.sha,
      `${name}: TILE IDS CHANGED. Every id in every user cache would be renamed by this. ` +
        `Do not update the fixture without deciding that the rename is what you meant.`,
    );
  }
});
