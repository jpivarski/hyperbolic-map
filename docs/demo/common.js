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
export function attachReadout(viewport, el) {
  function update() {
    const v = viewport.getView();
    el.textContent =
      `centre (${v.center[0].toFixed(4)}, ${v.center[1].toFixed(4)})  ` +
      `zoom ${v.zoom.toFixed(3)}  ` +
      `rotation ${((v.rotation * 180) / Math.PI).toFixed(1)}°  ` +
      `drawn ${viewport.stats.drawn}/${viewport.stats.drawables}  ` +
      `${viewport.stats.frameMs ? viewport.stats.frameMs.toFixed(1) + " ms" : ""}`;
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
