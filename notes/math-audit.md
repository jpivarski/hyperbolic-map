# Mathematical audit

**Read this before changing anything mathematical.** It records what is *correct* as well as what is
broken. Several parts of the original code look wrong and are not; several formulas that look obvious
are wrong. Both directions cost real time to establish.

Audited during planning, 2026-08-05, in three passes. The third pass re-verified the whole ledger with
an independent methodology and produced **45/45 pass, zero corrections**. Convergence criterion: the
ledger stops changing.

## Methodology

The trap in auditing this kind of code is that a defect in the *harness* is indistinguishable from a
defect in the code. Three of the apparent failures during the audit were harness bugs. So:

1. **Build a distance oracle first and cross-validate it independently.** Three formulas that must
   agree: the Poincaré-disk formula `d = 2 artanh(|z₁−z₂|/|1−z̄₂z₁|)`, the hyperboloid inner product
   `cosh d = T₁T₂ − X₁X₂ − Y₁Y₂`, and the half-plane formula
   `d = arcosh(1 + |p−q|²/(2y_p y_q))`. Measured agreement: 8.2e-13 relative. A harness bug then shows
   up as *oracle disagreement*, not as a false verdict about the code.
2. **Prove algebraic identities algebraically**, then measure. If a float64 reference would be the
   weaker side of the comparison, use `decimal` at 60–90 digits instead.
3. **Sanity-check any measurement model on an identity case** before trusting it. The pinch pixel
   model is validated by "zero finger motion must yield scale 1 and zero drift"; two earlier
   zoom-bookkeeping slips would have been caught by that.
4. **Enumerate the complete inventory** (`grep` the client, the server and the Python tools) and audit
   *your own proposed formulas too*, not just pre-existing code. One of the formulas planned for this
   library was wrong; it would have shipped otherwise.

## Conventions pinned

- Curvature `K = −1` throughout. The Poincaré-disk metric therefore carries the factor 4:
  `ds² = 4(dx²+dy²)/(1−r²)²`, matching the half-plane `(dx²+dy²)/y²` and the unit hyperboloid.
- Data coordinates (`hyperShadow` in the 2011 code, "local coordinates" here) are `(x, y)` with
  companion `w = sqrt(1 + x² + y²)`.
- Screen projection is the **Poincaré disk**: `z = (x + iy)/w`.
- The half-plane↔disk map is exactly `z ↦ i(z − i)/(z + i)`. The extra factor `i` (beyond the bare
  Cayley transform) puts the half-plane's point at infinity at the **top** of the disk rather than at
  `+1`, which is why "latitude increases upward" reads correctly on screen.
- Isometries are `z ↦ e^{iφ}(z + β)/(1 + β̄z)`, represented as SU(1,1) matrices `[[a,b],[b̄,ā]]` with
  `|a|² − |b|² = 1` acting as `z ↦ (az + b)/(b̄z + ā)`. `±M` give the same isometry (double cover).

## The key structural fact

`(x, y, w)` are **literally the entries of an SU(1,1) matrix**: the unique positive ("boost") element
carrying the origin to the point, with `a = w` and `b = x + iy`. Indeed `|a|² − |b|² = w² − (x²+y²) = 1`
by the definition of `w`, and `M·0 = b/ā = (x+iy)/w` is exactly the point's disk coordinate.

Consequences:

- `sqrt(x²+y²) = sinh(d/2)` and `w = cosh(d/2)`, where `d` is the hyperbolic distance from the origin.
  **This is an algebraic identity, not an approximation:** the projection gives `tanh(d/2) = r/w`, and
  `w² − r² = 1` holds identically, so `(w, r)` satisfy `cosh² − sinh² = 1` with ratio `r/w`. Verified
  in 90-digit arithmetic to 8.2e-87.
- The `d/2` is the **Spin(2,1) → SO⁺(2,1) double cover**, *not* a curvature or metric-signature choice.
  Do not "explain" it as a rescaling — the disk coordinate `tanh(d/2)` already contains the 2, and
  rescaling curvature would move both together.
- The old README's description ("a hyperboloid `x²+y²−z²=1`, project down to the x-y plane") is wrong
  twice over. `x²+y²−z² = −1` and `z²−x²−y² = 1` are *the same surface*, and projecting either gives
  `sinh(d)`, not `sinh(d/2)`. Our `(x,y,w)` is the hyperboloid vector of the geodesic **midpoint**,
  equivalently the SU(1,1) spinor lift. The genuine Weierstrass vector is `(2xw, 2yw, 1+2(x²+y²))`.
- Distance is `cosh(d/2) = |w₁w₂ − ζ̄₁ζ₂|` with `ζ = x + iy` — the modulus of the SU(1,1)-invariant
  Hermitian form. See the warning about the modulus below.
- Cost of the half-angle parametrisation: geodesics are **linear** in the true Weierstrass vector but
  **quadratic** in `(x, y, w)`.

## Ledger

Every math-bearing symbol in the original code, and every formula in this library.

### Original client (`OLD/hyperbolic-storage-space/WebContent/HyperbolicViewport.js`)

| symbol | status | evidence |
|---|---|---|
| `halfPlane_to_hyperShadow` | **BUG** — double cancellation near the half-plane basepoint `i` | returns *exactly 0* for `d/2 ≲ 5e-9`; 4.4e-5 relative error at `5e-7`. `sqrt((s₊+s₋)/(s₊−s₋))` cancels as `s₊→s₋`, then `(u−1/u)/2` cancels again |
| `mousePosition` / `fingerPosition` | mapping correct and isotropic; **BUG** — uses the *committed* zoom while `draw()` uses the live one, and `pageX − canvas.offsetLeft` | both axes use `zoom·width/2`, so no aspect distortion; the disk is sized by **width**, so it can overflow vertically on a non-square canvas |
| `internalToScreen` | **correct** exact isometry; precision fails at `d ≳ 20` | equals `e^{iR}(z+β)/(1+β̄z)` to 1.4e-12; preserves the oracle distance to 5.9e-12 |
| `halfPlaneOrientation` | **correct and exact** — *not* an approximation | equals `arg(M(i))` to 7.3e-13, independent of its internal `a` parameter |
| `updateCoordinates` | **correct** | the grabbed data point stays under the cursor: max error 5.8e-11 over 14,568 randomised drags, 0 failures |
| `updateOffset` compass branch | **correct — does not drift** | it reads `rotationCosNow` from the *previous* frame, which looks like a bug, but the stale rotation cancels algebraically. North holds to 2.2e-15 over 8 uncommitted moves |
| `updateRotation` | **correct** | pure screen rotation, 8.9e-16 |
| `updateZoom` | **correct** | `zoomNow == base^logScale · zoom` holds after clamping to 5.9e-16; no clamp violations in 200,000 cases |
| `updateTransformation` (pinch) | **BUG** — arithmetic means instead of hyperbolic midpoints | up to 25.7 px per-finger and 20.1 px midpoint drift on realistic gestures (620 px canvas). An exact solve exists — see below |
| `draw` geodesic arcs | **correct** | circle through both points with `c = 1` is orthogonal to the unit circle; passes through both points to 1.2e-10 |
| `draw` minor-arc choice | **correct** | the whole in-disk geodesic subtends `2·arctan(1/r) < π` at the arc centre, so any sub-segment is the minor arc. 0 violations in 183,351 pairs. The `deltaphi` normalisation, the anticlockwise flag and the `φ = −atan2` y-flip are all consistent |
| `draw` `r2 = 0.25(a²+b²) − 1` | **correct** — never negative, no `NaN` | `min(a²+b²−4) = 1.2e-2` over 300,000 interior pairs |
| `draw` text up-vector rotation | **correct** | `−atan2(up−at) + π/2` is right under the canvas y-flip, error 0 |
| `draw` straight-line fallback | **correct** | `denom = 0` ⟺ the two points are collinear with the origin ⟺ the geodesic *is* a diameter |
| `draw` polygon culling | **BUG** — tests only the two endpoints | drops long edges that cross the visible region; and it runs *after* all the projection work, so even a correct test there would save nothing |
| `draw` per-polygon clip | **no-op** — pure cost | builds the path, `clip()`s with it, rebuilds the identical path, `fill()`s. `fill ∩ clip == fill` |
| `draw` `pointRadius` | **BUG** | reads `drawable["pointFill"]` → `ctx.arc(x, y, "#000000", …)` → `NaN` radius → all vertex dots silently vanish |
| `MAX_STRAIGHT_LINE_LENGTH = 0.1` | **quality bug** — zoom-independent | at the dungeon's `initialZoom: 3` that is ~93 px drawn as a straight chord |
| `allowZoom` / `allowRotate` | **BUG** — consulted only in the two-finger path | so `allowZoom: false` does not disable the wheel and `allowRotate: false` does not disable rim rotation |
| `updateOffset` pan gate | **BUG** — freezes instead of clamping | pan is gated on `x²+y² < viewThreshold²`, so dragging past the rim stops and then *resumes where it froze* |

### Original server (`OLD/hyperbolic-storage-space/src/org/hyperbolicstorage/GeographicalTiles.java`)

| symbol | status | evidence |
|---|---|---|
| `halfPlane_to_hyperShadow` | same **BUG** as the client | |
| `hyperShadow_to_halfPlane` | **BUG** — divide-by-zero *inside the dungeon's data range* | `den = 2r² + 1 − 2yw` loses the `+1`; reaches exactly `0.0` by `y ≈ 10⁴`, and the dungeon data goes to `y = 11711.92`. In Java this yields `Infinity` rather than throwing, so it fails **silently** |
| `tileIndex` | **correct** | inverts the binary-cell definition, 0 mismatches in 200,000 cases |
| `centralCircle` | **correct** | the exact half-plane image of the visible disk, 6.5e-10 relative; its two extreme points are vertically aligned to 9.4e-10, which is what makes `\|y₂−y₁\|/2` the right radius |
| `latitudeRange` | over-inclusive ⇒ **safe** | uses `ceil` for the max. `cy − r > 0` always (min 1.2e-5 over 500,000 cases), so it never takes `log` of a non-positive |
| `longitudeRange` | **BUG** — samples the band *bottom* | evaluates the circle's x-extent at `y = 2^latitude` instead of at the widest `y` in the band. Misses ≥1 cell in **74.2 %** of bands and **45.8 %** of all touching cells. Partly masked in 2012 because drawables were indexed into several tiles and de-duplicated by `id`; the git history has a commit titled *"fix missing rooms"* |
| `dungeonPoint`, `writeGrid` text anchors | **correct** | |
| `writeDungeon` room-number anchors | **BUG** — `ax/ay` ↔ `upx/upy` swapped | note `writeGrid` at lines 185/187 is *correct*, so this is specific to the dungeon room numbers |
| `writeDrawables` LOD | tile-based semantics, not a bug | `minRadius`/`maxRadius` test whether the drawable's *tile* is inside a circle, not the drawable itself |

### `clock.html`

| symbol | status |
|---|---|
| hand rotation (Euclidean rotation of `hyperShadow`) | **correct** — rotation about the origin in these coordinates *is* the hyperbolic rotation isometry |
| `updateTime` | **BUG** — re-registers `setInterval` every tick, so there are `60n` timers after `n` minutes |

### Formulas in this library

| formula | status | evidence |
|---|---|---|
| fused SU(1,1) projection kernel `z = (aζ + bw)/conj(āw + b̄ζ)` | verified | equals `internalToScreen` to 3.9e-13; ~14 multiplies and no allocation vs ~40 plus a `sqrt` plus 2 allocations, evaluated *twice per edge*, in the original |
| far-field precision | verified | at `(0, 11711.92)` recentred on itself the original polynomial is **310 px wrong** (it lands on the disk boundary); the fused kernel is exact. Also 38.75 px at `(−2.4, 5000)`, 0.038 px at `(0, 1000)` |
| `movePointToPoint`: `β = (c + k c̄)/(1 − |k|²)`, `c = z_F − z_P`, `k = z_F z_P` | verified | carries `z_P` to `z_F` to 4.1e-14 |
| `normalize()` by polar re-factoring | verified | `|a| = sqrt(1+|b|²)` to 6.5e-16. **Do not divide by `sqrt(det)`**: at `d = 20`, `|a|²` and `|b|²` are both ≈5e8 and their difference has already lost 8 digits, so that only restores `det = 1 ± 1e-8` |
| `cosh(d/2) = |w₁w₂ − ζ̄₁ζ₂|` (**modulus**) | verified | 5.5e-13 relative. Write `A = w₁w₂ − x₁x₂ − y₁y₂`, `B = x₁y₂ − x₂y₁`; then `cosh(d/2) = sqrt(A²+B²)`. **The real part alone is WRONG** — I planned to use it and called it "exact in three multiplies"; measured error up to 19.6. `A` alone is a *lower bound*, hence conservative (over-includes, never wrongly rejects), but not exact. Compare squares: 6 multiplies, no `sqrt` |
| in-disk test `A² + B² < 1/(1−τ²)` | verified exact | 0 disagreements in 80,000 cases |
| cap rejection `sqrt(A²+B²) > cosh((ρ+r)/2)` | verified | 0 false rejections in 80,000 cases; it is the triangle inequality `d(Q,C) > ρ + r` |
| bounding cap construction | correct by construction | take any vertex as `Q`, `r = max_i d(Q, P_i)`; safe by the triangle inequality. A minimal enclosing cap would be tighter but correctness does not depend on it |
| `north(M) = arg((a·i + b)/(b̄·i + ā))` | verified | equals `halfPlaneOrientation` to 7.3e-13, so replacing 30 lines with one `atan2` is a **simplification, not a fix** |
| stable `halfPlane → hyperShadow` | verified | `t = |z−i|/|z+i|`, `sinh(d/2) = t/sqrt((1−t)(1+t))`. Exact to machine precision at every scale, including where the original returns 0 |
| stable `hyperShadow → halfPlane` | verified | for `y > 0` use `den = (4x²w² + 1)/(2r² + 1 + 2yw)` (all terms positive, algebraically identical); for `y ≤ 0` the original form is already all-positive. Finite and correct to ~1e-15 out to `y = 10⁸` both directions |
| `{p,q}` metric relations | verified **by construction** for `{8,3} {4,5} {5,4} {7,3} {3,7} {6,4} {9,4} {12,3}` | build the polygon and measure. `cosh χ = cot(π/p)cot(π/q)` (circumradius), `cosh ψ = cos(π/q)/sin(π/p)` (**inradius**), `cosh φ = cos(π/p)/sin(π/q)` (**half-edge**), interior angle `2π/q`, centre-to-centre `2ψ`, and `cosh χ = cosh ψ · cosh φ`. **I originally had the inradius inverted** — `cos(π/p)/sin(π/q)` is the half-edge. The two swap under `p ↔ q`, which is why it is an easy slip and why it survived (they coincide for self-dual `{p,p}`) |
| edge half-turn generators `g_k = S^k g₀ S^{−k}`, `g₀ = (i cosh ψ, −i sinh ψ)` | verified for `p = 3,4,5,7,8,9,12` | in SU(1,1); `g_k² = −I` (an involution, so the edge back to the parent has the same index in the child); hits all `p` neighbour centres. Works for **odd** `p` too — the edge-midpoint half-turn is always in `[p,q]⁺` (it is the "2" of the `(2,p,q)` triangle group). Only pure *translations* need even `p` |
| binary tiling frame | verified | `C·A·C⁻¹` is in SU(1,1) form with **zero** deviation, where `A: z ↦ s·z + t`, `s = 2^(lat+0.5)`, `t = (lon+0.5)·2^lat`. Maps the local origin to the cell centre (2.2e-16) and the local box to the cell (4.4e-16 × tile size, over 200,000 cells with `lat ∈ [−40,40]`, `|lon| ≤ 10⁶`) |
| binary tile local box | verified | **every** cell is the same box in tile-local half-plane coordinates: `x ∈ ±1/(2√2) = ±0.353553391`, `y ∈ [2^{−1/2}, 2^{1/2}]`. The half-width is `0.5/√2`, **not** `0.5`, because `s` scales both axes while the cell's x-width is only `2^lat`. This `(lat,lon)`-independence is what makes "the same prototype in every cell" work |
| horocyclic clip arcs | verified | `y = const` maps to a circle internally tangent to the unit circle at `+i`, to 1.5e-10 |
| `{8,3}` `433` structure | verified | the tile stabiliser is **C₄, not C₈** (enumerated words fixing the central octagon realise exactly `{0,2,4,6}·2π/8`); all 8 edge-neighbours are reachable by `R₃(V,±1)` about the 4 class-A vertices |
| exact pinch solve | verified | both fingers pinned to 1.8e-12 px. The problem is **exactly determined**: unknowns are zoom (1) + isometry (3) = 4, constraints are 2 fingers × 2 coordinates = 4. Root-find `s` on `d(g₁/s, g₂/s) = d(D₁, D₂)`, then match the hyperbolic midpoint and one bearing. The solved scale is within 10 % of the naive Euclidean ratio (median 1.000), so the gesture still feels the same |

## Deliberate approximations

These are choices, not defects. Document them in `docs/MATH.md`; do not silently "fix" them.

- **`zoom` is a Euclidean magnification of the projection**, not a hyperbolic isometry. Applying it as
  a uniform scale at draw time is correct and intended: geodesic arcs scale consistently because they
  are orthogonal to the *unit* circle, which scales with everything else.
- **Short edges are drawn as straight chords.** Replace the original's fixed `0.1` disk-unit threshold
  with a pixel-space sagitta test (arc iff `R − sqrt(R² − (c/2)²) > 0.25 px`), which is
  resolution-correct rather than zoom-dependent.
- **Text below a minimum size is skipped**, and text is drawn with a real font size rather than
  `ctx.scale` (which also scales strokes and defeats hinting).
- **The Escher tile art is a least-squares fit.** Escher's original is hand-drawn and the 2012 tracing
  was replicated with an admittedly approximate group; the residual boundary mismatch is measured and
  quoted rather than hidden.

## Precision envelope

In a **single global patch**, `1 − tanh(d/2) ≈ 1e-11` at `d ≈ 24`, so any half-plane↔disk conversion
there loses ~5 digits however it is written. That is an inherent float64 limit of one patch, and it is
the structural argument for the atlas: tile-local coordinates never form a near-1 quantity, and a tile
frame is built by *multiplying generator matrices* whose entries stay `O(cosh ψ)` — for `{8,3}`,
13 factors at `d = 20` — so the relative error is `O(Lε) ≈ 3e-15`, *relative to the tile* rather than
to the world.

## Harness defects found during auditing

Recorded because they are the reason the audit initially looked non-convergent, and because the same
traps will recur.

1. A float64 reference whose own error (`atanh` near 1, at `d ≈ 10`) exceeded the test threshold, so a
   correct claim failed at 1.1e-12. Fixed with all-`decimal` arithmetic *and* an algebraic proof.
2. Modelling `finger1Real` as a *data* point when the original stores a **view-frame** point. This made
   a correct drag solver look badly broken (1.84 error). Read the call site, not just the function.
3. Two factor-of-`zoom` errors in the pinch pixel model. The required screen target for a grabbed data
   point is `g/s`, not `g` and not `g·zoom/s`.
4. Computing a relative error against a magnitude that had been rounded to zero (tile corners rounded
   to 6 decimals at `latitude = −40`), producing a spurious `1e294`.
5. Shadowing a counter variable with a point tuple.
