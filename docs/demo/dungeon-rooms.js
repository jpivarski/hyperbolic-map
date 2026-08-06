// Procedural dungeon rooms. NOT part of the library.
//
// A port of the 2012 server-side generator (GeographicalTiles.writeDungeon / dungeonPoint /
// latitudeRange / longitudeRange), which streamed these to the browser. Here it runs in the page, as
// a plain data-source callback, which is the point: the library does not need to know what a dungeon
// room is.
//
// Rooms sit on cells of the BINARY (Boroczky) tiling of the hyperbolic plane, indexed by two
// integers. In the upper half-plane, cell (latitude, longitude) is
//
//     x in [longitude * 2^latitude, (longitude + 1) * 2^latitude]
//     y in [2^latitude, 2^(latitude + 1)]
//
// so point -> cell is two floors. Every cell has five neighbours -- one parent, two children and two
// lateral -- which is where the "five doors" come from.
//
// Two corrections to the 2012 generator are applied here; see notes/math-audit.md:
//
//   * localToHalfPlane's denominator cancelled catastrophically and hit exactly zero by y ~ 1e4,
//     which is INSIDE this dataset's range (it reaches y = 11711.92). The stable form is used.
//   * longitudeRange evaluated the visible circle's width at the BOTTOM of each latitude band
//     instead of at its widest point, missing about 46% of the cells it should have returned. The
//     2012 git history has a commit called "fix missing rooms"; this is why.

/* global HyperbolicMap */

const { halfPlaneToLocal } = HyperbolicMap;

// Half-plane -> local, using the corrected stable conversion via the library.
function hp(x, y) {
  return halfPlaneToLocal(x, y, [0, 0]);
}

// A point inside cell (lat, lon), given in the cell's own [0,1] x [1,2] box.
function cellPoint(lat, lon, x, y) {
  const size = Math.pow(2, lat);
  return hp((x + lon) * size, y * size);
}

// The room outline, doorways and doors, traced from the 2012 `writeDungeon`.
const FLOOR = [
  [0.94, 1.7], [1.06, 1.7], [1.06, 1.88], [1.2, 1.88], [1.2, 2.0], [1.076, 2.0],
  [1.076, 2.02], [0.924, 2.02], [0.924, 2.0], [0.8, 2.0], [0.8, 1.88], [0.94, 1.88],
];
const DOORWAY = [[0.96, 1.0], [0.96, 1.2], [1.04, 1.2], [1.04, 1.0]];
const DOORS = [
  [[0.20857304, 1.96806026], [0.49841873, 1.95639801], [0.49685719, 1.91759007], [0.2070115, 1.92925251]],
  [[0.79103657, 1.96806026], [0.50119088, 1.95639801], [0.50275239, 1.91759007], [0.79259808, 1.92925251]],
  [[1.0209121, 1.69446172], [1.0110929, 1.45042076], [0.97841788, 1.45173553], [0.98823729, 1.69577649]],
  [[1.0209121, 1.20404573], [1.0110929, 1.4480867], [0.97841788, 1.44677195], [0.98823729, 1.20273099]],
];

function pathFrom(lat, lon, pts, style, closed = true) {
  const points = pts.map(([x, y]) => {
    const p = cellPoint(lat, lon, x, y);
    return [p[0], p[1], "L"];
  });
  if (!closed) points[points.length - 1] = [points[points.length - 1][0], points[points.length - 1][1]];
  return Object.assign({ type: "path", points, closed: true }, style);
}

// Every drawable for one cell of the tiling.
export function dungeonCellDrawables(lat, lon) {
  const out = [];
  out.push(pathFrom(lat, lon, FLOOR, { fill: "#8a8a91", stroke: "#000000", lineWidth: 2 }));
  out.push(pathFrom(lat, lon, DOORWAY, { fill: "#8a8a91", stroke: "none", lineWidth: 2 }));
  out.push(pathFrom(lat, lon, DOORWAY, { stroke: "#000000", lineWidth: 2 }, false));
  for (const door of DOORS) {
    out.push(pathFrom(lat, lon, door, { fill: "#803300", stroke: "#000000", lineWidth: 2 }));
  }

  // Room numbers. Row is -latitude-1 and column is -longitude, and the hero's room (latitude -1,
  // longitude 0) is left unlabelled -- both straight from the 2012 generator.
  if (!(lat === -1 && lon === 0)) {
    const size = Math.pow(2, lat);
    const centre = hp(size * (lon + 0.5), 1.2 * size);
    const up = hp(size * (lon + 0.5), 1.4 * size);
    // The 2012 code passed these two the wrong way round for the room numbers (`ax`/`ay` received
    // the centre and `upx`/`upy` the up-vector, but the format wanted the opposite), which is why
    // the numbers were oriented oddly. Note its grid-drawing routine did it correctly.
    out.push({
      type: "text", text: String(-lat - 1), at: centre, up: up,
      fill: "#000000", baseline: "bottom", align: "center",
    });
    out.push({
      type: "text", text: String(-lon), at: centre, up: up,
      fill: "#000000", baseline: "top", align: "center",
    });
  }
  return out;
}

// Which cells can be visible, given the view centre in local coordinates and the draw radius.
//
// The 2012 routine mapped the visible disk to a circle in the half-plane and then took integer
// ranges from it. That is reproduced here, with the band-width fix.
export function visibleCells(centreLocal, drawRadius, maxCells = 400) {
  const { localToHalfPlane } = HyperbolicMap;
  // The visible region is a hyperbolic disk about the view centre. Its half-plane image is a
  // Euclidean circle; find it from three boundary points rather than from the 2012 closed form.
  const rho = 2 * Math.atanh(Math.min(drawRadius, 0.995));
  // centreLocal IS the data point at the middle of the screen, so the isometry that puts the origin
  // there is translationToLocal of it directly. (Negating it -- confusing "centre" with the old
  // "offset" -- puts every cell on the far side of the plane, where they are generated, drawn, and
  // invisible.)
  const cx = centreLocal[0];
  const cy = centreLocal[1];

  // Sample the boundary of the visible disk and take a bounding box in half-plane coordinates.
  const { Isom } = HyperbolicMap;
  const toCentre = Isom.translationToLocal(cx, cy);
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  const N = 64;
  for (let i = 0; i < N; i++) {
    const t = (2 * Math.PI * i) / N;
    const r = Math.tanh(rho / 2);
    const z = toCentre.applyToDisk(r * Math.cos(t), r * Math.sin(t), [0, 0]);
    const k = 1 / Math.sqrt(1 - z[0] * z[0] - z[1] * z[1]);
    const h = localToHalfPlane(z[0] * k, z[1] * k, [0, 0]);
    if (!Number.isFinite(h[0]) || !Number.isFinite(h[1]) || h[1] <= 0) continue;
    if (h[0] < xmin) xmin = h[0];
    if (h[0] > xmax) xmax = h[0];
    if (h[1] < ymin) ymin = h[1];
    if (h[1] > ymax) ymax = h[1];
  }
  if (!Number.isFinite(xmin) || ymin <= 0) return [];

  const latMin = Math.floor(Math.log2(ymin));
  const latMax = Math.floor(Math.log2(ymax));
  const cells = [];
  for (let lat = latMin; lat <= latMax && cells.length < maxCells; lat++) {
    const size = Math.pow(2, lat);
    // Evaluate the x-extent across the WHOLE band, not just at its bottom edge.
    const lo = Math.floor(xmin / size) - 1;
    const hi = Math.ceil(xmax / size) + 1;
    for (let lon = lo; lon <= hi && cells.length < maxCells; lon++) cells.push([lat, lon]);
  }
  return cells;
}
