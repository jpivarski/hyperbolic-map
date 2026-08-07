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
