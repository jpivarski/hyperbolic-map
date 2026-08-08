// Does a tile's artwork have C_m rotational symmetry? An OPT-IN LINT, for art that is meant to.
//
// This measures; it does not enforce. Tile frames are canonical -- a tile's frame is a function of the
// tile and not of the route the walk took to it -- so asymmetric art draws identically however you
// scroll, and there is no correctness requirement here for it to check.
//
// What it is FOR is art whose symmetry is part of its meaning. The Escher atlas traces one 90-degree
// sector of a fish and repeats it four times by exact rotation: that C_4 symmetry is what makes the
// result Escher's pattern rather than a different one, and if an edit ever breaks it the picture is
// wrong in a way no other check would notice. Switch this on for such art and leave it off otherwise.
// See notes/tilings.md and docs/MATH.md section 6.
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
// Matching is per-drawable and style-aware: a rotated shape must map onto a shape of the SAME color and
// kind. Matching only the union of points would let a green fish land on a blue one and call the picture
// symmetric, which is precisely the failure that matters -- the shapes can be symmetric while the
// coloring is not, and the coloring is what you see.
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

// What the lint reports. Written out in full because the symptom ("some tiles flip as I scroll")
// gives no hint at all about the cause.
//
// An INFINITE residual is a different finding from a large one, and saying "worst mismatch Infinity"
// on its own sends people looking for a coordinate that blew up. It means the search found no
// candidate at all: some shape has no counterpart of the same style and the same number of points
// anywhere near where the rotation sends it. In practice that is a COLOURING that is less symmetric
// than the outlines -- four fish rotate onto each other but are painted four different colors, so a
// green one is asked to land on a blue one -- or a shape hand-drawn a second time with a different
// number of nodes instead of being rotated.
export function tileSymmetryMessage(residual, m, tilingName, offender) {
  const where = offender == null ? "" : ` (drawable ${offender})`;
  const finding = Number.isFinite(residual)
    ? `worst mismatch ${residual.toExponential(2)} in tile-local units${where}`
    : `one or more shapes have no counterpart at all${where}: nothing of the same color, kind and ` +
      `point count lies where the rotation sends them`;
  return (
    `hyperbolic-map: this tile's artwork is not invariant under rotation by 360/${m} degrees about the ` +
    `tile centre -- ${finding}.\n` +
    `  ${tilingName} has tile stabiliser C_${m}. This is a LINT, not an error: tile frames are canonical, ` +
    `so asymmetric art\n` +
    `  is stable as you scroll, and you only asked to be told because this art is meant to be ` +
    `C_${m}-symmetric.\n` +
    `  Build it from one wedge repeated ${m} times, or set atlas.checkTileSymmetry to "warn" or "off".`
  );
}

// The lint's failure, when it is set to "throw".
//
// A distinct type because the atlas has to tell it apart from a TILE failing. A tile whose data will
// not load is one tile among hundreds: it is reported and skipped, and the map carries on. A lint the
// caller deliberately set to "throw" is a statement about the ARTWORK, and downgrading it to a skipped
// tile turns the loudest setting into the quietest one -- a single tile silently missing, which is
// exactly the sort of thing nobody notices until it is the tile under the cursor.
export class TileSymmetryError extends Error {
  constructor(message) {
    super(message);
    this.name = "TileSymmetryError";
  }
}
