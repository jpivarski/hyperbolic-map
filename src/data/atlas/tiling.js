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
    const seen = new Set();
    const out = [];
    const queue = [start];
    const mark = (frame) => {
      frame.applyToDisk(0, 0, buf);
      // Adjacent tile centres are separated by tanh(inradius) in disk coordinates near the origin and
      // by ~e^-d far out, so quantise relative to the local spacing rather than absolutely.
      return `${Math.round(buf[0] * 1e7)},${Math.round(buf[1] * 1e7)}`;
    };

    while (queue.length && out.length < maxTiles) {
      const key = queue.shift();
      const frame = this.frame(key);
      const tag = mark(frame);
      if (seen.has(tag)) continue;
      seen.add(tag);
      const ch = coshHalfTo(frame);
      if (ch > walkCosh) continue;
      if (ch <= includeCosh) out.push(key);
      for (let g = 0; g < this.generators.length; g++) queue.push(key.concat([g]));
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

  // Cells whose box meets the visible disk. Uses the WIDEST y in each latitude band, not the bottom
  // edge -- the 2011 routine sampled the bottom and so missed about 46% of the cells it should have
  // returned (hence its "fix missing rooms" commit).
  visible(viewMatrix, visibleRadius, maxCells = 512) {
    const rho = 2 * Math.atanh(Math.min(visibleRadius, 0.9995));
    const inv = viewMatrix.inverse();
    const r = Math.tanh(rho / 2);

    let xmin = Infinity;
    let xmax = -Infinity;
    let ymin = Infinity;
    let ymax = -Infinity;
    const N = 64;
    const buf = [0, 0];
    const hp = [0, 0];
    for (let i = 0; i < N; i++) {
      const t = (2 * Math.PI * i) / N;
      inv.applyToDisk(r * Math.cos(t), r * Math.sin(t), buf);
      const k = 1 / Math.sqrt(1 - buf[0] * buf[0] - buf[1] * buf[1]);
      localToHalfPlaneInto(buf[0] * k, buf[1] * k, hp);
      if (!Number.isFinite(hp[0]) || !Number.isFinite(hp[1]) || hp[1] <= 0) continue;
      if (hp[0] < xmin) xmin = hp[0];
      if (hp[0] > xmax) xmax = hp[0];
      if (hp[1] < ymin) ymin = hp[1];
      if (hp[1] > ymax) ymax = hp[1];
    }
    if (!Number.isFinite(xmin) || ymin <= 0) return [];

    const latMin = Math.floor(Math.log2(ymin));
    const latMax = Math.floor(Math.log2(ymax));
    const out = [];
    for (let lat = latMin; lat <= latMax && out.length < maxCells; lat++) {
      const size = Math.pow(2, lat);
      const lo = Math.floor(xmin / size) - 1;
      const hi = Math.floor(xmax / size) + 1;
      for (let lon = lo; lon <= hi && out.length < maxCells; lon++) out.push([lat, lon]);
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
