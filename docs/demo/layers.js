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

  // How far to turn the shell, in atlas mode as well as single-patch.
  //
  // `view.rotation` is the screen rotation of the view matrix, and in ATLAS mode that matrix is
  // expressed in the anchor tile's own frame. The anchor changes as you walk, and each change is a
  // multiplication by one generator, which carries a rotation of its own -- so `view.rotation` JUMPS.
  // Measured on dungeon-man.html: up to 34.2 degrees, from a pan step of 0.009 hyperbolic units,
  // while the dungeon itself stays perfectly smooth across the same boundary. Feeding that straight
  // to ctx.rotate makes the shell snap while the world it is supposedly carrying does not.
  //
  // So the jump is cancelled: when the anchor changes, absorb the difference into an offset and keep
  // drawing at the angle we were already at. Between re-anchors this is exactly `view.rotation`, so a
  // rim drag turns the shell by precisely the angle swept.
  //
  // What this deliberately does NOT attempt is a shell rigidly pinned to the plane. That needs the
  // global frame -- the one thing an atlas has no representation for -- and there is no bounded
  // substitute: accumulating the camera's incremental rotation instead drifts 9.9 degrees over a
  // straight 2.5-unit walk and 71 degrees around a closed loop, because what it drops IS the
  // holonomy. Continuity is attainable and is what the eye actually checks; absolute registration
  // against a point at infinity is not, and nothing on screen reveals its absence.
  let lastRaw = null;
  let lastAnchor = null;
  let offset = 0;
  function diskRotation(view) {
    const atlas = viewport && viewport.atlas;
    if (!atlas) return view.rotation;      // single patch: the view frame is global, nothing to fix
    const id = atlas.tiling.addressToString(atlas.anchor.address);
    if (lastAnchor !== null && id !== lastAnchor) offset += lastRaw - view.rotation;
    lastAnchor = id;
    lastRaw = view.rotation;
    return view.rotation + offset;
  }
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
      // Tracked every frame, BEFORE the visibility test: the jump correction compares against the
      // previous frame, so letting it go stale while the shell is hidden would make it reappear with
      // one large bogus correction after a zoom-out.
      const turn = rotateWithDisk ? diskRotation(view) : 0;

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
      if (rotateWithDisk) ctx.rotate(-turn);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
    },
  };
}
