// Tilings of the hyperbolic plane: GLOBAL names, LOCAL geometry.
//
// A tiling supplies, for each tile: a canonical ADDRESS, the list of its neighbours' addresses with
// the index of the generator that reaches each, and a table of CONSTANT generator matrices. Those two
// halves answer different questions and are built out of different arithmetic, which is the central
// design decision here:
//
//   IDENTITY is exact and global. A tile's address names the tile itself, the same name by every
//   route and at every distance, so tile art may depend on it. It is an integer object -- the tile's
//   centre in the Coxeter reflection representation of [p,q], over Z[2cos(pi/N)] with BigInt
//   coefficients -- because a name has to be decided by equality, and float equality of far-apart
//   frames is not a usable notion of "the same tile".
//
//   GEOMETRY is float and relative. A tiling never supplies a tile's frame relative to the world
//   origin, because that frame has entries of order cosh(d/2) -- 1.08e75 for binary cell (500, 0) --
//   and multiplying it by an equally large view matrix to get an O(1) screen position destroys every
//   digit. The renderer starts at the camera's own tile with the identity and multiplies by one
//   constant generator per step of the walk (see anchor.js), so every matrix on the path from a tile's
//   own JSON coordinates to the screen is O(1) whatever the camera's absolute position.
//
// The two meet in `stepFrame`: the float step that accompanies an edge is the one that lands in the
// neighbour's canonical frame.
//
// Proved in dev/audit_atlas_math.py (31/31), recorded in notes/math-audit.md. Load-bearing results:
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
import { buildExactCoxeter, exactIdentity, exactMatMul, exactMatPow, exactMatVec, exactMatEquals, serializeExactVector } from "./exactcoxeter.js";
import { matchGenerators, calibrateSpin, exactToIsom } from "./exactcalib.js";
import { movePointToPoint } from "../../core/isom.js";

// How much of the discovered tile graph a RegularTiling keeps. See `storeNode` for why there is a
// budget at all. The floor is comfortably larger than any one frame's working set (a 200-tile
// neighbourhood with its fringe), so ordinary panning never evicts anything it is about to want; the
// character budget is what bounds memory once ids grow long far from the origin.
const NODE_FLOOR = 4096;
const ID_CHAR_BUDGET = 4e6;

// The `kind` tag on what `boundaryLocal()` returns, saying how to trace the edges. A {p,q} tile is
// bounded by geodesics -- circles orthogonal to the unit circle. The binary cell is its own kind
// ("binary-cell"), because two of its four sides are horocycles and Atlas traces it specially.
const EDGE_GEODESIC = "geodesic";

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

// Work out how many tile classes a {p,q,m} walk group admits, and VERIFY it.
//
// The candidate modulus comes from the abelianisation (see RegularTiling.tileClass), but a candidate is
// not a proof: the assignment is only a homomorphism if it respects every relator, and getting that
// wrong would reintroduce exactly the bug the class exists to avoid -- a tile changing appearance when
// the camera re-anchors. So the candidate is checked by walking the tile graph and requiring every pair
// of routes to one tile to agree, and it degrades to a single class if it does not.
//
// Cached per {p,q,m}, and the cache earns its keep: the walk is a few hundred tiles of exact integer
// arithmetic, 41 ms for {8,3} m=4, and tilings get built repeatedly by tests and demo pages.
const TILE_CLASS_CACHE = new Map();

function regularTileClass(p, q, m, generators, inverseIndex, exact, exactGenerators) {
  const cacheKey = `${p},${q},${m}`;
  const hit = TILE_CLASS_CACHE.get(cacheKey);
  if (hit) return hit;

  // phi(g) = +1 on one generator of each inverse pair and -1 on the other. For m == p every generator
  // is its own inverse, so +1 and -1 must agree, which is what forces 2*phi = 0 there.
  const step = generators.map((_, i) => (inverseIndex[i] === i || i % 2 === 0 ? 1 : -1));
  const candidate = m < p ? q : (q % 2 === 0 ? 2 : 1);

  let modulus = 1;
  if (candidate > 1) {
    const R = exact.R;
    const norm = step.map((s) => ((s % candidate) + candidate) % candidate);
    // Tiles are recognised by their exact id -- the serialized centre M.v_O -- so "two routes reached
    // one tile" is decided by integer equality and not by how close two centres came. The centre is
    // fixed by the stabiliser, so the RAW product serves as the id directly and none of this has to
    // canonicalise anything: one matmul and one mat-vec per edge.
    const seen = new Map();
    const queue = [{ M: exactIdentity(R), c: 0 }];
    let consistent = true;
    let collisions = 0;
    while (queue.length && seen.size < 300 && consistent) {
      const node = queue.shift();
      const id = serializeExactVector(R, exactMatVec(R, node.M, exact.vO), p, q, m);
      if (seen.has(id)) {
        collisions++;
        if (seen.get(id) !== node.c) consistent = false;
        continue;
      }
      seen.set(id, node.c);
      for (let i = 0; i < generators.length; i++) {
        queue.push({ M: exactMatMul(R, node.M, exactGenerators[i]), c: (node.c + norm[i]) % candidate });
      }
    }
    // Require real evidence: a walk that never revisited a tile has proved nothing.
    if (consistent && collisions > 10) modulus = candidate;
  }

  const out = {
    modulus,
    step: step.map((s) => (modulus > 1 ? ((s % modulus) + modulus) % modulus : 0)),
  };
  TILE_CLASS_CACHE.set(cacheKey, out);
  return out;
}

// ---- color symmetry: a homomorphism from the walk group into a permutation group -------------
//
// A tile CLASS (above) is the special case of this that the library can discover on its own: a
// homomorphism onto Z/n that kills the stabiliser, so it descends to tiles and is one integer per
// tile. A color symmetry is the general case, and it is the caller's to declare, because nothing
// about {p,q} chooses it -- it is a property of the picture.
//
// The motivating case is Escher's Circle Limit III. Its four fish colors are not a property of the
// tile: every motion of the tiling permutes them, so the color of a fish is
//
//     palette[ phi(F)[ that fish's base color ] ]
//
// with F the tile's canonical frame and phi a homomorphism into A_4. Repeating one tile's art
// everywhere cannot express that, and a tile class cannot either -- {8,3} m=4 admits only Z/3, while
// the group needed has 12 elements and is not abelian.
//
// THE PART A TILE CLASS DOES NOT NEED. phi does NOT kill the stabiliser: phi(P) is the swap of the two
// colors an octagon shows. That is not a problem, it is the point -- and it is why this could not have
// worked before tile frames became canonical. Choosing the other coset representative F.P rotates the
// art by 2*pi/m AND sends phi(F) to phi(F).phi(P), and the two cancel exactly, so the picture drawn is
// the same either way. The one thing that must hold is that the SAME F decides both, which it does:
// the art is placed by the walk in F's frame and the color is read off F's label.
//
// Concretely the accumulation carries the canonical fold's P^k, which the cyclic case can drop:
//
//     F_child = F_parent . Gx[g] . P^k    =>    phi_child = phi_parent . phi(G_g) . phi(P)^k
//
// Elements are interned as dense indices with a Cayley table, so a walk step is two array lookups and
// allocates nothing -- the same cost as the tile class's integer addition.
const COLOR_GROUP_CAP = 4096;

function permIsValid(p, n) {
  if (!Array.isArray(p) || p.length !== n) return false;
  const seen = new Array(n).fill(false);
  for (const v of p) {
    if (!Number.isInteger(v) || v < 0 || v >= n || seen[v]) return false;
    seen[v] = true;
  }
  return true;
}

// a after b: (a o b)[c] = a[b[c]]. Matches the group's own order, since phi(XY) = phi(X) o phi(Y).
function permCompose(a, b) {
  const out = new Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[b[i]];
  return out;
}

function permInverse(a) {
  const out = new Array(a.length);
  for (let i = 0; i < a.length; i++) out[a[i]] = i;
  return out;
}

function permEquals(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Validate a declared color symmetry and compile it to integer tables.
//
// The cheap algebraic conditions are checked first and separately, each with its own message, because
// "your permutations are not a homomorphism" is not something a caller can act on. They are necessary
// but NOT sufficient -- a set can satisfy all of them and still fail on a longer relator -- so the walk
// afterwards is the actual proof, exactly as for the tile class.
//
// Unlike the tile class this THROWS instead of degrading. A class is something the library discovers,
// so falling back to one class is honest; a color symmetry is something the caller asserted, and
// quietly ignoring it would paint the picture wrong in a way that looks deliberate.
const COLOR_SYMMETRY_CACHE = new Map();

function regularColorSymmetry(spec, p, q, m, generators, inverseIndex, piTransport, extendFor) {
  const n = spec.colors;
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`hyperbolic-map: colorSymmetry.colors must be a positive integer, got ${spec.colors}`);
  }
  const gens = spec.generators;
  if (!Array.isArray(gens) || gens.length !== generators.length) {
    throw new Error(
      `hyperbolic-map: colorSymmetry.generators must have one permutation per walk generator ` +
        `(${generators.length} for {${p},${q}} m=${m}), got ${Array.isArray(gens) ? gens.length : typeof gens}`,
    );
  }
  for (let g = 0; g < gens.length; g++) {
    if (!permIsValid(gens[g], n)) {
      throw new Error(
        `hyperbolic-map: colorSymmetry.generators[${g}] is not a permutation of ${n} colors: ` +
          JSON.stringify(gens[g]),
      );
    }
  }
  const stab = spec.stabiliser || spec.stabilizer;
  if (!permIsValid(stab, n)) {
    throw new Error(
      `hyperbolic-map: colorSymmetry.stabiliser is not a permutation of ${n} colors: ${JSON.stringify(stab)}`,
    );
  }

  const cacheKey = `${p},${q},${m}|${n}|${gens.map((x) => x.join("")).join(",")}|${stab.join("")}`;
  const hit = COLOR_SYMMETRY_CACHE.get(cacheKey);
  if (hit) return hit;

  const identity = [];
  for (let i = 0; i < n; i++) identity.push(i);

  // phi(P)^m = 1, because P^m is the identity of the group.
  const stabPowPerm = [identity];
  for (let k = 1; k < m; k++) stabPowPerm.push(permCompose(stabPowPerm[k - 1], stab));
  if (!permEquals(permCompose(stabPowPerm[m - 1], stab), identity)) {
    throw new Error(
      `hyperbolic-map: colorSymmetry.stabiliser must have order dividing ${m} -- it is the image of the ` +
        `2*pi/${m} rotation about a tile centre, and P^${m} is the identity. Got ${JSON.stringify(stab)}.`,
    );
  }
  // phi respects the inverse pairing of the generators.
  for (let g = 0; g < gens.length; g++) {
    if (!permEquals(gens[inverseIndex[g]], permInverse(gens[g]))) {
      throw new Error(
        `hyperbolic-map: colorSymmetry.generators[${inverseIndex[g]}] must be the inverse of ` +
          `generators[${g}], since generator ${inverseIndex[g]} is the inverse walk step. Expected ` +
          `${JSON.stringify(permInverse(gens[g]))}, got ${JSON.stringify(gens[inverseIndex[g]])}.`,
      );
    }
  }
  // Conjugating a generator by P permutes the generator set (see piTransport), so phi must agree.
  for (let j = 1; j < m; j++) {
    const inv = permInverse(stabPowPerm[j]);
    for (let g = 0; g < gens.length; g++) {
      const want = permCompose(permCompose(stabPowPerm[j], gens[g]), inv);
      const h = piTransport[j][g];
      if (!permEquals(gens[h], want)) {
        throw new Error(
          `hyperbolic-map: colorSymmetry is inconsistent with the tiling: P^${j}.G_${g}.P^-${j} is ` +
            `G_${h}, so generators[${h}] must be ${JSON.stringify(want)}, but it is ` +
            `${JSON.stringify(gens[h])}.`,
        );
      }
    }
  }

  // Enumerate the generated group and build its Cayley table. The BFS closes under every generator
  // image and the stabiliser image, which is exactly the set of labels any walk can produce.
  const index = new Map([[identity.join(","), 0]]);
  const elements = [identity];
  const seeds = gens.concat([stab]);
  for (let i = 0; i < elements.length; i++) {
    for (const s of seeds) {
      const prod = permCompose(elements[i], s);
      const key = prod.join(",");
      if (!index.has(key)) {
        if (elements.length >= COLOR_GROUP_CAP) {
          throw new Error(
            `hyperbolic-map: colorSymmetry generates a group of more than ${COLOR_GROUP_CAP} elements. ` +
              "That is almost always a typo in one permutation: a color symmetry's group is small (12 " +
              "for Circle Limit III's A_4).",
          );
        }
        index.set(key, elements.length);
        elements.push(prod);
      }
    }
  }
  const size = elements.length;
  const table = [];
  for (let i = 0; i < size; i++) {
    const row = new Int32Array(size);
    for (let j = 0; j < size; j++) row[j] = index.get(permCompose(elements[i], elements[j]).join(","));
    table.push(row);
  }
  const genIndex = gens.map((g) => index.get(g.join(",")));
  const stabPow = stabPowPerm.map((s) => index.get(s.join(",")));

  // THE PROOF. Everything above is necessary; only this is sufficient. Walk the real tile graph,
  // accumulate labels the way the walk will, and require every pair of routes to one tile to agree.
  const seen = new Map();
  const queue = [{ node: extendFor.origin, col: 0 }];
  let collisions = 0;
  while (queue.length && seen.size < 400) {
    const cur = queue.shift();
    const prev = seen.get(cur.node.id);
    if (prev !== undefined) {
      collisions++;
      if (prev !== cur.col) {
        throw new Error(
          `hyperbolic-map: colorSymmetry is not a homomorphism -- two routes to one tile of ` +
            `{${p},${q}} m=${m} give different colors (${JSON.stringify(elements[prev])} and ` +
            `${JSON.stringify(elements[cur.col])}). Every relator of the walk group must be respected, ` +
            "not only the generator relations that were checked above.",
        );
      }
      continue;
    }
    seen.set(cur.node.id, cur.col);
    for (let g = 0; g < generators.length; g++) {
      const edge = extendFor.edge(cur.node, g);
      queue.push({ node: edge.node, col: table[table[cur.col][genIndex[g]]][stabPow[edge.k]] });
    }
  }
  // A walk that never revisited a tile has proved nothing; the same guard the tile class uses.
  if (collisions <= 10) {
    throw new Error(
      `hyperbolic-map: could not verify colorSymmetry -- the walk over {${p},${q}} m=${m} closed on ` +
        `itself only ${collisions} times, which is not evidence.`,
    );
  }

  const out = { colors: n, size, elements, table, genIndex, stabPow };
  COLOR_SYMMETRY_CACHE.set(cacheKey, out);
  return out;
}

export class RegularTiling {
  // `frameSymmetry` (m, a divisor of p) is the rotational symmetry the tile art is promised to have.
  // It selects the walk group so that the tile stabiliser is C_m, which is what makes "the same data
  // in every tile" produce a consistent pattern. See notes/tilings.md and
  // notes/escher-circle-limit-iii.md -- for Circle Limit III this must be 4, not 8, and using the
  // default half-turn generators there would silently shred the pattern.
  constructor({ p, q, frameSymmetry = null, colorSymmetry = null } = {}) {
    this.metrics = regularMetrics(p, q);
    this.p = p;
    this.q = q;
    this.m = frameSymmetry || p;
    // Only m = p and m = p/2 are usable, and dividing p is NOT enough.
    //
    // m = p takes its steps with half-turns about edge midpoints: p generators, one per edge, so every
    // neighbour is one step away. m < p takes them with rotations about VERTICES, two generators per
    // vertex (the two senses), at the m vertices whose index is a multiple of p/m -- so 2m generators
    // reaching 2m of the p edges. Covering the plane needs 2m >= p, and since m divides p and m < p
    // forces m <= p/2, the only m < p that works is exactly p/2.
    //
    // Anything smaller silently produces a tiling that cannot reach most of its own neighbours. It does
    // not throw and it does not look obviously wrong at a glance: measured on {8,3} with m = 2, the
    // walk reaches edges 0, 1, 4 and 5 only, a 0.75-radius view returns 5 tiles where it should return
    // 17, and the rest of the disk renders as background. `containsLocal` agrees with it -- the Voronoi
    // test is built from the generator set, so it sees 4 half-planes instead of 8 and hands the gaps to
    // whichever tile is nearest -- which means picking claims ground that nothing draws.
    if (!(this.m === p || 2 * this.m === p)) {
      throw new Error(
        `hyperbolic-map: frameSymmetry ${this.m} cannot tile {${p},${q}}: only ${p}` +
          (p % 2 === 0 ? ` and ${p / 2}` : "") +
          ` work. m = p steps by edge half-turns and m = p/2 by vertex rotations; a smaller m reaches ` +
          `only ${2 * this.m} of the ${p} neighbours and leaves the rest of the plane unreachable.`,
      );
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
      // child (before the canonical frame correction; see reverseGenerator).
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
    }

    // THE TILE STABILISER, C_m: the rotations about this tile's own centre that lie in the walk group.
    //
    // This is the single most important thing to know before writing tile art, so it is a first-class
    // part of the contract rather than an internal detail. A tile's frame is only defined UP TO this
    // rotation -- the walk reaches a tile by whatever route is shortest from the camera, and different
    // routes differ by an element of C_m -- so art that is not invariant under it will visibly jump when
    // the camera crosses a tile boundary. Measured on {8,3} m=4: 16 of 30 on-screen tiles rotate by a
    // multiple of 90 degrees at the instant of re-anchoring.
    //
    // Verified by walking the tile graph and collecting frame_seen^-1 . frame_new at every collision:
    // every discrepancy observed is a rotation by a multiple of 2*pi/m. See test/tiling.test.mjs.
    this.stabiliserOrder = this.m;
    this.selfRotation = Isom.rotation((2 * Math.PI) / this.m);

    // Which generator undoes each generator. The set is closed under inverse UP TO SIGN in both
    // cases: for m = p every generator is its own inverse; for m < p the +/- senses about each vertex
    // pair up. Verified in the constructor rather than assumed, because a wrong entry here would send
    // `reverseGenerator` to the wrong neighbour and a walk could never retrace its own steps.
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

    // ---- EXACT IDENTITY AND ORIENTATION ----
    //
    // A tile-with-frame is an element of the walk group, and two routes to one tile differ by an
    // element of the stabiliser C_m. So a TILE is a coset F.C_m, and its canonical representative --
    // the lexicographically least matrix in that coset -- is simultaneously its unique id and its
    // canonical orientation. One object solves identity and orientation together.
    //
    // Computed in the Coxeter reflection representation over Z[mu] with BigInt entries. Integers are
    // what make this work at any distance: a float frame at hyperbolic distance ~37 has entries whose
    // one-ulp spacing exceeds the gap between adjacent tile centres, so no float test can decide
    // whether two frames name one tile out there. Integers have no such ceiling.
    //
    // WHAT IT COSTS, measured on the Escher atlas ({8,3} m=4, 200 tiles, 560 px):
    //
    //   * naming happens once per tile ever, not per frame. Across a 200-frame pan, 197 frames do ZERO
    //     ring multiplies and the median frame is 16.4 ms. `exactMulCount()` is exported so that claim
    //     can be measured rather than believed.
    //   * a frame that reaches tiles never seen before pays for all of them at once: ~1,800 edges
    //     around a 200-tile view at ~117 ring multiplies each. The first frame of all costs 250 ms, and
    //     the frame where a pan first crosses into unexplored ground costs ~130 ms. Panning back over
    //     ground already walked costs nothing.
    //
    // The 117 divides as 27 for F_parent . G_g, 9 for the id vector, and 27(m-1) to canonicalise -- so
    // canonicalisation dominates and grows with m. Lex-min over the m images of v_M instead of over
    // matrices would make that 9m + 27, worth doing if {12,3} ever matters; it renames every tile, so
    // it is not worth doing casually.
    this.exact = buildExactCoxeter(p, q);
    const matched = matchGenerators(this.exact, this.generators, p, this.m);
    this.exactGenerators = matched.exactGenerators;
    this.intertwiner = matched.intertwiner;
    this.exactP = exactMatPow(this.exact.R, this.exact.rho, p / this.m);
    // Whether the exact P reads as a +2pi/m or -2pi/m rotation is discovered, never assumed.
    this.spin = calibrateSpin(this.intertwiner, this.exactP, this.m, Isom);

    this.exactPPow = [exactIdentity(this.exact.R)];
    for (let k = 1; k < this.m; k++) {
      this.exactPPow.push(exactMatMul(this.exact.R, this.exactPPow[k - 1], this.exactP));
    }
    // Float rotations by 2*pi*k/m about a tile's own centre, precomputed: the walk multiplies by one
    // of these on every step and must never build them per frame.
    this.rotP = [];
    for (let k = 0; k < this.m; k++) {
      this.rotP.push(Isom.rotation((this.spin * 2 * Math.PI * k) / this.m));
    }

    // The transport permutation. Conjugating by P permutes the generator set -- they are built as
    // rho^k . base . rho^-k with k closed under adding p/m -- so
    //
    //     P^j . Gx[g] . P^-j = Gx[pi[j][g]]
    //
    // exactly, with no leftover rotation -- pi is a pure permutation of generator indices, and the
    // search below throws rather than assume it. The walk forward does not need this table, because
    // folding P^k into each step keeps every frame canonical. Stepping BACK does: see reverseGenerator.
    this.piTransport = [];
    this.piInverse = [];
    for (let j = 0; j < this.m; j++) {
      const row = new Array(this.generators.length).fill(-1);
      const inv = new Array(this.generators.length).fill(-1);
      const Pj = this.exactPPow[j];
      const PjInv = this.exactPPow[(this.m - j) % this.m];
      for (let g = 0; g < this.generators.length; g++) {
        const conj = exactMatMul(this.exact.R, exactMatMul(this.exact.R, Pj, this.exactGenerators[g]), PjInv);
        let found = -1;
        for (let h = 0; h < this.exactGenerators.length; h++) {
          if (exactMatEquals(this.exact.R, conj, this.exactGenerators[h])) {
            found = h;
            break;
          }
        }
        if (found < 0) {
          throw new Error(
            `hyperbolic-map: {${p},${q}} m=${this.m}: P^${j} does not permute the generators, so the ` +
              "walk group is not what this construction assumes",
          );
        }
        row[g] = found;
        inv[found] = g;
      }
      if (inv.includes(-1)) throw new Error(`hyperbolic-map: transport row ${j} is not a permutation`);
      this.piTransport.push(row);
      this.piInverse.push(inv);
    }

    // The tile-class homomorphism. See tileClass() for what it is for and why it is sound. It comes
    // after the exact machinery because verifying it means recognising when two routes have reached one
    // tile, and that is decided by the exact id.
    const cls = regularTileClass(p, q, this.m, this.generators, this.inverseIndex, this.exact,
      this.exactGenerators);
    this.classModulus = cls.modulus;
    this.classStep = cls.step;

    // Every tile ever discovered, keyed by its canonical id. Nodes are persistent and shared, so
    // reaching a tile by a second route returns the SAME object -- which is what makes the id, the
    // frame and the tile-data cache slot route-independent.
    this.nodes = new Map();
    this.idChars = 0;
    this.rootNode = this.internNode(exactIdentity(this.exact.R), 0, 0);

    // The declared color symmetry, if there is one. See regularColorSymmetry.
    this.color = null;
    this.colorCount = 1;
    if (colorSymmetry) {
      this.color = regularColorSymmetry(colorSymmetry, p, q, this.m, this.generators, this.inverseIndex,
        this.piTransport, {
          origin: this.rootNode,
          edge: (node, g) => {
            this.extendAddress(node, g);
            return node.edges.get(g);
          },
        });
      this.colorCount = this.color.size;
      // Verifying it built a few hundred nodes while `this.color` was still null, so their labels are
      // all zero. Start the store again now that labels can be computed; nothing outside has seen it.
      this.nodes = new Map();
      this.idChars = 0;
      this.rootNode = this.internNode(exactIdentity(this.exact.R), 0, 0);
    }
  }

  // Compare two exact matrices in a fixed total order: row-major, entrywise, using the ring's own
  // order. This is what "lexicographically least" means, and it is what picks the canonical coset
  // representative -- so it is frozen. Changing it renames every id in every cache.
  cmpExact(A, B) {
    const R = this.exact.R;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const c = R.cmp(A[i][j], B[i][j]);
        if (c !== 0) return c;
      }
    }
    return 0;
  }

  // The tile id of ANY frame for a tile: the serialized centre M.v_O.
  //
  // P fixes v_O, so every frame in the coset gives the same vector and the id needs no canonicalisation
  // at all -- which is why it can be computed before deciding whether the tile is new, and why the
  // tile-class walk can use raw products. Distinct tiles have distinct centres, so it is injective.
  idExact(M) {
    const R = this.exact.R;
    return serializeExactVector(R, exactMatVec(R, M, this.exact.vO), this.p, this.q, this.m);
  }

  // The canonical representative of the coset M.C_m, and which power of P got us there.
  //
  // Two routes to one tile give M and M.P^j; the candidate sets {M.P^k} and {M.P^j.P^k} are the SAME
  // SET, so the minimum over them is identical. That is the entire proof that a tile's frame does not
  // depend on the route -- no automaton, no normal form, no parent heuristic.
  //
  // Canonicalising over C_m and NOT the full C_p matters: a canonical frame must stay inside the set of
  // frames the walk can actually produce. Over C_p, roughly half of {8,3} m=4's tiles would be turned
  // by an odd multiple of 45 degrees, which is not a symmetry of the C_4 walk group, and the Escher
  // pattern would shatter into a misaligned variant.

  canonicalExact(M) {
    const R = this.exact.R;
    const I = exactIdentity(R);
    let bestK = 0;
    let best = M;
    // IDENTITY-FIRST TIE-BREAK. Only the origin tile's coset contains I, and letting I win its own
    // coset makes the origin tile's canonical frame exactly the identity. Any fixed rule would be
    // equally canonical, but this one is worth the two comparisons: without it the origin canonicalises
    // to whichever P^k sorts first -- P^2, a half-turn, for {8,3} m=4 -- and the entire picture is then
    // turned by a constant relative to the unanchored global frame, so `globalFrameForTesting` and the
    // walk disagree about where the origin tile is pointing.
    if (this.cmpExact(M, I) === 0) return { F: I, k: 0 };
    for (let k = 1; k < this.m; k++) {
      const cand = exactMatMul(R, M, this.exactPPow[k]);
      if (this.cmpExact(cand, I) === 0) return { F: cand, k };
      if (this.cmpExact(cand, best) < 0) {
        best = cand;
        bestK = k;
      }
    }
    return { F: best, k: bestK };
  }

  // Look up or create the node for the coset of M.
  internNode(M, cls, col) {
    const id = this.idExact(M);
    const hit = this.nodes.get(id);
    if (hit) return hit;
    const { F } = this.canonicalExact(M);
    return this.storeNode({ F, id, cls, col, edges: new Map() });
  }

  // Add a node to the store and keep the store bounded.
  //
  // WHY BOUNDED. An id is one string per tile ever visited and its length grows linearly with distance
  // (measured on {8,3} m=4: about 12 characters per tile crossed), so retaining every node makes the
  // memory of a long pan grow like the SQUARE of the distance travelled -- 93 MB at 1,000 tiles out,
  // 734 MB at 4,000. That is a property of naming tiles globally at all, not of this encoding: there
  // are exponentially many tiles within distance d, so any correct global name needs Omega(d) bits.
  //
  // Eviction is safe because nothing anywhere depends on node object identity -- `addressEquals`
  // compares ids, and re-deriving an evicted node costs one canonicalisation. Evicting also CLEARS the
  // dropped node's edges, so a dropped node cannot keep the rest of its subtree alive through a live
  // neighbour's edge cache.
  //
  // The budget is on retained id characters rather than node count, because that is the thing that
  // actually grows; the floor on count is what keeps a frame's working set resident so that steady-state
  // panning still does no exact arithmetic at all.
  storeNode(node) {
    this.nodes.set(node.id, node);
    this.idChars += node.id.length;
    while (this.nodes.size > NODE_FLOOR && this.idChars > ID_CHAR_BUDGET) {
      // Map iterates in insertion order, so this drops the least recently created node.
      const oldest = this.nodes.keys().next();
      if (oldest.done) break;
      const victim = this.nodes.get(oldest.value);
      if (victim === this.rootNode) {
        // The origin is inserted first, so it would block every eviction; move it to the back instead.
        // It is kept forever because `originAddress()` hands it out and losing its edges would make
        // every route through the origin redo exact work.
        this.nodes.delete(oldest.value);
        this.nodes.set(oldest.value, victim);
        continue;
      }
      this.nodes.delete(oldest.value);
      this.idChars -= victim.id.length;
      victim.edges.clear();
    }
    return node;
  }

  // ---- addressing ----
  //
  // An address is a NODE in the tile graph: { F, id, cls, edges }, with F the tile's canonical exact
  // frame and `id` its canonical name. A node names the TILE, not a route to it: two routes to one
  // tile return the same id, the same frame and the same tile-data cache slot, which is what lets tile
  // art be fully asymmetric and depend on its own address.
  //
  // Treat an address as opaque. `id` is stable and safe to persist as a key, but it is not a coordinate
  // and there is no way back from the string to a node -- keep the object if you need to return to a
  // tile (see viewport.getCamera).

  originAddress() {
    return this.rootNode;
  }

  // The id IS the key, and reading it is a field access: canonicalisation happened once, when the node
  // was created, and never happens again for that tile.
  addressKey(address) {
    return address.id;
  }

  addressToString(address) {
    return address.id;
  }

  addressEquals(a, b) {
    return a === b || a.id === b.id;
  }

  // Step to a neighbour. Nodes are interned, so the second route to a tile returns the same object.
  //
  // The edge also records the float step to use: not the bare generator, but the generator followed
  // by the rotation that lands in the CHILD'S canonical frame. Folding the correction into the step
  // is what keeps every frame the walk produces canonical, so nothing downstream has to know that a
  // correction happened -- `net` is already right, and clipping, picking and boundary overlays are
  // untouched (the tile polygon is C_p-invariant and P is in C_p).
  //
  // Exact arithmetic happens HERE, once per edge ever traversed, and never again.
  extendAddress(address, gen) {
    const hit = address.edges.get(gen);
    if (hit) return hit.node;
    const R = this.exact.R;
    const M = exactMatMul(R, address.F, this.exactGenerators[gen]);
    const id = this.idExact(M);
    const { F, k } = this.canonicalExact(M);
    let child = this.nodes.get(id);
    if (!child) {
      const n = this.classModulus;
      const cls = n > 1 ? (((address.cls + this.classStep[gen]) % n) + n) % n : 0;
      // The color label carries the canonical fold's P^k as well as the generator, because phi(P) is
      // not the identity -- see regularColorSymmetry. Two table lookups, no allocation.
      const c = this.color;
      const col = c ? c.table[c.table[address.col][c.genIndex[gen]]][c.stabPow[k]] : 0;
      child = this.storeNode({ F, id, cls, col, edges: new Map() });
    }
    // F_child = F_parent . Gx[gen] . P^k, so the float step is the generator then that rotation.
    const step = this.generators[gen].mul(this.rotP[k]).normalize();
    address.edges.set(gen, { node: child, k, step });
    return child;
  }

  // The float isometry for one walk step, in canonical frames. The walk uses this instead of
  // generator(gen); the difference is the C_m correction folded in.
  stepFrame(address, gen) {
    const hit = address.edges.get(gen);
    if (hit) return hit.step;
    this.extendAddress(address, gen);
    return address.edges.get(gen).step;
  }

  // Which generators lead out of this tile, WITHOUT building any of the neighbours.
  //
  // This exists so the walk can decide whether it wants a neighbour before paying for it. Naming a
  // tile costs exact integer arithmetic -- one matmul, m-1 more to canonicalise, and a mat-vec for the
  // id -- and the walk discards most of what it looks at: it explores about eight candidates per tile
  // and keeps a couple of hundred in total. Measured on the Escher atlas before this existed, a frame
  // that crossed a tile boundary named ~800 new tiles, spent 210,000 ring multiplies and took 154 ms
  // against a 17 ms median. The centre of a neighbour can be found from the plain generator, with no
  // exact work at all, which is enough to reject it.
  neighbourGens() {
    if (!this._gensAll) {
      this._gensAll = [];
      for (let g = 0; g < this.generators.length; g++) this._gensAll.push(g);
    }
    return this._gensAll;
  }

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

  // The generator that steps from `extendAddress(address, gen)` BACK to `address`.
  //
  // NOT `inverseGenerator(gen)`, and this is the one place where canonical frames cost something. The
  // child's canonical frame is F_p . Gx[g] . P^k, so a step h out of the child reads as
  //
  //     F_p . Gx[g] . P^k . Gx[h]  =  F_p . Gx[g] . Gx[pi_k(h)] . P^k
  //
  // which lands back on the parent exactly when pi_k(h) is the inverse of g. Applying the plain
  // inverse index instead lands on a DIFFERENT neighbour of the child -- a real tile, so nothing
  // throws; the walk just quietly fails to come home. (`inverseGenerator` still means what it always
  // meant: the index whose isometry is the inverse. It is the frame that moved, not the name.)
  reverseGenerator(address, gen) {
    const hit = address.edges.get(gen) || (this.extendAddress(address, gen), address.edges.get(gen));
    return this.piInverse[hit.k][this.inverseIndex[gen]];
  }

  generatorCount() {
    return this.generators.length;
  }

  // ---- tile classes: a cheap, meaningful grouping of tiles ----
  //
  // A class is a coloring of the tiling by a group HOMOMORPHISM phi: Gamma -> Z/n that kills the
  // stabiliser C_m, so it descends to tiles. Art may key on the tile's own id, so a class is not the
  // only per-tile variation available any more -- what it still is, is the STRUCTURED one: adjacent
  // tiles never share a class, so it reads as a proper coloring of the tiling rather than as noise,
  // and it costs one integer addition per walk step instead of a string lookup.
  //
  // What n can be is fixed by the abelianisation of the walk group, and it is small:
  //
  //   m < p  (vertex-rotation generators, e.g. Circle Limit III's {8,3} m=4): phi(g) has order q,
  //          giving Z/q -- THREE classes for {8,3} m=4. Geometrically it is a proper 3-coloring of the
  //          octagons: the three meeting at any vertex all differ.
  //   m == p (edge half-turn generators): phi(g) has order dividing 2, and going around a vertex forces
  //          q*phi(g) = 0 too, so there are two classes when q is EVEN ({5,4}, {6,4}) and only one when
  //          q is odd ({8,3}, {7,3}, {3,7}, {12,3}).
  //
  // Verified, not assumed: the modulus is confirmed by walking the tile graph and checking that every
  // pair of routes to one tile agrees, and it falls back to 1 if it does not. Cached per {p,q,m}.
  tileClass(address) {
    return this.classModulus > 1 ? address.cls : 0;
  }

  // ---- color symmetry ----
  //
  // The permutation this tile applies to the caller's colors, or null if no colorSymmetry was declared.
  // A function of the TILE: two routes give the same permutation, because they give the same canonical
  // frame. Do not mutate the returned array -- it is the interned group element, shared by every tile
  // that carries it.
  colorPermutation(address) {
    return this.color ? this.color.elements[address.col] : null;
  }

  // The same thing as a dense index in [0, colorCount). What art keyed on the color symmetry should
  // cache on: a repeating atlas has one recolored copy per group element and no more, so this is the
  // key that keeps `Atlas`'s compile memo hitting.
  colorIndex(address) {
    return this.color ? address.col : 0;
  }

  // ---- geometry, all in tile-local coordinates ----

  // Is this tile-local point inside this tile? A regular tiling's tiles are exactly the Voronoi cells
  // of their centres, so the test is "closer to my centre than to any neighbour's".
  //
  // cosh(d/2) to my own centre (the local origin) is just w, and to a neighbour centre N it is
  // sqrt(A^2 + B^2) with A = w*nw - x*nx - y*ny and B = x*ny - y*nx. Audit claim 11 proves the
  // boundary of this test passes through the edge midpoint at exactly the inradius.
  //
  // NOTE: the tempting near-miss is to compare A against nw^2 instead. That is a different, LARGER
  // region -- at the edge midpoint its value is -0.63 at the {8,3} inradius instead of zero (audit
  // claim 11b, dev/audit_atlas_math.py). The 2012 Escher tile cutter used it, harmlessly, because it
  // deliberately over-included and relied on render-time clipping; here it would be wrong.
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
    // Now exact underneath: the node carries its canonical frame as an integer matrix, and this is
    // just the float image of it. Still diagnostic-only -- the entries grow like cosh(d/2), which is
    // precisely why the render path composes relative frames instead.
    return exactToIsom(this.intertwiner, address.F, Isom, movePointToPoint);
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
// and |a|^2 - |b|^2 = 1 identically. Checked symbolically rather than trusted, because a hand
// derivation swaps b's real and imaginary parts very easily and the result still looks plausible.
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

// Painter's order for unclipped art, as a three-character code.
//
// Without `clip`, neighbouring cells' art overlaps on purpose -- the dungeon's floor plates span the
// corner where four cells meet and its doors cross cell boundaries -- so WHICH cell paints last decides
// what you see at every seam. The atlas's own walk order is nearest-first from the camera, which is
// fine for culling but is camera-dependent: pan a little and two overlapping cells can swap, so seams
// flip as you move. Sorting by the ADDRESS instead is stable, because addresses are exact BigInts and
// the relative order of any two cells never changes.
//
//   character 1  'H' sorts by longitude first, 'V' by latitude first
//   character 2  the direction of that first key:  '>' increasing, '<' decreasing
//   character 3  the direction of the second key:  '>' increasing, '<' decreasing
//
// So all eight are "H>>", "H><", "H<>", "H<<", "V>>", "V><", "V<>", "V<<". Later in the order paints
// later, i.e. on top.
export function binaryDrawOrder(code) {
  const m = /^([HV])([<>])([<>])$/.exec(String(code));
  if (!m) {
    throw new Error(
      `hyperbolic-map: drawOrder must be one of H>> H>< H<> H<< V>> V>< V<> V<<, got ${JSON.stringify(code)}`,
    );
  }
  const latFirst = m[1] === "V";
  const firstSign = m[2] === ">" ? 1 : -1;
  const secondSign = m[3] === ">" ? 1 : -1;
  const latSign = latFirst ? firstSign : secondSign;
  const lonSign = latFirst ? secondSign : firstSign;
  // BigInt comparison, so this stays exact at any depth -- a float64 longitude would start tying
  // distinct cells together about fifty levels down, and ties here mean an arbitrary paint order.
  return (a, b) => {
    const p = latFirst
      ? [a.address.lat, b.address.lat, latSign]
      : [a.address.lon, b.address.lon, lonSign];
    if (p[0] !== p[1]) return p[0] < p[1] ? -p[2] : p[2];
    const s = latFirst
      ? [a.address.lon, b.address.lon, lonSign]
      : [a.address.lat, b.address.lat, latSign];
    if (s[0] !== s[1]) return s[0] < s[1] ? -s[2] : s[2];
    return 0;
  };
}

export class BinaryTiling {
  constructor(options) {
    // `drawOrder` only matters when the atlas is NOT clipping; with clipping there is no overlap to
    // resolve. Default null = the atlas's own nearest-first walk order, which is what this tiling did
    // before the option existed, so no existing page changes appearance by accident.
    const { drawOrder = null } = options || {};
    this.drawOrder = drawOrder;
    this.compareForDrawing = drawOrder === null ? null : binaryDrawOrder(drawOrder);

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
    // The stabiliser is TRIVIAL: a binary cell's frame is z -> S z + T in the half-plane, and no
    // non-identity element of the walk group fixes a cell. So a cell's frame is unique, its address is
    // unique, and tile art here is under NO symmetry constraint -- any asymmetric art is fine, and art
    // may differ from cell to cell. This is why the binary tiling scrolls smoothly with artwork that
    // would tear a {p,q} tiling apart, and it is the reason the dungeon demo can put a different room in
    // every cell.
    this.stabiliserOrder = 1;
    this.selfRotation = Isom.identity();
    // No homomorphism needed: (lat, lon) is canonical, so a caller may key art on the ADDRESS itself and
    // give every cell something different. `classModulus` exists only to keep the tile object uniform.
    this.classModulus = 1;
    // Nor a color symmetry, for the same reason and one more: a color symmetry earns its keep by
    // permuting art that repeats, and nothing here has to repeat. Present so the tile object is uniform.
    this.colorCount = 1;
  }

  tileClass() {
    return 0;
  }

  colorPermutation() {
    return null;
  }

  colorIndex() {
    return 0;
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
    // Memoised on the address object. BigInt toString is not free, and a deep descent makes the
    // longitude very long indeed.
    if (address.str === undefined || address.str === null) {
      address.str = `${address.lat},${address.lon}`;
    }
    return address.str;
  }

  addressKey(address) {
    return this.addressToString(address);
  }

  addressEquals(a, b) {
    return a.lat === b.lat && a.lon === b.lon;
  }

  // Which generators lead out of this cell, WITHOUT building any of the neighbours. See the note on
  // RegularTiling.neighbourGens. The parent step is the one that varies: a cell offers PARENT_EVEN or
  // PARENT_ODD according to its own longitude parity, never both.
  neighbourGens(address) {
    const even = (address.lon & 1n) === 0n;
    return [BIN_RIGHT, BIN_LEFT, BIN_CHILD0, BIN_CHILD1, even ? BIN_PARENT_EVEN : BIN_PARENT_ODD];
  }

  // The neighbour reached by one generator. Same arithmetic as `neighbours`, one entry at a time, so a
  // caller that has already decided which way it is going does not build the other four.
  //
  // A cell has only ONE parent, and which of PARENT_EVEN / PARENT_ODD names it depends on the cell's
  // own longitude parity. Asking for the wrong one is a caller error rather than a different cell:
  // saying PARENT_EVEN from an odd-longitude cell once made the camera unable to move up at all, and it
  // then chased downward until the latitude ran to several hundred digits. So it throws.
  extendAddress(address, gen) {
    const { lat, lon } = address;
    const even = (lon & 1n) === 0n;
    switch (gen) {
      case BIN_RIGHT: return { lat, lon: lon + 1n };
      case BIN_LEFT: return { lat, lon: lon - 1n };
      case BIN_CHILD0: return { lat: lat - 1n, lon: lon * 2n };
      case BIN_CHILD1: return { lat: lat - 1n, lon: lon * 2n + 1n };
      case BIN_PARENT_EVEN:
      case BIN_PARENT_ODD: {
        if ((gen === BIN_PARENT_EVEN) !== even) {
          throw new Error(
            `hyperbolic-map: cell (${lat},${lon}) has longitude parity ${even ? "even" : "odd"}, so its ` +
              `parent is reached by ${even ? "BIN_PARENT_EVEN" : "BIN_PARENT_ODD"}, not generator ${gen}`,
          );
        }
        // Floor division: BigInt / truncates toward zero, so -1n/2n is 0n where the parent of cell -1
        // must be cell -1. Off-by-one here would break the western hemisphere only.
        return { lat: lat + 1n, lon: lon >= 0n ? lon / 2n : -((-lon + 1n) / 2n) };
      }
      default:
        throw new Error(`hyperbolic-map: unknown binary generator ${gen}`);
    }
  }

  // The ORDER of this list is part of the contract: `stepToward` returns an index into it.
  neighbours(address) {
    const { lat, lon } = address;
    // Floor division for negative longitudes: BigInt / truncates toward zero, so -1n/2n is 0n where
    // the parent of cell -1 must be cell -1. Off-by-one here would break the western hemisphere only,
    // which is precisely the kind of asymmetry a diagnostic with hashed colors makes obvious.
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

  // No stabiliser, so no frame correction, so stepping back really is the inverse generator. Present
  // so a caller can walk back on either tiling without asking which one it has.
  //
  // The one wrinkle is the parent step's two parities: PARENT_EVEN and PARENT_ODD are inverse to
  // CHILD0 and CHILD1 respectively, and a cell offers only the one that matches its own longitude, so
  // callers must still look the returned index up in `neighbours` rather than assume it is present.
  reverseGenerator(address, gen) {
    return BINARY_INVERSE[gen];
  }

  // The stabiliser is trivial here, so a cell's frame is unique and the walk step is just the
  // generator -- no canonical correction exists to fold in. Present so the walk can call the same
  // method on either tiling.
  stepFrame(address, gen) {
    return BINARY_GENERATORS[gen];
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
