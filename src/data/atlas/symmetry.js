// Does a tile's artwork satisfy the symmetry the tiling requires of it?
//
// THE RULE. In a {p,q} atlas a tile's frame is defined only UP TO the tile stabiliser C_m (m =
// `frameSymmetry`, default p). The walk reaches each tile by the shortest route from the CAMERA, so
// when the camera crosses into a new tile the routes change and every tile's frame can change by a
// rotation of 2*pi*k/m about its own centre. Nothing can prevent that -- it is a property of the group,
// not of the implementation -- so the art must be invariant under it. Art that is not simply rotates on
// screen as you scroll: measured on {8,3} m=4, 16 of 30 on-screen tiles jumped by a multiple of 90
// degrees at a single re-anchor.
//
// This is very easy to get wrong and completely invisible until you scroll, so the library checks it
// rather than only documenting it. See notes/tilings.md and docs/MATH.md section 6.
//
// The check is deliberately on the RAW drawables in tile-local coordinates: a rotation about the tile
// centre is an ordinary Euclidean rotation there, so this is exact and needs no geometry.

// A style key: two drawables can only be images of one another if they look the same.
function styleKey(d) {
  return [
    d.type || "path",
    d.fill || "",
    d.stroke || "",
    d.lineWidth == null ? "" : d.lineWidth,
    d.closed ? "c" : "o",
    d.lineCap || "",
    d.radius == null ? "" : d.radius,
  ].join("|");
}

function pointsOf(d) {
  if (d.points) return d.points;
  if (d.at) return [d.at];
  if (d.from && d.to) return [d.from, d.to];
  return null;
}

// The largest distance by which any point of the artwork fails to land on the artwork after rotating by
// 2*pi/m about the tile centre. Zero means exactly invariant.
//
// Matching is per-drawable and style-aware: a rotated shape must map onto a shape of the SAME colour and
// kind. Matching only the union of points would let a green fish land on a blue one and call the picture
// symmetric, which is precisely the failure that matters -- the shapes can be symmetric while the
// colouring is not, and the colouring is what you see.
export function tileSymmetryResidual(drawables, m) {
  if (!drawables || !drawables.length || !(m > 1)) return { residual: 0, checked: 0, offender: null };
  const angle = (2 * Math.PI) / m;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);

  // Index drawables by style, with a coarse grid on their centroid.
  const byStyle = new Map();
  const items = [];
  for (let i = 0; i < drawables.length; i++) {
    const pts = pointsOf(drawables[i]);
    if (!pts || !pts.length) continue;
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      cx += p[0];
      cy += p[1];
    }
    cx /= pts.length;
    cy /= pts.length;
    const item = { i, pts, cx, cy, key: styleKey(drawables[i]) };
    items.push(item);
    let bucket = byStyle.get(item.key);
    if (!bucket) {
      bucket = [];
      byStyle.set(item.key, bucket);
    }
    bucket.push(item);
  }

  let residual = 0;
  let offender = null;
  for (const item of items) {
    // Where this shape must land.
    const rcx = item.cx * ca - item.cy * sa;
    const rcy = item.cx * sa + item.cy * ca;
    const bucket = byStyle.get(item.key) || [];
    // The best candidate is the same-style shape with the same point count whose centroid is nearest.
    let best = Infinity;
    for (const cand of bucket) {
      if (cand.pts.length !== item.pts.length) continue;
      if (Math.hypot(cand.cx - rcx, cand.cy - rcy) > 0.35) continue;
      // Hausdorff-style: every rotated point must be close to some point of the candidate.
      let worstPt = 0;
      for (const p of item.pts) {
        const qx = p[0] * ca - p[1] * sa;
        const qy = p[0] * sa + p[1] * ca;
        let near = Infinity;
        for (const o of cand.pts) {
          const dd = Math.hypot(o[0] - qx, o[1] - qy);
          if (dd < near) near = dd;
        }
        if (near > worstPt) worstPt = near;
        if (worstPt >= best) break;
      }
      if (worstPt < best) best = worstPt;
    }
    if (best > residual) {
      residual = best;
      offender = item.i;
    }
  }
  return { residual: Number.isFinite(residual) ? residual : Infinity, checked: items.length, offender };
}

// The message the library prints when art violates the rule. Written out in full because the symptom
// ("some tiles flip as I scroll") gives no hint at all about the cause.
export function tileSymmetryMessage(residual, m, tilingName) {
  return (
    `hyperbolic-map: this tile's artwork is not invariant under rotation by 360/${m} degrees about the ` +
    `tile centre (worst mismatch ${residual.toExponential(2)} in tile-local units).\n` +
    `  ${tilingName} has tile stabiliser C_${m}, which means a tile's frame is only defined UP TO that ` +
    `rotation.\n` +
    `  The walk reaches each tile by the shortest route from the camera, so the route -- and with it the ` +
    `rotation -- changes\n` +
    `  as you scroll. Art that is not C_${m}-invariant will visibly JUMP when the camera crosses a tile ` +
    `boundary.\n` +
    `  Fix the art (build it from one wedge repeated ${m} times), or choose a tiling whose stabiliser is ` +
    `trivial.\n` +
    `  Set atlas.checkTileSymmetry to "off" to silence this, or "throw" to make it fatal.`
  );
}
