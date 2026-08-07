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

---

## 2026-08-05 — Documentation and browser verification (CHECKPOINT F)

**What.** `README.md` (API, options, the drawable format, the atlas, the alias table for the 2011
option names) and `docs/MATH.md` (the geometry, written for clarity with derivations in `<details>`).

**Verified in a real browser via the DevTools MCP server**, not only in Node:

- All six examples load with a clean console and render correctly.
- **All five stuck-drag scenarios pass in Chrome**: release far off-canvas then hover back; a
  swallowed `pointerup` detected by `buttons === 0`; `pointercancel`; `lostpointercapture`; and
  window blur mid-drag. In each case the view is unchanged by subsequent button-less movement.
- **Draw-during-drag confirmed**: over a six-step drag the drawable count moves continuously
  (581 → 536 → 851 → 761 → 680 → 581 → 518) and does **not** jump on release. The 2011 behaviour
  would have been a flat count during the drag and a jump at the end.
- **Far-from-origin**: panned the tiled dungeon to room 19-200000 — hyperbolic distance 13.55, view
  centre at local `(−161, −407)` — with geometry and room numbers still crisp.

**On MATH.md's shape.** The brief asked for clarity, with equations only where they help. The
organising idea is that a data point *is* an isometry, which makes the half-angle a consequence of
the spin double cover rather than an unexplained convention, and makes the projection four complex
multiplies. Everything the reader might otherwise take on faith — why it is not the hyperboloid
model, why zoom is not an isometry, why the pinch is exactly determined, where the precision runs
out — is in a `<details>` block rather than either omitted or inflicted.

The deliberate approximations get their own section, including the honest statement that the Escher
tiling is exact but the *art* is a fit with visible seams.

**Left to do.** Only the performance work, which needs an idle machine. See `performance.md`.


---

## 2026-08-05 (late) — Drawing-correctness sweep: real bugs found

The user reported that the rendered images looked wrong, especially the two atlas demos, and that
polygons seemed to disappear after scrolling. All correct. Performance work is postponed
indefinitely at their instruction.

**Tooling built first**, because guessing was not working: `tools/capture_server.py` accepts canvas
pixels POSTed from the page, `bench/ab.html` renders the same data at the same view through both the
2011 code and the new library and diffs them, `bench/stress.html` drives real pointer events and
compares downsampled image signatures, and `bench/sweep.js` scripts scroll-and-capture over the
example pages. Being able to *look* at exact canvas pixels, and to diff against the 2011 renderer,
turned this from speculation into measurement.

### Bug 1 — the Escher tile was cut from the wrong source (visibly wrong colours and shapes)

`fit_escher_tile.py` read the traced SVG, which carries the artist's ORIGINAL palette (`#517179`,
`#9aa87c`, `#9f7054`, stroke `#676767`). The 2012 pipeline remapped those to `#218ba6`, `#79bd68`,
`#ed6b51`, stroke `#6e5638` — "I changed my mind about some colors". Result: a muted olive-and-teal
picture instead of Escher's four bright colours.

It also manufactured C4 symmetry by overlaying four rotated copies of the whole traced block and
clipping. The block spans six fish over a wide area, so that piled two dozen fish into one octagon:
fragments, not fish.

Now cut from `docs/escher.json` — the finished art, already verified to render identically to the
2011 viewer. Real fish, correct colours.

**A negative result, recorded rather than hidden.** The script scans bearings and scores each by C4
residual. Measured spread across 24 bearings: 0.01900 to 0.02006, a ratio of **1.06** — flat to
within noise. The tracing is not accurate enough for that metric to locate the true 4-fold direction,
and the first version reported a "best bearing" that was pure noise dressed as a fit. The scan now
runs only to report whether it discriminates, and falls back to bearing 0 (the three candidates are
equivalent under the art's own 3-fold symmetry) while saying so.

### Bug 2 — clipping destroyed the dungeon rooms

The 2012 room art is deliberately drawn *straddling* cell boundaries: the floor plate spans the
corner where cells meet, and the doors are what *connect* adjacent rooms. Each piece is still drawn
exactly once, by the cell that owns it, so nothing overlaps — but clipping each cell's drawing to its
own cell severs the junctions. Measured: clipping removed more than half the room geometry (grey
coverage 2768 → 1328 samples).

Fixed by defaulting that demo to `clip: "never"`, with the toggle kept so the failure is visible and
the page explaining it. The Escher tile, whose art *is* designed to fill its tile, still clips. This
is why clipping is a per-atlas choice rather than a rule.

### Bug 3 — the atlas threw away the drawing order

`babudb_dump.py` emits records in KEY order (latitude, longitude, id). `make_docs_data.py` re-sorts
by `depth`, which is the z-order the art was authored for; `make_dungeon_atlas.py` did not, and just
appended in file order. The hero's sixteen shapes came out as depths
`[1723, 1731, 1734, 1732, …]`, so his large orange body painted over his own face and cap. Sorting by
`(depth, id)` fixes it: orange body first, details on top, yellow cross last.

Confirmed the atlas transform itself is exact — mapping the hero's shapes back through the cell frame
reproduces the single-patch coordinates to 6.2e-9 — and that no sprite is split across cells
(minimum 9 shapes per populated cell). And an A/B against the 2011 renderer at the hero's position
differs by 0.088 % of pixels, so that blocky sprite is genuinely what 2012 drew.

### Bug 4 — async providers were asked exactly once, ever

The worst of the four, and the direct cause of "content disappears when you scroll".

`CallbackSource.needsRequest` compared the hyperbolic distance moved against
`2*artanh(drawRadius)`. `drawRadius` defaults to 1.0, and `artanh(1)` is infinite — the whole
hyperbolic plane is inside the disk — so the threshold came out around **7.3 hyperbolic units**. A
provider was called once at construction and then never again, however far the user scrolled.
Measured: after a drag moving the view 1.03 units, the data still described the original centre, and
it never caught up.

The gate is now measured **on screen**: project the previous request's centre under the current view
and re-request when it has drifted more than a quarter of the disk radius from the middle. Bounded,
scale-free, and meaningful at every zoom. Measured after the fix: lag 0 after each of four drags.

Separately, the throttle could swallow the last movement of a drag and leave the frame the user
actually stopped on showing data fetched for an earlier position, so `refreshSources()` now runs on
gesture end and bypasses both the throttle and the gate.

### Verified NOT broken

- Static rendering matches the 2011 renderer: escher at five different views differs only along
  shape edges (antialiasing).
- **Path independence** for static data: a view reached by dragging, wheel-zooming and rim-rotating
  produces a *byte-identical* signature to the same view constructed from scratch.
- The renderer is deterministic: 617,460 canvas calls, identical between runs.


## 2026-08-05 (later) — Zooming out made the dungeon vanish

Chasing the user's report of "polygons disappear after scrolling" into the tiled dungeon. Three
findings, one of them self-inflicted, plus a tooling footgun that wasted a whole debugging cycle.

### Bug 5 — the visible-cell budget was spent on the wrong cells

`BinaryTiling.visible` took ONE global bounding box over the whole visible disk and reused it for
every latitude band. Over-inclusive sounds harmless, but bands were walked from the smallest latitude
upward against a hard `maxCells` budget, and the smallest band has the smallest cells, so it has by
far the most of them. Measured at zoom 0.4: **512 cells returned, all in a single band**, and nothing
whatsoever for the bands actually covering the screen.

The fix uses the fact that a hyperbolic disk is an ordinary EUCLIDEAN circle in the half-plane --
centre `(px, py*cosh(rho))`, radius `py*sinh(rho)` -- so each band's x-extent is exact and
closed-form, no 64-point boundary sampling. At zoom 0.8 that took the result from 512 cells in 2
bands to 140 cells across 10 bands, untruncated.

### Bug 6 — my own nearest-first ranking measured from the wrong point

To make truncation graceful I sorted cells by distance from the view centre. I wrote the distance
from `(px, cy)` -- the centre of the visible circle *as drawn in the half-plane* -- which is not the
view centre at all: it sits `cosh(rho)` times higher, a factor of two million for a wide view. So
"nearest" selected the cells hugging the far rim. Measured on the dungeon at zoom 1.2: all 220 cells
came back at hyperbolic distance 20.87, every one beyond the renderer's cull radius, and the disk
went **completely blank**. Worse than the bug I was fixing.

Correct rank is `cosh(d) - 1 = |p - m|^2 / (2 y_p y_m)` from the actual view centre -- monotone in
distance, no sqrt, no log.

### Bug 7 — the guard against huge bands destroyed the answer

Even ranked correctly, materialising every cell and sorting is wrong: a wide view puts **5,646 cells
in one band**. I had a `found.length > 8*maxCells` break, which tripped partway through the first
(smallest, most numerous) band; every subsequent band then pushed exactly one cell -- its leftmost,
far off to the side -- and broke. The cell containing the view centre was never even a candidate.

Replaced with a lazy frontier: one candidate per side per band, repeatedly take the globally nearest,
expand that band outward. Never materialises more than the budget, emits the complete visible set
whenever it fits, and degrades to "the nearest `maxCells`" when it does not. `lastTruncated` reports
which happened, because a silently capped enumeration reads exactly like a rendering bug.

Verified: **zero holes over 40,000 sampled screen points across 200 views** -- for every point in the
visible disk, the cell owning it was in the returned set. The zoomed-out dungeon now draws the whole
infinite tiling, hero included.

### The footgun: `node tools/build.mjs` did not update what the demos load

The examples load `docs/lib/hyperbolic-map.iife.js`, a copy, so `docs/` works from `file://`. The
copy step lived only in the npm `build` script, so running the builder directly -- the obvious thing
to do -- left `docs/lib` stale and **every browser test silently measured the old bundle**. I
"fixed" bug 6 and watched it not work, twice. The copy now happens inside `tools/build.mjs`, where it
cannot be skipped.

### Note on my own harness

Several apparently-blank captures were a race in the test harness, not the library: `toDataURL()`
called after awaiting rAF can land between the viewport's own scheduled render and its completion.
Capture directly after a synchronous `render()`, in the same task, with no `await` in between.
Confirmed by re-capturing the identical view and getting a correct image.


## 2026-08-05 (night) — Interaction sweep across all six examples

Built `bench/sweep.js`, injected into any example page. Per gesture it asks two questions:

1. Is anything on the disk?
2. Is the picture the same as it would be if this view had been reached directly?

Question 2 is the sharp one. The picture is a pure function of the view, so any difference between
"reached by gesturing" and "constructed fresh from the same matrix" is accumulated state -- a stale
cache, a leaked transform, a counter that never reset. It catches that class without needing to know
what the correct image looks like.

**Result: all six pages clean.** Three seeds x 18-24 random drags, wheel-zooms and rim-rotations per
page; worst signature difference 0 on every step except the first gesture after a page load. The
infinite Circle Limit III still fills the disk correctly after 54 consecutive random gestures.

Measured noise floor for two renders of a settled view: **exactly 0**. That is what makes the
comparison worth anything, and it is why three separate harness defects had to be chased down first.

### Three false positives, all mine

* **Measuring before the tiles were requested.** The atlas discovers which tiles it needs *inside*
  `passes()`, i.e. during the render. So `pending` is 0, we render, that render enqueues the new
  view's tiles, and the signature comes from a frame missing them. Waiting on `pending` beforehand
  is useless; the settle has to be a FIXPOINT -- render, and if that render requested anything, wait
  and render again.
* **Calling "you panned off the data" a blank screen.** `escher.html` reported twelve blank frames.
  The view centre was at hyperbolic distance 4.96 with art out to 7.95, so it looked like content
  vanishing -- but the traced art gives up a few layers from the centre ("I made some mistakes and
  gave up adding fishes a few layers from the center") and the disk really was empty there. It is
  the whole reason `escher-atlas.html` exists. A blank frame is now only reported when re-setting
  the same view fills it back in.
* **Reading a `drawn` count as a drop in content.** Escher-atlas fell from 18,000 to 450 after one
  gesture, which looked alarming; the sweep had wheel-zoomed to 2.26, where 11 tiles x 90 shapes is
  exactly right.

### The one residual signal, characterised rather than waved away

The first measured gesture after a page load differs by mean 0.3-1.5 on a 0-255 scale; every
subsequent step on the same page is exactly 0, and a second sweep over the same warmed page is clean
throughout. Chased to pixel level twice -- replaying the identical gesture and comparing frame
buffers directly gives **0 differing pixels out of 250,000**. This is Chrome promoting the canvas
from the software rasterizer to the GPU, which is already recorded in `notes/legacy-decoded.md`, and
the two rasterizers antialias differently. Three warm gestures before measuring reduce but do not
eliminate it. Not a library defect; left visible in the output rather than suppressed.


## 2026-08-05 (night, later) — The regular-tiling walk collapsed far from the origin

Found by panning the Escher atlas out along a geodesic: at hyperbolic distance 20 the screen showed
**one lone octagon of fish surrounded by bare background**, where at distance 8 it showed thirteen
tiles. Exactly the "polygons disappear" symptom, at long range.

### Bug 8 — dedup by absolute world coordinates

`RegularTiling.visible` deduplicated tile centres by rounding WORLD disk coordinates at an absolute
1e-7. Adjacent centres are separated by tanh(inradius) near the origin but by only ~e^-d far out,
where they crowd against the unit circle. Past d = 16 every neighbour of the starting tile rounded to
the same tag, `seen` rejected all of them, and the walk stopped after one tile. The code's own comment
said to quantise relative to the local spacing; the code did not.

### The fix took three attempts, and the failures are the interesting part

**Attempt 1 -- conjugate by the start frame.** Right idea: express centres relative to the starting
tile, where the neighbourhood sits near the origin and spacing is O(1) again. But `ref` and `frame`
both have entries of magnitude cosh(d/2), and their product is O(1) for a nearby tile: a cancellation.
Keeping a fixed 1e-9 quantum made every word of the same tile land in a different cell, so the walk
filled its entire budget with duplicates. Measured: 13 tiles at distance 8, then the full 200-tile cap
at distance 15, of which 671 pairs were repeats.

**Attempt 2 -- scale the quantum with the error.** A quantum only ~3x the error still splits a tile's
words across a cell boundary a good fraction of the time. Duplicates persisted from d = 15.

**Attempt 3 -- stop trying to make rounding reliable.** Grid rounding cannot be made reliable here,
because there is no quantum that is simultaneously bigger than the error and smaller than the
spacing at every distance. So the grid is now only an ACCELERATOR: a 5x5 neighbourhood is searched
and every candidate is checked with the exact SU(1,1) invariant distance, two tiles being the same
iff their centres are closer than half the centre spacing. Cell boundaries stop mattering, and
making the cell too large is harmless -- it only means scanning more candidates.

One more correction along the way: I sized the cell from the cancellation error alone,
eps*cosh(d/2)^2. That is 25x too small, because `frame(key)` is already a product of ~d/(2*psi)
generators and carries its own error before the two matrices are multiplied. The realistic figure at
d = 30 is ~1e-2, not 6e-4, and duplicates at exactly d = 30 were the evidence.

**Result: no duplicates out to d = 33** for {8,3}, {7,3} and {5,4}, verified with an exact test
independent of the code's own dedup. It breaks at d = 36, which is the float64 ceiling for a single
patch documented in `notes/su11-core.md` -- past there, distinct tile centres genuinely cannot be
told apart, and no dedup scheme can fix it.

### Bug 9 — the walk could run away and never return

Every tile surviving dedup pushes p children, so when dedup fails the queue grows geometrically while
the result budget never fills. A sweep out to distance 36 simply stopped returning. There is now a
hard bound on dequeues, separate from the bound on results, and `lastTruncated` reports it. Degrading
to fewer tiles is acceptable; hanging is not.


## 2026-08-05 (night) — The pinch applied its zoom twice

Verified the pinch in a real browser for the first time (synthetic two-pointer sequences; the MCP
drag tool cannot do multi-touch). Spread, pinch and twist all responded correctly -- a 90 degree
finger rotation produced 1.5745 rad -- but the fingers did not stay under the picture.

### Bug 10 — live zoom where committed zoom was required

`updatePinch` is handed finger positions measured against the zoom in force when the gesture BEGAN,
and divides by the scale it solves for; that bookkeeping is spelled out in its own comment. The input
layer was mapping pointer coordinates with the LIVE zoom, so the scale got applied twice.

Pan and rotate genuinely do want the live zoom -- that is what keeps a wheel-zoom in the middle of a
drag consistent, one of the 2011 bugs this port fixed -- so the two paths need different conventions,
and the pinch path now re-maps both fingers against the committed zoom. `beginPinch` does the same,
since the first finger's stored coordinate could have been taken before a mid-pan wheel-zoom.

The error is proportional to |scale - 1|, which is why it survived until now: a twist that barely
changed the zoom drifted 2.7 px, while a 1.5x spread drifted 30 px. Only vigorous pinches visibly
slid the picture out from under the fingers, and the unit tests used gentle ones.

**Measured after the fix: both fingers pinned to 0.00000 px** across a 2.1x spread, a 0.23x pinch, a
90 degree twist, and a combined spread-and-twist.

### How it was found, which is the reusable part

By a CONTROL EXPERIMENT rather than by reading code. The first measurement said the fingers drifted
30 px -- but given how many harness defects this session has produced, that was as likely to be my
coordinate mapping as the library. So I ran the identical measurement on a SINGLE-finger drag, whose
solver pins the grabbed point by construction. That came back at exactly 0 px, which cleared the
mapping and left the pinch. Worth doing every time: measure something known-good with the same
instrument before believing what it says about the thing under test.

The regression test deliberately uses a large zoom change and asserts sub-micron pinning; against the
old code it reports 35.3 px. A gentle pinch passes either way, which is exactly how this hid.


## 2026-08-06 (early) — Sweep closed out: what was verified, and what was not broken

Remaining checks from the plan, all now done in a real browser.

**The stuck drag, live.** All five ways a release can go missing: release far outside the canvas,
`pointercancel`, a lost release detected only by `buttons === 0` on the next move, window blur
mid-drag, and dragging far past the rim. None leaves the map tracking the cursor; the past-the-rim
case clamps and keeps tracking on the way back rather than freezing and resuming stale.

One more harness false positive on the way: my first version flagged "release outside the canvas" as
stuck because the matrix changed once afterwards. That change is the gesture COMMITTING, which is
correct. Rewritten to sample the matrix after every hover move -- frozen means one distinct value
across four hovers, stuck means it keeps tracking -- and it reports frozen, mode idle, zero active
pointers.

**Rebuild and resize.** The demo checkboxes destroy and rebuild the whole viewport. Sixteen toggles:
no leaked canvases, matrix preserved exactly, signature identical. A resize to 400 and back to 620
also returns an identical signature.

**Long walk.** Ninety random gestures on the tiled dungeon: no findings, worst signature difference
0.5 out of 255.

**The clock.** One `setInterval`, cleared on destroy -- not the 2011 pattern that accumulated 60n
timers after n minutes. The hands advance at 1.4544e-4 rad/s, which is exactly 2*pi/43200, one turn
per twelve hours, matching the single-hand spiral design. 14 numerals drawn and 43,921 text items
skipped at zoom 1.2, which is the LOD gate working.

**Relativity.** Compass mode holds bearing at exactly pi/2.

**Far from the origin.** The tiled dungeon renders correctly at latitude -20 and +20 (hyperbolic
distance 13.5 and 14.3), with room numbers matching `row = -latitude-1` and `locate` round-tripping
every cell. Worth stating precisely, because it is easy to overclaim: the single-patch page is NOT
visibly broken there. The 2011 polynomial's collapse at d ~ 20 was already fixed by the SU(1,1) core,
so what the atlas adds is unbounded range and genuinely infinite content, not a rescue from a
precision failure at this distance. The single-patch dungeon shows only critters that far out because
the rooms, doors and numbers were server-generated in 2012 and are not in the extracted data.

### Score for the night

Ten real bugs found and fixed; six of my own harness defects diagnosed and thrown away rather than
reported as bugs. The ratio is the point: with a measured noise floor of exactly 0, anything nonzero
demands an explanation, and most of the time early on the explanation was the instrument. The control
experiment that found the pinch bug -- measure something known-good with the same instrument first --
is the technique that made the difference.


## 2026-08-06 (early hours) — Rim-tile flicker, and closing the night

`RegularTiling.visible` admitted tiles in BFS DISCOVERY order until the budget ran out. Discovery
order is deterministic but not smooth in the view: a change of one part in 1e15 can reorder it and
swap which tile is admitted last. The affected tiles are the farthest ones, crushed against the rim,
so the visible effect is one downsampled cell shifting -- but it showed up as a steady trickle of
path-dependence findings below the precision ceiling.

Now the walk gathers half again as many candidates as the budget and admits the NEAREST ones by exact
distance. Distance is smooth in the view, so the admitted set changes only when a tile genuinely
crosses the boundary. Measured on eight seeds x 14 gestures: sub-ceiling findings fell from **18 to
5**, and of the five that remain one is the known canvas-promotion artefact at d = 1.6 and the other
four are small (worst 4.3 to 6.9) at d = 20 to 28, in the run-up to the ceiling.

Cost: 1.22 ms per frame of enumeration on the 200-tile Escher atlas, paced pan 19.1 -> 20.6 ms.
Gathering 2x rather than 1.5x cost 1.6 ms for no additional stability, so 1.5x is the factor.

### Where the night ended

Twelve real defects found and fixed. Six of my own harness defects diagnosed and discarded rather
than reported. The discipline that made the difference, in order of how much it saved:

1. **Look at the pixels.** Four bugs were invisible to every counter and obvious in a screenshot.
2. **Run the control.** Measure something known-good with the same instrument before believing what
   it says. This is what found the pinch bug, and what stopped four different false alarms.
3. **Compare against ground truth, not against the other candidate.** Rendering the same view from
   scratch with the caches cleared settled in one step what hours of reasoning about cache state had
   not.
4. **Make the harness confirm before reporting.** Settle again and re-measure; a difference that
   does not survive that was never a difference.


## 2026-08-06 — The atlas rebuilt: no global coordinate anywhere

The user rejected the atlas on the right grounds: floating-point failures far from the origin are
evidence of a wrong APPROACH, not of tolerances needing a nudge. The old `passes()` computed
`net = view.matrix.mul(frame(key))`, two matrices with entries of order cosh(d/2) multiplied to give an
O(1) result. Measured: the global frame of binary cell (500, 0) has entries of 1.08e75.

Rebuilt as described in notes/math-audit.md. The one-line summary: the view is stored relative to the
CAMERA'S OWN TILE, and every other tile's frame is a product of constant generators reached by walking
from the camera. Nothing in the render path knows how far the camera has travelled, so nothing can
depend on it.

### The symbolic audit came first, and earned its keep

31 claims, run before any implementation code. It found that `inside_octagon_local` in
`fit_escher_tile.py` is not the perpendicular bisector of two tile centres -- at the edge midpoint,
which must lie exactly on the boundary, its value is -0.63 at the {8,3} inradius. Harmless where it is
used (that cutter deliberately over-includes and relies on render-time clipping) but it would have been
a real bug in `containsLocal`, which re-anchoring and the ownership diagnostic both depend on. Caught
for the price of writing the claim down.

The first run reported 13 failures and every one was in the harness: comparing a sympy Matrix to the
scalar 0 is always false; hyperbolic perfect squares survive `simplify()`; and claim 12 compared `G.P`
without re-canonicalising the transported point. Plus a fourth defect in the REPORTING -- the flag
separating "proved" from "sampled" was keyed off a variable that was always None, so numeric fallbacks
were silently presented as proofs. In an audit harness.

### The numerical audit, 60 digits, three cross-validated routes

`tools/audit_atlas_numeric.py`. The oracle is computed three independent ways and its self-agreement is
the gate before the code is judged at all. Over nine tilings at 0/1/5/50/500/5000 tiles:

    anchored path      IDENTICAL at every distance, ~5e-16, growth factor 1.0
    old global route   1e-17 near the origin, then 1e11, 1e63, 1e140, 1e273, and at
                       5000 tiles all nine lose it entirely to overflow or NaN

The contrast is the point. Without it, "the anchored path agrees at every distance" could just mean the
test is insensitive.

### The diagnostics, and what they caught

`docs/tiling-diagnostics.html` with nine tilings, four motifs and jump buttons out to 5000 tiles.
Deliberately plain artwork: an asymmetric hook per tile so orientation and handedness are readable, and
a colour hashed from the address so geometry and addressing fail visibly and independently.

Seven automated checks, all passing:

1. near-origin ground truth -- anchored vs naive global agree to 8.7e-16 across nine tilings
2. translation invariance -- **45/45 views BYTE-IDENTICAL** to the origin view at 1/5/50/500/5000 tiles
3. tile ownership -- 6982/6982 pixels painted by the tile that contains them, with art deliberately
   overflowing its tile so clipping has to trim it
4. nothing outside the disk -- 0 stray pixels
5. coverage -- 0 pixels showing background through a seam
6. address round-trip -- 9/9 tilings restore the origin address after 300 random steps and back
7. boundedness -- max|V| = 1.0000 at every distance; max relative-frame entry 2.8

Three of these took a wrong turn first, and all three were the harness:

* **Check 1 failed only for the binary tiling**, by 0.8 disk units. `view.matrix` is V_c = V . F_c, so
  the global composite is `V_c . (F_c^-1 . F_k)`; omitting the `F_c^-1` works by accident for regular
  tilings, whose origin tile is the empty word and hence the identity, but the binary origin CELL has
  frame `z -> 2^0.5 z + 0.5`. The test was wrong, not the code.
* **Check 3 was initially unable to fail.** Filling each tile exactly to its own boundary and then
  clipping it to that boundary is a no-op: clipped and unclipped renders came out identical whether the
  clip worked or not. Added an `over` motif that pushes the fill past the boundary, so clipping has
  something to do.
* **Check 2 reported 0/20 byte-identical**, with the same 28,841 channels differing at 5, 50 and 500
  tiles. Saturating rather than growing, so not precision. The control settled it: the SAME view
  rendered twice also differed by 28,841 channels, while two genuinely different views differed by 6 --
  an alternating canvas state, Chrome's software/GPU promotion, which notes/legacy-decoded.md already
  records as requiring a fresh canvas per capture. With a fresh viewport per capture the control is
  exactly 0 and all 45 comparisons are byte-identical.

Visual proof kept: the binary tiling at latitude 5000 (hyperbolic distance ~3470, where a global frame
would need entries around 1e1500) renders with geometry identical to latitude 0, differing only in the
hashed colours -- which is precisely what the colours are for.

### Clipping

The binary cell's two GEODESIC sides (x = const) were drawn as single straight chords. Measured
sagitta 0.004889 disk units: 3.3 px at the dungeon's default zoom, 9.1 px at zoom 6, a visible band
along every vertical cell boundary. Both kinds of side are now sampled to a pixel sagitta target, the
geodesic ones logarithmically in y because the half-plane metric is dy/y. After: 0.0026 px at zoom 2.2.


## 2026-08-06 — Compound scrolling found three real bugs the straight-line tests could not

The user asked for compound scrolls: many directions, short and long, mixed. That turned out to be a
much sharper instrument than walking in one direction, and it found three defects — two of them
introduced by this very rewrite.

### Bug A — the invariant was maintained by RENDER, not by the view state

`reanchorCamera()` was called at the top of `render()`. Renders are rAF-coalesced, and rAF throttles to
about 1 Hz in a backgrounded tab. So an automated run dragged for dozens of tiles with **no
re-anchoring at all**, and `max|V|` reached **8.9e+74** with the disk empty — the exact failure this
design removes, reintroduced through the scheduler.

"V_c stays O(1)" has to be an invariant of the view state, not something a render happens to restore.
Re-anchoring now runs on every view change (the input layer's `onChange`, `setZoom`, `setRotation`,
`setCamera`), which is a handful of flops. After: `max|V|` = 1.05 over 354 gestures.

### Bug B — the descent cycled for the binary tiling

The camera stepped toward whichever neighbour CENTRE was nearest. That is right for a regular tiling,
whose tiles are the Voronoi cells of their centres, and wrong for binary cells, which are not — so the
nearest-centre rule and the containment check fought each other. Measured: **143,407 re-anchor steps
for 500 small camera moves**, hitting the iteration cap every time, where {8,3} needed 28.

Each tiling now supplies its own exact, monotone `stepToward`: the nearest neighbour centre for a
regular tiling, the box test for a binary cell. Binary went to 47 steps for the same 500 moves.

### Bug C — `stepToward` named a generator, so the camera could not move UP

Introduced while fixing B. It returned a GENERATOR index, but the binary parent step comes in two
parities: an odd-longitude cell offers only `PARENT_ODD`, so a request for `PARENT_EVEN` matched
nothing and the camera could never ascend. It chased downward instead — `max|V|` 2.6e24 and a latitude
several hundred digits long. Found by driving all eight bearings rather than one.

`stepToward` now returns an INDEX INTO the neighbour list, and that list's order is part of the Tiling
contract.

### Two more, from the same session

* **{7,3} cycled once in forty moves.** Picking the most VIOLATED half-plane sounds equivalent to
  picking the nearest centre and is not — violation magnitude is not a distance, so the descent is not
  monotone in it. 4,096 steps (the cap) on a single move. Now nearest-centre with a relative tolerance
  on the containment test, since a point within rounding of a bisector is genuinely ambiguous and each
  of the two tiles computes the other as a hair nearer. Plus a monotonicity guard in `reanchor` itself,
  so a future tiling with a subtly non-monotone rule degrades to stopping early instead of spinning.
* **The "content vanished" check could not fire on {12,3}.** It measured colour DIVERSITY, and one
  large dodecagon can cover the whole sampled region, so a good frame scored 0 and the threshold —
  relative to a baseline that was also 0 — never tripped. Now it counts non-background pixels.

### Where it stands

11 tilings × 16 bearings × 400 moves: worst 96 re-anchor steps, worst `max|V|` 1.35, zero containment
failures out of 176 runs. In the browser, all nine tilings through 354 compound gestures each: zero
findings, `max|V|` ≤ 1.21, ink 1.0 throughout, zero path-dependent tiles.

Path independence is now compared on the composed MATRICES rather than on pixels, and that is a
deliberate correction. The gestured canvas has been drawn hundreds of times and Chrome has promoted it
to the GPU; a freshly built one starts on the software rasterizer. That difference measured ~12,900
colour channels of pure rasterizer state. The matrices are the honest object: path independence means
the geometry is a function of the camera, and `net` per tile IS that geometry.


## 2026-08-06 (later) — Reading for global assumptions, and a batch of vacuous tests

Having fixed the geometry, I went looking for anything else that still assumes a GLOBAL frame. Reading
found three; the fourth came out of a pixel-level check.

### Frame-relative gesture state was not converted on re-anchor

Two pieces of view state live in the frame's DOMAIN, not on the screen: a pinch's grabbed points
(recorded by `beginPinch` in whatever frame was current) and the compass target (`northOf` applies the
matrix to it). Re-anchoring right-multiplied the matrices and left both alone, so a re-anchor mid-pinch
made the solver pin the wrong points, and in compass mode north silently became a different direction.
`ViewState.rebase` now pulls both back through the shift's inverse and re-normalises the compass target
onto the boundary so it stays an IDEAL point.

Hard to provoke through the browser -- a pinch that zooms in moves the view centre LESS, hyperbolically,
than the same gesture panning, so the camera tends not to cross a tile mid-pinch. Tested directly
instead. Without the fix: the pinch result diverges, and north drifts 3.13 radians over 32 crossings.

### An atlas plus a global data source was drawn 0.93 disk units out of place

`view.matrix` is camera-relative in atlas mode, so an ordinary source's global coordinates land
wherever. Refused at option-validation time now, with the message naming `layers` for screen-space
overlays and the atlas callback for tile content. `addSource`, `setData` and `setSourceTransform` refuse
too.

### `toScreen`/`fromScreen` needed saying, and picking needed adding

They work in whatever frame the view is expressed in -- global in single-patch mode, the anchor tile's
frame in atlas mode -- which was true but undocumented. And the obvious atlas question, "which tile is
under this pixel", had no API even though I had written the logic three times in tests. Added
`tileAtScreen`.

Its first version descended from the camera independently, and a check against the rendered colours
(which hash the address) caught it naming tiles differently from the renderer: 30 of 665 pixels on {5,4}.
Not a geometry error -- "2.3" and "1.0" are the same {5,4} tile, centres agreeing to 2.8e-17 -- but a
caller wants the address matching what is on screen. It now resolves against the drawn set first.
Verified 17,989 pixels across nine tilings at 0, 500 and 5,000 tiles out, zero wrong.

### And a batch of my own tests were vacuous

Trying to write a cache-collision test, the key count came out at 201 instead of ~400 and the reason was
embarrassing: `extendAddress(a, i % generatorCount())` looks like a walk and is not. Free reduction
cancels a generator against its inverse, and for **{8,3} with frameSymmetry 4 the generators pair up as
inverses** (0<->1, 2<->3, ...), so cycling the index alternately extends and cancels. Measured: 5,000
steps left the address at length **ZERO**.

That pattern appeared in five tests -- including "the neighbourhood walk is IDENTICAL however far the
camera has travelled" -- so for Circle Limit III's own tiling those tests were asserting things about the
origin while claiming to be 5,000 tiles out. The other tilings were unaffected, because with `m = p`
every generator is its own inverse and consecutive different indices do not cancel.

Fixed with a shared `advanceAddress` helper that never steps straight back, plus an assertion that the
address actually reached the expected depth. A test that cannot fail is worse than no test, and the only
reason this surfaced is that a *different* test's arithmetic did not add up.

## 2026-08-06 (later) — closing out the anchored atlas: docs, degenerate inputs, teardown

`docs/MATH.md` section 6 rewritten. It still described the *superseded* design as if it were current
("a tile's frame is built by multiplying generator matrices, so its entries grow like e^{d/2}" — which
was exactly the bug). Now it names the composition to avoid (`net = V·F_k`), the anchored one that
replaced it, the three identities behind it, the binary-tiling trap (the *general* relative frame still
carries absolute longitudes; only the neighbour steps are constant), the measured payoff, and the one
remaining non-canonicality in `{p,q}` addressing. The single-patch overflow ceilings kept, now labelled
as single-patch only.

`notes/math-audit.md` gained the Layer 2 section, which had been run but never written down.

Re-ran the compound-scroll stress on all nine tilings against the current code (cons-cell addresses,
hash cache keys, `rebase`, `tileAtScreen`), since the last nine-tiling run predated all of those.
**354 gestures each, 3,186 total, zero findings, zero path-dependent tiles**, `max|V|` 1.02–1.16,
`maxRel` 2.5–5.5 — matching the pre-change baseline. Addresses reach length 3,203 on {3,7} with 2,250
re-anchors, and the picture is still a function of the camera alone.

One harness trap worth recording: the resumable driver's ink check is an ABSOLUTE floor of 0.25,
written for the `fill` motif that covers the tiling. Driving it with the `asym` motif (thin strokes,
ink ≈ 0.016) produces a finding on every single step. Eight "disk nearly empty" reports, all spurious,
all mine. The harness is not motif-agnostic; drive it with `fill`.

Degenerate inputs, none of which had been exercised: `maxTiles: 1`, `maxTiles: 0`, `drawRadius: 0`, and
`tileData` returning `null`, `undefined`, `{drawables: []}`, throwing, or returning a rejected promise.
All eight survive a drag with no thrown error, no unhandled rejection, and a finite view matrix.

Teardown in atlas mode: 60 build/destroy cycles leak no canvas; destroying with **41 tile requests in
flight** then resolving them all drains `pending` to 0 with no error and no frame scheduled (both
`invalidate()` and `render()` guard on `destroyed`); `destroy()` is idempotent; `render()` after
`destroy()` is a no-op.

**One real fix.** The no-callback tile-failure path logged the *cache key*, which became a folded hash
when keys were changed for speed — `hyperbolic-map: tile 9303484400662374000 failed`. Now logs
`tile.id`, the readable address. `onTileError` itself was already correct and receives the full tile.

Also removed a stale comment in `render()` that still presented the `d ~ 37` precision ceiling as a
live limit in atlas mode; it applies to single-patch mode only.

## 2026-08-06 (later still) — a {p,q} generator can have finite order, so word length is not distance

Found while trying to verify the Escher atlas far from the origin, and it invalidated an anti-vacuity
guard I had added earlier the same day.

**The fact.** For `{8,3}` with `frameSymmetry: 4` the steps are `2*pi/3` rotations about octagon
*vertices*. Those are perfectly good edge-neighbour moves — three octagons meet at each vertex and
pairwise share edges — but such a rotation has **order 3** in the isometry group: `g0^3 = -I`,
`g0^6 = +I`. Measured with the library's own `Isom.mul`. So the word `"0.0.0.0.0"` has five symbols and
names a tile **1.53 units** away, and `g0^5000` is *still* 1.53 units away.

**What it broke.** `addressDistance` in `test/helpers.mjs` returned `address.len` and was documented as
"used to assert a walk really travelled, so a test cannot silently degenerate". It cannot do that: a
walk can circle forever while its address grows without bound. Seven assertions across
`test/anchor.test.mjs` and `test/tiling.test.mjs` rested on it. This is the *second* round of vacuous
walk repair, and the first round's fix — refuse to backtrack — is exactly what finite order defeats.

**The fix.** `advanceAddress` is now greedy-outward and *verifies* strict progress every step, throwing
rather than returning a stalled walk. `addressDistance` composes the word's generators in log-scaled
form (entries held at unit magnitude, discarded scale accumulated as a log), so it reports genuine
hyperbolic distance at any depth without overflow. The seven assertions now read
`>= walk * 0.25` hyperbolic units; measured travel is 0.49–2.55 per step, i.e. 87–100 % of each tiling's
centre spacing, so the margin is 2x or better.

Same treatment for `walkAddress` in `docs/demo/diagnostic-checks.js`. Check 2 now reports the distance
it verified: **byte-identical at up to 12,767 hyperbolic units** ({12,3}, 5000 steps) rather than an
unchecked "5000 tiles". A global frame there would need entries of order `e^6383`.

**And a harness bug inside the fix**, which is the part worth remembering. My hand-rolled SU(1,1)
multiply had a sign error in `Im(a)` (`+br*g.bi - bi*g.br` instead of `-br*g.bi + bi*g.br`). It made a
`{7,3}` walk report 2,524 units travelled while its address sat at 1.1, and I briefly took that for a
library bug in `extendAddress`'s free reduction. The library was correct. What exposed it was comparing
the new measure against `globalFrameForTesting` near the origin — the same "cross-validate the
instrument before trusting its verdict" step that Layer 1 needed. That comparison is now a test
(`addressDistance agrees with the tiling's own frame builder near the origin`), as is the order-3 fact.

**The Escher atlas, re-verified with real data.** With a walk that genuinely travels, `escher-atlas.json`
(90 shapes, 26 % of vertices outside their own octagon, so clipping is load-bearing) renders
**byte-identical to the origin view at 1, 5, 50, 500 and 5000 steps out — 7,643 hyperbolic units** — with
clipping both on and off, control 0. All eight browser checks still pass: ownership 6980/6980, coverage
0 gaps, 0 stray pixels, round-trip 9/9, max|V| 1.0000, picking 14463/14463.

Non-square canvases: the disk is sized by `min(width, height)`, so 480x200 and 200x480 both fit with 0
stray pixels. Resizing with the camera 179 symbols out leaves the address and camera matrix untouched.
Compass mode over 60 gestures and 197 re-anchors drifts north by **exactly 0**; sabotaging `rebase` to
skip the compass pull-back drifts it 3.105 rad, so the check has teeth. The node-level version of that
sensitivity is now a test too — the pre-existing "target stays on the ideal boundary" test would pass
even if `rebase` ignored the target completely.

### Also verified in the same pass

* **The dungeon atlas, by address, at absurd depth.** `panToTile` to rooms (0,0), (3,1), (40,7),
  (500,123), (5000,98765) and (100000,0) — the last about 69,300 hyperbolic units out. Every jump lands
  on exactly the requested cell (BigInt equality), `max|V|` is **1.000** at all six, every relative frame
  finite, 0 stray pixels, frame time 0.8 ms. Room 100000 draws identically to room 0. This is the
  original complaint's page, now working at a depth where the old code could not form a frame at all.
* **Zoom extremes.** 0.05 and 500 clamp to `minZoom`/`maxZoom` exactly; at zoom 40 a single tile fills the
  disk with no truncation, no stray pixels, all frames finite.
* **Hi-dpi.** devicePixelRatio 1, 2, 3: backing store scales (300/600/900 px), the disk scales with it,
  painted fraction agrees to 0.2 % and the same CSS-relative points sample the same colours. 0 stray.
  Worth noting the trap: the view's `cx/cy/radius` are CSS pixels while `getImageData` is device pixels,
  so a naive stray-pixel test reports 207,698 stray pixels at dpr 2 on a perfectly correct canvas. That
  was my measurement, not the renderer.

## 2026-08-06 (evening) — the stabiliser rule, and a new Circle Limit III

The user reported that every regular tiling in the diagnostics jumps as you drag: colour and hook
orientation snap at a threshold that is "a strict function of position". They guessed a `ceil`/`floor`
error. It is not that, and the real cause is more interesting.

**The cause.** A tile's frame is defined only up to the tile **stabiliser** `C_m`. The walk reaches each
tile by the shortest route *from the camera*, so when the camera re-anchors the routes change and with
them the frames. Measured on `{8,3}` m=4, panning one tile spacing in 100 steps: at step 51 — the single
step where the anchor changes — 16 of the 30 on-screen tiles change identity with **zero motion**, their
frames differing by exactly 0, +-90 or 180 degrees, and their colours changing because colour was
`hash(address)` and word addresses are not canonical either. The threshold sits exactly at the
perpendicular bisector, which is where it belongs. Nothing was rounding wrongly.

So the fix is not in the walk. It is that **art must be invariant under the stabiliser**, and the
library now says so, checks it, and provides the escape hatch that makes per-tile variety still
possible. `notes/tilings.md` has the full rule.

**The escape hatch.** A tile class from a group homomorphism `phi: Gamma -> Z/n`. Homomorphisms are
defined on group elements, so every word for a tile gives the same value — unlike the address. From the
abelianisation, verified by walking the graph: 3 classes for `{8,3}` m=4 (a proper 3-colouring of the
octagons), 2 for `{5,4}`, `{6,4}` and `{9,4}`, 1 elsewhere.

**Circle Limit III.** The existing tile could not be repaired. It scores `Infinity` on the symmetry
check — not one of its 90 shapes has a C4 partner — and its own cutter admits the octagon centre was
defaulted rather than fitted. Worse, *no* cut of traced art can pass, because four independently traced
fish have different vertex counts. And the vector art is mis-scaled: its 3-fold lattice sits at 1.85
where `{8,3}` predicts 1.7214.

The raster is not mis-scaled — fitting the disk radius by requiring invariance under the walk group's
own generator peaks sharply at 158.5 px against a nominal 157.5 — so `tools/trace_escher_tile.py` traces
one 90-degree sector from the woodcut and repeats it by exact rotation. Residual 3.9e-17.

**Three measurement traps on the way, all caught by controls.**

1. `local_to_disk` used `x/(1+w)` where the library's local coordinates need `x/w`. It sampled only the
   inner half of the octagon, which is why the white spine class came back empty.
2. A brightness threshold for the ink swallowed the dark blue and red fish whole (2,132 of 2,360 dark
   pixels are saturated fish colour, not outline). A local-median rule found the lines but dashed them.
   A black top-hat works.
3. The first two smoothness metrics could not detect the bug they existed to detect: consecutive frames
   of a pan gave 1.3x, a sub-pixel hop 2.5x. The negative control is what exposed both. Bisecting to the
   boundary, comparing at +-1e-4 of a tile spacing, masking the rim and counting only substantial
   changes gives 0-1 against 746-18,071.

**Where it landed.** All nine tilings scroll smoothly with pinwheel art built one wedge at a time
(residuals 6e-17 to 7e-16). Check 9 tests both halves of the rule separately and includes negative
controls, 23/23. Circle Limit III crosses a tile boundary with 3 changed pixels, identical to an
ordinary step, and looks the same at 6,114 hyperbolic units out as at the origin.

**One thing I got wrong along the way and had to walk back.** I reported early that the art "has no
4-fold centre anywhere". That was a scanning artefact: the render-based metric has a capture radius of
about 0.02, so a grid at 0.1 or 5-degree steps steps straight over the centres. At d=1.851 exactly it
scored 3.7; at 1.8 and 1.9 it read 25. The conclusion that the *cut tile* has no C4 structure stands and
is confirmed by the exact check; the sweeping version of it did not.

### Final verification of the stabiliser work

* Node suite 126/126.
* All nine browser checks pass, including the new check 9 at **38/38** across all nine tilings with
  negative controls in both halves of the rule.
* Compound scroll re-run on all nine tilings: 354 gestures each, **zero findings, zero path-dependent
  tiles**, `max|V|` 1.02-1.16 — unchanged from the pre-change baseline.
* `escher.html`, `dungeon.html`, `clock.html`, `relativity.html`, `dungeon-atlas.html` all load with no
  error box and unchanged drawable counts.
* Circle Limit III: 233 drawables, 2,540 points, ~37 ms static and ~31 ms during a drag (the old tile
  was 90/530 at 39 ms; the extra cost is absorbed by `minFeaturePx`, which drops 20,291 sub-pixel
  drawables and decimates 162,063 vertices per frame).

## 2026-08-06 (night) — the flicker and the Escher frame time

Two reports after the stabiliser fix landed: the diagnostics flickered while scrolling, but **only the
regular polygons**, and the Escher atlas was slow "despite only 233 shapes".

**The flicker.** The "only the regular polygons" was the whole clue. `request()` routed every callback
through `Promise.resolve().then(...)`, so data already in hand still arrived a microtask late — one
frame. On a `{p,q}` tiling the camera re-anchoring renames many tiles at once (word addresses are not
canonical), they all miss the address-keyed cache together, and every one returns `null` for that frame.
Measured on `{7,3}`: 26 tiles vanished together on the single re-anchor frame of a 60-step pan. Binary
barely showed it (worst 2) because its addresses are canonical and nothing is renamed. Serving
synchronous callbacks inline fixes it: **0 frames with a missing tile, on all nine tilings.**

**The frame time.** "233 shapes" is per tile; 200 tiles is 46,600 shapes. Substitution measurements:
drawing them is 36.8 ms, merely iterating them with everything culled is 6.4 ms, one shape per tile is
1.4 ms, and clipping is worth 0.4 ms. So it is genuinely the drawing, and `minFeaturePx` bottoms out
around 21 ms because in an 8 px tile the shapes are about a pixel each — a size threshold has nothing to
remove. The distribution says it plainly: **122 of 200 visible tiles had a screen radius under 8 px**.

Fix: per-tile level of detail (`lod` / `lodPx`). Circle Limit III's is one octagon in the area-weighted
average colour, computed by the tracer from its own coverage measurement. 46,600 drawables -> 12,728,
36 ms -> 12.6 ms, and the picture changes by 0.0 % of pixels inside 85 % of the radius.

**A second, larger stall showed up only once the first was fixed.** With synchronous serving the
re-anchor no longer blinks — it *stalls*, because the renamed tiles are now recompiled inside the frame.
Measured: the re-anchor frame recompiled **160 tiles and took 125 ms**, against a 16 ms median.
Memoising compiled art on the identity of the object the callback returns removes it entirely (17.7 ms),
because a provider obeying the stabiliser rule returns one of a few shared objects anyway.

Escher, end to end: static 36-47 ms -> 12.6 ms, drag median 31 -> 12.6 ms, worst frame 125 -> 20 ms.

All 130 node tests pass (four new ones pin the synchronous path, the async path, the memoisation and the
LOD switch), all nine browser checks pass including smoothness at 38/38, and compound scroll is clean on
all nine tilings.
