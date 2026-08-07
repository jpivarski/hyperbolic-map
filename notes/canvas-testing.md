# Testing against canvas pixels

Read this before writing any golden-image or pixel-diff test. Every automated check in
`docs/demo/diagnostic-checks.js`, `docs/demo/compound-scroll.js`, `bench/sweep.js` and
`bench/stress.html` is shaped by what is below.

## Canvas pixels are not deterministic across repeated draws

Rendering the same scene into the **same** canvas element repeatedly gives three different images:

```
fresh canvas each time :  b761d1c7  b761d1c7  b761d1c7  b761d1c7
reusing one canvas     :  b761d1c7  76574d42  a0cc7439  a0cc7439
```

The renderer is not at fault: recording every 2-D context call shows **617,460 calls, byte-identical**
between runs. What changes is Chrome's rasterizer — a canvas starts out software-rasterized and gets
promoted to GPU acceleration after a few draws, and the two paths antialias differently.

Consequences:

* For pixel-exact comparison, draw into a **brand-new canvas** each time. Re-reading one canvas gave
  28,841 spurious channel differences in check 2 of the diagnostics before this was understood.
* Otherwise compare with a tolerance, or on a downsampled signature, and do not read anything into a
  few percent of differing pixels along shape edges — that is antialiasing, not geometry.
* Always run a **control**: render the *same* state twice and require the difference to be exactly
  zero. If the control is nonzero the measurement is unreliable and the real comparison means nothing.
  Check 2 does this and skips rather than reporting a false pass.

## Two more traps in the same family

* **`requestAnimationFrame` throttles to about 1 Hz in a backgrounded tab**, so a settle loop built on
  rAF hangs when the driver is not looking at the page. `settle()` in `diagnostic-checks.js` uses
  `setTimeout` for this reason.
* **Long single calls hit the DevTools protocol timeout.** The diagnostic suite therefore exposes each
  check separately on `window.diagChecks` so a driver can run them one at a time.

## Provenance

The 2011–2012 predecessor implementation, its architecture, its semantic traps and a 20-row inventory
of its defects were recorded here through PR #2. That code has been deleted and the compatibility
layer that referenced it was removed afterwards, so the analysis no longer describes anything in the
tree; it is in git history if it is ever wanted. What survived the removal, because it is about
*testing* rather than about that code, is everything above. The formulas themselves — including which
of them were verified **correct** — remain in [`math-audit.md`](math-audit.md).
