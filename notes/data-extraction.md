# Data extraction and the JSON schema

## Where the data is

Three byte-identical copies of the four 2011 databases survive:

- `OLD/disk1/hyperbolicdb/{escher,dungeon,clock,relativity}/`
- `OLD/disk2/www.coffeeshopphysics.com/hyperbolicdb/…`
- zipped in `OLD/hyperbolic-storage-space/svgtools/examples/{escher,clock,dungeon,relativity}.zip`

`diff -r --brief` reports zero differences between the first two.

## Format: BabuDB 0.5.6 — readable with no dependencies

Identified from `config.db` (94 bytes of Java serialization naming
`org.xtreemfs.babudb.index.DefaultByteRangeComparator`), the in-tree
`WebContent/WEB-INF/lib/BabuDB-0.5.6.jar`, and `DatabaseInterface.java`.

**No BabuDB, no JVM, no JPype, no installs are needed.** A ~40-line pure-stdlib Python `struct` reader
suffices. `svgtools/dumpdb.py` is the legacy JVM route and is broken anyway (hardcoded Java 6 paths,
Python 2 syntax, and a jar that was never built).

Block layout, **all big-endian**:

```
int32 valuesOffset
int32 numEntries
int32 fixedKeyLen        (-1 = variable)
int32 fixedValLen        (-1 = variable; 6 in blockindex.idx)
byte[] keys              concatenated, starting at offset 16
int32[numEntries]        key END offsets, relative to 16, at (valuesOffset - 4*numEntries)
byte[] values            concatenated, starting at valuesOffset
int32[numEntries]        value END offsets, relative to valuesOffset, at (blockEnd - 4*numEntries)
```

- `blockindex.idx` — one entry per block; value is fixed 6 bytes: `int32 byteOffset` into the block file
  plus `int16 blockFileNumber` (always 0 here). Gives the block offsets.
- `blockfile_0.idx` — key is 20 bytes `int32 latitude, int64 longitude, int64 id`; value is
  `double depth, double minRadius, double maxRadius` followed by **raw UTF-8 JSON**.
- `blockSize = 16` entries per block, from `DatabaseInterface.java`'s `BabuDBConfig`.

**Do not extract with `strings`.** The JSON is plain text, so it is tempting, but the 24-byte
`depth/minRadius/maxRadius` prefix carries escher's z-order and the level-of-detail gates, and the key
carries the tile assignment. All of that would be lost.

Result of running the parser: **137,080 / 137,080 records, zero JSON parse failures.**

| dataset | blocks | records | unique ids | types |
|---|---|---|---|---|
| escher | 2415 | 38,640 | 38,640 | all polygon |
| clock | 5492 | 87,864 | 87,864 | 43,932 text + 43,932 polygon |
| dungeon | 330 | 5,270 | 5,270 | all polygon — **critters only** |
| relativity | 332 | 5,306 | 5,306 | 5,281 polygon + 25 text |

`minRadius` is 0.0 everywhere. `maxRadius` is 1.0 everywhere except escher, which also uses 0.75.
Relativity's log-sequence number (5755) exceeds its record count because ~448 keys were overwritten.

Coordinate ranges (local coordinates, all points including text anchors):

| dataset | x | y | notes |
|---|---|---|---|
| escher | −13.194 … 12.607 | −13.100 … 13.025 | |
| clock | −28.000 … 28.000 | −28.000 … 28.000 | |
| dungeon | −2.445 … 1.657 | −658.76 … **11711.92** | authored in half-plane coordinates |
| relativity | −8.195 … 8.196 | −4.043 … 77.458 | authored in half-plane coordinates |

The dungeon's `y = 11711.92` is `d ≈ 20.1`, which is exactly where the original transform breaks —
see `su11-core.md`.

## What is *not* in the databases

- **Dungeon rooms, doors and room numbers** were generated server-side per visible tile by
  `GeographicalTiles.writeDungeon`/`dungeonPoint`. The database holds only the critters. Room numbering
  is `row = −latitude − 1`, `column = −longitude`, with the hero in room `0-0`
  (`latitude == −1 && longitude == 0` is skipped).
- **Critter placement**: `svgtools/examples/list_of_critters.txt` records 442 placements of 8 critter
  types plus `dungeonman`, across **399 distinct `(latitude, longitude)` cells**, latitude −20…20. The
  file notes that latitude and longitude are *displayed* negated.
- The **clock face** was generated offline by `svgtools/examples/clock.py` (720 minute ticks, 43,200
  second ticks, 12 hour numerals). Radii in local units: hour ticks 1.0→1.1, numerals at 1.2 (up-vector
  1.5); minutes 3.2→3.3, labels 3.4/3.7; seconds 25.0→27.0, labels 28.0/31.0.
- The **clock hands** are client-side, inline in `clock.html`.

## Per-example original options

For reproducing the demos (from the four `WebContent/*.html` pages):

| example | size | options |
|---|---|---|
| escher | 400×400 | `allowZoom:false, initialZoom:0.95, minZoom:0.95, maxZoom:0.95` |
| clock | 400×400 | `allowZoom:false, initialZoom:0.95, minZoom:0.95, maxZoom:0.95, viewThreshold:0.98` + a 1 s redraw |
| relativity | 620×620 | `allowZoom:false, initialZoom:0.95, minZoom:0.95, maxZoom:0.95, initialOffsetX:0.39343765505449557, initialOffsetY:-1.6944713725350748, initialRotation:1.800587227851628, rotationMode:"compass", viewThreshold:0.95, downloadThreshold:0.98` |
| dungeon | 620×620 | `allowZoom:true, initialZoom:3.0, minZoom:0.5, maxZoom:10.0, initialOffsetX:-0.16329931618554516, initialOffsetY:0.12247448713915887, initialRotation:2.86, backgroundColor:"#606060", backgroundImage:"stars.jpg", shellImage:"turtle.png", shellImageScale:1.6, rimFillStyle:"#5d5d4e", downloadThreshold:0.75` |

Images: `WebContent/turtle.png` (672×672 RGBA, 480 KB), `WebContent/stars.jpg` (1000×1000, 1.5 MB).

## Legacy drawable shape

```json
{"type": "polygon", "d": [[x, y, "L"], [x, y]], "fillStyle": "#000000",
 "strokeStyle": "none", "lineWidth": 2.0}
{"type": "text", "d": "48", "ax": …, "ay": …, "upx": …, "upy": …,
 "fillStyle": "#000000", "textAlign": "start", "textBaseline": "alphabetic"}
```

Only `"L"` (line-to) ever appears as a path flag; no curves. Coordinates were written with `%.18e`.
Optional `"class"` selects a named style; the servlet defined `default`, `grid`, `gridText`.

## v2 schema

```json
{"version": 1, "coordinates": "local", "drawables": [
  {"type": "path", "points": [[x, y], [x, y, "M"]], "closed": true,
   "fill": "#000000", "stroke": "none", "lineWidth": 1, "class": "…"},
  {"type": "text", "text": "48", "at": [x, y], "up": [x, y],
   "fill": "#000000", "align": "center", "baseline": "alphabetic", "font": "…"},
  {"type": "marker", "at": [x, y], "radius": 3.5, "fill": "#000000"}
]}
```

Point flags become explicit: legacy `"L"` (draw this edge) is the default; a `"M"` flag starts a new
sub-path. `minRadius`/`maxRadius` become optional `visibleFrom`/`visibleTo`.
`readLegacyDrawables()` converts the 2011 shape so old data still loads.

## Output sizing

8 significant digits, one drawable per line, ordered by `depth`, deduped by `id`:

| dataset | raw | gzip |
|---|---|---|
| escher | 8.2 MB | 1.9 MB |
| clock | 8.1 MB | 1.7 MB |
| dungeon | 2.1 MB | 0.5 MB |
| relativity | 1.1 MB | 0.25 MB |

At 17 digits it is 11.3/11.2/3.1/1.6 MB — 8 digits is far more precision than the rendering needs and
keeps the repo reasonable. One drawable per line makes git diffs line-based rather than one enormous
line, which is the "git-stability" requirement.
