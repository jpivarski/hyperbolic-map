# hyperbolic-map-widget

An interactive viewer for vector maps of the **hyperbolic plane**, drawn in the Poincaré disk.
Scroll and rotate it like any map — except that the space it shows has more room in it than a flat
map could ever hold: every step outward reveals exponentially more.

Zero runtime dependencies. Plain JavaScript (ES2020). Mouse and multi-touch.

**[Live examples →](https://jpivarski.github.io/hyperbolic-map-widget/)**

- [The mathematics](docs/MATH.md) — what the coordinates mean and how the projection works.
- [Implementation notes](notes/) — the audit, the design decisions, and the reasoning behind them.

This is a revival of a 2011–2012 experiment ([hyperbolic-storage-space](https://github.com/jpivarski/hyperbolic-storage-space),
written up as *Lost in Hyperbolia*), which paired a Java servlet with a browser client. The server and
the blog are gone. The client has been rewritten from scratch, the example data recovered from the
original database files, and the mathematics re-derived and checked — which turned up several real
errors in the original, all documented in [`notes/math-audit.md`](notes/math-audit.md).

---

## Install

```sh
npm install hyperbolic-map-widget
```

```js
import { HyperbolicViewport } from "hyperbolic-map-widget";
```

Or drop in the bundle and use the `HyperbolicMap` global:

```html
<script src="hyperbolic-map.iife.js"></script>
<script>
  const viewport = new HyperbolicMap.HyperbolicViewport({ /* ... */ });
</script>
```

## Quick start

```js
const viewport = new HyperbolicViewport({
  container: "#map",
  width: 500,
  height: 500,
  data: {
    version: 1,
    coordinates: "local",
    drawables: [
      { type: "path", points: [[0, 0, "L"], [1, 0, "L"], [0.5, 1, "L"]], closed: true,
        fill: "#cde", stroke: "#036" },
      { type: "text", text: "hello", at: [0, 1.5], up: [0, 1.8], fill: "#036" },
    ],
  },
});
```

Drag inside the disk to scroll, drag the outer ring to rotate, wheel to zoom. On a touchscreen: one
finger scrolls, two fingers pinch and twist.

## Coordinates in one paragraph

A point is a pair `(x, y)`. Its distance from the origin is `d = 2·asinh(√(x²+y²))`, so `√(x²+y²)`
is `sinh(d/2)` — the plane is covered by ordinary finite numbers, with no crowding near a boundary.
The viewer projects them into the Poincaré disk, where straight lines (geodesics) appear as circular
arcs. Angles are true; distances are not. [`docs/MATH.md`](docs/MATH.md) has the details, including
why the half-angle is there.

---

## Options

Every option is optional except a place to draw. Unknown option names **throw**, because a silently
ignored typo in an options object is a miserable way to lose an afternoon.

### Where it draws

| option | default | meaning |
|---|---|---|
| `container` | — | CSS selector or element; a `<canvas>` is created inside it |
| `canvas` | — | use an existing canvas instead |
| `width`, `height` | container size, or 400 | CSS pixels |
| `autoResize` | `false` | follow the container's size with a `ResizeObserver` |
| `devicePixelRatio` | `"auto"` | `"auto"`, or a number. `1` reproduces the 2011 blurriness on HiDPI |
| `radiusBasis` | `"min"` | `"min"` fits the disk to the smaller side; `"width"` is the 2011 behaviour, which overflows a portrait canvas |

### What it draws

| option | default | meaning |
|---|---|---|
| `data` | `null` | drawables, as an array or a `{version, drawables}` document |
| `dataProvider` | `null` | `async ({centre, zoom, drawRadius, visibleRadius, signal}) => data` |
| `atlas` | `null` | see [Atlas](#atlas-of-tiles) |
| `styles` | `null` | named style classes, referenced by a drawable's `class` |

### The initial view

| option | default | meaning |
|---|---|---|
| `center` | `null` | the data point to put in the middle |
| `offsetX`, `offsetY` | `0` | the raw view offset — the negation of `center` |
| `rotation` | `0` | radians |
| `zoom` | `0.95` | the disk's radius as a fraction of half the canvas |
| `minZoom`, `maxZoom` | `0.5`, `null` | clamps; `null` means unbounded |

### Interaction

| option | default | meaning |
|---|---|---|
| `interactive` | `true` | master switch |
| `allowPan`, `allowZoom`, `allowRotate` | `true` | **these actually gate everything** — in 2011 they were consulted only in the two-finger path, so `allowZoom: false` pages were still wheel-zoomable |
| `rimRotate` | `true` | dragging the outer ring rotates |
| `panClamp` | `true` | dragging past the rim clamps. `false` reproduces the 2011 *freeze*, which is half of the old stuck-drag bug |
| `wheelZoom`, `wheelZoomStep` | `true`, `1.1` | |
| `rotationMode` | `"parallel-transport"` | or `"compass"` |
| `compassTarget` | `[0, 1]` | the ideal point held at a fixed bearing in compass mode |
| `interactRadius` | `0.9` | inside this, drag scrolls; outside it, drag rotates |
| `drawRadius` | `1.0` | content beyond this is culled |

### Appearance

| option | default | meaning |
|---|---|---|
| `background` | `"#ffffff"` | the disk's interior |
| `pageBackground` | `null` | the whole canvas, behind everything |
| `rimFill`, `rimStroke`, `rimLineWidth` | `"#f5d6ab"`, `"#000000"`, `1.5` | the rotatable annulus |
| `cullMode` | `"cap"` | or `"endpoints"` for the 2011 test, which drops long edges crossing the view |
| `arcMode` | `"sagitta"` | or `"fixed"` for the 2011 zoom-independent threshold |
| `sagittaTolerancePx` | `0.25` | when an arc may be drawn as a straight chord |
| `decimateTolerancePx` | `0.25` | drop a vertex projecting within this distance of the last one drawn |
| `minFeaturePx` | `0` | skip a shape whose projected size (including its stroke) is below this |
| `interactMinFeaturePx` | `0.5` | `minFeaturePx` used only while a gesture is in flight |
| `minTextPx` | `3` | text smaller than this is skipped |

### Hooks

`onBeforeDraw` and `onAfterDraw` receive `(ctx, view)`; `layers` is an array of
`{z, draw(ctx, view), attach?, detach?}`. Everything with `z < 0` is drawn **before** the disk's
opaque fill, so it shows only outside the disk.

```
1  pageBackground        4  content
2  layers z < 0          5  the rim annulus
3  onBeforeDraw          6  layers z >= 0, then onAfterDraw
   → disk fill
```

The `view` object passed to a hook is read-only: `{width, height, cx, cy, radius, zoom, rotation,
bearing, matrix, ctxScale, drawRadius, interactRadius, effectiveRadius, interacting, toScreen,
fromScreen}`.

This is why there are no image options. The 2011 viewer had `shellImage` and `backgroundImage`,
which baked one example's art — a world-turtle on a field of stars — into the library.
[`docs/demo/layers.js`](docs/demo/layers.js) reproduces exactly that look from outside, in about
forty lines, with one layer rotating with the disk and one not.

Also available: `onDrawBackground`, `onDrawRim`, `onViewChange`, `onGestureStart`, `onGestureEnd`,
`onFrame`.

### Methods

`getView()`, `getMatrix()`, `setMatrix(isom)`, `setZoom(z)`, `setRotation(θ)`, `panTo(x, y)`,
`getCamera()`, `setCamera(camera)`, `panToTile(address, local?)`,
`setData(data, name?)`, `addSource(name, dataOrCallback, {transform})`, `removeSource(name)`,
`setSourceTransform(name, isom)`, `toScreen(x, y)`, `fromScreen(px, py)`, `invalidate()`,
`render()`, `resize(w, h)`, `destroy()`.

**In atlas mode, use `getCamera`/`setCamera`/`panToTile`.** The first four take and return *global*
coordinates, and far from the origin no global coordinate can be represented — that is the whole
reason the atlas is anchored (see [Atlas of tiles](#atlas-of-tiles)). Their meaning is unchanged and
they remain correct in single-patch mode and while the camera is still anchored to the origin tile;
past that they **throw**, naming `getCamera()`, rather than returning a plausible wrong number.

```js
const cam = viewport.getCamera();   // { address, matrix, zoom } -- matrix is anchor-relative
viewport.setCamera(cam);            // exact round trip
viewport.panToTile(address, [0, 0]); // centre a tile, at any distance
```

`setSourceTransform` is worth knowing about: it applies an extra isometry to one named source without
recompiling its drawables. The clock example rotates its hands with it once a second, which is an
O(1) matrix change rather than rebuilding every hand.

### 2011 option names

Accepted, with a one-time deprecation warning.

| 2011 | now |
|---|---|
| `initialOffsetX`, `initialOffsetY` | `offsetX`, `offsetY` (or `center`, which is the negation) |
| `initialRotation`, `initialZoom` | `rotation`, `zoom` |
| `viewThreshold` | `interactRadius` |
| `zoomMouseWheel` | `wheelZoomStep` |
| `backgroundColor` | `background` |
| `rimFillStyle`, `rimStrokeStyle` | `rimFill`, `rimStroke` |
| `downloadThreshold` | gone — the data source gates its own requests |
| `backgroundImage`, `shellImage`, `shellImageScale` | gone — use `layers` |

---

## The drawable format

A document is `{"version": 1, "coordinates": "local", "drawables": [...]}`, or just a bare array.
Coordinates are always in the local system described above (or, inside an atlas, relative to the
tile's own centre).

### `path`

```json
{"type": "path",
 "points": [[0.1, 0.2, "L"], [0.4, 0.2, "L"], [0.3, 0.5]],
 "closed": true,
 "fill": "#cde", "stroke": "#036", "lineWidth": 2}
```

A point's optional third element is a **flag string for the edge leaving that point**:

- `"L"` — stroke that edge;
- absent — the edge still takes part in the fill, but is not stroked;
- `"P"` — also draw a marker at this point.

So the fill path always closes while the stroke may be disconnected. This is inherited from the 2011
format and kept deliberately: a move/line command model cannot express a closed fill with a
disconnected outline without duplicating the geometry.

### `text`

```json
{"type": "text", "text": "48", "at": [0.0, 1.2], "up": [0.0, 1.4],
 "fill": "#000", "align": "center", "baseline": "bottom"}
```

`at` is the anchor and `up` is a second point giving the text's up direction. The distance between
their *projections* sets the size, so text foreshortens with the geometry around it. Text smaller
than `minTextPx` is skipped.

### Why `decimateTolerancePx` matters more here than on a flat map

The Poincaré projection compresses unbounded area into the rim, so in any large scene most shapes
arrive far smaller than a pixel. On the Escher fixture at its default view, 59 % of edges are shorter
than half a pixel and 39 % shorter than a quarter, and 22,894 of the 38,640 shapes fit entirely
inside a single pixel. Every one of those edges still costs a canvas call.

`decimateTolerancePx` drops a vertex that projects within that distance of the last vertex actually
emitted — measured against the last *emitted* point, not the previous vertex, so a long run of small
steps cannot accumulate into visible drift. At the default 0.25 px this removes about half the
vertices and roughly a quarter of the frame time, while changing twelve colour channels out of
780,000 by a maximum of 2/255. Set it to `0` for an exact rendering.

`minFeaturePx` is the blunter version: drop the whole shape. It defaults to off because it is only
lossless for *unstroked* art — a shape 0.3 px across drawn with a 2 px stroke still paints a 2 px
mark, so the threshold is compared against the projected size **plus** the stroke width. On art where
everything is stroked, as the Escher fixture is, it correctly skips almost nothing.

### `marker`

```json
{"type": "marker", "at": [0.3, 0.7], "radius": 3.5, "fill": "#000"}
```

### Shared fields

`class` selects a named style from `styles`; `fill`, `stroke`, `lineWidth`, `lineCap`, `lineJoin`,
`miterLimit`, `align`, `baseline`, `font` override it. `visibleFrom` / `visibleTo` gate a drawable by
level of detail. Use `"none"` for no fill or no stroke.

The 2011 shape (`{"type": "polygon", "d": [...], "fillStyle": ..., "ax"/"ay"/"upx"/"upy"}`) is
detected and converted automatically, so old data still loads.

---

## Atlas of tiles

Instead of one global coordinate system, give each tile of a tiling its own. Two reasons:

- **Precision.** Data far from the origin loses resolution in a single patch: at hyperbolic distance
  20 the disk coordinate is `1 − 3.6e-9`, so only about seven significant digits remain in the
  quantity that matters. In an atlas every coordinate is small and measured from its own tile's
  centre.
- **Infinite repeats.** Return the same tile for every address and the pattern never ends.

### Nothing is ever expressed globally

This is the part that makes the atlas actually work, rather than merely postponing the problem. A
tile's frame relative to the *world* has entries of order `cosh(d/2)` — 1.08e75 for binary cell
(500, 0) — so composing it with an equally large view matrix to get an O(1) screen position destroys
every digit. So neither is ever formed. The view is stored relative to the **camera's own tile**:

```
V_c    = V · F_c          the view, in the camera tile's frame
R_c→k  = F_c⁻¹ · F_k      a tile's frame relative to the camera, one constant generator per walk step
net    = V_c · R_c→k      both factors O(1) for every tile that can be on screen
```

When the camera would drift away from its tile it changes tile instead, multiplying `V_c` by one small
generator. `viewport.stats.maxViewEntry` is the number that shows this working: it stays near 1 no
matter how far you scroll. Measured consequences — the rendered picture is **byte-identical** at 1, 5,
50, 500 and 5000 tiles from the origin across nine tilings, and screen-position error against a
60-digit reference is flat at ~5e-16 at every distance. `docs/tiling-diagnostics.html` runs those
checks in the browser; `tools/audit_atlas_math.py` and `tools/audit_atlas_numeric.py` are the audits.

```js
const viewport = new HyperbolicViewport({
  container: "#map",
  atlas: {
    tiling: new RegularTiling({ p: 8, q: 3, frameSymmetry: 4 }),
    tileData: async (tile) => {
      // tile.address (also aliased as tile.key) identifies the tile; tile.id is its string form and
      // tile.relativeFrame is its position relative to the camera, if you want it.
      // Return DATA in TILE-LOCAL coordinates. Never rotate anything yourself.
      const res = await fetch(`tiles/${tile.id}.json`);
      return res.json();
    },
    clip: "auto",     // "always" | "never" | "auto" (honours a tile's `withinTile: true`)
    maxTiles: 200,
    cacheSize: 512,
  },
  anchor: { lat: -1n, lon: 0n },   // optional: open on a given tile, at any distance
});
```

The callback returns **data, not URLs**, so it can fetch, synthesise infinite content, or merge
several overlays. Placing and rotating each tile is always the library's job.

### `RegularTiling({p, q, frameSymmetry})`

The `{p, q}` tilings: regular `p`-gons, `q` meeting at each vertex, which exist whenever
`1/p + 1/q < 1/2`. Addresses are arrays of generator indices — a word describing a walk from the
origin tile. Two different words can name the same tile (the group has braid relations), so the walk
also deduplicates geometrically; see `notes/open-questions.md` for the measured extent of that and the
Coxeter automaton that would remove it.

`frameSymmetry` (a divisor of `p`, default `p`) declares the rotational symmetry **your art has**,
and it matters more than it looks. Repeating one tile everywhere produces a consistent pattern only
if the art is invariant under the tile's stabiliser in the walk group. If your art is only `m`-fold
symmetric, say so, and the library picks generators whose stabiliser is `C_m`. See
[`docs/MATH.md`](docs/MATH.md#tilings) — for Escher's *Circle Limit III* this must be `4`, not `8`,
and the natural general-purpose generator (a half-turn about an edge midpoint) is the wrong one.

### `BinaryTiling()`

The binary (Böröczky) tiling, addressed by `{lat, lon}` as **BigInt**. Point-to-cell is two `floor`s,
which no `{p,q}` scheme can match, and the integer addresses make natural filenames and are canonical:
one cell, one address, no ambiguity. BigInt because descending one latitude doubles the longitude, so
about fifty levels down a plain number stops being exact — and addresses are identity only, never
geometry, so it costs nothing per frame. Cells are congruent but not
regular polygons — two sides are geodesics and two are horocycles — and the tiling is *not*
tile-transitive, so it cannot make a seamless repeating pattern. It is the right choice for a map,
and it is what the 2011 server used.

### Writing your own

Everything is local: a tiling is never asked where a tile is in the world, only how to step between
neighbours.

```js
{
  metrics: { circumradius, centreSpacing },   // sizes the walk
  originAddress(),                            // the tile containing the origin
  addressToString(address),                   // canonical string, for caching and filenames
  addressEquals(a, b),
  neighbours(address),                        // [{ address, gen }] -- gen indexes the generator table
  generator(i),                               // Isom, CONSTANT: neighbour-local -> this tile's local
  inverseGenerator(i),                        // the index that undoes generator i
  generatorCount(),
  containsLocal(x, y, tol?),                  // is this tile-local point inside this tile?
  boundaryLocal(),                            // for clipping, in tile-local coordinates
  addressesAreCanonical,                      // true if one tile has exactly one address
}
```

The generators must be **constant matrices** — independent of which tile you are in. That is what
makes a walk a product of small factors, and it is the whole trick. In SU(1,1) an edge half-turn
squares to `−I` rather than `+I` (the spin double cover), so `inverseGenerator` may return the index of
a matrix equal to the negation of the inverse; any comparison of frames must work **up to sign**.

---

## Development

```sh
npm test          # node:test, no dependencies
npm run check     # enforce the source constraints the bundler relies on
npm run build     # produce dist/ and refresh docs/lib/
npm run serve     # serve docs/ at http://localhost:8000
```

The browser bundle is built by concatenating `src/` in dependency order, with no bundler. That is
only valid because the source style is constrained — single-line intra-package imports at the top of
each file, `export class|function|const|let` declarations only, no dynamic `import()`, no top-level
`await`, no cross-module name collisions — and `tools/check-bundle.mjs` enforces exactly those rules.

`tools/*.py` regenerate the example data from the original 2011 databases. They are local-only and
need `OLD/`, which is not in the repository.

Please read [`AGENTS.md`](AGENTS.md) and [`notes/`](notes/) before changing anything mathematical.
[`notes/math-audit.md`](notes/math-audit.md) records what was verified **correct** as well as what was
broken — several parts of the original code look wrong and are not.

## Licence

BSD 3-Clause. See [LICENSE](LICENSE).

Escher's *Circle Limit III* is used here as a hand-traced study for a mathematical demonstration.
