# tools

Two scripts for drawing and editing hyperbolic-map artwork by hand in
[Inkscape](https://inkscape.org/) instead of writing [the drawable
format](../docs/index.html#the-drawable-format) by hand.

```
python3 tools/drawables_to_svg.py  FROM-FILE  TO-FILE  JSON-PATH  [--coords ...] [--guidelines ...]
python3 tools/svg_to_drawables.py  FROM-FILE  TO-FILE  JSON-PATH
```

## The workflow

```bash
cp docs/escher-atlas.json my-atlas.json          # svg_to_drawables.py overwrites; keep a copy

python3 tools/drawables_to_svg.py my-atlas.json art.svg drawables \
        --coords disk --guidelines "RegularTiling(8, 3, 4)"

inkscape art.svg                                 # draw; save as Inkscape SVG or Plain SVG

python3 tools/svg_to_drawables.py art.svg my-atlas.json drawables
```

The second step's `--coords`/`--guidelines` are recorded inside the SVG, so the last step needs no
options: it reads them back and inverts the projection itself.

## `JSON-PATH`

Drawables are usually a part of a JSON file, so both scripts take a dotted path to the array:

| file | path | what it selects |
|---|---|---|
| `docs/escher-atlas.json` | `drawables` | the 233 shapes of one Circle Limit III octagon |
| `docs/dungeon-atlas.json` | `critters.fairy` | the 12 shapes of the fairy |
| `docs/dungeon-atlas.json` | `room` | the prototype room |
| — | `layers.3.shapes` | an integer step indexes an array |
| — | `""` or `.` | the whole document, when it is a bare array |

At each step the name is a key if the current node is a JSON object, and an integer index if it is
an array. The target must be an array of drawable objects; anything else is an error that names the
path so far and lists what was actually available.

## `drawables_to_svg.py`

### `--coords local | halfplane | disk`

Which coordinate system the SVG is drawn in. Default `local`.

| | |
|---|---|
| `local` | the drawables' own coordinates — `(x, y)` with `w = √(1 + x² + y²)`. What is in the file. |
| `halfplane` | the Poincaré upper half-plane. Some 2011 source art was authored here, and the binary tiling is defined here. |
| `disk` | the Poincaré disk — **the same coordinates the map viewer presents**, so this is the WYSIWYG choice. |

In all three the y axis points up, matching the renderer's own `sy = -y * scale + cy`, so the SVG
reads the same way up as the widget does.

The page is auto-fitted: the content's longer side becomes 1000 user units with a 4 % margin. The exact
affine is recorded in the metadata, so `svg_to_drawables.py` reads the inverse rather than guessing it.

### `--guidelines "SPEC"`

Adds light gray tile borders beneath the art, as one `<g class="hyperbolic-map-guidelines">`
that `svg_to_drawables.py` recognizes and ignores. Omit it and no guidelines are added.

**`"RegularTiling(p, q, frameSymmetry)"`** — `frameSymmetry` is optional and defaults to `p`, as in
[`RegularTiling`](../docs/index.html#regular-tiling). You get:

- the base tile's border, in `#bbbbbb`;
- one ring of neighbors, in `#dddddd`;
- a large letter **R** in each neighbor, showing the orientation that neighbor is placed in.

> The neighbors drawn are the ones the tiling's own generators reach. For `frameSymmetry = p` that is
> all `p` of them; for `frameSymmetry < p` there are `2 × frameSymmetry` generators, so when
> `2 × frameSymmetry < p` fewer than `p` neighbors appear. The count is printed.

**`"BinaryTiling()"`** — the base cell and its neighbors, with no letter R. Two of the four sides are
horocycles and two are geodesics, meeting at right angles.

> Six neighbors are drawn, not five. A cell has one parent, but *which* parent step applies depends on
> whether the cell is a left or a right child, and a prototype cell has no longitude — so both parent
> variants are shown, and only one of them is a real neighbor of any given cell.

In addition, for any non-empty `--guidelines`: `--coords disk` also draws the unit boundary circle,
and `--coords halfplane` also draws the horizontal axis, spanning only as wide as the other guidelines.

## `svg_to_drawables.py`

**This overwrites the array at `JSON-PATH` in `TO-FILE`.** `TO-FILE` must already exist and already have
something at that path. Copy your JSON first if you want to keep the original.

There is no `--coords`: the SVG says which one was used.

### What it reads

Shapes are collected in document order, following the full chain of `transform` attributes — necessary,
because Inkscape writes a `transform` onto a group the moment you move it.

| element | becomes |
|---|---|
| `<path>` | one `path` drawable per subpath (`M`…`Z`) |
| `<polyline>`, `<polygon>` | a `path`, open and closed respectively |
| `<rect>`, `<line>` | a `path` (rounded corners are squared off, with a warning) |
| `<circle>`, `<ellipse>` | a `marker` if tagged `hmw:type="marker"`, otherwise a polygon with enough sides to stay within ¼ unit of the curve |
| `<text>` | a `text` drawable |
| `<g>`, `<a>`, `<switch>` | recursed into |

Ignored: the guidelines group, `<defs>` and other definition containers, anything with
`display: none`, and foreign-namespace elements such as `sodipodi:namedview`. Anything else is skipped
with a warning rather than silently.

`fill`/`stroke` come from both the presentation attributes and the `style="…"` property list, with
`style` winning as CSS requires. Colors pass through untouched, since the renderer hands them to a
canvas context — so any CSS color works. `fill-opacity`/`stroke-opacity` are folded into `rgba(…)`.

**Curves are reduced to their endpoints**, with a warning. The drawable format has no curve segments.

### `closed`, and the fill/stroke split

`Z` (and `<polygon>`) give `closed: true`; an open path gives `closed: false`. This is faithful in both
directions, because SVG closes a *fill* implicitly too, exactly as the drawable format does — `closed`
only ever affected the stroke.

Per-point [stroke flags](../docs/index.html#path) are stored in `hmw:flags`, always — including when every
one is empty, since a path with no `"L"` anywhere strokes nothing however its `stroke` is set. If the
attribute is absent or no longer matches the point count (you added or
removed nodes), the flags are re-inferred: every edge is stroked when the shape has a stroke and none
is when it does not, which is how all the shipped data is written.

One thing the SVG cannot show: a single `<path>` has one stroke for all its edges, so a partially
flagged shape is previewed with its whole outline drawn. The flags themselves survive regardless.

## Round trip

`drawables_to_svg.py` records everything about a drawable except its geometry in two attributes,
`hmw:source` (the original field values) and `hmw:keys` (their original order). So `svg_to_drawables.py`
can tell the difference between a field you edited and one you did not, and:

- a shape you did not touch is passed through unchanged (the same fields in the same order, and
  `lineWidth: 2` does not become `2.0`);
- fields the SVG cannot express at all — `class`, `visibleTo`, `withinTile`, anything a future version
  adds — survive rather than being dropped;
- fields you did edit are written from the SVG, and omitted when they merely restate a library
  default, so the JSON does not inflate into a fully expanded style block.

### Not preserved

| | |
|---|---|
| Curve segments | reduced to endpoints; the format has no curves. |
| `class`-based styles | a drawable's `class` is preserved, but the named style it refers to lives in the viewport's `styles` option, which the scripts never see. The SVG previews such a shape against the *library* defaults, so it may look wrong in Inkscape while being correct in the widget. |
| Text size and rotation | display only. The viewer derives both from `up`, which is carried in `hmw:upLength`, so moving, rotating or scaling the text in Inkscape does move `up` — but editing the font size does not. |
| `lineWidth` when `stroke` is `"none"` | it has no effect, so the SVG does not carry it; it is restored from `hmw:source` when present. |

### `lineWidth` and `markerRadius`

These are viewer **pixels**, not geometry — the renderer sets `ctx.lineWidth` after the projection — so
they have no canonical size in SVG user units. Both scripts peg them to a nominal viewer scale of 300 px
per unit, which is about what `view.radius` comes to on a 620 px canvas at zoom 1, and record the
conversion in the metadata. So `lineWidth: 2` becomes a proportionate `stroke-width`, and a shape you
draw fresh in Inkscape gets a proportionate `lineWidth` back.

## Metadata

The projection parameters are stored twice: as an `hmw:params` attribute on the root `<svg>`, and as
an `<hmw:params>` element inside `<metadata>`, both in the namespace
`https://github.com/jpivarski/hyperbolic-map`. Inkscape 1.1.2 was verified to preserve both
through a save; two copies means a future Inkscape dropping one is a warning rather than a broken round
trip. If both are gone, `svg_to_drawables.py` says so and stops rather than guessing.

An SVG that was not produced by `drawables_to_svg.py` cannot be converted, because nothing says what
its coordinates mean.
