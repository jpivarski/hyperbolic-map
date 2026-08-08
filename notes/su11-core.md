# The SU(1,1) transform core

Everything geometric in this library is one representation: a 2×2 complex matrix.

## Representation

An orientation-preserving isometry of the Poincaré disk is

```
M = [[ a, b ],        |a|² − |b|² = 1,      z ↦ (a z + b) / (b̄ z + ā)
     [ b̄, ā ]]
```

Stored as four doubles `ar, ai, br, bi`. `±M` give the same isometry (SU(1,1) is a double cover of
`PSU(1,1) ≅ Isom⁺(H²)`), so a "rotation by 2π" is `−I`, not `I` — relevant if you ever interpolate
between camera states.

Constructors: `identity`, `rotation(θ)` = `(e^{iθ/2}, 0)`, `translationToDisk(β)` =
`(1, β)/sqrt(1−|β|²)`, `translationToLocal(x,y)` = `(w, x+iy)`, `translation(dist, bearing)` =
`(cosh(d/2), sinh(d/2)e^{i·bearing})`.

## Why this is not just a refactor

**A data point in local coordinates *is* an isometry.** The point `(x, y)` with
`w = sqrt(1+x²+y²)` corresponds to `P = (w, x+iy)`, which satisfies `|a|²−|b|² = 1` identically and
maps the origin to `(x+iy)/w` — exactly the point's disk coordinate. So projecting a point under a view
`M` is reading off the corner ratio of the product `M·P`:

```
z = (a ζ + b w) / conj(ā w + b̄ ζ)          ζ = x + iy,  w = sqrt(1+x²+y²)
```

In real arithmetic, with `w` precomputed at ingest:

```
nr = ar*x - ai*y + br*w      ni = ar*y + ai*x + bi*w
dr = ar*w + br*x + bi*y      di = br*y - bi*x - ai*w
s  = 1/(dr*dr + di*di)
zx = (nr*dr + ni*di)*s       zy = (ni*dr - nr*di)*s
```

~14 multiplies, one reciprocal, **no allocation and no `sqrt`**. The original computed the same thing
as three ~40-term unrolled polynomials plus a `sqrt` plus a 2-element array allocation — and evaluated
it *twice per edge*, because every vertex was projected once as `j` and again as `jnext`.

The original's view state `(B, R)` already *was* such a matrix: `M = Rot(R)·T(B)` — rotation applied
**after** translation. Order matters; verified to 5.3e-14.

## Precision

The polynomial form's intermediate terms reach ~1e16 when the offset cancels a far-field point, and
they cancel to what should be exactly 1. Measured against 60-digit arithmetic, errors in px on a
620 px canvas:

| data point | `d` | polynomial | this kernel |
|---|---|---|---|
| `(0, 1000)` | 15.2 | 0.038 px | 0 |
| `(−2.4, 5000)` | 18.4 | 38.75 px | 0 |
| `(0, 11711.92)` | 20.1 | **310 px** (the disk boundary) | 0 |

The matrix form keeps intermediates at ~1e8 for the same case. A second, independent failure in the
original: `updateCoordinates` computes `denom = sqrt(denom² − real² − imag²)`, which cancels ~8 digits
at `d = 20`, and then stores the result **off the group manifold** so error accumulates gesture over
gesture. Matrix composition has neither problem.

## `normalize()` — do not divide by `sqrt(det)`

At `d = 20`, `|a|²` and `|b|²` are both ≈5e8 and their difference (which should be 1) has already lost
8 digits, so dividing by `sqrt(det)` only restores `det = 1 ± 1e-8`. Re-factor through the polar form
instead, which lands on the manifold *by construction*:

```
|a| = hypot(ar, ai)              // no cancellation
θ   = 2·atan2(ai, ar)            // exact rotation part
β   = b·ā/|a|                    // exact translation part
w   = sqrt(1 + |β|²)             // recompute the diagonal FROM the off-diagonal
M   = Rot(θ)·T(β)
```

Verified: `|a| = sqrt(1+|b|²)` to 6.5e-16. Beyond `|b| ≈ 1e8` (`d ≈ 37`), where `1 + |b|²` loses the
`1`, switch to `|b| = sqrt((|a|−1)(|a|+1))`.

Call it on every gesture commit and every ~8 factors inside a long generator word.

## Solvers

- **Drag.** `movePointToPoint(z_P → z_F)`: with `c = z_F − z_P` and `k = z_F z_P`,
  `β = (c + k c̄)/(1 − |k|²)`, then `a = 1/sqrt(1−|β|²)`, `b = βa`. Two complex multiplies; verified to
  4.1e-14. Recomputed fresh from the gesture anchor each frame, so nothing accumulates. Worst case with
  a rim-to-rim drag at `interactRadius = 0.9` gives `1 − |β|² ≈ 0.011`: one digit lost.
- **Compass.** `north(M) = arg((a·i + b)/(b̄·i + ā))` — the bearing of the half-plane's ideal point,
  which works because geodesics through the disk center are straight diameters. One `atan2`, verified
  equal to the original's 30-line `halfPlaneOrientation` to 7.3e-13. Apply as
  `M ← Rot(bearing − north(M))·M`.
- **Pinch.** Exactly determined: 4 unknowns (zoom + 3 for the isometry), 4 constraints (2 fingers × 2
  coordinates). The required screen target for a grabbed data point is `g/s` where `s = zoomNow/zoom`
  — *not* `g`, and not `g·zoom/s`. Root-find `s` on `d(g₁/s, g₂/s) = d(D₁, D₂)`, then match the
  hyperbolic midpoint and one bearing. Pins both fingers to 1.8e-12 px.

## Culling

`cosh(d/2) = |w₁w₂ − ζ̄₁ζ₂|` — note the **modulus of a complex quantity**. With
`A = w₁w₂ − x₁x₂ − y₁y₂` and `B = x₁y₂ − x₂y₁`, `cosh(d/2) = sqrt(A²+B²)`. Compare squares: six
multiplies, no division, no `sqrt`.

A point is inside screen radius `τ` iff `A² + B² < 1/(1−τ²)`. A whole drawable is rejected via a
precomputed bounding cap `(Q, r)` iff `sqrt(A²+B²) > cosh((ρ+r)/2)`, i.e. `d(Q,C) > ρ + r`.

**Using only `A` is wrong** (error up to 19.6) though conservative — it under-estimates the distance,
so it over-includes rather than wrongly rejecting. That makes it a bug that never announces itself,
which is why it is called out here.
