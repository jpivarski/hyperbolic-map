// Tilings of the hyperbolic plane, addressed LOCALLY.
//
// The contract here is deliberately global-free, and that is the whole point of the rewrite. A tiling
// supplies, for each tile: an integer or word ADDRESS, the list of its neighbours' addresses with the
// index of the generator that reaches each, and a table of CONSTANT generator matrices. It never
// supplies a tile's frame relative to the world origin, because that frame has entries of order
// cosh(d/2) -- 1.08e75 for binary cell (500, 0) -- and multiplying it by an equally large view matrix
// to get an O(1) screen position destroys every digit.
//
// Instead the renderer starts at the camera's own tile with the identity and multiplies by one
// constant generator per step of the walk (see anchor.js). Every matrix on the path from a tile's own
// JSON coordinates to the screen is then O(1), whatever the camera's absolute position.
//
// Proved in tools/audit_atlas_math.py (31/31), recorded in notes/math-audit.md. Load-bearing results:
//
//   * appending a generator multiplies the frame on the RIGHT, F_{c.g} = F_c . G_g, so the relative
//     frame of a neighbour IS that generator and a walk telescopes to a plain product (claims 3, 3b, 4);
//   * every binary neighbour step is a position-independent constant -- all lat and lon cancel
//     symbolically -- while the GENERAL relative frame is not, so it must never be used (claims 5, 5b);
//   * an edge half-turn squares to -I, not +I, so g^-1 = -g is the SAME isometry and every matrix
//     comparison here must be up to sign (claims 9, 9b);
//   * the tile membership test is "nearest centre wins", whose boundary is the perpendicular bisector
//     and passes through the edge midpoint at exactly the inradius (claims 11, 11c).
//
// All metric relations were verified BY CONSTRUCTION -- build the polygon and measure -- rather than
// formula against formula, which is how an inverted inradius slipped through once. See notes/tilings.md.

import { Isom } from "../../core/isom.js";
import { halfPlaneToLocal, localToHalfPlane } from "../../core/coords.js";

// Boundary edge kinds. Geodesics are circles orthogonal to the unit circle; horocycles are circles
// internally TANGENT to it. The binary tiling needs both.
export const EDGE_GEODESIC = "geodesic";
export const EDGE_HOROCYCLE = "horocycle";

// ---------------------------------------------------------------------------------------------
// Regular {p, q}
// ---------------------------------------------------------------------------------------------

// At curvature K = -1, for a regular p-gon with vertex angle 2*pi/q:
//
//     circumradius   cosh(chi) = cot(pi/p) * cot(pi/q)
//     inradius       cosh(psi) = cos(pi/q) / sin(pi/p)
//     half-edge      cosh(phi) = cos(pi/p) / sin(pi/q)
//     check          cosh(chi) = cosh(psi) * cosh(phi)
//
// TRAP: cos(pi/p)/sin(pi/q) is the HALF-EDGE, not the inradius. The two swap under p <-> q and
// coincide for self-dual {p,p}, so an inverted formula survives casual checking.
export function regularMetrics(p, q) {
  if (!(1 / p + 1 / q < 0.5)) {
    throw new Error(`hyperbolic-map: {${p},${q}} is not hyperbolic (need 1/p + 1/q < 1/2)`);
  }
  const chi = Math.acosh(1 / (Math.tan(Math.PI / p) * Math.tan(Math.PI / q)));
  const psi = Math.acosh(Math.cos(Math.PI / q) / Math.sin(Math.PI / p));
  const phi = Math.acosh(Math.cos(Math.PI / p) / Math.sin(Math.PI / q));
  return {
    p,
    q,
    circumradius: chi,
    inradius: psi,
    halfEdge: phi,
    edgeLength: 2 * phi,
    centreSpacing: 2 * psi,
  };
}

// Two matrices represent the SAME isometry iff they agree up to an overall sign: SU(1,1) double-covers
// the isometry group, and an edge half-turn squares to -I rather than +I (audit claim 9). Any code
// that compares generators or frames must go through this.
function sameIsometry(a, b, tol = 1e-12) {
  const plus = Math.max(Math.abs(a.ar - b.ar), Math.abs(a.ai - b.ai),
                        Math.abs(a.br - b.br), Math.abs(a.bi - b.bi));
  const minus = Math.max(Math.abs(a.ar + b.ar), Math.abs(a.ai + b.ai),
                         Math.abs(a.br + b.br), Math.abs(a.bi + b.bi));
  return Math.min(plus, minus) < tol;
}

export class RegularTiling {
  // `frameSymmetry` (m, a divisor of p) is the rotational symmetry the tile art is promised to have.
  // It selects the walk group so that the tile stabiliser is C_m, which is what makes "the same data
  // in every tile" produce a consistent pattern. See notes/tilings.md and
  // notes/escher-circle-limit-iii.md -- for Circle Limit III this must be 4, not 8, and using the
  // default half-turn generators there would silently shred the pattern.
  constructor({ p, q, frameSymmetry = null } = {}) {
    this.metrics = regularMetrics(p, q);
    this.p = p;
    this.q = q;
    this.m = frameSymmetry || p;
    if (p % this.m !== 0) {
      throw new Error(`hyperbolic-map: frameSymmetry ${this.m} must divide p = ${p}`);
    }

    const psi = this.metrics.inradius;
    const chi = this.metrics.circumradius;

    // Vertices at angles pi/p + 2*pi*k/p, so that EDGE MIDPOINTS land on 2*pi*k/p (edge 0's midpoint
    // is on the +x axis).
    this.vertexDisk = [];
    for (let k = 0; k < p; k++) {
      const a = Math.PI / p + (2 * Math.PI * k) / p;
      this.vertexDisk.push([Math.tanh(chi / 2) * Math.cos(a), Math.tanh(chi / 2) * Math.sin(a)]);
    }

    // Generators. Constant matrices, built once here and never rebuilt.
    if (this.m === p) {
      // Half-turn about each edge midpoint. Always a symmetry of {p,q} -- it is the "2" of the
      // (2,p,q) triangle group -- including for ODD p. (Only pure TRANSLATIONS between adjacent
      // tiles need even p; do not confuse the two.) Each is an involution AS AN ISOMETRY: the matrix
      // squares to -I, so g^-1 = -g, and the edge back to the parent carries the same index in the
      // child. That makes words walk-reversible for free.
      const g0 = new Isom(0, Math.cosh(psi), 0, -Math.sinh(psi));
      this.generators = [];
      for (let k = 0; k < p; k++) {
        const s = Isom.rotation((2 * Math.PI * k) / p);
        this.generators.push(s.mul(g0).mul(Isom.rotation((-2 * Math.PI * k) / p)));
      }
    } else {
      // The half-turn is generally outside the subgroup with stabiliser C_m, so use rotations about
      // the vertices instead. Every m-th vertex is a "class A" vertex; rotating about one by
      // +/- 2*pi/q reaches the two tiles across the edges incident there, which covers all p
      // neighbours.
      const order = this.q;
      this.generators = [];
      for (let k = 0; k < p; k += p / this.m) {
        const v = this.vertexDisk[k];
        for (const sense of [1, -1]) {
          this.generators.push(
            Isom.translationToDisk(v[0], v[1])
              .mul(Isom.rotation((sense * 2 * Math.PI) / order))
              .mul(Isom.translationToDisk(-v[0], -v[1])),
          );
        }
      }
      // The tile's own rotation, which the art must respect.
      this.selfRotation = Isom.rotation((2 * Math.PI) / this.m);
    }

    // Which generator undoes each generator. The set is closed under inverse UP TO SIGN in both
    // cases: for m = p every generator is its own inverse; for m < p the +/- senses about each vertex
    // pair up. Verified in the constructor rather than assumed, because a wrong entry here would make
    // words fail to reduce and the walk would revisit its own parent forever.
    this.inverseIndex = this.generators.map((g, i) => {
      const gi = g.inverse();
      for (let j = 0; j < this.generators.length; j++) {
        if (sameIsometry(gi, this.generators[j])) return j;
      }
      throw new Error(`hyperbolic-map: {${p},${q}} generator ${i} has no inverse in the set`);
    });

    // Neighbour tile CENTRES in this tile's own local coordinates, for the membership test. Constant.
    this.neighbourCentresLocal = this.generators.map((g) => {
      const z = g.applyToDisk(0, 0, [0, 0]);
      const k = 1 / Math.sqrt(1 - z[0] * z[0] - z[1] * z[1]);
      const x = z[0] * k;
      const y = z[1] * k;
      return [x, y, Math.sqrt(1 + x * x + y * y)];
    });

    // The tile boundary in tile-local coordinates: p geodesic edges between consecutive vertices.
    this.boundaryLocalPoints = this.vertexDisk.map(([zx, zy]) => {
      const k = 1 / Math.sqrt(1 - zx * zx - zy * zy);
      return [zx * k, zy * k];
    });

    // Addresses are words, so two different words can name the same tile: the walk must deduplicate
    // geometrically. (Contrast BinaryTiling, whose integer addresses are canonical.)
    this.addressesAreCanonical = false;
  }

  // ---- addressing ----

  originAddress() {
    return [];
  }

  addressToString(address) {
    return address.length === 0 ? "root" : address.join(".");
  }

  addressEquals(a, b) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  // Append a generator, cancelling it against the last one if they are mutual inverses. Free
  // reduction only -- it keeps words short and makes an out-and-back walk return the SAME address,
  // which is what the round-trip property test checks. It is not a full normal form: the {p,q}
  // reflection group has braid relations too, so two genuinely different words can still name one
  // tile. That is why the walk deduplicates geometrically as well, and why notes/open-questions.md
  // records the Coxeter shortlex automaton as the rigorous upgrade.
  extendAddress(address, gen) {
    const n = address.length;
    if (n > 0 && this.inverseIndex[address[n - 1]] === gen) return address.slice(0, n - 1);
    return address.concat([gen]);
  }

  // Built in generator order, so an index into this list is also a generator index. `stepToward`
  // returns an index into it.
  neighbours(address) {
    const out = [];
    for (let g = 0; g < this.generators.length; g++) {
      out.push({ address: this.extendAddress(address, g), gen: g });
    }
    return out;
  }

  generator(i) {
    return this.generators[i];
  }

  inverseGenerator(i) {
    return this.inverseIndex[i];
  }

  generatorCount() {
    return this.generators.length;
  }

  // ---- geometry, all in tile-local coordinates ----

  // Is this tile-local point inside this tile? A regular tiling's tiles are exactly the Voronoi cells
  // of their centres, so the test is "closer to my centre than to any neighbour's".
  //
  // cosh(d/2) to my own centre (the local origin) is just w, and to a neighbour centre N it is
  // sqrt(A^2 + B^2) with A = w*nw - x*nx - y*ny and B = x*ny - y*nx. Audit claim 11 proves the
  // boundary of this test passes through the edge midpoint at exactly the inradius.
  //
  // NOTE: this is NOT the test in tools/fit_escher_tile.py, which compares A against nw^2. That is a
  // different, larger region -- at the edge midpoint its value is -0.63 at the {8,3} inradius instead
  // of zero (audit claim 11b). Harmless in the cutter, which deliberately over-includes and relies on
  // render-time clipping, but wrong here.
  containsLocal(x, y, tol = 0) {
    const w = Math.sqrt(1 + x * x + y * y);
    const own = w * w;
    for (let i = 0; i < this.neighbourCentresLocal.length; i++) {
      const [nx, ny, nw] = this.neighbourCentresLocal[i];
      const A = w * nw - x * nx - y * ny;
      const B = x * ny - y * nx;
      if (A * A + B * B < own - tol) return false;
    }
    return true;
  }

  // Which neighbour to move to, to get closer to containing this tile-local point? Returns an INDEX
  // INTO `neighbours(address)`, or -1 if the point is already inside.
  //
  // An index into the neighbour list, not a generator index. Those coincide here but not for the binary
  // tiling, whose parent step comes in two parities -- and naming a generator there produced a real bug:
  // `stepToward` said PARENT_EVEN, an odd-longitude cell offered only PARENT_ODD, the lookup failed, and
  // the camera could never move UP. It then chased downward forever: max|V| reached 2.6e24 and the
  // latitude ran to several hundred digits.
  //
  // A regular tiling's tiles are the Voronoi cells of their centres, so:
  //
  //   * stop when the point is INSIDE -- the exact predicate, no tolerance, so a point sitting on a
  //     bisector counts as inside and cannot make the camera oscillate between two tiles;
  //   * otherwise step to the NEAREST neighbour centre. Not inside means some neighbour's centre is
  //     strictly nearer, so the distance to the containing tile strictly decreases every step. That is
  //     what makes the descent monotone, hence terminating.
  //
  // Stepping to the most VIOLATED half-plane instead sounds equivalent and is not: violation magnitude
  // is not a distance, so the descent is not monotone in it. Measured on {7,3}, that variant took 4,127
  // re-anchor steps for 300 small camera moves -- it was cycling.
  stepToward(x, y) {
    // A RELATIVE tolerance on the containment test, not an exact one. A point lying within rounding of a
    // bisector is genuinely ambiguous: each of the two tiles computes the other as a hair nearer, and the
    // camera ping-pongs. Measured on {7,3}: one camera move in forty hit the iteration cap at 4,096
    // steps while every other took one. Treating "within 1e-11 of the boundary" as inside removes the
    // ambiguity, and the error it admits -- the camera tile being a neighbour of the containing one for
    // points a hair from the edge -- is harmless, since the camera tile only has to be NEAR.
    if (this.containsLocal(x, y, 1e-11 * (1 + x * x + y * y))) return -1;
    const w = Math.sqrt(1 + x * x + y * y);
    let best = w * w;
    let pick = -1;
    for (let i = 0; i < this.neighbourCentresLocal.length; i++) {
      const [nx, ny, nw] = this.neighbourCentresLocal[i];
      const A = w * nw - x * nx - y * ny;
      const B = x * ny - y * nx;
      const d = A * A + B * B;
      if (d < best) {
        best = d;
        pick = i;
      }
    }
    return pick;
  }

  boundaryLocal() {
    return { kind: EDGE_GEODESIC, points: this.boundaryLocalPoints };
  }

  // DIAGNOSTIC ONLY -- the global frame, entries of order cosh(d/2). Never call this on the render
  // path; it exists so tests can compare the anchored machinery against the naive computation in the
  // near-origin regime where the naive one is still trustworthy, and so the mpmath oracle has
  // something to check. Deliberately named to be greppable.
  globalFrameForTesting(address) {
    let m = Isom.identity();
    for (let i = 0; i < address.length; i++) {
      m = m.mul(this.generators[address[i]]);
      if ((i & 7) === 7) m.normalize();
    }
    return m.normalize();
  }
}

// ---------------------------------------------------------------------------------------------
// Binary (Boroczky) tiling
// ---------------------------------------------------------------------------------------------

// In the upper half-plane, cell (latitude, longitude) is
//
//     x in [longitude * 2^latitude, (longitude + 1) * 2^latitude]
//     y in [2^latitude, 2^(latitude + 1)]
//
// Every cell is congruent, of hyperbolic area exactly 1/2. Cells are NOT regular polygons and NOT
// convex: two sides are geodesics (x = const) and two are horocycles (y = const). The tiling is not
// edge-to-edge -- each cell has FIVE neighbours (one parent, two children, two lateral), because a
// cell's bottom edge is the union of its two children's top edges.
//
// It is also only weakly aperiodic: monohedral but NOT tile-transitive, its symmetry group being
// essentially <z -> 2z>. So it cannot produce a seamless group-invariant pattern the way {p,q} can --
// but z -> 2z maps cell (lat, lon) to cell (lat+1, lon) bijectively, so LATITUDE SHIFT is an exact
// symmetry, and that is what the far-field invariance diagnostic uses.
//
// Tile-local coordinates: every cell is the SAME box in its own frame,
//
//     x in +/- 1/(2*sqrt(2)),   y in [2^-0.5, 2^0.5]
//
// The half-width is 0.5/sqrt(2), NOT 0.5, because the frame's scale factor applies to both axes while
// the cell's x-width is only 2^latitude. That (lat, lon)-independence is what makes "the same
// prototype in every cell" work.
export const BINARY_LOCAL_HALF_WIDTH = 0.5 / Math.SQRT2;
export const BINARY_LOCAL_Y_LOW = 1 / Math.SQRT2;
export const BINARY_LOCAL_Y_HIGH = Math.SQRT2;

// Generator indices. Six, not five: the parent step depends on the current cell's longitude PARITY,
// and splitting it that way is what keeps both variants constant.
export const BIN_RIGHT = 0;
export const BIN_LEFT = 1;
export const BIN_CHILD0 = 2;
export const BIN_CHILD1 = 3;
export const BIN_PARENT_EVEN = 4;
export const BIN_PARENT_ODD = 5;

// The half-plane map z -> S z + T, conjugated into SU(1,1) by the Cayley transform C = [[i,1],[1,i]].
// Verified symbolically (audit claim 6): a = (S + 1 + iT)/(2 sqrt S), b = (T + i(S - 1))/(2 sqrt S),
// and |a|^2 - |b|^2 = 1 identically. An earlier hand derivation had b's real and imaginary parts
// swapped, which is exactly why this is checked rather than trusted.
function isomFromScaleShift(S, T) {
  const rs = Math.sqrt(S);
  const inv = 1 / rs;
  return new Isom((rs + inv) / 2, (T * inv) / 2, (T * inv) / 2, (rs - inv) / 2).normalize();
}

// The six CONSTANT neighbour steps, each mapping NEIGHBOUR-local coordinates into CURRENT-cell-local
// coordinates. Every latitude and longitude cancels; audit claim 5 proves it symbolically and claims
// 5c-5e confirm the parity rule by showing child-then-parent round trips are exactly the identity.
const R2 = Math.SQRT2;
const BINARY_GENERATORS = [];
BINARY_GENERATORS[BIN_RIGHT] = isomFromScaleShift(1, 1 / R2);
BINARY_GENERATORS[BIN_LEFT] = isomFromScaleShift(1, -1 / R2);
BINARY_GENERATORS[BIN_CHILD0] = isomFromScaleShift(0.5, -0.25 / R2);
BINARY_GENERATORS[BIN_CHILD1] = isomFromScaleShift(0.5, 0.25 / R2);
BINARY_GENERATORS[BIN_PARENT_EVEN] = isomFromScaleShift(2, 0.5 / R2);
BINARY_GENERATORS[BIN_PARENT_ODD] = isomFromScaleShift(2, -0.5 / R2);

// child0 leads to a cell whose longitude is EVEN (2*lon), so the way back from there is the
// even-parity parent step -- and vice versa. This pairing is what claims 5c and 5d verify.
const BINARY_INVERSE = [];
BINARY_INVERSE[BIN_RIGHT] = BIN_LEFT;
BINARY_INVERSE[BIN_LEFT] = BIN_RIGHT;
BINARY_INVERSE[BIN_CHILD0] = BIN_PARENT_EVEN;
BINARY_INVERSE[BIN_CHILD1] = BIN_PARENT_ODD;
BINARY_INVERSE[BIN_PARENT_EVEN] = BIN_CHILD0;
BINARY_INVERSE[BIN_PARENT_ODD] = BIN_CHILD1;

export class BinaryTiling {
  constructor() {
    // Centre spacing: the distance between a cell's centre and its lateral neighbour's, used to size
    // the walk radius. Measured from the generator rather than asserted.
    const g = BINARY_GENERATORS[BIN_RIGHT];
    this.metrics = {
      centreSpacing: 2 * Math.asinh(Math.hypot(g.br, g.bi)),
      // A cell's own extent, playing the role of a circumradius: the farthest corner of the local box.
      circumradius: (() => {
        let worst = 0;
        for (const hx of [-BINARY_LOCAL_HALF_WIDTH, BINARY_LOCAL_HALF_WIDTH]) {
          for (const hy of [BINARY_LOCAL_Y_LOW, BINARY_LOCAL_Y_HIGH]) {
            const l = halfPlaneToLocal(hx, hy, [0, 0]);
            worst = Math.max(worst, 2 * Math.asinh(Math.hypot(l[0], l[1])));
          }
        }
        return worst;
      })(),
    };
    // Integer addresses are canonical: one cell, one (lat, lon). No geometric dedup needed.
    this.addressesAreCanonical = true;
  }

  // ---- addressing ----
  //
  // BigInt, because descending one latitude DOUBLES the longitude index: fifty descents pass 2^50 and
  // a float64 longitude stops being exact. Addresses are identity only and never enter the geometry,
  // so BigInt costs nothing on the render path.

  originAddress() {
    return { lat: 0n, lon: 0n };
  }

  addressToString(address) {
    return `${address.lat},${address.lon}`;
  }

  addressEquals(a, b) {
    return a.lat === b.lat && a.lon === b.lon;
  }

  // The ORDER of this list is part of the contract: `stepToward` returns an index into it.
  neighbours(address) {
    const { lat, lon } = address;
    // Floor division for negative longitudes: BigInt / truncates toward zero, so -1n/2n is 0n where
    // the parent of cell -1 must be cell -1. Off-by-one here would break the western hemisphere only,
    // which is precisely the kind of asymmetry a diagnostic with hashed colours makes obvious.
    const half = lon >= 0n ? lon / 2n : -((-lon + 1n) / 2n);
    const even = (lon & 1n) === 0n;
    return [
      { address: { lat, lon: lon + 1n }, gen: BIN_RIGHT },
      { address: { lat, lon: lon - 1n }, gen: BIN_LEFT },
      { address: { lat: lat - 1n, lon: lon * 2n }, gen: BIN_CHILD0 },
      { address: { lat: lat - 1n, lon: lon * 2n + 1n }, gen: BIN_CHILD1 },
      { address: { lat: lat + 1n, lon: half }, gen: even ? BIN_PARENT_EVEN : BIN_PARENT_ODD },
    ];
  }

  generator(i) {
    return BINARY_GENERATORS[i];
  }

  inverseGenerator(i) {
    return BINARY_INVERSE[i];
  }

  generatorCount() {
    return BINARY_GENERATORS.length;
  }

  // ---- geometry ----

  // The cell is exactly its local half-plane box, so membership is two comparisons after one stable
  // conversion. Not a Voronoi test: binary cells are not the Voronoi cells of their centres, which is
  // why this cannot share the regular tiling's implementation.
  containsLocal(x, y, tol = 0) {
    const hp = localToHalfPlane(x, y, [0, 0]);
    if (!(hp[1] > 0) || !Number.isFinite(hp[0])) return false;
    return (
      hp[0] >= -BINARY_LOCAL_HALF_WIDTH - tol &&
      hp[0] <= BINARY_LOCAL_HALF_WIDTH + tol &&
      hp[1] >= BINARY_LOCAL_Y_LOW - tol &&
      hp[1] <= BINARY_LOCAL_Y_HIGH + tol
    );
  }

  // Which neighbour to move to, to get closer to containing this tile-local point? Returns an INDEX
  // INTO `neighbours(address)` -- see the note on RegularTiling.stepToward for why an index and not a
  // generator -- or -1 if the point is inside.
  //
  // The binary cell is a BOX in its own half-plane, so this reads the box test directly and is exact.
  // It cannot be done with the regular tiling's nearest-centre rule, because binary cells are NOT the
  // Voronoi cells of their centres -- and mixing the two rules made the descent CYCLE: measured, 500
  // small camera moves cost 143,407 re-anchor steps (hitting the iteration cap every time) where a
  // regular tiling needed 28.
  //
  // Order matters for termination. Lateral steps first: each shifts x by exactly the cell width, so
  // |x| strictly decreases and the horizontal part finishes. Only then move vertically, where each step
  // halves or doubles the scale and so converges geometrically. A vertical step can put x out of range
  // again, and the next iteration fixes it laterally.
  stepToward(x, y) {
    const hp = localToHalfPlane(x, y, [0, 0]);
    const hx = hp[0];
    const hy = hp[1];
    if (!(hy > 0) || !Number.isFinite(hx)) return -1;
    // Indices into the list `neighbours()` builds: 0 right, 1 left, 2 child0, 3 child1, 4 parent.
    if (hx < -BINARY_LOCAL_HALF_WIDTH) return 1;
    if (hx > BINARY_LOCAL_HALF_WIDTH) return 0;
    if (hy < BINARY_LOCAL_Y_LOW) return hx < 0 ? 2 : 3;
    if (hy > BINARY_LOCAL_Y_HIGH) return 4;
    return -1;
  }

  boundaryLocal() {
    return {
      kind: "binary-cell",
      halfWidth: BINARY_LOCAL_HALF_WIDTH,
      yLow: BINARY_LOCAL_Y_LOW,
      yHigh: BINARY_LOCAL_Y_HIGH,
    };
  }

  // Point -> cell, in WORLD half-plane coordinates. Diagnostic and data-preparation use only: it
  // needs absolute coordinates by definition, so it is not on the render path.
  locateHalfPlaneForTesting(hx, hy) {
    const lat = Math.floor(Math.log2(hy));
    const lon = Math.floor(hx * Math.pow(2, -lat));
    return { lat: BigInt(lat), lon: BigInt(lon) };
  }

  // DIAGNOSTIC ONLY -- the global frame, entries of order cosh(d/2) (1.08e75 at cell (500, 0)).
  // See RegularTiling.globalFrameForTesting.
  globalFrameForTesting(address) {
    const lat = Number(address.lat);
    const lon = Number(address.lon);
    return isomFromScaleShift(Math.pow(2, lat + 0.5), (lon + 0.5) * Math.pow(2, lat));
  }
}

// The centre of a binary cell in its own local coordinates is the local origin by construction; this
// helper survives for the demos, which use it to place the hero.
export function binaryCellCentreLocal() {
  return [0, 0];
}
