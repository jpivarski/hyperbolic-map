// Gesture recognition, on Pointer Events only.
//
// One code path for mouse, touch and pen. `touch-action: none` on the canvas suppresses the
// browser's own panning and zooming, and `pointercancel` subsumes `touchcancel`, so no separate
// touch listeners are needed.
//
// ---------------------------------------------------------------------------------------------
// THE STUCK-DRAG FIX
//
// In the 2011 code `mousedown`, `mousemove` and `mouseup` were all bound to the canvas. Releasing
// the button anywhere outside the canvas therefore never delivered `mouseup`, `isMouseScrolling`
// stayed true, and the map kept following the cursor on re-entry with no button held.
//
// A second, compounding defect: `updateOffset` was GATED on the cursor being inside the interaction
// radius, so dragging past the rim silently froze the pan instead of clamping it -- and then
// resumed from where it froze. Together these are what made the bug feel erratic.
//
// Defence in depth here, because any single mechanism can be defeated:
//   1. setPointerCapture on pointerdown, so moves and the release are delivered even off-canvas;
//   2. end the gesture on pointerup, pointercancel AND lostpointercapture;
//   3. in pointermove, if a mouse reports buttons === 0 the button is already up (this catches a
//      release swallowed by a native drag, an alert, or devtools stealing focus);
//   4. window blur and document visibilitychange cancel;
//   5. every active pointer is tracked in a Map, so destroy() can release captures deterministically.
// ---------------------------------------------------------------------------------------------

import { ViewState } from "../core/view.js";

export const MODE_IDLE = "idle";
export const MODE_PAN = "pan";
export const MODE_ROTATE = "rotate";
export const MODE_PINCH = "pinch";

// Clamp a disk point to a given radius, preserving direction. Used instead of ignoring
// out-of-range positions, which is what froze the 2011 pan.
export function clampToRadius(x, y, radius) {
  const r = Math.hypot(x, y);
  if (r <= radius || r === 0) return [x, y];
  const k = radius / r;
  return [x * k, y * k];
}

export class PointerInput {
  // `host` abstracts the DOM so this is testable in Node:
  //   { element, window, document, toDisk(event) -> [x, y] }
  constructor(host, viewState, options, callbacks) {
    this.host = host;
    this.view = viewState;
    this.options = options;
    this.callbacks = callbacks || {};
    this.pointers = new Map();
    this.mode = MODE_IDLE;
    this.disposed = false;

    const el = host.element;
    if (el.style) {
      el.style.touchAction = "none";
      el.style.userSelect = "none";
      el.style.webkitTapHighlightColor = "transparent";
    }

    this.onPointerDown = (e) => this.handleDown(e);
    this.onPointerMove = (e) => this.handleMove(e);
    this.onPointerUp = (e) => this.handleUp(e);
    this.onPointerCancel = (e) => this.handleCancel(e);
    this.onLostCapture = (e) => this.handleCancel(e);
    this.onWheel = (e) => this.handleWheel(e);
    this.onBlur = () => this.cancelAll();
    this.onVisibility = () => {
      if (host.document && host.document.hidden) this.cancelAll();
    };
    this.onContextMenu = () => this.cancelAll();

    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointercancel", this.onPointerCancel);
    el.addEventListener("lostpointercapture", this.onLostCapture);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("contextmenu", this.onContextMenu);
    if (host.window) host.window.addEventListener("blur", this.onBlur);
    if (host.document) host.document.addEventListener("visibilitychange", this.onVisibility);
  }

  changed() {
    if (this.callbacks.onChange) this.callbacks.onChange();
  }

  gestureEnded() {
    if (this.callbacks.onGestureEnd) this.callbacks.onGestureEnd();
  }

  handleDown(e) {
    if (this.disposed) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!this.options.interactive) return;

    const [x, y] = this.host.toDisk(e, this.view.liveZoom);
    const r2 = x * x + y * y;
    if (r2 >= 1) return; // outside the disk entirely: not ours, do not capture

    try {
      this.host.element.setPointerCapture(e.pointerId);
    } catch (err) {
      // Some environments (and the test double) do not implement capture; the window-level
      // fallbacks still cover us.
    }
    this.pointers.set(e.pointerId, { x, y });
    if (e.preventDefault) e.preventDefault();

    const interact = this.options.interactRadius;
    if (this.pointers.size === 1) {
      if (r2 < interact * interact) {
        if (!this.options.allowPan) return;
        this.mode = MODE_PAN;
        this.view.beginPan(x, y);
      } else {
        // In the annulus between the interaction radius and the disk edge.
        if (!this.options.allowRotate || !this.options.rimRotate) return;
        this.mode = MODE_ROTATE;
        this.view.beginRotate(x, y);
      }
      if (this.callbacks.onGestureStart) this.callbacks.onGestureStart(this.mode);
    } else if (this.pointers.size === 2) {
      const [p1, p2] = [...this.pointers.values()];
      // Commit whatever the single-pointer gesture achieved, then start the pinch from there.
      this.view.commit();
      this.mode = MODE_PINCH;
      this.view.beginPinch(p1.x, p1.y, p2.x, p2.y);
      if (this.callbacks.onGestureStart) this.callbacks.onGestureStart(this.mode);
    }
    this.changed();
  }

  handleMove(e) {
    if (this.disposed) return;
    if (!this.pointers.has(e.pointerId)) return;

    // Guard 3: a mouse with no buttons held has already been released, whatever events did or did
    // not arrive.
    if (e.pointerType === "mouse" && e.buttons === 0) {
      this.endPointer(e.pointerId);
      return;
    }

    const [x, y] = this.host.toDisk(e, this.view.liveZoom);
    this.pointers.get(e.pointerId).x = x;
    this.pointers.get(e.pointerId).y = y;
    if (e.preventDefault) e.preventDefault();

    if (this.mode === MODE_PAN) {
      // Clamp rather than ignore. Ignoring is what made the 2011 drag freeze past the rim and then
      // resume from the stale position.
      const [cx, cy] = this.options.panClamp
        ? clampToRadius(x, y, this.options.interactRadius)
        : [x, y];
      if (!this.options.panClamp && cx * cx + cy * cy >= this.options.interactRadius ** 2) return;
      this.view.updatePan(cx, cy);
      this.changed();
    } else if (this.mode === MODE_ROTATE) {
      this.view.updateRotate(x, y);
      this.changed();
    } else if (this.mode === MODE_PINCH && this.pointers.size >= 2) {
      const [p1, p2] = [...this.pointers.values()];
      this.view.updatePinch(
        p1.x, p1.y, p2.x, p2.y,
        this.options.allowZoom,
        this.options.allowRotate,
      );
      this.changed();
    }
  }

  handleUp(e) {
    if (this.disposed) return;
    this.endPointer(e.pointerId);
  }

  handleCancel(e) {
    if (this.disposed) return;
    this.endPointer(e.pointerId);
  }

  endPointer(pointerId) {
    if (!this.pointers.has(pointerId)) return;
    this.pointers.delete(pointerId);
    try {
      this.host.element.releasePointerCapture(pointerId);
    } catch (err) {
      /* not captured, or unsupported */
    }

    if (this.pointers.size === 0) {
      this.view.commit();
      this.mode = MODE_IDLE;
      this.changed();
      this.gestureEnded();
    } else if (this.pointers.size === 1 && this.mode === MODE_PINCH) {
      // Lifting one of two fingers resumes a one-finger pan from the survivor, matching the 2011
      // behaviour.
      this.view.commit();
      const p = [...this.pointers.values()][0];
      if (p.x * p.x + p.y * p.y < this.options.interactRadius ** 2 && this.options.allowPan) {
        this.mode = MODE_PAN;
        this.view.beginPan(p.x, p.y);
      } else {
        this.mode = MODE_IDLE;
      }
      this.changed();
    }
  }

  cancelAll() {
    if (this.disposed) return;
    if (this.pointers.size === 0 && this.mode === MODE_IDLE) return;
    for (const id of [...this.pointers.keys()]) {
      try {
        this.host.element.releasePointerCapture(id);
      } catch (err) {
        /* ignore */
      }
    }
    this.pointers.clear();
    this.view.commit();
    this.mode = MODE_IDLE;
    this.changed();
    this.gestureEnded();
  }

  handleWheel(e) {
    if (this.disposed) return;
    // Unlike 2011, allowZoom actually gates the wheel. There, the option was consulted only in the
    // two-finger path, so `allowZoom: false` pages were still wheel-zoomable.
    if (!this.options.interactive || !this.options.allowZoom || !this.options.wheelZoom) return;
    const [x, y] = this.host.toDisk(e, this.view.liveZoom);
    if (x * x + y * y >= this.options.drawRadius ** 2) return;
    if (e.preventDefault) e.preventDefault();

    // Normalise across deltaMode: 0 = pixels, 1 = lines, 2 = pages.
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 16;
    else if (e.deltaMode === 2) delta *= 100;
    // Wheel up (negative deltaY) zooms in.
    const steps = -delta / 120;
    this.view.zoomBy(Math.pow(this.options.wheelZoomStep, steps));
    this.changed();
    if (!this.view.gesture) this.gestureEnded();
  }

  destroy() {
    this.disposed = true;
    const el = this.host.element;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointercancel", this.onPointerCancel);
    el.removeEventListener("lostpointercapture", this.onLostCapture);
    el.removeEventListener("wheel", this.onWheel);
    el.removeEventListener("contextmenu", this.onContextMenu);
    if (this.host.window) this.host.window.removeEventListener("blur", this.onBlur);
    if (this.host.document) this.host.document.removeEventListener("visibilitychange", this.onVisibility);
    for (const id of [...this.pointers.keys()]) {
      try {
        el.releasePointerCapture(id);
      } catch (err) {
        /* ignore */
      }
    }
    this.pointers.clear();
  }
}
