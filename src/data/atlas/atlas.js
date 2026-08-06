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

    // key string -> {drawables, withinTile} once resolved
    this.cache = new Map();
    // key string -> promise, so concurrent frames do not issue duplicate requests
    this.pending = new Map();
    // The camera. Owned here so that the tiling, the walk and the cache all share one notion of where
    // "here" is.
    this.anchor = new Anchor(tiling);
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
      key: address,
      id: keyString,
      relativeFrame: rel.clone(),
      centreRelativeDisk: rel.applyToDisk(0, 0, [0, 0]),
    };

    const p = Promise.resolve()
      .then(() => this.tileData(tile))
      .then((data) => {
        this.pending.delete(keyString);
        if (data == null) {
          this.cache.set(keyString, { drawables: [], withinTile: true });
          return;
        }
        const entry = {
          drawables: compileDrawables(data, this.styleSheet),
          withinTile: !!(data && data.withinTile),
        };
        this.cache.set(keyString, entry);
        while (this.cache.size > this.cacheSize) {
          const oldest = this.cache.keys().next().value;
          this.cache.delete(oldest);
        }
        if (this.onTileLoad) this.onTileLoad(tile, entry.drawables);
        if (onReady) onReady();
      })
      .catch((err) => {
        this.pending.delete(keyString);
        // Cache the failure as empty so a broken tile is not retried every frame.
        this.cache.set(keyString, { drawables: [], withinTile: true });
        if (this.onTileError) this.onTileError(tile, err);
        else if (typeof console !== "undefined") console.error(`hyperbolic-map: tile ${keyString} failed`, err);
      });
    this.pending.set(keyString, p);
    return null;
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
      const keyString = this.tiling.addressToString(t.address);
      const entry = this.request(t.address, keyString, t.rel, onReady);
      if (!entry || entry.drawables.length === 0) continue;
      // The composition the whole rewrite is about: camera-relative view times camera-relative tile
      // frame. Both factors O(1); no world frame is ever formed.
      const net = Vc.mul(t.rel);
      this.lastTiles.push({ address: t.address, id: keyString, net: net, rel: t.rel });
      const wantClip =
        this.clip === CLIP_ALWAYS || (this.clip === CLIP_AUTO && !entry.withinTile);
      out.push({
        drawables: entry.drawables,
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
