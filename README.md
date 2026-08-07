# Hyperbolic Map Widget

A JavaScript map widget that draws vector graphics on [the hyperbolic plane](https://en.wikipedia.org/wiki/Hyperbolic_geometry), projected as [a Poincaré disk](https://en.wikipedia.org/wiki/Poincar%C3%A9_disk_model). Think of it like Google Earth for a negatively curved surface, rather than a sphere, which is positively curved.

**See the demos:** https://jpivarski.github.io/hyperbolic-map-widget/

Scroll by dragging one finger or the mouse, pinch or mouse wheel to zoom, and rotate by twisting two fingers or dragging the outer ring with a mouse.

The library is pure JavaScript (ES2020) without any runtime dependencies. It has been modernized and packaged from my 2012 blog post, [Lost in Hyperbolia](http://coffeeshopphysics.com/articles/2012-12/22_lost_in_hyperbolia/) (with associated [GitHub repo](https://github.com/jpivarski/hyperbolic-storage-space)).

## Install

```bash
npm install hyperbolic-map-widget
```

```js
import { HyperbolicViewport } from "hyperbolic-map-widget";
```

or drop in the bundle and use the `HyperbolicMap` global:

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

Replace `drawables` with your own vector art, and use scripts from the [tools/](tools/) directory to convert between JSON and SVG.

The coordinates $(x, y)$ are projected onto the screen as $(\frac{x}{w}, \frac{y}{w})$ with $w = \sqrt{1 + x^2 + y^2}$ when the viewport is at the origin.

**There are two primary drawing modes:**
* a single coordinate system, as above (specify `data` or `dataProvider`);
* an [atlas of tiles](#atlas-of-tiles) (specify `atlas`), the space is divided into regular tiles, each with its own local coordinate system. A `tiling` scheme defines the placement of tiles, such as regular polygons or a binary tree, and you write a `tileData` function that returns drawables by tile index. This makes it easier to express repeating patterns and avoids floating-point errors at large distances from the origin.

## Options

All are optional except that either a `container` or a `canvas` must be supplied. An unrecognized option name raises an error.

### Where it draws

| option | default | meaning |
|---|---|---|
| `container` | — | CSS selector or element; a `<canvas>` is created inside it |
| `canvas` | — | use an existing canvas instead |
| `width`, `height` | container size or 400 | CSS pixels |
| `autoResize` | `false` | follow the container's size with a `ResizeObserver` |
| `devicePixelRatio` | `"auto"` | `"auto"`, or a number. |
| `radiusBasis` | `"min"` | `"min"` fits the disk to the smaller side; `"width"` overflows a portrait canvas |

### What it draws

| option | default | meaning |
|---|---|---|
| `data` | `null` | drawables, as an array or a `{version, drawables}` document |
| `dataProvider` | `null` | `async ({centre, zoom, drawRadius, visibleRadius, signal}) => data` |
| `atlas` | `null` | see [atlas of tiles](#atlas-of-tiles) |
| `styles` | `null` | named style classes, referenced by a drawable's `class` |

### The initial view

| option | default | meaning |
|---|---|---|
| `center` | `null` | the data point to put in the middle |
| `offsetX`, `offsetY` | `0` | the raw view offset—the negation of `center` |
| `rotation` | `0` | radians |
| `zoom` | `0.95` | the disk's radius as a fraction of half the canvas |
| `minZoom`, `maxZoom` | `0.5`, `null` | clamps; `null` means unbounded |

### Interaction

| option | default | meaning |
|---|---|---|
| `interactive` | `true` | no interactivity if `false` |
| `allowPan`, `allowZoom`, `allowRotate` | `true` | allow panning/scrolling, zooming, and rotation |
| `rimRotate` | `true` | dragging the outer ring rotates |
| `panClamp` | `true` | dragging past the rim clamps |
| `wheelZoom`, `wheelZoomStep` | `true`, `1.1` | |
| `rotationMode` | `"parallel-transport"` | or `"compass"` to keep one direction fixed |
| `compassTarget` | `[0, 1]` | the direction held fixed in compass mode |
| `interactRadius` | `0.9` | inside this, drag scrolls; outside it, drag rotates |
| `drawRadius` | `1.0` | content beyond this is culled |

### Appearance

| option | default | meaning |
|---|---|---|
| `background` | `"#ffffff"` | the disk's interior color |
| `pageBackground` | `null` | the whole canvas, behind the disk |
| `rimFill`, `rimStroke`, `rimLineWidth` | `"#f5d6ab"`, `"#000000"`, `1.5` | the rotatable annulus around the disk |
| `cullMode` | `"cap"` | or `"endpoints"` |
| `arcMode` | `"sagitta"` | or `"fixed"` |
| `sagittaTolerancePx` | `0.25` | when an arc may be drawn as a straight chord |
| `decimateTolerancePx` | `0.25` | drop a vertex projecting within this distance of the last one drawn |
| `minFeaturePx` | `0` | don't draw a shape whose projected size (including its stroke) is below this threshold |
| `interactMinFeaturePx` | `0.5` | `minFeaturePx` used only while a gesture is in flight |
| `minTextPx` | `3` | don't draw text smaller than this threshold |

### Hooks

`onBeforeDraw` and `onAfterDraw` receive `(ctx, view)`; `layers` is an array of `{z, draw(ctx, view), attach?, detach?}`. Everything with `z < 0` is drawn before the disk's opaque fill, so it shows only outside the disk.

Draw order:
1. `pageBackground`
2. layers with `z < 0`
3. `onBeforeDraw`
4. disk interior filled with `background` color or `onDrawBackground`
5. all drawables
6. the rim annulus or `onDrawRim`
7. layers with `z >= 0`
8. `onAfterDraw`

Steps 4 and 6 are alternatives: supplying `onDrawBackground` or `onDrawRim` suppresses the default fill rather than drawing over it.

The `view` object passed to a hook is read-only: `{width, height, cx, cy, radius, zoom, rotation, bearing, matrix, ctxScale, drawRadius, interactRadius, effectiveRadius, interacting, toScreen, fromScreen}`.

Also available: `onDrawBackground`, `onDrawRim`, `onViewChange`, `onGestureStart`, `onGestureEnd`, `onFrame`.

### Methods

**Reading and moving the view.**

| method | what it does |
|---|---|
| `getView()` | the live view as `{center, zoom, rotation, bearing, interacting}`; `center` is the local point at the middle of the disk, and round-trips with `panTo` |
| `getMatrix()` | a *copy* of the live view isometry, so mutating it is safe |
| `setMatrix(isom)` | replace the view isometry; it is normalised on the way in, and the jump is not animated |
| `setZoom(z)` | set the zoom, clamped to `minZoom`/`maxZoom` |
| `setRotation(θ)` | set the *absolute* screen rotation in radians, not a relative turn |
| `panTo(x, y)` | put that local point at the middle of the disk |

**The camera (atlas mode).**

| method | what it does |
|---|---|
| `getCamera()` | the whole camera as `{address, matrix, zoom, rotation, bearing, interacting}` — the only form that stays valid at any distance; `address` is `null` without an atlas, and `matrix` is relative to the anchor tile |
| `setCamera(camera)` | restore a camera from `getCamera()`, as an exact round trip |
| `panToTile(address, local?)` | put that tile's `local` point (default `[0, 0]`, its centre) at the middle of the disk; atlas only |

**Data sources.** The first three refuse in atlas mode, because a source's coordinates are global.

| method | what it does |
|---|---|
| `setData(data, name?)` | replace one named source's drawables, defaulting to `"default"` — the source that `data` or `dataProvider` created |
| `addSource(name, dataOrCallback, {transform})` | add or replace a named source, either drawables or an `async view => data` callback; returns the source object |
| `setSourceTransform(name, isom)` | give one source an extra isometry without recompiling its drawables; throws if there is no such source |
| `removeSource(name)` | drop a named source and dispose it, aborting any fetch still in flight |
| `refreshSources()` | make every async source re-request for the current view, bypassing its throttle and significance gate |

**Screen coordinates.**

| method | what it does |
|---|---|
| `toScreen(x, y)` | local point → `[px, py]` in CSS pixels |
| `fromScreen(px, py)` | CSS pixels → local `[x, y]`, or `null` if the pixel is outside the disk |
| `tileAtScreen(px, py)` | which tile is under that pixel: `{address, id, local}`, or `null` outside the disk; atlas only |

**Lifecycle.**

| method | what it does |
|---|---|
| `invalidate()` | ask for a redraw on the next animation frame; repeated calls coalesce into one, and this is the normal way to request a frame |
| `render()` | draw right now, synchronously—usually you want `invalidate()` instead |
| `resize(w, h)` | resize the canvas, in CSS pixels |
| `destroy()` | cancel any pending frame, remove event listeners, dispose sources, detach layers, and remove the canvas if the widget created it |

In atlas mode (see [atlas of tiles](#atlas-of-tiles)), use `getCamera`/`setCamera`/`panToTile` instead of `getView`/`getMatrix`/`setMatrix`/`panTo`. Those four take and return global coordinates, and far from the origin no global coordinate can be represented—that is the whole reason the atlas is anchored. Their meaning is unchanged and they remain correct in single-patch mode and while the camera is still anchored to the origin tile; past that they raise errors, naming `getCamera()`, rather than returning a wrong number.

(`setZoom` and `setRotation` are unaffected: zoom and screen rotation are not global-coordinate quantities, so they work the same in either mode.)

```js
const cam = viewport.getCamera();    // the whole camera; cam.matrix is anchor-relative
viewport.setCamera(cam);             // exact round trip
viewport.panToTile(address, [0, 0]); // centre a tile, at any distance
viewport.tileAtScreen(px, py);       // { address, id, local }; which tile is at px, py?
```

`toScreen` and `fromScreen` work in whatever frame the view is expressed in: the global frame in single-patch mode, the current anchor tile's frame in atlas mode (pair them with `getCamera().address`). `tileAtScreen` is the atlas-mode picking question, and it deliberately answers with the address the *renderer* used, so it agrees with what is on screen even for tilings whose word addresses are not canonical.

`setSourceTransform` applies an extra isometry to one named source without recompiling its drawables. The clock example rotates its hands with it once a second, which is an $\mathcal{O}(1)$ matrix change rather than rebuilding every hand.

## The drawable format

A document is `{"version": 1, "coordinates": "local", "drawables": [...]}`, or just a bare array. Coordinates are always in the local system described above (or, inside an atlas, relative to the tile's own centre).

### `path`

```json
{"type": "path",
 "points": [[0.1, 0.2, "L"], [0.4, 0.2, "L"], [0.3, 0.5]],
 "closed": true,
 "fill": "#cde", "stroke": "#036", "lineWidth": 2}
```

A point's optional third element is a flag string for the edge leaving that point:

- `"L"` — stroke that edge;
- absent — the edge still takes part in the fill, but is not stroked;
- `"P"` — also draw a marker at this point.

So the fill path always closes while the stroke may be disconnected. This is deliberate: a move/line command model cannot express a closed fill with a disconnected outline without duplicating the geometry.

### `text`

```json
{"type": "text", "text": "48", "at": [0.0, 1.2], "up": [0.0, 1.4],
 "fill": "#000", "align": "center", "baseline": "bottom"}
```

`at` is the anchor and `up` is a second point giving the text's up direction. The distance between their _projections_ sets the size, so text foreshortens with the geometry around it. Text smaller than `minTextPx` is skipped.

### `marker`

```json
{"type": "marker", "at": [0.3, 0.7], "radius": 3.5, "fill": "#000"}
```

### Shared fields

`class` selects a named style from `styles`; `fill`, `stroke`, `lineWidth`, `lineCap`, `lineJoin`, `miterLimit`, `align`, `baseline`, `font` override it. Use `"none"` for no fill or no stroke.

## Atlas of tiles

Instead of one global coordinate system, give each tile of a tiling its own. Two reasons:

- **Infinite repeats.** Return the same tile for every address for a repeating pattern.
- **Precision.** Data far from the origin loses resolution in a single patch: at hyperbolic distance 20 the disk coordinate is `1 − 3.6e-9`, so only about seven significant digits remain in the quantity that matters. In an atlas, every coordinate is measured from its own tile's centre.

To use it, pass an `atlas` instead of `data` or `dataProvider`:

```js
const tiling = new RegularTiling({ p: 8, q: 3, frameSymmetry: 4 });

const viewport = new HyperbolicViewport({
  container: "#map",
  atlas: {
    tiling: tiling,
    tileData: async (tile) => {
      // tile.address identifies the tile; tile.id is its string form and
      // tile.relativeFrame is its position relative to the camera, if you want it.
      // Return DATA in TILE-LOCAL coordinates.
      const res = await fetch(`tiles/${tile.id}.json`);
      return res.json();
    },
    clip: "auto",     // "always" | "never" | "auto" (honours a tile's `withinTile: true`)
    maxTiles: 200,
    cacheSize: 512,
    lodPx: 11,        // below this on-screen tile radius, use the tile's `lod` art if any
  },
  // Optional: open on a given tile rather than the origin, however far out it is.
  // The address must be one of THIS tiling's own—a walk word for RegularTiling (usually
  // a saved `getCamera().address`), or `{lat, lon}` BigInts for BinaryTiling.
  anchor: tiling.originAddress(),
});
```

The `tile` index is a route from the origin to the tile, which is not unique for a given tile. It is a description of a path, such as "2 steps right, 1 step up," as opposed to "1 step up, 2 steps right." If the art returned by `tileData` does not take these congruences into account, its appearance may abruptly change as the user scrolls.

The `tile.classIndex` is a safe key for coloring art, but not for determining its orientation.

To draw a regular tiling of the hyperbolic plane, such as M.C. Escher's _Circle Limit_ series, make sure that
* the tile art is invariant under a rotation of `2π/m` around the polygon's center, where `m` is the `frameSymmetry`;
* the return value of `tileData` does not depend on the `tile` index.

The library can check this automatically:

```js
atlas: {
  checkTileSymmetry: "warn",   // "warn" (default) | "throw" | "off"
}
viewport.atlas.tileSymmetry;   // { residual, checked, m, ok }; residual = 0 means ok
```

### Performance hints

**Return data synchronously when you can.** A callback that returns a plain object (rather than a promise) is compiled and drawn in the *same* frame. That matters more than it sounds: `{p,q}` addresses are not canonical, so when the camera re-anchors the walk renames many tiles at once and they all miss the cache together. Measured on `{7,3}`, going through a promise made 26 tiles vanish for exactly one frame on every tile crossing—a visible flicker. Asynchronous providers still work exactly as before; they just cannot avoid the first frame.

**Return the same object for tiles that look the same.** Compiled art is memoised on the identity of the object you return, so a provider that hands back one of a few shared objects never pays to recompile.

**Prevent very small tiles from drawing.** Tiles smaller than the `lodPx` threshold are replaced by `lod`, which may be a solid color.

### Regular tiling

Use the `RegularTiling({p, q, frameSymmetry})` class.

The `{p, q}` tilings: regular `p`-gons, `q` meeting at each vertex, which exist whenever `1/p + 1/q < 1/2`. An address is a word over the generator indices—a walk from the origin tile. Treat it as opaque: it is stored as a linked cell (`{gen, prev, len, …}`) rather than an array, so that extending one is $\mathcal{O}(1)$ and a walk thousands of steps long stays cheap. Use `addressToString` for a printable form. Two different words can name the same tile (the group has braid relations), so the walk also deduplicates geometrically; see `notes/open-questions.md` for the measured extent of that and the Coxeter automaton that would remove it.

`frameSymmetry` (a divisor of `p`, default `p`) declares the rotational symmetry your art has, and it selects the walk group so that the tile stabiliser is exactly `C_m`. If your art is not invariant under rotations of `2π/m`, polygons will appear to rotate abruptly at certain points as you scroll.

Lowering `m` makes the rule easier to satisfy (less symmetry demanded of the art) at the cost of a larger generator set. For M.C. Escher's _Circle Limit III_ it must be `4`, not `8`: the pattern has 4-fold centres at the octagon centres, and the natural general-purpose generator—a half-turn about an edge midpoint—is outside that group entirely.

The tiling also exposes what the rule needs:

```js
tiling.stabiliserOrder;   // m: art must be invariant under rotation by 2*pi/m
tiling.selfRotation;      // that rotation, as an Isom
tiling.classModulus;      // how many distinct tile classes exist (1 = every tile identical)
tiling.tileClass(addr);   // 0 .. classModulus-1, the same by every route
```

### Binary-tree tiling

Use the `BinaryTiling()` class.

The binary (Böröczky) tiling, addressed by `{lat, lon}` as BigInt arbitrary-precision integers. Point-to-cell is two `floor`s, which no `{p,q}` scheme can match, and the integer addresses make natural filenames and are canonical: one cell, one address, no ambiguity. BigInt because descending one latitude doubles the longitude, so about fifty levels down a plain number stops being exact—and addresses are identity only, never geometry, so it costs nothing per frame. Cells are congruent but not regular polygons—two sides are geodesics and two are horocycles—and the tiling is *not* tile-transitive, so it cannot make a seamless repeating pattern.

### Custom tiling

A new tiling can be constructed in the following way:

```js
{
  metrics: { circumradius, centreSpacing },   // sizes the walk
  originAddress(),                            // the tile containing the origin
  addressToString(address),                   // canonical string, for caching and filenames
  addressEquals(a, b),
  neighbours(address),                        // [{ address, gen }] gen indexes the table
  generator(i),                               // Isom, CONSTANT: neighbour-local → tile local
  inverseGenerator(i),                        // the index that undoes generator i
  generatorCount(),
  containsLocal(x, y, tol?),                  // is this tile-local point inside this tile?
  boundaryLocal(),                            // for clipping, in tile-local coordinates
  addressesAreCanonical,                      // true if one tile has exactly one address
  stabiliserOrder,                            // m: art must be invariant under 2*pi/m
  selfRotation,                               // rotation as an Isom (identity when m = 1)
  classModulus,                               // number of tile classes (1 = all must match)
  tileClass(address),                         // 0 .. classModulus-1, path-independent
}
```

The generators must be constant matrices—independent of which tile you are in. That is what makes a walk a product of small factors, and it is the whole trick. In SU(1,1) an edge half-turn squares to `−I` rather than `+I` (the spin double cover), so `inverseGenerator` may return the index of a matrix equal to the negation of the inverse; any comparison of frames must work up to sign.

## Development

```bash
npm test          # node:test, no dependencies
npm run check     # enforce the source constraints the bundler relies on
npm run build     # produce dist/ and refresh docs/lib/
npm run serve     # serve docs/ at http://localhost:8000
```

This project has an [`AGENTS.md`](AGENTS.md) for coding agents and everything in the [`notes/`](notes/) directory is maintained by agents. In particular, [`notes/math-audit.md`](notes/math-audit.md) records the mathematical formulas that have been verified.

Pull requests are welcome!

## Alternatives

As of August 2026, I could find no other libraries that provide this functionality: generic vector art in a hyperbolic plane. Here are some _similar_ projects.

| project | what it is | how it differs |
|---|---|---|
| [hyperbolic-canvas](https://github.com/ItsNickBarry/hyperbolic-canvas) | a Poincaré-disk **drawing interface** for HTML canvas (MIT, no dependencies) | closest in spirit, but it is a geometry-and-paths layer: `Point`, `Line`, `Circle`, `Polygon`, and `fill`/`stroke`. There is no view to pan, zoom or rotate, no data format, and no widget—you drive the canvas yourself |
| [d3-hypertree](https://github.com/glouwa/d3-hypertree) | an interactive **hyperbolic tree browser** for the web (MIT, SVG, built on d3) | the closest thing to a drop-in widget, and it does pan and cull at scale—but the data model is a *hierarchy*, which the library lays out for you. You bring a tree, not arbitrary vector art |
| [Cinderella](https://doc.cinderella.de/) / [CindyJS](https://cindyjs.org/) | interactive geometry software with native hyperbolic views (Poincaré and Beltrami–Klein) | for *constructions*—points, lines, incidences you build and drag—rather than rendering a dataset someone else produced |
| [HyperRogue](https://github.com/zenorogue/hyperrogue) and its [RogueViz](https://roguetemple.com/z/hyper/rogueviz.php) engine | a mature non-Euclidean engine (GPL-2.0, C++) covering H², H³, S³, Nil, Solv and more | far more geometry than this library, and used for real visualisation and research—but it is a desktop application and engine, not something you embed in a page |
| [HyperEngine](https://github.com/HackerPoet/HyperEngine) | the non-Euclidean Unity backend behind the game [*Hyperbolica*](https://codeparade.itch.io/hyperbolica) (MIT, C#) | a game engine for first-person 3D, not a 2D map viewer |
| [EscherSketch](https://github.com/looeee/hyperbolic-tiling) and similar tessellation generators | tools that *produce* hyperbolic tilings and Escher-like art | they generate a picture; they are not a viewer for your own data |

My original [hyperbolic-storage-space](https://github.com/jpivarski/hyperbolic-storage-space) (2012) was directly inspired by Lamping and Rao's Hyperbolic Browser at Xerox PARC (1996: [general paper](https://doi.org/10.1006/jvlc.1996.0003), [visualizing trees](https://doi.org/10.1145/257089.257389), [video demo](https://youtu.be/8bhq08BQLDs?si=6bsYQMgkDnXEratZ)), commercialized as StarTree, of which [d3-hypertree](https://github.com/glouwa/d3-hypertree) is the modern-day descendant.
