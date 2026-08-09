// Interaction sweep for drawing correctness. Injected into any docs/ example page.
//
// The user's report was: "the initial drawing is correct, but after some scrolling, zooming,
// rotating, etc., the polygons disappear". So the sweep drives real pointer, wheel and rim-rotate
// gestures and after every single step asks two questions:
//
//   1. Is anything actually on the disk?  (a blank frame is the reported symptom)
//   2. Is the picture the same as it would be if this view had been reached directly?
//
// Question 2 is PATH INDEPENDENCE, and it is the sharp one. The picture is a pure function of the
// view, so any difference between "reached by gesturing" and "constructed fresh" is accumulated
// state -- a stale cache, a leaked transform, a survivor cap that never reset. Comparing against a
// freshly-set matrix catches those without needing to know what correct looks like.
//
// Images are compared on a downsampled signature, not exact pixels, because Chrome moves a canvas
// between software and GPU rasterization and the two antialias differently (notes/canvas-testing.md).
// Downsampling averages that away while still catching a missing polygon.

(function () {
  const N = 42;

  function canvasEl() {
    return document.querySelector("#map canvas") || document.querySelector("canvas");
  }

  function signature() {
    const c = canvasEl();
    const w = c.width;
    const h = c.height;
    const d = c.getContext("2d").getImageData(0, 0, w, h).data;
    const acc = new Float64Array(N * N * 3);
    const cnt = new Float64Array(N * N);
    for (let y = 0; y < h; y++) {
      const gy = Math.min(N - 1, Math.floor((y / h) * N));
      for (let x = 0; x < w; x++) {
        const gx = Math.min(N - 1, Math.floor((x / w) * N));
        const i = (y * w + x) * 4;
        const g = gy * N + gx;
        const a = d[i + 3] / 255; // composite on mid-gray so transparent != opaque
        acc[g * 3] += d[i] * a + 128 * (1 - a);
        acc[g * 3 + 1] += d[i + 1] * a + 128 * (1 - a);
        acc[g * 3 + 2] += d[i + 2] * a + 128 * (1 - a);
        cnt[g]++;
      }
    }
    const out = new Array(N * N * 3);
    for (let g = 0; g < N * N; g++) {
      for (let k = 0; k < 3; k++) out[g * 3 + k] = acc[g * 3 + k] / cnt[g];
    }
    return out;
  }

  function compare(a, b) {
    let worst = 0;
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const d = Math.abs(a[i] - b[i]);
      if (d > worst) worst = d;
      sum += d;
    }
    return { worst: +worst.toFixed(2), mean: +(sum / a.length).toFixed(3) };
  }

  // How much of the disk is not the flat background? A blank disk is the reported failure, and it is
  // worth measuring directly rather than trusting a `drawn` counter -- those counted 1556 drawables
  // while the disk was empty, back when the tiles were landing outside the cull radius.
  function inkFraction(vp) {
    const c = canvasEl();
    const w = c.width;
    const h = c.height;
    const d = c.getContext("2d").getImageData(0, 0, w, h).data;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.35; // well inside the disk at every zoom these demos allow
    const hist = new Map();
    const pts = [];
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        const i = (y * w + x) * 4;
        const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
        hist.set(k, (hist.get(k) || 0) + 1);
        pts.push(k);
      }
    }
    let modeCount = 0;
    for (const v of hist.values()) if (v > modeCount) modeCount = v;
    return pts.length ? +(1 - modeCount / pts.length).toFixed(4) : 0;
  }

  // Deliberately not requestAnimationFrame. An automated run usually has the tab backgrounded, where
  // rAF is throttled to about 1 Hz and a sweep of a few hundred waits takes minutes instead of seconds.
  // Nothing here needs the compositor: the checks read the 2D context's backing store, which draw calls
  // update synchronously, and `settle` calls render() explicitly rather than waiting for the viewport's
  // own scheduled frame.
  const frame = () => new Promise((r) => setTimeout(r, 0));

  function pointer(type, x, y, extra) {
    const c = canvasEl();
    const rect = c.getBoundingClientRect();
    c.dispatchEvent(
      new PointerEvent(
        type,
        Object.assign(
          {
            pointerId: 1,
            pointerType: "mouse",
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
            clientX: rect.left + x,
            clientY: rect.top + y,
            bubbles: true,
            cancelable: true,
          },
          extra || {},
        ),
      ),
    );
  }

  async function drag(x0, y0, x1, y1, steps) {
    steps = steps || 6;
    pointer("pointerdown", x0, y0);
    await frame();
    for (let i = 1; i <= steps; i++) {
      pointer("pointermove", x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
      await frame();
    }
    pointer("pointerup", x1, y1);
    await frame();
  }

  async function wheel(x, y, deltaY, times) {
    const c = canvasEl();
    const rect = c.getBoundingClientRect();
    for (let i = 0; i < (times || 1); i++) {
      c.dispatchEvent(
        new WheelEvent("wheel", {
          clientX: rect.left + x,
          clientY: rect.top + y,
          deltaY,
          deltaMode: 0,
          bubbles: true,
          cancelable: true,
        }),
      );
      await frame();
    }
  }

  // Render repeatedly until a render requests nothing new -- a FIXPOINT, not a one-shot wait.
  //
  // Checking `pending` before rendering is not enough, and getting that wrong cost a false bug
  // report. The atlas discovers which tiles it needs inside `passes()`, i.e. during the render
  // itself: so pending is 0, we render, that render enqueues the tiles the new view needs, and the
  // signature is taken from a frame that is missing them. Comparing against a later, settled frame
  // then shows a difference that is nothing but load latency.
  //
  // Worth the care: the measured noise floor for two renders of a settled view is exactly 0, so any
  // nonzero difference is real and must not be spent on harness artifacts.
  async function settle(vp, maxRounds) {
    for (let i = 0; i < (maxRounds || 12); i++) {
      if (vp.sources && vp.sources.values) {
        for (const e of vp.sources.values()) {
          // `inFlight` is the last request's promise and is never cleared, so await it rather than
          // testing it for truthiness -- a truthiness loop would never exit after the first fetch.
          if (e.source && e.source.inFlight) await e.source.inFlight;
        }
      }
      vp.render();
      if (!vp.atlas || vp.atlas.pending.size === 0) return;
      await Promise.all([...vp.atlas.pending.values()]);
      await frame();
    }
  }

  // A deterministic pseudo-random sequence, so a failure can be replayed exactly.
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  window.__sweep = async function (opts) {
    opts = opts || {};
    const vp = window.viewport || window.vp;
    const steps = opts.steps || 24;
    const rand = rng(opts.seed || 12345);
    const c = canvasEl();
    const W = c.clientWidth || c.width;
    const H = c.clientHeight || c.height;
    const mid = [W / 2, H / 2];
    const findings = [];
    const trace = [];

    // Warm the canvas before measuring anything. Chrome starts a canvas on the software rasterizer
    // and promotes it to the GPU once it looks worth it; the two antialias differently, so the very
    // first gesture after a page load shifts every edge slightly. Measured: a fresh load reports a
    // difference of 11.35 on step 0 and exactly 0 on every step after, and a second sweep over the
    // same warmed page reports 0 throughout. That is a Chrome artifact, not a library bug, and
    // burning a finding on it every run would bury the real ones.
    await settle(vp);
    // Three round trips, not one: promotion needs a few paints, and a single warm gesture still
    // left a step-0 difference of 11.36.
    const warmFrom = vp.getCamera();
    for (let i = 0; i < 3; i++) {
      await drag(mid[0], mid[1], mid[0] + 25, mid[1] - 15, 4);
      await settle(vp);
      vp.setCamera(warmFrom);
      await settle(vp);
    }

    const baselineInk = inkFraction(vp);

    for (let step = 0; step < steps; step++) {
      const kind = ["drag", "drag", "wheel", "rim", "drag"][Math.floor(rand() * 5)];
      let what = kind;
      if (kind === "drag") {
        const a = rand() * Math.PI * 2;
        const b = rand() * Math.PI * 2;
        const R = Math.min(W, H) * 0.3;
        await drag(
          mid[0] + R * Math.cos(a) * rand(),
          mid[1] + R * Math.sin(a) * rand(),
          mid[0] + R * Math.cos(b),
          mid[1] + R * Math.sin(b),
        );
      } else if (kind === "wheel") {
        await wheel(mid[0], mid[1], rand() < 0.5 ? -120 : 120, 1 + Math.floor(rand() * 3));
      } else {
        // Grab the rim annulus, outside interactRadius, and rotate.
        const a = rand() * Math.PI * 2;
        const R = Math.min(W, H) * 0.48;
        await drag(mid[0] + R * Math.cos(a), mid[1] + R * Math.sin(a), mid[0] + R * Math.cos(a + 0.9), mid[1] + R * Math.sin(a + 0.9));
        what = "rim-rotate";
      }

      // Let any provider or tile request land, then render and measure in one task.
      await settle(vp);
      const sig = signature();
      const ink = inkFraction(vp);
      const stats = {
        drawables: vp.stats.drawables,
        survivors: vp.stats.survivors,
        drawn: vp.stats.drawn,
      };
      const m = vp.getCamera();


      // Path independence: re-set the very same matrix and re-render. Same view must give the same
      // picture, whatever route led here.
      vp.setCamera(m);
      await settle(vp);
      const sig2 = signature();
      let diff = compare(sig, sig2);
      const inkAfterReset = inkFraction(vp);

      // CONFIRM before reporting. A single comparison cannot distinguish "the picture depends on how
      // you got here" from "one of the two frames had not finished settling". Settle once more and
      // re-measure: if the two post-reset frames disagree with each other, the render was still in
      // motion and the original difference proves nothing.
      //
      // This is not hypothetical. Eight seeds run back to back on the escher atlas produced 30
      // findings up to 215/255, every one of which vanished under a careful manual replay -- the
      // frames were simply not settled when the signature was taken.
      if (diff.worst > (opts.tolerance || 4)) {
        await settle(vp);
        const sig3 = signature();
        const stability = compare(sig2, sig3);
        if (stability.worst > (opts.tolerance || 4)) {
          findings.push({ step, what, kind: "unsettled", diff, stability, stats });
        } else {
          const confirmed = compare(sig, sig3);
          // Beyond the measured float64 ceiling the picture legitimately stops being a function of
          // the view alone: the tile set is stable under a one-ULP or renormalizing perturbation
          // through d = 28, degrades from d = 30 and is thoroughly unstable by d = 34 (see the test
          // in test/tiling.test.mjs). An unbounded random pan reaches d ~ 39 within a couple of
          // minutes, so without this check the sweep reports a stream of impressive-looking findings
          // that are all just the documented limit. Report them, but as what they are.
          const far = vp.stats.viewDistance > 28;
          if (confirmed.worst > (opts.tolerance || 4) && far) {
            findings.push({ step, what, kind: "beyond-precision-ceiling", diff: confirmed,
                            viewDistance: +vp.stats.viewDistance.toFixed(1) });
          } else if (confirmed.worst > (opts.tolerance || 4)) {
            // Which of the two frames is the wrong one? Wipe the atlas caches and draw the same view
            // from nothing: that is the ground truth for this view, since no carried-over state can
            // reach it. Whichever frame disagrees with it is the one with the bug.
            let againstTruth = null;
            if (vp.atlas) {
              vp.atlas.cache.clear();
              // `frames` is gone: relative frames are recomputed each render now, so there is nothing
              // to stale. Only the tile DATA cache remains.
              await settle(vp);
              const truth = signature();
              againstTruth = { gestured: compare(sig, truth), reset: compare(sig3, truth) };
            }
            findings.push({ step, what, kind: "path-dependent", diff: confirmed, stats, ink,
                            inkAfterReset, againstTruth,
                            viewDistance: +vp.stats.viewDistance.toFixed(1) });
          }
          diff = confirmed;
        }
      }
      // A blank disk is only a BUG if re-setting the same view fills it back in. On its own it just
      // means the view has been panned past the edge of a finite dataset -- which is exactly what
      // happened on the single-patch Escher page, whose traced art gave up a few layers from the
      // center, and is the whole reason the atlas version replaced it. The first version of this
      // sweep reported twelve "blank" findings there, all of them the data honestly running out.
      if (ink < baselineInk * 0.15 && inkAfterReset > ink * 2 + 0.05) {
        findings.push({ step, what, kind: "blank-recovered-by-reset", ink, inkAfterReset, stats });
      }
      trace.push({ step, what, ink, drawn: stats.drawn, diff: diff.worst });
    }

    return { page: location.pathname, baselineInk, steps, findings, trace };
  };

  window.__shoot = async function (name) {
    const vp = window.viewport || window.vp;
    if (vp) vp.render();
    await fetch(`/__shot/${name}.png`, { method: "POST", body: canvasEl().toDataURL("image/png") });
  };
})();
