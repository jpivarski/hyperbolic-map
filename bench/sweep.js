// Drawing-correctness sweep driver. Injected into an example page by the test runner.
//
// Simulates real scrolling through real pointer events (not by poking the view state), captures the
// canvas's own pixels after each step, and reports structural statistics that catch the failure modes
// that matter here: content vanishing, content not being cleared between frames, and content whose
// coverage collapses after repeated interaction.
//
// Deliberately does NOT compare exact pixels between steps: Chrome switches a canvas from software to
// GPU rasterization after the first few draws, so a few percent of edge pixels always differ. See
// notes/legacy-decoded.md.

/* global document, window, fetch, PointerEvent, requestAnimationFrame */

window.__sweep = (function () {
  function canvas() {
    return document.querySelector("#map canvas");
  }

  function frame() {
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }

  function pointer(type, x, y, extra) {
    const c = canvas();
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

  // A drag in `steps` increments, so intermediate frames are exercised too.
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

  // Structural summary of what is on the canvas.
  function inspect() {
    const c = canvas();
    const ctx = c.getContext("2d");
    const w = c.width;
    const h = c.height;
    const d = ctx.getImageData(0, 0, w, h).data;

    const cx = w / 2;
    const cy = h / 2;
    // Sample on a grid; count coverage inside and outside the disk, and collect a colour histogram.
    let insideOpaque = 0;
    let insideTotal = 0;
    let outsideOpaque = 0;
    let outsideTotal = 0;
    const colours = new Map();
    const step = 3;
    // The disk's on-screen radius is not known here, so use the largest inscribed circle as a proxy
    // and additionally record the true extent of non-transparent pixels.
    const proxyR = Math.min(w, h) / 2;
    let minX = w, maxX = -1, minY = h, maxY = -1;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        const a = d[i + 3];
        const inside = (x - cx) ** 2 + (y - cy) ** 2 <= proxyR * proxyR * 0.9;
        if (inside) {
          insideTotal++;
          if (a > 8) insideOpaque++;
        } else {
          outsideTotal++;
          if (a > 8) outsideOpaque++;
        }
        if (a > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          const key = `${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`;
          colours.set(key, (colours.get(key) || 0) + 1);
        }
      }
    }
    const top = [...colours.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    return {
      size: [w, h],
      insideCoverage: +(insideOpaque / Math.max(1, insideTotal)).toFixed(4),
      outsideCoverage: +(outsideOpaque / Math.max(1, outsideTotal)).toFixed(4),
      paintedBox: maxX < 0 ? null : [minX, minY, maxX, maxY],
      distinctColours: colours.size,
      topColours: top.map(([k, v]) => `${k}:${v}`),
    };
  }

  async function shoot(name) {
    const url = canvas().toDataURL("image/png");
    await fetch(`/__shot/${name}.png`, { method: "POST", body: url });
    return name;
  }

  function stats() {
    const vp = window.viewport;
    if (!vp) return null;
    const v = vp.getView();
    return {
      centre: v.center.map((n) => +n.toFixed(4)),
      zoom: +v.zoom.toFixed(3),
      rotation: +v.rotation.toFixed(3),
      drawables: vp.stats.drawables,
      drawn: vp.stats.drawn,
      survivors: vp.stats.survivors,
      textDrawn: vp.stats.textDrawn,
      canvasCalls: vp.stats.canvasCalls,
    };
  }

  return { canvas, frame, pointer, drag, inspect, shoot, stats };
})();
