// Diagnostic artwork for the tiling test page. NOT part of the library.
//
// The whole design goal is that a human can see when it is wrong. Three motifs, each answering a
// different question:
//
//   asym  an open, ASYMMETRIC line: centre -> edge-0 midpoint, then a hook turning one way, plus a dot
//         at the centre. Reveals position, orientation AND handedness, so a tile placed with the wrong
//         rotation or a mirrored frame is obvious rather than plausible.
//
//   sym   the same stroke repeated under the tile's own symmetry group, giving artwork that IS
//         invariant under the tile stabiliser. Needed for the exact far-field invariance check: with
//         asymmetric art the decorated tiling is not group-invariant, so "the picture at 500 tiles out
//         is identical to the picture at the origin" would fail by construction rather than by bug.
//
//   fill  a flat polygon covering the whole tile, for the per-pixel ownership check. Any clipping error
//         shows up as a band of the wrong colour along a tile boundary.
//
//   over  the same fill, deliberately SCALED PAST the tile boundary. This is the one that actually
//         tests clipping: with clipping on, the result must be pixel-for-pixel the same as `fill`,
//         because the overflow is trimmed away; with it off, neighbours overwrite each other. Filling
//         exactly to the boundary cannot test clipping at all -- clipping a shape to its own outline is
//         a no-op, and the two renders come out identical whether the clip works or not.
//
// Colour is a hash of the tile ADDRESS, so geometry and addressing fail independently and visibly:
// wrong place is a geometry bug, wrong colour is an addressing bug.

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

// A stable, well-spread colour from an address string. Neighbouring addresses differ in their last
// symbol, so the hash must mix hard or adjacent tiles come out nearly the same colour and the whole
// point of colouring is lost.
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

// The tile-local geometry of the asymmetric stroke, per tiling. Built from the tiling's own metrics so
// it scales with the tile: a fixed size would spill out of {3,7}'s small triangles and be lost inside
// {12,3}'s large dodecagons.
function strokeGeometry(tiling, spec) {
  const H = window.HyperbolicMap;
  if (spec.binary) {
    // In the cell's own half-plane box: up the middle, then a hook to one side. Asymmetric in x, so a
    // mirrored frame is visible.
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
  const hookA = Math.PI / Math.max(3, tiling.p) * 1.15;
  out.push([hookR * Math.cos(hookA), hookR * Math.sin(hookA)]);
  return out;
}

export function motifFor(tiling, spec, address, opts) {
  const H = window.HyperbolicMap;
  const id = tiling.addressToString(address);
  const colour = opts.hashColour ? colourFor(id) : "#1a5fb4";
  const drawables = [];

  if (opts.motif === "fill" || opts.motif === "over") {
    // `over` pushes every boundary point outward along its own bearing, so the art spills into the
    // neighbours by a fixed hyperbolic margin and clipping has something to do.
    const grow = opts.motif === "over" ? 1.45 : 1;
    // The whole tile, flat. Used for the ownership check: each pixel must be painted by exactly the
    // tile that contains it.
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
  const copies = [];
  if (opts.motif === "sym" && !spec.binary) {
    // Repeat under the tile's own rotational symmetry, so the decorated tiling becomes genuinely
    // group-invariant and the far-field comparison can demand byte-identical output.
    const m = tiling.m || tiling.p;
    for (let k = 0; k < m; k++) {
      const rot = H.Isom.rotation((2 * Math.PI * k) / m);
      copies.push(base.map((p) => {
        const z = rot.applyToLocal(p[0], p[1], undefined, [0, 0]);
        const kk = 1 / Math.sqrt(1 - z[0] * z[0] - z[1] * z[1]);
        return [z[0] * kk, z[1] * kk];
      }));
    }
  } else if (opts.motif === "sym" && spec.binary) {
    // The binary cell's own stabiliser is trivial, so "symmetrised" is the same single stroke. Said out
    // loud because it would otherwise look like an omission.
    copies.push(base);
  } else {
    copies.push(base);
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
  drawables.push({ type: "marker", at: [0, 0], radius: 2.6, fill: colour });
  return drawables;
}
