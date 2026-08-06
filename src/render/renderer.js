// The draw pipeline.
//
// Stage order, which is also the hook order and is what lets an example page draw things like a
// world-turtle behind the disk without the library knowing anything about turtles:
//
//   1  clear
//   2  layers with z < 0, then onBeforeDraw          <- outside the disk, e.g. stars, turtle shell
//   3  the disk fill (opaque, so it hides step 2 inside the disk)
//   4  content
//   5  the rim annulus
//   6  layers with z > 0, then onAfterDraw           <- overlays
//
// Coordinates: the library works in CSS pixels throughout. The surface applies the
// devicePixelRatio transform once, so nothing here has to think about it.

import { geodesicArc, Arc } from "./geodesic.js";
import { FLAG_STROKE, FLAG_MARKER } from "../data/drawable.js";
import { coshHalfDistanceSquared, screenRadiusToThresholdSquared, capMayBeVisible, capThreshold } from "../core/minkowski.js";

// The 2011 constants, for the faithful-port mode.
export const LEGACY_MAX_STRAIGHT_LINE_LENGTH = 0.1;
export const FONT_SCALE = 0.05;
// The 2011 renderer set a fixed `14pt sans-serif` font and then applied `ctx.scale(size, size)`, so
// its `size` was a dimensionless MULTIPLIER, not a pixel height -- and its MIN_TEXT_SIZE = 0.5 was a
// multiplier too. 14pt is 14 * 96/72 px. Reading `size` as pixels makes every glyph sub-pixel and
// silently drops all the text, which is exactly what happened on the first attempt at this port.
export const LEGACY_BASE_FONT_PX = (14 * 96) / 72;

const scratch = [0, 0];
const arc = new Arc();

// Projected-vertex scratch, grown on demand and reused for every path in every frame.
//
// This used to be `new Float64Array(n)` twice per path. On the Escher scene that is 77,280 typed
// arrays per frame, and it showed up exactly where you would expect: a median frame of 63 ms with a
// p95 of 261 ms, the tail being garbage collection. The buffers are module-scope because drawPath is
// never re-entered -- it does not call back into the renderer.
let vertX = new Float64Array(1024);
let vertY = new Float64Array(1024);
function ensureVertexCapacity(n) {
  if (n <= vertX.length) return;
  let cap = vertX.length;
  while (cap < n) cap *= 2;
  vertX = new Float64Array(cap);
  vertY = new Float64Array(cap);
}

export class RenderStats {
  constructor() {
    this.reset();
  }
  reset() {
    this.drawables = 0;
    this.survivors = 0;
    this.drawn = 0;
    this.pointsProjected = 0;
    this.canvasCalls = 0;
    this.textDrawn = 0;
    this.textSkipped = 0;
    this.subPixelSkipped = 0;
    this.verticesDecimated = 0;
  }
}

// Culling modes.
//   "endpoints" reproduces the 2011 test: keep an edge only if one of its two projected endpoints
//               is inside the draw radius. This WRONGLY DROPS long edges that cross the visible
//               region without either endpoint inside it, and it also runs after all the projection
//               work, so it saves nothing. Kept so the defect can be seen and compared.
//   "cap"       rejects a whole drawable up front with a 6-multiply Minkowski test against its
//               precomputed bounding cap. Correct, and far cheaper.
export const CULL_ENDPOINTS = "endpoints";
export const CULL_CAP = "cap";

export class Renderer {
  constructor() {
    this.stats = new RenderStats();
  }

  // `view` is the read-only geometry descriptor built by the surface:
  //   { cx, cy, radius, zoom, rotation, width, height, drawRadius, interactRadius, matrix, ... }
  // `passes` is an array of { drawables, matrix }: one entry per source, each with the matrix its
  // coordinates should be drawn with.
  draw(ctx, view, passes, options) {
    const stats = this.stats;
    stats.reset();
    // Forget any cached canvas state: the background, rim, layers and user hooks below all set
    // styles on this same context, and a caller may have touched it between frames too.
    this.forgetCanvasState();

    const {
      background = "#ffffff",
      pageBackground = null,
      rimFill = "#f5d6ab",
      rimStroke = "#000000",
      rimLineWidth = 1.5,
      layers = [],
      onBeforeDraw = null,
      onAfterDraw = null,
      onDrawBackground = null,
      onDrawRim = null,
      cullMode = CULL_CAP,
      arcMode = "sagitta",
      sagittaTolerancePx = 0.25,
      minTextPx = 3,
      minFeaturePx = 0,
      decimateTolerancePx = 0,
    } = options || {};

    ctx.clearRect(0, 0, view.width, view.height);

    if (pageBackground) {
      ctx.fillStyle = pageBackground;
      ctx.fillRect(0, 0, view.width, view.height);
    }

    for (const layer of layers) if ((layer.z || 0) < 0) layer.draw(ctx, view);
    if (onBeforeDraw) onBeforeDraw(ctx, view);

    // The disk interior. Opaque, which is what confines the "outside" layers to the outside.
    if (onDrawBackground) {
      onDrawBackground(ctx, view);
    } else if (background && background !== "none") {
      ctx.fillStyle = background;
      ctx.beginPath();
      ctx.arc(view.cx, view.cy, view.radius, 0, 2 * Math.PI);
      ctx.fill();
    }

    if (passes && passes.length) {
      for (const pass of passes) {
        // A pass may carry a clip region: that is how atlas tiles abut without overlapping. Each is
        // a closure that traces the tile boundary and calls ctx.clip(), so the renderer stays
        // ignorant of tiling shapes (geodesic polygons vs. horocyclic cells).
        if (pass.clip) {
          ctx.save();
          pass.clip(ctx, view);
        }
        this.drawContent(ctx, view, pass.drawables, pass.matrix, {
          cullMode,
          arcMode,
          sagittaTolerancePx,
          minTextPx,
          minFeaturePx,
          decimateTolerancePx,
        });
        if (pass.clip) ctx.restore();
      }
    }

    // The rim annulus. Its inner edge is the INTERACTION radius, because that ring is what the user
    // drags to rotate -- drawing it there is what makes the affordance visible. It is painted after
    // the content, so it also masks anything drawn beyond it.
    if (onDrawRim) {
      onDrawRim(ctx, view);
    } else {
      const inner = view.interactRadius * view.radius;
      if (rimFill && rimFill !== "none") {
        ctx.fillStyle = rimFill;
        ctx.beginPath();
        ctx.arc(view.cx, view.cy, view.radius, 0, 2 * Math.PI);
        ctx.arc(view.cx, view.cy, inner, 2 * Math.PI, 0, true);
        ctx.fill();
      }
      if (rimStroke && rimStroke !== "none") {
        ctx.strokeStyle = rimStroke;
        ctx.lineWidth = rimLineWidth;
        ctx.beginPath();
        ctx.arc(view.cx, view.cy, view.radius, 0, 2 * Math.PI);
        ctx.stroke();
        if (view.interactRadius < 1) {
          ctx.beginPath();
          ctx.arc(view.cx, view.cy, inner, 0, 2 * Math.PI);
          ctx.stroke();
        }
      }
    }

    for (const layer of layers) if ((layer.z || 0) >= 0) layer.draw(ctx, view);
    if (onAfterDraw) onAfterDraw(ctx, view);
  }

  // The per-drawable style cache is only valid while nothing else writes to the context, so every
  // path that does must clear it. Cheaper to be blunt about this than to reason case by case: a
  // stale cache means a shape silently painted in the previous shape's colour.
  forgetCanvasState() {
    this.lastFill = null;
    this.lastStroke = null;
    this.lastLineWidth = null;
    this.lastLineCap = null;
    this.lastLineJoin = null;
    this.lastMiterLimit = null;
  }

  drawContent(ctx, view, scene, matrix, opts) {
    // Each pass may be wrapped in save()/clip()/restore() by the caller, which restores canvas state
    // wholesale, so the cache cannot survive a pass boundary either.
    this.forgetCanvasState();

    const stats = this.stats;
    const m = matrix || view.matrix;
    const scale = view.radius;
    const shiftX = view.cx;
    const shiftY = view.cy;
    const drawRadius = view.drawRadius;
    const drawRadius2 = drawRadius * drawRadius;

    // Everything the cap test needs, computed once per frame.
    const centre = m.centreLocal([0, 0]);
    const cX = centre[0];
    const cY = centre[1];
    const cW = Math.sqrt(1 + cX * cX + cY * cY);
    const inDiskThreshold2 = screenRadiusToThresholdSquared(Math.min(drawRadius, 0.999999));
    const capCache = new Map();

    const minFeaturePx = opts.minFeaturePx || 0;
    const straightIfShorterThan = opts.arcMode === "fixed" ? LEGACY_MAX_STRAIGHT_LINE_LENGTH : 0;
    // The sagitta tolerance is given in pixels; convert to disk units for this frame's zoom.
    const sagittaTolerance = opts.arcMode === "fixed" ? 0 : opts.sagittaTolerancePx / scale;

    stats.drawables += scene.length;

    for (let di = 0; di < scene.length; di++) {
      const d = scene[di];

      if (opts.cullMode === CULL_CAP) {
        let thr = capCache.get(d.cap.radius);
        if (thr === undefined) {
          thr = capThreshold(Math.min(drawRadius, 0.999999), d.cap.radius);
          capCache.set(d.cap.radius, thr);
        }
        // cosh(d/2)^2 between the view centre and this drawable's bounding cap -- the same quantity
        // the visibility test needs, so compute it once and use it twice.
        const cap = d.cap;
        const A = cap.w * cW - cap.x * cX - cap.y * cY;
        const B = cap.x * cY - cap.y * cX;
        const ch2 = A * A + B * B;
        if (ch2 > thr * thr) continue;

        // Sub-pixel gate. In the Poincare disk the Euclidean and hyperbolic metrics differ by
        // (1 - |z|^2)/2, and |z| = tanh(d/2) gives 1 - |z|^2 = 1/cosh^2(d/2) = 1/ch2 -- so the cap's
        // on-screen DIAMETER is capRadius * scale / ch2, with no extra projection whatsoever.
        //
        // This matters far more in the hyperbolic plane than it would on a map: measured on the
        // Escher scene at its default view, 59% of the 38,640 shapes project to under one pixel, and
        // they carry 45% of all vertices. They are crushed against the rim where the projection
        // compresses infinite area into a finite ring.
        //
        // The STROKE has to be counted, not just the geometry. A shape 0.3 px across drawn with a
        // 2 px stroke still paints a 2 px mark, so a gate on the fill's size alone erases marks that
        // are plainly visible. Measured before this was added: at a panned view, 0.17% of colour
        // channels changed, some by a full 255, while a control comparing two identical renders
        // differed by exactly nothing -- so those were real losses, not rasterizer noise.
        //
        // Default 0, i.e. off. The viewport raises it only while a gesture is in flight.
        if (minFeaturePx > 0) {
          const st = d.style;
          const inkPx =
            (cap.radius * scale) / ch2 + (st.stroke && st.stroke !== "none" ? st.lineWidth : 0);
          if (inkPx < minFeaturePx) {
            stats.subPixelSkipped++;
            continue;
          }
        }
      }
      stats.survivors++;

      if (d.kind === "path") this.drawPath(ctx, d, m, scale, shiftX, shiftY, drawRadius2, straightIfShorterThan, sagittaTolerance, opts, inDiskThreshold2, cX, cY, cW);
      else if (d.kind === "text") this.drawText(ctx, d, m, scale, shiftX, shiftY, opts);
      else if (d.kind === "marker") this.drawMarker(ctx, d, m, scale, shiftX, shiftY);
    }
  }

  drawPath(ctx, d, m, scale, shiftX, shiftY, drawRadius2, straightIfShorterThan, sagittaTolerance, opts, inDiskThreshold2, cX, cY, cW) {
    const stats = this.stats;
    const decimate = opts.decimateTolerancePx || 0;
    const decimate2 = decimate * decimate;
    const n = d.xs.length;
    if (n < 2) return;

    // Project every vertex exactly once. The 2011 code projected each vertex twice -- once as the
    // start of its own edge and once as the end of the previous one.
    ensureVertexCapacity(n);
    const px = vertX;
    const py = vertY;
    let anyInside = false;
    for (let i = 0; i < n; i++) {
      m.applyToLocal(d.xs[i], d.ys[i], d.ws[i], scratch);
      px[i] = scratch[0];
      py[i] = scratch[1];
      if (px[i] * px[i] + py[i] * py[i] < drawRadius2) anyInside = true;
    }
    stats.pointsProjected += n;

    if (opts.cullMode === CULL_ENDPOINTS && !anyInside) return;
    stats.drawn++;

    const style = d.style;
    const last = d.closed ? n : n - 1;

    // Build the fill path (all edges, closed) and the stroke path (only flagged edges).
    const doFill = style.fill && style.fill !== "none";
    const doStroke = style.stroke && style.stroke !== "none";

    if (doFill) {
      ctx.beginPath();
      ctx.moveTo(px[0] * scale + shiftX, -py[0] * scale + shiftY);
      // Decimate: drop a vertex that lands within `decimate` pixels of the last one actually emitted.
      //
      // In the hyperbolic plane this is not a marginal saving. The projection crushes unbounded area
      // into the rim, so most shapes arrive tiny: measured on the Escher scene at its default view,
      // 59% of edges are shorter than half a pixel and 39% shorter than a quarter. Each one costs a
      // JS-to-C++ lineTo, and there are 264,000 of them per frame, which is why 57% of the frame is
      // spent inside the rasterizer rather than in our own code.
      //
      // The last vertex is always emitted, so the outline still closes exactly where it should, and
      // the tolerance is compared against the last EMITTED point rather than the previous vertex so
      // that a long run of small steps cannot accumulate into a visible drift.
      let ex = px[0] * scale;
      let ey = py[0] * scale;
      for (let i = 0; i < last; i++) {
        const j = (i + 1) % n;
        if (decimate > 0 && i < last - 1) {
          const dx = px[j] * scale - ex;
          const dy = py[j] * scale - ey;
          if (dx * dx + dy * dy < decimate2) {
            stats.verticesDecimated++;
            continue;
          }
        }
        this.edgeTo(ctx, px[i], py[i], px[j], py[j], scale, shiftX, shiftY, straightIfShorterThan, sagittaTolerance);
        ex = px[j] * scale;
        ey = py[j] * scale;
      }
      ctx.closePath();
      // Assigning a canvas style property is not free in Chrome even when the value is unchanged --
      // it re-parses the CSS colour string. Styles are interned at compile time and the data is
      // depth-sorted, so consecutive drawables very often share one, and skipping the redundant
      // assignment is measurable on scenes with tens of thousands of shapes.
      if (this.lastFill !== style.fill) {
        ctx.fillStyle = style.fill;
        this.lastFill = style.fill;
      }
      // No save()/clip()/restore() here. The 2011 code built this path, clipped to it, rebuilt the
      // identical path, and filled -- but fill INTERSECT clip == fill, so the clip was a no-op and
      // the path was constructed twice.
      ctx.fill();
      stats.canvasCalls++;
    }

    if (doStroke) {
      ctx.beginPath();
      let penAt = -1;
      let sx0 = 0;
      let sy0 = 0;
      for (let i = 0; i < last; i++) {
        if (!(d.flags[i] & FLAG_STROKE)) continue;
        const j = (i + 1) % n;
        if (penAt !== i) {
          ctx.moveTo(px[i] * scale + shiftX, -py[i] * scale + shiftY);
          sx0 = px[i] * scale;
          sy0 = py[i] * scale;
        } else if (decimate > 0 && i < last - 1 && (d.flags[j] & FLAG_STROKE)) {
          // Only decimate INSIDE a run of stroked edges, and never the run's last edge: dropping the
          // vertex where a run ends would move the end of a visible line.
          const dx = px[j] * scale - sx0;
          const dy = py[j] * scale - sy0;
          if (dx * dx + dy * dy < decimate2) {
            stats.verticesDecimated++;
            penAt = j;
            continue;
          }
        }
        this.edgeTo(ctx, px[i], py[i], px[j], py[j], scale, shiftX, shiftY, straightIfShorterThan, sagittaTolerance);
        sx0 = px[j] * scale;
        sy0 = py[j] * scale;
        penAt = j;
      }
      if (this.lastStroke !== style.stroke) {
        ctx.strokeStyle = style.stroke;
        this.lastStroke = style.stroke;
      }
      if (this.lastLineWidth !== style.lineWidth) {
        ctx.lineWidth = style.lineWidth;
        this.lastLineWidth = style.lineWidth;
      }
      if (this.lastLineCap !== style.lineCap) {
        ctx.lineCap = style.lineCap;
        this.lastLineCap = style.lineCap;
      }
      if (this.lastLineJoin !== style.lineJoin) {
        ctx.lineJoin = style.lineJoin;
        this.lastLineJoin = style.lineJoin;
      }
      if (this.lastMiterLimit !== style.miterLimit) {
        ctx.miterLimit = style.miterLimit;
        this.lastMiterLimit = style.miterLimit;
      }
      ctx.stroke();
      stats.canvasCalls++;
    }

    // Vertex markers.
    let hasMarker = false;
    for (let i = 0; i < n; i++) if (d.flags[i] & FLAG_MARKER) { hasMarker = true; break; }
    if (hasMarker) {
      this.lastFill = null;
      // The 2011 code read the marker radius out of the FILL COLOUR field, giving ctx.arc a string
      // radius, hence NaN, hence no markers at all. None of the four shipped datasets uses marker
      // flags, so it was unobservable there -- but it is fixed here rather than reproduced.
      ctx.fillStyle = style.markerFill;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (!(d.flags[i] & FLAG_MARKER)) continue;
        const sx = px[i] * scale + shiftX;
        const sy = -py[i] * scale + shiftY;
        ctx.moveTo(sx + style.markerRadius, sy);
        ctx.arc(sx, sy, style.markerRadius, 0, 2 * Math.PI);
      }
      ctx.fill();
      stats.canvasCalls++;
    }
  }

  edgeTo(ctx, x1, y1, x2, y2, scale, shiftX, shiftY, straightIfShorterThan, sagittaTolerance) {
    geodesicArc(x1, y1, x2, y2, arc, straightIfShorterThan, sagittaTolerance);
    if (arc.straight) {
      ctx.lineTo(x2 * scale + shiftX, -y2 * scale + shiftY);
    } else {
      // Canvas y points down, so a mathematical angle theta becomes -theta and the sweep sense
      // flips with it.
      ctx.arc(
        arc.cx * scale + shiftX,
        -arc.cy * scale + shiftY,
        arc.r * scale,
        -arc.startAngle,
        -arc.endAngle,
        arc.anticlockwise,
      );
    }
  }

  drawText(ctx, d, m, scale, shiftX, shiftY, opts) {
    const stats = this.stats;
    m.applyToLocal(d.xs[0], d.ys[0], d.ws[0], scratch);
    const ax = scratch[0];
    const ay = scratch[1];
    m.applyToLocal(d.xs[1], d.ys[1], d.ws[1], scratch);
    const ux = scratch[0];
    const uy = scratch[1];
    stats.pointsProjected += 2;

    // The up-vector's projected length sets the size, so text shrinks with the hyperbolic
    // foreshortening exactly like the geometry around it.
    const sizePx = scale * FONT_SCALE * Math.hypot(ux - ax, uy - ay) * LEGACY_BASE_FONT_PX;
    if (!(sizePx > opts.minTextPx)) {
      stats.textSkipped++;
      return;
    }

    ctx.save();
    ctx.fillStyle = d.style.fill && d.style.fill !== "none" ? d.style.fill : "#000000";
    this.lastFill = null;
    ctx.textAlign = d.style.align;
    ctx.textBaseline = d.style.baseline;
    // A real font size, not ctx.scale() on a fixed 14pt font: scaling also scales stroke widths and
    // defeats font hinting.
    ctx.font = `${sizePx}px ${d.style.font}`;
    ctx.translate(ax * scale + shiftX, -ay * scale + shiftY);
    ctx.rotate(-Math.atan2(uy - ay, ux - ax) + Math.PI / 2);
    ctx.fillText(d.text, 0, 0);
    ctx.restore();
    stats.textDrawn++;
    stats.canvasCalls++;
  }

  drawMarker(ctx, d, m, scale, shiftX, shiftY) {
    m.applyToLocal(d.xs[0], d.ys[0], d.ws[0], scratch);
    this.stats.pointsProjected++;
    ctx.fillStyle = d.style.markerFill;
    this.lastFill = null;
    ctx.beginPath();
    ctx.arc(scratch[0] * scale + shiftX, -scratch[1] * scale + shiftY, d.style.markerRadius, 0, 2 * Math.PI);
    ctx.fill();
    this.stats.canvasCalls++;
  }
}
