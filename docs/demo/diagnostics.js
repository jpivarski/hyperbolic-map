// Diagnostic artwork for the tiling test page. NOT part of the library.
//
// ---------------------------------------------------------------------------------------------
// THE RULE THIS ART USED TO HAVE TO OBEY, AND WHY IT NO LONGER DOES
// ---------------------------------------------------------------------------------------------
//
// On a {p,q} tiling a tile's frame is defined only UP TO the tile stabiliser C_m (m = frameSymmetry,
// default p). The renderer used to reach each tile by the shortest route from the CAMERA, so when the
// camera crossed into a new tile the routes changed and every tile's frame could change by a rotation
// of 2*pi*k/m about its own centre -- and its word address changed with it. That forced a rule on the
// artist: art had to be C_m-invariant and had to ignore the address, or it jumped as you scrolled.
//
// The freedom is still in the group. What changed is that the library now spends it once, globally,
// instead of leaving it to the route: a tile's frame is the lexicographically least element of its
// coset F.C_m, computed exactly in the Coxeter representation over Z[mu], and its id is that frame's
// tile centre. Both are functions of the TILE. So:
//
//     TILE ART MAY NOW BE FULLY ASYMMETRIC AND MAY DEPEND ON THE TILE ID.
//
// The motifs that were built to demonstrate the rule are kept, because they are now the sharpest
// available test of the fix: art that would have jumped is exactly the art that proves it does not.
//
// ---------------------------------------------------------------------------------------------
// The motifs
// ---------------------------------------------------------------------------------------------
//
//   sym     THE DEFAULT (formerly `legal`). An asymmetric hook repeated under C_m. Reveals position,
//           orientation and handedness, so a mirrored or misplaced tile is obvious, while a 2*pi/m
//           rotation is invisible -- which makes it the motif that CANNOT detect a frame rotation, and
//           so the control. Coloured by tile class.
//
//   asym    (formerly `illegal`.) The same hook drawn ONCE, coloured by hash(id). Under the old design
//           this violated both halves of the rule on purpose and tiles visibly snapped to new colours
//           and orientations as you crossed a boundary. It is now the acceptance test: scroll with this
//           selected and nothing may change discontinuously.
//
//   art     Proper test art: a PINWHEEL, built the same way the Circle Limit III tile is built -- one
//           wedge of 2*pi/m, filled with a curved asymmetric blade and an off-axis dot, repeated m
//           times by exact rotation. Symmetric to machine precision by construction, and asymmetric in
//           every way the rule permits: no mirror, no rotation finer than 2*pi/m. Fills the tile, so
//           gaps and misplacement show up as well as rotation.
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

// A stable, well-spread colour from a string. Neighbouring ids differ in only part of their text, so
// the hash must mix hard or adjacent tiles come out nearly the same colour.
//
// This used to be legal only on the binary tiling, whose (lat, lon) addresses were the only canonical
// ones; on a {p,q} tiling it was the colour that jumped at every re-anchor. Every tiling's addresses
// are canonical now, so it is legal everywhere.
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

// Lighten (t > 0) or darken (t < 0) an hsl() colour, keeping the hue so the tile class stays readable.
function shade(css, t) {
  const m = /hsl\((\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\)/.exec(css);
  if (!m) return css;
  const h = +m[1];
  const s2 = +m[2];
  const l = +m[3];
  const nl = t > 0 ? l + (100 - l) * t : l * (1 + t);
  return `hsl(${h} ${Math.max(12, s2 - (t > 0 ? 18 : 0))}% ${Math.max(6, Math.min(94, nl))}%)`;
}

// The binary cell's outline, sampled along its two horocyclic and two geodesic sides.
function binaryCellOutline(b) {
  const H = window.HyperbolicMap;
  const N = 14;
  const points = [];
  for (let i = 0; i <= N; i++) points.push(H.halfPlaneToLocal(-b.halfWidth + (2 * b.halfWidth * i) / N, b.yLow, [0, 0]));
  for (let i = 1; i <= N; i++) points.push(H.halfPlaneToLocal(b.halfWidth, b.yLow * Math.pow(b.yHigh / b.yLow, i / N), [0, 0]));
  for (let i = 1; i <= N; i++) points.push(H.halfPlaneToLocal(b.halfWidth - (2 * b.halfWidth * i) / N, b.yHigh, [0, 0]));
  for (let i = 1; i < N; i++) points.push(H.halfPlaneToLocal(-b.halfWidth, b.yHigh * Math.pow(b.yLow / b.yHigh, i / N), [0, 0]));
  return points;
}

// Rotate tile-local coordinates about the tile centre. In local ("companion") coordinates that is an
// ordinary Euclidean rotation, which is both exact and exactly what the library's symmetry check does --
// so art built this way passes that check to machine precision rather than approximately.
function rotateLocal(points, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return points.map(([x, y]) => [x * c - y * s, x * s + y * c]);
}

// One wedge of the pinwheel: a curved blade sweeping across 2*pi/m, plus a dot placed off the wedge's
// own axis. Neither is mirror-symmetric, so the finished motif's symmetry group is EXACTLY C_m -- which
// is the most asymmetry the rule allows. Sized from the tiling's own inradius so it fits {3,7}'s small
// triangles and still fills {12,3}'s dodecagons.
function pinwheelWedge(tiling, m) {
  const psi = tiling.metrics.inradius;
  const rad = (f) => Math.sinh((psi * f) / 2);
  const W = (2 * Math.PI) / m;
  const N = 14;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    pts.push([rad(0.20 + 0.72 * t), W * (0.07 + 0.68 * Math.pow(t, 0.75))]);
  }
  for (let i = N; i >= 0; i--) {
    const t = i / N;
    pts.push([rad(0.16 + 0.60 * t), W * (0.02 + 0.30 * Math.pow(t, 1.5))]);
  }
  return pts.map(([r, a]) => [r * Math.cos(a), r * Math.sin(a)]);
}

function wedgeDot(tiling, m) {
  const psi = tiling.metrics.inradius;
  const W = (2 * Math.PI) / m;
  const r = Math.sinh((psi * 0.60) / 2);
  const a = W * 0.52;
  const cx = r * Math.cos(a);
  const cy = r * Math.sin(a);
  const rr = Math.sinh((psi * 0.10) / 2);
  const out = [];
  for (let i = 0; i < 10; i++) {
    const th = (2 * Math.PI * i) / 10;
    out.push([cx + rr * Math.cos(th), cy + rr * Math.sin(th)]);
  }
  return out;
}

export function motifFor(tiling, spec, address, opts) {
  const H = window.HyperbolicMap;
  // `sym` and `asym` are the names. `legal` and `illegal` are what they were called when a tile's
  // frame depended on the route and asymmetric art really was forbidden; they are still accepted so
  // that saved URLs keep working, but nothing here is illegal any more.
  const motif = opts.motif === "legal" ? "sym" : opts.motif === "illegal" ? "asym" : opts.motif;
  const drawables = [];

  // Colour, in three flavours:
  //
  //   uniform     every tile the same. Needed by the translation-invariance check, which asks whether
  //               the picture at 5000 tiles out is byte-identical to the picture at the origin. Class
  //               colours legitimately fail that: a 3-colouring is invariant under the class-preserving
  //               subgroup, not under every translation, so moving one tile shifts the colours.
  //   class       one hue per tile class (the page default, because it is informative).
  //   hashColour  hash of the tile id. This is the one that used to jump, and the reason it does not
  //               any more is the whole point of the canonical-id work: the id is a function of the
  //               tile, not of the route the walk took to reach it.
  const colour = opts.uniform
    ? "#1a5fb4"
    : opts.hashColour
      ? colourFor(tiling.addressToString(address))
      : legalColourFor(tiling, address);

  const m = spec.binary ? 1 : tiling.stabiliserOrder || tiling.m || tiling.p;

  if (motif === "art") {
    const b = tiling.boundaryLocal();
    const base = b.kind === "binary-cell" ? binaryCellOutline(b) : b.points.map((p) => [p[0], p[1]]);
    drawables.push({ type: "path", points: base, closed: true, fill: colour, stroke: "none" });
    if (spec.binary) {
      // Trivial stabiliser: no constraint at all, so the blade is drawn once and may be as asymmetric
      // as it likes. This is exactly why the binary tiling was always the one that scrolled cleanly.
      const H2 = window.HyperbolicMap;
      const hw = H2.BINARY_LOCAL_HALF_WIDTH;
      const blade = [
        [-hw * 0.55, 1.05 / Math.SQRT2], [hw * 0.10, 1.05 / Math.SQRT2],
        [hw * 0.62, 1.24 / Math.SQRT2], [hw * 0.05, 1.33 / Math.SQRT2],
        [-hw * 0.30, 1.20 / Math.SQRT2],
      ].map(([hx, hy]) => H2.halfPlaneToLocal(hx, hy, [0, 0]));
      drawables.push({ type: "path", points: blade, closed: true, fill: shade(colour, -0.42), stroke: "none" });
      const dot = H2.halfPlaneToLocal(hw * 0.42, 1.12 / Math.SQRT2, [0, 0]);
      drawables.push({ type: "marker", at: dot, radius: 3.2, fill: shade(colour, 0.55) });
      return drawables;
    }
    const blade = pinwheelWedge(tiling, m);
    const dot = wedgeDot(tiling, m);
    const dark = shade(colour, -0.42);
    const light = shade(colour, 0.55);
    for (let k = 0; k < m; k++) {
      const a = (2 * Math.PI * k) / m;
      drawables.push({ type: "path", points: rotateLocal(blade, a), closed: true, fill: dark, stroke: "none" });
    }
    for (let k = 0; k < m; k++) {
      const a = (2 * Math.PI * k) / m;
      drawables.push({ type: "path", points: rotateLocal(dot, a), closed: true, fill: light, stroke: "none" });
    }
    return drawables;
  }

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
  // `sym` repeats the stroke under C_m, so a 2*pi/m rotation of the frame is invisible. `asym` draws it
  // once, so any rotation of the frame is plainly visible -- which is what makes it the test.
  const copies = [];
  if (motif === "asym" || m <= 1) {
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
