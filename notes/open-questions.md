# Open questions and unproven items

Things that are genuinely unresolved. Kept separate from `math-audit.md`, which records only what has
been settled.

## Unproven by design

### The canonical-word rule for regular-tiling tile keys

`src/data/atlas/tilekey.js` canonicalises a tile's word by a **greedy geometric parent rule**: from a
tile's frame, rank the neighbour centres by `(round(log⟨C,O⟩/qs), round(atan2(y,x)/qa))` and step to
the strictly-lower-ranked minimum.

This is a heuristic, not a theorem. It is the single largest design risk in the library.

- **Why it should work:** the rank is a strict total order under quantisation, so the parent chain is
  unique, acyclic and terminates at the root; the quantisation is *relative*, so it behaves the same at
  every distance; and ties occur only across exact symmetry walls, where the angular tie-break resolves
  them identically every time.
- **Why it might not:** "should be a strict total order under quantisation" is exactly the kind of claim
  that fails on a measure-zero set that turns out not to be measure zero in floating point.
- **The guard:** a property test enumerating 50,000 tiles and asserting that word↔tile is a bijection.
  If that ever fails, do not patch the heuristic — switch schemes.
- **The rigorous alternative:** Coxeter shortlex normal form. Coxeter groups are automatic, so a finite
  DFA recognises exactly the canonical coset representatives of `⟨s₁,s₂⟩` (the tile stabiliser) and BFS
  over the DFA enumerates tiles with no duplicates and provably unique keys. Costs a per-`{p,q}` DFA
  construction and variable-length string keys. Keep the `Tiling` interface swappable so this can be
  dropped in without touching the atlas.

## Unconfirmed from the literature

Recorded so nobody re-spends the effort assuming it is settled.

1. **"Circle Limit III revisited"** — I could not find any Coxeter or Dunham paper with this title.
   Probably a conflation with the 1996 *Mathematical Intelligencer* paper (which does revisit the 1979
   *Leonardo* one) or with Dunham's Bridges 2006/2007 pair.
2. **Which of the two order-3 vertex classes carries noses and which carries left fins.** Sources
   confirm both classes exist and their orders, and Dunham confirms the `(4,3,3)` counts, but I did not
   find the pairing stated explicitly. The assignment used in `escher-circle-limit-iii.md` (noses at the
   white-curve crossings, left fins at the "triangle" centres) is a reasoned inference from the spine
   running nose-to-tail. It affects only which vertex class we call "A" — the two choices give the two
   mirror-image chiralities of the pattern, both valid.
3. **Primary text of Coxeter 1996 and 1997 and the Dunham Bridges PDFs.** Inaccessible (403, or
   scanned-binary). Everything attributed to them is via Wikipedia, bendwavy.org's transcription of
   Coxeter 1997, Dunham's HTML Math Horizons paper, and independent numerical derivation. The numbers
   all cross-check, but the citations are second-hand.
4. **A standard name for the `(x, y, w)` parametrisation.** None found. It is common as an
   implementation detail but appears to be unnamed. The docs call it what it is — SU(1,1) spinor
   coordinates / normalised homogeneous coordinates on the disk — rather than inventing a term.

## Deferred decisions

- **Minimal enclosing cap** for per-drawable culling. Currently "any vertex as centre, max distance as
  radius", which is correct by the triangle inequality but loose. Only worth improving if profiling
  shows the false-positive rate matters.
- **A BVH over the Minkowski caps.** 38,640 flat cap tests are ~0.2 ms, so not worth it yet. Design
  leaves room (`scene.js` can own an optional index) but it is explicitly not in v1. Revisit above
  ~10⁶ drawables.
- **`{p,q}` LOD semantics.** The 2011 `minRadius`/`maxRadius` tested whether a drawable's *tile* was
  inside a circle, not the drawable itself. The v2 `visibleFrom`/`visibleTo` reinterprets these as
  thresholds on the drawable's own projected position. Slightly different behaviour; escher is the only
  dataset that uses it (`maxRadius = 0.75` on some records). Worth an eyeball comparison against the
  original rather than assuming equivalence.
- **`radiusBasis`.** The original sized the disk by `canvas.width` on both axes, so on a non-square
  canvas the disk overflows vertically. Defaulting to `min(width, height)` is a **behaviour change, not
  a bug fix**; the legacy behaviour stays available. Confirm which the examples should use.


## The far-field precision ceiling, and the floating origin that would remove it

**Measured, 2026-08-06.** The view is a single SU(1,1) matrix relative to the data origin, so its
entries grow like `cosh(d/2)`. Consequences, all measured rather than estimated:

| distance | behaviour |
|---|---|
| d <= 28 | the visible tile set is a pure function of the view; stable under a one-ULP or renormalising perturbation across 24 bearings |
| d = 30 | first failures: 2 bearings of 24 |
| d = 34 | 13 of 24 |
| d ~ 37 | entries reach 1e8, one ULP of `|a|^2` exceeds the spacing between adjacent tile centres |

Why it matters in practice rather than in principle: the Escher atlas is unbounded, so a random pan
**reaches d ~ 39 within a couple of minutes of dragging**. Past the ceiling the picture starts to
depend on the route taken rather than only on the view -- `setMatrix` renormalises, shifting the
matrix by about one ULP, and that is enough to change which tiles the walk finds. Confirmed by
comparing against a from-scratch render with the caches cleared: the reset frame always matched
ground truth exactly, and it was the gestured frame that deviated.

`vp.stats.viewDistance` now exposes this so an application can see it coming.

### The fix: a floating origin

Store the view relative to the tile containing the view centre rather than to the data origin.

    originKey   the tile the camera is in
    viewLocal   the view matrix expressed in THAT tile's frame -- always O(1) entries

Then `net = viewLocal * frameRelativeTo(originKey, key)`, and both factors stay small for every tile
actually on screen, so precision no longer depends on where the camera has wandered. Re-anchor
whenever `locate()` reports a different tile: fold the old origin's frame into the new one, which is
a single composition of two O(1)-ish matrices.

Half the machinery already exists: `RegularTiling.visible` already conjugates by the starting tile's
frame for deduplication, for exactly this reason. What is missing is expressing tile keys relative to
an origin and re-anchoring the viewport.

Deliberately not attempted in this session: it changes atlas addressing, which is load-bearing for
both tiled demos, and it was 3 a.m. The measured ceiling is documented and tested instead, so the
limit is known rather than lurking.

## Truncation-boundary flicker at the rim

Separate from the ceiling, and smaller. When the walk hits `maxTiles`, which tile is the last one
admitted is decided by BFS order, and an infinitesimal change to the view can swap it. The affected
tiles are the farthest ones, crushed against the rim, so the visible effect is tiny: the sweep sees
these as a worst-cell difference under 15 with a mean around 0.006, i.e. one downsampled cell moving
slightly. It is why a handful of path-dependence findings appear below the precision ceiling.

A stable tie-break -- ordering the frontier by exact distance and admitting in that order, as
`BinaryTiling.visible` now does -- would remove it. `RegularTiling.visible` still admits in BFS
order.
