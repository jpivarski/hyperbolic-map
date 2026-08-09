// TypeScript declarations for hyperbolic-map's public surface.
//
// HAND-WRITTEN, and it has to be. There is no JSDoc in src/, so `tsc --allowJs --declaration` emits
// `any` for every parameter, and it infers the DEFAULTS as the types: `container: null`,
// `data: null`, `atlas: null`, because that is what DEFAULT_OPTIONS holds. A generated file would be
// worse than none.
//
// It must therefore be kept in step by hand, and two guards do that:
//
//   test/types.test.mjs   the exported VALUE names here must equal src/index.js's exports exactly,
//                         in both directions. Add an export to the barrel and forget it here and
//                         `npm test` fails by name.
//   npm run typecheck     dev/typecheck/ uses this the way a consumer would, and asserts with
//                         expect-error directives that the wrong things still FAIL to compile.
//                         Those are what stop the types drifting loose rather than merely stale.
//
// Only the DOCUMENTED surface is declared. Internals that happen to be reachable -- the
// `*ForTesting` methods, Renderer's per-shape helpers, RegularTiling's exact-arithmetic plumbing --
// are deliberately absent. See docs/index.html, which is the specification these follow.
//
// `SourceSet`, `TileSymmetryError` and `GestureMode` are declared as TYPES only. They are reachable
// at run time (as `viewport.sources`, as a thrown error, as `onGestureStart`'s argument) but are not
// exported values, and declaring them as classes here would be a promise `import` cannot keep.

// ---------------------------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------------------------

/** A point, in whichever coordinate system the surrounding call is documented to use. */
export type Vec2 = [number, number];

/** A 2-element buffer written in place, to avoid allocating on hot paths. */
export type Vec2Out = number[] | Float64Array;

/** Which gesture is in flight. Passed to `onGestureStart`. */
export type GestureMode = "pan" | "rotate" | "pinch";

/** `clip`: whether tile art is clipped to its tile. */
export type ClipMode = "auto" | "always" | "never";

/** `rotationMode`: what stays fixed as the map is dragged. */
export type RotationMode = "parallel-transport" | "compass";

/** `checkTileSymmetry`: the opt-in artwork lint. */
export type TileSymmetryMode = "off" | "warn" | "throw";

// ---------------------------------------------------------------------------------------------
// Drawables
// ---------------------------------------------------------------------------------------------

/**
 * Appearance. Every field may also be given on an individual drawable, where it overrides the
 * drawable's `class` entry in the viewport's `styles` map. `"none"` means do not paint.
 */
export interface Style {
  fill?: string;
  stroke?: string;
  lineWidth?: number;
  lineCap?: CanvasLineCap;
  lineJoin?: CanvasLineJoin;
  miterLimit?: number;
  markerRadius?: number;
  markerFill?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  font?: string;
}

/** A named style, referenced by a drawable's `class`. */
export type StyleSheet = Record<string, Style>;

/**
 * A path vertex. The optional third element is a flag string describing the edge LEAVING this
 * point: "L" strokes it, "P" draws a marker at the point. Both may be given ("LP").
 */
export type PathPoint = [number, number] | [number, number, string];

export interface PathDrawable extends Style {
  type: "path";
  points: PathPoint[];
  /** The fill path always closes; this controls the stroke. Default true. */
  closed?: boolean;
  class?: string;
}

export interface TextDrawable extends Style {
  type: "text";
  text: string;
  /** Where the text sits. */
  at: Vec2;
  /** A second point giving the text's up direction. */
  up: Vec2;
  class?: string;
}

export interface MarkerDrawable extends Style {
  type: "marker";
  at: Vec2;
  /** Overrides `markerRadius` for this marker alone. */
  radius?: number;
  class?: string;
}

export type Drawable = PathDrawable | TextDrawable | MarkerDrawable;

/**
 * The drawable document. A falsy entry in `drawables` is skipped rather than truncating the rest,
 * so a generator may leave holes in its output.
 */
export interface DrawableDocument {
  version?: number;
  /** Only `"local"` is interpreted; anything else is carried through untouched. */
  coordinates?: string;
  drawables: Array<Drawable | null | undefined | false>;
}

/** What `data`, `setData` and a `dataProvider` accept. */
export type Data = Drawable[] | DrawableDocument;

/** A compiled drawable: the output of `compileDrawables`, ready for the renderer. */
export interface CompiledDrawable {
  readonly kind: "path" | "text" | "marker";
  readonly xs: Float64Array | null;
  readonly ys: Float64Array | null;
  /** The companion w = sqrt(1 + x^2 + y^2) per point, precomputed at compile time. */
  readonly ws: Float64Array | null;
  readonly flags: Uint8Array | null;
  readonly closed: boolean;
  readonly text: string | null;
  readonly style: Readonly<Required<Style>>;
  /** The Minkowski bounding cap used to cull the whole shape in six multiplies. */
  readonly cap: Cap | null;
}

// ---------------------------------------------------------------------------------------------
// The view descriptor
// ---------------------------------------------------------------------------------------------

/**
 * The read-only geometry descriptor handed to the renderer and to every hook.
 *
 * One object is reused across frames, so do not retain it past the call that received it.
 */
export interface ViewInfo {
  width: number;
  height: number;
  /** The devicePixelRatio the canvas transform was set with. */
  ctxScale: number;
  cx: number;
  cy: number;
  /** The disk radius in CSS pixels. */
  radius: number;
  zoom: number;
  matrix: Isom;
  rotation: number;
  bearing: number;
  drawRadius: number;
  interactRadius: number;
  /** How much of the disk can actually be on screen at this zoom. */
  effectiveRadius: number;
  interacting: boolean;
  toScreen(x: number, y: number): Vec2;
  /** Null when the pixel is outside the disk. */
  fromScreen(sx: number, sy: number): Vec2 | null;
}

/** What `getView()` returns. Global coordinates, so it throws once an atlas camera has moved off the origin tile. */
export interface ViewSummary {
  center: Vec2;
  zoom: number;
  rotation: number;
  bearing: number;
  interacting: boolean;
}

/** What `getCamera()` returns and `setCamera()` accepts. Meaningful at any distance. */
export interface Camera<Address = any> {
  /** Null when there is no atlas. */
  address: Address | null;
  matrix: Isom;
  zoom: number;
  rotation: number;
  bearing: number;
  interacting: boolean;
}

/** What `tileAtScreen()` returns. */
export interface TilePick<Address = any> {
  address: Address;
  id: string;
  /** The picked point in that tile's own coordinates. */
  local: Vec2;
}

/** A custom drawing layer. Layers with z < 0 draw behind the disk, z >= 0 on top. */
export interface Layer {
  z?: number;
  draw(ctx: CanvasRenderingContext2D, view: ViewInfo): void;
  attach?(viewport: HyperbolicViewport): void;
  detach?(): void;
}

/** Per-frame counters, exposed as `viewport.stats` and passed to `onFrame`. */
export interface FrameStats {
  drawables: number;
  survivors: number;
  drawn: number;
  pointsProjected: number;
  canvasCalls: number;
  textDrawn: number;
  textSkipped: number;
  subPixelSkipped: number;
  verticesDecimated: number;
  frameMs: number;
  /** How far the view center has traveled from the data origin, in hyperbolic units. */
  viewDistance: number;
  /** Atlas mode only. */
  anchorAddress?: string;
  /**
   * Atlas mode only: the largest absolute entry of the camera-relative view matrix. The number that
   * demonstrates the design -- it stays O(1) however far the camera goes.
   */
  maxViewEntry?: number;
  reanchorCount?: number;
}

// ---------------------------------------------------------------------------------------------
// Data sources
// ---------------------------------------------------------------------------------------------

/** What a `dataProvider` is asked for. All coordinates are global. */
export interface DataRequest {
  center: Vec2;
  zoom: number;
  drawRadius: number;
  /** How much of the disk is actually on screen. Usually what a provider should honor. */
  visibleRadius: number;
  signal?: AbortSignal;
}

export type DataProvider = (request: DataRequest) => Data | null | Promise<Data | null>;

export interface CallbackSourceOptions {
  styleSheet?: StyleSheet;
  /** Re-request once the previous request's center has drifted this fraction of the visible radius. Default 0.25. */
  moveFraction?: number;
  /** Re-request once the zoom has changed by this fraction. Default 0.1. */
  zoomFraction?: number;
  /** Default 120. */
  throttleMs?: number;
  onLoad?: (drawables: CompiledDrawable[]) => void;
  onError?: (err: unknown) => void;
}

export interface SourceOptions {
  /** An extra isometry composed on the right, so the source's drawables stay in their own frame. */
  transform?: Isom | null;
}

/** One render pass: drawables plus the matrix they should be drawn with. */
export interface RenderPass {
  drawables: CompiledDrawable[];
  matrix: Isom;
  clip?: ((ctx: CanvasRenderingContext2D, view: ViewInfo) => void) | null;
}

/**
 * The named sources of a single-patch viewport, reachable as `viewport.sources`.
 *
 * A type, not a class: `SourceSet` is not an exported value.
 */
export interface SourceSet {
  passes(view: ViewInfo): RenderPass[];
  add(name: string, data: Data | DataProvider, opts?: SourceOptions): StaticSource | CallbackSource;
  remove(name: string): void;
  has(name: string): boolean;
  setData(name: string, data: Data): void;
  setTransform(name: string, isom: Isom): void;
  refresh(view: ViewInfo): void;
  destroy(): void;
}

// ---------------------------------------------------------------------------------------------
// Tilings
// ---------------------------------------------------------------------------------------------

export interface TilingMetrics {
  /** Center to furthest corner, in hyperbolic units. */
  circumradius: number;
  /** Center to adjacent center. */
  centerSpacing: number;
}

export interface RegularMetrics extends TilingMetrics {
  p: number;
  q: number;
  inradius: number;
  halfEdge: number;
  edgeLength: number;
}

/** A tile boundary traced as a hyperbolic polygon. */
export interface PolygonBoundary {
  kind?: string;
  points: ReadonlyArray<readonly [number, number]>;
}

/** A binary-tiling cell, whose two horizontal sides are horocycles rather than geodesics. */
export interface BinaryCellBoundary {
  kind: "binary-cell";
  halfWidth: number;
  yLow: number;
  yHigh: number;
}

export type TileBoundary = PolygonBoundary | BinaryCellBoundary;

export interface Neighbor<Address = any> {
  address: Address;
  gen: number;
}

/**
 * The custom-tiling protocol. Implement this and an atlas can walk it.
 *
 * Two traps worth stating, because neither is guessable from the names:
 *
 *  - `stepToward` returns an index into the array `neighbors()` returned, NOT a generator index.
 *    The two coincide on a regular tiling and do not on the binary one, whose parent step has two
 *    parities.
 *  - `stepFrame(address, gen)` is not `generator(gen)` unless `stabilizerOrder` is 1. It is the
 *    generator followed by the rotation that lands in the neighbor's CANONICAL frame.
 */
export interface Tiling<Address = any> {
  metrics: TilingMetrics;
  /** The order of a tile's rotational stabilizer. 1 means tile art is under no symmetry constraint. */
  stabilizerOrder: number;
  /** How many tile classes this tiling admits; 1 when it admits no route-independent invariant. */
  classModulus: number;

  originAddress(): Address;
  /** The canonical, persistable name of a tile. */
  addressToString(address: Address): string;
  /** A cheap cache key. May be the same string as `addressToString` when that is already O(1). */
  addressKey(address: Address): string;
  addressEquals(a: Address, b: Address): boolean;

  neighbors(address: Address): Array<Neighbor<Address>>;
  /** Which generators lead out of this tile, without building any neighbor. */
  neighborGens(address: Address): number[];
  extendAddress(address: Address, gen: number): Address;
  /** The step into the neighbor's canonical frame. See the note above. */
  stepFrame(address: Address, gen: number): Isom;
  /** An index into `neighbors()`, or -1 to stop. See the note above. */
  stepToward(x: number, y: number): number;
  /** A constant matrix: the bare generator, which moves a tile center but may not land in its canonical frame. */
  generator(i: number): Isom;

  containsLocal(x: number, y: number, tol?: number): boolean;
  boundaryLocal(): TileBoundary;
  tileClass(address: Address): number;

  /** Painter's order for unclipped art. Absent means the atlas's own nearest-first walk order. */
  compareForDrawing?: ((a: Neighbor<Address>, b: Neighbor<Address>) => number) | null;
  colorCount?: number;
  colorPermutation?: ((address: Address) => number[] | null) | null;
  colorIndex?: ((address: Address) => number) | null;

  /** For callers rather than for the renderer; a custom tiling need not provide these. */
  selfRotation?: Isom;
  inverseGenerator?(i: number): number;
  reverseGenerator?(address: Address, gen: number): number;
  generatorCount?(): number;
}

/**
 * A {p,q} tile address. Opaque: `id` is stable and safe to persist, but it is not a coordinate and
 * there is no way back from the string to an address. Keep the object to return to a tile.
 */
export interface RegularAddress {
  readonly id: string;
}

/** A binary-tiling cell address. BigInt, because descending one latitude doubles the longitude. */
export interface BinaryAddress {
  lat: bigint;
  lon: bigint;
}

/**
 * A color symmetry: a homomorphism from the walk group into a permutation group, which is what lets
 * a repeating atlas draw a genuinely multi-colored pattern rather than one color per tile.
 */
export interface ColorSymmetry {
  colors: number;
  /** One permutation of [0, colors) per walk generator. */
  generators: number[][];
  /** The image of the tile stabilizer. Its order must divide `frameSymmetry`. */
  stabilizer: number[];
}

export interface RegularTilingOptions {
  p: number;
  q: number;
  /**
   * The rotational symmetry the tile art is promised to have; a divisor of p. Only `p` and `p / 2`
   * work, and anything else throws. For Escher's Circle Limit III on {8,3} this must be 4.
   */
  frameSymmetry?: number | null;
  colorSymmetry?: ColorSymmetry | null;
}

/** Painter's order for unclipped binary art: axis, then the direction of each key. */
export type BinaryDrawOrderCode =
  | "H>>" | "H><" | "H<>" | "H<<"
  | "V>>" | "V><" | "V<>" | "V<<";

export interface BinaryTilingOptions {
  /** Null (the default) means the atlas's own nearest-first walk order. */
  drawOrder?: BinaryDrawOrderCode | null;
}

// ---------------------------------------------------------------------------------------------
// The atlas
// ---------------------------------------------------------------------------------------------

/** What the `tileData` callback is told about a tile. Never a world frame: there is no such thing here. */
export interface TileInfo<Address = any> {
  address: Address;
  /** The readable, canonical identifier. Good for filenames and logging. */
  id: string;
  /** In [0, classCount). The only per-tile variation a {p,q} atlas may safely key art on. */
  classIndex: number;
  classCount: number;
  /** The permutation this tile applies to the caller's colors, or null if none was declared. */
  colorPermutation: number[] | null;
  colorIndex: number;
  colorCount: number;
  /** This tile's frame relative to the camera's. */
  relativeFrame: Isom;
  centerRelativeDisk: Vec2;
}

/** What a `tileData` callback may return, on top of a plain drawable document. */
export interface TileData extends DrawableDocument {
  /** Promises the art stays inside the tile, so `clip: "auto"` need not clip it. */
  withinTile?: boolean;
  /** Cheap stand-in art, drawn when the tile is small on screen. */
  lod?: Array<Drawable | null | undefined | false>;
  /** Overrides the atlas's `lodPx` for this tile. */
  lodPx?: number;
}

export type TileDataCallback<Address = any> = (
  tile: TileInfo<Address>,
) => TileData | Drawable[] | null | Promise<TileData | Drawable[] | null>;

/** Unknown keys throw, exactly as they do for the viewport's own options. */
export interface AtlasOptions<Address = any> {
  tiling: Tiling<Address>;
  tileData: TileDataCallback<Address>;
  /** Default `"auto"`, which clips unless the tile said `withinTile`. */
  clip?: ClipMode;
  /** Default 512. */
  cacheSize?: number;
  /** Default 256. */
  maxTiles?: number;
  styleSheet?: StyleSheet | null;
  onTileLoad?: ((tile: TileInfo<Address>, drawables: CompiledDrawable[]) => void) | null;
  onTileError?: ((tile: TileInfo<Address>, err: unknown) => void) | null;
  /** An opt-in lint on the artwork, off by default. */
  checkTileSymmetry?: TileSymmetryMode;
  /** Default 1e-6. */
  tileSymmetryTolerance?: number;
  /** Below this on-screen tile radius in CSS pixels, a tile draws its `lod` art. Default 11. */
  lodPx?: number;
}

/** The result of the artwork symmetry lint, or null if it has not run. */
export type TileSymmetryResult =
  | { residual: number; checked: number; offender: number | null; m: number; ok: boolean }
  | { skipped: string; ok: true };

/** One of the tiles the last render used, with the matrix that placed it. */
export interface DrawnTile<Address = any> {
  address: Address;
  /** Lazy: building this string is expensive far from the origin, and most frames never read it. */
  readonly id: string;
  /** Tile-local coordinates straight to screen-disk coordinates. */
  net: Isom;
  /** This tile's frame relative to the camera's. */
  rel: Isom;
}

/**
 * The lint's failure when `checkTileSymmetry` is `"throw"`. A distinct type because it is a
 * statement about the ARTWORK, not about one tile failing to load.
 *
 * A type, not a class: `TileSymmetryError` is not an exported value. Test it by name.
 */
export interface TileSymmetryError extends Error {
  name: "TileSymmetryError";
}

// ---------------------------------------------------------------------------------------------
// Viewport options
// ---------------------------------------------------------------------------------------------

/**
 * Every viewport option. Prefer `ViewportOptions`, which additionally encodes that `aspectRatio`
 * and `height` cannot both be given.
 *
 * There is no index signature on purpose: an unrecognized option name throws at run time, so a
 * misspelling should be a type error too.
 */
export interface ViewportOptionsAll {
  // ---- where it draws ----
  /** A CSS selector or an element. The canvas is created inside it. */
  container?: string | Element | null;
  /** An existing canvas to draw into, instead of `container`. */
  canvas?: HTMLCanvasElement | null;
  width?: number | null;
  height?: number | null;
  /** width / height. Derives the height from the width; refuses to coexist with `height`. */
  aspectRatio?: number | null;
  autoResize?: boolean;
  /** `"auto"` follows window.devicePixelRatio. Default `"auto"`. */
  devicePixelRatio?: "auto" | number;

  // ---- what it draws ----
  data?: Data | null;
  dataProvider?: DataProvider | null;
  /** Tile-indexed data. Cannot be combined with `data` or `dataProvider`. */
  atlas?: AtlasOptions | null;
  /** Atlas mode only: start the camera on this tile, with the initial view in that tile's frame. */
  anchor?: any;
  styles?: StyleSheet | null;

  // ---- initial view ----
  center?: Vec2 | null;
  offsetX?: number;
  offsetY?: number;
  rotation?: number;
  /** Default 0.95. */
  zoom?: number;
  /** Default 0.5. */
  minZoom?: number;
  maxZoom?: number | null;

  // ---- interaction ----
  interactive?: boolean;
  allowPan?: boolean;
  allowZoom?: boolean;
  allowRotate?: boolean;
  /** Dragging the annulus outside `interactRadius` rotates the map. */
  rimRotate?: boolean;
  wheelZoom?: boolean;
  /** Default 1.1. */
  wheelZoomStep?: number;
  rotationMode?: RotationMode;
  /** The ideal point treated as north in compass mode. Default [0, 1]. */
  compassTarget?: Vec2;
  /** Default 0.9. */
  interactRadius?: number;
  /** Default 1.0. */
  drawRadius?: number;

  // ---- appearance ----
  background?: string;
  /** Painted outside the disk. Null leaves the canvas transparent there. */
  pageBackground?: string | null;
  rimFill?: string;
  rimStroke?: string;
  rimLineWidth?: number;
  /** The largest arc bulge, in pixels, that may be flattened to a chord. Default 0.25. */
  sagittaTolerancePx?: number;
  /** Drop a vertex projecting within this many pixels of the last one emitted. Default 0.25. */
  decimateTolerancePx?: number;
  /** Skip shapes smaller than this on screen. Default 0, so a still frame is always drawn in full. */
  minFeaturePx?: number;
  /** The same, but only while a gesture is in flight. Default 0.5. */
  interactMinFeaturePx?: number;
  /** Default 3. */
  minTextPx?: number;

  // ---- hooks ----
  layers?: Layer[] | null;
  onBeforeDraw?: ((ctx: CanvasRenderingContext2D, view: ViewInfo) => void) | null;
  onAfterDraw?: ((ctx: CanvasRenderingContext2D, view: ViewInfo) => void) | null;
  /** Supplying this SUPPRESSES the default disk fill. */
  onDrawBackground?: ((ctx: CanvasRenderingContext2D, view: ViewInfo) => void) | null;
  /** Supplying this SUPPRESSES the default rim. */
  onDrawRim?: ((ctx: CanvasRenderingContext2D, view: ViewInfo) => void) | null;
  onViewChange?: ((view: ViewSummary) => void) | null;
  onGestureStart?: ((mode: GestureMode) => void) | null;
  onGestureEnd?: ((view: ViewSummary) => void) | null;
  onFrame?: ((stats: FrameStats) => void) | null;
}

/**
 * The viewport's options.
 *
 * `aspectRatio` derives the height from the width, so giving `height` as well is a run-time error;
 * the union below makes it a compile-time one.
 */
export type ViewportOptions =
  | (Omit<ViewportOptionsAll, "aspectRatio" | "height"> & { aspectRatio?: null; height?: number | null })
  | (Omit<ViewportOptionsAll, "aspectRatio" | "height"> & { aspectRatio: number; height?: null });

// ---------------------------------------------------------------------------------------------
// Exported values
// ---------------------------------------------------------------------------------------------

export const VERSION: string;

// ---- core geometry ----

/**
 * Orientation-preserving isometries of the hyperbolic plane, as SU(1,1) matrices.
 *
 * Note SU(1,1) double-covers the isometry group: +M and -M are the same isometry, so a rotation by
 * 2*pi is -I, not I.
 */
export class Isom {
  constructor(ar: number, ai: number, br: number, bi: number);
  ar: number;
  ai: number;
  br: number;
  bi: number;

  static identity(): Isom;
  /** Rotation of the disk about the origin. */
  static rotation(theta: number): Isom;
  static translationToDisk(bx: number, by: number): Isom;
  static translationToLocal(x: number, y: number): Isom;
  static translation(dist: number, bearing: number): Isom;
  /** Rotation AFTER translation: Rot(rotation) . T(bx, by). Order matters. */
  static fromOffsetRotation(bx: number, by: number, rotation: number): Isom;

  clone(): Isom;
  /** `this . other`: apply `other` first, then `this`. */
  mul(other: Isom): Isom;
  inverse(): Isom;
  /** Project back onto the group manifold. Mutates and returns `this`. */
  normalize(): this;
  /** How far off the manifold this is. Diagnostics only. */
  detError(): number;

  /** Maps a LOCAL point straight to its Poincare-disk position. Pass `w` if already known. */
  applyToLocal<T extends Vec2Out>(x: number, y: number, w: number | undefined, out: T): T;
  applyToDisk<T extends Vec2Out>(zx: number, zy: number, out: T): T;
  /** Ideal (boundary) points, |w| = 1. */
  applyToIdeal<T extends Vec2Out>(wx: number, wy: number, out: T): T;

  /** Screen bearing of the half-plane's point at infinity. */
  north(): number;
  screenRotation(): number;
  originImageDisk<T extends Vec2Out>(out: T): T;
  /** The point this isometry sends to the origin, in local coordinates. */
  centerLocal<T extends Vec2Out>(out: T): T;
  distanceMoved(): number;
}

/** w = sqrt(1 + x^2 + y^2) = cosh(d/2) for the point at local radius sinh(d/2). */
export function localCompanion(x: number, y: number): number;

/** The pure translation carrying disk point (px, py) to disk point (fx, fy). */
export function movePointToPoint(px: number, py: number, fx: number, fy: number): Isom;

export function localToDisk<T extends Vec2Out>(x: number, y: number, out: T): T;
export function diskToLocal<T extends Vec2Out>(zx: number, zy: number, out: T): T;
export function localRadiusToDistance(r: number): number;
export function distanceToLocalRadius(d: number): number;
/** Hyperbolic distance between two points given in local coordinates. */
export function localDistance(x1: number, y1: number, x2: number, y2: number): number;
export function halfPlaneToLocal<T extends Vec2Out>(px: number, py: number, out: T): T;
export function localToHalfPlane<T extends Vec2Out>(px: number, py: number, out: T): T;

/** A bounding cap: every point of a drawable lies within `radius` of the local point (x, y). */
export class Cap {
  constructor(x: number, y: number, radius: number);
  x: number;
  y: number;
  /** The companion of (x, y). */
  w: number;
  radius: number;
  static enclosing(
    xs: ArrayLike<number>,
    ys: ArrayLike<number>,
    start: number,
    count: number,
  ): Cap;
}

/** cosh(d/2) between two points in local coordinates. `w1`/`w2` may be passed if already known. */
export function coshHalfDistance(
  x1: number, y1: number, w1: number | undefined,
  x2: number, y2: number, w2: number | undefined,
): number;
/** The squared form, for hot comparisons. Both companions are required here. */
export function coshHalfDistanceSquared(
  x1: number, y1: number, w1: number,
  x2: number, y2: number, w2: number,
): number;
export function screenRadiusToThresholdSquared(tau: number): number;
export function capMayBeVisible(
  cap: Cap, cx: number, cy: number, cw: number, coshHalfSum: number,
): boolean;
export function capThreshold(tau: number, capRadius: number): number;

// ---- view state ----

export const ROTATION_PARALLEL_TRANSPORT: "parallel-transport";
export const ROTATION_COMPASS: "compass";

export interface ViewStateOptions {
  matrix?: Isom | null;
  offsetX?: number;
  offsetY?: number;
  rotation?: number;
  zoom?: number;
  minZoom?: number;
  maxZoom?: number | null;
  rotationMode?: RotationMode;
  compassTargetX?: number;
  compassTargetY?: number;
}

/**
 * The view isometry plus a zoom, with committed-versus-live gesture bookkeeping. A gesture rewrites
 * the live state from the committed state every frame, so drag error cannot compound.
 */
export class ViewState {
  constructor(options?: ViewStateOptions);
  matrix: Isom;
  zoom: number;
  minZoom: number;
  maxZoom: number | null;
  rotationMode: RotationMode;
  compassTargetX: number;
  compassTargetY: number;
  liveMatrix: Isom;
  liveZoom: number;
  gesture: { kind: GestureMode } | null;

  /** Re-express the view in a neighboring tile's frame. */
  rebase(shift: Isom): void;
  clampZoom(z: number): number;
  /** Screen bearing of the compass target under the live view. */
  north(): number;
  northOf(m: Isom): number;
  commit(): void;
  cancel(): void;

  /** Coordinates here are disk coordinates: screen position divided by the disk radius. */
  beginPan(dx: number, dy: number): void;
  updatePan(dx: number, dy: number): void;
  beginRotate(dx: number, dy: number): void;
  updateRotate(dx: number, dy: number): void;
  zoomBy(factor: number): number;
  setZoom(z: number): number;
  beginPinch(f1x: number, f1y: number, f2x: number, f2y: number): void;
  updatePinch(
    g1x: number, g1y: number, g2x: number, g2y: number,
    allowZoom?: boolean, allowRotate?: boolean,
  ): void;
  solvePinchScale(
    g: { targetDistance: number },
    g1x: number, g1y: number, g2x: number, g2y: number,
  ): number;
}

// ---- rendering ----

/** Geodesic arc parameters, reused by the caller to avoid allocating per edge. */
export class Arc {
  constructor();
  straight: boolean;
  cx: number;
  cy: number;
  r: number;
  startAngle: number;
  endAngle: number;
  /**
   * The one British spelling in this library, deliberately: it is passed straight into
   * `CanvasRenderingContext2D.arc()`, whose sixth argument the HTML specification spells this way.
   */
  anticlockwise: boolean;
}

/**
 * The geodesic from (x1, y1) to (x2, y2), both in disk coordinates, written into `out`.
 * Pass `sagittaTolerance` 0 to always use an arc.
 */
export function geodesicArc(
  x1: number, y1: number, x2: number, y2: number,
  out: Arc, sagittaTolerance: number,
): Arc;

/** The canvas surface: sizing, devicePixelRatio, and the read-only view descriptor. */
export class Surface {
  constructor(options: {
    container?: string | Element | null;
    canvas?: HTMLCanvasElement | null;
    width?: number | null;
    height?: number | null;
    autoResize?: boolean;
    devicePixelRatio?: "auto" | number;
    aspectRatio?: number | null;
  });
  autoResize: boolean;
  dprOption: "auto" | number;
  aspectRatio: number | null;
  host?: Element;
  canvas: HTMLCanvasElement;
  cssWidth: number;
  cssHeight: number;
  context: CanvasRenderingContext2D;
  resizeObserver: ResizeObserver | null;

  dpr(): number;
  applySize(): void;
  resize(w: number, h: number): void;
  observe(onResize: () => void): void;
  /** The disk radius in CSS pixels, sized by the smaller side so the disk always fits. */
  radiusFor(zoom: number): number;
  buildView(viewState: ViewState, opts: { drawRadius: number; interactRadius: number }): ViewInfo;
  eventToDisk(event: { clientX: number; clientY: number }, zoom: number): Vec2;
  destroy(): void;
}

export interface RendererOptions {
  background?: string;
  pageBackground?: string | null;
  rimFill?: string;
  rimStroke?: string;
  rimLineWidth?: number;
  layers?: Layer[];
  onBeforeDraw?: ((ctx: CanvasRenderingContext2D, view: ViewInfo) => void) | null;
  onAfterDraw?: ((ctx: CanvasRenderingContext2D, view: ViewInfo) => void) | null;
  onDrawBackground?: ((ctx: CanvasRenderingContext2D, view: ViewInfo) => void) | null;
  onDrawRim?: ((ctx: CanvasRenderingContext2D, view: ViewInfo) => void) | null;
  sagittaTolerancePx?: number;
  decimateTolerancePx?: number;
  minFeaturePx?: number;
  minTextPx?: number;
}

export class Renderer {
  constructor();
  stats: FrameStats;
  draw(
    ctx: CanvasRenderingContext2D,
    view: ViewInfo,
    passes: RenderPass[],
    options: RendererOptions,
  ): void;
  /** Drop the cached canvas state, after anything outside the renderer has touched the context. */
  forgetCanvasState(): void;
}

// ---- input ----

/** Clamp a disk point to a radius, preserving direction. */
export function clampToRadius(x: number, y: number, radius: number): Vec2;

/** The DOM abstraction PointerInput draws its events from, so it is testable without a browser. */
export interface PointerHost {
  element: HTMLElement | Element;
  window: Window | null;
  document: Document | null;
  toDisk(event: { clientX: number; clientY: number }, zoom: number): Vec2;
}

export interface PointerCallbacks {
  onChange?: () => void;
  onGestureStart?: (mode: GestureMode) => void;
  onGestureEnd?: () => void;
}

/** Gesture recognition, on Pointer Events only: one code path for mouse, touch and pen. */
export class PointerInput {
  constructor(
    host: PointerHost,
    viewState: ViewState,
    options: ViewportOptionsAll,
    callbacks?: PointerCallbacks,
  );
  host: PointerHost;
  view: ViewState;
  options: ViewportOptionsAll;
  callbacks: PointerCallbacks;
  pointers: Map<number, { x: number; y: number; clientX: number; clientY: number }>;
  mode: "idle" | GestureMode;
  disposed: boolean;
  cancelAll(): void;
  destroy(): void;
}

// ---- data ----

export const DEFAULT_STYLE: Readonly<Required<Style>>;

/** Accepts an array of drawables, or a `{ version, coordinates, drawables }` document. */
export function compileDrawables(data: Data | null, styleSheet?: StyleSheet | null): CompiledDrawable[];

/** A fixed array of drawables, compiled once. */
export class StaticSource {
  constructor(data: Data | null, styleSheet?: StyleSheet | null);
  drawables: CompiledDrawable[];
  transform: Isom | null;
  get(view?: ViewInfo): CompiledDrawable[];
  setData(data: Data | null, styleSheet?: StyleSheet | null): void;
}

/** An async function of the view, with caching, in-flight de-duplication and AbortSignal cancellation. */
export class CallbackSource {
  constructor(fn: DataProvider, options?: CallbackSourceOptions);
  fn: DataProvider;
  styleSheet?: StyleSheet;
  moveFraction: number;
  zoomFraction: number;
  throttleMs: number;
  drawables: CompiledDrawable[];
  onLoad: ((drawables: CompiledDrawable[]) => void) | null;
  onError: ((err: unknown) => void) | null;
  needsRequest(view: ViewInfo, now: number): boolean;
  get(view: ViewInfo, now?: number): CompiledDrawable[];
  /** Ask again regardless of the throttle and the significance gate. */
  refresh(view: ViewInfo): void;
  request(view: ViewInfo, now: number): Promise<void>;
  destroy(): void;
}

// ---- the atlas ----

export const CLIP_AUTO: "auto";
export const CLIP_ALWAYS: "always";
export const CLIP_NEVER: "never";

/** An independent coordinate patch per tile, so no coordinate is ever large. */
export class Atlas<Address = any> {
  constructor(options: AtlasOptions<Address>);
  tiling: Tiling<Address>;
  tileData: TileDataCallback<Address>;
  clip: ClipMode;
  cacheSize: number;
  maxTiles: number;
  styleSheet: StyleSheet | null;
  onTileLoad: ((tile: TileInfo<Address>, drawables: CompiledDrawable[]) => void) | null;
  onTileError: ((tile: TileInfo<Address>, err: unknown) => void) | null;
  checkTileSymmetry: TileSymmetryMode;
  tileSymmetryTolerance: number;
  lodPx: number;
  tileSymmetry: TileSymmetryResult | null;
  cache: Map<string, { drawables: CompiledDrawable[]; withinTile: boolean }>;
  pending: Map<string, Promise<void>>;
  anchor: Anchor<Address>;
  tileLocalRadius: number;
  /** The tiles the last render used, each with the matrix that placed it. */
  lastTiles: Array<DrawnTile<Address>>;
  passes(view: ViewInfo, onReady?: () => void): RenderPass[];
  clipPathFor(net: Isom): (ctx: CanvasRenderingContext2D, view: ViewInfo) => void;
}

/**
 * The anchored camera: the piece that keeps every number small. The view is stored as an isometry
 * of the camera TILE's frame, so no global frame is ever formed.
 */
export class Anchor<Address = any> {
  constructor(tiling: Tiling<Address>, options?: { address?: Address | null });
  tiling: Tiling<Address>;
  address: Address;
  reanchorCount: number;
  /** Whether the last `neighborhood` hit its budget. */
  lastTruncated: boolean;

  atOrigin(): boolean;
  /** The view center in camera-tile-local coordinates, as [x, y, w]. */
  viewCenterLocal<T extends number[] | Float64Array>(matrix: Isom, out: T): T;
  /**
   * Move the camera to whichever neighbor is nearest the view center, repeatedly. Returns the
   * accumulated RIGHT factor: the caller must replace its matrix with `matrix.mul(shift)`.
   */
  reanchor(matrix: Isom, maxSteps?: number): { steps: number; shift: Isom };
  /** Which tile contains a point of the camera tile's frame, without moving the camera. */
  locateFromCameraLocal(
    x: number, y: number, maxSteps?: number,
  ): { address: Address; local: Vec2; rel: Isom };
  /** Tiles that can be on screen, each with its frame relative to the camera. */
  neighborhood(
    matrix: Isom, visibleRadius: number, maxTiles?: number,
  ): Array<{ address: Address; rel: Isom }>;
  /** The largest absolute entry of a camera-relative view. It must stay O(1) at any distance. */
  static maxEntry(m: Isom): number;
}

// ---- tilings ----

/** Circumradius, inradius, half-edge and spacings of a regular {p,q} tiling, at curvature -1. */
export function regularMetrics(p: number, q: number): RegularMetrics;

export class RegularTiling implements Tiling<RegularAddress> {
  constructor(options?: RegularTilingOptions);
  metrics: RegularMetrics;
  p: number;
  q: number;
  /** The frame symmetry actually in force: `frameSymmetry` if given, else p. */
  m: number;
  /** The tile vertices in disk coordinates. */
  vertexDisk: Vec2[];
  generators: Isom[];
  stabilizerOrder: number;
  selfRotation: Isom;
  neighborCentersLocal: Array<[number, number, number]>;
  classModulus: number;
  colorCount: number;

  originAddress(): RegularAddress;
  addressToString(address: RegularAddress): string;
  addressKey(address: RegularAddress): string;
  addressEquals(a: RegularAddress, b: RegularAddress): boolean;
  neighbors(address: RegularAddress): Array<Neighbor<RegularAddress>>;
  neighborGens(): number[];
  extendAddress(address: RegularAddress, gen: number): RegularAddress;
  stepFrame(address: RegularAddress, gen: number): Isom;
  stepToward(x: number, y: number): number;
  generator(i: number): Isom;
  inverseGenerator(i: number): number;
  /** The generator stepping from `extendAddress(address, gen)` BACK to `address`. Not `inverseGenerator(gen)`. */
  reverseGenerator(address: RegularAddress, gen: number): number;
  generatorCount(): number;
  tileClass(address: RegularAddress): number;
  /** Do not mutate the returned array: it is the interned group element. */
  colorPermutation(address: RegularAddress): number[] | null;
  colorIndex(address: RegularAddress): number;
  containsLocal(x: number, y: number, tol?: number): boolean;
  boundaryLocal(): PolygonBoundary;
}

/** Half the width of a binary cell in its own half-plane coordinates. */
export const BINARY_LOCAL_HALF_WIDTH: number;
export const BINARY_LOCAL_Y_LOW: number;
export const BINARY_LOCAL_Y_HIGH: number;

export const BIN_RIGHT: 0;
export const BIN_LEFT: 1;
export const BIN_CHILD0: 2;
export const BIN_CHILD1: 3;
export const BIN_PARENT_EVEN: 4;
export const BIN_PARENT_ODD: 5;

/**
 * A stable painter's order for unclipped binary art, keyed on the address rather than on distance
 * from the camera, so seams do not flip as you pan. Later in the order paints on top.
 */
export function binaryDrawOrder(
  code: BinaryDrawOrderCode,
): (a: Neighbor<BinaryAddress>, b: Neighbor<BinaryAddress>) => number;

/**
 * The binary (Boroczky) tiling. Its stabilizer is trivial, so every cell's frame is unique and tile
 * art is under no symmetry constraint -- which is why every cell may hold something different.
 */
export class BinaryTiling implements Tiling<BinaryAddress> {
  constructor(options?: BinaryTilingOptions);
  drawOrder: BinaryDrawOrderCode | null;
  compareForDrawing: ((a: Neighbor<BinaryAddress>, b: Neighbor<BinaryAddress>) => number) | null;
  metrics: TilingMetrics;
  stabilizerOrder: 1;
  selfRotation: Isom;
  classModulus: 1;
  colorCount: 1;

  originAddress(): BinaryAddress;
  addressToString(address: BinaryAddress): string;
  addressKey(address: BinaryAddress): string;
  addressEquals(a: BinaryAddress, b: BinaryAddress): boolean;
  /** A cell offers PARENT_EVEN or PARENT_ODD according to its own longitude parity, never both. */
  neighborGens(address: BinaryAddress): number[];
  neighbors(address: BinaryAddress): Array<Neighbor<BinaryAddress>>;
  extendAddress(address: BinaryAddress, gen: number): BinaryAddress;
  stepFrame(address: BinaryAddress, gen: number): Isom;
  stepToward(x: number, y: number): number;
  generator(i: number): Isom;
  inverseGenerator(i: number): number;
  reverseGenerator(address: BinaryAddress, gen: number): number;
  generatorCount(): number;
  tileClass(): number;
  colorPermutation(): null;
  colorIndex(): number;
  containsLocal(x: number, y: number, tol?: number): boolean;
  boundaryLocal(): BinaryCellBoundary;
}

// ---- exact arithmetic behind canonical tile ids ----
//
// Not needed to USE a tiling -- an id is just the string `addressToString` hands you -- but exported
// so the claim can be checked from outside.

/**
 * One element of Z[2cos(pi/N)]: `deg` integer coefficients, either all Numbers or all BigInts, never
 * mixed. Elements are born small and promoted to BigInt permanently once they no longer fit.
 */
export type ExactElement = number[] | bigint[];
export type ExactVector = ExactElement[];
export type ExactMatrix = ExactElement[][];

/** The minimal polynomial of 2cos(pi/N): monic, integer coefficients, lowest degree first. */
export function minPolyFor2Cos(N: number): bigint[];

/** How many ring multiplies have happened. Must stay flat across a rendered frame. */
export function exactMulCount(): number;
export function resetExactMulCount(): void;

/** Exact integer arithmetic in Z[2cos(pi/N)]. */
export class ExactRing {
  constructor(N: number);
  N: number;
  poly: bigint[];
  deg: number;
  /** The float value of 2cos(pi/N). For tests and calibration only, never for identity. */
  muFloat: number;

  zero(): ExactElement;
  one(): ExactElement;
  fromInt(k: number | bigint): ExactElement;
  mu(): ExactElement;
  /** Whether an element is in the Number representation. */
  isSmall(a: ExactElement): boolean;
  add(a: ExactElement, b: ExactElement): ExactElement;
  sub(a: ExactElement, b: ExactElement): ExactElement;
  neg(a: ExactElement): ExactElement;
  mul(a: ExactElement, b: ExactElement): ExactElement;
  /** Reduce a raw convolution modulo the minimal polynomial. BigInt in, BigInt out. */
  reduce(raw: ExactElement): bigint[];
  isZero(a: ExactElement): boolean;
  equals(a: ExactElement, b: ExactElement): boolean;
  /** Compares mathematical values, so it is exact across both representations. */
  cmp(a: ExactElement, b: ExactElement): number;
  /** 2cos(k*pi/N) as a ring element, via the Dickson polynomial. */
  dicksonOfMu(k: number): ExactElement;
  /** 2cos(pi/n), which requires n to divide N (or n = 3, which is rational). */
  lambdaFor(n: number): ExactElement;
  toNumber(a: ExactElement): number;
  /** Fixed and unambiguous, and part of the public tile id: it must not depend on the representation. */
  serialize(a: ExactElement): string;
}

/** Everything exact about one {p,q}: the ring, the mirrors, the special points and the rotations. */
export function buildExactCoxeter(p: number, q: number): {
  p: number;
  q: number;
  N: number;
  R: ExactRing;
  /** The Gram matrix of the three mirrors. */
  G: ExactMatrix;
  Sa: ExactMatrix;
  Sb: ExactMatrix;
  Sc: ExactMatrix;
  /** The tile center, the edge midpoint and the vertex, each fixed by two mirrors. */
  vO: ExactVector;
  vM: ExactVector;
  vV: ExactVector;
  lambdaP: ExactElement;
  lambdaQ: ExactElement;
  /** Rotation by +2*pi/p about the tile center. */
  rho: ExactMatrix;
};

/** THE PUBLIC TILE ID, so its shape is fixed forever: the serialized tile center. */
export function serializeExactVector(
  R: ExactRing, v: ExactVector, p: number, q: number, m: number,
): string;

// ---- the widget ----

export const DEFAULT_OPTIONS: Readonly<Required<ViewportOptionsAll>>;

/**
 * The public widget.
 *
 * Two modes, and the option validator refuses to mix them. In SINGLE-PATCH mode (`data` or
 * `dataProvider`) coordinates are global. In ATLAS mode (`atlas`) the view is anchored to a tile,
 * so `getView`, `getMatrix`, `setMatrix` and `panTo` throw once the camera leaves the origin tile
 * -- a loud failure rather than a plausible wrong number. Use `getCamera`, `setCamera` and
 * `panToTile` instead, which stay meaningful at any distance.
 */
export class HyperbolicViewport<Address = any> {
  constructor(options: ViewportOptions);
  options: Readonly<Required<ViewportOptionsAll>>;
  styleSheet: StyleSheet;
  surface: Surface;
  renderer: Renderer;
  view: ViewState;
  sources: SourceSet;
  atlas: Atlas<Address> | null;
  layers: Layer[];
  destroyed: boolean;
  stats: FrameStats;
  input: PointerInput;

  /** Request a redraw, coalesced to one per animation frame. */
  invalidate(): void;
  render(): void;
  reanchorCamera(): void;
  /** Force every async source to re-request, bypassing the throttle and the significance gate. */
  refreshSources(): void;

  /** Global coordinates. Throws in atlas mode once the camera has left the origin tile. */
  getView(): ViewSummary;
  /** Global coordinates. Throws in atlas mode once the camera has left the origin tile. */
  getMatrix(): Isom;
  /** Global coordinates. Throws in atlas mode once the camera has left the origin tile. */
  setMatrix(isom: Isom): void;
  /** Global coordinates. Throws in atlas mode once the camera has left the origin tile. */
  panTo(x: number, y: number): void;

  /** The complete view: which tile the camera is on, plus the view within that tile's frame. */
  getCamera(): Camera<Address>;
  /** Restore a view captured by `getCamera()`. An exact round trip. */
  setCamera(camera: Camera<Address>): void;
  /** Atlas mode only. Put a tile-local point of a given tile at the center of the view. */
  panToTile(address: Address, local?: Vec2): void;
  /** The view isometry that puts (x, y) at the center without turning the map. */
  panMatrix(x: number, y: number): Isom;

  setZoom(z: number): void;
  setRotation(theta: number): void;

  /** Single-patch mode only. */
  setData(data: Data | null, name?: string): void;
  /** Single-patch mode only. */
  addSource(name: string, data: Data | DataProvider, opts?: SourceOptions): StaticSource | CallbackSource;
  removeSource(name: string): void;
  /** Single-patch mode only. Applies an extra isometry to one source without recompiling it. */
  setSourceTransform(name: string, isom: Isom): void;

  /** Local coordinates in whatever frame the view is expressed in; in atlas mode, the anchor tile's. */
  toScreen(x: number, y: number): Vec2;
  fromScreen(sx: number, sy: number): Vec2 | null;
  /** Atlas mode only. Which tile is under this pixel, and where in that tile's own coordinates? */
  tileAtScreen(sx: number, sy: number): TilePick<Address> | null;

  resize(w: number, h: number): void;
  destroy(): void;
}
