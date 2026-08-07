// The canvas surface: sizing, devicePixelRatio, and the read-only `view` descriptor that gets
// handed to the renderer and to every hook.
//
// All library drawing is done in CSS pixels. The device-pixel transform is applied once here, so
// nothing downstream has to know about it.

export class Surface {
  constructor(options) {
    const {
      container = null,
      canvas = null,
      width = null,
      height = null,
      autoResize = false,
      // "auto" follows window.devicePixelRatio. A fixed number overrides it, which is what the
      // pixel-exact capture harnesses pass so that a canvas is the size they asked for.
      devicePixelRatio = "auto",
      // width / height. When set, the HEIGHT IS DERIVED from the width and `height` is refused, so
      // the canvas can follow a fluid container without the page having to compute pixel sizes.
      // With `autoResize`, that makes the widget responsive: `aspectRatio: 1` in a full-width
      // container gives a square that tracks the column.
      //
      // Deriving height from width, rather than fitting inside a box, is what avoids a feedback
      // loop: the canvas is the only thing giving the container its height, so measuring that height
      // back would oscillate. Only the width is ever read.
      aspectRatio = null,
    } = options || {};

    if (aspectRatio !== null && height !== null && height !== undefined) {
      throw new Error(
        "hyperbolic-map: `aspectRatio` derives the height from the width, so `height` cannot also be " +
          "given. Drop one of them.",
      );
    }
    if (aspectRatio !== null && !(aspectRatio > 0 && Number.isFinite(aspectRatio))) {
      throw new Error(`hyperbolic-map: aspectRatio must be a positive number, got ${aspectRatio}`);
    }

    this.autoResize = autoResize;
    this.dprOption = devicePixelRatio;
    this.aspectRatio = aspectRatio;

    // The container's width WHILE IT IS STILL EMPTY. This has to be read before the canvas goes in,
    // because a container that sizes itself to its contents -- an inline-block, a float, anything
    // `width: fit-content` -- reports the canvas's width back once there is a canvas in it, and so
    // looks perfectly healthy while being useless. Empty, such a container is 0 wide, which is the
    // signal. A block-level container gives the same answer before and after, so nothing is lost.
    let emptyHostWidth = null;
    if (canvas) {
      this.canvas = canvas;
    } else {
      const host = typeof container === "string" ? document.querySelector(container) : container;
      if (!host) throw new Error("hyperbolic-map: no container element found");
      this.host = host;
      emptyHostWidth = host.clientWidth;
      this.canvas = document.createElement("canvas");
      this.canvas.style.display = "block";
      host.appendChild(this.canvas);
    }

    // With `aspectRatio` the width comes from the container, so a container with no width of its own
    // is a silent failure: the widget takes the fresh canvas's default 300 px, and if it also
    // shrink-wraps, the ResizeObserver then reads that same 300 back forever and nothing ever moves.
    // Worth a warning rather than a throw -- a container inside a hidden tab is legitimately 0 wide
    // at construction and fixes itself on the first resize.
    if (aspectRatio && !width && emptyHostWidth === 0 && typeof console !== "undefined") {
      console.warn(
        "hyperbolic-map: `aspectRatio` takes the width from the container, but the container is 0 px " +
          "wide when empty, so the widget cannot tell how big to be. A container that sizes itself to " +
          "its contents (display: inline-block, a float, width: fit-content) will size itself to the " +
          "canvas instead, and the widget will never resize. Give it `display: block` and a width, or " +
          "pass an explicit `width`. (Harmless if the container is merely hidden right now.)",
      );
    }

    this.cssWidth =
      width || emptyHostWidth || (this.host ? this.host.clientWidth : this.canvas.clientWidth) || 400;
    this.cssHeight = aspectRatio
      ? this.cssWidth / aspectRatio
      : height || (this.host ? this.host.clientHeight : this.canvas.clientHeight) || this.cssWidth;

    this.context = this.canvas.getContext("2d");
    this.resizeObserver = null;
    this.applySize();
  }

  dpr() {
    if (this.dprOption === "auto") {
      return typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1;
    }
    return this.dprOption || 1;
  }

  applySize() {
    const ratio = this.dpr();
    this.canvas.width = Math.max(1, Math.round(this.cssWidth * ratio));
    this.canvas.height = Math.max(1, Math.round(this.cssHeight * ratio));
    this.canvas.style.width = `${this.cssWidth}px`;
    this.canvas.style.height = `${this.cssHeight}px`;
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  resize(w, h) {
    this.cssWidth = w;
    this.cssHeight = h;
    this.applySize();
  }

  observe(onResize) {
    if (!this.autoResize || typeof ResizeObserver === "undefined") return;
    const target = this.host || this.canvas;
    this.resizeObserver = new ResizeObserver(() => {
      const w = target.clientWidth;
      if (this.aspectRatio) {
        // Width only. The container's height comes FROM the canvas, so reading it back and resizing
        // to it would oscillate; and because nothing here depends on the observed height, the resize
        // this triggers cannot re-enter -- the width is unchanged by it.
        if (w > 0 && w !== this.cssWidth) {
          this.resize(w, w / this.aspectRatio);
          onResize();
        }
        return;
      }
      const h = target.clientHeight;
      if (w > 0 && h > 0 && (w !== this.cssWidth || h !== this.cssHeight)) {
        this.resize(w, h);
        onResize();
      }
    });
    this.resizeObserver.observe(target);
  }

  // The disk radius in CSS pixels for a given zoom. Sized by the SMALLER side, so the disk always
  // fits: sizing by width on both axes would clip it top and bottom on a portrait canvas.
  radiusFor(zoom) {
    return (zoom * Math.min(this.cssWidth, this.cssHeight)) / 2;
  }

  // Build the descriptor passed to the renderer and to hooks. Reuses one object so that a redraw
  // does not allocate.
  buildView(viewState, opts) {
    const zoom = viewState.liveZoom;
    const radius = this.radiusFor(zoom);
    const v = this._view || (this._view = {});
    v.width = this.cssWidth;
    v.height = this.cssHeight;
    v.ctxScale = this.dpr();
    v.cx = this.cssWidth / 2;
    v.cy = this.cssHeight / 2;
    v.radius = radius;
    v.zoom = zoom;
    v.matrix = viewState.liveMatrix;
    v.rotation = viewState.liveMatrix.screenRotation();
    v.bearing = viewState.north();
    v.drawRadius = opts.drawRadius;
    v.interactRadius = opts.interactRadius;
    // How much of the disk can actually be on screen. At high zoom only a fraction of it is, and
    // culling against the disk instead of the viewport is wasted work.
    v.effectiveRadius = Math.min(
      opts.drawRadius,
      Math.hypot(this.cssWidth, this.cssHeight) / (2 * radius),
    );
    v.interacting = !!viewState.gesture;
    v.toScreen = (x, y) => {
      const out = [0, 0];
      viewState.liveMatrix.applyToLocal(x, y, undefined, out);
      return [out[0] * radius + v.cx, -out[1] * radius + v.cy];
    };
    v.fromScreen = (sx, sy) => {
      const zx = (sx - v.cx) / radius;
      const zy = -(sy - v.cy) / radius;
      if (zx * zx + zy * zy >= 1) return null;
      const inv = viewState.liveMatrix.inverse();
      const out = inv.applyToDisk(zx, zy, [0, 0]);
      const k = 1 / Math.sqrt(1 - out[0] * out[0] - out[1] * out[1]);
      return [out[0] * k, out[1] * k];
    };
    return v;
  }

  // Pointer position in disk coordinates, or null if the event is outside the canvas rect.
  //
  // Uses getBoundingClientRect rather than the 2011 `pageX - canvas.offsetLeft`, which is wrong
  // whenever the canvas is nested inside a positioned element or the page is scrolled. And it uses
  // the LIVE zoom: the 2011 code divided by the committed zoom while drawing with the live one, so
  // wheel-zooming during a drag desynchronised the pointer from the picture.
  eventToDisk(event, zoom) {
    const rect = this.canvas.getBoundingClientRect();
    const radius = this.radiusFor(zoom);
    const x = (event.clientX - rect.left - this.cssWidth / 2) / radius;
    const y = -(event.clientY - rect.top - this.cssHeight / 2) / radius;
    return [x, y];
  }

  destroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.host && this.canvas.parentNode === this.host) this.host.removeChild(this.canvas);
  }
}
