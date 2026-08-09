// Escher's four colors for the Circle Limit III atlas.
//
// This is ART DATA, not library code. What the library provides is the general mechanism -- a
// homomorphism from the walk group into a permutation group, one element per tile (see
// `colorSymmetry` in src/data/atlas/tiling.js). What lives here is the one homomorphism that makes
// escher-atlas.json come out as Escher's picture, plus the map from the file's fills to the roles it
// permutes. Kept as a module rather than inline in the page so the test suite can check the same data
// the page draws.
//
// THE IDEA. Repeating one tile's art everywhere cannot produce a four-color pattern, because the file
// would carry the same four colors into every octagon. In Circle Limit III the colors MOVE: every
// motion of the tiling permutes them. So the file carries a color ROLE per shape, and the color drawn
// in a given tile is
//
//     PALETTE[ tile.colorPermutation[ role ] ]
//
// An octagon shows only two of the four, on opposite fish, because the 90-degree rotation about its own
// center is in the group and its image swaps them.

// ---- the palette -------------------------------------------------------------------------------
//
// Jim's shades, taken from the four fish fills in escher-atlas.json. Index order matters: 0 and 1 are
// the pair the prototype octagon shows, so `stabilizer` below swaps 0 with 1 and 2 with 3.
export const PALETTE = [
  "#ffeeaa", // 0  yellow
  "#afe9af", // 1  green
  "#ffaaaa", // 2  red
  "#afc6e9", // 3  blue
];

// ---- which shape plays which role ---------------------------------------------------------------
//
// READ THIS BEFORE "FIXING" ANYTHING HERE. The fills in escher-atlas.json look like color names and
// are NOT the colors those shapes end up. They are placeholders that happen to be drawn in four
// distinguishable tints so the four fish can be told apart in Inkscape. The `#afe9af` fish is
// green-looking in the file and comes out YELLOW on the page. Matching them up "sensibly" would rotate
// the whole coloring by 90 degrees and quietly break the pattern.
//
// What decides the mapping is geometry. The four fish sit at -118, -27, 63 and 151 degrees, and
// opposite ones share a color, so the file's fills pair up (-118 with 63) and (-27 with 151). Jim's
// specification of the center octagon -- green at top-left and bottom-right, yellow at top-right and
// bottom-left -- puts role 0 (yellow) on the (63, -118) diagonal and role 1 (green) on the (151, -27)
// one. Each fish is drawn as two shapes, one through the tile center and one further out, hence two
// entries per fill.
export const FISH_ROLE = {
  "#afe9af": 0, // the fish at -118 degrees  -> yellow
  "#ffaaaa": 0, // the fish at   63 degrees  -> yellow (opposite, so the same role)
  "#afc6e9": 1, // the fish at  -27 degrees  -> green
  "#ffeeaa": 1, // the fish at  151 degrees  -> green
};

// ---- the overlap pieces --------------------------------------------------------------------------
//
// Four shapes in the file, drawn in four grays, are not this octagon's fish at all: they are the parts
// of four NEIGHBORS' fish that fall inside this octagon, which the tile has to draw itself because
// each tile is clipped to its own boundary.
//
// So their roles are not free -- each is whatever color that neighbor paints that fish, which is
// `neighbor's permutation applied to that fish's role`. Recorded here as (which neighbor, which role
// in that neighbor) and resolved against the live tiling by `overlapRoles` below, so that changing PHI
// cannot leave a stale constant behind.
//
// Established by mapping every neighbor's shapes through `stepFrame` into this tile's frame and taking
// the directed point-to-polyline distance: each gray matches one shape at 0.04 against a 0.21
// runner-up, so there is no ambiguity about which fish it is a piece of.
export const OVERLAPS = [
  { fill: "#999999", generator: 0, role: 0 }, // neighbor at    0 deg, its -118 fish
  { fill: "#cccccc", generator: 4, role: 0 }, // neighbor at  180 deg, its   63 fish
  { fill: "#e6e6e6", generator: 2, role: 1 }, // neighbor at   90 deg, its  151 fish
  { fill: "#b3b3b3", generator: 6, role: 0 }, // neighbor at  -90 deg, its   63 fish
];

// ---- the homomorphism ------------------------------------------------------------------------------
//
// PHI_STABILIZER is the image of P, the 90-degree rotation about a tile center. It has to swap the two
// colors the octagon shows -- that IS the observation that opposite fish match and adjacent ones do
// not -- and being in A_4 it must therefore swap the other two as well.
export const PHI_STABILIZER = [1, 0, 3, 2];

// PHI_G0 is the image of walk generator 0, and it is the only free parameter in the whole scheme. The
// walk group's own structure fixes everything else: {8,3} m=4 reports inverseIndex [1,0,3,2,5,4,7,6]
// and P.G_g.P^-1 = G_{g+2}, so generator 1 is generator 0's inverse and the rest are conjugates.
//
// Of the 24 permutations of four colors, 16 are not homomorphisms at all -- the library's own walk
// over the tile graph catches every one, and none of the cheap algebraic checks would. Escher's rule
// that the three fish at a three-fold vertex must all differ removes two more, which narrows it to six
// and no further.
//
// So the last step is measurement against the woodcut itself. k-means over a scan recovers Escher's
// four inks -- (117,62,32) red, (217,163,85) yellow, (143,123,75) green, (73,103,128) blue -- and each
// of the eight candidates was rendered and compared with the print AREA BY AREA: every point of a grid
// over the disk, classified in both pictures, with the rotation fitted. This one agrees on 78.4% of the
// 5,436 comparable points; the next best manages 45.9%, and the rest are at or below that.
//
// Measure the whole area, not sampled fish centers. Scoring only the center of each fish ranked a
// different candidate first, because a wrong coloring can put the right color at a fish's middle
// while painting the overlap wedges to match the fish beside them -- which merges the two into one
// blob. That is instantly obvious in the picture and invisible to a centroid.
//
// The residual 22% is the tracing and the shading of a woodcut, not disagreement. Swapping PALETTE[2]
// and PALETTE[3] gives another admissible homomorphism, and it scores 46%, which is what fixes their
// order too.
export const PHI_G0 = [2, 0, 1, 3];

function compose(a, b) {
  return a.map((_, i) => a[b[i]]);
}

function inverse(a) {
  const out = a.slice();
  a.forEach((v, i) => {
    out[v] = i;
  });
  return out;
}

// The full generator table, built from PHI_G0 by the two relations above. The library re-derives and
// re-checks all of this, and throws if it disagrees -- this is a convenience, not a trusted input.
export function escherColorSymmetry() {
  const gens = new Array(8);
  gens[0] = PHI_G0;
  gens[1] = inverse(PHI_G0);
  for (let g = 0; g < 6; g++) {
    gens[g + 2] = compose(compose(PHI_STABILIZER, gens[g]), inverse(PHI_STABILIZER));
  }
  return { colors: PALETTE.length, generators: gens, stabilizer: PHI_STABILIZER };
}

// The role each overlap piece plays in the PROTOTYPE tile, asked of the tiling rather than written down:
// it is the neighbor's own permutation applied to the fish's role there. Returns fill -> role, ready to
// be merged with FISH_ROLE.
export function overlapRoles(tiling) {
  const origin = tiling.originAddress();
  const out = {};
  for (const { fill, generator, role } of OVERLAPS) {
    out[fill] = tiling.colorPermutation(tiling.extendAddress(origin, generator))[role];
  }
  return out;
}
