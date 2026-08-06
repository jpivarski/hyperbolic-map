// Compound-scroll stress: many gestures in many directions, short and long, checked after every step.
// NOT part of the library.
//
// The single-direction walks elsewhere are the easy case. What this drives is the awkward one: drag
// north, then south-east, then zoom in, then rotate, then a long haul west, then back — mixing short
// hops that stay inside one tile with long runs that cross hundreds, and reversing often enough that
// any accumulated state has to show up as a discrepancy.
//
// After every gesture it checks the invariants that must hold at all times:
//
//   * max|V| stays O(1)                     -- the anchoring is doing its job
//   * every relative frame stays finite     -- nothing has overflowed
//   * the disk has ink in it                -- content has not vanished
//   * nothing is drawn outside the disk     -- no wild placement
//   * the picture depends only on the view  -- re-setting the same camera reproduces it
//
// The last one is the sharp one, and it is measured against a FRESH canvas, because re-reading one
// canvas across renders is unreliable in Chrome (software/GPU promotion; see notes/legacy-decoded.md).

/* global window, document */

const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

async function settle(vp) {
  for (let i = 0; i < 30; i++) {
    vp.render();
    if (!vp.atlas || vp.atlas.pending.size === 0) break;
    await Promise.all([...vp.atlas.pending.values()]);
    await frame();
  }
  vp.render();
}

function driver(vp) {
  const canvas = vp.surface.canvas;
  const ev = (type, x, y, buttons) => {
    const r = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, pointerType: "mouse", button: 0,
      buttons: buttons === undefined ? 1 : buttons,
      clientX: r.left + x, clientY: r.top + y, bubbles: true, cancelable: true,
    }));
  };
  return {
    canvas,
    drag: async (x0, y0, x1, y1, steps) => {
      steps = steps || 5;
      ev("pointerdown", x0, y0);
      await frame();
      for (let i = 1; i <= steps; i++) {
        ev("pointermove", x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
        await frame();
      }
      ev("pointerup", x1, y1, 0);
      await frame();
    },
    wheel: async (x, y, dy, times) => {
      const r = canvas.getBoundingClientRect();
      for (let i = 0; i < (times || 1); i++) {
        canvas.dispatchEvent(new WheelEvent("wheel", {
          clientX: r.left + x, clientY: r.top + y, deltaY: dy, deltaMode: 0,
          bubbles: true, cancelable: true,
        }));
        await frame();
      }
    },
  };
}

function inkFraction(canvas, view) {
  const d = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  const r = view.radius * 0.5;
  const hist = new Map();
  let n = 0;
  for (let y = 0; y < canvas.height; y += 3) {
    for (let x = 0; x < canvas.width; x += 3) {
      const dx = x - view.cx;
      const dy = y - view.cy;
      if (dx * dx + dy * dy > r * r) continue;
      const i = (y * canvas.width + x) * 4;
      const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      hist.set(k, (hist.get(k) || 0) + 1);
      n++;
    }
  }
  let mode = 0;
  for (const v of hist.values()) if (v > mode) mode = v;
  return n ? 1 - mode / n : 0;
}

function strayOutside(canvas, view) {
  const d = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  let n = 0;
  const lim = (view.radius * 1.05) ** 2;
  for (let y = 0; y < canvas.height; y += 3) {
    for (let x = 0; x < canvas.width; x += 3) {
      const dx = x - view.cx;
      const dy = y - view.cy;
      if (dx * dx + dy * dy < lim) continue;
      const i = (y * canvas.width + x) * 4;
      if (d[i + 3] > 8 && !(d[i] > 250 && d[i + 1] > 250 && d[i + 2] > 250)) n++;
    }
  }
  return n;
}

// A compound itinerary: short hops, long hauls, reversals, zooms and rim rotations, in varied
// directions. `long` runs repeat a drag many times so the camera crosses hundreds of tiles.
function itinerary(W, H, seed) {
  const mid = [W / 2, H / 2];
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const R = Math.min(W, H) * 0.3;
  const steps = [];
  const dragAt = (bearing, frac, repeat) => {
    const a = bearing;
    steps.push({
      kind: repeat > 1 ? "long drag" : "drag",
      repeat,
      from: [mid[0] + R * frac * Math.cos(a), mid[1] + R * frac * Math.sin(a)],
      to: [mid[0] - R * frac * Math.cos(a), mid[1] - R * frac * Math.sin(a)],
    });
  };
  // Eight compass directions, short.
  for (let k = 0; k < 8; k++) dragAt((2 * Math.PI * k) / 8, 0.55, 1);
  // Four long hauls, each crossing many tiles, with a reversal after each.
  for (let k = 0; k < 4; k++) {
    const a = (2 * Math.PI * k) / 4 + 0.3;
    dragAt(a, 0.9, 25);
    dragAt(a + Math.PI, 0.9, 25);
  }
  // Zooms interleaved with drags, then rim rotations.
  steps.push({ kind: "wheel in", wheel: -120, times: 4 });
  dragAt(1.1, 0.6, 6);
  steps.push({ kind: "wheel out", wheel: 120, times: 7 });
  dragAt(2.7, 0.6, 6);
  for (let k = 0; k < 3; k++) {
    const a = rand() * Math.PI * 2;
    const rr = Math.min(W, H) * 0.47;
    steps.push({
      kind: "rim rotate",
      repeat: 1,
      from: [mid[0] + rr * Math.cos(a), mid[1] + rr * Math.sin(a)],
      to: [mid[0] + rr * Math.cos(a + 1.1), mid[1] + rr * Math.sin(a + 1.1)],
    });
  }
  // A final long random walk, direction changing each leg.
  for (let k = 0; k < 6; k++) dragAt(rand() * Math.PI * 2, 0.85, 20);
  return steps;
}

// Run the itinerary on a viewport built by `make`, checking invariants after every step.
export async function runCompoundScroll(make, opts = {}) {
  const H = window.HyperbolicMap;
  const { vp, tiling, rebuild } = await make();
  const d = driver(vp);
  const W = d.canvas.clientWidth || d.canvas.width;
  const Ht = d.canvas.clientHeight || d.canvas.height;
  await settle(vp);
  const baseView = vp.surface.buildView(vp.view, vp.options);
  const baseInk = inkFraction(d.canvas, baseView);

  const findings = [];
  const trace = [];
  const steps = itinerary(W, Ht, opts.seed || 20260806);

  for (let si = 0; si < steps.length; si++) {
    const st = steps[si];
    if (st.wheel) {
      await d.wheel(W / 2, Ht / 2, st.wheel, st.times);
    } else {
      for (let r = 0; r < (st.repeat || 1); r++) {
        await d.drag(st.from[0], st.from[1], st.to[0], st.to[1], 4);
      }
    }
    await settle(vp);

    const view = vp.surface.buildView(vp.view, vp.options);
    const maxV = H.Anchor.maxEntry(vp.view.liveMatrix);
    let maxRel = 0;
    let nonFinite = 0;
    for (const t of vp.atlas.lastTiles) {
      const e = H.Anchor.maxEntry(t.rel);
      if (!Number.isFinite(e)) nonFinite++;
      maxRel = Math.max(maxRel, e);
    }
    const ink = inkFraction(d.canvas, view);
    const stray = strayOutside(d.canvas, view);
    const addr = tiling.addressToString(vp.atlas.anchor.address);

    if (maxV > 20) findings.push(`step ${si} (${st.kind}): max|V| = ${maxV.toFixed(3)}`);
    if (nonFinite) findings.push(`step ${si} (${st.kind}): ${nonFinite} non-finite relative frames`);
    if (stray > 0) findings.push(`step ${si} (${st.kind}): ${stray} pixels outside the disk`);
    if (ink < baseInk * 0.2) {
      findings.push(`step ${si} (${st.kind}): disk nearly empty (ink ${ink.toFixed(4)} vs ${baseInk.toFixed(4)})`);
    }
    if (vp.atlas.lastTiles.length === 0) findings.push(`step ${si} (${st.kind}): no tiles at all`);

    trace.push({
      step: si, kind: st.kind, maxV: +maxV.toFixed(4), maxRel: +maxRel.toFixed(2),
      tiles: vp.atlas.lastTiles.length, ink: +ink.toFixed(4), stray,
      addrLen: addr.length, reanchors: vp.atlas.anchor.reanchorCount,
    });
  }

  // Path independence, measured properly: capture the final camera, then build a FRESH viewport at
  // exactly that camera and compare pixel for pixel. A fresh canvas is required -- re-reading the same
  // canvas across renders is not reproducible in Chrome.
  const finalCam = vp.getCamera();
  const finalPx = new Uint8ClampedArray(
    d.canvas.getContext("2d").getImageData(0, 0, d.canvas.width, d.canvas.height).data,
  );
  vp.destroy();

  const fresh = await rebuild(finalCam);
  await settle(fresh.vp);
  const freshPx = new Uint8ClampedArray(
    fresh.vp.surface.canvas.getContext("2d").getImageData(0, 0, d.canvas.width, d.canvas.height).data,
  );
  let diff = 0;
  let worst = 0;
  for (let i = 0; i < finalPx.length; i++) {
    const dd = Math.abs(finalPx[i] - freshPx[i]);
    if (dd) {
      diff++;
      if (dd > worst) worst = dd;
    }
  }
  fresh.vp.destroy();
  if (diff > 0) {
    findings.push(
      `path dependence: after ${steps.length} compound gestures the picture differs from a fresh ` +
        `viewport at the same camera by ${diff} channels (worst ${worst})`,
    );
  }

  return {
    steps: steps.length,
    gestures: steps.reduce((a, s) => a + (s.repeat || s.times || 1), 0),
    findings,
    trace,
    summary: {
      maxV: Math.max(...trace.map((t) => t.maxV)),
      maxRel: Math.max(...trace.map((t) => t.maxRel)),
      minInk: Math.min(...trace.map((t) => t.ink)),
      maxAddrLen: Math.max(...trace.map((t) => t.addrLen)),
      totalReanchors: trace[trace.length - 1].reanchors,
      pathDependenceChannels: diff,
    },
  };
}

window.runCompoundScroll = runCompoundScroll;
