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
      // "auto" follows window.devicePixelRatio. The 2011 code had no notion of this, so its
      // canvases were blurry on HiDPI displays; pass 1 to reproduce that.
      devicePixelRatio = "auto",
      // "min" sizes the disk by min(width, height) so it always fits. The 2011 code used the
      // canvas WIDTH for both axes, which overflows vertically on a portrait canvas. That is a
      // behaviour difference, not a bug, so both are available.
      radiusBasis = "min",
    } = options || {};

    this.autoResize = autoResize;
    this.dprOption = devicePixelRatio;
    this.radiusBasis = radiusBasis;

    if (canvas) {
      this.canvas = canvas;
    } else {
      const host = typeof container === "string" ? document.querySelector(container) : container;
      if (!host) throw new Error("hyperbolic-map: no container element found");
      this.host = host;
      this.canvas = document.createElement("canvas");
      this.canvas.style.display = "block";
      host.appendChild(this.canvas);
    }

    this.cssWidth = width || (this.host ? this.host.clientWidth : this.canvas.clientWidth) || 400;
    this.cssHeight = height || (this.host ? this.host.clientHeight : this.canvas.clientHeight) || this.cssWidth;

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
      const h = target.clientHeight;
      if (w > 0 && h > 0 && (w !== this.cssWidth || h !== this.cssHeight)) {
        this.resize(w, h);
        onResize();
      }
    });
    this.resizeObserver.observe(target);
  }

  // The disk radius in CSS pixels for a given zoom.
  radiusFor(zoom) {
    const basis = this.radiusBasis === "width" ? this.cssWidth : Math.min(this.cssWidth, this.cssHeight);
    return (zoom * basis) / 2;
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
