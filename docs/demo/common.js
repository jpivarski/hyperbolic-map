// Shared scaffolding for the example pages. NOT part of the library.

/* global document, fetch */

export async function loadDrawables(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
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
