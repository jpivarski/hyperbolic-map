// Example layers. NOT part of the library.
//
// This file exists to demonstrate that everything outside the Poincare disk is the page's business.
// The 2011 viewer had `backgroundImage`, `shellImage` and `shellImageScale` options, which baked one
// example's art (a world-turtle on a field of stars) into the library itself. Those options are
// gone; this reproduces the same look from outside, using only the documented layer interface.
//
// A layer is `{ z, draw(ctx, view), attach?(viewport), detach?() }`. Layers with z < 0 are drawn
// before the disk's opaque fill, so they show only OUTSIDE the disk -- which is exactly what the
// turtle and the stars need.

/* global window */

export function imageLayer(spec) {
  const {
    src,
    z = -10,
    rotateWithDisk = false,
    // "cover" fills the canvas; otherwise the image is scaled to `scale` x the disk diameter,
    // reproducing the 2011 `shellImageScale`.
    fit = "scale",
    scale = 1,
    // The 2011 code hid these once the disk was larger than the canvas diagonal, since there was
    // then nothing outside the disk to see.
    hideWhenDiskFills = true,
    opacity = 1,
  } = spec;

  const img = new Image();
  let viewport = null;
  // The 2011 code wired up img.onload by hand in the constructor and could miss an image that was
  // already cached. Requesting a redraw on load is both simpler and more reliable.
  img.addEventListener("load", () => {
    if (viewport) viewport.invalidate();
  });
  img.src = src;

  return {
    z,
    attach(vp) {
      viewport = vp;
      if (img.complete && img.naturalWidth) vp.invalidate();
    },
    detach() {
      viewport = null;
    },
    draw(ctx, view) {
      if (!img.complete || !img.naturalWidth) return;
      const diagonal = Math.hypot(view.width, view.height);
      if (hideWhenDiskFills && 2 * view.radius >= diagonal) return;

      let w;
      if (fit === "cover") {
        w = view.width < view.height
          ? (view.height * img.naturalWidth) / img.naturalHeight
          : view.width;
        if (w * (img.naturalHeight / img.naturalWidth) < view.height) {
          w = (view.height * img.naturalWidth) / img.naturalHeight;
        }
      } else {
        w = scale * 2 * view.radius;
      }
      const h = (w * img.naturalHeight) / img.naturalWidth;

      ctx.save();
      if (opacity !== 1) ctx.globalAlpha = opacity;
      ctx.translate(view.cx, view.cy);
      // The shell turns with the disk; the star field behind it does not. That contrast is the
      // whole visual joke, and it costs one line.
      if (rotateWithDisk) ctx.rotate(-view.rotation);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
    },
  };
}

// A small "you are here" crosshair drawn on top, to show an overlay layer (z >= 0).
export function crosshairLayer({ z = 10, colour = "rgba(0,0,0,0.35)", size = 8 } = {}) {
  return {
    z,
    draw(ctx, view) {
      ctx.save();
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(view.cx - size, view.cy);
      ctx.lineTo(view.cx + size, view.cy);
      ctx.moveTo(view.cx, view.cy - size);
      ctx.lineTo(view.cx, view.cy + size);
      ctx.stroke();
      ctx.restore();
    },
  };
}
