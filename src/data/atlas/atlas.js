// The atlas: an independent coordinate patch per tile.
//
// Why this exists, in two use cases:
//
//   * Data far from the origin loses precision when expressed in one global patch. At hyperbolic
//     distance 20 a disk coordinate is 1 - 3.6e-9, so there are only ~7 significant digits left in
//     the quantity that matters. Splitting the data into tiles means every coordinate is small and
//     measured from its own tile's centre.
//
//     Crucially, the tile's frame is never expressed relative to the WORLD either. Everything here is
//     relative to the camera's own tile -- see anchor.js -- because a global frame has entries of
//     order cosh(d/2) (1.08e75 at binary cell (500, 0)) and multiplying it by an equally large view
//     matrix to obtain an O(1) screen position cancels away every digit. That was the original design
//     and it is why this was rebuilt.
//   * A repeating pattern becomes genuinely infinite: return the same tile data for every key.
//
// The tile -> data mapping is a callback that returns DATA, not URLs, so it can fetch, synthesise, or
// compose overlays. Rotation into each tile's frame is the library's job, never the callback's: the
// callback only ever sees and returns tile-local coordinates.

import { Isom } from "../../core/isom.js";
import { compileDrawables } from "../drawable.js";
import { geodesicArc, Arc } from "../../render/geodesic.js";
import { halfPlaneToLocal } from "../../core/coords.js";
import { Anchor } from "./anchor.js";
import { tileSymmetryResidual, tileSymmetryMessage } from "./symmetry.js";

export const CLIP_AUTO = "auto";
export const CLIP_ALWAYS = "always";
export const CLIP_NEVER = "never";

const atlasArc = new Arc();

export class Atlas {
  constructor(options = {}) {
    const {
      tiling,
      tileData,
      clip = CLIP_AUTO,
      cacheSize = 512,
      maxTiles = 256,
      styleSheet = null,
      onTileLoad = null,
      onTileError = null,
      // "warn" | "throw" | "off". See symmetry.js: on a {p,q} tiling a tile's frame is only defined up
      // to the stabiliser C_m, so art that is not C_m-invariant jumps when the camera re-anchors. That
      // is invisible until you scroll, so it is checked on the first tile rather than only documented.
      checkTileSymmetry = "warn",
      tileSymmetryTolerance = 1e-6,
      // Below this on-screen tile radius (in CSS pixels) a tile draws its `lod` art instead of its full
      // art, if it supplied any. See passes().
      lodPx = 11,
    } = options;
    if (!tiling) throw new Error("hyperbolic-map: atlas needs a tiling");
    if (typeof tileData !== "function") throw new Error("hyperbolic-map: atlas needs a tileData callback");

    this.tiling = tiling;
    this.tileData = tileData;
    this.clip = clip;
    this.cacheSize = cacheSize;
    this.maxTiles = maxTiles;
    this.styleSheet = styleSheet;
    this.onTileLoad = onTileLoad;
    this.onTileError = onTileError;
    this.checkTileSymmetry = checkTileSymmetry;
    this.lodPx = lodPx;
    this.tileSymmetryTolerance = tileSymmetryTolerance;
    // Populated by the first symmetry check: { residual, checked, ok }. Exposed so a demo page can show
    // it and so tests can assert on it.
    this.tileSymmetry = null;
    this._symmetryChecked = false;

    // key string -> {drawables, withinTile} once resolved
    this.cache = new Map();
    // key string -> promise, so concurrent frames do not issue duplicate requests
    this.pending = new Map();
    // The camera. Owned here so that the tiling, the walk and the cache all share one notion of where
    // "here" is.
    this.anchor = new Anchor(tiling);
    // Scratch, and the tile's circumradius in LOCAL coordinates -- used to measure a tile's screen size
    // for the level-of-detail switch, once per tile per frame.
    this._c0 = [0, 0];
    this._c1 = [0, 0];
    this.tileLocalRadius = Math.sinh((tiling.metrics.circumradius || 1) / 2);
    // Compiled art, memoised on the IDENTITY of the object the callback returned.
    //
    // On a {p,q} tiling the walk renames many tiles at once when the camera re-anchors, so they all miss
    // the address-keyed cache together. Measured on the Escher atlas during a drag: the re-anchor frame
    // recompiled 160 tiles and took 125 ms, against a 16 ms median. But the data itself had not changed
    // -- the rule says art on such a tiling may only depend on the tile CLASS, so a sane provider
    // returns one of a few shared objects, and those had already been compiled. Keying on object
    // identity turns the whole stall into 160 map lookups without needing to know anything about the
    // provider. A provider that builds a fresh object every call gets today's behaviour, unchanged.
    this._compiled = typeof WeakMap === "function" ? new WeakMap() : null;
  }

  // THE RULE, enforced. See symmetry.js for why this matters and what goes wrong without it.
  //
  // Only meaningful for tilings with a non-trivial stabiliser: the binary tiling has none, so its art is
  // unconstrained and this is skipped entirely.
  verifyTileSymmetry(data) {
    if (this._symmetryChecked || this.checkTileSymmetry === "off") return;
    const m = this.tiling.stabiliserOrder;
    if (!(m > 1)) {
      this._symmetryChecked = true;
      return;
    }
    const drawables = data && data.drawables;
    if (!drawables || !drawables.length) return; // an empty tile says nothing; wait for a real one
    if (data.coordinates && data.coordinates !== "local") {
      // The check is only exact in tile-local coordinates, where the stabiliser is a plain Euclidean
      // rotation. Say so rather than reporting a number that means nothing.
      this._symmetryChecked = true;
      this.tileSymmetry = { skipped: `coordinates "${data.coordinates}" are not tile-local`, ok: true };
      return;
    }
    this._symmetryChecked = true;
    const { residual, checked, offender } = tileSymmetryResidual(drawables, m);
    const ok = residual <= this.tileSymmetryTolerance;
    this.tileSymmetry = { residual, checked, offender, m, ok };
    if (ok) return;
    const name = this.tiling.p
      ? `{${this.tiling.p},${this.tiling.q}}${this.tiling.m !== this.tiling.p ? ` with frameSymmetry ${this.tiling.m}` : ""}`
      : "this tiling";
    const msg = tileSymmetryMessage(residual, m, name);
    if (this.checkTileSymmetry === "throw") throw new Error(msg);
    if (typeof console !== "undefined") console.warn(msg);
  }

  // Ask for a tile's data. Returns the compiled drawables if they are ready, or null while a request
  // is outstanding. Never throws: a failing tile is reported and then skipped.
  request(address, keyString, rel, onReady) {
    const hit = this.cache.get(keyString);
    if (hit) {
      // Refresh LRU position.
      this.cache.delete(keyString);
      this.cache.set(keyString, hit);
      return hit;
    }
    if (this.pending.has(keyString)) return null;

    // What the callback is told about the tile. Deliberately NOT a world frame -- there is no such
    // thing here any more -- but the tile's address plus its position relative to the camera, which is
    // all a provider can meaningfully use. The contract is unchanged in the way that matters: the
    // callback returns data in TILE-LOCAL coordinates and the library places it.
    const tile = {
      address: address,
      // The readable identifier, for filenames and logging. Built here, on a cache miss, rather than
      // per frame.
      id: this.tiling.addressToString(address),
      // The tile's CLASS, in [0, classCount). The only per-tile variation a {p,q} atlas may safely use:
      // unlike `address`, it is the same whichever route the walk took, so art keyed on it does not jump
      // when the camera re-anchors. `classCount` is 1 when the tiling admits no such invariant, in which
      // case every tile must look the same. See RegularTiling.tileClass.
      classIndex: this.tiling.tileClass ? this.tiling.tileClass(address) : 0,
      classCount: this.tiling.classModulus || 1,
      relativeFrame: rel.clone(),
      centreRelativeDisk: rel.applyToDisk(0, 0, [0, 0]),
    };

    // A SYNCHRONOUS callback must be served in THIS frame.
    //
    // Going through a promise even for data that is already in hand costs a frame, and on a {p,q}
    // tiling that frame is visible: word addresses are not canonical, so when the camera re-anchors the
    // walk renames many tiles at once, every renamed tile misses the cache, and every one of them
    // vanishes for exactly one frame. Measured on {7,3} panning one tile spacing in 60 steps: 26 of the
    // on-screen tiles disappeared together on the single re-anchor frame, plus 1-3 per frame from tiles
    // entering at the rim. That is the flicker. The binary tiling barely showed it (worst 2) because its
    // addresses are canonical and nothing gets renamed.
    let result;
    try {
      result = this.tileData(tile);
    } catch (err) {
      this.failTile(keyString, tile, err);
      return this.cache.get(keyString) || null;
    }
    if (!result || typeof result.then !== "function") {
      try {
        return this.acceptTile(keyString, tile, result);
      } catch (err) {
        this.failTile(keyString, tile, err);
        return this.cache.get(keyString) || null;
      }
    }

    const p = result
      .then((data) => {
        this.pending.delete(keyString);
        this.acceptTile(keyString, tile, data);
        if (onReady) onReady();
      })
      .catch((err) => {
        this.pending.delete(keyString);
        this.failTile(keyString, tile, err);
      });
    this.pending.set(keyString, p);
    return null;
  }

  // Compile a tile's data, cache it, and return the entry. Shared by the synchronous and asynchronous
  // paths so they cannot drift apart.
  acceptTile(keyString, tile, data) {
    if (data == null) {
      const empty = { drawables: [], withinTile: true };
      this.cache.set(keyString, empty);
      return empty;
    }
    // Check THE RULE once, on the first tile that carries artwork: is this art invariant under the tile
    // stabiliser? If not, it will jump as the camera scrolls, and nothing else in the library will
    // complain. Once, not per tile: the answer is a property of the art, and the check is O(shapes^2).
    this.verifyTileSymmetry(data);
    let entry = this._compiled && typeof data === "object" ? this._compiled.get(data) : null;
    if (!entry) {
      entry = {
        drawables: compileDrawables(data, this.styleSheet),
        withinTile: !!(data && data.withinTile),
        // Optional level of detail: a cheap stand-in used when the tile is small on screen. Compiled
        // here so switching between them per frame costs nothing.
        lod: data.lod
          ? compileDrawables({ version: 1, coordinates: data.coordinates || "local", drawables: data.lod }, this.styleSheet)
          : null,
        lodPx: typeof data.lodPx === "number" ? data.lodPx : this.lodPx,
      };
      if (this._compiled && typeof data === "object") this._compiled.set(data, entry);
    }
    this.cache.set(keyString, entry);
    while (this.cache.size > this.cacheSize) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
    if (this.onTileLoad) this.onTileLoad(tile, entry.drawables);
    return entry;
  }

  failTile(keyString, tile, err) {
    // Cache the failure as empty so a broken tile is not retried every frame.
    this.cache.set(keyString, { drawables: [], withinTile: true });
    if (this.onTileError) this.onTileError(tile, err);
    // `tile.id` is the readable address, not `keyString`: cache keys are folded hashes for speed, and
    // "tile 9303484400662374000 failed" tells a caller nothing they can act on.
    else if (typeof console !== "undefined") console.error(`hyperbolic-map: tile ${tile.id} failed`, err);
  }

  // Build the render passes for the current view: one per visible tile, each with its own matrix and
  // clip path.
  // The tiles the last render used, each with the composed matrix that placed it. Kept so overlays and
  // diagnostics can work in the same frames the renderer used, instead of recomputing a global frame
  // (which is what the outline overlay in the Escher demo used to do, and cannot any more).
  //
  // Populated by passes(); `net` maps tile-local coordinates straight to screen-disk coordinates.
  lastTiles = [];

  passes(view, onReady) {
    // `view.matrix` is the CAMERA-RELATIVE view when an atlas is present; the viewport re-anchors
    // before every render so this stays O(1).
    const Vc = view.matrix;
    const tiles = this.anchor.neighbourhood(Vc, view.effectiveRadius, this.maxTiles);
    const out = [];
    this.lastTiles = [];
    for (const t of tiles) {
      // `addressKey` is the CACHE key: O(1) per tile. The human-readable string is built only on a
      // miss, inside request(), because far from the origin it is thousands of characters long and
      // producing 200 of them per frame cost ~20 ms.
      const keyString = this.tiling.addressKey(t.address);
      const entry = this.request(t.address, keyString, t.rel, onReady);
      if (!entry || entry.drawables.length === 0) continue;
      // The composition the whole rewrite is about: camera-relative view times camera-relative tile
      // frame. Both factors O(1); no world frame is ever formed.
      const net = Vc.mul(t.rel);

      // LEVEL OF DETAIL. Most tiles on screen are tiny -- measured on the Escher atlas, 122 of 200 had a
      // screen radius under 8 px -- and submitting a few hundred shapes for an 8 px tile is most of the
      // frame. Drawing 46,600 shapes cost 37 ms; the same frame with everything culled cost 6.4 ms, so
      // it really is the drawing, and per-drawable culling cannot help because the shapes are each about
      // a pixel rather than sub-pixel.
      let drawables = entry.drawables;
      if (entry.lod && entry.lod.length) {
        net.applyToDisk(0, 0, this._c0);
        net.applyToLocal(this.tileLocalRadius, 0, undefined, this._c1);
        const px = Math.hypot(this._c1[0] - this._c0[0], this._c1[1] - this._c0[1]) * view.radius;
        if (px < entry.lodPx) drawables = entry.lod;
      }
      // `id` is LAZY. Overlays and diagnostics want the readable string, but most frames never look at
      // it, and building 200 of them costs ~20 ms once the words are thousands of symbols long.
      const tiling = this.tiling;
      this.lastTiles.push({
        address: t.address,
        get id() { return tiling.addressToString(this.address); },
        net: net,
        rel: t.rel,
      });
      const wantClip =
        this.clip === CLIP_ALWAYS || (this.clip === CLIP_AUTO && !entry.withinTile);
      out.push({
        drawables: drawables,
        matrix: net,
        clip: wantClip ? this.clipPathFor(net) : null,
      });
    }
    return out;
  }

  // A clip region for one tile, expressed as a callback that traces the boundary into a canvas path.
  // Kept as a closure so the renderer does not need to know about tiling shapes.
  clipPathFor(net) {
    const b = this.tiling.boundaryLocal();
    if (b.kind === "binary-cell") return binaryCellClip(net, b);
    return polygonClip(net, b.points);
  }
}

// Clip to a hyperbolic polygon: p geodesic arcs through the projected vertices.
function polygonClip(net, localPoints) {
  return (ctx, view) => {
    const scale = view.radius;
    const sx = view.cx;
    const sy = view.cy;
    const n = localPoints.length;
    const px = new Float64Array(n);
    const py = new Float64Array(n);
    const buf = [0, 0];
    for (let i = 0; i < n; i++) {
      net.applyToLocal(localPoints[i][0], localPoints[i][1], undefined, buf);
      px[i] = buf[0];
      py[i] = buf[1];
    }
    ctx.beginPath();
    ctx.moveTo(px[0] * scale + sx, -py[0] * scale + sy);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      geodesicArc(px[i], py[i], px[j], py[j], atlasArc, 0, 0.25 / scale);
      if (atlasArc.straight) {
        ctx.lineTo(px[j] * scale + sx, -py[j] * scale + sy);
      } else {
        ctx.arc(
          atlasArc.cx * scale + sx,
          -atlasArc.cy * scale + sy,
          atlasArc.r * scale,
          -atlasArc.startAngle,
          -atlasArc.endAngle,
          atlasArc.anticlockwise,
        );
      }
    }
    ctx.closePath();
    ctx.clip();
  };
}

// Clip to a binary-tiling cell.
//
// The cell has FOUR sides and they are not alike: two are horocycles (y = const, circles internally
// tangent to the disk boundary) and two are GEODESICS (x = const, circles orthogonal to it -- audit
// claim 13). The first version sampled the horocyclic sides with twelve segments each, which is
// plenty, but joined the two geodesic sides with a single straight lineTo.
//
// That was wrong by a measurable amount. The chord cuts inside the true arc by a sagitta of 0.004889
// disk units, which is 1.5 px at zoom 1, 3.3 px at the dungeon's default zoom 2.2, and 9.1 px at
// zoom 6 -- a visible band along every vertical cell boundary, and exactly the "clipping in the wrong
// places" symptom. So both kinds of side are now sampled, each to a target pixel sagitta.
//
// Sampling in the tile's own half-plane and projecting each sample is what keeps this exact: every
// sample lies ON the true curve, so the only error is the polyline's departure from it between
// samples, which the step count controls.
function binaryCellClip(net, box) {
  const hw = box.halfWidth;
  const yLow = box.yLow;
  const yHigh = box.yHigh;

  return (ctx, view) => {
    const scale = view.radius;
    const sx = view.cx;
    const sy = view.cy;
    const buf = [0, 0];

    // Segment counts from the on-screen size of each side, so a zoomed-in cell is subdivided more.
    // The 0.25 px target matches the renderer's own arc tolerance.
    const spanPx = 2 * hw * scale;
    const risePx = (yHigh - yLow) * scale;
    const horoSteps = Math.max(8, Math.min(64, Math.ceil(Math.sqrt(spanPx / 0.25))));
    const geoSteps = Math.max(8, Math.min(64, Math.ceil(Math.sqrt(risePx / 0.25))));

    const emit = (hx, hy, first) => {
      const l = halfPlaneToLocal(hx, hy, buf);
      net.applyToLocal(l[0], l[1], undefined, buf);
      const X = buf[0] * scale + sx;
      const Y = -buf[1] * scale + sy;
      if (first) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    };

    ctx.beginPath();
    // Bottom horocycle, left to right.
    for (let i = 0; i <= horoSteps; i++) emit(-hw + (2 * hw * i) / horoSteps, yLow, i === 0);
    // Right geodesic, bottom to top. Sampled logarithmically in y: the half-plane metric is dy/y, so
    // equal hyperbolic steps are equal RATIOS, and uniform sampling in y would crowd the samples at
    // the top while leaving the bottom coarse.
    for (let i = 1; i <= geoSteps; i++) emit(hw, yLow * Math.pow(yHigh / yLow, i / geoSteps), false);
    // Top horocycle, right to left.
    for (let i = 1; i <= horoSteps; i++) emit(hw - (2 * hw * i) / horoSteps, yHigh, false);
    // Left geodesic, top to bottom.
    for (let i = 1; i < geoSteps; i++) emit(-hw, yHigh * Math.pow(yLow / yHigh, i / geoSteps), false);
    ctx.closePath();
    ctx.clip();
  };
}
