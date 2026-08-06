# Tilings

Two built-in tilings. All formulas verified **by construction** (build the polygon, measure) rather
than formula-against-formula — see `math-audit.md`.

## Regular `{p,q}`

Exists iff `1/p + 1/q < 1/2` ⟺ `(p−2)(q−2) > 4`. At `K = −1`, for a regular `p`-gon with vertex angle
`2π/q`, from the `(2,p,q)` right triangle (angle `π/p` at the tile centre, `π/2` at an edge midpoint,
`π/q` at a vertex):

```
circumradius   cosh χ = cot(π/p)·cot(π/q)
inradius       cosh ψ = cos(π/q)/sin(π/p)
half-edge      cosh φ = cos(π/p)/sin(π/q)
edge length    2φ
centre-to-centre of edge-adjacent tiles = 2ψ
identity check cosh χ = cosh ψ · cosh φ      (hyperbolic Pythagoras)
```

> **Trap.** `cos(π/p)/sin(π/q)` is `cosh` of the **half-edge**, not the inradius. The two swap under
> `p ↔ q`, and they coincide for self-dual `{p,p}`, so an inverted formula survives casual checking.
> I had this wrong initially. `{8,3}`: `χ = 0.860706304`, `ψ = 0.764285460`, `φ = 0.363519920`.
> The `{8,3}` neighbour centre sits at local radius `sinh ψ = 0.840896415 = 2^{−1/4}`.

Vertices are placed at angles `π/p + 2πk/p` so that **edge midpoints land on `2πk/p`**, i.e. edge 0's
midpoint is on the `+x` axis.

### Generators

The natural generator is the **half-turn about an edge midpoint**:

```
g₀ = T_{M₀}·Rot(π)·T_{M₀}⁻¹ = ( i·cosh ψ , −i·sinh ψ )        (as SU(1,1) (a,b))
g_k = S^k g₀ S^{−k}                                            S = Rot(2π/p)
```

Verified for `p = 3,4,5,7,8,9,12`: in SU(1,1); `g_k² = −I` (an involution — so **the edge back to the
parent has the same index in the child**, making words walk-reversible for free); and `g_k` sends the
tile centre to the edge-`k` neighbour centre at distance `2ψ`.

This works for **odd `p` too**. The edge-midpoint half-turn is always in `[p,q]⁺` — it is the "2" of the
`(2,p,q)` triangle group. Only pure *translations* between adjacent tiles require even `p`; do not
confuse the two.

The edge-`k` neighbour of a tile with frame `F` is simply `F·g_k`.

### `frameSymmetry` and why it matters

If identical art is placed in every tile by walking a group `G`, the union is `G`-invariant **iff the
art is invariant under `Stab_G(tile)`**. So the walk group must be chosen to match the art:

| walk group | stabiliser | art must be |
|---|---|---|
| `[p,q]` (with reflections) | `D_p` | fully dihedral — almost never what you want |
| `[p,q]⁺`, half-turn generators | `C_p` | `p`-fold rotationally symmetric |
| a proper subgroup | `C_m`, `m \| p` | `m`-fold symmetric — needs rotation generators, **not** half-turns |

`regularTiling({p, q, frameSymmetry: m})` selects accordingly. `m = p` is the default and uses `g_k`.
For `m < p` the half-turn is generally outside the required subgroup — see
`escher-circle-limit-iii.md` for the `{8,3}`, `m = 4` case, which is exactly this situation and where
using `g_k` would silently shred the pattern.

### Tile keys

Requirement: session-stable keys usable as cache keys and filenames, computable **locally** (a tile at
`d = 20` sits behind ~`e²⁰` tiles, so BFS-from-root is impossible), duplicate-free, and supporting
point→tile lookup.

Chosen: **a word over the generators, canonicalised by a greedy geometric parent rule.** From a tile's
frame, evaluate the neighbour centres, rank by `(round(log⟨C,O⟩/qs), round(atan2(y,x)/qa))`, and step to
the strictly-lower-ranked minimum; follow that chain to the root and reverse. `O(depth·p)` — 13 steps
at `d = 20` for `{8,3}` — memoised per tile. The quantisation is *relative*, so it works at any
distance.

BFS deduplication uses a spatial hash on `(x/w, y/w)` confirmed by an exact `⟨C,C'⟩ < cosh ψ` check.
Adjacent centres differ by `~e^{−d}` in those coordinates (2e-9 at `d = 20`) versus ~1e-15 accumulated
error — six orders of margin.

> **This rule is a heuristic, not a theorem.** It is the one item in the whole design that is unproven.
> The guard is a property test asserting that word↔tile is a bijection over 50,000 tiles. The rigorous
> alternative is the **Coxeter shortlex normal form** (Coxeter groups are automatic, so a DFA
> recognises canonical coset representatives and gives duplicate-free enumeration); keep the `Tiling`
> interface swappable so it can be dropped in. See `open-questions.md`.

## Binary (Böröczky) tiling

The tiling the 2011 server used. In the upper half-plane, cell `(latitude, longitude)` is
`x ∈ [lon·2^lat, (lon+1)·2^lat]`, `y ∈ [2^lat, 2^(lat+1)]`.

- **Point → tile is two `floor`s**, which no `{p,q}` scheme can match:
  `latitude = floor(log₂ y)`, `longitude = floor(x·2^−latitude)`. Verified, 0 mismatches in 200,000.
- All cells are congruent, each of hyperbolic area exactly `1/2`.
- Cells are **not regular polygons and not convex**: four sides meeting at right angles, alternately
  geodesic (`x = const`) and **horocyclic** (`y = const`). The horocycles map to circles internally
  tangent to the unit circle at `+i` (verified to 1.5e-10) — the clip-path builder must handle these,
  not just geodesic arcs.
- **Not edge-to-edge. Five neighbours**: 1 parent `(lat+1, ⌊lon/2⌋)`, 2 children `(lat−1, 2·lon)` and
  `(lat−1, 2·lon+1)`, 2 lateral `(lat, lon±1)`. A cell's bottom edge is the union of its two children's
  top edges, which is why the original emitted an extra midpoint vertex when drawing cell boundaries.
- **Weakly aperiodic**: monohedral but *not* tile-transitive. Its symmetry group is essentially
  `⟨z ↦ 2z⟩`; `z ↦ z+1` is not a symmetry. **So it cannot produce a seamless group-invariant Escher
  pattern.** It is still a perfectly good *addressing* scheme with a well-defined per-cell frame, which
  is all a map database needs — and what the dungeon wants.

### Frame

`A: z ↦ s·z + t` with `s = 2^(lat+0.5)`, `t = (lon+0.5)·2^lat`, conjugated by the Cayley matrix
`C = [[i, 1], [1, i]]` (for `z ↦ i(z−i)/(z+i)`). Verified: `C·A·C⁻¹` is in SU(1,1) form with **zero**
deviation; maps the local origin to the cell centre (2.2e-16).

Tile-local origin is the cell's hyperbolic centre — half-plane `((lon+0.5)·2^lat, 2^(lat+0.5))`. The `y`
centre is the *geometric* mean of the band edges; the `x` centre is the arithmetic mean because
`z ↦ a+b−z` is an isometry fixing the two bounding vertical geodesics.

**Useful concrete fact:** in tile-local half-plane coordinates every cell is the *same* box,

```
x ∈ ±1/(2√2) = ±0.353553391 ,   y ∈ [2^{−1/2}, 2^{1/2}] = [0.707106781, 1.414213562]
```

The half-width is `0.5/√2`, **not** `0.5`, because `s` scales both axes while the cell's x-width is only
`2^lat`. (I got this wrong once.) That `(lat,lon)`-independence is exactly what makes "the same
prototype room in every cell" work. Verified to 4.4e-16 × tile size over 200,000 cells with
`lat ∈ [−40,40]`, `|lon| ≤ 10⁶`.

## Visible-tile enumeration

The 2011 server's `longitudeRange` evaluated the visible circle's x-extent at `y = 2^latitude`, the
**bottom** of the band, instead of at the widest `y` in the band. It therefore missed ≥1 cell in 74.2 %
of bands and 45.8 % of all touching cells. (Partly masked because drawables were indexed into several
tiles and de-duplicated by `id`; the 2012 git history has a commit titled *"fix missing rooms"*.)

Correct: evaluate at `y* = clamp(circleCentreY, 2^lat, 2^(lat+1))`, then confirm each candidate with an
exact box-circle intersection test. Do not repeat the original's mistake.

For regular tilings, enumerate breadth-first from the tile containing the view centre, with a
3-multiply Minkowski cap rejection per tile, traversing with `ρ + χ + 2ψ` of slack (so a tile touching
only at a vertex is still reachable through a neighbour) while using the exact bound for inclusion.
Tighten `ρ` to the **screen rectangle**, not the disk: `min(drawRadius, hypot(w,h)/(2·scale))`. At the
dungeon's `zoom: 3` only `|z| ≲ 0.47` is visible, which roughly quarters the tile count.
