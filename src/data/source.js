// Data sources: the single-patch half of the library's data model.
//
// There are two data models, and they are not two ways of doing one thing:
//
//   SourceSet (here)  data indexed by the VIEW -- "give me what is visible from here". Global
//                     coordinates, fetched with a significance gate and an AbortSignal.
//   Atlas             data indexed by the TILE -- "give me tile k". Tile-local coordinates, cached
//                     per tile.
//
// Both answer questions the other cannot, so both exist. What they share is the far side: each
// produces a list of {drawables, matrix} PASSES for one frame, and one renderer draws them. That
// shared `passes(view)` shape is why HyperbolicViewport.render() is a single loop over pass
// producers rather than a branch on which mode it is in.
//
// A source supplies compiled drawables for the current view. Two flavours:
//
//   StaticSource    a fixed array, compiled once.
//   CallbackSource  an async function of the view, with caching, in-flight de-duplication and
//                   AbortSignal cancellation.
//
// The 2011 client re-fetched only on mouseup/touchend, which is the whole reason distant elements
// appeared only after the drag was released. Here the source is consulted every frame; the throttle
// and the significance gate keep that cheap, and results arrive and render mid-gesture.

import { compileDrawables } from "./drawable.js";

export class StaticSource {
  constructor(data, styleSheet) {
    this.drawables = compileDrawables(data, styleSheet);
    this.transform = null;
  }
  // Same array whatever the view: culling happens in the renderer.
  get(/* view */) {
    return this.drawables;
  }
  setData(data, styleSheet) {
    this.drawables = compileDrawables(data, styleSheet);
  }
}

export class CallbackSource {
  constructor(fn, options = {}) {
    this.fn = fn;
    this.styleSheet = options.styleSheet;
    // Do not ask again until the view centre has moved by this fraction of the visible radius, or
    // the zoom has changed by this fraction. Without a gate, a per-frame source would issue a
    // request every frame of a drag.
    this.moveFraction = options.moveFraction !== undefined ? options.moveFraction : 0.25;
    this.zoomFraction = options.zoomFraction !== undefined ? options.zoomFraction : 0.1;
    this.throttleMs = options.throttleMs !== undefined ? options.throttleMs : 120;

    this.drawables = [];
    this.lastRequest = null; // {cx, cy, cw, zoom}
    this.lastRequestTime = -Infinity;
    this.inFlight = null;
    this.controller = null;
    this.onLoad = options.onLoad || null;
    this.onError = options.onError || null;
  }

  // Has the view changed enough to be worth asking again?
  //
  // The gate is measured ON SCREEN, not in hyperbolic distance. The first version compared the
  // hyperbolic distance moved against 2*artanh(drawRadius) -- but drawRadius is 1.0 by default, and
  // artanh(1) is infinite: the whole hyperbolic plane is inside the disk. That made the threshold
  // about 7.3 hyperbolic units, so a provider was effectively asked exactly ONCE, at construction,
  // and never again however far the user scrolled. Content simply never arrived.
  //
  // What actually matters is whether the previously-requested region has slid off the screen. So:
  // project the previous request's centre under the CURRENT view and see how far it has drifted from
  // the middle, as a fraction of the disk radius. That is bounded, scale-free, and directly
  // meaningful, and it behaves sensibly at every zoom.
  needsRequest(view, now) {
    if (!this.lastRequest) return true;
    if (now - this.lastRequestTime < this.throttleMs) return false;
    const prev = this.lastRequest;
    if (Math.abs(view.zoom - prev.zoom) / prev.zoom > this.zoomFraction) return true;
    const out = view.matrix.applyToLocal(prev.cx, prev.cy, prev.cw, [0, 0]);
    const drift = Math.hypot(out[0], out[1]);
    return drift > this.moveFraction * Math.min(view.drawRadius, view.effectiveRadius || view.drawRadius);
  }

  get(view, now) {
    const t = now === undefined ? (typeof performance !== "undefined" ? performance.now() : Date.now()) : now;
    if (this.needsRequest(view, t)) this.request(view, t);
    return this.drawables;
  }

  // Ask again regardless of the gate. Called when a gesture ends, so the view the user actually
  // stopped on is never left showing throttled-away data: the throttle can otherwise swallow the
  // last movement of a drag and leave the final frame stale until the user moves again.
  refresh(view) {
    const t = typeof performance !== "undefined" ? performance.now() : Date.now();
    this.request(view, t);
  }

  request(view, now) {
    const centre = view.matrix.centreLocal([0, 0]);
    const cw = Math.sqrt(1 + centre[0] ** 2 + centre[1] ** 2);
    this.lastRequest = { cx: centre[0], cy: centre[1], cw: cw, zoom: view.zoom };
    this.lastRequestTime = now;

    // Supersede any request still outstanding.
    if (this.controller) {
      try {
        this.controller.abort();
      } catch (err) {
        /* ignore */
      }
    }
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    this.controller = controller;

    const req = {
      centre: [centre[0], centre[1]],
      zoom: view.zoom,
      drawRadius: view.drawRadius,
      // How much of the disk can actually be on screen at this zoom. At zoom 3 on a square canvas
      // only |z| < 0.47 is visible, so a provider that used drawRadius would fetch ~4x too much.
      visibleRadius: view.effectiveRadius,
      signal: controller ? controller.signal : undefined,
    };

    const p = Promise.resolve()
      .then(() => this.fn(req))
      .then((data) => {
        if (this.controller !== controller) return; // superseded
        this.drawables = compileDrawables(data, this.styleSheet);
        if (this.onLoad) this.onLoad(this.drawables);
      })
      .catch((err) => {
        if (err && (err.name === "AbortError" || err.name === "CanceledError")) return;
        if (this.onError) this.onError(err);
        else if (typeof console !== "undefined") console.error("hyperbolic-map: data source failed", err);
      });
    this.inFlight = p;
    return p;
  }

  destroy() {
    if (this.controller) {
      try {
        this.controller.abort();
      } catch (err) {
        /* ignore */
      }
    }
    this.controller = null;
  }
}

// The named sources of a single-patch viewport, drawn in insertion order.
//
// Each source may carry its own extra isometry, composed on the RIGHT so its drawables stay in their
// own frame -- which is how the clock demo rotates its hands in O(1) per tick instead of rebuilding
// every drawable.
export class SourceSet {
  constructor(options = {}) {
    this.styleSheet = options.styleSheet;
    // Called when an async source resolves, so the viewport can schedule a frame.
    this.onInvalidate = options.onInvalidate || null;
    this.entries = new Map();
  }

  // The pass-producer interface, shared with Atlas. `onReady` is accepted and ignored: a source
  // signals arrival through its own onLoad rather than per frame.
  passes(view /* , onReady */) {
    const out = [];
    for (const entry of this.entries.values()) {
      const drawables = entry.source.get(view);
      if (!drawables || drawables.length === 0) continue;
      out.push({
        drawables: drawables,
        matrix: entry.transform ? view.matrix.mul(entry.transform) : view.matrix,
      });
    }
    return out;
  }

  add(name, data, opts = {}) {
    const source = typeof data === "function"
      ? new CallbackSource(data, {
        styleSheet: this.styleSheet,
        onLoad: () => this.onInvalidate && this.onInvalidate(),
      })
      : new StaticSource(data, this.styleSheet);
    this.entries.set(name, { source: source, transform: opts.transform || null });
    return source;
  }

  remove(name) {
    const entry = this.entries.get(name);
    if (entry && entry.source.destroy) entry.source.destroy();
    this.entries.delete(name);
  }

  has(name) {
    return this.entries.has(name);
  }

  // Replace a static source's data in place where possible, so its transform survives.
  setData(name, data) {
    const entry = this.entries.get(name);
    if (entry && entry.source instanceof StaticSource) {
      entry.source.setData(data, this.styleSheet);
      return;
    }
    this.entries.set(name, {
      source: new StaticSource(data, this.styleSheet),
      transform: entry ? entry.transform : null,
    });
  }

  setTransform(name, isom) {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`hyperbolic-map: no source named "${name}"`);
    entry.transform = isom;
  }

  // Force every async source to re-request, bypassing the throttle and the significance gate.
  refresh(view) {
    for (const entry of this.entries.values()) {
      if (entry.source.refresh) entry.source.refresh(view);
    }
  }

  destroy() {
    for (const entry of this.entries.values()) if (entry.source.destroy) entry.source.destroy();
  }
}
