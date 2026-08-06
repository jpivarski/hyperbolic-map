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
| legacy baseline (escher, clock, dungeon, relativity) | **not yet measured** |
| post-rewrite measurements | not yet measured |

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
