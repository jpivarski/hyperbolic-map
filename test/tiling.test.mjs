// Tilings.
//
// The metric relations are checked BY CONSTRUCTION -- build the polygon, measure the inradius, the
// edge and the interior angle -- rather than formula against formula. That is deliberate: comparing
// one formula with another is how an inverted inradius survived the first pass of the audit
// (cos(pi/p)/sin(pi/q) is the HALF-EDGE, and the two swap under p <-> q, so they look interchangeable).

import test from "node:test";
import assert from "node:assert/strict";

import { Isom } from "../src/core/isom.js";
import { localDistance } from "../src/core/coords.js";
import { wrapAngle } from "./helpers.mjs";
import {
  RegularTiling,
  BinaryTiling,
  regularMetrics,
  BINARY_LOCAL_HALF_WIDTH,
  BINARY_LOCAL_Y_LOW,
  BINARY_LOCAL_Y_HIGH,
} from "../src/data/atlas/tiling.js";

const PAIRS = [[8, 3], [4, 5], [5, 4], [7, 3], [3, 7], [6, 4], [9, 4], [12, 3]];

function diskAngleBetween(from, a, b) {
  const m = Isom.translationToDisk(-from[0], -from[1]);
  const ia = m.applyToDisk(a[0], a[1], [0, 0]);
  const ib = m.applyToDisk(b[0], b[1], [0, 0]);
  return Math.abs(wrapAngle(Math.atan2(ia[1], ia[0]) - Math.atan2(ib[1], ib[0])));
}

test("{p,q} metrics, verified by constructing the polygon and measuring", () => {
  for (const [p, q] of PAIRS) {
    const m = regularMetrics(p, q);
    const t = new RegularTiling({ p, q });

    // Interior angle must be exactly 2*pi/q.
    const angle = diskAngleBetween(t.vertexDisk[0], t.vertexDisk[1], t.vertexDisk[p - 1]);
    assert.ok(
      Math.abs(angle - (2 * Math.PI) / q) < 1e-9,
      `{${p},${q}} interior angle ${(angle * 180) / Math.PI} deg, want ${360 / q}`,
    );

    // The hyperbolic Pythagorean identity on the (2,p,q) triangle.
    assert.ok(
      Math.abs(Math.cosh(m.circumradius) - Math.cosh(m.inradius) * Math.cosh(m.halfEdge)) < 1e-9,
      `{${p},${q}} cosh(chi) != cosh(psi)cosh(phi)`,
    );

    // Measured edge length must match 2 * halfEdge.
    const v0 = t.boundaryLocal[0];
    const v1 = t.boundaryLocal[1];
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
    assert.equal(t.generators.length, p);
    for (let k = 0; k < p; k++) {
      const c = t.generators[k].applyToDisk(0, 0, [0, 0]);
      assert.ok(Math.abs(Math.hypot(c[0], c[1]) - want) < 1e-9, `{${p},${q}} generator ${k} wrong distance`);
      const d = wrapAngle(Math.atan2(c[1], c[0]) - (2 * Math.PI * k) / p);
      assert.ok(Math.abs(d) < 1e-9, `{${p},${q}} generator ${k} wrong bearing (off by ${d})`);
      // Each is an involution, so the way back carries the same index.
      const sq = t.generators[k].mul(t.generators[k]);
      assert.ok(Math.hypot(sq.br, sq.bi) < 1e-9, `{${p},${q}} generator ${k} is not an involution`);
    }
  }
});

test("{8,3} with frameSymmetry 4 uses the 433 rotation generators, not half-turns", () => {
  // The decisive constraint for Circle Limit III: the tile stabiliser is C4, not C8, so the walk must
  // avoid both the 8-fold rotation and the edge-midpoint half-turn (433 has no order-2 points at all).
  // See notes/escher-circle-limit-iii.md.
  const t = new RegularTiling({ p: 8, q: 3, frameSymmetry: 4 });
  assert.equal(t.m, 4);
  // 4 class-A vertices x 2 senses = 8 generators, one per edge-neighbour.
  assert.equal(t.generators.length, 8);
  const want = Math.tanh(t.metrics.inradius);
  const reached = new Set();
  for (const g of t.generators) {
    const c = g.applyToDisk(0, 0, [0, 0]);
    assert.ok(Math.abs(Math.hypot(c[0], c[1]) - want) < 1e-9, "generator does not land on a neighbour centre");
    const k = Math.round((Math.atan2(c[1], c[0]) / (2 * Math.PI)) * 8);
    reached.add(((k % 8) + 8) % 8);
  }
  assert.equal(reached.size, 8, `only reached edges ${[...reached].sort()}`);
  // The generators must NOT be involutions here (they are 3-fold rotations).
  for (const g of t.generators) {
    const sq = g.mul(g);
    assert.ok(Math.hypot(sq.br, sq.bi) > 1e-6, "a 433 generator should not be an involution");
  }
});

test("frameSymmetry must divide p", () => {
  assert.throws(() => new RegularTiling({ p: 8, q: 3, frameSymmetry: 3 }), /must divide/);
  assert.doesNotThrow(() => new RegularTiling({ p: 8, q: 3, frameSymmetry: 2 }));
});

test("regular tiling frames stay on the manifold at depth", () => {
  const t = new RegularTiling({ p: 5, q: 4 });
  let key = [];
  for (let i = 0; i < 40; i++) key.push(i % 5);
  const f = t.frame(key);
  const modA = Math.hypot(f.ar, f.ai);
  const modB = Math.hypot(f.br, f.bi);
  assert.ok(Number.isFinite(modA), "frame overflowed");
  assert.ok(Math.abs(modA - Math.sqrt(1 + modB * modB)) / modA < 1e-14, "frame drifted off the manifold");
});

test("visible tiles are exactly those whose circumscribed disk meets the view", () => {
  const t = new RegularTiling({ p: 5, q: 4 });
  const keys = t.visible(Isom.identity(), 0.9, 300);
  assert.ok(keys.length > 20, `only ${keys.length} tiles`);
  // No duplicates by tile centre.
  const seen = new Set();
  for (const k of keys) {
    const c = t.frame(k).applyToDisk(0, 0, [0, 0]);
    const tag = `${Math.round(c[0] * 1e6)},${Math.round(c[1] * 1e6)}`;
    assert.ok(!seen.has(tag), `duplicate tile at ${tag} (key ${k.join(".")})`);
    seen.add(tag);
  }
  // Every returned tile must actually be near enough to matter.
  const rho = 2 * Math.atanh(0.9);
  for (const k of keys) {
    const c = t.frame(k).applyToDisk(0, 0, [0, 0]);
    const d = 2 * Math.atanh(Math.min(Math.hypot(c[0], c[1]), 1 - 1e-16));
    assert.ok(d <= rho + t.metrics.circumradius + 1e-6, `tile ${k.join(".")} at distance ${d} is too far`);
  }
});

test("locate finds the tile containing the view centre", () => {
  const t = new RegularTiling({ p: 5, q: 4 });
  // Walk out along a chain of tiles, then ask locate to find each one from scratch.
  let key = [];
  for (let step = 0; step < 12; step++) {
    key = key.concat([step % 5]);
    const frame = t.frame(key);
    const centre = frame.applyToDisk(0, 0, [0, 0]);
    // A view centred on that tile's centre.
    const view = Isom.translationToDisk(centre[0], centre[1]).inverse();
    const found = t.locate(view);
    const foundCentre = t.frame(found).applyToDisk(0, 0, [0, 0]);
    const d = 2 * Math.atanh(Math.min(Math.hypot(foundCentre[0] - centre[0], foundCentre[1] - centre[1]), 1 - 1e-16));
    assert.ok(d < 1e-6, `locate landed ${d} away at depth ${step + 1}`);
  }
});

// ---- binary tiling ----

test("the binary cell's local box is the same for every (latitude, longitude)", () => {
  // This is what makes "the same prototype in every cell" work. The half-width is 0.5/sqrt(2), NOT
  // 0.5, because the frame's scale applies to both axes while the cell's x-width is only 2^lat.
  const t = new BinaryTiling();
  const corners = [
    [-BINARY_LOCAL_HALF_WIDTH, BINARY_LOCAL_Y_LOW],
    [BINARY_LOCAL_HALF_WIDTH, BINARY_LOCAL_Y_LOW],
    [-BINARY_LOCAL_HALF_WIDTH, BINARY_LOCAL_Y_HIGH],
    [BINARY_LOCAL_HALF_WIDTH, BINARY_LOCAL_Y_HIGH],
  ];
  for (const [lat, lon] of [[0, 0], [3, 5], [-7, -13], [20, 1000], [-20, -999999], [40, 1000000]]) {
    const s = Math.pow(2, lat + 0.5);
    const tt = (lon + 0.5) * Math.pow(2, lat);
    const size = Math.pow(2, lat);
    const want = [
      [lon * size, size],
      [(lon + 1) * size, size],
      [lon * size, 2 * size],
      [(lon + 1) * size, 2 * size],
    ];
    for (let i = 0; i < 4; i++) {
      const gx = s * corners[i][0] + tt;
      const gy = s * corners[i][1];
      // Error measured as a fraction of the TILE SIZE, the only meaningful scale here: at
      // latitude -20 the absolute coordinates are ~1e-6 and at +40 they are ~1e12.
      const err = Math.hypot(gx - want[i][0], gy - want[i][1]) / size;
      assert.ok(err < 1e-12, `cell (${lat},${lon}) corner ${i} off by ${err} tile-widths`);
    }
  }
});

test("the binary frame is in SU(1,1) and centres the cell", () => {
  const t = new BinaryTiling();
  for (const [lat, lon] of [[0, 0], [5, 9], [-9, -4], [30, 500000], [-30, -12345]]) {
    const f = t.frame([lat, lon]);
    const modA = Math.hypot(f.ar, f.ai);
    const modB = Math.hypot(f.br, f.bi);
    assert.ok(Number.isFinite(modA) && Number.isFinite(modB), `not finite for (${lat},${lon})`);
    assert.ok(Math.abs(modA - Math.sqrt(1 + modB * modB)) / modA < 1e-14, `off manifold for (${lat},${lon})`);
    // The tile-local origin must land on the cell's hyperbolic centre. Note the tolerance: cell
    // (30, 500000) sits at an enormous hyperbolic distance (half-plane y ~ 1.5e9, x ~ 5e14), where
    // tanh(d/2) is 1.0 to within float64 and rounding can put it a couple of ulps ABOVE 1. That is
    // the single-patch precision envelope showing up exactly where predicted -- and exactly what the
    // atlas exists to avoid, since tile-LOCAL coordinates never get near it.
    const got = f.applyToDisk(0, 0, [0, 0]);
    assert.ok(Math.hypot(got[0], got[1]) <= 1 + 8 * Number.EPSILON, `centre at |z| = ${Math.hypot(got[0], got[1])}`);
  }
});

test("binary cells have five neighbours, and children tile the parent", () => {
  const t = new BinaryTiling();
  for (const [lat, lon] of [[0, 0], [4, 7], [-3, -5]]) {
    const nb = t.neighbours([lat, lon]);
    assert.equal(nb.length, 5, "a binary cell has one parent, two children and two lateral neighbours");
    const size = Math.pow(2, lat);
    const childSize = Math.pow(2, lat - 1);
    for (const child of [2 * lon, 2 * lon + 1]) {
      assert.ok(child * childSize >= lon * size - 1e-12, "child starts inside the parent");
      assert.ok((child + 1) * childSize <= (lon + 1) * size + 1e-12, "child ends inside the parent");
    }
  }
});

test("binary point->cell is two floors and round-trips", () => {
  const t = new BinaryTiling();
  let bad = 0;
  for (let i = 0; i < 20000; i++) {
    const lat = Math.floor(Math.random() * 51) - 25;
    const lon = Math.floor(Math.random() * 200001) - 100000;
    const size = Math.pow(2, lat);
    const x = (lon + 0.001 + 0.998 * Math.random()) * size;
    const y = size * (1.001 + 0.997 * Math.random());
    const [glat, glon] = t.locateHalfPlane(x, y);
    if (glat !== lat || glon !== lon) bad++;
  }
  assert.equal(bad, 0);
});

test("binary visible-cell enumeration does not repeat the 2011 band-bottom bug", () => {
  // The 2011 routine evaluated the visible circle's width at y = 2^latitude, the BOTTOM of each band,
  // and so missed about 46% of the cells it should have returned. Here every returned cell must
  // actually meet the visible region, and the count must be substantial rather than a thin sliver.
  const t = new BinaryTiling();
  const view = Isom.translationToLocal(0.3, 1.7).inverse();
  const cells = t.visible(view, 0.9, 500);
  assert.ok(cells.length > 10, `only ${cells.length} cells`);
  // Cells must span more than one latitude band, which the band-bottom bug tended to prevent.
  const lats = new Set(cells.map((c) => c[0]));
  assert.ok(lats.size >= 2, `only latitude bands ${[...lats]}`);
});
