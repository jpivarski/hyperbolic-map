// Uses src/index.d.ts the way a consumer would, under `strict`.
//
// The `@ts-expect-error` lines are the point of this file. A declaration file rots in two
// directions: it can go STALE (a real call stops compiling, which the positive half below catches)
// and it can go LOOSE (a typo starts compiling, which only a negative test catches). TypeScript
// fails the build if an `@ts-expect-error` line has no error under it, so each one is an assertion
// that something is still rejected.
//
// Not part of `npm test`: run `npm run typecheck`, which fetches tsc with `npx -y`.

import {
  Anchor,
  Atlas,
  BinaryTiling,
  Cap,
  ExactRing,
  HyperbolicViewport,
  Isom,
  RegularTiling,
  StaticSource,
  binaryDrawOrder,
  buildExactCoxeter,
  capThreshold,
  clampToRadius,
  compileDrawables,
  coshHalfDistance,
  diskToLocal,
  geodesicArc,
  halfPlaneToLocal,
  localCompanion,
  localDistance,
  localToDisk,
  minPolyFor2Cos,
  movePointToPoint,
  regularMetrics,
  serializeExactVector,
  Arc,
  BIN_CHILD0,
  BINARY_LOCAL_Y_HIGH,
  CLIP_NEVER,
  DEFAULT_OPTIONS,
  DEFAULT_STYLE,
  ROTATION_COMPASS,
  VERSION,
} from "hyperbolic-map";
import * as HM from "hyperbolic-map";
import type {
  BinaryAddress,
  Drawable,
  Isom as IsomType,
  Layer,
  RegularAddress,
  TileInfo,
  Tiling,
  ViewInfo,
  ViewportOptions,
} from "hyperbolic-map";

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

const version: string = VERSION;
const clip: "never" = CLIP_NEVER;
const child0: 0 | 1 | 2 | 3 | 4 | 5 = BIN_CHILD0;
const yHigh: number = BINARY_LOCAL_Y_HIGH;
// Defaults are fully populated, not `T | undefined`: every option that defaults to null says so.
const defaultZoom: number = DEFAULT_OPTIONS.zoom;
const defaultContainer: string | Element | null = DEFAULT_OPTIONS.container;
const defaultFont: string = DEFAULT_STYLE.font;
void [version, clip, child0, yHigh, defaultZoom, defaultContainer, defaultFont];

// ---------------------------------------------------------------------------------------------
// Single-patch mode
// ---------------------------------------------------------------------------------------------

const drawables: Drawable[] = [
  { type: "path", points: [[0, 0], [1, 0, "L"], [1, 1, "LP"]], closed: true, stroke: "#333" },
  { type: "text", text: "here", at: [0, 0], up: [0, 1], font: "12px sans-serif", align: "center" },
  { type: "marker", at: [0.5, 0.5], radius: 4, markerFill: "#c00" },
];

const layer: Layer = {
  z: 1,
  draw(ctx: CanvasRenderingContext2D, view: ViewInfo) {
    ctx.beginPath();
    ctx.arc(view.cx, view.cy, view.radius, 0, 2 * Math.PI);
    ctx.stroke();
  },
};

const flat = new HyperbolicViewport({
  container: "#map",
  width: 600,
  height: 600,
  data: { version: 1, coordinates: "local", drawables },
  styles: { road: { stroke: "#888", lineWidth: 2 } },
  zoom: 1.2,
  rotationMode: ROTATION_COMPASS,
  compassTarget: [0, 1],
  layers: [layer],
  onViewChange: (view) => {
    const [cx, cy] = view.center;
    void (cx + cy + view.zoom + view.rotation + view.bearing);
    void view.interacting;
  },
  onGestureStart: (mode) => {
    const known: "pan" | "rotate" | "pinch" = mode;
    void known;
  },
  onFrame: (stats) => void (stats.drawn + stats.frameMs + stats.viewDistance),
  onAfterDraw: (ctx, view) => {
    ctx.save();
    void view.width;
  },
});

flat.panTo(0.25, -0.5);
flat.setZoom(2);
flat.setRotation(Math.PI / 4);
flat.setMatrix(flat.getMatrix().mul(Isom.rotation(0.1)));
flat.setData([{ type: "marker", at: [0, 0] }], "extra");
flat.addSource("live", async ({ center, visibleRadius, signal }) => {
  const res = await fetch(`/tiles?x=${center[0]}&y=${center[1]}&r=${visibleRadius}`, { signal });
  return (await res.json()) as Drawable[];
});
flat.setSourceTransform("extra", Isom.translationToLocal(0.1, 0.1));
flat.removeSource("extra");

const summary = flat.getView();
const [sx, sy] = flat.toScreen(0, 0);
const back: [number, number] | null = flat.fromScreen(sx, sy);
if (back) void (back[0] + back[1]);
void summary.bearing;
flat.resize(800, 800);
flat.destroy();

// A responsive viewport: aspectRatio derives the height, so `height` is absent.
const responsive = new HyperbolicViewport({
  container: document.body,
  aspectRatio: 1,
  autoResize: true,
  devicePixelRatio: "auto",
  background: "#fff",
  pageBackground: null,
  minFeaturePx: 0,
  interactMinFeaturePx: 0.5,
});
responsive.destroy();

// Options can be built up separately and passed as a value, not only as a literal.
const opts: ViewportOptions = { canvas: document.createElement("canvas"), zoom: 0.8 };
new HyperbolicViewport(opts).destroy();

// ---------------------------------------------------------------------------------------------
// Atlas mode
// ---------------------------------------------------------------------------------------------

const escher = new RegularTiling({ p: 8, q: 3, frameSymmetry: 4 });
const metrics = regularMetrics(8, 3);
void (metrics.circumradius + metrics.inradius + metrics.halfEdge + metrics.centerSpacing);
void escher.stabilizerOrder;
void escher.generatorCount();

const tiled = new HyperbolicViewport<RegularAddress>({
  container: "#map",
  width: 600,
  aspectRatio: 1,
  atlas: {
    tiling: escher,
    tileData: (tile: TileInfo<RegularAddress>) => ({
      version: 1,
      coordinates: "local",
      withinTile: true,
      drawables: [{ type: "text", text: tile.id, at: [0, 0], up: [0, 1] }] as Drawable[],
      lod: [{ type: "marker", at: [0, 0] }] as Drawable[],
    }),
    clip: "auto",
    maxTiles: 200,
    checkTileSymmetry: "warn",
    onTileError: (tile, err) => console.error(tile.id, err),
  },
});

const camera = tiled.getCamera();
tiled.setCamera(camera);
if (camera.address) tiled.panToTile(camera.address, [0, 0]);
const pick = tiled.tileAtScreen(300, 300);
if (pick) {
  const id: string = pick.id;
  const [lx, ly] = pick.local;
  tiled.panToTile(pick.address);
  void (id + lx + ly);
}
void tiled.atlas?.lastTiles.map((t) => t.net.applyToDisk(0, 0, [0, 0]));
void tiled.atlas?.tileSymmetry;
tiled.destroy();

// A binary atlas, driven directly rather than through a viewport.
const dungeon = new BinaryTiling({ drawOrder: "V>>" });
const binaryAtlas = new Atlas<BinaryAddress>({
  tiling: dungeon,
  tileData: async (tile) => {
    const key = `${tile.address.lat},${tile.address.lon}`;
    return { drawables: [{ type: "text", text: key, at: [0, 0], up: [0, 1] }] };
  },
  clip: CLIP_NEVER,
  cacheSize: 1024,
  lodPx: 8,
});
const origin: BinaryAddress = dungeon.originAddress();
void dungeon.addressToString({ lat: origin.lat + 1n, lon: origin.lon * 2n });
void dungeon.neighbors(origin).map((n) => n.gen);
void dungeon.boundaryLocal().halfWidth;
void binaryDrawOrder("H<<")({ address: origin, gen: 0 }, { address: origin, gen: 1 });
const anchor = new Anchor<BinaryAddress>(dungeon, { address: origin });
void anchor.reanchor(Isom.identity()).shift;
void anchor.neighborhood(Isom.identity(), 0.9, 64).length;
void Anchor.maxEntry(Isom.identity());
void binaryAtlas.tileLocalRadius;

// ---------------------------------------------------------------------------------------------
// A custom tiling, implemented from scratch against the documented protocol
// ---------------------------------------------------------------------------------------------

interface SquareAddress {
  path: string;
}

const custom: Tiling<SquareAddress> = {
  metrics: { circumradius: 1.2, centerSpacing: 1.5 },
  stabilizerOrder: 1,
  classModulus: 1,
  originAddress: () => ({ path: "" }),
  addressToString: (a) => a.path || "root",
  addressKey: (a) => a.path,
  addressEquals: (a, b) => a.path === b.path,
  neighbors: (a) => [0, 1, 2, 3].map((gen) => ({ address: { path: a.path + gen }, gen })),
  neighborGens: () => [0, 1, 2, 3],
  extendAddress: (a, gen) => ({ path: a.path + gen }),
  stepFrame: (_a, gen) => Isom.rotation((gen * Math.PI) / 2),
  // An INDEX INTO neighbors(), not a generator index -- they coincide here only because this
  // tiling lists its neighbors in generator order.
  stepToward: (x, y) => (Math.hypot(x, y) < 1 ? -1 : x > 0 ? 0 : 1),
  generator: (i) => Isom.rotation((i * Math.PI) / 2),
  containsLocal: (x, y, tol = 0) => Math.abs(x) <= 0.5 + tol && Math.abs(y) <= 0.5 + tol,
  boundaryLocal: () => ({ points: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] }),
  tileClass: () => 0,
};
void new Atlas<SquareAddress>({ tiling: custom, tileData: () => null });

// Both built-in tilings satisfy the same protocol.
const asProtocol: Array<Tiling<any>> = [escher, dungeon, custom];
void asProtocol.length;

// ---------------------------------------------------------------------------------------------
// Geometry and the exact ring
// ---------------------------------------------------------------------------------------------

const m: IsomType = Isom.rotation(0.3).mul(Isom.translationToLocal(1.5, -0.5)).normalize();
const out: [number, number] = [0, 0];
m.applyToLocal(1, 2, undefined, out);
m.applyToLocal(1, 2, localCompanion(1, 2), out);
m.applyToDisk(0.1, 0.2, new Float64Array(2));
void [m.north(), m.screenRotation(), m.distanceMoved(), m.detError()];
void m.centerLocal(out);
void movePointToPoint(0, 0, 0.3, 0.4).inverse();
void localToDisk(1, 1, out);
void diskToLocal(0.5, 0.5, out);
void halfPlaneToLocal(0, 1, out);
void localDistance(0, 0, 1, 1);
void coshHalfDistance(0, 0, undefined, 1, 1, undefined);
void capThreshold(0.9, Cap.enclosing(new Float64Array([0, 1]), new Float64Array([0, 1]), 0, 2).radius);
void clampToRadius(2, 2, 0.9);
void geodesicArc(0.1, 0.1, 0.4, 0.4, new Arc(), 0.25).anticlockwise;
void compileDrawables(drawables, { default: DEFAULT_STYLE })[0]?.cap;
void new StaticSource(drawables).drawables.length;

const ring = new ExactRing(8);
const two = ring.fromInt(2);
void ring.serialize(ring.mul(two, ring.mu()));
void ring.cmp(two, ring.one());
void ring.isSmall(two);
void minPolyFor2Cos(8)[0];
const cox = buildExactCoxeter(8, 3);
void serializeExactVector(cox.R, cox.vO, 8, 3, 4);

// Narrowing the drawable union works.
for (const d of drawables) {
  if (d.type === "path") void d.points.length;
  else if (d.type === "text") void d.text.toUpperCase();
  else void d.at[0];
}

// ---------------------------------------------------------------------------------------------
// What must NOT compile
// ---------------------------------------------------------------------------------------------

// A misspelled top-level option is an error, exactly as it is at run time.
// @ts-expect-error
new HyperbolicViewport({ container: "#map", witdh: 600 });

// ...and so is a misspelled option inside `atlas`.
new HyperbolicViewport({
  container: "#map",
  // @ts-expect-error
  atlas: { tiling: escher, tileData: () => null, maxTiels: 5 },
});

// `aspectRatio` derives the height, so giving `height` too is refused.
// @ts-expect-error
new HyperbolicViewport({ container: "#map", aspectRatio: 1, height: 300 });

// Wrong primitive types.
// @ts-expect-error
new HyperbolicViewport({ container: "#map", width: "600" });

// String-literal options are closed sets, not bare strings.
// @ts-expect-error
new HyperbolicViewport({ container: "#map", rotationMode: "compas" });
// @ts-expect-error
new Atlas({ tiling: escher, tileData: () => null, clip: "sometimes" });
// @ts-expect-error
new BinaryTiling({ drawOrder: "X>>" });

// An atlas needs both of its required options.
// @ts-expect-error
new Atlas({ tiling: escher });

// A tiling missing a required member of the protocol is not a tiling.
const incomplete: Tiling<SquareAddress> = {
  // @ts-expect-error
  metrics: { circumradius: 1 },
  stabilizerOrder: 1,
  classModulus: 1,
  originAddress: () => ({ path: "" }),
  addressToString: (a) => a.path,
  addressKey: (a) => a.path,
  addressEquals: (a, b) => a.path === b.path,
  neighbors: () => [],
  neighborGens: () => [],
  extendAddress: (a) => a,
  stepFrame: () => Isom.identity(),
  stepToward: () => -1,
  generator: () => Isom.identity(),
  containsLocal: () => true,
  boundaryLocal: () => ({ points: [] }),
  tileClass: () => 0,
};
void incomplete;

// tileAtScreen can return null, and the compiler insists you notice.
// @ts-expect-error
void tiled.tileAtScreen(0, 0).id;

// fromScreen too.
// @ts-expect-error
void flat.fromScreen(0, 0)[0];

// A drawable must say what kind it is.
// @ts-expect-error
const untyped: Drawable = { points: [[0, 0]] };
void untyped;

// The union is discriminated: `text` has no `points`.
// @ts-expect-error
void drawables.filter((d) => d.type === "text").map((d) => d.points);

// `SourceSet` and `TileSymmetryError` are types, not values. They are reachable at run time -- as
// `viewport.sources` and as a thrown error -- but they are not exported, so using either as a value
// must fail. (Read through the namespace rather than an import clause: imports hoist, so the error
// on a bare `import { SourceSet }` would land here anyway and read as if the import were fine.)
// @ts-expect-error
void HM.SourceSet;
// @ts-expect-error
void HM.TileSymmetryError;
// The types themselves are importable, and `viewport.sources` really is one.
const sources: HM.SourceSet = flat.sources;
void sources.has("default");
