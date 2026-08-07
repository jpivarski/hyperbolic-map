# Performance

## Ground rule

**Check CPU and GPU load immediately before and after every measurement, and record both alongside the
number.** This machine is often busy with unrelated work. If anything else is significantly active,
report that the machine was busy and defer — a benchmark taken next to a training job is worse than no
benchmark, because it looks authoritative.

**Measure the original first.** Until there is a baseline from running the 2011
`HyperbolicViewport.js` against static data, "faster" is unfalsifiable.

## Status

| item | state |
|---|---|
| legacy baseline (escher, clock, dungeon, relativity) | **deferred — machine busy** |
| post-rewrite measurements | not yet measured |

### Deferral record, 2026-08-05 19:55

The baseline was **not** measured because the machine was saturated. Readings at the time:

- load average `17.15 / 17.50 / 16.66` on **16** cores;
- eight `scripts/nova2026/run_round.py --round 3` processes, four of them at 200–300 % CPU;
- GPU (RTX 3060) at **100 %** utilisation, 4671 / 12288 MiB used;
- that job's own deadline was `2026-08-06 00:19` — about 4 h 23 m out at the time.

A canvas-rendering benchmark under those conditions would measure the contention, not the code.
The harness is built and ready; re-run it when the machine is idle, take load readings before *and*
after, and record them next to the numbers.

## Hotspots in the original, and the intended fix

All identified by reading, not yet by profiling. The profile comes first, then these get confirmed or
discarded.

| hotspot | fix |
|---|---|
| `draw()` runs synchronously on every `mousemove` — 120 full redraws/s on a 120 Hz mouse | single rAF-coalesced draw loop; handlers only mutate state and call `invalidate()` |
| every vertex is projected **twice** (once as `j`, once as `jnext`), each time via a ~40-multiply polynomial plus a `sqrt` plus a 2-element array allocation | project once per vertex into a reused `Float64Array`, with the ~14-multiply SU(1,1) kernel and `w` precomputed at ingest |
| `for (var j in drawable["d"])` plus `parseInt(j)` per vertex | indexed loops over struct-of-arrays |
| `save()/clip()/fill()/restore()` per filled polygon, building the identical path twice | the clip is a **no-op** (`fill ∩ clip == fill`) — delete it; build the path once |
| ~8 `undefined` checks per drawable to resolve styles | resolve and intern at ingest; group drawables by resolved style |
| no early rejection — all 38,640 (escher) / 87,864 (clock) drawables fully projected every frame | 6-multiply Minkowski cap test per *drawable* before projecting. Expected to be the single biggest win |
| culls against the disk even when only part of it is on screen | `effectiveRadius = min(drawRadius, hypot(w,h)/(2·scale))`. At the dungeon's `zoom: 3` only `\|z\| ≲ 0.47` is visible — roughly quarters the work |
| one canvas call per polygon (~193,000 for escher) | per-style `Path2D` buckets → `O(#styles)` calls per frame |
| no `devicePixelRatio` | scale the backing store; all library math stays in CSS px |

## What to measure

Expose per-stage accumulators on `vp.stats`: `frameMs, cullMs, projectMs, buildMs, submitMs,
drawables, survivors, drawn, pointsProjected, canvasCalls, textDrawn, tilesVisible, tilesFetched,
bytesFetched`. Report median and p95, not mean.

`bench/bench.html` drives deterministic synthetic gestures — a fixed pan path at 120 Hz, a zoom sweep
0.5→10, a rotate sweep — per fixture. `bench/bench.mjs` micro-benchmarks the two hot kernels in
isolation (points projected/s, cap tests/s), which is what regression-guards them.

GPU raster time is not attributable from JS, so pair the numbers with one Chrome trace per fixture via
the DevTools MCP server (`performance_start_trace` with `reload: false, autoStop: false`).

## Targets

- escher and clock at 60 fps while panning on desktop.
- `canvasCalls` per frame `O(#styles)`, not `O(#drawables)`.
- Zero steady-state allocation during a pan — heap-snapshot delta over 600 frames.
- The dungeon at `zoom: 3` should be dominated by tile enumeration, not projection.

## Caveats to state whenever quoting numbers

- The 2011 README notes Firefox-on-Linux was "very, very, very slow" for the same graphics, which the
  author attributed to a missing hardware-accelerated canvas path. Browser and platform must be named.
- Path2D batching changes fill behaviour for self-overlapping or hole-punched polygons (nonzero winding
  over a merged path). The golden-image test over the escher fixture is what establishes it is safe
  there; `isolate: true` per drawable and `batchByStyle: false` globally are the escape hatches.

### Second deferral, 2026-08-05 21:5x

Re-checked before attempting the optimisation pass. Still busy:

- load average `9.12 / 9.89 / 10.51` on 16 cores;
- GPU at **100 %**, 7502 MiB used;
- eight `run_round.py --round 3` processes still running, ~2 h 52 m before that job's deadline.

`bench/bench.mjs` is now written and working. It prints the load average with every run and refuses
to present its results as usable when the machine is busy (exit code 2), because a microbenchmark
under contention measures the contention. It said so on this run, so nothing is recorded here.

Everything else in the project is complete; the optimisation pass is the only outstanding work.


## 2026-08-06 — First real measurements, and three optimisations

**Machine load.** All numbers below were taken with a one-minute load average of 0.2-0.8 on 16
cores, nothing running but this session's own Chrome and tooling, and the GPU at 31%. Load was
re-checked immediately after each run. The `scripts/nova2026` job that had been saturating the
machine finished around midnight, which is what made these valid.

**How they are measured.** `bench/frames.html` times `vp.render()` directly -- the render is fully
synchronous, so wall time around it is the frame cost. Panning numbers are PACED at one render per
animation frame. That distinction matters: rendering in a tight loop backs up Chrome's raster queue
and every third frame blocks, producing a bogus 230 ms spike that no user would ever see. The first
set of numbers had exactly that artefact.

### Baseline and result (620x620, paced pan, median ms per frame)

| scene | drawables | before | after | |
|---|---|---|---|---|
| escher | 38,640 | 55.6 | **46.2** | 22 fps |
| clock | 87,864 | 20.6 | **14.8** | 68 fps |
| escher atlas | 18,000 | 25.5 | **19.1** | 52 fps |
| relativity | 5,306 | -- | **3.4** | 294 fps |

Where escher's frame goes, measured by rendering into a no-op context: **23.9 ms in our JavaScript,
31.9 ms inside Chrome's rasterizer**. The rasterizer share is driven by call volume -- 264,000
`lineTo` per frame. (Measure this with a plain object, not a Proxy: a Proxy's traps cost more than
the work being measured and inflated the first attempt to 41 ms.)

### 1. Reusable vertex buffers (lossless)

`drawPath` allocated `new Float64Array(n)` twice per path -- 77,280 typed arrays per frame on escher.
Now module-scope buffers grown on demand. escher 62.9 -> 46.3 ms in the tight-loop measure.

### 2. Canvas state caching (lossless)

Assigning `fillStyle` is not free in Chrome even when the value is unchanged; it re-parses the colour
string. Now skipped when unchanged, with the cache cleared at every frame, every pass boundary and
every other place that touches the context -- bluntly, because a stale cache would paint a shape in
the previous shape's colour. Included in the figure above; clock 20.6 -> 14.0.

### 3. Style interning (memory)

Styles were not interned at all: the count of distinct style objects exactly equalled the count of
drawables. Escher went from **38,640 style objects to 8**, clock from 87,864 to **2**. No measurable
speed change, but a large memory saving, and it is what makes identity comparison meaningful.

### 4. Vertex decimation (0.25 px, essentially lossless)

The big one, and it is specific to hyperbolic rendering: the projection crushes unbounded area into
the rim, so most shapes arrive far smaller than a pixel. Measured on escher at its default view,
**59% of edges are shorter than half a pixel and 39% shorter than a quarter**, and 22,894 of the
38,640 shapes fit entirely inside one pixel. Each of those edges still costs a `lineTo`.

Dropping a vertex that lands within 0.25 px of the last one EMITTED (not of the previous vertex, so
small steps cannot accumulate into drift) removes ~51% of them: 56.5 -> 43.6 ms, p95 142 -> 98.

Cost, measured against a control of two identical renders that differ by exactly zero:

| tolerance | centred view | panned view | speed |
|---|---|---|---|
| 0.25 px | 12 channels, worst delta 2 | 425 channels (0.028%), worst 35 | -23% |
| 0.5 px | 281 channels, worst delta 86 | 579 channels (0.038%), worst 63 | -33% |

0.25 px is the default: a fifth of a percent of a percent of channels, at a delta of 2 out of 255.
0.5 px is measurably visible and is left as a knob.

### The sub-pixel shape gate, and why it is off by default

`minFeaturePx` skips a whole drawable whose projected size is below a threshold, using the fact that
`1 - |z|^2 = 1/cosh^2(d/2)`, so the on-screen diameter is `capRadius * scale / (A^2 + B^2)` -- the
value the cap cull already computes, hence free.

My first version looked spectacular: 36% of shapes skipped, 33% faster, "zero pixels changed". That
was wrong, and the way it was wrong is worth recording. The comparison counted a pixel as changed
only if its summed RGB delta exceeded 8, which hid real losses; at a stricter threshold, 0.17% of
channels differed and some by a full 255. The cause was that the gate ignored STROKE WIDTH -- a shape
0.3 px across drawn with a 2 px stroke still paints a 2 px mark.

With stroke width counted, the gate correctly skips almost nothing on these datasets, because every
Escher fish carries a ~1 px stroke. So it buys nothing here and is **off by default**, kept as an
option for data with unstroked fills. Honest outcome: a feature that measured well only because the
measurement was too lenient.

### Not done: batching by style

Merging same-styled shapes into one path would cut the 50,400 canvas calls, but it reorders drawing,
and drawing order is precisely what has been producing visible bugs in this codebase. Restricting it
to runs of CONSECUTIVE same-styled shapes would be order-preserving, but the mean run length after
interning is only 1.69 on escher and exactly 1 on clock, so the win would be small. Not worth the
risk; recorded here so the option is not re-derived from scratch.

### Correctness after optimising

The full interaction sweep was re-run on all pages afterwards and is unchanged: three seeds per page,
worst signature difference 0 except the known first-gesture canvas-promotion artefact, which came
back with the identical value (11.36 on escher, 9.73 on the escher atlas) -- the same deterministic
Chrome behaviour, not something introduced here. 94 unit tests pass.


## 2026-08-06 — The anchored atlas: cost independent of position

Machine idle throughout: one-minute load average 0.27-0.42 on 16 cores, nothing running but this
session's own Chrome and tooling. Re-checked after each run.

### A measurement trap worth recording

The first post-rewrite numbers looked like a 2.5x regression: escher 57.9 ms against 46.2 before, clock
36.8 against 14.8. They were wrong, and the way they were wrong is a lesson.

The render counters were IDENTICAL to the previous session -- 38,640 drawables, 217,560 points
projected, 50,400 canvas calls, 90,997 vertices decimated -- so the *work* had not changed at all. What
had changed was the page: that tab had built and destroyed several hundred viewports during testing,
and its JavaScript was running about three times slower. On a freshly opened page the same measurement
gave 43.8 ms. Nothing had regressed.

So: measure performance on a fresh page, and if timings move without the counters moving, suspect the
environment before the code.

### Paced pan, fresh page, median ms per frame

| scene | before the rewrite | after |
|---|---|---|
| escher (38,640 drawables, single patch) | 46.2 | 43.8 |
| clock (87,864 drawables, single patch) | 14.8 | 15.3 |
| relativity (5,306, single patch) | 3.4 | 3.4 |
| **escher atlas (18,000 in 200 tiles)** | **19.1** | **18.7** |

The atlas is slightly faster despite composing relative frames afresh every frame rather than caching
global ones -- and the cached global frames it no longer keeps were also an unbounded memory leak.

### The headline: frame time no longer depends on where you are

| tiles from the origin | {8,3} | {3,7} | binary (by latitude) |
|---|---|---|---|
| 0 | 17.3 | 17.0 | 19.4 |
| 500 | 17.0 | 17.3 | 18.8 |
| 5,000 | 17.0 | 17.0 | 18.5 |
| 50,000 | 16.7 | 16.7 | 18.7 |
| 200,000 | 16.5 | 16.7 | — |

200,000 tiles of {8,3} is about 150,000 hyperbolic units. The old design could not represent the view
there at all.

### Getting there took two fixes, and the first attempt was only half of it

The geometry was distance-independent immediately -- that was the point of the rewrite -- but the
ADDRESS BOOKKEEPING was not, and it dominated:

| tiles out | word length | one `addressToString` | one `neighbours` | enumeration | frame |
|---|---|---|---|---|---|
| 0 | 0 | 0.05 us | 0.9 us | 0.56 ms | 16.8 ms |
| 500 | 390 | 4.2 us | 1.3 us | 4.83 ms | 23.4 ms |
| 5,000 | 3,796 | 43.5 us | 9.8 us | 57.5 ms | 84.2 ms |

1. **Word addresses became cons cells.** An array address made `neighbours()` copy the whole word for
   every candidate the walk dequeued. A cons cell extends in O(1), and the prefix every tile in a frame
   shares -- the camera's own address -- is stringified once and memoised. Also: the string key is now
   skipped entirely for word-addressed tilings, where geometric deduplication is doing the work anyway.
   Enumeration went to 0.25-0.29 ms at every distance, and the frame flattened through 5,000 tiles.

2. **Cache keys stopped being strings.** At 50,000 tiles a word is ~38,000 characters, and using it as a
   Map key forces the rope to flatten: 200 of those per frame was ~20 ms even though enumeration was
   0.26 ms. Addresses now carry a hash folded forward as the cell is built, giving an O(1) key of about
   53 bits, and the readable string is produced only on a cache miss or when an overlay asks for it
   (`lastTiles[i].id` is a lazy getter). That flattened the curve out to 200,000 tiles.

Both were found by measuring at increasing distance rather than at one point, which is the only way this
class of problem shows up.

## Atlas flicker and the Escher frame time (2026-08-06, later)

Two reports: the diagnostics flickered while scrolling (regular polygons only), and the Escher atlas
was slow despite only 233 shapes per tile.

### The flicker: a synchronous callback was costing a frame

`request()` always went through `Promise.resolve().then(...)`, so even data already in hand arrived a
microtask late — after the current frame had drawn. On a `{p,q}` tiling that is visible, because word
addresses are not canonical: when the camera re-anchors the walk renames many tiles at once, they all
miss the address-keyed cache together, and every one of them returns `null` for that frame.

Measured on `{7,3}`, panning one tile spacing in 60 steps:

| | before | after |
|---|---|---|
| frame 30 (the single re-anchor) | **26 tiles missing** | 0 |
| other frames | 1-3 missing on 18 of 60 | 0 |
| binary tiling, worst frame | 2 missing | 0 |

Binary was nearly immune all along — canonical addresses, so nothing gets renamed. That asymmetry is
what identified the cause.

Fix: if the callback returns a non-thenable, compile and cache it inline and return it. Asynchronous
providers are untouched. All nine tilings now pan with **zero** frames missing a tile.

### The Escher frame time: it really was drawing 46,600 shapes

"233 shapes" is per tile; 200 tiles is 46,600. Where the time went, measured by substitution:

| | drawables | frame |
|---|---|---|
| full art | 46,600 | 36.8 ms |
| full art, everything culled by `minFeaturePx` | 46,600 considered, 0 drawn | **6.4 ms** |
| one shape per tile | 200 | 1.4 ms |
| clipping off | — | −0.4 ms |

So drawing dominates (~0.65 us per shape), iteration is 0.14 us per considered drawable, and clipping is
noise. Raising `minFeaturePx` helps but bottoms out around 21 ms, because in an 8 px tile the shapes are
about a pixel each rather than sub-pixel — there is nothing for a size threshold to remove.

The distribution is the point: of 200 visible tiles, **122 had a screen radius under 8 px**, and 45
under 4 px.

| | | |
|---|---|---|
| >= 32 px | 15 tiles | |
| 16-32 px | 22 | |
| 8-16 px | 41 | |
| 4-8 px | 77 | each still submitting 233 shapes |
| < 4 px | 45 | |

Fix: per-tile level of detail. A tile may carry `lod` art used below `lodPx` (default 11). For Circle
Limit III that is one octagon in the area-weighted average colour, which the tracer computes from the
coverage it measured (ink 0.149, body 0.733, spine 0.118).

### Where it landed

| | before | after |
|---|---|---|
| Escher, static frame | 36-47 ms | **12.6 ms** |
| Escher, drag median | 31 ms | **12.6 ms** |
| Escher, worst frame (the re-anchor) | **125 ms** | 17.7 ms |
| drawables per frame | 46,600 | 12,728 |
| visual difference | — | 0.0 % of pixels inside 85 % of the radius, 0.2 % in the outer ring |
| diagnostics, drag median | — | 6.4 ms, worst 11.8 ms |
| dungeon atlas, drag median | — | 5.6 ms (unchanged) |

The 125 ms re-anchor frame needed a separate fix: it was recompiling **160 tiles at once**, all renamed
by the same re-anchor. Compiled art is now memoised on the identity of the object the callback returns,
so a provider handing back one of a few shared objects — which the stabiliser rule requires on a `{p,q}`
tiling anyway — recompiles nothing. A provider that builds a fresh object per call is unaffected.
