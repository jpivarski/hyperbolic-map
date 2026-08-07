// Diagnostic artwork for the tiling test page. NOT part of the library.
//
// ---------------------------------------------------------------------------------------------
// THE RULE THIS ART HAS TO OBEY
// ---------------------------------------------------------------------------------------------
//
// On a {p,q} tiling a tile's frame is defined only UP TO the tile stabiliser C_m (m = frameSymmetry,
// default p). The renderer reaches each tile by the shortest route from the CAMERA, so when the camera
// crosses into a new tile the routes change and every tile's frame can change by a rotation of 2*pi*k/m
// about its own centre. That is a property of the group, not a bug to be fixed, so:
//
//     TILE ART MUST BE INVARIANT UNDER ROTATION BY 2*pi/m ABOUT THE TILE CENTRE,
//     AND MUST NOT DEPEND ON THE TILE'S WORD ADDRESS.
//
// Art that breaks either half looks fine standing still and JUMPS as you scroll. Both halves matter:
//
//   * shape -- an asymmetric stroke rotates by a multiple of 2*pi/m at a re-anchor;
//   * colour -- a word address is not canonical, so hash(address) changes at a re-anchor even though
//     the tile has not moved. Colour must come from `tiling.tileClass(address)`, which is derived from
//     a group homomorphism and so is the same whichever route the walk took.
//
// The binary tiling is exempt from both: its stabiliser is trivial and its (lat, lon) addresses are
// canonical, which is why it was the one tiling that always scrolled cleanly.
//
// ---------------------------------------------------------------------------------------------
// The motifs
// ---------------------------------------------------------------------------------------------
//
//   legal   THE DEFAULT. An asymmetric hook repeated under C_m -- the most asymmetric thing the rule
//           permits. Reveals position, orientation and handedness, so a mirrored or misplaced tile is
//           obvious, while a 2*pi/m rotation (which the renderer is entitled to apply) is invisible.
//           Coloured by tile class.
//
//   illegal The same hook drawn ONCE, coloured by hash(address). Violates both halves of the rule on
//           purpose. Kept because it is the sharpest demonstration of what the rule is for: scroll with
//           this selected and tiles visibly snap to new colours and orientations as you cross a
//           boundary. Do not copy it into real art.
//
//   fill    A flat polygon covering the whole tile, for the per-pixel ownership check. The tile outline
//           is C_p-symmetric so this satisfies the rule automatically.
//
//   over    The same fill, deliberately SCALED PAST the tile boundary, so clipping has something to do.
//           With clipping on, the result must be pixel-for-pixel `fill`. Filling exactly to the boundary
//           cannot test clipping at all: clipping a shape to its own outline is a no-op.

/* global window */

export const DIAG_TILINGS = {
  "8,3,4": { label: "{8,3} m=4 (Circle Limit III group)", p: 8, q: 3, frameSymmetry: 4 },
  "8,3,0": { label: "{8,3} octagons", p: 8, q: 3 },
  "7,3,0": { label: "{7,3} heptagons", p: 7, q: 3 },
  "5,4,0": { label: "{5,4} pentagons", p: 5, q: 4 },
  "4,5,0": { label: "{4,5} squares, 5/vertex", p: 4, q: 5 },
  "6,4,0": { label: "{6,4} hexagons, 4/vertex", p: 6, q: 4 },
  "3,7,0": { label: "{3,7} triangles, 7/vertex", p: 3, q: 7 },
  "12,3,0": { label: "{12,3} dodecagons", p: 12, q: 3 },
  binary: { label: "binary (Boroczky)", binary: true },
};

export function makeTiling(key) {
  const H = window.HyperbolicMap;
  const spec = DIAG_TILINGS[key];
  if (!spec) throw new Error(`unknown diagnostic tiling ${key}`);
  return spec.binary ? new H.BinaryTiling() : new H.RegularTiling(spec);
}

// A stable, well-spread colour from a string. Neighbouring addresses differ in their last symbol, so
// the hash must mix hard or adjacent tiles come out nearly the same colour.
//
// LEGAL ONLY where addresses are canonical -- that is, the binary tiling. On a {p,q} tiling this is the
// colour that jumps, and the `illegal` motif exists to show it doing so.
export function colourFor(addressString) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < addressString.length; i++) {
    h ^= addressString.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 2246822507) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  const hue = h % 360;
  const sat = 55 + ((h >>> 9) % 35);
  const light = 38 + ((h >>> 17) % 22);
  return `hsl(${hue} ${sat}% ${light}%)`;
}

// The legal per-tile colour: one hue per tile CLASS. Classes come from a group homomorphism, so they are
// the same whichever route the walk took -- and adjacent tiles always differ, so the tiling still reads
// as a proper colouring rather than a flat wash.
const CLASS_HUES = [210, 25, 140, 300, 60, 180];

export function colourForClass(classIndex, classCount) {
  if (classCount <= 1) return "hsl(210 58% 47%)";
  const hue = CLASS_HUES[classIndex % CLASS_HUES.length];
  return `hsl(${hue} ${58 + ((classIndex * 7) % 18)}% ${44 + ((classIndex * 5) % 14)}%)`;
}

// The colour a tile is allowed to have, given what its tiling can canonically distinguish.
export function legalColourFor(tiling, address) {
  if (tiling.addressesAreCanonical) return colourFor(tiling.addressToString(address));
  return colourForClass(tiling.tileClass(address), tiling.classModulus || 1);
}

// The tile-local geometry of the asymmetric stroke, per tiling. Built from the tiling's own metrics so
// it scales with the tile: a fixed size would spill out of {3,7}'s small triangles and be lost inside
// {12,3}'s large dodecagons.
function strokeGeometry(tiling, spec) {
  const H = window.HyperbolicMap;
  if (spec.binary) {
    // In the cell's own half-plane box: up the middle, then a hook to one side. Asymmetric in x, so a
    // mirrored frame is visible. No symmetry constraint here -- the binary stabiliser is trivial.
    const hw = H.BINARY_LOCAL_HALF_WIDTH;
    const pts = [
      [0, 1.02 / Math.SQRT2],
      [0, 1.30 / Math.SQRT2],
      [hw * 0.62, 1.30 / Math.SQRT2],
      [hw * 0.62, 1.16 / Math.SQRT2],
    ];
    return pts.map(([hx, hy]) => H.halfPlaneToLocal(hx, hy, [0, 0]));
  }
  // Regular: centre -> edge-0 midpoint (at the inradius, bearing 0), then a hook turning +90 degrees.
  const psi = tiling.metrics.inradius;
  const out = [];
  const along = (frac) => Math.sinh((psi * frac) / 2);
  out.push([0, 0]);
  out.push([along(0.86), 0]);
  // The hook: same radius, swung to a positive bearing. Using a bearing rather than a straight offset
  // keeps it inside the tile for every {p,q}, including the thin triangles of {3,7}.
  const hookR = along(0.62);
  const hookA = (Math.PI / Math.max(3, tiling.p)) * 1.15;
  out.push([hookR * Math.cos(hookA), hookR * Math.sin(hookA)]);
  return out;
}

// Rotate tile-local coordinates about the tile centre. In local ("companion") coordinates that is an
// ordinary Euclidean rotation, which is both exact and exactly what the library's symmetry check does --
// so art built this way passes that check to machine precision rather than approximately.
function rotateLocal(points, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return points.map(([x, y]) => [x * c - y * s, x * s + y * c]);
}

export function motifFor(tiling, spec, address, opts) {
  const H = window.HyperbolicMap;
  const motif = opts.motif === "sym" ? "legal" : opts.motif === "asym" ? "illegal" : opts.motif;
  const drawables = [];

  // Colour, in three flavours:
  //
  //   uniform     every tile the same. Needed by the translation-invariance check, which asks whether
  //               the picture at 5000 tiles out is byte-identical to the picture at the origin. Class
  //               colours legitimately fail that: a 3-colouring is invariant under the class-preserving
  //               subgroup, not under every translation, so moving one tile shifts the colours.
  //   class       the legal per-tile colour (default on the page, because it is informative).
  //   hashColour  the ILLEGAL address hash, kept so the two halves of the rule can be shown separately.
  const colour = opts.uniform
    ? "#1a5fb4"
    : opts.hashColour
      ? colourFor(tiling.addressToString(address))
      : legalColourFor(tiling, address);

  const m = spec.binary ? 1 : tiling.stabiliserOrder || tiling.m || tiling.p;

  if (motif === "fill" || motif === "over") {
    // `over` pushes every boundary point outward along its own bearing, so the art spills into the
    // neighbours by a fixed hyperbolic margin and clipping has something to do.
    const grow = motif === "over" ? 1.45 : 1;
    const b = tiling.boundaryLocal();
    let points;
    if (b.kind === "binary-cell") {
      const N = 14;
      points = [];
      for (let i = 0; i <= N; i++) points.push(H.halfPlaneToLocal(-b.halfWidth + (2 * b.halfWidth * i) / N, b.yLow, [0, 0]));
      for (let i = 1; i <= N; i++) points.push(H.halfPlaneToLocal(b.halfWidth, b.yLow * Math.pow(b.yHigh / b.yLow, i / N), [0, 0]));
      for (let i = 1; i <= N; i++) points.push(H.halfPlaneToLocal(b.halfWidth - (2 * b.halfWidth * i) / N, b.yHigh, [0, 0]));
      for (let i = 1; i < N; i++) points.push(H.halfPlaneToLocal(-b.halfWidth, b.yHigh * Math.pow(b.yLow / b.yHigh, i / N), [0, 0]));
    } else {
      points = b.points.map((p) => [p[0], p[1]]);
    }
    const scaled = points.map(([x, y]) => {
      if (grow === 1) return [x, y];
      const r = Math.hypot(x, y);
      if (r === 0) return [x, y];
      // Scale the hyperbolic radius, not the local coordinate, so the margin is geometric rather than
      // shrinking with distance from the tile centre.
      const d = 2 * Math.asinh(r);
      const rr = Math.sinh((d * grow) / 2);
      return [(x / r) * rr, (y / r) * rr];
    });
    drawables.push({ type: "path", points: scaled, closed: true, fill: colour, stroke: "none" });
    return drawables;
  }

  const base = strokeGeometry(tiling, spec);
  // `legal` repeats the stroke under C_m, which is exactly what makes it invariant. `illegal` draws it
  // once, which is exactly what makes it jump.
  const copies = [];
  if (motif === "illegal" || m <= 1) {
    copies.push(base);
  } else {
    for (let k = 0; k < m; k++) copies.push(rotateLocal(base, (2 * Math.PI * k) / m));
  }

  for (const pts of copies) {
    drawables.push({
      type: "path",
      // An OPEN line: the last point carries no closing flag, so nothing is filled and the stroke's
      // shape is exactly what was asked for.
      points: pts.map((p, i) => (i === pts.length - 1 ? [p[0], p[1]] : [p[0], p[1], "L"])),
      closed: false,
      stroke: colour,
      fill: "none",
      lineWidth: 2.5,
      lineCap: "round",
    });
  }
  // A dot at the tile centre, so the tile's own position is unambiguous even when the stroke is short.
  // The centre is a fixed point of every rotation, so this is invariant for free.
  drawables.push({ type: "marker", at: [0, 0], radius: 2.6, fill: colour });
  return drawables;
}
