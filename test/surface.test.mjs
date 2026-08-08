// Canvas sizing: `aspectRatio`, and the invariants that keep pointer mapping honest.

import test from "node:test";
import assert from "node:assert/strict";

import { Surface } from "../src/render/surface.js";

// Enough of a DOM for Surface: a host with a settable clientWidth, and a canvas it creates itself.
// Surface only takes the container path when no `canvas` is passed, and that is the path the demo
// pages use, so the stub goes on `document.createElement` rather than being handed in.
function makeHost(clientWidth, clientHeight = 0) {
  const canvas = {
    width: 0, height: 0, style: {}, clientWidth: 0, clientHeight: 0,
    getContext: () => ({ setTransform() {} }),
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
  const host = {
    clientWidth, clientHeight,
    appendChild(c) { this.child = c; },
    removeChild() { this.child = null; },
  };
  globalThis.document = { createElement: () => canvas, querySelector: () => host };
  return { host, canvas, mk: (opts) => new Surface(Object.assign({ container: host }, opts)) };
}

// A container that sizes itself to its contents: 0 wide while empty, the canvas's width once the
// canvas is in it. This is what an inline-block, a float or a `width: fit-content` box does, and it
// is the shape that makes `aspectRatio` fail silently.
function makeShrinkWrapHost() {
  const canvas = {
    width: 0, height: 0, style: {}, clientWidth: 0, clientHeight: 0,
    getContext: () => ({ setTransform() {} }),
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
  const host = {
    child: null,
    // 300 is a fresh canvas's default width, which is exactly what the real DOM reports here.
    get clientWidth() { return this.child ? 300 : 0; },
    get clientHeight() { return this.child ? 150 : 0; },
    appendChild(c) { this.child = c; },
    removeChild() { this.child = null; },
  };
  globalThis.document = { createElement: () => canvas, querySelector: () => host };
  return { host, canvas, mk: (opts) => new Surface(Object.assign({ container: host }, opts)) };
}

function captureWarnings(fn) {
  const real = console.warn;
  const seen = [];
  console.warn = (...a) => seen.push(String(a[0]));
  try { fn(); } finally { console.warn = real; }
  return seen;
}

test("aspectRatio derives the height from the width", () => {
  for (const [w, ratio, expected] of [[600, 1, 600], [600, 2, 300], [500, 0.5, 1000], [453, 1, 453]]) {
    const { mk } = makeHost(w);
    const s = mk({ aspectRatio: ratio });
    assert.equal(s.cssWidth, w);
    assert.equal(s.cssHeight, expected, `width ${w} at ratio ${ratio}`);
  }
});

test("aspectRatio takes the width from the container when none is given", () => {
  const { mk } = makeHost(880);
  assert.equal(mk({ aspectRatio: 1 }).cssWidth, 880);
  // an explicit width still wins; the ratio only decides the height
  assert.equal(mk({ aspectRatio: 1, width: 300 }).cssWidth, 300);
  assert.equal(mk({ aspectRatio: 1, width: 300 }).cssHeight, 300);
});

test("aspectRatio refuses to coexist with height, and rejects nonsense", () => {
  const { mk } = makeHost(600);
  // Silently ignoring one of two contradictory options is the kind of thing that costs an hour.
  assert.throws(() => mk({ aspectRatio: 1, height: 500 }), /aspectRatio.*`height` cannot also be given/s);
  for (const bad of [0, -2, NaN, Infinity, "1"]) {
    assert.throws(() => mk({ aspectRatio: bad }), /aspectRatio must be a positive number/,
      `${bad} should be rejected`);
  }
  // and the ordinary path is untouched
  assert.doesNotThrow(() => mk({ width: 400, height: 500 }));
  assert.equal(mk({ width: 400, height: 500 }).cssHeight, 500);
});

test("the backing store matches the CSS size times the device pixel ratio", () => {
  // If these drift apart the picture is soft; if the CSS size drifts from the element's real width
  // the pointer mapping is wrong, which is the reason not to scale the canvas with CSS.
  const { canvas, mk } = makeHost(453);
  const s = mk({ aspectRatio: 1, devicePixelRatio: 2 });
  assert.equal(canvas.width, 906);
  assert.equal(canvas.height, 906);
  assert.equal(canvas.style.width, "453px");
  assert.equal(canvas.style.height, "453px");
  assert.equal(s.cssWidth, 453);
});

test("REGRESSION: an aspectRatio resize must not depend on the observed height", () => {
  // The feedback loop this guards: the canvas is the only thing giving the container its height, so
  // a resize driven by the container's HEIGHT would change the height, and so on forever. Deriving
  // from the width breaks the cycle -- resizing must leave the width alone.
  const { host, mk } = makeHost(600);
  const s = mk({ aspectRatio: 1 });
  assert.deepEqual([s.cssWidth, s.cssHeight], [600, 600]);

  // Simulate what the observer does, twice, with the container width unchanged. The second pass must
  // be a no-op: same width in, same size out.
  host.clientHeight = s.cssHeight;              // as the DOM would now report it
  s.resize(host.clientWidth, host.clientWidth / s.aspectRatio);
  const first = [s.cssWidth, s.cssHeight];
  host.clientHeight = s.cssHeight;
  s.resize(host.clientWidth, host.clientWidth / s.aspectRatio);
  assert.deepEqual([s.cssWidth, s.cssHeight], first, "a second pass at the same width changed the size");
  assert.deepEqual(first, [600, 600]);

  // A real width change does take effect, or the test above would pass on a dead widget.
  host.clientWidth = 320;
  s.resize(host.clientWidth, host.clientWidth / s.aspectRatio);
  assert.deepEqual([s.cssWidth, s.cssHeight], [320, 320]);
});

test("the disk is sized by the smaller side, so a non-square canvas still fits it", () => {
  const { mk } = makeHost(800);
  const wide = mk({ aspectRatio: 2 });          // 800 x 400
  assert.equal(wide.radiusFor(1), 200);         // half of the SHORTER side
  const square = mk({ aspectRatio: 1 });        // 800 x 800
  assert.equal(square.radiusFor(1), 400);
});

test("a container with no width of its own warns instead of silently mis-sizing", () => {
  // The trap, hit for real on jumping-man.html: `#map` was still `display: inline-block`, so it
  // shrink-wrapped the canvas and the widget came out 300x300 inside a 704 px column. Nothing threw
  // and nothing looked broken in the console -- which is why this warns now.
  const { mk } = makeShrinkWrapHost();
  const warnings = captureWarnings(() => mk({ aspectRatio: 1, autoResize: true }));
  assert.equal(warnings.length, 1, "expected exactly one warning");
  assert.match(warnings[0], /0 px.*wide when empty/s);
  assert.match(warnings[0], /display: block/, "the warning must say how to fix it");
});

test("the width warning does not fire when the setup is fine", () => {
  // A warning that cries wolf gets ignored, so the negative cases matter as much as the positive one.
  const ok = makeHost(800);
  assert.deepEqual(captureWarnings(() => ok.mk({ aspectRatio: 1, autoResize: true })), [],
    "a real block container must not warn");
  assert.deepEqual(captureWarnings(() => ok.mk({ aspectRatio: 1 })), [],
    "autoResize is irrelevant to the warning");

  const shrink = makeShrinkWrapHost();
  assert.deepEqual(captureWarnings(() => shrink.mk({ aspectRatio: 1, width: 500 })), [],
    "an explicit width answers the question, so there is nothing to warn about");
  assert.deepEqual(captureWarnings(() => shrink.mk({ width: 400, height: 400 })), [],
    "without aspectRatio the container width is never consulted");
});

test("the container is measured while EMPTY, so a shrink-wrapping host cannot fake a good size", () => {
  // Measured after the canvas is inserted, a shrink-wrapping host reports the canvas's own default
  // 300 and looks healthy. Measured empty it reports 0, which is the signal. A block container gives
  // the same answer either way, so reading it early costs nothing.
  const shrink = makeShrinkWrapHost();
  const s = captureWarnings(() => {}) && shrink.mk({ aspectRatio: 1, width: 640 });
  assert.equal(s.cssWidth, 640, "an explicit width still wins");

  const block = makeHost(704);
  assert.equal(block.mk({ aspectRatio: 1 }).cssWidth, 704,
    "a block container measures the same before and after the canvas goes in");
});
