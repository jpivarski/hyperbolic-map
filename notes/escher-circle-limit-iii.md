# Escher's *Circle Limit III* and the tiled-Escher demo

## What the tiling actually is

**`{8,3}` — regular octagons, three per vertex.** Sourced from Dunham ("uses the `{8,3}` tessellation
as the basis"; the Circle Limit symmetry groups "were all subgroups of either `[6,4]` or `[8,3]`") and
Coxeter 1979/1996.

> Two web sources state "`{8,3}` — four octagons meeting at every vertex". That is wrong by definition
> of `{8,3}`. Do not propagate it.

It is **not** `{6,4}` — that is *Circle Limit I*, and `{6,4}` is definitively excluded: the `(2,4,6)`
triangle group is arithmetic over `ℚ(√3)` while `(3,3,4)` is over `ℚ(√2)`, so they are not even
commensurable and no finite-index embedding exists.

Escher's construction connects **alternate** vertices of each octagon with slightly curved arcs,
producing the *alternated octagonal* (tritetragonal) tiling `{(4,3,3)}`, vertex configuration `(3.4)³`.
The word "alternate" is load-bearing — see the frame section below.

## The fish

- Symmetry group **`433`** in Conway orbifold notation: chiral, rotations only, the `(3,3,4)` triangle
  rotation group. **Not** `*433` — "the white curves of the drawing are not axes of reflection
  symmetry". Diagnostic: the angle at the back of the right fin is 90° (four fins meet), at the much
  smaller left fin 120° (three meet).
- **One fish is a fundamental domain. 4 fish per octagon**, by area:
  `{8,3}` octagon `= 6π − 8·(2π/3) = 2π/3`; `433` domain `= 2 × π/12 = π/6`; ratio exactly 4.
- Dunham's family index for Escher's is `(4,3,3)`: four right fins, three left fins, three noses meet.
- Rotation centres: **order 4 at octagon centres** (right fins); the two classes of `{8,3}` vertices
  carry the two order-3 motifs (noses at the white-curve crossings, left fins at the "triangle"
  centres — this pairing is a reasoned inference, not something found stated explicitly).
- `433` is the **unique index-2 subgroup of `832`**. Proof: a homomorphism `832 → ℤ/2` must kill the
  3-fold generator (odd order), and the relation `R₈R₃R₂ = 1` then forces `φ(R₈) = φ(R₂)`; the only
  nontrivial choice has kernel with cone points `4,3,3`.
- **Coxeter's angle.** The white "spines" are **hypercycles, not geodesics** — Escher believed they were
  straight. They meet the boundary circle at `cos ω = (2^{1/4} − 2^{−1/4})/2 = 0.174155350`,
  `ω = 79.970° = 79° 58′`. (Equivalently `cos ω = sqrt((3√2 − 4)/8)`; the two forms are algebraically
  identical.)

## The decisive constraint for the demo

Repeating identical data in every tile makes the pattern invariant under the walk group `G` **iff the
tile art is invariant under `Stab_G(tile)`**. For `G = 433` on `{8,3}`:

- `R₈ ∉ 433` (there is no order-8 cone point), so `Stab_{433}(octagon) = ⟨R₈²⟩ = **C₄**`.
  Verified numerically: enumerating `433` words that fix the central octagon, the realised screen
  rotations are exactly `{0, 2, 4, 6}·(2π/8)` — never an odd multiple.
- So **the tile art must be 4-fold symmetric, not 8-fold.** Eight-fold art would give Dunham's
  `(8,3,3)` pattern, a different member of the family, not Escher's.

`433` acts transitively on the octagons: `H = 433` has index 2 in `G = 832`, `S = Stab_G = C₈`, and
`S ⊄ H`, so `HS = G` and there is a single double coset.

### Generators — the trap

Both "obvious" generators are **wrong** here:

- ✗ `R₈` (rotate `2π/8` about the tile centre) — not in `433`; flips the vertex parity.
- ✗ the half-turn about a shared edge midpoint — `433` has **no** order-2 cone points at all. This is
  the *default* general-purpose `{p,q}` generator, so it is the easy mistake.

Correct minimal generating set: `R₄` (rotation `2π/4` about the tile centre, the tile's own symmetry)
and `R₃(V, ±1)` (rotation `±2π/3` about a **class-A** vertex). Any two of the three rotations of a
`(p,q,r)` rotation group generate it.

All 8 edge-neighbours are reachable: each vertex has 3 octagons around it, so `R₃(V,±1)` gives the two
octagons across the two edges incident at `V`; with 4 class-A vertices that is `4 × 2 = 8`. Verified —
the edge→(vertex, sense) map is `{0:(0,+), 1:(0,−), 2:(2,+), 3:(2,−), 4:(4,+), 5:(4,−), 6:(6,+), 7:(6,−)}`.

### Fixing the frames globally

`Stab_{832}(V) = C₃ ⊂ 433`, so the single `832`-orbit of vertices splits into exactly **two** `433`
orbits, and `V₁ = R₈·V₀ ∉ 433·V₀`. So the two classes **alternate** around each octagon:
`{V₀,V₂,V₄,V₆}` versus `{V₁,V₃,V₅,V₇}`. This is precisely Escher's "connect alternate vertices", and
precisely why the tiling is called *alternated*.

Globally consistent because the `{8,3}` edge graph is **bipartite** (planar, all faces even 8-cycles).
Pick the colouring once — two ways, mirror images of each other, giving the two chiralities of the
pattern — and every octagon's `C₄` frame is determined. **No extra data stored per tile.**

## Why the existing 2012 data cannot just be reused

`OLD/hyperbolic-storage-space/svgtools/examples/escher.py` replicated a traced 6-fish block by Möbius
translations of local length **1.07** in nine directions spaced `2π/9`, with ad-hoc rotations and colour
permutations, under the author's own comment:

> "The following transformations are approximate; some fish don't line up in orientation or color.
> It turns out that this Escher painting is more mathematically complicated than I had thought!"

and in the blog post: *"I made some mistakes and gave up adding fishes a few layers from the center."*

1.07 matches no regular `{9,q}` tiling (`{9,4}` wants 0.876, `{9,5}` wants 1.249), and `{8,3}`'s true
centre-to-centre local distance is `sinh ψ = 0.840896`.

**Measured symmetry of the 38,640 stored polygons** (centroids projected to the disk, tested for
rotational symmetry about the origin): order 3 dominates — 34 % of inner centroids match under 120°
versus 3–5 % for orders 2, 4, 5, 6, 7, 8, 10, 11, 12. So the traced art is centred on a **`{8,3}`
vertex** (a 3-fold point at disk radius 0.405616), *not* an octagon centre. The fit must re-anchor it.

> **The scripts named below no longer exist.** `fit_escher_tile.py` and its replacement
> `trace_escher_tile.py`, and the raster they read, were removed in the PR #2 cleanup: the demos
> are not regenerated from sources any more, and the committed `docs/escher-atlas.json` is the
> artefact. Both scripts are in git history. What follows is kept as the record of how the tile
> was derived and why the first attempt was wrong.

## Fit procedure (`tools/fit_escher_tile.py`)

1. Read the hand-traced fundamental block `svgtools/examples/escher_circle_limit_3_step2.svg` — 6 groups
   of 20/26/20/26/20/26 paths, consistent with the measured 3-fold structure — converting to disk
   coordinates via its `PoincareDisk` element (`cx = 299.67141723633`, `cy = 301.22943115234`,
   `rx = 295.49002075195`).
2. **Re-anchor** from the traced 3-fold vertex onto an octagon centre.
3. Least-squares fit a Möbius adjustment carrying the fish contact points onto the exact `{8,3}` 4-fold
   and 3-fold centres.
4. Symmetrise to exact `C₄`.
5. Emit `docs/escher-atlas.json` — 4 fish in tile-local coordinates.
6. **Report the residual RMS boundary mismatch** and quote it in `docs/MATH.md` as a documented
   approximation. Escher's original is hand-drawn; a perfect fit is not achievable and pretending
   otherwise would be dishonest.

Fallback if the residual is visually unacceptable: set `clip: 'never'` for that demo (overlaps blur
rather than cut) and say so.

## Sources

- Coxeter, "Crystal symmetry and its generalizations", *Trans. Royal Soc. Canada* **51** (1957) — the
  figure Escher saw.
- Coxeter, "The Non-Euclidean Symmetry of Escher's Picture *Circle Limit III*", *Leonardo* **12** (1979) 19–25.
- Coxeter, "The Trigonometry of Escher's Woodcut *Circle Limit III*", *Math. Intelligencer* **18**(4) (1996) 42–46.
- Coxeter, "The trigonometry of hyperbolic tessellations", *Canad. Math. Bull.* **40** (1997) — source of the `{p,q}` metric formulas.
- Dunham, "More '*Circle Limit III*' Patterns", Bridges 2006; "A '*Circle Limit III*' Calculation", Bridges 2007; Math Horizons article.
- Wikipedia: *Circle Limit III*, *Alternated octagonal tiling*, *Binary tiling*.

Could not be confirmed: a paper titled "Circle Limit III revisited" (no such Coxeter or Dunham title
found — likely the 1996 *Intelligencer* paper, which revisits the 1979 one). Primary text of Coxeter
1996/1997 and the Dunham Bridges PDFs were inaccessible (403 / scanned binary); everything above is via
Wikipedia, bendwavy.org's transcription of Coxeter 1997, Dunham's HTML Math Horizons paper, and my own
independent numerical derivations.

## Retraced from the raster, exactly C4-symmetric (2026-08-06)

The tile cut by `tools/fit_escher_tile.py` had to be replaced, and the reason is worth keeping because
it is not the reason I expected.

**It had no 4-fold structure at all.** The library's symmetry check scores it `Infinity`: not one of its
90 shapes has a C4 partner. Its own metadata says why — the cutter's bearing scan "does NOT
discriminate" (spread 1.06x), so the octagon centre was *defaulted* to bearing 0 rather than located.

**And no cut of the traced vector art could have worked.** Four independently traced copies of one fish
have different vertex counts, so they cannot map onto one another exactly. Measured at the vector art's
own known 3-fold centre, the exact check also returns `Infinity`. Symmetry has to be **constructed**,
not found: trace one wedge and repeat it by exact rotation.

**The vector art is also mis-scaled.** Using a validated centroid-matching metric (origin, m=3: 0.0097;
non-symmetries: 0.20-0.29), no 4-fold centre exists anywhere on the circle of radius chi. Its 3-fold
lattice sits at 1.85 where `{8,3}` predicts 1.7214 — about 4% of radial scale error. That is consistent
with the disk radius having been measured slightly wrong when the art was produced.

**The raster is not.** Fitting the disk radius by requiring the pattern to be invariant under the walk
group's own generator gives a sharp peak at **158.5 px** against a nominal image half-width of 157.5
(agreement 0.54, falling to 0.42 at +-8 px). So Escher's print really is at the `{8,3}` scale, and
`tools/trace_escher_tile.py` traces from it directly.

Fitted alignment, all by the same criterion:

| | |
|---|---|
| disk radius | 158.5 px |
| disk centre | (157.5, 157.0) |
| library -> raster rotation | -22.5 deg (the octagon's vertices sit at raster bearings 0, 45, 90, ...) |

Controls: rotating to the other vertex class scores 0.50 (it is also a genuine 3-fold point, so this is
expected), and rotating 20 degrees to where no vertex lies scores 0.42.

### Two classification attempts that failed

1. **Brightness threshold for the ink.** Swallowed the dark blue and dark red fish whole: of the 2,360
   dark pixels in the central region, 2,132 are saturated fish colour and only 228 are neutral outline.
   The tile came out with black holes where those fish should be.
2. **Local-median contrast.** Found the lines but broke them into dashes.

What works is a **black top-hat** — how much darker is this pixel than the closing of its neighbourhood
— which is the operator meant for thin dark structures and finds a 1 px outline on any background.

### Why the fish are not Escher's four colours

Because a 4-colouring that is not stabiliser-invariant is not a function of the tile. Around an octagon
centre the four fish alternate green-orange, so Escher's colouring is `C2` while the shape is `C4`;
C4 shapes in four colours score 0.36 on the symmetry check. The four fish in a tile therefore share a
colour, and variety comes from the tile class — `{8,3}` m=4 admits three classes, giving a proper
3-colouring of the octagons in which no two neighbours match, path-independent by construction.

### Result

Symmetry residual **3.9e-17** (was `Infinity`). Crossing a tile boundary changes **3 pixels**, identical
to an ordinary step of the same size (was a visible snap). At 6,114 hyperbolic units from the origin the
picture is indistinguishable from the origin view, with `max|V| = 1.000`.

The raster is 316 px across, so the outlines are approximate and the fish are simplified. What is exact
is the geometry and the symmetry.
