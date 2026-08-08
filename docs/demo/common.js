// Shared scaffolding for the example pages. NOT part of the library.

/* global window, document, fetch */

export async function loadDrawables(url, statusEl) {
  if (statusEl) statusEl.textContent = "loading data…";
  const t0 = performance.now();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const doc = await res.json();
  if (statusEl) {
    const ms = Math.round(performance.now() - t0);
    statusEl.textContent = `${doc.drawables.length.toLocaleString()} drawables (${ms} ms)`;
  }
  return doc;
}

// A small readout of the current view, useful for eyeballing behaviour and for scripted checks.
//
// Two forms, because the two modes have genuinely different state. A single-patch viewport has a
// global centre. An ATLAS viewport does not -- its view is a tile address plus a small matrix in that
// tile's frame -- and asking for a global centre there throws on purpose. So the atlas readout shows
// the address and `max|V|`, which is the number worth watching: it must stay of order 1 however far
// the camera travels, and if it ever starts climbing, the anchoring has stopped working.
export function attachReadout(viewport, el) {
  function update() {
    if (viewport.atlas) {
      const cam = viewport.getCamera();
      const s = viewport.stats;
      el.textContent =
        `tile ${abbreviate(viewport.atlas.tiling.addressToString(cam.address))}  ` +
        `zoom ${cam.zoom.toFixed(3)}  ` +
        `max|V| ${(s.maxViewEntry || 0).toFixed(3)}  ` +
        `re-anchors ${s.reanchorCount || 0}  ` +
        `drawn ${s.drawn}/${s.drawables}  ` +
        `${s.frameMs ? s.frameMs.toFixed(1) + " ms" : ""}`;
      return;
    }
    const v = viewport.getView();
    el.textContent =
      `centre (${v.center[0].toFixed(4)}, ${v.center[1].toFixed(4)})  ` +
      `zoom ${v.zoom.toFixed(3)}  ` +
      `rotation ${((v.rotation * 180) / Math.PI).toFixed(1)}°  ` +
      `drawn ${viewport.stats.drawn}/${viewport.stats.drawables}  ` +
      `${viewport.stats.frameMs ? viewport.stats.frameMs.toFixed(1) + " ms" : ""}`;
  }

  // A tile id is an exact integer name, so its text grows with distance from the origin -- hundreds of
  // characters after a minute of dragging. Show the ends and the length rather than wrapping the page.
  function abbreviate(s) {
    return s.length <= 28 ? s : `${s.slice(0, 12)}…${s.slice(-12)} (${s.length} chars)`;
  }
  viewport.options.onViewChange = update;
  const original = viewport.options.onFrame;
  viewport.options.onFrame = (stats) => {
    if (original) original(stats);
    update();
  };
  update();
  return update;
}

export function errorBox(err) {
  const div = document.createElement("pre");
  div.style.cssText = "background:#fee;border-left:4px solid #c00;padding:8px;white-space:pre-wrap";
  div.textContent = String((err && err.stack) || err);
  document.body.appendChild(div);
  // Re-throw asynchronously so the failure is also visible in the console and to automation.
  setTimeout(() => {
    throw err;
  });
}
