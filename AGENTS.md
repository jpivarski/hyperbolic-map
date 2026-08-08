# Notes for agents working in this repository

This project is a revival of a 2011–2012 hyperbolic-plane map viewer. Most of the hard-won knowledge
is **not** obvious from the code, so it lives in [`notes/`](notes/). Read the notes before changing
anything mathematical.

## Start here

1. **[`notes/log.md`](notes/log.md)** — append-only chronological record of what was implemented and
   *why*. Read the last few entries to see where work stopped.
2. **[`notes/math-audit.md`](notes/math-audit.md)** — the single most important file. Every formula in
   the original code and every formula in this library, with its verification status. **It records
   what was verified *correct* as well as what was broken**, specifically so that working code does
   not get "fixed" by a later pass.
3. **[`notes/open-questions.md`](notes/open-questions.md)** — what is unresolved or unproven.

## House rules

- **Append to `notes/log.md` on every substantive change.** One entry per change: what, why,
  what was rejected and why, what was measured, what is left. Never rewrite or reorder past entries.
- **Keep the topic notes current** when you change the thing they describe. A stale note is worse
  than no note.
- **Do not "correct" anything marked verified-correct in `notes/math-audit.md`** without first
  reproducing the verification and recording the new result there. Several parts of the original code
  look wrong and are not.
- **Never commit `OLD/`.** It held two archived disk images and the original 2011-2012 repo, and it
  is not redistributable. It has been deleted from the working tree. Note there is **no `.gitignore`
  rule** stopping it coming back -- if you ever restore it locally, check `git status` before staging.
  Nothing in this repository depends on it: the last code that did was removed in the PR #2 cleanup.
- **The demos are not regenerated from sources.** The scripts that built `docs/*.json` from the 2011
  databases and from the Escher raster were removed in the PR #2 cleanup; the committed JSON under
  `docs/` is the artifact. Do not try to rebuild it -- edit it, or write a new generator.
- **Before quoting any performance number, check CPU and GPU load** immediately before and after the
  measurement, and record both alongside the result. This machine is often busy with unrelated work.
  If it is busy, say so and defer the measurement rather than reporting a misleading figure.
- **No global software installs.** Temporary or local installs only. `node`, `npm` and `python3` are
  already available.
- The library has **zero runtime dependencies** and must stay that way. `dev/check-bundle.mjs`
  enforces the source constraints that let `dev/build.mjs` work without a bundler — run
  `npm run check` after touching module structure.
- **`dev/` is maintenance scripting, not shipped code**: the bundler and its style checker, the two
  mathematical audits (`audit_atlas_math.py` needs `sympy`; `audit_atlas_numeric.py` needs `mpmath`
  and is fed by `node dev/emit_atlas_samples.mjs > build/atlas-samples.json`), `capture_server.py`
  for exact canvas-pixel diffs, and `md_to_html.py` (needs `mistune`), which made `docs/index.html`
  out of the README once and is **not** part of any build — that HTML is the main copy now. Re-run
  both audits after changing anything in `src/core/` or `src/data/atlas/`. [`tools/`](tools/) is the
  separate, USER-facing directory: the SVG conversion pair, which has no dependencies at all.
- **`docs/index.html` is the documentation**, hand-edited HTML rather than generated from anything.
  `README.md` is the landing page and links to it. Do not move reference material back into the
  README: there is one copy of each fact, deliberately.

## Notes index

| file | contents |
|---|---|
| [`log.md`](notes/log.md) | append-only chronological implementation record |
| [`math-audit.md`](notes/math-audit.md) | every formula, its verification status, and the numbers |
| [`canvas-testing.md`](notes/canvas-testing.md) | why canvas pixels are not deterministic across draws |
| [`su11-core.md`](notes/su11-core.md) | the SU(1,1) representation and the projection kernel |
| [`tilings.md`](notes/tilings.md) | `{p,q}` and binary tiling formulas, generators, tile keys |
| [`escher-circle-limit-iii.md`](notes/escher-circle-limit-iii.md) | the `{8,3}`/`433` derivation and the art fit |
| [`data-extraction.md`](notes/data-extraction.md) | the BabuDB format and the v2 JSON schema |
| [`performance.md`](notes/performance.md) | baselines, hotspots, and what each optimization bought |
| [`open-questions.md`](notes/open-questions.md) | unresolved and unproven items |
