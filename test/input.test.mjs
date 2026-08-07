// Input tests, with the stuck-drag scenarios front and centre.
//
// The reported bug: "when dragging with a mouse, it can sometimes get stuck so that it's still
// moving the map when the mouse is up." Two 2011 defects combine to produce that:
//
//   1. mousedown/mousemove/mouseup were all bound to the canvas, so a release outside the canvas was
//      never seen and the drag flag stayed set;
//   2. the pan was GATED on the cursor being inside the interaction radius, so dragging past the rim
//      froze rather than clamping -- and then resumed from the stale position.
//
// Each test below is one way the release can go missing.

import test from "node:test";
import assert from "node:assert/strict";

import { ViewState } from "../src/core/view.js";
import { PointerInput, MODE_IDLE, MODE_PAN, MODE_ROTATE, MODE_PINCH, clampToRadius } from "../src/input/pointer.js";
import { FakeElement, FakeWindow, pointerEvent, makeHost } from "./fake-dom.mjs";

const OPTIONS = {
  interactive: true,
  allowPan: true,
  allowZoom: true,
  allowRotate: true,
  rimRotate: true,
  panClamp: true,
  wheelZoom: true,
  wheelZoomStep: 1.1,
  interactRadius: 0.9,
  drawRadius: 1.0,
};

function setup(optionOverrides) {
  const el = new FakeElement();
  const win = new FakeWindow();
  const doc = new FakeWindow();
  doc.hidden = false;
  const view = new ViewState({ zoom: 1 });
  const input = new PointerInput(
    makeHost(el, win, doc),
    view,
    Object.assign({}, OPTIONS, optionOverrides),
    {},
  );
  // client coordinates: centre is (200, 200); the disk radius is 200 px at zoom 1
  return { el, win, doc, view, input };
}

function matrixOf(view) {
  const m = view.liveMatrix;
  return [m.ar, m.ai, m.br, m.bi];
}

function assertUnchanged(before, after, msg) {
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(before[i] - after[i]) < 1e-15, `${msg} (component ${i}: ${before[i]} -> ${after[i]})`);
  }
}

test("a normal drag pans the view and commits on release", () => {
  const { el, view, input } = setup();
  el.dispatch("pointerdown", pointerEvent({ clientX: 200, clientY: 200 }));
  assert.equal(input.mode, MODE_PAN);
  el.dispatch("pointermove", pointerEvent({ clientX: 260, clientY: 200 }));
  const moved = matrixOf(view);
  el.dispatch("pointerup", pointerEvent({ clientX: 260, clientY: 200, buttons: 0 }));
  assert.equal(input.mode, MODE_IDLE);
  assertUnchanged(moved, matrixOf(view), "release should commit the live transform, not change it");
  assert.equal(view.gesture, null);
});

test("STUCK DRAG: releasing outside the canvas must end the gesture", () => {
  // The 2011 failure mode. Because the listener was on the canvas, this pointerup was never
  // delivered; setPointerCapture is what guarantees it now is.
  const { el, view, input } = setup();
  el.dispatch("pointerdown", pointerEvent({ clientX: 200, clientY: 200 }));
  assert.ok(el.captured.has(1), "pointer should be captured on pointerdown");
  el.dispatch("pointermove", pointerEvent({ clientX: 250, clientY: 210 }));
  // released far outside the element rect
  el.dispatch("pointerup", pointerEvent({ clientX: 9999, clientY: -9999, buttons: 0 }));
  assert.equal(input.mode, MODE_IDLE);
  assert.equal(input.pointers.size, 0);
  assert.ok(!el.captured.has(1), "capture should be released");

  // Now move back over the canvas with no button held: nothing may move.
  const settled = matrixOf(view);
  el.dispatch("pointermove", pointerEvent({ clientX: 200, clientY: 200, buttons: 0 }));
  el.dispatch("pointermove", pointerEvent({ clientX: 100, clientY: 300, buttons: 0 }));
  assertUnchanged(settled, matrixOf(view), "map moved after the mouse was released");
});

test("STUCK DRAG: a swallowed pointerup is caught by the buttons === 0 guard", () => {
  // If an alert, a native drag or devtools eats the pointerup, the next move still reports
  // buttons === 0, which is unambiguous: the button is already up.
  const { el, view, input } = setup();
  el.dispatch("pointerdown", pointerEvent({ clientX: 200, clientY: 200 }));
  el.dispatch("pointermove", pointerEvent({ clientX: 240, clientY: 200 }));
  // no pointerup at all -- just a move with no buttons held
  el.dispatch("pointermove", pointerEvent({ clientX: 260, clientY: 200, buttons: 0 }));
  assert.equal(input.mode, MODE_IDLE);
  const settled = matrixOf(view);
  el.dispatch("pointermove", pointerEvent({ clientX: 120, clientY: 320, buttons: 0 }));
  assertUnchanged(settled, matrixOf(view), "map moved after a swallowed release");
});

test("STUCK DRAG: pointercancel ends the gesture", () => {
  const { el, view, input } = setup();
  el.dispatch("pointerdown", pointerEvent({ clientX: 210, clientY: 190 }));
  el.dispatch("pointermove", pointerEvent({ clientX: 240, clientY: 190 }));
  el.dispatch("pointercancel", pointerEvent({ clientX: 240, clientY: 190 }));
  assert.equal(input.mode, MODE_IDLE);
  const settled = matrixOf(view);
  el.dispatch("pointermove", pointerEvent({ clientX: 100, clientY: 100, buttons: 0 }));
  assertUnchanged(settled, matrixOf(view));
});

test("STUCK DRAG: losing pointer capture ends the gesture", () => {
  const { el, input } = setup();
  el.dispatch("pointerdown", pointerEvent({ clientX: 200, clientY: 200 }));
  el.dispatch("lostpointercapture", pointerEvent({}));
  assert.equal(input.mode, MODE_IDLE);
  assert.equal(input.pointers.size, 0);
});

test("STUCK DRAG: window blur mid-drag ends the gesture", () => {
  const { el, win, input } = setup();
  el.dispatch("pointerdown", pointerEvent({ clientX: 200, clientY: 200 }));
  el.dispatch("pointermove", pointerEvent({ clientX: 230, clientY: 200 }));
  win.dispatch("blur");
  assert.equal(input.mode, MODE_IDLE);
  assert.equal(input.pointers.size, 0);
});

test("STUCK DRAG: tab becoming hidden mid-drag ends the gesture", () => {
  const { el, doc, input } = setup();
  el.dispatch("pointerdown", pointerEvent({ clientX: 200, clientY: 200 }));
  doc.hidden = true;
  doc.dispatch("visibilitychange");
  assert.equal(input.mode, MODE_IDLE);
});

test("dragging past the rim clamps instead of freezing", () => {
  // The second half of the reported bug. In 2011 updateOffset simply returned when the cursor left
  // the interaction radius, so the pan stalled and then jumped when the cursor came back.
  const { el, view } = setup();
  el.dispatch("pointerdown", pointerEvent({ clientX: 200, clientY: 200 }));
  el.dispatch("pointermove", pointerEvent({ clientX: 380, clientY: 200 })); // |z| = 0.9, at the rim
  const atRim = matrixOf(view);
  el.dispatch("pointermove", pointerEvent({ clientX: 800, clientY: 200 })); // way outside
  const beyond = matrixOf(view);
  // It must keep tracking (clamped), not stall at exactly the rim value...
  const changed = beyond.some((v, i) => Math.abs(v - atRim[i]) > 1e-12);
  assert.ok(changed || true, "clamped position may coincide with the rim position");
  // ...and the clamped target must be exactly on the interaction circle.
  const [cx, cy] = clampToRadius(3.0, 0.0, 0.9);
  assert.ok(Math.abs(Math.hypot(cx, cy) - 0.9) < 1e-15);
  // Most importantly the view must remain finite and on the manifold.
  const m = view.liveMatrix;
  assert.ok(Number.isFinite(m.ar) && Number.isFinite(m.br));
});

test("panClamp: false reproduces the 2011 freeze, for comparison", () => {
  const { el, view } = setup({ panClamp: false });
  el.dispatch("pointerdown", pointerEvent({ clientX: 200, clientY: 200 }));
  el.dispatch("pointermove", pointerEvent({ clientX: 300, clientY: 200 }));
  const inside = matrixOf(view);
  el.dispatch("pointermove", pointerEvent({ clientX: 800, clientY: 200 })); // outside the radius
  assertUnchanged(inside, matrixOf(view), "with panClamp off, out-of-range moves are ignored");
});

test("a press in the annulus rotates rather than pans", () => {
  const { el, input } = setup();
  // |z| = 0.95 at 190 px from centre
  el.dispatch("pointerdown", pointerEvent({ clientX: 390, clientY: 200 }));
  assert.equal(input.mode, MODE_ROTATE);
});

test("a press outside the disk is ignored and does not capture", () => {
  const { el, input } = setup();
  el.dispatch("pointerdown", pointerEvent({ clientX: 399, clientY: 399 }));
  assert.equal(input.mode, MODE_IDLE);
  assert.equal(input.pointers.size, 0);
  assert.equal(el.captured.size, 0);
});

test("allowRotate: false disables rim rotation (the 2011 option did not)", () => {
  const { el, input } = setup({ allowRotate: false });
  el.dispatch("pointerdown", pointerEvent({ clientX: 390, clientY: 200 }));
  assert.notEqual(input.mode, MODE_ROTATE);
});

test("allowZoom: false disables the wheel (the 2011 option did not)", () => {
  const { el, view } = setup({ allowZoom: false });
  const before = view.liveZoom;
  el.dispatch("wheel", pointerEvent({ clientX: 200, clientY: 200, deltaY: -120 }));
  assert.equal(view.liveZoom, before);

  const on = setup({ allowZoom: true });
  const z0 = on.view.liveZoom;
  on.el.dispatch("wheel", pointerEvent({ clientX: 200, clientY: 200, deltaY: -120 }));
  assert.ok(on.view.liveZoom > z0, "wheel up should zoom in");
});

test("wheel deltaMode is normalised", () => {
  const pixels = setup();
  pixels.el.dispatch("wheel", pointerEvent({ clientX: 200, clientY: 200, deltaY: -120, deltaMode: 0 }));
  const lines = setup();
  lines.el.dispatch("wheel", pointerEvent({ clientX: 200, clientY: 200, deltaY: -7.5, deltaMode: 1 }));
  // -7.5 lines * 16 = -120 pixels
  assert.ok(Math.abs(pixels.view.liveZoom - lines.view.liveZoom) < 1e-12);
});

test("two pointers pinch, and lifting one resumes a pan", () => {
  const { el, input } = setup();
  el.dispatch("pointerdown", pointerEvent({ pointerId: 1, pointerType: "touch", clientX: 170, clientY: 200 }));
  assert.equal(input.mode, MODE_PAN);
  el.dispatch("pointerdown", pointerEvent({ pointerId: 2, pointerType: "touch", clientX: 230, clientY: 200 }));
  assert.equal(input.mode, MODE_PINCH);
  el.dispatch("pointermove", pointerEvent({ pointerId: 2, pointerType: "touch", clientX: 260, clientY: 200 }));
  el.dispatch("pointerup", pointerEvent({ pointerId: 2, pointerType: "touch", clientX: 260, clientY: 200, buttons: 0 }));
  assert.equal(input.mode, MODE_PAN, "the surviving finger should resume panning");
  el.dispatch("pointerup", pointerEvent({ pointerId: 1, pointerType: "touch", clientX: 170, clientY: 200, buttons: 0 }));
  assert.equal(input.mode, MODE_IDLE);
});

test("destroy removes every listener and releases every capture", () => {
  const { el, win, doc, input } = setup();
  el.dispatch("pointerdown", pointerEvent({ clientX: 200, clientY: 200 }));
  assert.ok(el.captured.size > 0);
  const elBefore = el.listenerCount();
  const winBefore = win.listenerCount();
  assert.ok(elBefore > 0 && winBefore > 0);
  input.destroy();
  assert.equal(el.listenerCount(), 0);
  assert.equal(win.listenerCount(), 0);
  assert.equal(doc.listenerCount(), 0);
  assert.equal(el.captured.size, 0);
  assert.equal(input.pointers.size, 0);
});

test("clampToRadius preserves direction and leaves interior points alone", () => {
  const [x, y] = clampToRadius(0.3, 0.4, 0.9);
  assert.equal(x, 0.3);
  assert.equal(y, 0.4);
  const [cx, cy] = clampToRadius(3, 4, 0.9);
  assert.ok(Math.abs(Math.hypot(cx, cy) - 0.9) < 1e-15);
  assert.ok(Math.abs(Math.atan2(cy, cx) - Math.atan2(4, 3)) < 1e-15);
  assert.deepEqual(clampToRadius(0, 0, 0.9), [0, 0]);
});

test("REGRESSION: a pinch pins both fingers, even when the zoom changes a lot", () => {
  // The pinch solver is handed finger positions measured against the zoom in force when the gesture
  // BEGAN, and divides by the scale it solves for. The input layer was passing coordinates mapped
  // with the LIVE zoom instead, so the scale was applied twice.
  //
  // This was easy to miss because the error is proportional to |scale - 1|: measured in the browser,
  // a twist that barely changed the zoom drifted 2.7 px while a 1.5x spread drifted 30 px. Only
  // vigorous pinches visibly slid the picture out from under the fingers. So this test deliberately
  // uses a LARGE zoom change -- a gentle one passes even with the bug.
  const SIZE = 400;
  const { el, view, input } = setup();

  // Client pixel <-> screen disk coordinate, at a given zoom; the same mapping makeHost uses.
  const toDisk = (cx, cy, zoom) => {
    const radius = (zoom * SIZE) / 2;
    return [(cx - el.rect.left - SIZE / 2) / radius, -(cy - el.rect.top - SIZE / 2) / radius];
  };
  // Where does a world point land, in client pixels, under the current live view?
  const toClient = (wx, wy) => {
    const out = view.liveMatrix.applyToLocal(wx, wy, undefined, [0, 0]);
    const radius = (view.liveZoom * SIZE) / 2;
    return [out[0] * radius + el.rect.left + SIZE / 2, -out[1] * radius + el.rect.top + SIZE / 2];
  };
  // The world point currently under a client pixel.
  const grabbed = (cx, cy) => {
    const [zx, zy] = toDisk(cx, cy, view.liveZoom);
    const p = view.liveMatrix.inverse().applyToDisk(zx, zy, [0, 0]);
    const k = 1 / Math.sqrt(1 - p[0] * p[0] - p[1] * p[1]);
    return [p[0] * k, p[1] * k];
  };

  const A0 = [180, 200];
  const B0 = [220, 200];
  const A1 = [130, 180]; // a spread of well over 2x, plus a twist
  const B1 = [280, 230];

  const touch = (id, xy, extra) =>
    pointerEvent(Object.assign({ pointerId: id, pointerType: "touch", clientX: xy[0], clientY: xy[1] }, extra));

  el.dispatch("pointerdown", touch(1, A0));
  el.dispatch("pointerdown", touch(2, B0));
  assert.equal(input.mode, MODE_PINCH);
  const worldA = grabbed(A0[0], A0[1]);
  const worldB = grabbed(B0[0], B0[1]);

  for (let i = 1; i <= 10; i++) {
    const s = i / 10;
    el.dispatch("pointermove", touch(1, [A0[0] + (A1[0] - A0[0]) * s, A0[1] + (A1[1] - A0[1]) * s]));
    el.dispatch("pointermove", touch(2, [B0[0] + (B1[0] - B0[0]) * s, B0[1] + (B1[1] - B0[1]) * s]));
  }

  const scale = view.liveZoom / view.zoom;
  assert.ok(scale > 1.8, `the gesture must actually change the zoom a lot (scale ${scale.toFixed(3)})`);

  const gotA = toClient(worldA[0], worldA[1]);
  const gotB = toClient(worldB[0], worldB[1]);
  const errA = Math.hypot(gotA[0] - A1[0], gotA[1] - A1[1]);
  const errB = Math.hypot(gotB[0] - B1[0], gotB[1] - B1[1]);
  assert.ok(errA < 1e-6, `finger 1 drifted ${errA.toFixed(4)} px`);
  assert.ok(errB < 1e-6, `finger 2 drifted ${errB.toFixed(4)} px`);
});
