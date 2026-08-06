// HyperbolicViewport -- the public widget.
//
// Everything outside the Poincare disk is the page's business, not the library's. The library draws
// the disk fill and the rim annulus; anything else (a world-turtle behind the disk, a star field,
// a compass rose on top) goes through `layers` or the `onBeforeDraw`/`onAfterDraw` hooks. That is
// why the 2011 `backgroundImage`, `shellImage` and `shellImageScale` options are gone: they baked
// one example's art into the library.

import { Isom } from "./core/isom.js";
import { ViewState, ROTATION_PARALLEL_TRANSPORT } from "./core/view.js";
import { Surface } from "./render/surface.js";
import { Renderer, CULL_CAP } from "./render/renderer.js";
import { PointerInput } from "./input/pointer.js";
import { StaticSource, CallbackSource } from "./data/source.js";
import { DEFAULT_STYLE } from "./data/drawable.js";
import { Atlas } from "./data/atlas/atlas.js";

export const DEFAULT_OPTIONS = {
  container: null,
  canvas: null,
  width: null,
  height: null,
  autoResize: false,
  devicePixelRatio: "auto",
  radiusBasis: "min",

  data: null,
  dataProvider: null,
  atlas: null,
  styles: null,

  center: null,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  zoom: 0.95,
  minZoom: 0.5,
  maxZoom: null,

  interactive: true,
  allowPan: true,
  allowZoom: true,
  allowRotate: true,
  rimRotate: true,
  panClamp: true,
  wheelZoom: true,
  wheelZoomStep: 1.1,
  rotationMode: ROTATION_PARALLEL_TRANSPORT,
  compassTarget: [0, 1],

  interactRadius: 0.9,
  drawRadius: 1.0,

  background: "#ffffff",
  pageBackground: null,
  rimFill: "#f5d6ab",
  rimStroke: "#000000",
  rimLineWidth: 1.5,

  cullMode: CULL_CAP,
  arcMode: "sagitta",
  sagittaTolerancePx: 0.25,
  minTextPx: 3,

  layers: null,
  onBeforeDraw: null,
  onAfterDraw: null,
  onDrawBackground: null,
  onDrawRim: null,
  onViewChange: null,
  onGestureStart: null,
  onGestureEnd: null,
  onFrame: null,
};

// The 2011 option names, mapped to their replacements. Accepted with a one-time warning so the
// original example pages keep working.
const LEGACY_ALIASES = {
  initialOffsetX: "offsetX",
  initialOffsetY: "offsetY",
  initialRotation: "rotation",
  initialZoom: "zoom",
  viewThreshold: "interactRadius",
  downloadThreshold: null, // superseded by the source's own gating
  zoomMouseWheel: "wheelZoomStep",
  backgroundColor: "background",
  rimFillStyle: "rimFill",
  rimStrokeStyle: "rimStroke",
  backgroundImage: null, // now a layer; see docs/demo/layers.js
  shellImage: null,
  shellImageScale: null,
};

let warnedLegacy = false;

function normaliseOptions(userOptions) {
  const opts = Object.assign({}, DEFAULT_OPTIONS);
  const unknown = [];
  for (const key of Object.keys(userOptions || {})) {
    if (key in DEFAULT_OPTIONS) {
      opts[key] = userOptions[key];
    } else if (key in LEGACY_ALIASES) {
      const target = LEGACY_ALIASES[key];
      if (!warnedLegacy && typeof console !== "undefined") {
        warnedLegacy = true;
        console.warn(
          "hyperbolic-map: 2011 option names are deprecated. See the alias table in README.md.",
        );
      }
      if (target) opts[target] = userOptions[key];
    } else {
      unknown.push(key);
    }
  }
  // Typos in option names are a common and silent source of "why is this not working", so they are
  // an error rather than being ignored.
  if (unknown.length) {
    throw new Error(`hyperbolic-map: unknown option(s): ${unknown.join(", ")}`);
  }
  return opts;
}

export class HyperbolicViewport {
  constructor(userOptions) {
    const opts = normaliseOptions(userOptions);
    this.options = opts;

    this.styleSheet = Object.assign({ default: Object.assign({}, DEFAULT_STYLE) }, opts.styles || {});

    this.surface = new Surface(opts);
    this.renderer = new Renderer();

    let offsetX = opts.offsetX;
    let offsetY = opts.offsetY;
    if (opts.center) {
      offsetX = -opts.center[0];
      offsetY = -opts.center[1];
    }
    this.view = new ViewState({
      offsetX: offsetX,
      offsetY: offsetY,
      rotation: opts.rotation,
      zoom: opts.zoom,
      minZoom: opts.minZoom,
      maxZoom: opts.maxZoom,
      rotationMode: opts.rotationMode,
      compassTargetX: opts.compassTarget[0],
      compassTargetY: opts.compassTarget[1],
    });

    // Named sources, drawn in insertion order. Each may carry its own extra isometry, which is how
    // the clock demo rotates its hands in O(1) per tick instead of rebuilding every drawable.
    this.sources = new Map();
    if (opts.dataProvider) {
      this.sources.set("default", {
        source: new CallbackSource(opts.dataProvider, {
          styleSheet: this.styleSheet,
          onLoad: () => this.invalidate(),
        }),
        transform: null,
      });
    } else {
      this.sources.set("default", {
        source: new StaticSource(opts.data || [], this.styleSheet),
        transform: null,
      });
    }

    // The atlas, if configured, contributes one render pass per visible tile.
    this.atlas = null;
    if (opts.atlas) {
      this.atlas = new Atlas(
        Object.assign({ styleSheet: this.styleSheet }, opts.atlas),
      );
    }

    this.layers = (opts.layers || []).slice().sort((a, b) => (a.z || 0) - (b.z || 0));
    for (const layer of this.layers) if (layer.attach) layer.attach(this);

    this.frameHandle = null;
    this.destroyed = false;
    this.stats = this.renderer.stats;

    this.input = new PointerInput(
      {
        element: this.surface.canvas,
        window: typeof window !== "undefined" ? window : null,
        document: typeof document !== "undefined" ? document : null,
        toDisk: (e, zoom) => this.surface.eventToDisk(e, zoom),
      },
      this.view,
      opts,
      {
        onChange: () => {
          this.invalidate();
          if (opts.onViewChange) opts.onViewChange(this.getView());
        },
        onGestureStart: (mode) => opts.onGestureStart && opts.onGestureStart(mode),
        onGestureEnd: () => {
          // The throttle can swallow the last movement of a drag, leaving the frame the user
          // actually stopped on showing data fetched for an earlier position. Always ask again on
          // gesture end so the final view is never stale.
          this.refreshSources();
          if (opts.onGestureEnd) opts.onGestureEnd(this.getView());
        },
      },
    );

    this.surface.observe(() => this.invalidate());
    this.render();
  }

  // Request a redraw, coalesced to one per animation frame. Input handlers only mutate state and
  // call this; the 2011 code redrew synchronously per mousemove, which on a 120 Hz mouse meant 120
  // full redraws a second.
  invalidate() {
    if (this.destroyed || this.frameHandle !== null) return;
    const raf = typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
    this.frameHandle = raf(() => {
      this.frameHandle = null;
      this.render();
    });
  }

  render() {
    if (this.destroyed) return;
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const view = this.surface.buildView(this.view, this.options);
    // One entry per source: its drawables plus the matrix to draw them with. A source transform is
    // composed on the right, so its drawables' coordinates stay in their own frame.
    const passes = [];
    for (const entry of this.sources.values()) {
      const drawables = entry.source.get(view);
      if (!drawables || drawables.length === 0) continue;
      passes.push({
        drawables: drawables,
        matrix: entry.transform ? view.matrix.mul(entry.transform) : view.matrix,
      });
    }
    if (this.atlas) {
      for (const p of this.atlas.passes(view, () => this.invalidate())) passes.push(p);
    }
    this.renderer.draw(this.surface.context, view, passes, {
      background: this.options.background,
      pageBackground: this.options.pageBackground,
      rimFill: this.options.rimFill,
      rimStroke: this.options.rimStroke,
      rimLineWidth: this.options.rimLineWidth,
      layers: this.layers,
      onBeforeDraw: this.options.onBeforeDraw,
      onAfterDraw: this.options.onAfterDraw,
      onDrawBackground: this.options.onDrawBackground,
      onDrawRim: this.options.onDrawRim,
      cullMode: this.options.cullMode,
      arcMode: this.options.arcMode,
      sagittaTolerancePx: this.options.sagittaTolerancePx,
      minTextPx: this.options.minTextPx,
    });
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    this.stats.frameMs = t1 - t0;
    if (this.options.onFrame) this.options.onFrame(this.stats);
  }

  // ---- public API ----

  // Force every async source to re-request for the current view, bypassing the throttle and the
  // significance gate.
  refreshSources() {
    if (this.destroyed) return;
    const view = this.surface.buildView(this.view, this.options);
    for (const entry of this.sources.values()) {
      if (entry.source.refresh) entry.source.refresh(view);
    }
    this.invalidate();
  }

  getView() {
    return {
      center: this.view.liveMatrix.centreLocal([0, 0]),
      zoom: this.view.liveZoom,
      rotation: this.view.liveMatrix.screenRotation(),
      bearing: this.view.north(),
      interacting: !!this.view.gesture,
    };
  }

  getMatrix() {
    return this.view.liveMatrix.clone();
  }

  setMatrix(isom) {
    this.view.matrix = isom.clone().normalize();
    this.view.liveMatrix = this.view.matrix.clone();
    this.invalidate();
  }

  setZoom(z) {
    this.view.setZoom(z);
    this.invalidate();
  }

  setRotation(theta) {
    const current = this.view.matrix.screenRotation();
    this.view.matrix = Isom.rotation(theta - current).mul(this.view.matrix).normalize();
    this.view.liveMatrix = this.view.matrix.clone();
    this.invalidate();
  }

  // Put the given local point at the centre of the view.
  panTo(x, y) {
    this.view.matrix = Isom.translationToLocal(x, y).inverse();
    this.view.liveMatrix = this.view.matrix.clone();
    this.invalidate();
  }

  setData(data, name = "default") {
    const entry = this.sources.get(name);
    if (entry && entry.source instanceof StaticSource) {
      entry.source.setData(data, this.styleSheet);
    } else {
      this.sources.set(name, { source: new StaticSource(data, this.styleSheet), transform: entry ? entry.transform : null });
    }
    this.invalidate();
  }

  addSource(name, data, opts = {}) {
    const source = typeof data === "function"
      ? new CallbackSource(data, { styleSheet: this.styleSheet, onLoad: () => this.invalidate() })
      : new StaticSource(data, this.styleSheet);
    this.sources.set(name, { source: source, transform: opts.transform || null });
    this.invalidate();
    return source;
  }

  removeSource(name) {
    const entry = this.sources.get(name);
    if (entry && entry.source.destroy) entry.source.destroy();
    this.sources.delete(name);
    this.invalidate();
  }

  // Apply an extra isometry to one source without recompiling its drawables. O(1) per change.
  setSourceTransform(name, isom) {
    const entry = this.sources.get(name);
    if (!entry) throw new Error(`hyperbolic-map: no source named "${name}"`);
    entry.transform = isom;
    this.invalidate();
  }

  toScreen(x, y) {
    return this.surface.buildView(this.view, this.options).toScreen(x, y);
  }

  fromScreen(sx, sy) {
    return this.surface.buildView(this.view, this.options).fromScreen(sx, sy);
  }

  resize(w, h) {
    this.surface.resize(w, h);
    this.invalidate();
  }

  destroy() {
    this.destroyed = true;
    if (this.frameHandle !== null) {
      const cancel = typeof cancelAnimationFrame !== "undefined" ? cancelAnimationFrame : clearTimeout;
      cancel(this.frameHandle);
      this.frameHandle = null;
    }
    this.input.destroy();
    for (const entry of this.sources.values()) if (entry.source.destroy) entry.source.destroy();
    for (const layer of this.layers) if (layer.detach) layer.detach();
    this.surface.destroy();
  }
}
