// A minimal DOM double, enough to drive PointerInput in Node.
//
// The point of testing input in Node rather than only in a browser is that the stuck-drag scenarios
// are precisely the ones that are awkward to reproduce by hand: a release that happens off-canvas,
// a pointercancel, a capture loss, a window blur mid-drag. Here they are three lines each.

export class FakeElement {
  constructor() {
    this.style = {};
    this.listeners = new Map();
    this.captured = new Set();
    this.rect = { left: 0, top: 0, width: 400, height: 400 };
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    if (this.listeners.has(type)) this.listeners.get(type).delete(fn);
  }
  dispatch(type, event) {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const fn of [...set]) fn(event);
  }
  listenerCount() {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
  setPointerCapture(id) {
    this.captured.add(id);
  }
  releasePointerCapture(id) {
    this.captured.delete(id);
  }
  getBoundingClientRect() {
    return this.rect;
  }
}

export class FakeWindow {
  constructor() {
    this.listeners = new Map();
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    if (this.listeners.has(type)) this.listeners.get(type).delete(fn);
  }
  dispatch(type, event) {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const fn of [...set]) fn(event || {});
  }
  listenerCount() {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
}

// A pointer event with the fields PointerInput actually reads.
export function pointerEvent(overrides) {
  return Object.assign(
    {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      buttons: 1,
      clientX: 0,
      clientY: 0,
      deltaY: 0,
      deltaMode: 0,
      preventDefault() {
        this.defaultPrevented = true;
      },
      defaultPrevented: false,
    },
    overrides,
  );
}

// A host object for PointerInput that maps client coordinates to disk coordinates the same way the
// real Surface does: origin at the centre, y up, scaled by the disk radius.
export function makeHost(element, window, doc, size = 400) {
  return {
    element,
    window,
    document: doc,
    toDisk(e, zoom) {
      const radius = (zoom * size) / 2;
      return [
        (e.clientX - element.rect.left - size / 2) / radius,
        -(e.clientY - element.rect.top - size / 2) / radius,
      ];
    },
  };
}
