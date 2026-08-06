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
import { Anchor } from "./data/atlas/anchor.js";

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
  // Start the camera on a given tile ADDRESS, with the initial view expressed in that tile's own
  // frame. Atlas mode only; the way to open far from the origin without forming a global coordinate.
  anchor: null,
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
  // Skip shapes whose projected diameter is below this many pixels. Zero at rest, so a still frame
  // is always drawn in full; `interactMinFeaturePx` applies only while a gesture is in flight, when
  // the rim fringe is moving and its exact density cannot be read anyway. Set both to 0 to disable.
  minFeaturePx: 0,
  interactMinFeaturePx: 0.5,
  // Drop a vertex that projects within this many pixels of the last one emitted. The hyperbolic
  // projection crushes unbounded area into the rim, so most shapes arrive far smaller than a pixel
  // and most of their vertices are redundant at screen resolution.
  decimateTolerancePx: 0.25,
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

// Exported for tests: option validation is pure, so it can be checked without a DOM.
export function normaliseOptionsForTesting(userOptions) {
  return normaliseOptions(userOptions);
}

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

  // An atlas and an ordinary data source cannot coexist. Refused here rather than drawn wrong.
  //
  // In atlas mode `view.matrix` is the view expressed in the CAMERA TILE's frame. An ordinary source's
  // coordinates are global, so drawing them with that matrix misplaces them as soon as the camera leaves
  // the origin tile -- measured, a point at the global origin lands 0.93 disk units away, most of the
  // way across the disk, after sixty small pans. Drawing them correctly would mean composing the
  // camera's global frame, which is exactly the ill-conditioned product this design exists to avoid.
  //
  // Nothing is lost: `layers` covers anything that belongs in screen space (a compass rose, the turtle
  // in the dungeon demo) and the atlas `tileData` callback covers anything that belongs to a tile.
  if (opts.atlas) {
    const d = opts.data;
    const hasOwnData =
      opts.dataProvider ||
      (Array.isArray(d) && d.length > 0) ||
      (d && Array.isArray(d.drawables) && d.drawables.length > 0);
    if (hasOwnData) {
      throw new Error(
        "hyperbolic-map: `atlas` cannot be combined with `data` or `dataProvider`. An atlas view is " +
          "anchored to a tile, so global coordinates have no fixed meaning in it. Put per-tile content " +
          "in the atlas `tileData` callback, and screen-space overlays in `layers`.",
      );
    }
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
      // `anchor` starts the camera on a given tile, with the initial view expressed in THAT tile's
      // frame. This is how a demo opens somewhere far from the origin without ever forming a global
      // coordinate for it -- contrast `center`, which is a global local-coordinate pair and therefore
      // only usable near the origin.
      if (opts.anchor !== undefined && opts.anchor !== null) {
        this.atlas.anchor.address = opts.anchor;
      }
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
          // Re-anchor on every view CHANGE, not only when a frame is drawn.
          //
          // "V_c stays O(1)" has to be an invariant of the view state, not something a render happens
          // to restore. Renders are rAF-coalesced and rAF can be throttled to about 1 Hz in a
          // backgrounded tab -- and then a drag accumulates dozens of tiles of motion with no
          // re-anchoring at all. Measured with rendering throttled: max|V| reached 8.9e+74 and the disk
          // went empty, which is exactly the failure this whole design removes, reintroduced through
          // the scheduler. Re-anchoring is a handful of flops, so doing it per input event is free.
          this.reanchorCamera();
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

  // Keep the camera anchored to a tile near the view centre.
  //
  // This is what bounds the view matrix. `reanchor` returns a RIGHT factor, applied to BOTH the
  // committed and the live matrix: `updatePan` builds the live matrix by left-multiplying the
  // committed one, so a common right factor is exactly consistent and a gesture in flight keeps its
  // grabbed point pinned. Without this the matrix grows like cosh(d/2) and by 500 tiles out would need
  // entries of order 1e165.
  reanchorCamera() {
    if (!this.atlas) return;
    const { steps, shift } = this.atlas.anchor.reanchor(this.view.liveMatrix);
    if (steps === 0) return;
    // Not just the matrices: a pinch's grabbed points and the compass target live in the frame's domain
    // and have to be pulled back through the shift too. See ViewState.rebase.
    this.view.rebase(shift);
  }

  render() {
    if (this.destroyed) return;
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    this.reanchorCamera();
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
      decimateTolerancePx: this.options.decimateTolerancePx,
      // Quality snaps back the moment the gesture ends, so what the user studies is always the full
      // scene; only the frames they are actively dragging through are simplified.
      minFeaturePx: this.view.gesture
        ? this.options.interactMinFeaturePx
        : this.options.minFeaturePx,
      minTextPx: this.options.minTextPx,
    });
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    this.stats.frameMs = t1 - t0;
    // How far the view centre has travelled from the data origin, in hyperbolic units. Exposed
    // because it is the single number that predicts precision trouble: a float64 SU(1,1) matrix has
    // entries of order cosh(d/2), so by d ~ 37 the entries reach 1e8, |a|^2 reaches 1e16, and one
    // ULP of that is larger than the spacing between adjacent tiles. Past there the tiling walk can
    // no longer tell distinct tiles apart and the picture starts to depend on the route taken.
    // See notes/open-questions.md for the floating-origin design that would remove the limit.
    if (this.atlas) {
      // In atlas mode the view matrix is camera-relative, so its "distance" is a local quantity of
      // order the visible radius -- not the distance travelled, which is now unbounded and is carried
      // by the ADDRESS instead. `maxViewEntry` is the number that demonstrates the design: it must
      // stay O(1) however far the camera goes.
      this.stats.anchorAddress = this.atlas.tiling.addressToString(this.atlas.anchor.address);
      this.stats.maxViewEntry = Anchor.maxEntry(this.view.liveMatrix);
      this.stats.reanchorCount = this.atlas.anchor.reanchorCount;
      this.stats.viewDistance = this.view.liveMatrix.distanceMoved();
    } else {
      this.stats.viewDistance = this.view.liveMatrix.distanceMoved();
    }
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
    this.assertGlobalCoordinatesUsable("getView");
    return {
      center: this.view.liveMatrix.centreLocal([0, 0]),
      zoom: this.view.liveZoom,
      rotation: this.view.liveMatrix.screenRotation(),
      bearing: this.view.north(),
      interacting: !!this.view.gesture,
    };
  }

  // ---- the anchored camera API ----
  //
  // These are the atlas-aware accessors. They are NEW NAMES on purpose: `getMatrix`/`setMatrix`/
  // `panTo`/`getView` keep exactly the meaning they always had (global coordinates), so no existing
  // caller silently changes behaviour. Instead those four throw once the camera has left the origin
  // tile, where a global coordinate can no longer be represented -- a loud failure rather than a
  // plausible wrong number.

  // The complete view: which tile the camera is anchored to, plus the view within that tile's frame.
  getCamera() {
    return {
      address: this.atlas ? this.atlas.anchor.address : null,
      matrix: this.view.liveMatrix.clone(),
      zoom: this.view.liveZoom,
    };
  }

  // Restore a view captured by getCamera(). Exact round trip.
  setCamera(camera) {
    if (this.atlas && camera.address !== undefined && camera.address !== null) {
      this.atlas.anchor.address = camera.address;
    }
    this.view.matrix = camera.matrix.clone().normalize();
    this.view.liveMatrix = this.view.matrix.clone();
    if (camera.zoom !== undefined) this.view.setZoom(camera.zoom);
    this.view.gesture = null;
    this.reanchorCamera();
    this.invalidate();
  }

  // Put a given TILE-LOCAL point of a given tile at the centre of the view. The atlas-mode equivalent
  // of panTo, and the only form that stays meaningful arbitrarily far out.
  panToTile(address, local = [0, 0]) {
    if (!this.atlas) throw new Error("hyperbolic-map: panToTile() requires an atlas; use panTo() instead");
    this.atlas.anchor.address = address;
    this.view.matrix = Isom.translationToLocal(local[0], local[1]).inverse();
    this.view.liveMatrix = this.view.matrix.clone();
    this.view.gesture = null;
    this.invalidate();
  }

  // Global-coordinate accessors are only meaningful while the camera is anchored to the origin tile.
  // Past that there is no numerically representable global frame, which is the whole reason the atlas
  // is anchored -- so refuse rather than mislead.
  assertGlobalCoordinatesUsable(fn) {
    if (this.atlas && !this.atlas.anchor.atOrigin()) {
      const at = this.atlas.tiling.addressToString(this.atlas.anchor.address);
      throw new Error(
        `hyperbolic-map: ${fn}() is defined in GLOBAL coordinates, but the camera is anchored to tile ` +
          `${at}, where a global frame has entries far too large to represent. Its meaning is ` +
          `unchanged and it still works while anchored to the origin tile. Use getCamera(), ` +
          `setCamera() or panToTile() instead.`,
      );
    }
  }

  getMatrix() {
    this.assertGlobalCoordinatesUsable("getMatrix");
    return this.view.liveMatrix.clone();
  }

  setMatrix(isom) {
    this.assertGlobalCoordinatesUsable("setMatrix");
    this.view.matrix = isom.clone().normalize();
    this.view.liveMatrix = this.view.matrix.clone();
    this.invalidate();
  }

  setZoom(z) {
    this.view.setZoom(z);
    this.reanchorCamera();
    this.invalidate();
  }

  setRotation(theta) {
    const current = this.view.matrix.screenRotation();
    this.view.matrix = Isom.rotation(theta - current).mul(this.view.matrix).normalize();
    this.view.liveMatrix = this.view.matrix.clone();
    this.reanchorCamera();
    this.invalidate();
  }

  // Put the given local point at the centre of the view. GLOBAL local coordinates -- see
  // assertGlobalCoordinatesUsable; panToTile() is the atlas-mode form.
  panTo(x, y) {
    this.assertGlobalCoordinatesUsable("panTo");
    this.view.matrix = Isom.translationToLocal(x, y).inverse();
    this.view.liveMatrix = this.view.matrix.clone();
    this.invalidate();
  }

  setData(data, name = "default") {
    if (this.atlas) {
      throw new Error(
        "hyperbolic-map: setData() is not available in atlas mode -- tile content comes from the atlas " +
          "`tileData` callback. See the note on addSource().",
      );
    }
    const entry = this.sources.get(name);
    if (entry && entry.source instanceof StaticSource) {
      entry.source.setData(data, this.styleSheet);
    } else {
      this.sources.set(name, { source: new StaticSource(data, this.styleSheet), transform: entry ? entry.transform : null });
    }
    this.invalidate();
  }

  addSource(name, data, opts = {}) {
    // Same reasoning as the constructor guard: a source's coordinates are global, and in atlas mode the
    // view matrix is camera-relative, so there is no correct way to place them.
    if (this.atlas) {
      throw new Error(
        `hyperbolic-map: addSource(${JSON.stringify(name)}) is not available in atlas mode -- a source's ` +
          "coordinates are global, and an atlas view is anchored to a tile. Use the atlas `tileData` " +
          "callback for tile content, or `layers` for screen-space overlays.",
      );
    }
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
    if (this.atlas) {
      throw new Error(
        "hyperbolic-map: setSourceTransform() is not available in atlas mode -- there are no global " +
          "sources there. See the note on addSource().",
      );
    }
    const entry = this.sources.get(name);
    if (!entry) throw new Error(`hyperbolic-map: no source named "${name}"`);
    entry.transform = isom;
    this.invalidate();
  }

  // Local coordinates <-> screen pixels, both in whatever frame the VIEW is expressed in. In
  // single-patch mode that is the global frame; in atlas mode it is the current anchor tile's frame, so
  // pair them with `getCamera().address`. For "which tile is under this pixel", use tileAtScreen.
  toScreen(x, y) {
    return this.surface.buildView(this.view, this.options).toScreen(x, y);
  }

  fromScreen(sx, sy) {
    return this.surface.buildView(this.view, this.options).fromScreen(sx, sy);
  }

  // Which tile is under this screen pixel, and where in that tile's own coordinates? Atlas mode only.
  //
  // The natural picking question, and the one an application actually asks. Answered entirely in
  // camera-relative terms, so it is as accurate 200,000 tiles from the origin as at the origin --
  // whereas converting a pixel to a global coordinate and locating from there could not work at all.
  // Returns null if the pixel is outside the disk.
  tileAtScreen(sx, sy) {
    if (!this.atlas) throw new Error("hyperbolic-map: tileAtScreen() requires an atlas; use fromScreen()");
    const view = this.surface.buildView(this.view, this.options);
    const local = view.fromScreen(sx, sy);
    if (!local) return null;
    const tiling = this.atlas.tiling;

    // Answer with the tile the RENDERER just used, whenever the point is on one of them.
    //
    // Not a shortcut -- a correctness requirement for word-addressed tilings. Descending independently
    // finds the right tile geometrically but can name it with a DIFFERENT WORD than the renderer used,
    // because {p,q} words are not canonical: for {5,4}, "2.3" and "1.0" are the same tile, their centres
    // agreeing to 2.8e-17. A caller picking a tile wants the address that matches what is on screen --
    // to look up their own per-tile data, or to correlate with `atlas.lastTiles` -- so resolving against
    // the drawn set makes picking and rendering agree by construction.
    for (const t of this.atlas.lastTiles) {
      const q = t.net.inverse().applyToDisk(
        (sx - view.cx) / view.radius,
        -(sy - view.cy) / view.radius,
        [0, 0],
      );
      const k = 1 / Math.sqrt(Math.max(1e-300, 1 - q[0] * q[0] - q[1] * q[1]));
      const lx = q[0] * k;
      const ly = q[1] * k;
      if (tiling.containsLocal(lx, ly)) {
        return { address: t.address, id: t.id, local: [lx, ly] };
      }
    }

    // Outside the drawn set -- beyond the tile budget, or before the first render. Fall back to the
    // descent, which is still geometrically correct.
    const found = this.atlas.anchor.locateFromCameraLocal(local[0], local[1]);
    return { address: found.address, id: tiling.addressToString(found.address), local: found.local };
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
