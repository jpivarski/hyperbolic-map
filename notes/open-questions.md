# Open questions and unproven items

Things that are genuinely unresolved. Kept separate from `math-audit.md`, which records only what has
been settled.

## Unconfirmed from the literature

Recorded so nobody re-spends the effort assuming it is settled.

1. **"Circle Limit III revisited"** — I could not find any Coxeter or Dunham paper with this title.
   Probably a conflation with the 1996 *Mathematical Intelligencer* paper (which does revisit the 1979
   *Leonardo* one) or with Dunham's Bridges 2006/2007 pair.
2. **Which of the two order-3 vertex classes carries noses and which carries left fins.** Sources
   confirm both classes exist and their orders, and Dunham confirms the `(4,3,3)` counts, but I did not
   find the pairing stated explicitly. The assignment used in `escher-circle-limit-iii.md` (noses at the
   white-curve crossings, left fins at the "triangle" centers) is a reasoned inference from the spine
   running nose-to-tail. It affects only which vertex class we call "A" — the two choices give the two
   mirror-image chiralities of the pattern, both valid.
3. **Primary text of Coxeter 1996 and 1997 and the Dunham Bridges PDFs.** Inaccessible (403, or
   scanned-binary). Everything attributed to them is via Wikipedia, bendwavy.org's transcription of
   Coxeter 1997, Dunham's HTML Math Horizons paper, and independent numerical derivation. The numbers
   all cross-check, but the citations are second-hand.
4. **A standard name for the `(x, y, w)` parametrization.** None found. It is common as an
   implementation detail but appears to be unnamed. The docs call it what it is — SU(1,1) spinor
   coordinates / normalized homogeneous coordinates on the disk — rather than inventing a term.

## Deferred decisions

- **Minimal enclosing cap** for per-drawable culling. Currently "any vertex as center, max distance as
  radius", which is correct by the triangle inequality but loose. Only worth improving if profiling
  shows the false-positive rate matters.
- **A BVH over the Minkowski caps.** 38,640 flat cap tests are ~0.2 ms, so not worth it yet. Design
  leaves room (`scene.js` can own an optional index) but it is explicitly not in v1. Revisit above
  ~10⁶ drawables.
- ~~**`{p,q}` LOD semantics.**~~ **Closed 2026-08-07.** `visibleFrom`/`visibleTo` were parsed and
  stored but never read by the renderer, so the reinterpretation was never in force and there was
  nothing to compare. The fields are removed. Zoom-gated LOD for *single-patch* mode is therefore an
  unimplemented feature, not a subtly-different one; if it is ever wanted, design it fresh. Atlas mode
  has a working per-tile mechanism already (`lod`/`lodPx`).
- ~~**`radiusBasis`.**~~ **Closed 2026-08-07.** The option is removed; the disk is always sized by
  `min(width, height)` so it always fits. Sizing by width on both axes only ever clipped the disk on a
  portrait canvas, which is not a behavior anyone would choose deliberately.


## Truncation-boundary flicker at the rim

Separate from the ceiling, and smaller. When the walk hits `maxTiles`, which tile is the last one
admitted is decided by BFS order, and an infinitesimal change to the view can swap it. The affected
tiles are the farthest ones, crushed against the rim, so the visible effect is tiny: the sweep sees
these as a worst-cell difference under 15 with a mean around 0.006, i.e. one downsampled cell moving
slightly. It is why a handful of path-dependence findings appear below the precision ceiling.

The walk gathers twice the budget and then keeps the NEAREST `maxTiles` of them, which is the stable
tie-break and removes most of it. What remains is the boundary of the gather itself, which is still BFS
order; it has not been observed to matter.

## The cost of naming tiles globally

**Measured, 2026-08-08.** A tile's id is an exact integer name, and any correct global name needs
`Omega(d)` bits — there are exponentially many tiles within distance `d`. So naming is not free, and the
cost has a particular shape:

| what | measured on the Escher atlas, `{8,3}` m=4, 200 tiles, 560 px |
|---|---|
| steady-state frame | 16.4 ms median; **197 frames in 200 do zero ring multiplies** |
| first frame of all | 250 ms — every visible tile is named at once |
| first frame past a tile boundary into unexplored ground | ~130 ms, ~1,800 edges at ~117 ring multiplies each |
| panning back over ground already walked | free |
| id text | ~12 characters per tile crossed |
| a greedy 2,000-tile walk | 1.9 s, 142 MB peak (5,000 tiles: 11.7 s, 520 MB) |

Four things could reduce it. The first has since been **done**; the rest are open, in increasing order
of effort:

0. ~~**Faster ring arithmetic.**~~ **Closed 2026-08-08.** Coefficients are now held as Numbers while
   they fit the exactly-integral range of a double and promoted to BigInt only when they stop fitting.
   Naming got **2.4x faster**, the first frame of `docs/escher.html` went 101-125 ms → 46-59 ms and a
   naming frame mid-pan 42.3 → 19.3 ms median, with tile ids byte-identical and ring-multiply counts
   unchanged. Numbers, method and the exactness argument: `notes/performance.md` and
   `notes/math-audit.md`. **Also closed: micro-optimizing the BigInt representation itself is a dead
   end** — hoisting the scratch buffer and skipping the polynomial's zero coefficients measured no
   faster at all. Do not re-attempt that one.
1. **Cheaper canonicalization.** The 117 divides as 27 for `F_parent . G_g`, 9 for the id vector, and
   `27(m-1)` to canonicalize, so canonicalization dominates and grows with `m`. Lex-min over the `m`
   images of `v_M` rather than over matrices would make it `9m + 27` — a large win for `{12,3}`. It
   renames every tile, so it is not a change to make casually, and the golden-id fixture in
   `test/tiling.test.mjs` now exists precisely so that such a rename cannot happen quietly.
2. **Amortising the burst.** The spike is entirely "tiles never seen before, all at once". Naming a
   budget of new tiles per frame, or warming the frontier during idle time, would spread it. This is
   now the largest remaining win, because it attacks the shape of the cost rather than its constant.
3. **A smaller name.** The matrix encoding spends ~78 bits per tile step where the information-theoretic
   floor is ~3. A shortlex normal form over the generators would approach the floor and would share
   prefixes between tiles, making the store `O(N)` rather than `O(N * d)` — at the cost of building and
   trusting an automaton per `{p,q}`.

The store is bounded meanwhile (`NODE_FLOOR`, `ID_CHAR_BUDGET` in `tiling.js`), so memory is linear in
distance rather than quadratic, and eviction costs only recomputation.

The table above is from 2026-08-07 and its two naming rows are now roughly halved; the shape it
describes — a burst on new ground, free on old — is unchanged, which is the part worth keeping.
