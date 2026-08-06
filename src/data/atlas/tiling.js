// Tilings of the hyperbolic plane.
//
// A tiling supplies, for each tile: an integer key, the isometry carrying tile-local coordinates into
// the world, and the tile's boundary (for clipping). Two are built in.
//
// All the metric relations below were verified BY CONSTRUCTION -- build the polygon and measure --
// rather than formula against formula, which is how an inverted inradius slipped through the first
// time. See notes/tilings.md.

import { Isom } from "../../core/isom.js";
import { halfPlaneToLocal } from "../../core/coords.js";

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

    // Generators.
    if (this.m === p) {
      // Half-turn about each edge midpoint. Always a symmetry of {p,q} -- it is the "2" of the
      // (2,p,q) triangle group -- including for ODD p. (Only pure TRANSLATIONS between adjacent
      // tiles need even p; do not confuse the two.) Each is an involution, so the edge back to the
      // parent carries the same index in the child, which makes words walk-reversible for free.
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

    // The tile boundary in tile-local coordinates: p geodesic edges between consecutive vertices.
    this.boundaryLocal = this.vertexDisk.map(([zx, zy]) => {
      const k = 1 / Math.sqrt(1 - zx * zx - zy * zy);
      return [zx * k, zy * k];
    });
  }

  keyToString(key) {
    return key.length === 0 ? "root" : key.join(".");
  }

  frame(key) {
    let m = Isom.identity();
    for (let i = 0; i < key.length; i++) {
      m = m.mul(this.generators[key[i]]);
      // Renormalise periodically: entries grow like exp(depth * inradius), and the product drifts
      // off the manifold at O(n * eps) without it.
      if ((i & 7) === 7) m.normalize();
    }
    return m.normalize();
  }

  boundary(/* key */) {
    return { kind: EDGE_GEODESIC, points: this.boundaryLocal };
  }

  neighbourCount() {
    return this.generators.length;
  }

  // Tiles whose polygon can be on screen.
  //
  // Breadth-first from the tile containing the view centre, following generators, deduplicating by
  // rounded tile centre. BFS from the ROOT would be hopeless -- a tile at hyperbolic distance 20 sits
  // behind about e^20 others -- so the walk starts where the camera is.
  //
  // Two radii matter: tiles are INCLUDED if their circumscribed disk meets the visible disk, and the
  // walk CONTINUES through a slightly larger radius, so that a tile touching only at a vertex is
  // still reachable via a neighbour that was itself included.
  visible(viewMatrix, visibleRadius, maxTiles = 256) {
    this.lastTruncated = false;
    const rho = 2 * Math.atanh(Math.min(visibleRadius, 0.9995));
    const chi = this.metrics.circumradius;
    const includeCosh = Math.cosh((rho + chi) / 2);
    const walkCosh = Math.cosh((rho + chi + this.metrics.centreSpacing) / 2);

    // The view centre in world local coordinates, and its companion.
    const c = viewMatrix.centreLocal([0, 0]);
    const cx = c[0];
    const cy = c[1];
    const cw = Math.sqrt(1 + cx * cx + cy * cy);

    // cosh(d/2) between a tile centre (as local coords) and the view centre -- the modulus form.
    const buf = [0, 0];
    const coshHalfTo = (frame) => {
      frame.applyToDisk(0, 0, buf);
      const k = 1 / Math.sqrt(1 - buf[0] * buf[0] - buf[1] * buf[1]);
      const tx = buf[0] * k;
      const ty = buf[1] * k;
      const tw = Math.sqrt(1 + tx * tx + ty * ty);
      const A = tw * cw - tx * cx - ty * cy;
      const B = tx * cy - ty * cx;
      return Math.hypot(A, B);
    };

    const start = this.locate(viewMatrix, maxTiles);
    const out = [];
    const dist = [];
    const queue = [start];

    // Deduplicate tile centres RELATIVE TO THE STARTING TILE, not in world coordinates.
    //
    // Adjacent tile centres are separated by tanh(inradius) in disk coordinates near the origin but
    // by only ~e^-d far out, where they crowd against the unit circle. An earlier version quantised
    // world disk coordinates at an absolute 1e-7 -- so beyond d ~ 16 every neighbour of the starting
    // tile rounded to the SAME tag, `seen` rejected all of them, and the walk stopped after one tile.
    // Measured on the Escher atlas: 13 tiles at distance 15, exactly 1 at distance 20 and beyond, a
    // single lone octagon of fish surrounded by bare background.
    //
    // Conjugating by the start frame moves the neighbourhood back to the origin, where the spacing is
    // O(1) again, so a fixed quantum has enormous margin. The remaining scale dependence -- tiles far
    // from the START rather than from the world origin -- is handled by making the quantum relative
    // to the magnitude.
    // Rounding coordinates to a grid cannot be made reliable here, and trying was a mistake worth
    // recording. The precision available degrades with distance -- `ref` and `frame` both have
    // entries of magnitude cosh(d/2), and their product is O(1) for a nearby tile, a cancellation
    // costing about eps*cosh(d/2)^2 -- so the quantum has to grow with distance. But a quantum only
    // three times the error still splits a tile's several words across a cell boundary a good
    // fraction of the time, and each split is a duplicate. Measured: 115 tiles returned at distance
    // 15 where about 12 are visible, 671 of the pairs being repeats of one another.
    //
    // So the grid is now only an ACCELERATOR, and every candidate it retrieves is checked with the
    // exact SU(1,1) invariant distance. Cell boundaries no longer matter, because a 5x5 neighbourhood
    // is searched and the verdict comes from the exact test: two tiles are the same iff their centres
    // are closer than half the centre spacing, a threshold ~1e9 times the error.
    // The grid cell must exceed the coordinate error, or one tile's two words land more than two
    // cells apart and the 5x5 search never compares them. Making the cell TOO large is harmless --
    // it only means scanning more candidates, since the exact test below decides -- so err large.
    //
    // The error is not merely the cancellation in ref*frame. `frame(key)` is a product of ~d/(2*psi)
    // generators whose entries reach cosh(d/2), so it already carries an absolute error of about
    // depth*eps*cosh(d/2); multiplying two such matrices squares that magnitude. At distance 30 the
    // realistic figure is ~1e-2, not the 6e-4 the cancellation alone suggests -- a factor of 25 I
    // got wrong first time, and duplicates at d=30 were the evidence.
    //
    // Distinct tile centres are about 0.3 apart in these coordinates, so once the error approaches
    // that, no test can tell tiles apart. That is the real ceiling, and it is the float64 limit of a
    // single patch (notes/su11-core.md) rather than anything this dedup can fix.
    const ref = this.frame(start).inverse();
    const relative = new Isom(0, 0, 0, 0);
    const refMag2 = ref.ar * ref.ar + ref.ai * ref.ai; // cosh(d/2)^2
    const CELL = Math.max(1e-4, 1.2e-13 * refMag2);
    const dupCosh = Math.cosh(this.metrics.centreSpacing / 4); // cosh(d/2) at d = spacing/2
    const grid = new Map();
    const accX = [];
    const accY = [];
    const accW = [];

    // True if this tile centre has already been accepted; otherwise records it and returns false.
    const seenBefore = (frame) => {
      Isom.composeInto(relative, ref, frame);
      relative.applyToDisk(0, 0, buf);
      const zx = buf[0];
      const zy = buf[1];
      const k = 1 / Math.sqrt(Math.max(1e-300, 1 - zx * zx - zy * zy));
      const lx = zx * k;
      const ly = zy * k;
      const lw = Math.sqrt(1 + lx * lx + ly * ly);
      const gx = Math.floor(zx / CELL);
      const gy = Math.floor(zy / CELL);
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const bucket = grid.get(`${gx + dx},${gy + dy}`);
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i++) {
            const j = bucket[i];
            const A = accW[j] * lw - accX[j] * lx - accY[j] * ly;
            const B = accX[j] * ly - accY[j] * lx;
            if (Math.hypot(A, B) < dupCosh) return true;
          }
        }
      }
      const home = `${gx},${gy}`;
      let bucket = grid.get(home);
      if (!bucket) {
        bucket = [];
        grid.set(home, bucket);
      }
      bucket.push(accX.length);
      accX.push(lx);
      accY.push(ly);
      accW.push(lw);
      return false;
    };

    // A hard bound on dequeues, independent of the budget on RESULTS. Every tile that survives dedup
    // pushes p children, so if dedup ever fails -- and past the float64 ceiling around d = 35 it must,
    // because distinct tile centres stop being distinguishable -- the queue grows geometrically while
    // `out` never fills, and the walk runs away. Found by hanging: a sweep out to distance 36 stopped
    // returning. Degrading to fewer tiles is acceptable; not returning is not.
    let examined = 0;
    const maxExamined = 24 * maxTiles;
    // Gather half again as many candidates as the budget when truncating, so there is something to
    // choose between; more than that costs enumeration time for diminishing stability.
    const gatherLimit = Math.ceil(maxTiles * 1.5);
    while (queue.length && out.length < gatherLimit) {
      if (++examined > maxExamined) {
        this.lastTruncated = true;
        break;
      }
      const key = queue.shift();
      const frame = this.frame(key);
      if (seenBefore(frame)) continue;
      const ch = coshHalfTo(frame);
      if (ch > walkCosh) continue;
      if (ch <= includeCosh) {
        out.push(key);
        dist.push(ch);
      }
      for (let g = 0; g < this.generators.length; g++) queue.push(key.concat([g]));
    }

    // When the budget bites, admit the NEAREST tiles rather than the first ones the walk happened to
    // reach. BFS discovery order is deterministic but not smooth in the view: a change of one part in
    // 1e15 can reorder discovery and swap which tile is admitted last, which shows up as a rim tile
    // flickering in and out between otherwise identical frames. Distance is smooth in the view, so
    // ordering by it makes the admitted set change only when a tile genuinely crosses the boundary.
    //
    // Sorted only when actually truncating, so the common case pays nothing.
    if (out.length >= maxTiles && queue.length) {
      this.lastTruncated = true;
      const order = out.map((k, i) => i).sort((i, j) => dist[i] - dist[j]);
      return order.slice(0, maxTiles).map((i) => out[i]);
    }
    return out;
  }

  // The tile containing the view centre, found by greedy descent: repeatedly step to whichever
  // neighbour brings the tile centre closer to the target. O(depth), which is what makes this usable
  // far from the origin.
  locate(viewMatrix, maxSteps = 256) {
    const c = viewMatrix.centreLocal([0, 0]);
    const cx = c[0];
    const cy = c[1];
    const cw = Math.sqrt(1 + cx * cx + cy * cy);
    const buf = [0, 0];
    const distTo = (frame) => {
      frame.applyToDisk(0, 0, buf);
      const k = 1 / Math.sqrt(1 - buf[0] * buf[0] - buf[1] * buf[1]);
      const tx = buf[0] * k;
      const ty = buf[1] * k;
      const tw = Math.sqrt(1 + tx * tx + ty * ty);
      const A = tw * cw - tx * cx - ty * cy;
      const B = tx * cy - ty * cx;
      return Math.hypot(A, B);
    };

    let key = [];
    let best = distTo(Isom.identity());
    for (let step = 0; step < maxSteps; step++) {
      let bestG = -1;
      let bestD = best;
      const base = this.frame(key);
      for (let g = 0; g < this.generators.length; g++) {
        const d = distTo(base.mul(this.generators[g]));
        if (d < bestD - 1e-12) {
          bestD = d;
          bestG = g;
        }
      }
      if (bestG < 0) break;
      key = key.concat([bestG]);
      best = bestD;
    }
    return key;
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
// essentially <z -> 2z>. So it cannot produce a seamless group-invariant pattern the way {p,q} can.
// What it does give is a well-defined per-cell frame and O(1) point-to-cell lookup, which is exactly
// what a map database wants -- and why the 2011 server used it.
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

export class BinaryTiling {
  constructor() {
    this.frameCache = new Map();
  }

  keyToString(key) {
    return `${key[0]},${key[1]}`;
  }

  // Point -> cell, in half-plane coordinates. Two floors.
  locateHalfPlane(hx, hy) {
    const latitude = Math.floor(Math.log2(hy));
    const longitude = Math.floor(hx * Math.pow(2, -latitude));
    return [latitude, longitude];
  }

  // The isometry taking tile-local coordinates to the world.
  //
  // In the half-plane it is z -> s*z + t with s = 2^(lat+0.5) and t = (lon+0.5)*2^lat, which sends
  // the basepoint i to the cell's hyperbolic centre. Conjugating by the Cayley transform
  // C = [[i, 1], [1, i]] lands directly in SU(1,1) form -- verified with zero deviation.
  frame(key) {
    const cacheKey = this.keyToString(key);
    const hit = this.frameCache.get(cacheKey);
    if (hit) return hit.clone();

    const [lat, lon] = key;
    const s = Math.pow(2, lat + 0.5);
    const t = (lon + 0.5) * Math.pow(2, lat);
    // C * [[sqrt(s), t/sqrt(s)], [0, 1/sqrt(s)]] * C^-1, worked out in closed form.
    //   a = ((s + 1) + i*t) / (2*sqrt(s)) ... derived below by direct multiplication
    const rs = Math.sqrt(s);
    const inv = 1 / rs;
    // Worked out by hand and checked against the matrix product. With C = [[i,1],[1,i]] (which is
    // z -> i(z-i)/(z+i)) and det C = -2, so C^-1 = [[-i/2, 1/2],[1/2, -i/2]]:
    //
    //   a = (sqrt(s) + 1/sqrt(s))/2  +  i * t/(2 sqrt(s))
    //   b =            t/(2 sqrt(s)) +  i * (sqrt(s) - 1/sqrt(s))/2
    //
    // and |a|^2 - |b|^2 = ((sqrt(s)+1/sqrt(s))^2 - (sqrt(s)-1/sqrt(s))^2)/4 = 1 identically.
    // (First attempt had b's real and imaginary parts swapped, which a direct comparison against
    // C*A*C^-1 caught immediately -- worth doing rather than trusting the algebra.)
    const ar = (rs + inv) / 2;
    const ai = (t * inv) / 2;
    const br = (t * inv) / 2;
    const bi = (rs - inv) / 2;
    const m = new Isom(ar, ai, br, bi).normalize();
    this.frameCache.set(cacheKey, m);
    return m.clone();
  }

  // The cell boundary in tile-local coordinates: two geodesic sides and two horocyclic sides. Given
  // in the tile's own HALF-PLANE box, which the renderer maps through the frame.
  boundary(/* key */) {
    return {
      kind: "binary-cell",
      halfWidth: BINARY_LOCAL_HALF_WIDTH,
      yLow: BINARY_LOCAL_Y_LOW,
      yHigh: BINARY_LOCAL_Y_HIGH,
    };
  }

  // The five neighbours of a cell.
  neighbours(key) {
    const [lat, lon] = key;
    return [
      [lat + 1, Math.floor(lon / 2)],
      [lat - 1, 2 * lon],
      [lat - 1, 2 * lon + 1],
      [lat, lon - 1],
      [lat, lon + 1],
    ];
  }

  // Cells whose box meets the visible disk.
  //
  // The visible set is a hyperbolic disk of radius rho about the view centre, and in the half-plane a
  // hyperbolic disk is an ordinary EUCLIDEAN circle: centre (px, py*cosh(rho)), radius py*sinh(rho).
  // So the band-by-band intersection is exact and closed-form, with no sampling at all. For the
  // latitude band y in [y0, y1], the widest x occurs at whichever y in the band is nearest the
  // circle's centre, giving half-width sqrt(R^2 - dy^2).
  //
  // Two separate bugs lived here, and the second was caused by fixing the first badly:
  //
  //   * The 2011 routine evaluated the x-extent at y = 2^latitude, the BOTTOM of the band, and so
  //     missed about 46% of the cells it should have returned -- hence its "fix missing rooms"
  //     commit. Using the widest y in the band is the fix.
  //   * My first version over-corrected, taking ONE global bounding box over the whole visible disk
  //     and reusing it for every band. That is over-inclusive, which sounds safe, but the bands are
  //     walked from the smallest latitude upward against a hard maxCells budget -- and the smallest
  //     band has the smallest cells, so it has the most of them. Measured: at zoom 0.4 the routine
  //     returned 512 cells ALL IN ONE BAND and nothing whatsoever for the bands actually covering
  //     the screen. Zooming out made the dungeon vanish.
  //
  // So the budget is now spent nearest-first: cells are gathered with their distance from the view
  // centre and sorted, so a truncation drops the farthest cells rather than every cell above some
  // arbitrary latitude. `lastTruncated` records whether that happened, because a silently capped
  // enumeration reads exactly like a rendering bug.
  visible(viewMatrix, visibleRadius, maxCells = 512) {
    const rho = 2 * Math.atanh(Math.min(visibleRadius, 0.9995));
    const centre = viewMatrix.centreLocal([0, 0]);
    const hp = [0, 0];
    localToHalfPlaneInto(centre[0], centre[1], hp);
    const px = hp[0];
    const py = hp[1];
    this.lastTruncated = false;
    if (!Number.isFinite(px) || !Number.isFinite(py) || py <= 0) return [];

    const cy = py * Math.cosh(rho);
    const R = py * Math.sinh(rho);
    // cy - R = py*exp(-rho) and cy + R = py*exp(rho), both strictly positive, so the logs are safe.
    const latMin = Math.floor(Math.log2(py) - rho / Math.LN2);
    const latMax = Math.floor(Math.log2(py) + rho / Math.LN2);

    // Each band contributes an interval of longitudes. Rather than materialise them all and sort --
    // a wide view puts over five thousand cells in a single band, so that is both slow and, with a
    // budget, wrong -- keep a frontier of one candidate per side per band and repeatedly take the
    // globally nearest. The full visible set is still emitted whenever it fits in the budget; when it
    // does not, what survives is the nearest maxCells, which is what the user can actually see.
    const bands = [];
    for (let lat = latMin; lat <= latMax; lat++) {
      const size = Math.pow(2, lat);
      // Distance from the visible circle's centre to this band, zero if the centre lies inside it.
      const dy = Math.max(0, size - cy, cy - size * 2);
      if (dy >= R) continue;
      const hw = Math.sqrt((R - dy) * (R + dy));
      const lo = Math.floor((px - hw) / size);
      const hi = Math.floor((px + hw) / size);
      const start = Math.min(hi, Math.max(lo, Math.floor(px / size)));
      bands.push({ lat, size, my: size * 1.5, lo, hi, left: start - 1, right: start });
    }

    // cosh(d) - 1 between the view centre and a cell centre, in half-plane coordinates: monotone in
    // the hyperbolic distance, and free of both sqrt and log.
    //
    // Ranking by Euclidean distance from the circle's centre (px, cy) instead is a trap I fell into:
    // (px, cy) is the centre of the visible circle as drawn in the half-plane, which is NOT the view
    // centre -- it sits cosh(rho) times higher. For a wide view that is a factor of millions, so
    // "nearest the circle centre" picks out the cells hugging the far rim. Measured on the dungeon at
    // zoom 1.2: all 220 cells came back at hyperbolic distance 20.87, every one beyond the renderer's
    // cull radius, and the disk went completely blank.
    const rank = (b, lon) => {
      const dx = (lon + 0.5) * b.size - px;
      const dh = b.my - py;
      return (dx * dx + dh * dh) / (2 * py * b.my);
    };

    const out = [];
    for (;;) {
      let best = -1;
      let bestRank = Infinity;
      let bestLon = 0;
      let bestRight = false;
      for (let i = 0; i < bands.length; i++) {
        const b = bands[i];
        if (b.right <= b.hi) {
          const r = rank(b, b.right);
          if (r < bestRank) { bestRank = r; best = i; bestLon = b.right; bestRight = true; }
        }
        if (b.left >= b.lo) {
          const r = rank(b, b.left);
          if (r < bestRank) { bestRank = r; best = i; bestLon = b.left; bestRight = false; }
        }
      }
      if (best < 0) break; // every visible cell has been emitted
      if (out.length >= maxCells) { this.lastTruncated = true; break; }
      out.push([bands[best].lat, bestLon]);
      if (bestRight) bands[best].right++;
      else bands[best].left--;
    }
    return out;
  }
}

// Local module helper so `visible` does not allocate.
function localToHalfPlaneInto(px, py, out) {
  const r2 = px * px + py * py;
  const w = Math.sqrt(r2 + 1.0);
  const denom =
    py > 0.0
      ? (4.0 * px * px * w * w + 1.0) / (2.0 * r2 + 1.0 + 2.0 * py * w)
      : 2.0 * r2 + 1.0 - 2.0 * py * w;
  out[0] = (2.0 * px * w) / denom;
  out[1] = 1.0 / denom;
  return out;
}

// The half-plane point at the centre of a binary cell, for callers that want it.
export function binaryCellCentreLocal(lat, lon) {
  return halfPlaneToLocal((lon + 0.5) * Math.pow(2, lat), Math.pow(2, lat + 0.5), [0, 0]);
}
