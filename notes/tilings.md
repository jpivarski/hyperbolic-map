# Tilings

Two built-in tilings. All formulas verified **by construction** (build the polygon, measure) rather
than formula-against-formula — see `math-audit.md`.

## Regular `{p,q}`

Exists iff `1/p + 1/q < 1/2` ⟺ `(p−2)(q−2) > 4`. At `K = −1`, for a regular `p`-gon with vertex angle
`2π/q`, from the `(2,p,q)` right triangle (angle `π/p` at the tile center, `π/2` at an edge midpoint,
`π/q` at a vertex):

```
circumradius   cosh χ = cot(π/p)·cot(π/q)
inradius       cosh ψ = cos(π/q)/sin(π/p)
half-edge      cosh φ = cos(π/p)/sin(π/q)
edge length    2φ
center-to-center of edge-adjacent tiles = 2ψ
identity check cosh χ = cosh ψ · cosh φ      (hyperbolic Pythagoras)
```

> **Trap.** `cos(π/p)/sin(π/q)` is `cosh` of the **half-edge**, not the inradius. The two swap under
> `p ↔ q`, and they coincide for self-dual `{p,p}`, so an inverted formula survives casual checking.
> I had this wrong initially. `{8,3}`: `χ = 0.860706304`, `ψ = 0.764285460`, `φ = 0.363519920`.
> The `{8,3}` neighbor center sits at local radius `sinh ψ = 0.840896415 = 2^{−1/4}`.

Vertices are placed at angles `π/p + 2πk/p` so that **edge midpoints land on `2πk/p`**, i.e. edge 0's
midpoint is on the `+x` axis.

### Generators

The natural generator is the **half-turn about an edge midpoint**:

```
g₀ = T_{M₀}·Rot(π)·T_{M₀}⁻¹ = ( i·cosh ψ , −i·sinh ψ )        (as SU(1,1) (a,b))
g_k = S^k g₀ S^{−k}                                            S = Rot(2π/p)
```

Verified for `p = 3,4,5,7,8,9,12`: in SU(1,1); `g_k² = −I` (an involution — so **the edge back to the
parent has the same index in the child**, before the canonical frame correction); and `g_k` sends the
tile center to the edge-`k` neighbor center at distance `2ψ`.

This works for **odd `p` too**. The edge-midpoint half-turn is always in `[p,q]⁺` — it is the "2" of the
`(2,p,q)` triangle group. Only pure *translations* between adjacent tiles require even `p`; do not
confuse the two.

The edge-`k` neighbor of a tile with frame `F` is simply `F·g_k`.

### `frameSymmetry` and why it matters

If identical art is placed in every tile by walking a group `G`, the union is `G`-invariant **iff the
art is invariant under `Stab_G(tile)`**. So the walk group must be chosen to match the art:

| walk group | stabilizer | art must be |
|---|---|---|
| `[p,q]` (with reflections) | `D_p` | fully dihedral — almost never what you want |
| `[p,q]⁺`, half-turn generators | `C_p` | `p`-fold rotationally symmetric |
| a proper subgroup | `C_m`, `m \| p` | `m`-fold symmetric — needs rotation generators, **not** half-turns |

`regularTiling({p, q, frameSymmetry: m})` selects accordingly. `m = p` is the default and uses `g_k`.
For `m < p` the half-turn is generally outside the required subgroup — see
`escher-circle-limit-iii.md` for the `{8,3}`, `m = 4` case, which is exactly this situation and where
using `g_k` would silently shred the pattern.

### Tile keys

Requirement: keys that are stable across sessions, usable as cache keys and filenames, computable
**locally** (a tile at `d = 20` sits behind ~`e²⁰` tiles, so BFS-from-root is impossible),
duplicate-free, and supporting point→tile lookup.

Chosen: **the tile's center in the Coxeter geometric representation of `[p,q]`, held exactly over
`ℤ[2cos(π/N)]` with BigInt coefficients.**

A tile is a coset `F · C_m` of the stabilizer, and the canonical representative is the
lexicographically least matrix in it. Two routes give `M` and `M · P^j`, whose candidate sets
`{M · P^k}` coincide, so the minimum is route-independent — that is the entire proof, and it needs no
automaton and no normal form. The representative is at once the tile's id and its canonical frame. The
published id is the serialized center `F · v_O` (three ring elements rather than nine); `P` fixes
`v_O`, so it is the same for every frame in the coset and needs no canonicalization of its own.

Exactness is the point. The entries grow like `cosh(d/2)`, so past `d ≈ 37` one ulp exceeds the spacing
between tile centers and no float comparison can decide identity — and *any* threshold fails at some
distance. Integers have no ceiling. Faithfulness of the geometric representation (Tits; Humphreys
§5.3–5.4) is what makes matrix equality a definition rather than a heuristic.

Cost: ~117 ring multiplications per tile, once per tile ever, never per frame — 197 of 200 frames of a
pan perform none. An id's text grows about 12 characters per tile crossed, so the store is bounded (see
`storeNode`) and a walk of thousands of tiles is real work. See `performance.md`.

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
- **Not edge-to-edge. Five neighbors**: 1 parent `(lat+1, ⌊lon/2⌋)`, 2 children `(lat−1, 2·lon)` and
  `(lat−1, 2·lon+1)`, 2 lateral `(lat, lon±1)`. A cell's bottom edge is the union of its two children's
  top edges, which is why the original emitted an extra midpoint vertex when drawing cell boundaries.
- **Weakly aperiodic**: monohedral but *not* tile-transitive. Its symmetry group is essentially
  `⟨z ↦ 2z⟩`; `z ↦ z+1` is not a symmetry. **So it cannot produce a seamless group-invariant Escher
  pattern.** It is still a perfectly good *addressing* scheme with a well-defined per-cell frame, which
  is all a map database needs — and what the dungeon wants.

### Frame

`A: z ↦ s·z + t` with `s = 2^(lat+0.5)`, `t = (lon+0.5)·2^lat`, conjugated by the Cayley matrix
`C = [[i, 1], [1, i]]` (for `z ↦ i(z−i)/(z+i)`). Verified: `C·A·C⁻¹` is in SU(1,1) form with **zero**
deviation; maps the local origin to the cell center (2.2e-16).

Tile-local origin is the cell's hyperbolic center — half-plane `((lon+0.5)·2^lat, 2^(lat+0.5))`. The `y`
center is the *geometric* mean of the band edges; the `x` center is the arithmetic mean because
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

Correct: evaluate at `y* = clamp(circleCenterY, 2^lat, 2^(lat+1))`, then confirm each candidate with an
exact box-circle intersection test. Do not repeat the original's mistake.

For regular tilings, enumerate breadth-first from the tile containing the view center, with a
3-multiply Minkowski cap rejection per tile, traversing with `ρ + χ + 2ψ` of slack (so a tile touching
only at a vertex is still reachable through a neighbor) while using the exact bound for inclusion.
Tighten `ρ` to the **screen rectangle**, not the disk: `min(drawRadius, hypot(w,h)/(2·scale))`. At the
dungeon's `zoom: 3` only `|z| ≲ 0.47` is visible, which roughly quarters the tile count.

## The stabilizer, and what it does and does not constrain

A tile's frame is only defined up to the tile's **stabilizer**: the subgroup of the walk group that
fixes that tile. For `{p,q}` it is `C_m`, the rotations by multiples of `2*pi/m` about the tile center,
with `m = frameSymmetry`. Measured, not assumed — walk the tile graph keeping one frame per tile, and
at every collision compute `F_seen^-1 . F_new`: every discrepancy is a rotation by a multiple of
`2*pi/m`, never a translation, never any other angle. Pinned by the test
`two routes to one tile differ by exactly the stabilizer C_m, never more`.

The library spends that freedom once, globally: each tile's frame is the lexicographically least
element of its coset, and its id is that frame's center. Both are functions of the tile. **So tile art
may be fully asymmetric and may depend on its own address.** The acceptance test is check 10 in the
browser diagnostics: a hundred equal steps across one tile spacing, fully asymmetric art colored by a
hash of the id, no discontinuity at any step, on all nine tilings.

What the stabilizer still decides is what a repeating pattern looks like. The union of one tile's art
over the whole group is invariant under that group iff the art is stabilizer-invariant; art that is not
still draws stably, it just yields a decorated tiling with less symmetry than the tiling itself.

`tileClass()` remains the *structured* per-tile variation: a homomorphism `phi: Gamma -> Z/n` killing
the stabilizer, under which adjacent tiles never agree. From the abelianisation, verified by an exact
walk at construction:

| tiling | stabilizer | classes |
|---|---|---|
| `{8,3}` m=4 | C_4 | **3** (proper 3-coloring of the octagons) |
| `{8,3}` m=8 | C_8 | 1 |
| `{7,3}` | C_7 | 1 |
| `{5,4}` | C_5 | **2** |
| `{4,5}` | C_4 | 1 |
| `{6,4}` | C_6 | **2** |
| `{3,7}` | C_3 | 1 |
| `{12,3}` | C_12 | 1 |
| `{9,4}` | C_9 | **2** |
| binary | trivial | 1 |

For `m = p`: `phi(g)` has order dividing 2, and going around a vertex forces `q*phi(g) = 0`, so there
are two classes when `q` is even and one when `q` is odd. For `m = p/2` the generators are vertex
rotations of order `q`, giving `Z/q`.

### Color symmetry: the general case

A tile class is the special case of a homomorphism `Gamma -> Z/n` that the library can DISCOVER, because
the abelianisation is forced by `{p,q,m}`. The general case is a homomorphism into any finite permutation
group, and it has to be DECLARED, because nothing about the tiling picks it — it is a property of the
picture. `RegularTiling`'s `colorSymmetry` option takes one and hands each tile its group element.

Two things make it a different mechanism rather than a wider integer:

- **It need not kill the stabilizer.** A class must, or it would not descend to tiles. A color symmetry
  need not, and Escher's does not: `phi(P)` swaps the two colors an octagon shows. That is well defined
  only because a tile's canonical frame is: picking the representative `F.P` instead rotates the art by
  `2*pi/m` and multiplies the label by `phi(P)`, and the two cancel. Before frames were canonical this
  could not have been made to work at all.
- **The accumulation carries `P^k`.** A class advances by `cls + classStep[g]`; a color symmetry
  advances by `phi_parent . phi(G_g) . phi(P)^k` with `k` the canonical fold's own rotation, which is
  exactly the term the cyclic case is free to drop.

Verified the same way and more strictly: the generator relations are checked individually, and then the
tile graph is walked and every pair of routes to one tile must agree. It THROWS rather than degrading to
the trivial coloring, because a class is the library's guess and a color symmetry is the caller's
assertion. For `{8,3}` m=4 with four colors, 16 of the 24 candidates for `phi(G_0)` pass every cheap
algebraic check and are caught only by that walk.

See `notes/escher-circle-limit-iii.md` for the worked case: the image is `A_4`, order 12.

## Which frameSymmetry values exist

Only `m = p` and `m = p/2`; anything else throws at construction. `m = p` steps by half-turns about
edge midpoints, one generator per edge. `m < p` steps by rotations about the `m` vertices whose index
is a multiple of `p/m`, two generators per vertex, reaching `2m` of the `p` edges — so covering the
plane needs `2m >= p`, and `m | p` with `m < p` forces `m = p/2`. Measured on the case this rejects:
`{8,3}` with `m = 2` reaches edges 0, 1, 4 and 5 only, and a 0.75-radius view returns 5 tiles where 17
belong.

### How to build art that IS stabilizer-symmetric, when you want it

Build one wedge of `2*pi/m` and repeat it by exact rotation. Do not build the whole tile and hope it
comes out symmetric: in tile-local coordinates the stabilizer is an ordinary Euclidean rotation, so a
wedge repeated exactly is symmetric to machine precision (measured 6e-17 to 7e-16 for the diagnostics
pinwheels, 3.9e-17 for the Circle Limit III tile), whereas anything traced or fitted is not — a traced
Escher tile scores **Infinity** when not one of its 90 shapes has a C4 partner.

`atlas.checkTileSymmetry` measures it: `"off"` by default, `"warn"` or `"throw"` to opt in. It is a
lint for art whose symmetry is part of its meaning, not a correctness requirement.
