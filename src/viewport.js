// HyperbolicViewport -- the public widget.
//
// Everything outside the Poincare disk is the page's business, not the library's. The library draws
// the disk fill and the rim annulus; anything else (a world-turtle behind the disk, a star field,
// a compass rose on top) goes through `layers` or the `onBeforeDraw`/`onAfterDraw` hooks. There are
// deliberately no background-image or shell-image options: they would bake one example's art into
// the library, and a layer does the same job without the library knowing what the art is.

import { Isom } from "./core/isom.js";
import { ViewState, ROTATION_PARALLEL_TRANSPORT } from "./core/view.js";
import { Surface } from "./render/surface.js";
import { Renderer } from "./render/renderer.js";
import { PointerInput } from "./input/pointer.js";
import { SourceSet } from "./data/source.js";
import { DEFAULT_STYLE } from "./data/drawable.js";
import { Atlas } from "./data/atlas/atlas.js";
import { Anchor } from "./data/atlas/anchor.js";

export const DEFAULT_OPTIONS = {
  container: null,
  canvas: null,
  width: null,
  height: null,
  // width / height. Derives the height from the width, so the canvas can follow a fluid container;
  // refuses to coexist with `height`. With `autoResize` this is what makes the widget responsive.
  aspectRatio: null,
  autoResize: false,
  devicePixelRatio: "auto",

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

// Exported for tests: option validation is pure, so it can be checked without a DOM.
export function normalizeOptionsForTesting(userOptions) {
  return normalizeOptions(userOptions);
}

function normalizeOptions(userOptions) {
  const opts = Object.assign({}, DEFAULT_OPTIONS);
  const unknown = [];
  for (const key of Object.keys(userOptions || {})) {
    if (key in DEFAULT_OPTIONS) {
      opts[key] = userOptions[key];
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
    const opts = normalizeOptions(userOptions);
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

    // Named sources, drawn in insertion order. See SourceSet: this is the VIEW-indexed half of the
    // data model, and it produces render passes through the same `passes(view)` interface the atlas
    // does.
    this.sources = new SourceSet({
      styleSheet: this.styleSheet,
      onInvalidate: () => this.invalidate(),
    });
    this.sources.add("default", opts.dataProvider ? opts.dataProvider : (opts.data || []));

    // The atlas, if configured, contributes one render pass per visible tile. It is the TILE-indexed
    // half of the data model; see src/data/source.js for why both exist.
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

    // Everything that can contribute drawables to a frame, in draw order. Both implement
    // `passes(view, onReady)`, so render() does not branch on which mode this viewport is in.
    this.passProducers = this.atlas ? [this.sources, this.atlas] : [this.sources];
    // Bound once: passed to every producer each frame, so no closure is allocated per frame.
    this._onPassReady = () => this.invalidate();

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

  // Keep the camera anchored to a tile near the view center.
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
    // One loop over pass producers. A pass is {drawables, matrix, clip?}: the sources contribute one
    // per named source, the atlas one per visible tile, and the renderer below cannot tell which is
    // which. That join is what keeps single-patch and atlas mode from being two implementations.
    const passes = [];
    const onReady = this._onPassReady;
    for (const producer of this.passProducers) {
      const got = producer.passes(view, onReady);
      for (let i = 0; i < got.length; i++) passes.push(got[i]);
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
    // How far the view center has traveled from the data origin, in hyperbolic units. Exposed
    // because in SINGLE-PATCH mode it is the one number that predicts precision trouble: a float64
    // SU(1,1) matrix has entries of order cosh(d/2), so by d ~ 37 the entries reach 1e8, |a|^2 reaches
    // 1e16, and one ULP of that exceeds the spacing between adjacent tiles.
    //
    // In ATLAS mode that ceiling does not apply, because no global quantity is ever formed: the
    // distance traveled is carried by the tile ADDRESS and the matrix stays camera-relative. See
    // docs/MATH.md section 6.
    if (this.atlas) {
      // In atlas mode the view matrix is camera-relative, so its "distance" is a local quantity of
      // order the visible radius -- not the distance traveled, which is now unbounded and is carried
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

  // ---- mode guards ----
  //
  // Three rules, in one place, because they are one idea: some methods are meaningful in single-patch
  // mode, some only in atlas mode, and the global-coordinate ones stop being meaningful part-way
  // through an atlas session. A fourth guard -- `atlas` cannot be combined with `data` -- is in
  // normalizeOptions(), because it can be decided before anything is built.
  //
  // Each one refuses rather than returning a number that is quietly wrong, and each names the method
  // to use instead.

  // Atlas-only methods.
  requireAtlas(method, alternative) {
    if (!this.atlas) {
      throw new Error(`hyperbolic-map: ${method}() requires an atlas; use ${alternative} instead`);
    }
  }

  // Single-patch-only methods. A source's coordinates are global, and in atlas mode the view matrix is
  // camera-relative, so there is no correct way to place them.
  refuseInAtlasMode(method, why) {
    if (this.atlas) {
      throw new Error(
        `hyperbolic-map: ${method} is not available in atlas mode -- ${why}. Use the atlas ` +
          "`tileData` callback for tile content, or `layers` for screen-space overlays.",
      );
    }
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

  // ---- public API ----

  // Force every async source to re-request for the current view, bypassing the throttle and the
  // significance gate.
  refreshSources() {
    if (this.destroyed) return;
    this.sources.refresh(this.surface.buildView(this.view, this.options));
    this.invalidate();
  }

  getView() {
    this.assertGlobalCoordinatesUsable("getView");
    return {
      center: this.view.liveMatrix.centerLocal([0, 0]),
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
  // caller silently changes behavior. Instead those four throw once the camera has left the origin
  // tile, where a global coordinate can no longer be represented -- a loud failure rather than a
  // plausible wrong number.

  // The complete view: which tile the camera is anchored to, plus the view within that tile's frame.
  getCamera() {
    return {
      address: this.atlas ? this.atlas.anchor.address : null,
      matrix: this.view.liveMatrix.clone(),
      zoom: this.view.liveZoom,
      // Screen quantities, so they mean the same thing in either mode -- and they are the only parts of
      // getView() that survive in atlas mode, where a global center does not exist.
      rotation: this.view.liveMatrix.screenRotation(),
      bearing: this.view.north(),
      interacting: !!this.view.gesture,
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

  // Put a given TILE-LOCAL point of a given tile at the center of the view. The atlas-mode equivalent
  // of panTo, and the only form that stays meaningful arbitrarily far out.
  panToTile(address, local = [0, 0]) {
    this.requireAtlas("panToTile", "panTo()");
    this.atlas.anchor.address = address;
    this.view.matrix = this.panMatrix(local[0], local[1]);
    this.view.liveMatrix = this.view.matrix.clone();
    this.view.gesture = null;
    this.invalidate();
  }

  // The view isometry that puts (x, y) at the center WITHOUT turning the map.
  //
  // Panning must not rotate. Building the pure translation alone would silently reset the screen
  // rotation to zero, which is invisible on a page that never rotates and jarring on one that does:
  // dungeon-man.html opens at rotation pi (its art is drawn upside down in the cell frame), so a pan
  // that reset the angle would flip the whole dungeon over. In atlas mode the rotation is expressed in the
  // anchor tile's frame, so carrying the same angle across to the new anchor is exactly right -- the
  // camera keeps its orientation relative to the tiling, and tile art stays the way up it was.
  panMatrix(x, y) {
    // translationToLocal(...).inverse() has a real positive `a`, hence screenRotation exactly 0, so
    // left-multiplying by Rot(theta) sets the total screen rotation to theta.
    const theta = this.view.matrix.screenRotation();
    const moved = Isom.translationToLocal(x, y).inverse();
    return theta === 0 ? moved : Isom.rotation(theta).mul(moved).normalize();
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

  // Put the given local point at the center of the view. GLOBAL local coordinates -- see
  // assertGlobalCoordinatesUsable; panToTile() is the atlas-mode form.
  panTo(x, y) {
    this.assertGlobalCoordinatesUsable("panTo");
    this.view.matrix = this.panMatrix(x, y);
    this.view.liveMatrix = this.view.matrix.clone();
    this.invalidate();
  }

  setData(data, name = "default") {
    this.refuseInAtlasMode("setData", "a source's coordinates are global, and an atlas view is anchored to a tile");
    this.sources.setData(name, data);
    this.invalidate();
  }

  addSource(name, data, opts = {}) {
    this.refuseInAtlasMode(
      `addSource(${JSON.stringify(name)})`,
      "a source's coordinates are global, and an atlas view is anchored to a tile",
    );
    const source = this.sources.add(name, data, opts);
    this.invalidate();
    return source;
  }

  removeSource(name) {
    this.sources.remove(name);
    this.invalidate();
  }

  // Apply an extra isometry to one source without recompiling its drawables. O(1) per change.
  setSourceTransform(name, isom) {
    this.refuseInAtlasMode("setSourceTransform", "there are no global sources in an atlas to transform");
    this.sources.setTransform(name, isom);
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
    this.requireAtlas("tileAtScreen", "fromScreen()");
    const view = this.surface.buildView(this.view, this.options);
    const local = view.fromScreen(sx, sy);
    if (!local) return null;
    const tiling = this.atlas.tiling;

    // Answer with the tile the RENDERER just used, whenever the point is on one of them.
    //
    // Resolving against the drawn set rather than descending independently. Both name the same tile --
    // addresses are canonical, so there is only one name to give -- but this way the answer comes with
    // the very `local` coordinates and the very frame the renderer used, so a caller correlating a pick
    // with `atlas.lastTiles` gets an exact match, and a point within rounding of a boundary is resolved
    // by the exact containment test rather than by the descent's oscillation tolerance.
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
    this.sources.destroy();
    for (const layer of this.layers) if (layer.detach) layer.detach();
    this.surface.destroy();
  }
}
