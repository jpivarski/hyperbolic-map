// Emit what the ANCHORED path actually computes, as JSON, for the numerical audit to check.
//
//     node dev/emit_atlas_samples.mjs > build/atlas-samples.json
//
// For each tiling and each walk distance, this walks the camera out along a fixed word, then records
// the relative frame and the projected screen position of a few tile-local sample points for every
// tile in the neighborhood. dev/audit_atlas_numeric.py recomputes the same quantities at 60 digits
// three independent ways and compares.
//
// The walk words are deterministic and are emitted too, so the oracle walks EXACTLY the same path --
// otherwise a disagreement could not be attributed.

import { Isom } from "../src/core/isom.js";
import { RegularTiling, BinaryTiling } from "../src/data/atlas/tiling.js";
import { Anchor } from "../src/data/atlas/anchor.js";

const SPECS = [
  { name: "{8,3} m=4", kind: "regular", p: 8, q: 3, frameSymmetry: 4 },
  { name: "{8,3}", kind: "regular", p: 8, q: 3 },
  { name: "{7,3}", kind: "regular", p: 7, q: 3 },
  { name: "{5,4}", kind: "regular", p: 5, q: 4 },
  { name: "{4,5}", kind: "regular", p: 4, q: 5 },
  { name: "{6,4}", kind: "regular", p: 6, q: 4 },
  { name: "{3,7}", kind: "regular", p: 3, q: 7 },
  { name: "{12,3}", kind: "regular", p: 12, q: 3 },
  { name: "binary", kind: "binary" },
];

// Walk lengths in TILES. 5000 is far past anything a global frame could represent: for {8,3} that is
// hyperbolic distance ~3800, where cosh(d/2) overflows float64 entirely.
const WALKS = [0, 1, 5, 50, 500, 5000];

// Sample points in tile-local coordinates: the center and four offsets, chosen asymmetrically so a
// mirrored or rotated frame would show up as a mismatch rather than canceling.
const SAMPLES = [[0, 0], [0.31, 0.07], [-0.11, 0.27], [0.05, -0.19], [0.4, 0.4]];

function walkWord(tiling, steps, seed) {
  // A deterministic pseudo-random word, so the walk turns corners instead of running along one
  // direction where errors could cancel.
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const word = [];
  for (let i = 0; i < steps; i++) word.push(Math.floor(rand() * tiling.generatorCount()));
  return word;
}

const out = { specs: [] };

for (const spec of SPECS) {
  const tiling = spec.kind === "regular" ? new RegularTiling(spec) : new BinaryTiling();
  const entry = { name: spec.name, kind: spec.kind, walks: [] };
  if (spec.kind === "regular") {
    entry.p = spec.p;
    entry.q = spec.q;
    entry.frameSymmetry = spec.frameSymmetry || spec.p;
  }

  for (const steps of WALKS) {
    const word = walkWord(tiling, steps, 1234 + steps);
    // Walk the camera out along the word, tracking the address only. The point of the exercise is
    // that no global frame is formed even here.
    const anchor = new Anchor(tiling);
    const genPath = [];
    for (const g of word) {
      const nbrs = tiling.neighbors(anchor.address);
      const chosen = nbrs.find((n) => n.gen === g) || nbrs[g % nbrs.length];
      genPath.push(chosen.gen);
      anchor.address = chosen.address;
    }

    const V = Isom.identity(); // camera-relative view: the camera looking straight at its own tile
    const tiles = anchor.neighborhood(V, 0.62, 60);
    const rec = {
      steps,
      genPath,
      address: tiling.addressToString(anchor.address),
      maxViewEntry: Anchor.maxEntry(V),
      tiles: [],
    };
    for (const t of tiles) {
      // The relative word for this tile is not returned by neighborhood(), so recover it by matching
      // the address: the oracle needs a path, not just a matrix. For canonical (binary) addresses this
      // is exact; for word addresses the address IS the path from the origin, so the relative path is
      // its suffix after the camera's word.
      const rel = t.rel;
      const net = V.mul(rel);
      rec.tiles.push({
        address: tiling.addressToString(t.address),
        rel: [rel.ar, rel.ai, rel.br, rel.bi],
        screen: SAMPLES.map((p) => {
          const z = net.applyToLocal(p[0], p[1], undefined, [0, 0]);
          return [z[0], z[1]];
        }),
      });
    }
    entry.walks.push(rec);
  }
  out.specs.push(entry);
}

// Also emit the generator tables so the oracle uses the SAME generators rather than rebuilding them
// from p and q and risking a different convention.
out.generators = {};
for (const spec of SPECS) {
  const tiling = spec.kind === "regular" ? new RegularTiling(spec) : new BinaryTiling();
  out.generators[spec.name] = [];
  for (let i = 0; i < tiling.generatorCount(); i++) {
    const g = tiling.generator(i);
    out.generators[spec.name].push([g.ar, g.ai, g.br, g.bi]);
  }
}

process.stdout.write(JSON.stringify(out));
