# The mathematics

What the coordinates mean, how they get onto the screen, and where the approximations are.

Clarity is the goal, so equations appear only where they carry the idea. Derivations and the fiddly
bits are folded into `<details>` blocks.

---

## 1. The problem

The hyperbolic plane has more room in it than a flat sheet. Walk outward and the amount of space
within reach of you grows *exponentially* with distance, not quadratically. That is the whole of it:
everything else here is bookkeeping to get that onto a finite screen.

No flat map of it can be faithful, for the same reason no flat map of the Earth can be. This library
uses the **Poincaré disk**: the entire infinite plane is drawn inside one circle, with the boundary
infinitely far away. Angles are shown truthfully; distances are not. Things shrink as they approach
the rim, and the shrinking is what buys room for the infinite remainder.

Straight lines — geodesics, the paths you get by walking without turning — appear in this projection
as **circular arcs that meet the boundary circle at right angles**. A line through the centre of the
view is the special case where the arc has infinite radius and looks straight.

---

## 2. Three coordinate systems

| name | what it is | used for |
|---|---|---|
| **local** | a pair `(x, y)` with companion `w = √(1 + x² + y²)` | how data is stored, and all internal arithmetic |
| **disk** | the Poincaré disk, `z = (x + iy)/w` | what is drawn |
| **half-plane** | the upper half-plane | some source art; the binary tiling is defined here |

The one to understand is **local**. For a point at distance `d` from the origin in direction `θ`:

```
x + iy = sinh(d/2) · e^{iθ}          w = cosh(d/2)
```

so `√(x² + y²) = sinh(d/2)`, and the projection to the screen is simply

```
z = (x + iy) / w = tanh(d/2) · e^{iθ}
```

Two things make this a good storage format. Ordinary finite numbers cover the whole plane, with no
crowding against a boundary — a point at distance 20 has local radius about 11,000 rather than a
disk coordinate of `0.999999996`. And `w² − (x² + y²) = 1` holds *identically*, by the definition of
`w`, which turns out to be the whole reason the arithmetic below is so simple.

### Why the half-angle

Because `(x, y, w)` are literally the entries of a **matrix**.

The transformations we need — slide the view, turn it — are exactly the rigid motions of the
hyperbolic plane, and those form the group `SU(1,1)`: complex 2×2 matrices

```
M = [ a   b ]        with   |a|² − |b|² = 1
    [ b̄   ā ]
```

acting on the disk by `z ↦ (az + b)/(b̄z + ā)`.

Now compare. A point with local coordinates `(x, y)` has `w² − (x² + y²) = 1`. That is the *same
condition*, with `a = w` and `b = x + iy`. And that matrix, applied to the origin, gives `b/ā =
(x + iy)/w` — the point's own disk coordinate.

> **A point is an isometry: the one that carries the origin to it.**

The half-angle is not a convention or a curvature choice. `SU(1,1)` is a *double cover* of the group
of motions — the spin group — and half-angles are what double covers do. It is the same phenomenon
as a spinor needing a 720° turn to come back to itself.

<details>
<summary>Why <code>sinh(d/2)</code> follows, and what this is <em>not</em></summary>

The projection gives `|z| = tanh(d/2)`, so `√(x²+y²)/w = tanh(d/2)`. Together with the identity
`w² − (x²+y²) = 1`, the pair `(w, √(x²+y²))` satisfies `cosh² − sinh² = 1` with ratio `tanh(d/2)`.
Hence `w = cosh(d/2)` and `√(x²+y²) = sinh(d/2)` — an algebraic identity, not an approximation.
Verified in 90-digit arithmetic to 1 part in 10⁸⁶.

**This is not the hyperboloid model.** It is easy to assume it is, because `w² − x² − y² = 1` is the
hyperboloid's equation, and the original 2011 README made exactly that claim. But the hyperboloid
model's shadow is `sinh(d)`, not `sinh(d/2)`. What we have is the hyperboloid vector of the
*midpoint* of the segment from the origin to the point — equivalently, the `SU(1,1)` spinor lift.
The genuine Weierstrass vector is `(2xw, 2yw, 1 + 2(x² + y²))`.

There does not appear to be a standard name for this parametrisation. It is common as an
implementation detail. "SU(1,1) spinor coordinates" is the most recognisable description.

**Conventions pinned.** Curvature `K = −1` throughout, so the disk metric carries the factor 4:
`ds² = 4(dx² + dy²)/(1 − r²)²`, matching the half-plane `(dx² + dy²)/y²`. All the distance formulas
here assume that. Note that `±M` are the same motion — the double cover again — so a "rotation by
2π" is `−I`, not `I`.

**One cost, for honesty.** Geodesics are *linear* in the true Weierstrass vector but *quadratic* in
`(x, y, w)`. We pay that in the renderer, where each geodesic edge is solved for as a circle.
</details>

### The half-plane

The half-plane maps to the disk by

```
z ↦ i (z − i)/(z + i)
```

The factor of `i` beyond the usual Cayley transform is deliberate: it puts the half-plane's point at
infinity at the **top** of the disk rather than at the right. That is why "latitude increases
upward" reads correctly on screen in the dungeon example. Landmarks: `i` goes to the centre, `∞` to
the top, `0` to the bottom.

---

## 3. Moving the view

Scrolling and rotating are the same operation: multiply matrices.

If the view is `M` and a data point is `P` (which, as above, *is* a matrix), the point's screen
position is where `M·P` sends the origin:

```
z = (a·ζ + b·w) / conj(ā·w + b̄·ζ)        ζ = x + iy,   w = √(1 + x² + y²)
```

Four complex multiplies and one divide, with `w` precomputed when the data is loaded. That is the
innermost loop of the whole library.

Dragging is one line. If you grab the disk at `F₀` and move to `F`, the new view is

```
M' = (the translation carrying F₀ to F) · M
```

and the rotation you end up with is not computed at all — it is whatever the product happens to
contain. That is **parallel transport**, and it is a real effect, not an artefact: drag in a closed
loop in the hyperbolic plane and you come back facing a different direction. The amount is
proportional to the area you enclosed. `rotationMode: "compass"` cancels it, at the cost of no longer
pinning the point under your cursor — you cannot have both.

<details>
<summary>Zoom is not a hyperbolic motion, and that is fine</summary>

`zoom` scales the projected disk on screen. It is a plain Euclidean magnification, not a hyperbolic
isometry, and it is applied at draw time and nowhere else.

This is correct rather than a compromise. Geodesic arcs are circles orthogonal to the *unit* circle,
and a uniform scaling takes that whole configuration — arcs and boundary together — to a scaled copy
of itself. So the picture magnifies consistently. What zoom cannot do is change *which* hyperbolic
point is at the centre; that is what dragging is for.
</details>

<details>
<summary>Pinch-to-zoom is exactly determined, which is not obvious</summary>

With two fingers there are four constraints: two fingers, two coordinates each. The unknowns are the
zoom (1) and the isometry (3). Four and four — so both fingers *can* be pinned exactly, and the
library does.

Getting there needs one piece of bookkeeping that is easy to get wrong. Writing `s` for the ratio of
the new zoom to the old, a grabbed data point must land at screen position `g/s`, where `g` is where
the finger is now: the finger position was measured against the zoom in force when the gesture began,
but the frame is drawn at the new zoom. Then `d(g₁/s, g₂/s)` decreases monotonically with `s`, so a
one-dimensional root-find on

```
d(g₁/s, g₂/s) = d(D₁, D₂)
```

fixes the zoom, after which matching the hyperbolic midpoint and one bearing determines the isometry.

The 2011 code instead averaged the two fingers' coordinates arithmetically. An arithmetic mean is not
a hyperbolic midpoint, and the resulting drift was up to 26 pixels on a 620-pixel canvas.
</details>

---

## 4. Drawing

**Geodesic edges.** Given two projected points, the geodesic between them is the unique circle
through both that is orthogonal to the unit circle. Writing that circle as `x² + y² + ax + by + c = 0`,
orthogonality is exactly `c = 1`, which leaves `a` and `b` determined by the two points.

Two details worth stating because both are easy to get wrong:

- If the two points are **collinear with the origin** the determinant vanishes and the geodesic
  really is a straight diameter. That branch is exact, not a fallback.
- The correct arc is always the **minor** one. The whole in-disk portion of a geodesic subtends
  `2·arctan(1/r) < π` at the arc's centre, so any sub-segment does too. Taking the major arc sends
  the curve outside the disk — which is exactly what a sign error in the sweep direction produces,
  and how that bug announced itself here.

**Text** is anchored at a point with a second point giving its up direction. The distance between
their *projections* sets the size, so text foreshortens along with the geometry around it.

**Culling.** Whether a drawable can be seen is decided by one exact test. For two points, the
`SU(1,1)`-invariant form gives their distance directly:

```
cosh(d/2) = | w₁w₂ − ζ̄₁ζ₂ |
```

Note the **modulus of a complex quantity**. Using only its real part is a lower bound — so it
over-includes rather than wrongly rejecting, which makes it a bug that never announces itself. It is
wrong by up to 19.6 in testing. Each drawable carries a precomputed bounding cap, and the test above
rejects the whole cap in six multiplies, before any projection work.

---

## 5. Tilings

Two are built in, and they answer different questions.

### Regular `{p, q}`

Regular `p`-gons, `q` meeting at each vertex. These exist exactly when `1/p + 1/q < 1/2` — the
hyperbolic counterpart of the five Platonic solids' `> 1/2` and the three Euclidean tilings' `= 1/2`.

At curvature `K = −1`:

```
circumradius   cosh χ = cot(π/p) · cot(π/q)
inradius       cosh ψ = cos(π/q) / sin(π/p)
half-edge      cosh φ = cos(π/p) / sin(π/q)
```

with adjacent tile centres `2ψ` apart, and `cosh χ = cosh ψ · cosh φ` as a check (hyperbolic
Pythagoras on the fundamental right triangle).

> `cos(π/p)/sin(π/q)` is the **half-edge**, not the inradius. The two swap under `p ↔ q` and coincide
> for self-dual `{p,p}`, so an inverted formula survives casual checking. It did here, until the
> tiling was built and measured instead of compared against another formula.

**Repeating one tile everywhere** produces a pattern with a symmetry worth stating plainly:

> The union of copies is symmetric under the walk group **if and only if** the tile's art is
> invariant under the tile's stabiliser in that group.

That is a statement about which *pattern* you get, not a restriction on what you may draw: art that is
not stabiliser-invariant is drawn perfectly stably (see §6), it simply produces a decorated tiling with
less symmetry than the tiling itself. Which stabiliser you get is what `frameSymmetry` selects — `C_p`
for the edge-half-turn group, `C_{p/2}` for the alternate-vertex group.

### The binary (Böröczky) tiling

In the upper half-plane, cell `(latitude, longitude)` is

```
x ∈ [lon·2^lat, (lon+1)·2^lat]        y ∈ [2^lat, 2^(lat+1)]
```

All cells are congruent, each of hyperbolic area exactly `1/2`, and point-to-cell is two `floor`s.
They are **not** regular polygons: two sides are geodesics and two are horocycles, meeting at right
angles, and the cell is not convex. The tiling is **not edge-to-edge** — each cell has *five*
neighbours (one parent, two children, two lateral), because a cell's bottom edge is the union of its
two children's top edges. That is the "five doors" of the dungeon.

It is also only *weakly* aperiodic: monohedral, but not tile-transitive. Its symmetry group is
essentially just `⟨z ↦ 2z⟩`. **So it can never produce a seamless group-invariant pattern** — but
every cell still has a well-defined frame, and in its own frame *every* cell is the identical box

```
x ∈ ±1/(2√2)        y ∈ [2^{−1/2}, 2^{1/2}]
```

because the `2^lat` divides out. That is what lets one prototype room be drawn in every cell.

<details>
<summary>Escher's <em>Circle Limit III</em>, and the C₄ trap</summary>

The woodcut sits on the `{8,3}` tiling — regular octagons, **three** per vertex. (Two sources online
say four; that contradicts the definition of `{8,3}`.) Its symmetry group is `433` in orbifold
notation: chiral, rotations only, the `(3,3,4)` triangle rotation group. One fish is a fundamental
domain, and there are exactly **four fish per octagon** — by area, `(2π/3)/(π/6) = 4`.

For the infinite demo, the tile stabiliser under `433` is **C₄, not C₈**, because `433` contains no
order-8 rotation. So the art must be 4-fold symmetric; 8-fold art would give a different member of
Dunham's family, not Escher's.

The trap: the two most natural ways to step between tiles are both *outside* `433`. The 8-fold
rotation about a tile centre is not in it, and neither is the half-turn about a shared edge midpoint
— `433` has no order-2 points at all — even though that half-turn is the natural general-purpose
generator for any `{p,q}`. What works is 3-fold rotations about *alternate* vertices, which is
precisely Escher's own construction: the `{8,3}` edge graph is bipartite, so its vertices two-colour
consistently, and connecting alternate ones is what produces the pattern.

Coxeter's result, for interest: the white "spines" running along the fish are **not** geodesics.
Escher believed they were. They are hypercycles, meeting the boundary at
`cos ω = (2^{1/4} − 2^{−1/4})/2`, i.e. `ω = 79.97°` rather than 90°.
</details>

---

## 6. The atlas, and why precision needs it

In a single global coordinate system, a point at hyperbolic distance `d` has disk coordinate
`tanh(d/2)`, and `1 − tanh(d/2) ≈ 4e^{−d}`. At `d = 20` that is `3.6 × 10⁻⁹`, so a double has only
about seven significant digits left in the quantity that actually matters. The dungeon data reaches
exactly there.

This is **conditioning, not implementation**: no formula can do better in a single patch, because the
disk coordinate itself has no more to give. The library's own round-trip error tracks
`ε/(1 − tanh(d/2))` to within a factor of about two, which is the floor.

An atlas removes the problem structurally, but only if it is built the right way — and the first
attempt here was not, which is worth spelling out because the wrong version looks correct.

### The composition to avoid

The obvious design stores each tile's data relative to its own centre (so every stored number is
small), gives each tile a frame `F_k` carrying tile-local coordinates into the world, and renders
with

```
net = V · F_k
```

Every stored coordinate is indeed small. But `F_k` has entries of order `cosh(d/2)` — **1.08 × 10⁷⁵**
for binary cell `(500, 0)` — and `V` is equally large and opposite, because the camera is looking at
that tile. Their product is `O(1)`. That is catastrophic cancellation: the answer is small, both
factors are astronomical, and the digits that survive are the digits they had in common. Measured, the
set of visible tiles stopped being a function of the view alone past `d ≈ 28`, and a couple of minutes
of dragging reaches `d ≈ 39`.

Splitting the *data* into tiles is not enough. The *frames* must never be global either.

### The anchored composition

Let `c` be the **camera tile** — the tile containing the view centre. Define

```
V_c   = V · F_c            the view, expressed in the camera tile's own frame
R_c→k = F_c⁻¹ · F_k        tile k's frame relative to the camera
net   = V_c · R_c→k
```

Neither `V` nor `F_k` ever exists numerically. Both factors of `net` are `O(1)` for every tile that
can be on screen, and the relative frame is built by multiplying **one constant generator per step of
a walk from the camera** — never from the two tiles' absolute addresses.

Three facts make it work, all proved in `dev/audit_atlas_math.py`:

| | |
|---|---|
| appending a generator multiplies on the right, `F_{c·g} = F_c · G_g` | so a neighbour's relative frame *is* that generator, and a walk telescopes to a plain product |
| **re-anchoring**: crossing into `c' = c·g` gives `V_{c'} = V_c · G_g` | one small multiply, so whenever the view would drift far from its tile the *tile* changes instead and the matrix never grows |
| for the binary tiling every neighbour step is a position-independent **constant** | all `lat` and `lon` cancel symbolically: `S = 1, T = ±√2/2` laterally, `S = ½, T = ∓√2/8` to a child, `S = 2, T = ±√2/4` to a parent |

The last row has a trap in it. The *general* relative frame between two binary cells is

```
S = 2^(lat − lat₀),    T = (√2/4)·( 2^Δlat·(2·lon + 1) − (2·lon₀ + 1) )
```

which still contains both absolute longitudes. It must never be used. Only the neighbour steps are
constant, so a relative frame has to be *composed along a path* rather than computed from addresses.

### What that buys, measured

- The rendered picture matches, to the last antialiasing level, at 1, 5, 50, 500 and 2000 tiles from
  the origin, across nine tilings — which is the acceptance criterion: a regular tiling is homogeneous,
  so however far you scroll it must look as it did at the start. Eight of the nine are byte-identical;
  `{3,7}` differs on 1–4 channels of 409,600 by one level of 255, because canonicalisation is not
  equivariant under translation and a tile 120° from where it was rasterises its last bit differently.
- Screen-position error against a 60-digit `mpmath` reference is **flat in distance**: `3 × 10⁻¹⁶` to
  `1.3 × 10⁻¹⁵` disk units, the same at 5000 tiles as at 0 (worst growth factor 1.0). The *flatness* is
  the property; the magnitude is just float64 epsilon. On the same inputs the global route errs by
  `10⁻² … 10²⁷³` at 500 tiles and overflows to NaN at 5000 on eight of the nine tilings.
- Frame time is flat out to 200,000 tiles (about 150,000 hyperbolic units).
- `stats.maxViewEntry` stays near 1 forever; it is the invariant made visible.

### Tile identity: naming a tile, exactly

The anchored composition fixes the arithmetic of *where* a tile is drawn. It says nothing about *which*
tile it is, and that is a separate question with a separate answer.

**A tile's frame is not unique.** If `F_k` carries the base tile onto tile `k`, so does `F_k · s` for
any `s` in the **stabiliser** of the base tile — the subgroup fixing it. For a `{p,q}` walk group that
stabiliser is the cyclic group `C_m` of rotations about the tile centre, `m = frameSymmetry`. Measured
directly, by walking the tile graph and collecting `F_seen⁻¹ · F_new` at every collision: every
discrepancy is a rotation by a multiple of `2π/m`, never anything else. So a tile is not a group
element; a tile is a **coset** `F · C_m`.

**The canonical representative.** Take the lexicographically least matrix in the coset. Two routes to
one tile give `M` and `M · P^j`, and the candidate sets `{M · P^k}` and `{M · P^j · P^k}` are the *same
set*, so their minima are identical. That is the whole proof that the choice does not depend on the
route — no automaton, no normal form, no parent heuristic. The winner is simultaneously the tile's
unique **id** and its canonical **frame**: one object answers both questions.

Canonicalise over `C_m` and not over the full `C_p`. A canonical frame has to stay inside the set of
frames the walk can produce; over `C_p`, roughly half of `{8,3}` m=4's tiles would be turned by an odd
multiple of 45°, and the Escher pattern would shatter into a misaligned variant.

**Why it has to be exact.** The comparison is between matrices whose entries grow like `cosh(d/2)`. By
hyperbolic distance ≈ 37 one ulp of such an entry exceeds the spacing between adjacent tile centres, so
no float test can still tell two tiles apart out there — and identity decided by proximity fails at
*some* distance however the threshold is tuned. So the representation is integral:

- the ring is `ℤ[μ]`, `μ = 2cos(π/N)`, with `BigInt` coefficients reduced modulo the minimal polynomial
  of `μ` (monic, so no division ever appears);
- the group is `[p,q] = Δ(2,p,q)` in its **Coxeter geometric representation** — mirrors `a`, `b`, `c`
  with `m(a,b) = p`, `m(b,c) = q`, `m(a,c) = 2`, and reflections `S_i = I − e_i·(row i of 2B)`;
- that representation is **faithful** (Tits; Humphreys §5.3–5.4), which is what promotes matrix equality
  from a heuristic to a *definition* of group-element equality. It also has no `±M` double cover, unlike
  SU(1,1);
- `N = lcm(p,q)`, except that when either index is 3 the ring can be halved, since `2cos(π/3) = 1` is
  rational and needs no extension at all. That shortcut is a trap: the Dickson identity `λ_n = D_{N/n}(μ)`
  requires `n | N`, so with `N = 8` and `n = 3` it silently yields `√2` instead of `1` and the Coxeter
  relations fail. `lambdaFor` asserts it.

**The published id** is the serialized tile centre `F · v_O`, three ring elements rather than nine. `P`
fixes `v_O`, so every frame in the coset gives the same vector — the id needs no canonicalisation at all,
and distinct tiles have distinct centres, so it is injective.

**What this costs.** Naming a tile is ~117 ring multiplications and happens once per tile ever, never
per frame: measured across a 200-frame pan of the Escher atlas, 197 frames perform zero. An id's text
grows about 12 characters per tile crossed, so a walk of thousands of tiles is real work — see
`notes/performance.md`.

**What it buys.** Tile art may be fully asymmetric and may depend on its own address, at any distance,
because both the id and the frame are functions of the tile alone.

### Tile classes

Art may key on the id, but the id is unstructured. A **tile class** is the structured alternative: a
colouring by a group homomorphism `φ: Γ → Z/n` that kills the stabiliser, so it descends to tiles, and
under which adjacent tiles never agree. The available `n` is fixed by the abelianisation:

| generators | `φ(g)` order | classes |
|---|---|---|
| vertex rotations, `m = p/2` (e.g. `{8,3}` m=4) | `q` | `q` — three for Circle Limit III, a proper 3-colouring |
| edge half-turns, `m = p` | divides 2, and `q·φ(g) = 0` | 2 when `q` is even, 1 when odd |

The modulus is verified rather than assumed: the tile graph is walked with exact ids and every pair of
routes to one tile must agree, or it falls back to a single class.

### Which `frameSymmetry` values exist

Only `m = p` and `m = p/2`. For `m = p` the generators are half-turns about edge midpoints, one per
edge. For `m < p` they are rotations about the `m` vertices whose index is a multiple of `p/m`, two per
vertex — reaching `2m` of the `p` edges. Covering the plane needs `2m ≥ p`, and `m | p` with `m < p`
forces `m = p/2` exactly. Smaller values are rejected at construction: `{8,3}` with `m = 2` reaches
edges 0, 1, 4 and 5 only, and a view that holds 17 tiles would return 5.

### Escher's colours

Around an octagon centre in *Circle Limit III* the four fish alternate green–orange, so the colouring is
only `C₂` while the shape is `C₄`. Such a tile draws perfectly stably, but it would not reassemble into
Escher's pattern: which phase a given octagon shows would follow its canonical frame, which is fixed by
an arithmetic tie-break rather than by anything about the picture, so neighbouring octagons would
alternate in unrelated senses. The four fish in a tile therefore share a colour and the variety comes
from the tile class.

<details>
<summary>What the 2011 code did, and how badly it failed</summary>

Its projection was three unrolled ~40-term polynomials. Scrolling to the far end of the dungeon data
means choosing an offset that cancels the point — at which stage every term is about `1.9 × 10¹⁶` and
they must cancel to `1`. Measured against 60-digit arithmetic, the point that belongs at the centre of
the disk lands on the **boundary**: 310 pixels wrong on a 620-pixel canvas. The matrix form is exact
on the same input.

Two more failures in the same code, both silent:

- its half-plane → local conversion cancels twice near the half-plane basepoint and returns *exactly
  zero*;
- its local → half-plane conversion divides by zero at `y ≳ 10⁴`, and the dungeon data reaches
  `11711.92`. In Java that yields `Infinity` rather than an exception.

All three are fixed here, and each has a regression test that fails against the original.
</details>

<details>
<summary>The ceilings, for completeness</summary>

These apply to a SINGLE patch — the non-atlas mode. An anchored atlas has no such ceiling, because it
never forms the quantities below.

Even with matrices, a single patch in double precision runs out eventually:

- entries are `cosh(d/2)`, which overflows at about `d = 1420`;
- *applying* a transform squares the denominator, so it overflows earlier, at about `d = 710`.

Both are past anything a map can contain (`e^710`), and the dungeon's extreme is `20`. They are
documented and tested rather than worked around, because the workaround would cost two divisions per
point in the innermost loop.
</details>

---

## 7. Deliberate approximations

Everything here is a choice, not an oversight.

**Zoom is a projective magnification**, not a hyperbolic motion. See §3.

**Short edges are drawn as straight chords.** An arc is used only when its sagitta — how far it
departs from its chord — exceeds a quarter of a pixel. This is resolution-correct. The 2011 code used
a fixed threshold in disk units, which is zoom-independent and therefore visibly wrong when zoomed
in: at the dungeon's default zoom it drew 93-pixel arcs as straight lines.

**Text below a few pixels is skipped**, since it would be illegible and there is an unbounded amount
of it further out.

**Horocyclic tile edges are clipped as short polylines.** A horocycle is very flat across one cell,
so this is below a pixel at any zoom, and it avoids solving for boundary tangency on screen.

**The Escher tile art is a fit, and the seams are real.** The tiling is exact; the art is not.
Escher's woodcut is hand-drawn, and the 2012 tracing of it was replicated with an admittedly
approximate group — its author wrote that "some fish don't line up in orientation or color" and that
he gave up a few layers out. The tile here is re-anchored from the tracing's 3-fold centre onto an
octagon centre and symmetrised to exact C₄, but it does not meet the octagon boundary perfectly. The
demo offers a no-clip toggle, which trades hard cuts for soft overlaps.

---

## 8. Sources

- H. S. M. Coxeter, "The Non-Euclidean Symmetry of Escher's Picture *Circle Limit III*",
  *Leonardo* **12** (1979) 19–25.
- H. S. M. Coxeter, "The Trigonometry of Escher's Woodcut *Circle Limit III*",
  *Mathematical Intelligencer* **18**(4) (1996) 42–46.
- H. S. M. Coxeter, "The trigonometry of hyperbolic tessellations", *Canad. Math. Bull.* **40** (1997)
  — the `{p,q}` metric relations.
- Douglas Dunham, "More '*Circle Limit III*' Patterns", Bridges 2006; and his Math Horizons article.
- Wikipedia: *Poincaré disk model*, *Poincaré half-plane model*, *Hyperboloid model*, *SU(1,1)*,
  *Circle Limit III*, *Alternated octagonal tiling*, *Binary tiling*.

Every formula above was checked numerically; the full ledger, including what was verified *correct*,
is in [`notes/math-audit.md`](../notes/math-audit.md). Items that could not be confirmed from primary
sources are listed in [`notes/open-questions.md`](../notes/open-questions.md).
