// The anchored camera: the piece that keeps every number small.
//
// The view is stored NOT as an isometry of the world, but as an isometry of the camera tile's own
// frame:
//
//     V_c := V . F_c        so that   screen = V_c(p)   for p in camera-tile-local coordinates
//
// and any other tile's contribution is
//
//     net = V_c . R          where R = F_c^-1 . F_k is that tile's frame RELATIVE to the camera,
//
// built by multiplying one constant generator per step of the walk. `V` and `F_k` never exist
// numerically, which is the entire point: at binary cell (500, 0) the global frame has entries of
// 1.08e75, and forming `V . F_k` to get an O(1) screen position destroys every digit.
//
// Two identities make this work, both proved in tools/audit_atlas_math.py:
//
//   re-anchor   crossing into c' = c.g  =>  V_c' = V_c . G_g          (claim 3)
//   telescoping R_{c -> c.w} = G_w1 . G_w2 . ...                       (claim 4)
//
// The first is what bounds the view: whenever the camera would drift far from its tile, it changes
// tile instead, and the matrix is multiplied by one O(1) generator. Measured: 1,256 tile crossings of
// {8,3} leave max|V_c| at 1.105. Without it, 500 crossings would need entries of order 1e165.
//
// Note the camera tile does NOT have to be the tile containing the view centre. It only has to be
// NEAR it, so that V_c stays O(1) and the walk starts nearby. Tile identity comes from the walk's
// addresses, not from which tile the camera picked, so a greedy nearest-centre rule is sufficient and
// works uniformly for tilings whose cells are not Voronoi cells of their centres (the binary one).

import { Isom } from "../../core/isom.js";

// The camera holds only its ADDRESS. The camera-relative view matrix lives in the ViewState, which
// already owns committed-versus-live bookkeeping, and is passed in. Duplicating it here would mean two
// copies to keep in step, and a gesture rewrites the live matrix every frame.
export class Anchor {
  constructor(tiling, options = {}) {
    this.tiling = tiling;
    this.address = options.address !== undefined && options.address !== null
      ? options.address
      : tiling.originAddress();
    this.reanchorCount = 0;
    this.lastTruncated = false;
    this._buf = [0, 0];
  }

  atOrigin() {
    return this.tiling.addressEquals(this.address, this.tiling.originAddress());
  }

  // The view centre expressed in camera-tile-local coordinates: V_c^-1(0). All small numbers.
  viewCentreLocal(matrix, out) {
    const inv = matrix.inverse();
    inv.applyToDisk(0, 0, this._buf);
    const zx = this._buf[0];
    const zy = this._buf[1];
    const k = 1 / Math.sqrt(Math.max(1e-300, 1 - zx * zx - zy * zy));
    const x = zx * k;
    const y = zy * k;
    out[0] = x;
    out[1] = y;
    out[2] = Math.sqrt(1 + x * x + y * y);
    return out;
  }

  // Move the camera to whichever neighbour's centre is nearest the view centre, repeatedly.
  //
  // Every quantity here is in camera-local coordinates, so nothing knows or cares how far the camera
  // has travelled. Bounded iteration because a single frame can only move the view a little; the
  // limit exists so a pathological setCamera cannot spin.
  // Returns the accumulated RIGHT factor: the caller must replace its matrix with matrix.mul(shift),
  // and must apply the same shift to any other representation of the same view (the ViewState keeps a
  // committed and a live copy). Returning the shift rather than mutating a matrix is what makes
  // re-anchoring safe in the middle of a gesture: `updatePan` builds the live matrix by
  // LEFT-multiplying the committed one, so a right factor applied to both is exactly consistent and
  // the grabbed screen point stays pinned.
  // `maxSteps` is generous on purpose. Each step is a couple of dozen flops, and the camera may have
  // to catch up a long way at once -- a gesture that ran while rendering was throttled, or a
  // setCamera to a distant tile. Being unable to catch up is what lets V grow, so the bound exists
  // only to guarantee termination, not to ration work.
  reanchor(matrix, maxSteps = 4096) {
    const c = [0, 0, 0];
    let shift = Isom.identity();
    let current = matrix;
    let steps = 0;
    // Monotonicity guard. Each step must bring the view centre strictly closer to the camera tile's
    // centre; that is what makes the descent terminate. Enforcing it here rather than trusting each
    // tiling's rule means a future tiling with a subtly non-monotone `stepToward` degrades to "stop
    // early" instead of spinning to the iteration cap -- which is how a 2-cycle presented itself before:
    // 4,096 steps on a single camera move.
    let previous = Infinity;
    for (; steps < maxSteps; steps++) {
      this.viewCentreLocal(current, c);
      if (!(c[2] < previous)) break;
      previous = c[2];
      // Ask the tiling which way to go. Each tiling answers with an EXACT, monotone rule -- the most
      // violated half-plane for a regular tiling, the box test for a binary cell -- so the descent
      // cannot cycle. An earlier version used a generic nearest-centre comparison with a tolerance,
      // which is fine for Voronoi cells but wrong for binary ones: mixing it with a containment check
      // made the two rules fight, and 500 small camera moves cost 143,407 re-anchor steps instead of
      // about 30.
      //
      // The answer is an INDEX INTO the neighbour list, which is why the list's order is part of the
      // Tiling contract. Naming a generator instead cannot work for the binary tiling, whose parent
      // step has two parities: an odd-longitude cell offers only PARENT_ODD, so a request for
      // PARENT_EVEN silently found nothing and the camera could never move up at all.
      const nbrs = this.tiling.neighbours(this.address);
      const dir = this.tiling.stepToward(c[0], c[1]);
      if (dir < 0 || dir >= nbrs.length) break;
      const chosen = nbrs[dir];
      const g = this.tiling.generator(chosen.gen);
      shift = shift.mul(g).normalize();
      current = current.mul(g).normalize();
      this.address = chosen.address;
      this.reanchorCount++;
    }
    return { steps, shift };
  }

  // Tiles that can be on screen, each with its frame RELATIVE to the camera.
  //
  // Breadth-first from the camera tile, starting at the identity and multiplying by one constant
  // generator per step. Two radii: a tile is INCLUDED when its circumscribed disk meets the visible
  // disk, and the walk CONTINUES through a slightly larger radius so a tile touching only at a corner
  // is still reachable through a neighbour that was itself included.
  //
  // Returns [{ address, rel }] with `rel` mapping tile-local coordinates into camera-local ones.
  neighbourhood(matrix, visibleRadius, maxTiles = 256) {
    this.lastTruncated = false;
    const tiling = this.tiling;
    const rho = 2 * Math.atanh(Math.min(visibleRadius, 0.9995));
    const chi = tiling.metrics.circumradius;
    const spacing = tiling.metrics.centreSpacing;
    const includeCosh = Math.cosh((rho + chi) / 2);
    const walkCosh = Math.cosh((rho + chi + spacing) / 2);

    const c = this.viewCentreLocal(matrix, [0, 0, 0]);
    const cx = c[0];
    const cy = c[1];
    const cw = c[2];

    const buf = this._buf;
    // cosh(d/2) from the view centre to a tile centre, both in camera-local coordinates.
    const coshHalfTo = (rel) => {
      rel.applyToDisk(0, 0, buf);
      const k = 1 / Math.sqrt(Math.max(1e-300, 1 - buf[0] * buf[0] - buf[1] * buf[1]));
      const tx = buf[0] * k;
      const ty = buf[1] * k;
      const tw = Math.sqrt(1 + tx * tx + ty * ty);
      const A = tw * cw - tx * cx - ty * cy;
      const B = tx * cy - ty * cx;
      return Math.hypot(A, B);
    };

    // Deduplication. Word addresses are not canonical -- two different words can name one tile -- so
    // those tilings also need a geometric check. That check is now trivially reliable: the relative
    // frames are O(1) and carry ~1e-15 of error, against a tile spacing of order 0.3, so a rounded
    // grid plus an exact invariant comparison has ~13 orders of margin. (The previous design had to
    // grow the quantum with distance and still produced duplicates, because it was comparing numbers
    // that had already cancelled away most of their digits.)
    const seenAddress = new Set();
    const grid = new Map();
    const accX = [];
    const accY = [];
    const accW = [];
    const CELL = 1e-5;
    const dupCosh = Math.cosh(spacing / 4);
    const geometric = !tiling.addressesAreCanonical;

    // For tilings whose addresses are canonical (the binary one) the string IS the identity, so keying
    // on it is both cheap and complete. For word-addressed tilings it is neither: two words can name one
    // tile, so a geometric check is needed anyway, and stringifying every candidate the walk dequeues
    // cost 57 ms per frame at 5,000 tiles from the origin. So: string key only where it is the answer.
    const alreadySeen = (rel, key) => {
      if (!geometric) {
        if (seenAddress.has(key)) return true;
        seenAddress.add(key);
        return false;
      }
      rel.applyToDisk(0, 0, buf);
      const zx = buf[0];
      const zy = buf[1];
      const k = 1 / Math.sqrt(Math.max(1e-300, 1 - zx * zx - zy * zy));
      const lx = zx * k;
      const ly = zy * k;
      const lw = Math.sqrt(1 + lx * lx + ly * ly);
      const gx = Math.floor(zx / CELL);
      const gy = Math.floor(zy / CELL);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = grid.get((gx + dx) * 8191 + (gy + dy));
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i++) {
            const j = bucket[i];
            const A = accW[j] * lw - accX[j] * lx - accY[j] * ly;
            const B = accX[j] * ly - accY[j] * lx;
            if (Math.hypot(A, B) < dupCosh) return true;
          }
        }
      }
      const home = gx * 8191 + gy;
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

    const out = [];
    const dist = [];
    const queue = [{ address: this.address, rel: Isom.identity() }];
    // Gather twice the budget so that, when truncating, there is something to choose between:
    // admitting in BFS discovery order instead lets a one-ULP view change swap which rim tile is last,
    // which shows up as a tile flickering between otherwise identical frames. BFS explores by GRAPH
    // distance, which only approximates geometric distance, so over-gathering is what makes the
    // nearest-first choice meaningful rather than nominal.
    const gatherLimit = Math.max(maxTiles + 8, maxTiles * 2);
    // A hard bound on dequeues, separate from the bound on results: every admitted tile pushes its
    // neighbours, so a dedup failure would otherwise grow the queue geometrically while `out` never
    // fills. Degrading to fewer tiles is acceptable; not returning is not.
    let examined = 0;
    const maxExamined = 24 * maxTiles + 512;

    while (queue.length && out.length < gatherLimit) {
      if (++examined > maxExamined) {
        this.lastTruncated = true;
        break;
      }
      const node = queue.shift();
      // Only stringify when the string is what deduplicates -- see alreadySeen.
      const key = geometric ? null : tiling.addressToString(node.address);
      if (alreadySeen(node.rel, key)) continue;
      const ch = coshHalfTo(node.rel);
      if (ch > walkCosh) continue;
      if (ch <= includeCosh) {
        out.push(node);
        dist.push(ch);
      }
      const nbrs = tiling.neighbours(node.address);
      for (let i = 0; i < nbrs.length; i++) {
        queue.push({
          address: nbrs[i].address,
          rel: node.rel.mul(tiling.generator(nbrs[i].gen)),
        });
      }
    }

    // Always honour the budget. An earlier version only truncated when the queue was still non-empty,
    // so a walk that gathered past maxTiles and then ran out of candidates returned MORE tiles than
    // asked for -- a silent budget overrun that a caller sizing its cache to maxTiles would not expect.
    if (out.length > maxTiles) {
      this.lastTruncated = true;
      const order = out.map((_, i) => i).sort((i, j) => dist[i] - dist[j]);
      return order.slice(0, maxTiles).map((i) => out[i]);
    }
    if (queue.length) this.lastTruncated = this.lastTruncated || out.length >= maxTiles;
    return out;
  }

  // Largest absolute matrix entry of a camera-relative view. Exposed because it is the single number
  // that shows this design working: it must stay O(1) no matter how far the camera has travelled.
  static maxEntry(m) {
    return Math.max(Math.abs(m.ar), Math.abs(m.ai), Math.abs(m.br), Math.abs(m.bi));
  }
}
