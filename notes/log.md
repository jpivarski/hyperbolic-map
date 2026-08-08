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

## 2026-08-06 (late) — two small refactorings, after a question about redundant code paths

Jim asked whether atlas mode and single-patch mode are separate implementations, and whether the
no-atlas case could be a one-tile (or binary) atlas so there is only one path. The answer was no: they
share everything downstream of a common join (both produce `{drawables, matrix, clip?}` passes for one
renderer), and the part that differs is not redundancy but two **data-indexing models** — view-indexed
(`give me what is visible`) versus tile-indexed (`give me tile k`). The whole single-patch-only path is
`source.js`, 139 lines. A one-tile atlas would be geometrically identical but would lose view-driven
fetching (`dataProvider`) and named sources with per-source transforms (the clock's O(1) hands); a
binary-atlas-for-everything would additionally need automatic spatial partitioning of arbitrary data,
which is what `tools/make_dungeon_atlas.py` does offline because it is not a small job.

He then asked for the two smaller cleanups I did recommend.

**1. Sources became a pass producer.** `SourceSet` (in `source.js`) now owns the named-source map, the
per-source transforms and `passes(view)` — the same interface `Atlas` already had. `render()` is a
single loop over `this.passProducers` instead of an inlined source loop followed by an atlas branch.
The viewport's public source methods delegate. An empty source contributes no pass at all, which is
what keeps the always-present `"default"` source free in atlas mode.

**2. The mode guards moved into one section.** `requireAtlas`, `refuseInAtlasMode` and
`assertGlobalCoordinatesUsable` now sit together above the public API, with a comment saying they are
one idea and pointing at the fourth guard (`atlas` + `data`) in `normaliseOptions`. The bespoke `throw`
sites became one-line calls, and the messages are now generated consistently — writing them through a
shared helper immediately exposed that `setData`'s advice was duplicated in its own explanation.

`this.atlas` branch points in `viewport.js`: 24 -> 20, and `viewport.js` 610 -> 601 lines while gaining
comments. Both units were previously untested and now have tests (four new ones, 134 total).

No behaviour change intended and none measured: 134/134 node tests, all nine browser checks (smoothness
38/38), compound scroll clean on all nine tilings, and all six demo pages render with unchanged drawable
counts — clock 87,864, dungeon 5,270, escher 38,640, relativity 5,306.

## 2026-08-07 — PR #2 cleanup: `tools/` becomes `dev/`, demo-generation removed

`OLD/` has been deleted from the working tree (by Jim), and the demos will not be regenerated from
sources again. That makes a clean cut possible: anything whose only job was to *produce* the committed
artefacts is now dead weight, while anything needed to *maintain* the library stays.

**Removed** (7 files, ~1,100 lines, plus 20 KB of committed `.pyc`):

| | why |
|---|---|
| `babudb_dump.py` | read `OLD/`; could never run again |
| `make_docs_data.py`, `make_dungeon_atlas.py` | read `build/fixtures`, themselves derived from `OLD/` |
| `fit_escher_tile.py` | already marked SUPERSEDED |
| `trace_escher_tile.py` | regenerated `docs/escher-atlas.json` from the raster; not doing that again |
| `escher-circle-limit-iii-source.jpg` | the non-free Wikipedia scan of *Circle Limit III*, committed into a BSD-3 repo |
| `tools/__pycache__/*.pyc` | committed build artefact; `__pycache__/` and `*.pyc` now ignored |

**Kept, moved to `dev/`** — maintenance scripting, not shipped code:

`build.mjs` and `check-bundle.mjs` (the actual build: `npm run build`/`npm run check`),
`audit_atlas_math.py` and `audit_atlas_numeric.py` with its feeder `emit_atlas_samples.mjs` (the two
mathematical audits, re-runnable), and `capture_server.py` (exact canvas-pixel diffs).

`tools/` is now free, and is reserved for USER-facing scripts — SVG conversion, tile-art guides — which
is a different kind of thing and should not share a directory with the build.

Both scripts compute their root as `new URL("..", import.meta.url)`, so the move needed no path edits
inside them. Verified after moving: `npm run check`, `npm run build` (dist and `docs/lib` byte-identical),
`npm test` 134/134, `audit_atlas_math.py` 31/31, `audit_atlas_numeric.py` 7/7, and all seven demo pages
loading with unchanged drawable counts.

**Dangling references, handled by kind.** Paths that merely *moved* were swapped everywhere. References
to *deleted* files were treated by what the surrounding text is for:

* live code and tests (`tiling.js`, `tiling.test.mjs`, `audit_atlas_math.py` claim 11b) describe the
  offending *formula* (`A > nw^2`) instead of the file, which is the durable statement anyway;
* `README.md`, `AGENTS.md` and `docs/escher-atlas.html` were corrected -- they made claims about tools
  that no longer exist;
* `notes/math-audit.md` is a living ledger, so its references were made to resolve;
* `notes/escher-circle-limit-iii.md` keeps its narrative (it is an accurate account of how the tile was
  derived) behind one callout saying the scripts are gone and are in git history;
* `notes/log.md` is append-only history and was not rewritten -- earlier entries still say `tools/`,
  which is what the paths were at the time.

`docs/escher-atlas.json`'s `meta.source` pointed at the deleted raster; it now describes the provenance
in prose instead of a path that cannot resolve.

**Still open, deliberately not touched:** `bench/ab.html`, `bench/baseline.html` and
`bench/make_legacy_fixtures.py` all target the 2011 implementation via `../OLD/`, so they are now
definitively dead -- but `bench/` was outside the scope of this instruction.

---

## 2026-08-07 — Remove the 2011 compatibility layer

Instruction: remove all code intended for reproducing the 2011–2012 library and any backward-compatibility
interfaces; remove compatibility options nobody would want, in particular any that draw incorrectly or
misleadingly; **keep** options that are genuinely useful even if unused by the examples; then re-verify
everything including the benchmarks.

**Four options removed because they draw the wrong picture on purpose.** Each was documented as a
faithful-port mode in its own source comment. Removing the bad *value* left one legal value in every
case, so the option key went too:

| removed | what it did |
|---|---|
| `cullMode: "endpoints"` | dropped long edges crossing the view with neither endpoint inside, and ran after all projection work so it saved nothing |
| `arcMode: "fixed"` | fixed 0.1 disk-unit chord threshold instead of the sagitta test; zoom-independent, so visibly wrong when zoomed in |
| `panClamp: false` | reinstated the freeze-drag: `if (r² >= interactRadius²) return`. There was no unclamped pan behind the flag, only the freeze |
| `radiusBasis: "width"` | sized the disk by canvas width on both axes, clipping it on a portrait canvas |

`CULL_ENDPOINTS`, `CULL_CAP` and `LEGACY_MAX_STRAIGHT_LINE_LENGTH` are gone, and `geodesicArc` lost its
`straightIfShorterThan` parameter. Unknown option names already throw, so anyone passing a removed name
gets a loud error rather than a silently different picture — the intended failure mode.

**Also removed:** `LEGACY_ALIASES` (13 option names, five of which were accepted and *silently
discarded*); `readLegacyDrawable`/`isLegacy` and the `type: "polygon"` / `d` fallbacks — all six
committed `docs/*.json` were checked and are v2; `bench/ab.html`, `bench/baseline.html`,
`bench/make_legacy_fixtures.py` (the backlog left open by the PR #2 entry above); the empty `src/compat/`
and `src/util/`; `binaryCellCentreLocal` (a zero-argument function returning `[0,0]`, kept "for the
demos", used by none); unused imports in `source.js` and `renderer.js`; and four parameters threaded into
`drawPath` that its body never read.

**`visibleFrom`/`visibleTo` removed** (Jim's call). Parsed and stored, never read by any renderer, while
`docs/escher.json` carries `visibleTo: 0.75` on 32,760 of its 38,640 records — the data asked for
zoom-gated LOD and the library ignored it. Removing the parse changes nothing visually. Recorded in
`data-extraction.md` and `open-questions.md` as an unimplemented feature rather than a subtly different
one.

**Renames, because the names lied.** `Isom.fromLegacyView` → `fromOffsetRotation`: it is not
compatibility code at all, it is the only path `ViewState` uses to build a matrix from the current
`offsetX`/`offsetY`/`rotation` options. `LEGACY_BASE_FONT_PX` → `BASE_FONT_PX`: used unconditionally, so
it is the text-sizing model rather than a mode. `tile.key` (alias for `tile.address`) dropped; its one
real consumer was `docs/dungeon-atlas.html:113`.

**The tests are where the care went.** `test/legacy-reference.mjs` was a verbatim port of the 2011
formulas used as a differential oracle by three test files. The file already split itself at its own
line 256 — `// ---- independent oracles, NOT ports ----` — and that split was the plan:

* the ports were deleted, including `centralCircle`, `tileIndex` and `longitudeRange`, which were
  exported and used by **zero** tests;
* `diskDistance`, `halfPlaneToDiskDirect` and `diskToHalfPlaneDirect` moved into `test/helpers.mjs`.
  These are second derivations written to judge the ports, not ports; a test that compares the library
  against a rearrangement of itself proves nothing, so they are load-bearing.

Four differential tests were deleted as genuine duplicates (the property each one checked indirectly is
already checked directly elsewhere: grabbed-point-under-cursor and pan-is-an-isometry subsume "pan
matches 2011 `updateCoordinates`"; "compass holds north across a multi-step drag" subsumes both
`halfPlaneOrientation` comparisons; tanh(d/2) projection plus round-trips subsume `internalToScreen`).
Four were **rewritten rather than dropped**, because deleting them would have silently weakened the suite:

* the two `coords.test.mjs` regressions already asserted the correct closed form (`sinh(|log y|/2)`,
  `exp(2 asinh y)`) at the pathological input; only the trailing "and the 2011 one fails" lines went;
* `isom.test.mjs`'s far-dungeon test now asserts the **conditioning law** instead of a flat tolerance:
  error ~ eps·w² where w = cosh(d/2). Measured ratios to that bound across the four cases: 0.93, 0.93,
  0.44, 0.49, so the 4× bound is real headroom. Extending the range to (0, 1e8) while writing this
  produced NaN — a genuine float64 boundary at w ~ 1e8 where the products reach 1e16 and the answer is
  0/0. Not asserted as a feature; noted in the test and pointed at `open-questions.md`, since it is
  exactly why the atlas never forms a global frame;
* `north()` is now pinned three ways: exactly for the identity, exactly under a pure rotation, and
  against an independent route — `applyToLocal` at (0, 1e9), which must converge to the same bearing
  (worst disagreement 1e-6 rad over 10,000 trials);
* `geodesic.test.mjs`'s sweep-sense test, the one with content nothing else covered, was rebuilt as a
  direct property test: reconstruct the walk canvas performs, require it to start at p1, end at p2 and
  sweep less than π, **with a negative control** requiring the reversed sense to be detectably wrong on
  >99% of arcs. Mutation-checked: flipping `out.anticlockwise = delta < 0` to `> 0` in the source makes
  it fail (along with "the swept arc stays inside the unit disk"), and reverting makes it pass.

`test/input.test.mjs` lost the test that asserted the removed freeze behaviour. While there, its
"dragging past the rim clamps" test contained `assert.ok(changed || true, …)` — **a tautology that could
never fail**, pre-existing and unrelated to this work. Replaced with the two properties that actually
distinguish clamping from freezing: going further along the same ray must change nothing (agreement
1.8e-15, so the threshold is 1e-12 rather than `assertUnchanged`'s 1e-15), and changing *direction*
beyond the rim must still pan. The second is the one a freeze fails.

134 → 130 tests, 0 failures: minus four duplicates, minus the freeze test, minus the tautology's file
count staying level, plus the rewrites in place.

**Notes.** `legacy-decoded.md` is deleted; its still-live content — canvas pixels are not deterministic
across repeated draws, plus the rAF-throttling and protocol-timeout traps — became
`notes/canvas-testing.md`, and the four files that cited it (`bench/sweep.js`, `bench/stress.html`,
`docs/demo/compound-scroll.js`, `docs/demo/diagnostic-checks.js`) were repointed. The 2011 sections of
`math-audit.md` are marked historical but **kept**: they record which formulas were verified *correct*,
and several of the correct ones look wrong. `performance.md`'s legacy baseline moved from "deferred —
machine busy" to abandoned, since the harness that would produce it no longer exists; the deferral record
stays because the rule it illustrates does.

**`AGENTS.md` said something false.** "`OLD/` … stays `.gitignore`d, so it cannot return by accident" —
`.gitignore` has no `OLD/` entry and has not had one since Jim removed it. Rewritten to say plainly that
there is no such safety net and to check `git status` before staging if the tree is ever restored
locally. `viewport.js` also told users to "See the alias table in README.md", which never existed; that
warning is gone with the aliases.

**Left alone deliberately:** `build/fixtures/` and `build/baseline/` (~68 MB, gitignored) are the last
extant copy of the extracted 2011 databases. Their only consumers were the three deleted bench files, but
destroying unrecoverable data was not asked for. `README.md`'s reference to a future `tools/` directory is
Jim's placeholder. The historical prose in `docs/*.html` and `docs/MATH.md` about the 2011 origins is the
site's narrative and is still accurate.

---

## 2026-08-07 — dungeon-atlas.html was upside down, and panning silently levelled the map

Jim: "the initial view is upside down. I think I remember drawing everything upside down for some
reason, but then dungeon.html flips it. Don't just rotate the viewport unless you also flip the
numbers." Then, after the first fix: "The 'jump to row' functionality makes it upside down again."

**Measured before changing anything.** dungeon.html presents the hero cell (-1, 0) with its cell-local
+y axis at screen bearing **179.87 degrees** and +x at **-90.04** -- a pi rotation to within 0.13. So
the 2012 art really is drawn upside down in the cell frame, and dungeon.html's hand-tuned
`rotation: 2.86` (163.87 degrees) is what stands it back up. dungeon-atlas.html had rotation 0 and so
showed it inverted: in the cell-local critter data the hero's yellow shield sits ABOVE the sprite
midline, and it renders below in dungeon.html.

**Camera rotation, not a per-cell art flip.** Rotating each cell's art by pi about its own centre would
sever every door junction -- the doors are drawn straddling cell boundaries on purpose, which is the
same reason clipping is off on that page. A camera rotation is rigid and keeps them joined. So
`rotation: Math.PI`, which puts the anchor cell at exactly 180/-90.

**The labels had to be turned back, exactly as Jim warned.** With the rotation alone, 29 of 34 visible
labels read upside down (median up-vector bearing 138.5 degrees off screen-up). Fixed by rotating the
two label anchors by pi about the CELL'S OWN centre, which on the cell's vertical axis is just
h -> 1/h: the 2012 `1.2/sqrt(2)` and `1.4/sqrt(2)` become `sqrt(2)/1.2` and `sqrt(2)/1.4`. Verified
identical to negating the local coordinates, to 1e-16. After: median 51.8 degrees, 4 outliers at
70-73% of the disk radius sitting at ~91 degrees -- reading sideways, not inverted, because the cell
frames genuinely fan out that far at the rim, and the room art there is rotated identically.

**Then the second report exposed a LIBRARY bug, not a demo bug.** `panToTile` and `panTo` both did

    this.view.matrix = Isom.translationToLocal(x, y).inverse();

a bare translation, whose screen rotation is exactly zero -- so every pan silently levelled the map.
Invisible on any page that never rotates, which is why it survived: all five other in-repo callers
(tiling-diagnostics, four in diagnostic-checks, bench/stress) sit at rotation 0. On dungeon-atlas.html
it turned the whole dungeon over on "go".

Both now go through a new `panMatrix(x, y)`, which carries the current `screenRotation()` across. In
atlas mode the rotation is expressed in the anchor tile's frame, so reusing the same angle in the new
anchor's frame is exactly right: the camera keeps its orientation relative to the tiling and the art
stays the way up it was. Verified in the browser -- the anchor cell holds at 180 degrees through jumps
to rows 3, 0, 40/col 12345 and -7, and back.

Test added in `source.test.mjs`: the rotation is preserved AND the requested point still lands at the
centre (a pan that stopped panning would otherwise pass), across five angles and three targets, plus
the assumption the fix rests on -- `translationToLocal(...).inverse().screenRotation()` is 0 to 1e-15 --
plus a negative control asserting the old bare-translation form does NOT preserve a pi rotation.

Verified: `npm test` 131/131, `npm run check`, `npm run build`, all nine browser diagnostics
(invariance still 45/45 byte-identical; picking 14463/14463; smoothness 38/38).

**Not done, on instruction.** dungeon.html has the mirror-image bug -- art upright, labels inverted --
and the same reciprocal-anchor fix took it from 40/56 inverted labels to 6. Jim: "Don't worry about
dungeon.html. I'm working on dungeon-atlas.html to *replace* dungeon.html." Reverted; it is in this
session's history if the replacement stalls.

---

## 2026-08-07 — the world-turtle on dungeon-atlas.html, and what "rotates with the disk" means in an atlas

Jim: "Now I'd like to have the turtle and stars on dungeon-atlas.html. Make sure that the turtle
rotates with the content of the disk."

Copying the two `imageLayer`s across from dungeon.html is the easy part. The requirement in the second
sentence is not, and passing `rotateWithDisk: true` would have satisfied it only in appearance.

**Measured first.** `imageLayer` rotates by `view.rotation`, which is `liveMatrix.screenRotation()`.
In ATLAS mode that matrix is expressed in the ANCHOR TILE's frame, and the anchor changes as you walk.
Each change multiplies by one generator, and the binary tiling's generators are not pure translations
in the disk -- the Cayley conjugation gives `a = (S + 1 + iT)/(2 sqrt(S))`, so `Im(a) != 0` whenever
`T != 0`, i.e. for every lateral, child and parent step. So `view.rotation` JUMPS: measured up to
**34.16 degrees** across one re-anchor, from a pan step of 0.0092 hyperbolic units, while the dungeon
content crosses the same boundary perfectly smoothly (that is what diagnostic check 9 guarantees). The
shell would have snapped while the world it is carrying did not.

**What is not attainable, established by measurement rather than by assertion.** A shell rigidly pinned
to the plane needs the global frame, which is the one thing an atlas has no bounded representation for.
The obvious substitute -- accumulate the camera's incremental rotation, every factor O(1) -- was tried
and rejected on evidence: against the true global rotation (computable near the origin via
`globalFrameForTesting`) it drifts **9.9 degrees** over a straight 2.5-unit walk and **71.1 degrees**
around a closed 0.8-unit square. What scalar accumulation drops IS the holonomy, which is precisely the
part that makes a pinned object appear to turn as you pan. `rot(AB) != rot(A) + rot(B)`.

(The first version of that harness was wrong -- it seeded the accumulator from a field it set after
pushing the row -- and reported a 163-degree error everywhere, including at t = 0 where the error must
be zero. An error that is nonzero at the start is a harness bug, not a finding.)

**What is attainable, and is what the eye actually checks: continuity.** The layer now cancels the
re-anchor jump. It keeps the previous frame's raw `view.rotation` and the anchor id; when the anchor
changes it absorbs the difference into an offset and keeps drawing at the angle it was already at.
Between re-anchors the angle is exactly `view.rotation`, so a rim drag turns the shell by precisely the
angle swept -- verified, 57.296 degrees applied gives 57.296 degrees of shell. Worst frame-to-frame
jump over a 2.5-unit walk with 10 re-anchors: **0.082 degrees**, and the worst case is ordinary smooth
motion, not a re-anchor. Same walk diagonally: 0.046 degrees over 4 re-anchors.

Absolute registration against a point at infinity is given up knowingly. Nothing on screen reveals its
absence: the shell has no visible reference to be wrong against, whereas a 34-degree snap is obvious.
Both the page and `layers.js` say so rather than leaving it to be rediscovered.

Two details worth keeping:

* the tracker runs BEFORE the `hideWhenDiskFills` early return. It compares against the previous frame,
  so letting it go stale while the shell is hidden (it hides at the opening zoom of 3, by design)
  would make it reappear after a zoom-out with one large bogus correction.
* single-patch pages are untouched: `viewport.atlas` is null, `diskRotation` returns `view.rotation`
  verbatim, and dungeon.html's shell still equals `view.rotation` to 1e-12 and turns by exactly the
  angle applied. Verified, not assumed.

Verified: `npm test` 131/131, `npm run check`; shell hidden at the opening zoom 3 and drawn at 1.2 and
0.5 (2 images each: stars + turtle); "jump to row 12 col -5" still lands with the anchor cell at 180
degrees, so the layers did not disturb the pan fix; stars confirmed not rotating while the turtle
turns a quarter turn.

---

## 2026-08-07 — an infinite random dungeon from one salt

Jim reworked `docs/dungeon-atlas.json`'s `critters` from a cell-keyed table of 399 placements into a
library of nine named pieces of art (`octorock`, `stalfos`, `fire`, `link`, `fairy`, `mr-T`, `tektite`,
`old-woman`, `old-man`), each in generic cell-local coordinates so any of them can go in any cell. The
brief: `link` at (-1, 0) as before; three rooms in four empty; the rest a non-`link` critter with `mr-T`
at 1/30 and the others uniform; and -- his own framing -- "pick a random salt at page-load and use that
in a deterministic hash function. That way, a page-load determines an infinite, random dungeon."

**The weights are exact, not rounded.** `mr-T` at 1/30 leaves 29/30 for the other seven, i.e. 29/210
each; 7 + 7*29 = 210, so integer weights in 210ths with a BigInt `%` reproduce the distribution with no
residue. Occupancy is `hash % 4 == 0`, and 4 divides 2^64, so that quarter is exact too.

**The hash is BigInt, and that is not fussiness.** Addresses are BigInt because descending one latitude
doubles the longitude, so a double stops being exact about fifty levels down; hashing through `Number`
would make distant rooms alias onto each other. `& M64` on a negative BigInt yields its two's-complement
low 64 bits, which is what is wanted -- latitudes are negative going down and longitudes run both ways.
splitmix64's finaliser does the mixing, chosen because adjacent rooms differ by one in lat or lon and a
weak hash would lay visible stripes of the same critter along a row of neighbours. Two separately
tweaked hashes for the two decisions, so "is it occupied" cannot correlate with "who is it".

Verified over **96,000 cells** on two different salts:

| quantity | measured | target |
|---|---|---|
| empty | 74.85 % / 74.94 % | 75 % |
| `mr-T`, share of occupied | 3.268 % / 3.225 % | 3.333 % |
| the seven others, mean share | 13.818 % | 13.810 % |
| `mr-T` relative to one common critter | 0.236 | 0.241 |
| `link` | exactly 1 cell, at (-1, 0) | 1 |

Independence, which is the property that would actually be visible if it failed: expected same-critter
rate for two independent cells is 0.75^2 + 0.25^2 * sum(p_c^2) = **0.5709**. Measured over 32,000
neighbour pairs each: lateral 0.5734, child 0.5762, parent 0.5743. No streaking.

Exactness at depth: correct and stable at `lon = 2^180`, and `2^180` versus `2^180 + 1` give *different*
critters, so nothing is colliding by truncation. Also checked at `lat = 1000`, `lon = -2^90`.

Two behavioural requirements, both verified rather than assumed:

* the salt is drawn OUTSIDE `build()`, so toggling "room numbers" or "clip each cell" rebuilds the
  viewport without redecorating the world -- fingerprint over 480 cells identical across both toggles
  and both together;
* a reload really does re-roll it -- 57.5 % agreement between consecutive loads, against the 57.1 %
  expected for independent draws.

**Two of my own measurements were wrong before they were right**, both times because the harness
mis-modelled the drawable list: the first counted room-number *text* drawables as critter shapes and so
reported 0 % empty with everything "UNKNOWN". A result that disagrees with the target by 75 percentage
points is a broken measurement, not a broken feature.

Prose updated to match, including a claim I had to correct: I first wrote that Mr. T appears "a tenth as
often as the others", but 7/29 is about a **quarter**. `dungeon-atlas.json`'s own `note` field and
`notes/data-extraction.md` both said `critters` held "the finitely many cells that carry characters",
which is no longer true; both now describe the library-plus-hash arrangement and record that the 2012
442-placement list is no longer used.

---

## 2026-08-07 — room numbers moved to the top of each room and shrunk

Jim: "I want the numbers to go on the top of each room and be slightly smaller so that most of the
critters are not overlapped by numbers."

**Measured the actual geometry first**, on a clean camera (hero cell centred, the page's pi rotation,
zoom 2.2, disk radius 682 px, so one local unit is about 682 px). Screen y with negative up:

| | screen y |
|---|---|
| cell's own extent | -117 … +115 (local y +-0.1742) |
| room art | -89 … +140 (it overflows the cell at the bottom, by design) |
| critter tops | mr-T -53.5, link -48.9, then fire/old-man/old-woman/stalfos at -42.3, fairy -38.4, octorock/tektite -14 |
| label anchor, before | **+55.9**, glyph 52.4 px |

So the label was sitting at +56, in the middle of critters that span roughly -50 to +115. That is why
everything collided.

**Reparametrised rather than tuned two magic numbers.** The anchors were a pair of half-plane heights
(`sqrt(2)/1.2`, `sqrt(2)/1.4`) whose relationship encoded position AND size at once. They are now two
independent local-coordinate constants on the cell's vertical axis:

    const NUM_Y = -0.115;      // where the two-line block is centred
    const NUM_GLYPH = 0.040;   // length of the up-vector, i.e. the glyph height

Local -y is screen-up under the page's pi rotation, so both are negative. This also drops the
`halfPlaneToLocal` reciprocal trick and the paragraph explaining it. `up` is load-bearing twice over --
the renderer takes the glyph height from the projected `|up - at|` (renderer.js:442) -- and separating
the two is exactly what allows a small label to be tucked into the strip above the critters.

**Result:** block spans -104.5 … -51.4 with a 26.5 px glyph (was 52.4). Clearances: link +2.5,
fire +9.0, old-man/old-woman/stalfos +9.1, fairy +13.0, octorock +37.2, tektite +37.4. **Eight of nine
clear**; only mr-T is touched, by 2.1 px, and he occupies one room in 120 (a quarter occupied times
1/30). link is the hero and never labelled anyway, so in practice nothing that gets a number is
obscured.

Worth recording because it makes the check cheap: **the overlap question is identical for every cell.**
Labels and critters are both given in cell-local coordinates and share one transform per tile, so one
cell's measurement settles all of them. Horizontally they always overlap (both centred near local
x = 0, critters spanning about -0.10 to +0.11), so the vertical band test is the whole test.

Both anchor and up-point are inside the cell (`containsLocal` true for each; the up-point clears the
cell's bottom edge by 0.0192 local units), so a label can never wander into a neighbour's room.

Also removed `const HALF = BINARY_LOCAL_HALF_WIDTH`, declared and never used.

Verified visually at zoom 2.2 and 1.5 with 52 of 220 visible cells occupied, and at row 40 / col 12345
where the labels are six characters long -- they still sit at the room tops and still fit the room
width. `npm test` 131/131, `npm run check` ok.

---

## 2026-08-07 — the stroke across the grey cross-shapes: the doorway's inner mouth

Jim spotted "a stroke that crosses the middle of a grey cross-shape (sometimes)" in the room drawables
and guessed it was "an `L` that needs to become unstroked". It was, and here is which one.

`docs/dungeon-atlas.json`'s `room[2]` is the doorway OUTLINE (no fill, black stroke), a four-point
quadrilateral. Measuring its edges settles it immediately:

| edge | length | flag |
|---|---|---|
| 0->1 | 0.0913 | `L` |
| **1->2** | **0.0336** | **`L`** |
| 2->3 | 0.0910 | `L` |
| 3->0 | 0.0397 | none |

The doorway is a long thin SLOT. The two long edges are its jambs and must be stroked; the two short
edges are its two mouths, where the passage opens into a room at either end, and must not be. One mouth
(3->0) was already open. The other (1->2) was being capped.

**Why it looks like a line across a cross rather than a cap on a slot, and why only sometimes.** The
grey cross-shapes on screen are not single drawables. Each is one cell's floor plate joined to a
*neighbouring* cell's doorway slot -- the art straddles cell boundaries on purpose. The capped mouth is
exactly the seam between those two pieces, so the stroke lands in the middle of what reads as one grey
shape, and only when both pieces happen to be drawn.

Ruled out first, so the diagnosis was not a guess: no shape in `room` self-intersects (all-pairs proper
segment-intersection test over all seven, zero hits), and `room[2]` was the only shape with a
partially-stroked outline, so nothing else could be drawing an interior line.

Fixed by stripping the `L` from `room[2].points[1]`; the outline now strokes 2 of 4 edges, the two
jambs. Confirmed by rendering the same junction side by side, before and after, at two magnifications:
the internal line disappears and **no gap appears in the silhouette** -- which is the check that matters,
since removing a stroke could just as easily have opened the outline. Also verified across 220 visible
tiles at zoom 1.4, and that clip mode still renders.

Note this does NOT touch dungeon.html, whose `DOORWAY` in `demo/dungeon-rooms.js` has the same defect:
`pathFrom(..., closed = false)` strips the flag from the LAST point only, so it too caps one mouth. Left
alone deliberately -- dungeon-atlas.html is replacing that page.

---

## 2026-08-07 — CORRECTION: it was painter's order, not a stroke flag. `drawOrder` added.

**The previous entry is wrong and this one supersedes it.** I removed the `L` from
`room[2].points[1]` and reported it as the fix. Jim: "No, you removed the wrong stroke. The path
already had the correct `L` removed (the last one). What's different now is that I expected a different
order of tile-drawing." Reverted; `room[2]` is back to `["L","L","L","-"]`.

What I got right was the location -- the stroke really is the doorway's mouth at the seam between one
cell's slot and a neighbour's floor plate. What I got wrong was the cause. That stroke is *supposed* to
be drawn; it is supposed to be **painted over** by the abutting plate. Whether it is depends entirely on
which of the two cells paints last, and I never questioned the draw order because the geometry
explanation was self-consistent. A side-by-side before/after that "looks cleaner" cannot distinguish
"removed a stroke that should not exist" from "removed a stroke that should be covered" -- both look
identical. The test I ran could not have told me I was wrong.

**New library option, on BinaryTiling: `drawOrder`.** A three-character code, parsed by the exported
`binaryDrawOrder(code)`:

* character 1: `H` sorts by longitude first, `V` by latitude first;
* character 2: direction of that first key, `>` increasing or `<` decreasing;
* character 3: direction of the second key.

So `H>>`, `H><`, `H<>`, `H<<`, `V>>`, `V><`, `V<>`, `V<<`; later paints on top. A malformed code throws
and names the eight. Sorting is BigInt, so it stays exact at any depth -- a float64 longitude would tie
distinct cells together about fifty levels down, and a tie is an arbitrary paint order, the very thing
being fixed.

Why it is needed at all: the atlas walks nearest-first FROM THE CAMERA. That is right for culling but
makes the paint order camera-dependent, so two overlapping cells swap as you pan and a covered seam
surfaces as a stray stroke. Address order is stable because the relative order of any two cells never
changes.

Two care points in `Atlas.passes()`:

* the sort runs on a **copy**, and only **after** `anchor.neighbourhood()` has chosen the set. The walk
  admits nearest-first and `maxTiles` truncates the tail, so sorting earlier would change WHICH tiles
  are drawn, not just their order;
* the default is `null` = today's walk order, so no existing page changes appearance by accident.
  `escher-atlas.html` clips, so order is invisible there regardless.

I showed Jim `H>>` and `H><` magnified on the differing seam (215 of 384,400 pixels differ -- the
magnitude of exactly one stroke, which is why this was so easy to misread as a flag). He identified
**`V>>`** as correct for the 2012 art. Hard-coded on the page.

Per his instruction the page now has only two controls, "room numbers" and "jump to...": the "clip each
cell" checkbox and the "draw order" dropdown are gone, with `clip: "never"` and `drawOrder: "V>>"` fixed
in code. The clipping note no longer says "tick the box above", and a new note explains the draw order,
since it is now an invisible constant that decides what the art looks like.

Verified: `npm test` 131/131, `npm run check`, rebuilt `dist/` (the bundle test caught the stale bundle
before I did, exactly as designed). All nine browser diagnostics still pass -- notably **check 8,
picking, 14463/14463**, which is the one that depends on draw order; the binary default of `null` leaves
the diagnostics' own tilings unsorted. Anchor cell presents at exactly 180 degrees on an untouched page
load and after a jump; a reading of -177.21 during testing was my own dirty camera state, confirmed by
re-running the sequence clean (the bearing deviates from 180 only when the camera is genuinely off the
cell's origin, which is correct parallel transport).

---

## 2026-08-07 — dungeon-atlas.html renamed to dungeon-man.html

Jim rewrote the page (new title "Dungeon Man", a long section on intrinsic curvature illustrated with
seven images, controls reduced to the room-number toggle and jump-to) and asked for the rename plus
every link updated.

`git mv` (recorded as a rename, not add+delete), then six references:

| file | what |
|---|---|
| `docs/index.html` | the demo-list link; text also changed from "Infinite dungeon" to "Dungeon Man", since that is the page's own title now |
| `docs/dungeon.html` | the "tiled version" link |
| `src/viewport.js` | the `panMatrix` comment citing the page as the motivating case |
| `docs/demo/layers.js` | the `diskRotation` comment citing its measured 34.2-degree jump |
| `test/source.test.mjs` | the pan-preserves-rotation test's rationale comment |
| `notes/data-extraction.md` | the note on the reworked `critters` |

**Left alone deliberately.** `notes/log.md` still says `dungeon-atlas.html` in ten places: it is
append-only, and those entries are accurate about what the file was called when they were written.
`docs/dungeon-atlas.json` keeps its name -- the instruction was to rename the page, and the data file is
a separate artefact; say the word if it should follow.

Verified: the old URL now 404s and the new one serves 200; every internal link on `index.html` and
`dungeon.html` resolves (checked by fetching each one, 7 and 3 links respectively); the renamed page
builds its viewport, draws 19 tiles at `drawOrder: "V>>"`, and all seven `img/` assets load with no
console errors. All seven images were already tracked in git, so GitHub Pages will have them.
`npm run check`, `npm test` 131/131, `dist/` rebuilt so the stale comment is gone from the bundle too.

---

## 2026-08-07 — `aspectRatio`, and the mobile overflow that turned out to be the same bug

Jim: the widget should "fill 100% of its parent's width with aspect ratio = 1" (adding options if
needed, documented in the README), and the page should be mobile-friendly -- "the margins scale as the
window width narrows, but past a certain point, the text's width narrows more than the margins (some
bug in the CSS)".

**Measured before touching the CSS, and the two requests are one bug.** At a 485 px viewport the only
elements extending past it were `#map` and its canvas: fixed at 620 px, giving a document
`scrollWidth` of 636. The body and its text wrap to the viewport (453 px of text), but the *document*
is 636 px wide, so relative to the scrollable page the text looks narrow with a large right margin.
That is exactly the reported symptom, and there is no separate CSS defect -- re-checked after the fix
at body widths 320/360/414/480, zero elements escape the content box.

**New option: `aspectRatio` (width / height), on the Surface and so on the viewport.** With
`autoResize` it makes the widget responsive. Three decisions worth keeping:

* **The height is derived from the width, never the reverse, and `height` alongside it throws.** The
  canvas is normally the only thing giving its container a height, so a widget that measured that
  height back would oscillate. Deriving one way breaks the cycle; the observer reads width only.
  Non-positive, non-finite and string ratios throw too.
* **The container must not shrink-wrap.** `#map` was `display: inline-block`, which sizes to its
  content -- the widget would have measured its own canvas and never resized. The demo stylesheet
  grows a `#map.fill { display: block; width: 100% }` variant; plain `#map` is untouched, so the other
  five pages keep their fixed sizes and their checkerboard shrink-wrap. Verified: all five still
  report `inline-block` and their original canvas dimensions.
* **No `max-width: 100%` on the canvas.** That was the tempting one-line "fix" and it is wrong: CSS
  would scale the element while the backing store and `surface.cssWidth` stayed put, so the canvas
  rect would stop matching the size the library thinks it has and every pointer position would be off
  by the ratio. The canvas is resized for real. Both the CSS comment and the README say so.

`dungeon-man.html` now passes `aspectRatio: 1, autoResize: true` with `<div id="map" class="fill">`.

Verified in the browser: no horizontal overflow at any width; canvas square and byte-matching
`surface.cssWidth`/`cssHeight` at every step of a 320→1024 sweep; **zero extra resize calls after the
width settles**, which is the oscillation guard actually holding; and after a resize the pointer path
still round-trips -- screen centre maps to the view origin exactly, and `toScreen`/`fromScreen` on
(0.3, -0.2) closes to 2.8e-17.

New `test/surface.test.mjs`, six tests: the derivation itself, container-width defaulting, the
`height` conflict and the invalid-ratio rejections, the backing store equalling CSS size times DPR
(the invariant whose violation is exactly the CSS-scaling trap), a regression test that a second
resize at an unchanged width is a no-op **with a control that a real width change still takes effect**
-- otherwise it would pass on a dead widget -- and that `radiusFor` still uses the shorter side so a
non-square ratio does not clip the disk.

Suite 131 -> 137, all passing. `npm run check`, `dist/` rebuilt, all nine browser diagnostics still
pass. The stale bundle bit me once mid-task: the page threw `unknown option(s): aspectRatio` because
`docs/lib/` had not been rebuilt, which is the option validator doing its job.

**Still fixed-size, and still overflowing on a phone:** `escher.html`, `escher-atlas.html`,
`dungeon.html`, `clock.html`, `relativity.html`. The instruction named one page; converting them is
two lines each plus the `fill` class.

---

## 2026-08-07 — relativity.html renamed to jumping-man.html, compass mode made unconditional

Jim: "Rename relativity.html to jumping-man.html and remove the 'compass' vs 'parallel transport'
buttons; it should always be in 'compass' mode."

`git mv`, then exactly one link to update: `docs/index.html`. Every other `relativity` reference in the
tree is to the **dataset** -- `relativity.json`, the 2011 database, the row in
`data-extraction.md`'s tables, the timings in `performance.md` -- and those are unchanged, the same
way `dungeon-atlas.json` kept its name when its page was renamed. `notes/log.md` still says
`relativity.html` in two places and stays that way, being append-only.

The radio pair and the whole `.controls` div are gone, `rotationMode: "compass"` is hard-coded, and the
`build(mode)` wrapper with its rebuild-on-change listener collapses to a single construction -- it only
existed to swap modes.

**One prose edit was forced by the removal**, not optional: the first note ended "Switch between the two
above and drag in a circle to feel the difference", pointing at a control that no longer exists. It now
explains `parallel-transport` as the library default that every other example uses, with this page as
the exception. The second note (compass mode cannot pin the grabbed point and the bearing at once) was
already independent of the control and stands.

Verified: the old URL 404s, the new one serves 200, and all eight internal links on `index.html`
resolve. The radios and `.controls` are gone from the DOM, `rotationMode` reads "compass", and
`view.rotationMode === ROTATION_COMPASS` -- and it demonstrably WORKS rather than merely being set:
dragging a full circle drifts the bearing by **8.9e-14 degrees**, which is the property the page exists
to show. 137 tests, `npm run check` ok. No `src/` change, so no rebuild needed.

**Left for Jim.** The page is still headed "Compass mode", and the index still links it under that
name, which is the feature rather than the content -- the art is a Mario-like figure jumping along a
worldline on altitude/time axes, which is presumably where "jumping man" comes from. Retitling is his
prose to write, so I did not presume; the mechanical rename is complete either way. This page is also
still fixed at 620x620 and so still overflows on a phone, along with escher, escher-atlas, dungeon and
clock.

---

## 2026-08-07 — the shrink-wrap trap caught Jim immediately, so the library now warns about it

Jim: "I tried to make the widget in jumping-man.html fill its container like the one in
dungeon-man.html, but it didn't work." His change was right in every respect except one: the `<div
id="map">` was missing `class="fill"`, so it was still `display: inline-block`.

**Measured:** the container reported `clientWidth` **300** and the widget came out 300x300 inside a
704 px column. 300 is a fresh `<canvas>`'s default width -- the inline-block had shrink-wrapped the
canvas that had just been inserted into it, so it was reporting the widget's own output back at it.
Nothing threw, nothing appeared in the console, and the picture looked plausible.

I had documented this trap in the README when adding `aspectRatio`, one task earlier, and it caught him
anyway on the very next page. A hazard that only a comment protects you from is not protected.

**The library now detects it.** The container's width is read WHILE IT IS STILL EMPTY, before the
canvas is appended. That single change does two things:

* it is the more correct measurement anyway -- a block container reports the same width before and
  after, so nothing is lost;
* an empty shrink-wrapping container is **0 px** wide, which is an unambiguous signal. Once the canvas
  is in, it reports 300 and is indistinguishable from a healthy container.

On that signal, with `aspectRatio` set and no explicit `width`, it `console.warn`s: what is wrong, the
three CSS shapes that cause it, and the fix. A warning and not a throw, because a container inside a
hidden tab is legitimately 0 wide at construction and `autoResize` will pick up the real size later.

Verified in the browser across six configurations: warns for `inline-block`, `float:left` and
`width: fit-content`; silent for `display:block; width:100%`, for an explicit `width` (which answers
the question, so there is nothing to warn about), and when `aspectRatio` is not used at all. **No false
positives** -- the negative cases matter as much as the positive one, since a warning that cries wolf
gets filtered out.

Three tests added (140 total). The fix to the page itself is one attribute.

Verified afterwards: canvas fills the column, square, matching `surface.cssWidth`, at body widths
320/480/700/900; compass mode still holds a bearing to 5.1e-14 degrees around a full circle after all
that resizing; and the four fixed-size pages plus dungeon-man render at their original sizes with no
spurious warning.

README updated -- the shrink-wrap paragraph now names the 300 px symptom and says the widget warns.

---

## 2026-08-08-a — Canonical tile identity: exact ids over Z[2cos(pi/N)]

**What.** A `{p,q}` tile now has a canonical id and a canonical frame, both functions of the tile
rather than of the route the camera took to reach it. Tile art may be fully asymmetric and may depend
on its own address. Three new dependency-free modules -- `exactring.js`, `exactcoxeter.js`,
`exactcalib.js` -- plus a node store in `RegularTiling`.

**Why.** A tile is a coset `F . C_m` of its stabiliser, and the renderer previously named it by the
route it happened to take, so the same tile got different names and different orientations depending on
where the camera was. Asymmetric art rotated at every tile crossing: measured on `{8,3}` m=4, 16 of 30
on-screen tiles turned by a multiple of 90 degrees at a single re-anchor. The fix is to choose the
lexicographically least element of the coset once and for all. Two routes give `M` and `M . P^j`, whose
candidate sets `{M . P^k}` coincide, so the minimum is route-independent -- the whole proof, with no
automaton and no normal form.

**Exact, because float identity has a ceiling.** Frame entries grow like `cosh(d/2)`, so past `d ~ 37`
one ulp exceeds the spacing between tile centres and no float test can separate two tiles. Integers
have no ceiling. The representation is the Coxeter geometric one over `Z[mu]`, `mu = 2cos(pi/N)`, with
BigInt coefficients; faithfulness (Tits) is what makes matrix equality a *definition* of group equality.
The published id is the serialized centre `F . v_O` -- three ring elements, not nine, and canonical
automatically because `P` fixes `v_O`.

**One error found in the design document before coding.** It gave `lambda_n = D_{N/n}(mu)` alongside
the `n = 3` shortcut (`N = p` when `q = 3`). The Dickson identity needs `n | N`; with `N = 8, n = 3` the
division truncates and silently yields `sqrt(2)` instead of `1`. The Coxeter relations failed for
`{8,3}`, `{7,3}` and `{3,7}` until `lambdaFor` special-cased it. It is now an assert with a regression
test.

**Two simplifications the design missed.** Conjugation by `P` is a pure permutation of generator
indices with no residual angle, so the transport table is `m x |gens|` small integers; and folding
`P^k` into each walk step keeps every frame canonical, so the walk forward never needs the table at all.
Stepping BACK does -- hence `reverseGenerator(address, gen)`, which is NOT `inverseGenerator(gen)`.
Using the plain inverse index lands on a real but wrong neighbour.

**A pre-existing bug found by sweeping `frameSymmetry`.** Any divisor of `p` was accepted, but for
`m < p` the generators are vertex rotations reaching `2m` of the `p` edges, so only `m = p` and
`m = p/2` can cover the plane. `{8,3}` with `m = 2` constructed happily, reached edges 0, 1, 4 and 5,
and returned 5 tiles for a view holding 17. Now throws.

**Measured.**

| | |
|---|---|
| steady-state frame, Escher atlas | 16.4 ms median; 197 frames in 200 do zero ring multiplies |
| first frame; first frame into unexplored ground | 250 ms; ~130 ms |
| id length | ~12 characters per tile crossed |
| escher-atlas pixels | identical inside `r < 0.8`; 1,070 of 313,600 differ at the rim, from `minFeaturePx` threshold flips |
| binary tiling | byte-identical, 0 of 691,200 channels |
| browser checks | 1-10 pass, including the new check 10 |

**What it cost.** Naming tiles globally needs `Omega(d)` bits, so a long excursion is no longer free:
the extreme-distance tests dropped from 100,000 tiles to 1,000, and check 2's translation-invariance
distance from 5,000 to 2,000. `{3,7}` is no longer byte-identical under translation -- 1 to 4 channels
of 409,600 differ by one level of 255, because canonicalisation is not equivariant under translation and
a tile turned by 120 degrees rasterises its last bit differently. The node store is bounded so memory is
linear in distance rather than quadratic.

**Left.** Performance, deliberately deferred to a later pass; `notes/open-questions.md` records the
three routes (cheaper canonicalisation, amortising the burst, a shortlex normal form).

## 2026-08-08-b — `tools/`: drawables <-> SVG, so artwork can be drawn in Inkscape

**What.** The two user-facing scripts `AGENTS.md` has been reserving `tools/` for, plus
`tools/README.md`. `README.md:49` already promised them.

```
python3 tools/drawables_to_svg.py FROM.json TO.svg  JSON-PATH [--coords ...] [--guidelines ...]
python3 tools/svg_to_drawables.py FROM.svg  TO.json JSON-PATH
```

`JSON-PATH` is dotted, with integer steps for arrays, because drawables are always a *part* of a file:
`drawables` in `escher-atlas.json`, `critters.fairy` in `dungeon-atlas.json`. The reader **overwrites**
that array in place; copying is the user's job, deliberately.

**Constraints, from Jim.** Standard library only and each file individually self-contained, because the
audience is JavaScript developers who can run `python3` but have no Python environment to manage —
"or more likely, everyone has a *different* setup". So `resolve_json_path` is duplicated **verbatim**
in both files between `KEEP IN SYNC` banners, with a one-line check in `tools/README.md` that asserts
the two copies are character-for-character identical. It returns `(parent, key, value)` so that one
identical function serves the reader (which assigns through `parent[key]`) and the writer (which only
wants `value`).

**Rejected: exact geodesic arcs for drawable edges.** In `disk` and `halfplane` coordinates a geodesic
*is* a circular arc, so SVG `A` commands would match the viewer pixel-for-pixel. Jim chose straight
`L` segments instead, and it is the right call for a hand-editing tool: one SVG node per JSON point
means dragging a node moves exactly that point. The cost is measured — at a 500 px disk radius 99 % of
`escher-atlas.json` edges bow under 0.35 px, worst 6 px — and documented. Guidelines, which are display
only and never read back, *are* sampled as true curves.

**Guidelines.** One `<g class="hyperbolic-map-widget-guidelines">`, which the reader skips, under the
art. `RegularTiling(p,q,m)` draws the base border, one ring of neighbours, and a large **R** in each
neighbour showing the rotation that neighbour is placed in — which makes THE STABILISER RULE visible
at the seams where violating it actually tears. `BinaryTiling()` draws six neighbours, not five: a
prototype cell has no longitude, so it does not know which parent parity applies, and both are shown.
Only the writer computes any of this.

**Measured, guidelines.** `{8,3}` `chi`/`psi` agree with `notes/tilings.md` and with
`escher-atlas.json`'s own `meta` to 1e-12; the sampled border passes through all 8 vertices to 1e-14;
its minimum and maximum hyperbolic radius are exactly the inradius and circumradius; the 8 neighbour
centres are all distinct and at `2*psi` to 1.1e-15; the binary cell reproduces the documented box to
1e-12 and has hyperbolic area exactly 0.5. Sampling error 0.003 px for borders and 0.045 px for the R,
against **5.5 px** for the vertex-to-vertex straight lines the sampling replaces — which is the whole
reason it is there.

**Measured, round trip.** `escher-atlas.json` `drawables` and `dungeon-atlas.json` `critters.fairy` and
`room` come back **bit-for-bit identical** in all three coordinate systems, including after Inkscape
1.1.2 re-saves the file in between. Getting there needed `hmw:source` + `hmw:keys`, which carry the
original field values and their order: without them an untouched shape came back subtly rewritten
(`"stroke": "#000000"` dropped as a default, `lineWidth: 2` inflated to `2.0`). Compiling the results
with the library's own `compileDrawables` gives identical point arrays, identical flags and
**identity-identical interned style objects** for those three and for `relativity.json`, `clock.json`
and `escher.json` — the interning makes that a real test of the resolved appearance, not just of the
JSON.

**The single-patch datasets do not round-trip, and cannot.** An SVG's precision is absolute while local
coordinates grow like `sinh(d/2)`, so `dungeon.json`'s full 5270 drawables — extent 11710, hyperbolic
distance ~20 — lose 0.13 local units in `disk` and **199** in `halfplane`. This is §6 of `docs/MATH.md`,
not a fixable bug. So the writer *measures* it: every point goes through the exact text the file will
carry and back, and it prints the worst error and warns when it exceeds `1e-6` of the local extent.
`--coords local` is the best conditioned of the three (6e-8 on the same data) and the warning says so.

**Metadata.** `hmw:params` JSON written twice — an attribute on the root `<svg>` and an element inside
`<metadata>` — after checking that Inkscape 1.1.2 preserves both. Two channels so that a future
Inkscape dropping one is a warning, not a broken round trip. This is what lets the reader have no
`--coords`.

**Also checked.** `npm run check` passes (no module structure was touched). The reader survives a
hand-built SVG exercising a group `transform`, `style=""` overriding presentation attributes,
`fill-opacity`, a cubic curve, `rect`/`circle`/`polyline`/`polygon`/`text`, a multi-subpath `d`, a
`display:none` layer and `sodipodi:namedview`. Every error path prints `error: <message>` naming the
user's data, not a traceback.

**Left.** `--coords halfplane` on data reaching the basepoint region is the least tested path. Text
size and rotation are display-only in the SVG: `up` rides along with an Inkscape move or rotation via
`hmw:upLength`, but editing the font size does not change it. `class`-based styles cannot be previewed,
since the stylesheet lives in the viewport options the scripts never see.

## 2026-08-08-c — The blank centre octagon: a lint set to "throw" was throwing into the tile-failure handler

**Symptom.** After the new hand-drawn `escher-atlas.json` landed, `escher-atlas.html` drew a perfect
Circle Limit III with exactly one octagon missing — the one in the middle, under the camera.

**Cause, and it is the interesting part.** The new tile is not C4-symmetric in the lint's sense, so
`checkTileSymmetry: "throw"` fired as designed. But the throw was raised inside `Atlas.acceptTile`,
which `request()` wraps in the try/catch that turns *a tile failing to load* into *a tile quietly
skipped*. So the lint's exception was caught by the wrong handler and downgraded: the tile was cached
empty, `_symmetryChecked` had already been set to `true` before the throw so every later tile skipped
the check and drew fine, and the only trace was one `console.error`.

The strictest setting therefore produced the mildest symptom. That is the whole bug: **a lint and a
broken tile are different kinds of failure and must not share a handler.** One bad tile out of two
hundred should never take the map down; a statement about the artwork should never be reduced to one
missing tile.

**Fix.** `TileSymmetryError` in `symmetry.js`, a distinct type the two catch clauses re-throw. The
verdict is measured once and then re-thrown on every later frame, because a page that threw once and
rendered thereafter would be neither working nor visibly broken. Asynchronous providers cannot be
handed a synchronous throw, so there it surfaces as an unhandled rejection — loud, which is what
"throw" asked for.

**Also fixed: `Infinity` is a finding, not a number that blew up.** The residual is infinite when the
search found no candidate at all — nothing of the same style *and* the same point count lies where the
rotation sends a shape. "worst mismatch Infinity in tile-local units" sent the reader looking for a
coordinate overflow. It now says so in words and names the offending drawable, which is directly
actionable: the usual cause is a colouring less symmetric than the outlines.

**Measured, on the new tile.** 96 drawables. The *layout* is C4 — three families at radii 0.19, 0.355
and 0.378, each with four members 90 degrees apart to within a degree — but nothing is an exact
rotation of anything: median mismatch 6.9e-3, and the four fish are painted four different colours, so
a green one is asked to land on a blue one. Four more shapes (the greys) have different node counts
from each other, so they do not match even ignoring colour. This is a traced tile, not a generated one,
and `1e-6` was never going to be met; `escher-atlas.html` now asks for `"warn"`.

**Tests.** Two in `test/anchor.test.mjs`. The first asserts the throw escapes `passes()`, escapes it
again on the second frame, caches nothing, and that `"warn"` draws every tile and warns exactly once —
and, as a control, that a `tileData` that throws an ordinary error is still reported and skipped rather
than made fatal along with the lint. It fails against the old code with the original symptom. The
second pins the three findings apart: exact rotation, a small finite residual, and no counterpart at
all.

**Verified.** `npm test` 168/168. All ten browser diagnostics pass, including 2 (byte-identical
translation invariance, 45/45) and 10 (the hundred-step scroll, 9/9).

**Not touched, deliberately.** The page's prose, its `(C4-exact)` status line, and `BODY_IN_FILE`,
which no longer matches any fill in the file so "colour by tile class" now only recolours the `lod`
stand-in. All three are about the colouring, which Jim is working on next.

## 2026-08-08-d — Escher's four colours, and a colour symmetry for {p,q} atlases

Jim redrew `escher-atlas.json` by hand in Inkscape with **four fish in four colours**. A repeating atlas
returns the same data for every tile, so four colours in the file means the same four colours in every
octagon — which is not Escher's picture. In *Circle Limit III* the colours MOVE: every motion of the
tiling permutes them.

**What the library gained: `colorSymmetry`.** A homomorphism from the walk group into a permutation
group, declared by the caller, with the tile's element handed to `tileData` as `colorPermutation` /
`colorIndex` / `colorCount`. A tile CLASS is the special case the library can discover on its own (the
abelianisation is forced by `{p,q,m}`); this is the general case and has to be declared, because nothing
about the tiling picks it — it is a property of the picture.

Two things make it a different mechanism and not a wider integer:

* **It does not kill the stabiliser.** `phi(P)` is a real permutation — for Escher it is the swap of the
  two colours an octagon shows. So the accumulation carries the canonical fold's `P^k`, which the cyclic
  case is free to drop: `phi_child = phi_parent . phi(G_g) . phi(P)^k`.
* **It is therefore only well defined because frames are canonical.** Choosing the coset representative
  `F.P` rotates the art by `2*pi/m` AND multiplies the label by `phi(P)`, and the two cancel exactly. The
  requirement is that the same `F` decide both, which is what the canonical-identity work bought. This
  could not have been made to work before it.

Elements are interned as dense indices with a Cayley table, so a walk step is two array lookups and
allocates nothing — the same cost as the tile class's integer add. Construction costs 146 ms for the
verification walk, cached per `{p,q,m}` + permutation signature; the second construction is 1 ms.

**Verification throws rather than degrading.** A class is the library's guess, so falling back to one
class is honest; a colour symmetry is the caller's assertion, and ignoring it would paint the picture
wrong. The cheap algebraic conditions are checked individually with their own messages, and then the
tile graph is walked and every pair of routes to one tile must agree. That last step is not decoration:
of the 24 candidates for `phi(G_0)` in the `{8,3}` case, **16 satisfy every cheap check and are caught
only by the walk** — including the most innocent-looking one, every generator fixing every colour.

### Picking Escher's homomorphism, and two wrong turns worth recording

`phi(G_0)` is the only free parameter (`inverseIndex` and conjugation by `P` fix the rest). The funnel:
24 candidates -> **8** homomorphisms -> **6** after Escher's rule that the three fish at a three-fold
vertex all differ -> **1** by measurement against the woodcut.

**Wrong turn 1: a coordinate-system bug made the shortlist wrong.** The planning-stage check of the
three-fold rule compared vertices computed in LOCAL coordinates (`sinh(chi/2)`) against fish positions in
DISK coordinates (`applyToLocal` returns disk). It reported that 4 of 8 survive. With the metric fixed —
disk coordinates throughout, and hyperbolic distance, since the three octagons around a vertex are
equidistant hyperbolically and up to 1.4x apart Euclidean — **6 survive, not 4**. The first shortlist was
missing the right answer's competitors.

Also learned: {8,3}'s two vertex classes are not alike for this test. At the odd ones a single fish of
each octagon runs into the corner (reach 0.01, next 0.46). At the even ones the vertex sits ON the seam
between two adjacent fish, both at 0.03, and there is no fact of the matter about which to count. The
rule is asserted where it is well defined.

**Wrong turn 2: sampling fish centres ranked the wrong candidate first.** k-means over a scan of the
print recovers Escher's four inks — (117,62,32) red, (217,163,85) yellow, (143,123,75) green,
(73,103,128) blue. Scoring each candidate's predicted colour at each fish's CENTROID, with the disk
centre, radius and rotation fitted, put `phi(G_0) = [0,3,1,2]` first at 79% against `[2,0,1,3]`'s 70%.

Rendering it showed the problem immediately: `[0,3,1,2]` paints the four overlap wedges — the parts of
neighbours' fish that fall inside an octagon — to match the fish they sit against, so they MERGE into
large single-colour blobs and the four-colour interlock collapses. A centroid cannot see that; it is
obvious in the picture.

Comparing whole AREAS instead — every point of a grid over the disk, classified in both pictures, the
rotation fitted — settles it cleanly:

| `phi(G_0)` | 2013 | 2130 | 3021 | 0312 | 1203 | 3102 | 0231 | 1320 |
|---|---|---|---|---|---|---|---|---|
| area agreement | **78.4%** | 47.2% | 46.1% | 45.9% | 44.4% | 43.0% | 40.0% | 35.2% |

`phi(G_0) = [2,0,1,3]`, at 78.4% of 5,436 comparable points against 47.2% for the runner-up. The
residual is the tracing and the shading of a woodcut. Swapping `PALETTE[2]` and `PALETTE[3]` gives
another admissible homomorphism scoring 46%, which fixes their order too.

The regression test asserts the property that distinguishes them: **no overlap wedge may take one of its
own octagon's two colours**, or it merges with the fish beside it.

### The rest

* `docs/demo/escher-colors.js` — art data, so it lives with the art: the palette, `PHI_G0`, the
  fill-to-role map, and the overlap table. The overlaps' roles are DERIVED from the live tiling
  (`colorPermutation(extendAddress(origin, g))[role]`) rather than written down, so changing the
  homomorphism cannot leave a stale constant behind.
* The file's fills are ROLE TAGS and do not match the output colours — `#afe9af` looks green and comes
  out yellow. Said loudly in three places, because "fixing" it would rotate the whole colouring by 90
  degrees.
* `escher-atlas.html` lost all three checkboxes: clip always on, outline off, colouring always on. The
  symmetry lint is off and must stay off — the outlines are C_4 but the colouring is deliberately C_2.
* The LOD stand-in is measured from the drawables (shoelace per fill + measured stroke coverage, one
  average per variant) instead of the stale `meta.coverage`, which was left over from the old generated
  tile. That field and `meta.fit` are dropped and the note rewritten.
* Spelling: new API is American per Jim. `src/` had no identifier spelled `colour`, only 15 comment
  occurrences, all normalised along with the touched demo and test files. `docs/`, `notes/` and
  `README.md` still use British spelling.
* `test/escher-colors.test.mjs` imports from `docs/demo/`, which is unusual and deliberate: the data
  belongs with the art, and duplicating it in the test is exactly how the two would drift apart.
* Documentation: a new "Color symmetry" section in `README.md`; `notes/tilings.md` gains "Colour
  symmetry: the general case" under the tile-class table; and the section of
  `notes/escher-circle-limit-iii.md` titled "Why the fish are not Escher's four colours" was FALSE as of
  this change and is rewritten as how they are, with the funnel table above. Its stale "Result: symmetry
  residual 3.9e-17" went with it — the tile is hand-drawn now and is not C_4-exact.

### Verified

* `npm run check`, `npm run build`, `npm test` — **179/179**, 11 of them new (5 in `tiling.test.mjs`,
  1 in `anchor.test.mjs`, 5 in `escher-colors.test.mjs`).
* All ten browser diagnostics, run one at a time because the batch exceeds the MCP protocol timeout.
  Unchanged from before this work, including 2 (byte-identical translation invariance, 45/45 views out
  to 5,107 hyperbolic units), 9 (45/45 pans) and 10 (hundred-step scroll, 9/9).
* On the page itself: every probed fish is painted what its own tile's permutation says, with 12
  colourings on screen at once — 14/14 at the origin, 14/14 after 400 tile crossings (611 hyperbolic
  units), 14/14 on the way back. `panToTile(origin)` then shows the centre octagon exactly as it began:
  green top-left and bottom-right, yellow top-right and bottom-left, permutation `[0,1,2,3]`.
* `escher.html`, `clock.html` and `dungeon-man.html` render with no console output. They pass no
  `colorSymmetry`, so `colorCount` is 1 and `colorPermutation` is null, and nothing on their path moves.

### Left

The four overlap wedges are hand-drawn approximations of the neighbours' fish rather than the exact
shapes, so the seams do not line up to the pixel. Harmless — each is clipped to its own octagon — but it
is why the artwork can never satisfy the symmetry lint, and why the lint is off rather than merely
loosened.


## 2026-08-08-e — Release prep 1/6: the two superseded single-patch demo pages are gone

Issue #4, second box. `docs/escher.html` and `docs/dungeon.html` were the 2012-faithful single-patch
demos. Both have atlas successors that do the same thing without the defect that motivated them, and
both pages said so in their own prose: escher's traced art "peters out a few layers from the centre",
the dungeon's single patch "starts to break down" far from the origin. Keeping two pages per subject,
one of which is the broken one, is not what a first release should ship.

### Removed

| path | why |
|---|---|
| `docs/escher.html` | superseded by `escher-atlas.html` |
| `docs/dungeon.html` | superseded by `dungeon-man.html` |
| `docs/escher.json` (8.6 MB) | referenced only by `docs/escher.html` |
| `docs/dungeon.json` (2.1 MB) | referenced only by `docs/dungeon.html` |
| `docs/demo/dungeon-rooms.js` | imported only by `docs/dungeon.html` |
| `attachReadout` in `docs/demo/common.js` | called only by those two pages |
| `.status, .readout` in `docs/demo/style.css` | the only markup using them went with the pages |
| `statusEl` parameter of `loadDrawables` | both surviving callers passed one argument |

Jim's call to take the orphaned JSON as well as the pages. It is the recovered 2011 artefact and
`AGENTS.md` says not to try rebuilding it, but it is in git history and nothing in the tree reads it,
so a fresh clone and the Pages site are ~11 MB lighter for no loss.

`docs/tiling-diagnostics.html` keeps its own `#readout` — that is an id selector in its own `<style>`
block, not the class that went.

### Repointed rather than deleted

* `docs/index.html` — the gallery is four examples instead of six.
* `docs/dungeon-man.html` — two comments cited a measurement made *on* `dungeon.html` (the hero cell's
  local +y pointing straight down, bearing 179.87 degrees). The measurement still stands and still
  explains why this page turns the camera by pi, so it is attributed to "the single-patch dungeon page
  that this one replaced" rather than deleted.
* `bench/sweep.js` — same treatment for the comment explaining why a blank disk is not automatically a
  bug. It has no page list of its own; it is injected into whatever page is open.
* `tools/README.md` — the precision table keeps its `escher.json` and `dungeon.json` rows, daggered and
  footnoted. They are the widest-extent measurements in the set (extent 13 and 11710) and the whole
  point of the table is the trend from tile-local art to whole-plane data; deleting the two rows that
  show the failure would leave a table that no longer makes its own argument.
* `notes/data-extraction.md` — the `visibleTo: 0.75` sentence moved to past tense.

`notes/log.md` keeps every reference it already had. It is the append-only record of what happened,
and what happened is that those files existed.

### Verified

`npm run check` ok; `npm test` **179/179**, unchanged — no test read either dataset. `clock.html` and
`jumping-man.html` (the two callers of the edited `loadDrawables`) load and render with a clean
console apart from the usual `favicon.ico` 404.


## 2026-08-08-f — Release prep 2/6: `escher-atlas.html` is now `escher.html`

Issue #4, third box, and the direct consequence of the previous entry: with the single-patch page
gone there is only one Escher demo, so the `-atlas` disambiguator names nothing. `git mv` plus three
repointed references — the page's own "See the code in" self-link, the `docs/index.html` gallery
entry (its title drops from "Infinite Circle Limit III" back to plain "Circle Limit III"), and one
comment in `test/anchor.test.mjs` that cites the page as the place a blank-octagon bug showed up.

`docs/escher-atlas.json`, `docs/escher-atlas-drawables.svg` and `docs/demo/escher-colors.js` keep
their names. Those are the *atlas tile* artefacts, not the page, and the name is still accurate: the
JSON is one tile of a tiling, and `tools/README.md`, `test/escher-colors.test.mjs` and
`test/anchor.test.mjs` all refer to it by that name.

Verified in the browser: `index.html` lists four examples and every link resolves; `escher.html`
renders the full four-colour Circle Limit III with a clean console.


## 2026-08-08-g — Release prep 3/6: dead code, and how little of it there was

Issue #4, fourth box. Approach was mechanical first, judgement second: scripted passes over `src/`
and `docs/demo/` for unused imports, unreferenced top-level declarations, never-called class methods,
never-read option keys, never-read `stats` fields, unused function parameters, and exports with no
consumer anywhere in the repo. Worth recording the **negative** result, because it is the more useful
half: of 49 viewport options every one is read, of every `stats` field every one is read, no method is
unreferenced, and there is not a single commented-out code block or `TODO`/`FIXME`/`HACK` marker in
the tree. The list below is all of it.

### Genuinely unreachable, deleted

* `EDGE_HOROCYCLE` in `tiling.js`. Exported, never produced, never consumed — and the comment above it
  ("the binary tiling needs both") was **false**: `BinaryTiling.boundaryLocal()` returns
  `kind: "binary-cell"`, a bare string, and `Atlas.clipPathFor` tests for exactly that. Comment
  rewritten to say what the two kinds actually are.
* `crosshairLayer` in `docs/demo/layers.js`. Never imported by any page.
* `import { ViewState }` in `src/input/pointer.js`. Nothing in the file uses it.
* The `cx` parameter of `calibrateSpin`. Its two siblings in `exactcalib.js` do use their `cx`, so
  signature symmetry was the only argument for keeping it, and that is not an argument. Two call
  sites updated.
* The `let viewport / function build() / build()` wrapper in `docs/escher.html` — a rebuild hook with
  no rebuilder, left over from when the page had checkboxes. Inlined.

### Inert `export` keywords, demoted to module-private

`package.json`'s `exports` map exposes only `"."`, so a name that is neither in the `src/index.js`
barrel nor imported by another module is not reachable from outside the package: the `export` is a
claim about reachability that is not true. Demoted: `Drawable`, `FONT_SCALE`, `BASE_FONT_PX`,
`RenderStats`, `EDGE_GEODESIC`, and `colourForClass` in the demo diagnostics. `check-bundle` now
counts 82 exported names instead of 88, which is the honest number.

### Deliberately kept, so this is not re-litigated

* Everything re-exported from `src/index.js`. That *is* the public surface; "the repo does not call
  it" says nothing.
* `exactMulCount` / `resetExactMulCount` — they exist precisely to be measured from outside.
* `normaliseOptionsForTesting`.
* The nine `check*` exports in `diagnostic-checks.js` and the four `*CompoundScroll` exports. The
  file's own comment explains why they are individually exported: the whole suite exceeds the
  MCP protocol timeout and a driver has to run them one at a time. Confirmed the hard way again
  below.
* Four unused function parameters that exist to satisfy an interface — `reverseGenerator(address, …)`
  and `stepFrame(address, …)` on `BinaryTiling` (the {p,q} versions need the address), and
  `passes(view /* , onReady */)` on `SourceSet`. All three already carry a comment saying so.

### Verified

`npm run check` — 82 exported, 52 top-level, no collisions. `npm test` — **179/179**. `npm run build`.
All four demo pages render. All ten browser diagnostics pass, run one at a time (2 together still
times out, and `runAllChecks()` certainly does): ground truth 9.29e-14; translation invariance 45/45
out to 5,107 hyperbolic units; ownership 6980/6980 and 0 seam pixels; 0 stray pixels beyond the rim;
address round-trip 9/9; boundedness max|V| 1.0000; picking 14463/14463; smoothness 45/45; hundred-step
scroll 9/9 tilings within budget.


## 2026-08-08-h — Release prep 4/6: American English, including the public API

Issue #4, fifth box. **950 replacements across 60 files.** Not a blind `sed`: a script first
extracted every distinct case-sensitive token in the tree matching a wide British-spelling pattern,
and the replacement table is that inventory, hand-mapped entry by entry. That is what keeps
`analysis`, `realistic` and `checkerboard` — all already American — out of it; a stem rule
`realis -> realiz` would have produced `realiztic`.

### The public API changed, and it had to change here

Jim's call. Options were already American (`center`, `background`, `colorSymmetry`) while everything
underneath was British, so the surface was inconsistent with itself. The freeze is the next commit,
so this was the last chance to make the frozen API the clean one. No aliases and no compatibility
shims: the package is unpublished, so the old spellings simply cease to exist rather than lingering
as a second way to say the same thing.

| was | is |
|---|---|
| `dataProvider({centre, …})` | `{center, …}` |
| `tiling.neighbours(address)` | `tiling.neighbors(address)` |
| `tiling.neighbourGens(address)` | `tiling.neighborGens(address)` |
| `tiling.neighbourCentresLocal` | `tiling.neighborCentersLocal` |
| `tiling.metrics.centreSpacing` | `tiling.metrics.centerSpacing` |
| `tiling.stabiliserOrder` | `tiling.stabilizerOrder` |
| `colorSymmetry.stabiliser` | `colorSymmetry.stabilizer` |
| `Isom.centreLocal(out)` | `Isom.centerLocal(out)` |
| `Anchor.viewCentreLocal(m, out)` | `Anchor.viewCenterLocal(m, out)` |
| `Anchor.neighbourhood(m, r, n)` | `Anchor.neighborhood(m, r, n)` |
| tile field `centreRelativeDisk` | `centerRelativeDisk` |
| `normaliseOptionsForTesting` | `normalizeOptionsForTesting` |

The custom-tiling protocol in README.md moved with them, since `neighbours` and `centreSpacing` are
things an implementer has to spell.

### The one deliberate exception

**`Arc.anticlockwise` stays British.** It is the name the HTML specification gives the sixth argument
of `CanvasRenderingContext2D.arc()`, which this field is passed straight into; spelling it the
American way would make the call site read `ctx.arc(..., arc.counterclockwise)` and hide the
correspondence. A comment on the class now says so, so the next spelling sweep does not "fix" it.

`inkscape:pagecheckerboard` in two committed SVGs is Inkscape's own attribute and was likewise left.

### Scope

`notes/log.md` was NOT swept. It is the append-only record and rewriting past entries to change their
spelling is exactly what the house rule forbids; the entries above this one still say "colour" and
should. Every other note, and `AGENTS.md`, `README.md`, `docs/MATH.md`, `tools/README.md`, the demo
pages, the Python tools and the two audits, were swept — those describe the code as it is now.

### Verified

* `npm run check`; `npm test` **179/179**; `npm run build`.
* `dev/audit_atlas_math.py` — **31 passed, 0 failed**. `dev/audit_atlas_numeric.py` — **7 passed, 0
  failed**. Re-run because the sweep touched `src/core/` and `src/data/atlas/`, as AGENTS.md requires.
* The two Python tools reproduce their previous output **exactly** (byte-identical SVG apart from the
  recorded input path; identical JSON), so renaming inside them is behavior-preserving.
* Browser: `escher.html` renders, console empty, and reports `stabilizerOrder: 4`,
  `metrics.centerSpacing: 1.5285709194809989`, `neighbors()` returning 8, `colorCount: 12`.
  `dungeon-man.html` renders, console empty. Diagnostics checks 1, 2 and 9 — the most sensitive —
  return byte-for-byte the same numbers as before the sweep (ground truth 9.29e-14, invariance 45/45,
  smoothness 45/45 with an identical per-tiling breakdown).

### Noticed, not fixed here

`tools/README.md` claims the `escher-atlas.json` round trip is "bit-for-bit identical". It is not, and
was not before this change either: `--coords local` comes back with a worst coordinate delta of 4e-11
(the tool itself prints "round-trip precision: worst 4.3e-12"). Pre-existing and unrelated to
spelling; it belongs to the documentation-correctness box later in issue #4.


## 2026-08-08-i — Release prep 5/6: `hyperbolic-map-widget` -> `hyperbolic-map`. THE API IS NOW FROZEN.

Issue #4, sixth box. Mechanically small — the identifier appeared in 15 tracked files — but it is the
point after which the public surface stops moving, so it gets its own commit and its own entry.

Already right and untouched: the bundle filenames (`dist/hyperbolic-map.iife.js`, `.min.js`), the
browser global `HyperbolicMap`, and all 49 thrown-error prefixes, every one of which already said
`hyperbolic-map:`.

Changed: `package.json` `name` and `repository.url`; the README heading (`# Hyperbolic Map Widget` ->
`# Hyperbolic Map`), `npm install` line, `import` line and the GitHub Pages URL; every `<title>` and
every "See the code in" GitHub link across `docs/*.html`; `docs/index.html`'s `<h1>`; the
`src/index.js` header; the banner `dev/build.mjs` emits; `bench/bench.mjs`'s printed title;
`tools/README.md`.

### The part that needed care: the SVG interchange format

`tools/drawables_to_svg.py` and `tools/svg_to_drawables.py` embed the name in three places that are
part of the on-disk format, not just prose: the XML namespace URI
`https://github.com/jpivarski/hyperbolic-map`, and the two class names
`hyperbolic-map-guidelines` and `hyperbolic-map-drawables`. `docs/escher-atlas-drawables.svg` is a
committed artifact carrying all three, so it was updated in lockstep.

Consequences, both verified rather than assumed:

* the renamed reader still reads the renamed committed SVG **bit-for-bit** back to
  `docs/escher-atlas.json` — 96 drawables, exactly equal;
* the renamed reader **refuses** an old-namespace SVG, with the "carries no hyperbolic-map metadata"
  message and exit code 1. It does not silently guess a coordinate system. Anyone holding an SVG
  exported before this commit must re-export from JSON; there is no in-place upgrade and, pre-1.0,
  there should not be one.

### Known-broken until Jim renames the repo

Every `https://github.com/jpivarski/hyperbolic-map...` link and the
`https://jpivarski.github.io/hyperbolic-map/` demos URL 404 until the GitHub repo itself is renamed,
which is a later box on the same checklist. GitHub redirects the old name after a rename, so doing it
in this order is right; doing it the other way round would have left the tree stale instead.

### Not changed: "widget" as an ordinary English noun

`README.md` still says "a widget that fills its column" and "The widget checks for this", and its
opening sentence still calls the library a map widget. Those are English, not the package name, and
whether the library should still describe itself that way is a documentation-voice question that
belongs to the HUMAN read-through box, not to a rename.

### Verified

`npm run check`; `npm test` **179/179**; `npm run build` (both bundles and `docs/lib/` regenerated,
banner now reads `hyperbolic-map 0.1.0`). `grep -rn hyperbolic-map-widget` finds nothing outside this
log. Browser: `index.html` — title and `<h1>` read `hyperbolic-map`, all four gallery links and both
`MATH.md` links return 200; `escher.html` renders with an empty console.


## 2026-08-08-j — Release prep 6/6: doubles instead of BigInt where they fit. Naming is 2.4x faster.

Issue #4's last box before the human checkpoint, and its sub-question was specific: "can any BigInt
operations be replaced with normal integers if all values are within some specified thresholds?"
**Yes.** The threshold is not a distance in tiles, it is a bound checked per operation, and it is
worth about 2.4x on tile naming and 2x on the two frames a user actually notices.

Full numbers, with load readings, in `notes/performance.md`. The exactness argument and its
verification are in `notes/math-audit.md` — put there rather than only here because a later pass
seeing identity-critical integers held in doubles will want to "fix" it, and that file exists to stop
exactly that.

### Measured before deciding anything

Coefficients grow ~2 bits per tile step for `{8,3}`, so the small range covers only the first dozen
tiles from the origin — but that is where every demo sits and where the 250 ms first frame is spent.
A ring multiply costs 840-1100 ns at 20-bit coefficients and 342 ns for the identical algorithm over
doubles, so the ceiling was about 3x.

**And a negative result worth as much as the positive one:** micro-optimizing the BigInt
representation buys nothing. Hoisting `mul`'s scratch buffer (three allocations per multiply gone) and
skipping the minimal polynomial's zero coefficients measured **1 188 ns against 1 100** — no faster.
Allocation was never the cost. Recorded in `performance.md` and `open-questions.md` so it is not
re-derived.

### The change, all inside `src/data/atlas/exactring.js`

An element's coefficients are all Number or all BigInt, never mixed. Born small, **promoted
permanently** the first time an operation would leave the exactly-integral range, never demoted. The
invariant is that no stored coefficient exceeds 2^52, which leaves one doubling of headroom, so every
bail-out inspects a value that is **still exact** — a check placed after the arithmetic had rounded
would be worthless, and that is the one way this could have been silently wrong.

Because representation is a function of history rather than of value, everything observable had to be
made representation-independent, and each of those is load-bearing:

* `serialize` — `String(5)` and `String(5n)` are both `"5"`, and a Number coefficient cannot reach the
  1e21 where exponent notation would start. **This decides the text of every public tile id.**
* `cmp` — `<` between a Number and a BigInt is defined to compare mathematical values exactly. **This
  decides which member of a coset is canonical, hence which id every tile gets.** Rewritten to use `<`
  in both directions rather than `!==` then `<`, because `5 !== 5n`.
* `equals` / `isZero` — `0` and `0n` are both falsy; mixed pairs fall through to `<`.
* `toNumber` — `Number()` of either.

A BigInt input still gives a BigInt result, so `ExactRing` — which the barrel exports specifically so
that the Coxeter relations can be checked from outside — still behaves for a caller writing BigInt
literals, and `reduce` is BigInt-in/BigInt-out.

Also hoisted `this.mu()` out of `dicksonOfMu`'s loop, which was reallocating it every iteration.

### How it is known not to have renamed a single tile

This is the risk that mattered: an id is a public name that goes into user caches and onto disk.

* **Golden ids, now a committed test.** 380 ids per tiling (300 breadth-first, then an 80-step wander
  that pushes coefficients past 2^52 and onto the BigInt path) for ten `{p,q}` tilings, hashed. The
  hashes were generated from the **pre-change** implementation and matched exactly afterwards. The
  test says in its own text not to update the fixture to match a failing run.
* A wider one-off comparison of the old and new builds over **4,600 ids across ten tilings**:
  byte-for-byte identical. Promotion was confirmed to actually occur during it — `{12,3}` at step 26
  of the wander, `{5,4}` at step 48 — so the far half of that comparison exercised the BigInt path.
* **Ring-multiply counts identical** tiling by tiling, and 2,907,216 in both runs of the browser pan.
  Same algorithm, same operations, faster arithmetic.
* Five new tests in `test/exactring.test.mjs` attack the representation directly: 300 random pairs per
  ring in all four small/big pairings across every observable; values driven astride the limit; and an
  assertion that repeated squaring really does cross the boundary, so the test cannot pass vacuously.

### What it bought

| | before | after |
|---|---|---|
| naming 609 tiles, `{8,3}` m=4 (node) | 49.5 ms | **19.6 ms** |
| naming 865 tiles, `{12,3}` (node) | 99.6 ms | **42.2 ms** |
| `escher.html` first frame (Chrome, 620 px) | 101-125 ms | **46-59 ms** |
| median naming frame in a 200-frame pan | 42.3 ms | **19.3 ms** |
| worst naming frame in that pan | 58.3 ms | **28.7 ms** |
| steady frame (180 of those 200 do zero ring work) | 7.8 ms | 7.9 ms |

Steady state is untouched, as it must be: it does no exact arithmetic at all.

### One thing to be aware of, flagged for Jim

The previous commit froze the API, and this one **widens a value type** on an exported class: an
`ExactRing` element used to be documented as "a plain array of `deg` BigInts" and is now "a plain array
of `deg` integers, all Number or all BigInt". Names and signatures did not move, every method behaves
identically, and code that goes through the ring's own comparisons is unaffected — but code that reads
coefficients directly and assumes BigInt would break. Exactly one thing in this repository did:
`logAbsExact` in `test/helpers.mjs`, which widens first now. This commit is separable if that trade is
not wanted.

### Also added

`npm run bench` grew a naming section — per-tiling build time, time to name 500+ tiles, and the ring
multiplies each took — so this is re-measurable rather than a number in a file. It inherits the
existing load-average guard that refuses to report when the machine is busy.

### Verified

`npm run check`; `npm test` **184/184** (179 before, 5 new); `npm run build`;
`dev/audit_atlas_math.py` **31/31**; `dev/audit_atlas_numeric.py` **7/7**. All ten browser diagnostics
pass with output **string-identical** to the run before this change, including check 9's full
per-tiling breakdown and check 10's nine budget lines. Machine idle for every measurement (load
0.23-0.52 on 16 cores, GPU 31 % / 66 MiB, checked before and after).


## 2026-08-08-k — Release prep 7: `docs/index.html` is the documentation site now

Issue #4, after the human checkpoint. `docs/index.html` was a six-item gallery; it is now the
reference, and the README is the landing page. Everything from `## Options` to just before
`## Development` **moved** out of README.md — 339 lines of it — rather than being copied, so there is
one copy of each fact and no chance of the two drifting.

### The conversion

`dev/md_to_html.py`, new, using `mistune` (a local install, not a library dependency). It slices a
Markdown file between two headings, converts, gives every heading a GitHub-style slug id so in-page
anchors keep working, and pretty-prints the result: one block element per line, block children
indented two spaces, inline content never split across lines, `<pre>` passed through untouched, and
`&quot;` unescaped back to `"` outside tags so a code span reads `"auto"` rather than
`&quot;auto&quot;`.

It is kept, and it says in its own docstring that it is not part of any build: **the HTML is now the
main copy and is edited by hand.** The script exists so that "how was that page produced?" has a real
answer, not so that it can be re-run over a README that no longer has those sections in it.

One thing did not survive the crossing: `$\mathcal{O}(1)$`, which GitHub renders and a plain HTML page
would not. It became the prose "an O(1) matrix change". The extraction asserts that no other LaTeX is
left in the slice — carefully enough not to trip over the `${tile.id}` of a template literal inside a
code fence, which was the first version's false positive.

### README

The moved sections are replaced by a two-link **Documentation** section: "How to use it" to the site,
"What the mathematics is" to `docs/MATH.md`. The README went 423 lines -> 91. The one cross-reference
that pointed into the moved text, `[atlas of tiles](#atlas-of-tiles)` in the Quick start, now points
at `https://jpivarski.github.io/hyperbolic-map/#atlas-of-tiles`, and that anchor exists on the new
page.

The doc site's own link to `MATH.md` goes to the GitHub blob URL rather than a relative `MATH.md`,
because what GitHub Pages serves for a bare `.md` depends on whether Jekyll is processing the
directory, and a link that renders is worth more than a link that is short.

### `docs/demo/style.css` -> `docs/style.css`

It is no longer "styling for the example pages": the documentation page uses it too, and a reference
page loading its stylesheet out of a `demo/` directory reads like a mistake. Gained rules for `h3`,
`h4`, `a` and `pre`; lost `.gallery`, whose only markup went with the old index. Code blocks scroll
horizontally rather than wrapping — these are lines meant to be copied.

### Verified

Every heading has an id and both `#atlas-of-tiles` links resolve. All four demo pages load
`style.css` (200) and are styled. The page renders: tables, code blocks, lists and nesting all
correct in Chrome.


## 2026-08-08-l — Release prep 8: the demos as a 2x2 grid at the top of the README

Issue #4. "See the demos: <url>" was one line of text at the top of the README; it is now four square
screenshots in the order Jim asked for — Dungeon Man top-left, Jumping Man top-right, Circle Limit III
bottom-left, the clock bottom-right — each panel and each caption linking to its own live demo rather
than to a shared index. Written as a plain `<table>`, which GitHub renders (checked against
`gh api /markdown` and viewed in Chrome) and which a Markdown table cannot do without a header row.

The two link boxes on the same list were done in the previous commit: **How to use it** to the
documentation site, **What the mathematics is** to `docs/MATH.md`, in that order, where "Options" used
to start.

### How the images were made, and why they are not the pages' default views

`dev/capture_server.py` serving `docs/`, with each page's own viewport asked for its canvas pixels via
`toDataURL` and POSTed to `/__shot/`. That is the tool's whole reason for existing — a browser
screenshot would carry page chrome and a device-pixel rescale, and these are the renderer's own output
at 500x500.

Two of the four are framed deliberately rather than captured as-loaded:

* **Dungeon Man** opens at `zoom: 3`, which is one room and reads as a grey grid. Backed out to 0.97
  so the whole disk, the world-turtle and the star field are in frame.
* **The clock** at the origin is a nearly empty face: everything interesting — 720 minutes and 43,200
  seconds — is crushed against the rim. Panned out to hyperbolic distance 1.5, where the hour hand,
  the hour numerals and the crowd of minute ticks are all visible at once, which is the entire point
  the demo is making.

Escher and Jumping Man are their default views; they already show what they are.

Quantized to a 256-colour palette and run through `optipng`: **884 KB -> 276 KB** for the four, with
no visible loss at this size. They live in `docs/img/`, which is outside the npm `files` list, and npm
rewrites relative README image URLs against `repository`, so they resolve on npmjs.com as well as on
GitHub.


## 2026-08-08-m — Release prep 9: the demo pages point at GitHub, and the docs open with a runnable example

Issue #4, two boxes.

### "← all examples" → "← hyperbolic-map on GitHub"

Consequence of the previous commit: `index.html` is no longer a gallery, so "all examples" pointed at a
page that no longer lists any. All four demos and the documentation page now carry the same one-line
`<nav>` back to the repository, which is the landing page and the thing that does show all four
(as a 2x2 grid).

### A minimal example, at the top of the documentation

Two code fences, `drawables.json` and `index.html`, both complete rather than elided: a square, a
marker at the origin, one label. **It was written, served and run before being pasted in** — the
screenshot is of that actual pair of files, not of something reconstructed from the docs.

Deliberately small. Three earlier drafts tried to make the example *teach* hyperbolic geometry as well
as run — labels at increasing distance, then a second larger square — and both failed on their own
terms: the outer labels fall below `minTextPx` and vanish, and a side-6 square projects to almost the
same outline as a side-2 one, so the picture looked like a bug rather than a lesson. The demos are
where that is shown properly. What the minimal example demonstrates is the one thing visible in a
five-line file: the square's sides bow inward, because they are geodesics, and straighten again when
you scroll one of them through the middle. The prose says so and says why.

Notes on the fences themselves: the page uses `fetch`, so it says out loud that `file://` will not
work; and it names where `hyperbolic-map.iife.js` comes from after `npm install`, because "put the
bundle beside them" is not an instruction anyone can follow without that.

The page now reads (1) minimal example, (2) options and everything that came from the README, which is
the order Jim asked for.

### Verified

The example pair runs in Chrome: 500x500 canvas, 154,512 non-white pixels, no console output. The
documentation page renders both fences, and its `#the-drawable-format` cross-reference resolves. All
four demo pages load with the new nav and still draw.


## 2026-08-08-n — Release prep 10: the documentation sweep, and what it found

Issue #4, two boxes: link every unlinked documentation file or delete it, and check the documentation
for things that are simply not true. Both done by script rather than by reading, because reading is
how the errors below survived this long.

### Unlinked files

A reachability pass over every real link (`href`, `src`, markdown `[]()`, `import`, `fetch`) found
exactly two documentation files that nothing pointed at. Both were linked rather than deleted:

* **`docs/tiling-diagnostics.html`** — nine tilings, four motifs, and the ten self-checks that are the
  acceptance test for the whole anchored-atlas design. Far too valuable to drop for being unlinked. It
  now has its own subsection at the end of the atlas chapter, described as what it is: a verification
  page, and the fastest way to find out whether a *custom* tiling satisfies the contract.
* **`docs/escher-atlas-drawables.svg`** — the committed output of the `tools/` workflow's first
  command, and the file the round-trip measurements in `tools/README.md` were taken on. Linked from
  that workflow section as the worked example.

Everything else the pass flagged is a false positive of the same kind: `clock.json` and
`relativity.json` arrive through `loadDrawables("...")`, and `stars.jpg`/`turtle.png` through
`imageLayer({src})`, neither of which is a link syntax. `bench/frames.html` and `bench/stress.html`
are unlinked on purpose — hand-driven harnesses, described in `notes/performance.md` and
`notes/canvas-testing.md`.

### Broken links, all in `tools/README.md`

Five. Four were collateral from moving the reference out of the README — `../README.md#path`,
`#the-drawable-format`, `#regular-tiling`, `#atlas-of-tiles` all now point into `docs/index.html`. The
fifth, `../notes/tilings.md#the-stabiliser-rule-2026-08-06`, **never matched a heading**; checked
against `git show 4fb37a1` to be sure the spelling sweep had not caused it. Now points at the section
that actually exists.

### The real find: the custom-tiling interface was wrong in both directions

A script drove a real atlas over a Proxy that reported every member the library touched, then over an
object built with `Object.create(null)` carrying *only* the documented members.

* It listed **`addressesAreCanonical`**, which exists nowhere — not on `RegularTiling`, not on
  `BinaryTiling`, not read anywhere in `src/`. Pure fiction.
* It omitted **five members the library calls without any guard**: `addressKey`, `neighborGens`,
  `extendAddress`, `stepFrame` and `stepToward`. A tiling written to the documented interface crashes
  on the first frame. Not a subtlety — the doc was unusable for its stated purpose.
* It listed `inverseGenerator`, `reverseGenerator`, `generatorCount` and `selfRotation` as required.
  They exist on the library's tilings but nothing inside the library calls them, so requiring them of
  someone else's tiling is over-strict. Now noted as "for callers, not for the renderer".
* It said nothing about the four **optional** members (`compareForDrawing`, `colorCount`,
  `colorPermutation`, `colorIndex`), which are guarded and have documented defaults.

Two traps are now written down, because both are silent if you get them wrong: `stepToward` returns an
index into `neighbors(address)` and **not** a generator index (the two coincide for `{p,q}` and do not
for the binary tiling's parent step), and `stepFrame` is not `generator` unless `stabilizerOrder` is 1.

**Verified, not asserted:** a tiling object with exactly the new "required" list and no prototype
drives 60 frames, 3,594 tile passes and 10 re-anchors without the library reaching for anything else.

### Other corrections

* `dungeon-man.html` said intrinsic curvature shows up as "the **area** of a circle being more or less
  than 2π times the radius". 2πr is the circumference; the area is πr². The hyperbolic statement that
  is true is the circumference one (2π sinh r), so that is what it says now.
* `jumping-man.html` had "where there there is less time to traverse".
* Three places still said the tile ids hold **BigInt** coefficients. Since 2026-08-08-j they hold
  ordinary numbers while those fit exactly and BigInt beyond, so `docs/index.html`, `docs/MATH.md` and
  `notes/tilings.md` now say "exact integer coefficients" and explain the split. My own change had
  made the documentation wrong; this is the sweep catching it.
* `AGENTS.md` still called `tools/` "a future directory" and did not know about `dev/md_to_html.py`. It
  also now states that `docs/index.html` is hand-edited and that reference material must not migrate
  back into the README.
* Two stragglers from the spelling sweep: a "grey" in a CSS comment and a stale
  `addressesAreCanonical` mention in a test comment.

An automated pass over every option table also confirmed all 49 options exist with the documented
defaults, every documented method is on `HyperbolicViewport`, and every hook is a real option.

### Verified

`npm run check`; `npm test` **184/184**; `npm run build`. Every link and anchor in every `.md` and
`.html` resolves. All six pages load with every link, anchor and image returning 200. Diagnostics
checks 1 and 2 unchanged.
