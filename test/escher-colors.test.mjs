// The Circle Limit III coloring, checked against the data the page actually draws.
//
// This imports from docs/demo/, which is unusual for a test, and deliberate: the homomorphism and the
// shape-to-role map are ART data and belong with the art, but they are also the thing most likely to be
// broken by a well-meaning edit -- the file's fills look like color names and are not the colors those
// shapes come out. So the assertion lives here and the data stays there, rather than being duplicated.
//
// The criterion is Escher's own: THE THREE FISH MEETING AT A THREE-FOLD VERTEX MUST ALL DIFFER. It is
// necessary but not sufficient -- two of the eight homomorphisms the group admits fail it, and the one
// actually used was picked from the remaining six against the woodcut's own pixels.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { RegularTiling } from "../src/data/atlas/tiling.js";
import {
  PALETTE,
  FISH_ROLE,
  OVERLAPS,
  PHI_G0,
  PHI_STABILISER,
  escherColorSymmetry,
  overlapRoles,
} from "../docs/demo/escher-colors.js";

const ART = JSON.parse(readFileSync(new URL("../docs/escher-atlas.json", import.meta.url), "utf8"));

// The four fish. Each is drawn as TWO shapes -- one running through the tile centre and one further out
// -- so a fish's outline is the union of both, and its angle is where its inner shape sits.
const QUARTERS = [
  { shapes: [6, 46], role: 0, deg: 63 },
  { shapes: [7, 65], role: 1, deg: 151 },
  { shapes: [4, 8], role: 0, deg: -118 },
  { shapes: [5, 27], role: 1, deg: -27 },
];

function centroid(points) {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
  }
  return [x / points.length, y / points.length];
}

function makeTiling() {
  return new RegularTiling({ p: 8, q: 3, frameSymmetry: 4, colorSymmetry: escherColorSymmetry() });
}

// Every fish in a patch around the origin, positioned in one float frame. Only for testing: the library
// never builds a global frame, and `globalFrameForTesting` exists to let checks like this one talk about
// several tiles at once.
function fishPatch(tiling, depth) {
  const seen = new Map();
  let frontier = [tiling.originAddress()];
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const node of frontier) {
      if (seen.has(node.id)) continue;
      seen.set(node.id, node);
      for (let g = 0; g < tiling.generatorCount(); g++) next.push(tiling.extendAddress(node, g));
    }
    frontier = next;
  }
  const out = [];
  for (const node of seen.values()) {
    const frame = tiling.globalFrameForTesting(node);
    const perm = tiling.colorPermutation(node);
    const centre = frame.applyToLocal(0, 0, undefined, [0, 0]).slice();
    const fish = QUARTERS.map((q) => {
      const points = [];
      for (const s of q.shapes) {
        for (const p of ART.drawables[s].points) points.push(frame.applyToLocal(p[0], p[1], undefined, [0, 0]).slice());
      }
      return { points, color: perm[q.role] };
    });
    out.push({ id: node.id, cx: centre[0], cy: centre[1], fish });
  }
  return out;
}

// Hyperbolic distance between two POINCARE DISK points. Everything here is in disk coordinates --
// `applyToLocal` returns them -- and Euclidean distance in the disk is not the metric: the three
// octagons around a vertex are equidistant from it hyperbolically and up to 1.4x apart Euclidean.
function hypDist(ax, ay, bx, by) {
  const num = (ax - bx) ** 2 + (ay - by) ** 2;
  const den = (1 - ax * ax - ay * ay) * (1 - bx * bx - by * by);
  return Math.acosh(1 + (2 * num) / den);
}

// How close a fish's own outline comes to a point.
function reach(fish, vx, vy) {
  let best = Infinity;
  for (const p of fish.points) {
    const d = hypDist(p[0], p[1], vx, vy);
    if (d < best) best = d;
  }
  return best;
}

// The three fish that meet at a vertex: one from each of the three octagons that meet there, and in
// each of those, the fish whose outline reaches the vertex.
//
// Both halves matter. Picking the three nearest OUTLINES gives the wrong answer -- four fish of the
// same octagon crowd every vertex, so the three nearest are often two from one tile -- and picking the
// three nearest CENTROIDS gives the wrong answer too, because a fish is long and its centroid can sit
// further from a vertex it touches than another's does from one it misses.
function vertexTriple(tiles, vx, vy) {
  const byDist = tiles
    .map((t) => ({ d: hypDist(t.cx, t.cy, vx, vy), t }))
    .sort((a, b) => a.d - b.d);
  const three = byDist.slice(0, 3).map(({ t }) => {
    let best = t.fish[0];
    for (const f of t.fish) if (reach(f, vx, vy) < reach(best, vx, vy)) best = f;
    return { fish: best, tile: t.id };
  });
  return { three, spread: byDist[2].d / byDist[0].d, gap: byDist[3].d / byDist[2].d };
}

// The three-fold vertices of one octagon at which a single fish of that octagon converges, in DISK
// coordinates like everything else here.
//
// {8,3} has two classes of vertex and they are not alike here. At the ODD ones a fish's body runs into
// the corner: measured, one fish of the octagon reaches within 0.01 and the next is 0.46 away, so "the
// fish this octagon contributes" is unambiguous and three octagons give three fish. At the EVEN ones
// the vertex lies ON the seam between two adjacent fish, both of which touch it at 0.03, and there is
// no fact of the matter about which one to count. So the rule is checked where it is well defined.
function originVertices(tiling) {
  const r = Math.tanh(tiling.metrics.circumradius / 2);
  const out = [];
  for (let k = 1; k < 8; k += 2) {
    const a = Math.PI / 8 + (2 * Math.PI * k) / 8;
    out.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return out;
}

test("the artwork's fills map onto four roles, two fish per role and two overlaps per role", () => {
  const tiling = makeTiling();
  const roles = Object.assign({}, FISH_ROLE, overlapRoles(tiling));
  // Every fill the page recolors must exist in the file, and every fill in the file must be either
  // recolored or deliberately constant. A fill that is neither would silently keep a placeholder tint.
  const inFile = new Set(ART.drawables.map((d) => d.fill).filter((f) => f && f !== "none"));
  const CONSTANT = new Set(["#ffffff", "#000000"]);
  for (const fill of Object.keys(roles)) {
    assert.ok(inFile.has(fill), `escher-colors.js recolors ${fill}, which is not in escher-atlas.json`);
  }
  for (const fill of inFile) {
    assert.ok(roles[fill] !== undefined || CONSTANT.has(fill),
      `${fill} is in the artwork but is neither given a role nor a declared constant`);
  }
  // The eyes must never be permuted: they are the same in every fish.
  for (const c of CONSTANT) assert.equal(roles[c], undefined, `${c} must stay constant`);

  // Two shapes per fish (one through the tile centre, one further out), and the four fish pair up on
  // opposite diagonals, so each of roles 0 and 1 is carried by exactly four shapes.
  const perRole = [0, 0, 0, 0];
  for (const d of ART.drawables) if (roles[d.fill] !== undefined) perRole[roles[d.fill]]++;
  assert.deepEqual(perRole, [4, 4, 2, 2],
    `four shapes for each of the octagon's own two colors, two for each overlapping color, got ${perRole}`);
});

test("opposite fish share a color and adjacent ones do not, which is what phi(P) says", () => {
  const tiling = makeTiling();
  const perm = tiling.colorPermutation(tiling.originAddress());
  assert.deepEqual(perm, [0, 1, 2, 3], "the origin tile is the prototype");
  // The user's own specification of the centre octagon: yellow on the (63, -118) diagonal, green on
  // the (151, -27) one.
  const colorAt = (deg) => PALETTE[perm[QUARTERS.find((q) => q.deg === deg).role]];
  assert.equal(colorAt(63), colorAt(-118), "opposite fish must match");
  assert.equal(colorAt(151), colorAt(-27), "opposite fish must match");
  assert.notEqual(colorAt(63), colorAt(151), "adjacent fish must not");
  assert.equal(colorAt(63), "#ffeeaa", "yellow at top-right and bottom-left");
  assert.equal(colorAt(151), "#afe9af", "green at top-left and bottom-right");
  // phi(P) swaps them, which is the reason an octagon shows two colors and not four.
  assert.equal(PHI_STABILISER[0], 1);
  assert.equal(PHI_STABILISER[1], 0);
});

test("three fish meet at every three-fold vertex and no two of them share a color", () => {
  const tiling = makeTiling();
  const tiles = fishPatch(tiling, 4);
  let checked = 0;
  for (const [vx, vy] of originVertices(tiling)) {
    const { three, spread, gap } = vertexTriple(tiles, vx, vy);
    // Anti-vacuity: exactly three octagons must meet here, equidistant, with the fourth clearly further
    // out -- otherwise "the three that meet" is picking arbitrary tiles and any coloring would pass.
    assert.ok(spread < 1.001, `the three octagons at a vertex are not equidistant (spread ${spread})`);
    assert.ok(gap > 1.4, `the fourth octagon is not clearly further (gap ${gap})`);
    assert.equal(new Set(three.map((n) => n.tile)).size, 3);
    assert.equal(new Set(three.map((n) => n.fish.color)).size, 3,
      `vertex at (${vx.toFixed(3)}, ${vy.toFixed(3)}) shows ${three.map((n) => PALETTE[n.fish.color])}`);
    checked++;
  }
  assert.equal(checked, 4);
});

test("Escher's rule narrows the homomorphisms but does not pick one on its own", () => {
  // The anti-vacuity check for the test above. If every homomorphism satisfied the three-color rule,
  // that test would be blessing whatever it was given; it eliminates two of the eight. It is recorded
  // here that it does NOT get all the way to one, so nobody later mistakes it for the whole argument.
  const mul = (a, b) => a.map((_, i) => a[b[i]]);
  const inv = (a) => {
    const r = a.slice();
    a.forEach((v, i) => {
      r[v] = i;
    });
    return r;
  };
  const HOMOMORPHISMS = [
    [0, 2, 3, 1], [0, 3, 1, 2], [1, 2, 0, 3], [1, 3, 2, 0],
    [2, 0, 1, 3], [2, 1, 3, 0], [3, 0, 2, 1], [3, 1, 0, 2],
  ];
  const passes = [];
  for (const g0 of HOMOMORPHISMS) {
    const gens = new Array(8);
    gens[0] = g0;
    gens[1] = inv(g0);
    for (let g = 0; g < 6; g++) gens[g + 2] = mul(mul(PHI_STABILISER, gens[g]), inv(PHI_STABILISER));
    const tiling = new RegularTiling({
      p: 8, q: 3, frameSymmetry: 4,
      colorSymmetry: { colors: 4, generators: gens, stabiliser: PHI_STABILISER },
    });
    const tiles = fishPatch(tiling, 4);
    const ok = originVertices(tiling).every(([vx, vy]) =>
      new Set(vertexTriple(tiles, vx, vy).three.map((n) => n.fish.color)).size === 3);
    if (ok) passes.push(g0.join(""));
  }
  assert.deepEqual(passes.sort(), ["0231", "0312", "2013", "2130", "3021", "3102"],
    "six of the eight homomorphisms should survive Escher's rule, and two should not");
  assert.ok(passes.includes(PHI_G0.join("")), "and PHI_G0 must be one of them");
  // The rule narrows but does not decide: the survivor was picked from these six against the woodcut's
  // own pixels. See the comment on PHI_G0.
});

test("each overlap piece takes the color its own neighbour paints that fish", () => {
  // The four greys are not this octagon's fish: they are parts of four neighbours' fish that fall
  // inside it, and they have to agree with what that neighbour draws or the pattern tears at the seam.
  const tiling = makeTiling();
  const origin = tiling.originAddress();
  const roles = overlapRoles(tiling);
  for (const { fill, generator, role } of OVERLAPS) {
    const neighbour = tiling.extendAddress(origin, generator);
    assert.equal(roles[fill], tiling.colorPermutation(neighbour)[role]);
  }
  // And in the prototype they come out as the two colors the octagon does NOT itself show.
  //
  // This is the property that makes the picture legible, and it is worth an assertion because losing it
  // is not subtle and not caught by anything else here. An overlap wedge sits against this octagon's own
  // fish; if it were painted the same color it would MERGE with it into one blob, and the four-color
  // interlock would collapse into large single-color patches. Two of the admissible homomorphisms do
  // exactly that. It is invisible to any check that samples the middle of a fish -- one of them scored
  // BETTER than the right answer that way -- and obvious the moment you compare whole areas.
  const own = new Set([0, 1]);
  const shown = new Set(Object.values(roles));
  assert.deepEqual([...shown].sort(), [2, 3], `overlaps show ${[...shown]}, expected the other two colors`);
  for (const v of shown) assert.ok(!own.has(v), "an overlap wedge must not merge with the fish beside it");
});
