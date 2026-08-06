# Implementation log

**Append-only.** One entry per substantive change: what, why, what was rejected and why, what was
measured, what is left. Never rewrite or reorder past entries. Newest at the bottom.

---

## 2026-08-05 — Planning and mathematical audit

**What.** Explored `OLD/` (the 2011–2012 Tomcat + JavaScript project and two archived disk images),
recovered the example data, audited every formula in the original code, designed the new library, and
wrote the plan (also saved to `/tmp/plan.md`).

**Why this order.** The original client is a single 1000-line file with the math, rendering, input and
networking interleaved, and its README describes the coordinate system incorrectly. Porting it without
first establishing what each formula actually computes would have baked the original's errors — and my
own misreadings — into the new code.

### Established

- **Data recovery needs no BabuDB, no JVM, no installs.** A ~40-line pure-stdlib Python `struct` parser
  reads the block files. All 137,080 records recovered, zero JSON parse failures. Details in
  `data-extraction.md`.
- **The projection math in the original is correct**, and the old README's description of it is wrong.
  The clean framing is that the data coordinates *are* SU(1,1) matrix entries and the half-angle comes
  from the Spin(2,1) double cover. See `math-audit.md` and `su11-core.md`.
- **The precision failure is real and severe.** Recentring on the far end of the dungeon data
  (`d ≈ 20`) puts a point that belongs at the disk centre on the disk *boundary* — 310 px wrong on a
  620 px canvas. Rewriting the transform core as SU(1,1) matrix products fixes it exactly.
- **Circle Limit III is the `{8,3}` tiling with the chiral `433` symmetry group**, 4 fish per octagon.
  The decisive constraint for the atlas demo: repeating identical data in every tile requires the art
  to be invariant under the tile stabiliser, which for `433` on `{8,3}` is **C₄, not C₈**. See
  `escher-circle-limit-iii.md`.
- **The dungeon maps exactly onto the binary (Böröczky) tiling** the original server already used, with
  the 442 critters occupying 399 integer `(latitude, longitude)` cells. See `tilings.md`.

### Audit outcome

Three passes. Final: **45/45 claims verified, zero corrections.** Full ledger in `math-audit.md`,
including what was verified *correct* — that file exists specifically so working code does not get
"fixed" later.

Bugs found in the original: 2 that the user already knew about (stuck drag, load-on-release) and
~18 more, of which four are genuinely mathematical:

1. `halfPlane_to_hyperShadow` returns exactly 0 near the half-plane basepoint (double cancellation).
2. `hyperShadow_to_halfPlane` divides by zero at `y ≳ 10⁴` — *inside* the dungeon's data range, and
   silently, since Java yields `Infinity`.
3. `longitudeRange` misses 45.8 % of visible cells (samples the wrong edge of each latitude band).
4. The pinch uses arithmetic means where hyperbolic midpoints are needed; the problem is actually
   exactly determined and both fingers can be pinned.

**Rejected along the way** (recorded so it is not re-attempted):

- Using `w₁w₂ − x₁x₂ − y₁y₂` as the culling test. It is only the *real part* of a complex invariant;
  error up to 19.6. It is a conservative lower bound, so it would have "worked" while over-drawing —
  the kind of bug that never announces itself.
- "Pin the hyperbolic midpoint" for the pinch. Better than the original at the midpoint but *worse*
  per finger (73 px vs 25.7 px). The exact solve dominates both.
- BFS-from-root for regular-tiling tile keys. A tile at `d = 20` sits behind ~`e²⁰` tiles.
- A bundler dependency for the IIFE build. Instead, constrain the source style and enforce the
  constraints with `tools/check-bundle.mjs`, so concatenation is a valid transform.

### Decisions taken with the user

1. Escher tiling: derive the real group and fit the art properly rather than reuse the approximate
   2012 replication.
2. Tiling is pluggable, with **both** regular `{p,q}` and the binary tiling as built-ins.
3. Cleaned-up v2 JSON schema, with a reader for the legacy shape.
4. `README.md` = API + JSON format; `docs/MATH.md` = mathematics.

### Left to do

Everything in the plan. Next: scaffolding, then fixture extraction and the legacy performance baseline
(the baseline must exist *before* any optimisation, or "faster" is unfalsifiable).

---

## 2026-08-05 — Step 1: scaffolding, AGENTS.md and notes/

**What.** Created `AGENTS.md` pointing at `notes/`, seeded the notes files (with `math-audit.md`
carrying the full 45-claim ledger from planning), and added `.gitignore` for `OLD/`.

**Why notes first.** The audit knowledge has no other home. It is not derivable from the code, and it
is exactly the sort of thing that gets lost between sessions — including the negative results, which
are the most expensive to re-establish and the easiest to discard.

---

## 2026-08-05 — Step 1 continued: build tooling and the SU(1,1) core

**What.** `package.json`, `tools/check-bundle.mjs`, `tools/build.mjs`, `src/core/{isom,coords,minkowski}.js`,
`src/index.js`, `test/legacy-reference.mjs`, `test/isom.test.mjs`, `test/bundle.test.mjs`.
`npm run check`, `npm test` (20 tests) and `npm run build` all pass; the bundle is 17.0 kB
(8.0 kB "minified" — whitespace and comments only).

**Zero-dependency browser bundle without a bundler.** `tools/build.mjs` topologically sorts the
import graph, strips the import lines and the `export ` keyword, and concatenates into an IIFE.
That is only a valid transform because the source style is constrained, so `tools/check-bundle.mjs`
*enforces* the constraints (single-line package-relative imports at the top of the file;
`export class|function|const|let` declarations only; no dynamic `import()`, no top-level `await`,
no cross-module identifier collisions). `export { … }` lists are permitted only in `src/index.js`,
where they are the ESM public surface, and the builder strips that block since a re-export is
meaningless in a single-scope bundle.

Rejected: taking a bundler as a devDependency. The whole point is that a consumer can `npm i` this
with no transitive dependencies and a maintainer can build it with nothing but `node`. `test/bundle.test.mjs`
evaluates the bundle in a **bare `vm` context with no Node globals**, so if the source ever reaches
for a Node API the tests fail rather than the browser.

**`test/legacy-reference.mjs` is a verbatim port of the 2011 formulas**, defects included, used as a
differential-test oracle. This is how the rewrite is *proved* behaviour-preserving instead of merely
plausible. Do not tidy that file; its value is that it is unfaithful to nothing. It also carries two
*independent* oracles (`diskDistance`, `halfPlaneToDiskDirect`) that are not ports — they are what
judge the ports.

**A real bug, caught by a test I nearly did not write.** `Isom.composeInto` had sign errors in the
`b` component: `m.b·conj(n.a)` expands to `(mbr·nar + mbi·nai) + i(mbi·nar − mbr·nai)`, and I had
both of those signs inverted. It is invisible whenever either operand is a pure rotation (`b = 0`),
which covers most obvious test cases — including the differential test against `internalToScreen`,
because `fromLegacyView` is `Rot(R)·T(B)` and the rotation has `b = 0`. Only the group-law test
(`(mn)n⁻¹ = m` with two non-trivial translations) exposed it. Noted here because the lesson
generalises: for a group implementation, test the *group laws*, not just a few evaluations.

**Checkpoint A discipline.** `src/core/coords.js` currently holds **faithful ports of the two 2011
half-plane conversions, numerical defects included**, marked as such in the file. They are replaced
with stable forms at checkpoint B, so the commit diff shows exactly what the fix is. The SU(1,1)
core itself is new code (step 2 of the plan), so the far-field precision improvement lands in A —
`test/isom.test.mjs` pins it with an assertion that the legacy polynomial *fails* the same case,
so the test would notice if someone reverted the core.

**Left to do.** Fixture extraction and the legacy performance baseline (task #2) — the baseline must
exist before any optimisation.

---

## 2026-08-05 — Step 0: data extraction and the baseline harness

**What.** `tools/babudb_dump.py`, `tools/make_docs_data.py`, `bench/make_legacy_fixtures.py`,
`bench/baseline.html`, and the four committed `docs/*.json`.

**Extraction.** `137,080 / 137,080` records recovered, matching the audited count exactly — the
script warns if that total ever changes, which would mean the parse drifted or the source moved.
Per-dataset counts also match: escher 38,640 paths; clock 43,932 paths + 43,932 text; dungeon 5,270
paths; relativity 5,281 paths + 25 text.

**One schema decision worth recording.** I had planned to "modernise" polygon points into
move/line commands. I did **not**, because it loses information. In the 2011 format the third
element of a point is a flag for the edge *leaving* that point: `"L"` means stroke that edge, absent
means the edge still participates in the fill but is not stroked (and `"P"` draws a vertex marker).
So the fill path is always closed while the stroke can be disconnected. A move/line model cannot
express that without duplicating geometry, so v2 keeps per-point flags. Fidelity beat elegance here.

**Committed data sizes** (8 significant digits, one drawable per line): escher 8.65 MB (1.91 gzip),
clock 8.49 (1.70), dungeon 2.11 (0.52), relativity 1.14 (0.26). 20.4 MB in the tree, ~4.4 MB over
the wire. One drawable per line is what makes these diffable at all.

**Baseline harness built, baseline NOT measured.** `bench/baseline.html` loads the original
`HyperbolicViewport.js` straight out of `OLD/` and drives `updateOffset` around a fixed circular pan
path (120 steps × 3 reps), so it measures the draw path without event plumbing in between and covers
identical ground on every run.

Verified functionally in Chrome via the DevTools MCP server: the page loads with no console errors
(only a favicon 404), all four legacy fixtures fetch, and **escher renders correctly** — the fish,
the rim annulus, and the 3-fold point at the centre are all visibly right, which independently
corroborates the order-3 symmetry measured during the audit.

**The measurement is deferred.** The machine was saturated: load average 17.15 on 16 cores, GPU at
100 %, eight `nova2026 run_round.py --round 3` processes. The harness did print numbers
(median 246.8 ms/frame, ~5 fps, escher) and they are **being discarded** — under that contention
they measure the machine, not the code. See the deferral record in `performance.md`. Task #11 tracks
re-running it; it must happen before the optimisation pass so "faster" means something.

---

## 2026-08-05 — Step 3: view state and gesture solvers

**What.** `src/core/view.js` (`ViewState`) and `test/view.test.mjs`. 30 tests pass.

**The 2011 drag collapses to one line.** Before writing anything I checked, numerically against the
verbatim port, what `updateCoordinates` actually is. It is exactly

```
newMatrix = movePointToPoint(mousedownDiskPoint, currentDiskPoint) . committedMatrix
```

Identical action to 4.2e-14 and identical parallel-transport rotation to 2.2e-14 over 12,000
randomised drags. Three ~40-term unrolled polynomials replaced by one composition of two SU(1,1)
elements. The "parallel transport" rotation is not computed at all — it is just the holonomy that
falls out of the product, which is what parallel transport *means*.

**Committed vs live.** A gesture never touches the committed state; each frame it recomputes the
live state from the committed state plus the gesture's own anchor. So nothing accumulates. The 2011
code instead accumulated *and* stored the result off the SU(1,1) manifold (its `denom = sqrt(denom²
− real² − imag²)` cancels ~8 digits at distance 20), which is a second, independent precision
failure beyond the one in `internalToScreen`.

**Compass mode is reproduced, including its inherent trade-off.** Holding the compass target at a
fixed screen bearing means rotating about the screen centre, which *moves* the grabbed point. You
cannot both pin the point and fix north; the 2011 code made the same choice, and the comment in
`updatePan` says so rather than leaving it to be rediscovered.

**Checkpoint A discipline.** `updatePinch` is a faithful port of `updateTransformation`, arithmetic
means and all, marked in the file. Checkpoint B swaps in the exact solve.

**A test found the hard ceiling of a single global patch.** My first version of the
"repeated gestures do not drift off the manifold" test ran an unconstrained random walk. A
hyperbolic random walk escapes *linearly*, so 2000 pans reach hyperbolic distance ~1340 and `|a| =
cosh(d/2)` overflows a double. Two things came out of that:

1. The off-manifold error stays at machine precision (~3e-14 relative) even out at distance 670,
   with `|a| ~ 1e145`. `normalize()` via polar re-factoring is doing exactly its job.
2. The representation's hard ceiling is hyperbolic distance ≈ 1419 (`2·acosh(1.8e308)`). That is
   now pinned by its own test rather than lurking. It is also another argument for the atlas:
   tile-local coordinates never form a number remotely near this.

I kept the stress test (bounded to 1000 gestures) and set its threshold with headroom at 1e-12
rather than tuning it to just pass the measured 2.8e-14.

---

## 2026-08-05 — Steps 4-6: rendering, input, widget, and the four examples (CHECKPOINT A)

**What.** `src/data/{drawable,source}.js`, `src/render/{geodesic,renderer,surface}.js`,
`src/input/pointer.js`, `src/viewport.js`, `test/{geodesic,input}.test.mjs`, `test/fake-dom.mjs`,
`docs/{index,escher,dungeon,clock,relativity}.html` and `docs/demo/*`. 52 tests pass; all four
examples verified rendering in Chrome via the DevTools MCP server.

**Three bugs of my own, each caught a different way.** Worth recording because the *detection method*
is the transferable part:

1. **Arc sweep sense inverted** — caught by *looking at the screen*. The canvas y-flip negates the
   angles, which also reverses the sweep direction, so every geodesic took the MAJOR arc and swept
   outside the disk; the render looked like fish scattered across the whole canvas. The circle
   parameters were all correct, so a test on those alone would have passed. Now pinned three ways: a
   differential test against the 2011 edge computation including the boolean, and a test that walks
   the swept arc and asserts every sample stays inside the disk.
2. **Text size read as pixels** — caught by *comparing against the original*. The 2011 renderer set a
   fixed `14pt` font and then applied `ctx.scale(size, size)`, so its `size` was a dimensionless
   multiplier and its `MIN_TEXT_SIZE = 0.5` was too. Reading it as a pixel height makes every glyph
   sub-pixel, so the clock face lost all 43,932 of its numerals — silently, because the code path
   that skips small text is the same one. `notes/math-audit.md` had actually flagged the `ctx.scale`
   detail; I noted it and then mis-implemented it anyway, which is an argument for testing against
   the original rather than trusting one's own notes.
3. **Cell enumeration negated** — caught by *the readout*. `dungeon.html` generated 3,600 room
   drawables and drew them, but nothing was visible: I confused "centre" (the data point in the
   middle of the screen) with the old "offset" (its negation), so every cell was generated on the
   far side of the plane. The stats line saying `drawn 7744/8870` while the canvas was empty is what
   made it obvious.

**Room art verified by transcription diff, not by eye.** The dungeon rooms look like crosses rather
than rooms, which was suspicious enough to check properly: a script now compares the JS arrays
against `GeographicalTiles.writeDungeon` and confirms 7 polygons / 32 points match exactly, and the
number anchors match. The cross plates really are what the 2012 art was. That same diff also
confirmed the `ax`/`up` swap from the audit: the format string lists `"upx","upy","ax","ay"` while
the arguments are `boxCenter, box1up`.

**Design points.**

- The renderer takes an array of *passes* (`{drawables, matrix}`), one per named source. That is what
  makes the clock's hands a matrix change rather than a rebuild.
- The rim annulus is bounded by the **interaction** radius, not the draw radius: that ring is what
  you drag to rotate, so drawing it there is what makes the affordance visible.
- Legacy behaviours that are *choices* rather than bugs are kept as options, so A/B comparison does
  not need a checkout: `cullMode: "endpoints"` (the 2011 test that drops long crossing edges),
  `arcMode: "fixed"` (its zoom-independent 0.1 threshold), `devicePixelRatio: 1`,
  `radiusBasis: "width"`, `panClamp: false` (the freeze-past-the-rim behaviour).
- Unknown option names throw. A silently ignored typo in an options object is a miserable way to
  lose an afternoon.

**This is CHECKPOINT A.** Still carrying the 2011 mathematical errors, deliberately:
`coords.js` has both half-plane conversions in their original cancelling forms, and `updatePinch`
uses arithmetic means. Checkpoint B replaces them.

---

## 2026-08-05 — CHECKPOINT B: the mathematical corrections

**What.** Replaced both half-plane conversions in `src/core/coords.js` with numerically stable forms,
and replaced `updatePinch` with the exact solve. Added `test/coords.test.mjs`. 64 tests pass.
Checkpoint A in the git history still has the originals, so the two commits can be compared directly.

**The three corrections.**

1. `halfPlaneToLocal`: the 2011 expression has a *double* cancellation near the half-plane basepoint
   and returns exactly 0 below `d/2 ≈ 5e-9`. The whole thing collapses to `t/sqrt(1−t²)` with
   `t = |z−i|/|z+i| = tanh(d/2)`, which is exact at every scale.
2. `localToHalfPlane`: `denom = 2r² + 1 − 2yw` loses the `+1` and reaches exactly `0.0` by `y ≈ 1e4`
   — inside the dungeon's own range (11711.92), and silently, since Java gives `Infinity`. Multiplying
   by the conjugate gives an all-positive equivalent; branch on the sign of `y` because the *other*
   form is the one that cancels for `y ≤ 0`.
3. `updatePinch`: exact solve. Root-find the zoom on `d(g₁/s, g₂/s) = d(D₁, D₂)`, then fix the
   isometry by matching the hyperbolic midpoint and one bearing. Both fingers pinned to <0.01 px in
   testing, versus up to 25.7 px of drift for the 2011 arithmetic-means version.

**Two test-design lessons, both from thresholds I first set wrong.**

- **The oracle can be the weaker side.** The `halfPlaneToLocal` test compares against a reference that
  forms `1/sqrt(1−|Z|²)`, which cancels near the boundary. The measured 1.3e-12 residual is the
  *reference's* error, not the implementation's, so the threshold is 1e-10 with a comment saying so.
  Tightening it further would be testing the oracle.
- **Assert against conditioning, not against a number.** The half-plane round-trip necessarily forms
  `1 − tanh(d/2)`, which decays like `4e^{−d}`, so the best achievable relative error is
  `ε/(1 − tanh(d/2))` — a property of the coordinate, not the code. The test now measures the ratio of
  the actual error to that floor and asserts it stays within 500× (measured: about 2×). That catches a
  genuinely bad formula while not pretending precision exists where it cannot. A fixed threshold would
  have been either vacuous or a lie depending on the sample range.

  This also puts a number on the case for the atlas: the floor is already ~1e-7 at `d = 20`.

**Verified in the browser.** All four examples still render after the swap. The dungeon zoomed out to
0.5 shows the world-turtle carrying the disk across a star field — the 2012 look, produced entirely
from `docs/demo/layers.js` with no turtle-specific code anywhere in `src/`.

---

## 2026-08-05 — The atlas feature (CHECKPOINT E)

**What.** `src/data/atlas/{tiling,atlas}.js`, per-tile clipping in the renderer, an `atlas` option on
the viewport, `tools/{fit_escher_tile,make_dungeon_atlas}.py`, and
`docs/{escher-atlas,dungeon-atlas}.{html,json}`. `test/tiling.test.mjs`. 78 tests pass.

**Both tilings, because they answer different questions.** Regular `{p,q}` is tile-transitive, so
repeating one tile gives a genuinely group-invariant pattern — that is what Escher needs. The binary
(Böröczky) tiling is *not* tile-transitive (it is only weakly aperiodic, symmetry group essentially
`⟨z ↦ 2z⟩`), so it can never do that; what it gives instead is O(1) point-to-cell lookup from two
`floor`s and a well-defined per-cell frame, which is what a *map* wants — and is why the 2011 server
chose it. Using either one for the other's job would be a mistake.

**`frameSymmetry` is the load-bearing option.** Repeating identical data in every tile yields a
consistent pattern only if the art is invariant under the tile's stabiliser in the walk group. For
Circle Limit III on `{8,3}` under `433` that stabiliser is **C₄, not C₈**, so the walk must avoid both
the 8-fold rotation *and* the edge-midpoint half-turn (`433` has no order-2 points at all). The
half-turn is the natural general-purpose generator, so this is a real trap; `RegularTiling` switches
to 3-fold rotations about alternate vertices when `frameSymmetry < p`, which is exactly Escher's own
"connect alternate vertices" construction.

**Two bugs found, one by a test and one by the bundle test.**

1. The binary frame's closed form had `b`'s real and imaginary parts swapped. Caught by comparing
   against the actual matrix product `C·A·C⁻¹` rather than trusting the hand algebra — worth doing
   whenever a closed form replaces a product.
2. `renderer.js` and `atlas.js` both declared a module-private `const arc`. Legal ESM, a
   `SyntaxError` once concatenated into the single-scope bundle. The bundle test caught it, and it
   revealed a genuine gap in `tools/check-bundle.mjs`, which only checked *exported* names. It now
   checks top-level private declarations too.

**Two more precision findings, both now pinned by tests.**

- `distanceMoved()` read the distance from `|a| = cosh(d/2)`, which rounds to exactly 1.0 for any
  `d < 3e-8`, so small translations silently reported zero. Reading it from `|b| = sinh(d/2)` is well
  conditioned at both ends.
- The usable ceiling is set by the **action**, not the representation: `applyTo*` forms
  `dr² + di²`, which overflows once entries pass ~1e154, i.e. hyperbolic distance ~710 — half the
  ~1420 at which the entries themselves overflow. Fixing it would cost two divides per point in the
  hottest loop in the library, for distances no data can reach (the dungeon's extreme is 20), so it
  is documented and tested rather than fixed. If that ever changes, scale by `max(|dr|, |di|)`.

**The wrap-angle trap, for the third time.** JavaScript's `%` keeps the sign of the *dividend*, so
`((x + π) % 2π) − π` is correct only for `x > −π`. It made a correct generator bearing look 360°
wrong. Now written once in `test/helpers.mjs` with a comment, rather than a fourth time.

**Escher tile: what was actually done.** The stored 38,640 polygons could not be re-tiled, because
they are not on any regular tiling — the 2012 replication used translations of 1.86 in nine
directions at `2π/9`, while `{8,3}`'s true centre spacing is 1.5286. So `fit_escher_tile.py` goes back
to the traced SVG, re-anchors it from its 3-fold centre (an `{8,3}` *vertex*) onto an octagon centre,
symmetrises to exact C₄, and clips to the octagon: 84 shapes. The demo then returns that one tile for
every key and the library places it. **The tiling is exact; the art is a documented approximation** —
Escher's woodcut is hand-drawn and the tracing was admittedly imperfect, so seams are visible where
tiles abut. The page says so and offers a no-clip toggle.

**Dungeon atlas: the three-way overlay the brief asked for.** One callback merges a 7-shape prototype
room drawn in every cell, characters looked up by cell coordinate (5,270 drawables across 400 cells),
and room numbers computed on the fly from the cell's own coordinates. Verified by panning to room
19-200000 — hyperbolic distance 13.55, view centre at local `(−161, −407)` — where the geometry and
the numbers are still crisp.
