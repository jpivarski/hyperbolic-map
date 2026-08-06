// The atlas: an independent coordinate patch per tile.
//
// Why this exists, in two use cases:
//
//   * Data far from the origin loses precision when expressed in one global patch. At hyperbolic
//     distance 20 a disk coordinate is 1 - 3.6e-9, so there are only ~7 significant digits left in
//     the quantity that matters. Splitting the data into tiles means every coordinate is small and
//     measured from its own tile's centre, and the tile's frame is built by multiplying generator
//     matrices rather than derived from a huge number.
//   * A repeating pattern becomes genuinely infinite: return the same tile data for every key.
//
// The tile -> data mapping is a callback that returns DATA, not URLs, so it can fetch, synthesise, or
// compose overlays. Rotation into each tile's frame is the library's job, never the callback's: the
// callback only ever sees and returns tile-local coordinates.

import { Isom } from "../../core/isom.js";
import { compileDrawables } from "../drawable.js";
import { geodesicArc, Arc } from "../../render/geodesic.js";
import { BINARY_LOCAL_HALF_WIDTH, BINARY_LOCAL_Y_LOW, BINARY_LOCAL_Y_HIGH } from "./tiling.js";
import { halfPlaneToLocal } from "../../core/coords.js";

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
    this.frames = new Map();
  }

  frameFor(keyString, key) {
    let f = this.frames.get(keyString);
    if (!f) {
      f = this.tiling.frame(key);
      this.frames.set(keyString, f);
    }
    return f;
  }

  // Ask for a tile's data. Returns the compiled drawables if they are ready, or null while a request
  // is outstanding. Never throws: a failing tile is reported and then skipped.
  request(key, keyString, onReady) {
    const hit = this.cache.get(keyString);
    if (hit) {
      // Refresh LRU position.
      this.cache.delete(keyString);
      this.cache.set(keyString, hit);
      return hit;
    }
    if (this.pending.has(keyString)) return null;

    const frame = this.frameFor(keyString, key);
    const centre = frame.applyToDisk(0, 0, [0, 0]);
    const tile = {
      key: key.slice ? key.slice() : key,
      id: keyString,
      centreDisk: centre,
      orientation: frame.screenRotation(),
      frame: frame.clone(),
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
  passes(view, onReady) {
    const keys = this.tiling.visible(view.matrix, view.effectiveRadius, this.maxTiles);
    const out = [];
    for (const key of keys) {
      const keyString = this.tiling.keyToString(key);
      const entry = this.request(key, keyString, onReady);
      if (!entry || entry.drawables.length === 0) continue;
      const frame = this.frameFor(keyString, key);
      const net = view.matrix.mul(frame);
      const wantClip =
        this.clip === CLIP_ALWAYS || (this.clip === CLIP_AUTO && !entry.withinTile);
      out.push({
        drawables: entry.drawables,
        matrix: net,
        clip: wantClip ? this.clipPathFor(key, net) : null,
      });
    }
    return out;
  }

  // A clip region for one tile, expressed as a callback that traces the boundary into a canvas path.
  // Kept as a closure so the renderer does not need to know about tiling shapes.
  clipPathFor(key, net) {
    const b = this.tiling.boundary(key);
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

// Clip to a binary-tiling cell. Its two vertical sides are geodesics and its two horizontal sides are
// HOROCYCLES (circles internally tangent to the disk boundary), so this cannot reuse the polygon path
// builder. Approximating each horocyclic side by a short polyline is exact enough at any zoom -- a
// horocycle is very flat over one cell's width -- and avoids having to solve for tangency on screen.
function binaryCellClip(net, box) {
  const hw = box.halfWidth;
  const yLow = box.yLow;
  const yHigh = box.yHigh;
  const STEPS = 12;
  // Trace the box boundary in the tile's own half-plane coordinates.
  const ring = [];
  for (let i = 0; i <= STEPS; i++) ring.push([-hw + (2 * hw * i) / STEPS, yLow]);
  ring.push([hw, yLow]);
  for (let i = 0; i <= STEPS; i++) ring.push([hw - (2 * hw * i) / STEPS, yHigh]);
  ring.push([-hw, yHigh]);

  const local = ring.map(([hx, hy]) => halfPlaneToLocal(hx, hy, [0, 0]));

  return (ctx, view) => {
    const scale = view.radius;
    const sx = view.cx;
    const sy = view.cy;
    const buf = [0, 0];
    ctx.beginPath();
    for (let i = 0; i < local.length; i++) {
      net.applyToLocal(local[i][0], local[i][1], undefined, buf);
      const X = buf[0] * scale + sx;
      const Y = -buf[1] * scale + sy;
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    }
    ctx.closePath();
    ctx.clip();
  };
}
