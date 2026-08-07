#!/usr/bin/env python3
"""Build a Circle Limit III octagon tile that is EXACTLY C4-symmetric, traced from the raster.

Why this exists
---------------

The previous tile (docs/escher-atlas.json, cut by tools/fit_escher_tile.py) is not usable, for two
independent reasons found by measurement:

1. It has no 4-fold structure at all. The library's own symmetry check scores it INFINITY: not one of
   its 90 shapes has a C4 partner. Its own metadata says why -- the bearing scan in the cutter "does NOT
   discriminate", so the octagon centre was defaulted to bearing 0 rather than located.

2. Even a correctly-placed cut of TRACED art can never pass. Four independently traced copies of one
   fish have different vertex counts, so they cannot map onto each other exactly. Measured on the
   vector art at its own known 3-fold centre, the exact check also returns Infinity.

So the tile has to be CONSTRUCTED symmetric rather than found symmetric: trace one 90-degree sector and
repeat it by exact rotation. Then the residual is ~1e-16 by construction instead of ~0.5 by luck.

Why the rule matters is in src/data/atlas/symmetry.js. In short: a tile's frame is defined only up to
the stabiliser C_m, so art that is not C_m-invariant rotates on screen as you scroll.

Alignment, measured rather than assumed
---------------------------------------

Escher's print is a Poincare disk, so pixel -> disk -> tile-local is exact once three numbers are known:
the disk centre, the disk radius, and the rotation of the {8,3} tiling within it. All three were fitted
by requiring the PATTERN to be invariant under the walk group's own generator (a 2*pi/3 rotation about
an octagon vertex), scored on a colour-blind classification over a large region:

    disk radius       158.5 px   (nominal image half-width 157.5; the peak is sharp -- 0.54 against
                                  0.42 at +-8 px, so the print really is at the {8,3} scale)
    disk centre       (157.5, 157.0)
    library -> raster -22.5 deg  (the octagon's vertices sit at raster bearings 0, 45, 90, ...)

Controls: rotating to the OTHER vertex class scores 0.50 (it is also a genuine 3-fold point of the
pattern, so this is expected), and rotating 20 degrees to where no vertex lies scores 0.42.

The colouring
-------------

Escher's four fish colours cannot be reproduced by an atlas that returns the same data for every tile.
Around an octagon centre the four fish alternate green/orange, so the colouring is only C2 while the
shape is C4 -- and C4-invariance is exactly what the rule demands. Verified directly: C4-symmetric
shapes painted in four different colours score 0.36 on the symmetry check, a clear failure.

So the four fish in a tile share a colour here, and variety comes from the TILE CLASS instead: {8,3}
with frameSymmetry 4 admits a 3-class homomorphism (see RegularTiling.tileClass), giving a proper
3-colouring of the octagons in which no two neighbours match. That is path-independent, so it survives
scrolling, which Escher's own 4-colouring provably would not.

Usage:  python3 tools/trace_escher_tile.py --image <raster> --out docs/escher-atlas.json
"""

import argparse
import json
import math

import numpy as np
from PIL import Image
from scipy import ndimage
from skimage import measure

P, Q = 8, 3
CHI = math.acosh(1 / (math.tan(math.pi / P) * math.tan(math.pi / Q)))   # octagon circumradius
PSI = math.acosh(math.cos(math.pi / Q) / math.sin(math.pi / P))         # octagon inradius

INK, BODY, SPINE = 0, 1, 2


def classify_grid(rgb, scale):
    """Classify a tile-local RGB grid into INK / BODY / SPINE.

    Ink is found with a BLACK TOP-HAT rather than a brightness threshold, and that matters. At 316 px
    across, Escher's outlines are a single JPEG-blurred pixel, so on a pale fish they are mid-grey and on
    a dark fish they are barely darker than the body. Measured, a global "dark" rule swallowed the dark
    blue and dark red fish whole (2,132 of 2,360 dark pixels are saturated fish colour, not outline),
    while a local-median rule found the lines but broke them into dashes. A top-hat -- how much darker
    is this pixel than the closing of its neighbourhood -- is the operator designed for thin dark
    structures and finds a 1 px line on any background.
    """
    lum = 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]
    sat = rgb.max(2) - rgb.min(2)
    mn = rgb.min(2)

    r = max(2, int(round(4 * scale / 2)))
    y, x = np.mgrid[-r:r + 1, -r:r + 1]
    disk = (x * x + y * y) <= r * r
    ink = (ndimage.grey_closing(lum, footprint=disk) - lum) > 12
    ink = ndimage.binary_closing(ink, structure=np.ones((3, 3)))
    ink = ndimage.binary_opening(ink, structure=np.ones((2, 2)))

    spine = (mn > 150) & (sat < 60) & ~ink
    out = np.full(lum.shape, BODY, dtype=np.int8)
    out[spine] = SPINE
    out[ink] = INK
    return out


def local_to_disk(x, y):
    # Local ("companion") coordinates are r = sinh(d/2); the disk coordinate is tanh(d/2). Since
    # w = sqrt(1 + r^2) = cosh(d/2), that is exactly r / w. (Not r / (1 + w) -- that is the hyperboloid
    # normalisation, and using it here sampled only the inner half of the octagon, which is why the
    # white spine class came back empty.)
    w = math.sqrt(1 + x * x + y * y)
    return x / w, y / w


def octagon_local_vertices():
    """The tile boundary the library uses: vertices at pi/p + 2*pi*k/p, so edge midpoints land on 0."""
    out = []
    r = math.tanh(CHI / 2)
    for k in range(P):
        a = math.pi / P + 2 * math.pi * k / P
        zx, zy = r * math.cos(a), r * math.sin(a)
        k2 = 1.0 / math.sqrt(1 - zx * zx - zy * zy)
        out.append((zx * k2, zy * k2))
    return out


def point_in_polygon(x, y, poly):
    inside = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            xin = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < xin:
                inside = not inside
    return inside


def simplify(points, tol):
    """Douglas-Peucker. Traced contours carry one vertex per grid step; the tile needs hundreds, not
    tens of thousands, and the renderer draws every point it is given."""
    if len(points) < 3:
        return points

    def rec(a, b):
        if b <= a + 1:
            return []
        ax, ay = points[a]
        bx, by = points[b]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy)
        worst, wi = -1.0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            if L < 1e-12:
                d = math.hypot(px - ax, py - ay)
            else:
                d = abs(dx * (ay - py) - (ax - px) * dy) / L
            if d > worst:
                worst, wi = d, i
        if worst <= tol:
            return []
        return rec(a, wi) + [wi] + rec(wi, b)

    keep = [0] + rec(0, len(points) - 1) + [len(points) - 1]
    return [points[i] for i in keep]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--disk-radius", type=float, default=158.5)
    ap.add_argument("--centre", type=float, nargs=2, default=[157.5, 157.0])
    ap.add_argument("--rotation", type=float, default=-22.5, help="library bearing -> raster bearing")
    ap.add_argument("--grid", type=int, default=768)
    ap.add_argument("--margin", type=float, default=1.06, help="trace this far past the octagon")
    ap.add_argument("--tol", type=float, default=0.0016, help="Douglas-Peucker tolerance, local units")
    ap.add_argument("--smooth", type=float, default=2.5, help="gaussian blur, grid cells, before tracing")
    ap.add_argument("--min-area", type=float, default=1.0, help="scale the minimum component area")
    args = ap.parse_args()

    img = np.asarray(Image.open(args.image).convert("RGB")).astype(float)
    IH, IW, _ = img.shape
    CXp, CYp = args.centre
    Rd = args.disk_radius
    rot = math.radians(args.rotation)
    crot, srot = math.cos(rot), math.sin(rot)

    N = args.grid
    extent = math.sinh(CHI / 2) * args.margin        # local radius that certainly covers the octagon
    oct_local = octagon_local_vertices()
    oct_scaled = [(x * args.margin, y * args.margin) for x, y in oct_local]

    # ---- sample the raster on a square grid in TILE-LOCAL coordinates ----
    #
    # Local coordinates are where the stabiliser acts as an ordinary Euclidean rotation, so a square grid
    # centred on the tile centre rotates onto itself EXACTLY under np.rot90. That is what makes the
    # symmetrisation below exact rather than approximate.
    ys, xs = np.mgrid[0:N, 0:N]
    gx = (xs - (N - 1) / 2) / ((N - 1) / 2) * extent
    gy = ((N - 1) / 2 - ys) / ((N - 1) / 2) * extent

    # Inside the octagon? It is convex, so a half-plane test per edge, vectorised.
    inside = np.ones((N, N), dtype=bool)
    for k in range(len(oct_scaled)):
        x1, y1 = oct_scaled[k]
        x2, y2 = oct_scaled[(k + 1) % len(oct_scaled)]
        inside &= ((x2 - x1) * (gy - y1) - (y2 - y1) * (gx - x1)) >= 0

    ux = gx * crot - gy * srot
    uy = gx * srot + gy * crot
    wl = np.sqrt(1 + ux * ux + uy * uy)
    dx, dy = ux / wl, uy / wl
    ix = np.clip(np.round(CXp + dx * Rd).astype(int), 0, IW - 1)
    iy = np.clip(np.round(CYp - dy * Rd).astype(int), 0, IH - 1)
    rgb = img[iy, ix]

    cls = classify_grid(rgb, N / max(IW, IH))
    cls[~inside] = -1

    # ---- make it EXACTLY C4-symmetric ----
    #
    # Majority vote over the four rotations, with a fixed tie-break order. Every cell in an orbit sees
    # the same four values, so all four get the same answer: the result is invariant to the bit.
    votes = np.zeros((N, N, 3), dtype=np.int16)
    valid = np.zeros((N, N), dtype=np.int16)
    for k in range(4):
        rc = np.rot90(cls, k)
        rv = np.rot90(cls >= 0, k)
        for c in (INK, BODY, SPINE):
            votes[:, :, c] += ((rc == c) & rv).astype(np.int16)
        valid += rv.astype(np.int16)
    order = [BODY, SPINE, INK]        # tie-break, applied identically to every cell of an orbit
    sym = np.full((N, N), -1, dtype=np.int8)
    best = votes.max(axis=2)
    for c in order:
        take = (votes[:, :, c] == best) & (best > 0) & (sym < 0)
        sym[take] = c
    sym[valid == 0] = -1
    keep = sym >= 0

    # Sanity: the symmetrised grid must be invariant under np.rot90, exactly.
    for k in (1, 2, 3):
        assert np.array_equal(sym, np.rot90(sym, k)), f"symmetrisation failed at k={k}"
    agree = float((np.rot90(cls, 1) == cls)[keep & np.rot90(keep, 1)].mean())
    print(f"raw raster C4 agreement before symmetrising: {agree:.3f}")

    # ---- one 90-degree sector, with a little overlap so the seams close ----
    ys, xs = np.mgrid[0:N, 0:N]
    gx = (xs - (N - 1) / 2) / ((N - 1) / 2) * extent
    gy = ((N - 1) / 2 - ys) / ((N - 1) / 2) * extent
    ang = np.degrees(np.arctan2(gy, gx)) % 360
    OVER = 2.0            # degrees of overlap; the four copies then abut with no hairline
    sector = (ang <= 90 + OVER) | (ang >= 360 - OVER)
    sector |= (np.hypot(gx, gy) < extent * 0.02)     # the very centre belongs to every sector

    def to_local(rc):
        """skimage contour coordinates (row, col, subpixel) -> tile-local (x, y)."""
        out = []
        for r, c in rc:
            x = (c - (N - 1) / 2) / ((N - 1) / 2) * extent
            y = ((N - 1) / 2 - r) / ((N - 1) / 2) * extent
            out.append((x, y))
        return out

    def components(mask, min_px):
        # Smooth before tracing. The source raster is 316 px across, so one source pixel spans several
        # grid cells and a raw marching-squares contour comes out as a staircase. Blur the indicator and
        # re-threshold: the region is essentially unchanged but its boundary is smooth, which also makes
        # Douglas-Peucker far more effective (3,167 points became a few hundred).
        if args.smooth > 0:
            mask = ndimage.gaussian_filter(mask.astype(float), args.smooth) > 0.5
        labels = measure.label(mask, connectivity=1)
        out = []
        for region in measure.regionprops(labels):
            if region.area < min_px:
                continue
            sub = np.zeros((N, N), dtype=float)
            sub[labels == region.label] = 1.0
            for contour in measure.find_contours(sub, 0.5):
                pts = simplify(to_local(contour), args.tol)
                if len(pts) >= 4:
                    out.append((region.area, pts))
        return out

    body_m = (sym == BODY) & sector & keep
    spine_m = (sym == SPINE) & sector & keep
    # Ink islands: ink not touching the sector's outer boundary, i.e. the eye pupils. The rest of the ink
    # is the web between body pieces and shows through from the base fill.
    ink_all = (sym == INK) & keep
    edge = np.zeros((N, N), dtype=bool)
    edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = True
    edge |= ~keep
    lab = measure.label(ink_all, connectivity=1)
    touching = set(lab[edge & ink_all].tolist())
    ink_islands = np.isin(lab, [x for x in np.unique(lab) if x > 0 and x not in touching]) & sector

    MIN = max(6, int((N * N) // 90000 * args.min_area))
    layers = [
        ("body", components(body_m, MIN * 3)),
        ("spine", components(spine_m, MIN * 2)),
        ("ink", components(ink_islands, MIN)),
    ]
    for name, comps in layers:
        print(f"{name}: {len(comps)} contours, {sum(len(p) for _, p in comps)} points (one sector)")

    # ---- emit, repeating each sector piece by EXACT 90 degree rotations ----
    PALETTE = {"body": "#7ba05b", "spine": "#fbf6e6", "ink": "#141414"}
    drawables = []
    # The base: the whole octagon in ink, so the web between the body pieces needs no tracing at all.
    drawables.append({
        "type": "path", "closed": True, "fill": PALETTE["ink"], "stroke": "none",
        "points": [[round(x, 6), round(y, 6)] for x, y in oct_scaled],
    })
    for name, comps in layers:
        for _, pts in comps:
            for k in range(4):
                a = k * math.pi / 2
                c, s = math.cos(a), math.sin(a)
                drawables.append({
                    "type": "path", "closed": True, "fill": PALETTE[name], "stroke": "none",
                    "points": [[round(x * c - y * s, 6), round(x * s + y * c, 6)] for x, y in pts],
                })

    # Level of detail. Most tiles on screen are tiny -- 122 of 200 had a screen radius under 8 px on the
    # Escher atlas -- and a few hundred shapes in an 8 px tile is most of the frame time for no visible
    # gain. So the tile also carries a single octagon in its own AREA-WEIGHTED AVERAGE colour, which the
    # renderer substitutes below `lodPx`. At that size the detail reads as a flat tone anyway, and the
    # average is what that tone is.
    cover = {}
    tot = int(keep.sum())
    for name, c in (("ink", INK), ("body", BODY), ("spine", SPINE)):
        cover[name] = round(float(((sym == c) & keep).sum()) / max(1, tot), 5)

    def mix(hexes_weights):
        r = g = b = 0.0
        for hx, w in hexes_weights:
            r += int(hx[1:3], 16) * w
            g += int(hx[3:5], 16) * w
            b += int(hx[5:7], 16) * w
        return "#%02x%02x%02x" % (int(round(r)), int(round(g)), int(round(b)))

    lod_fill = mix([(PALETTE["ink"], cover["ink"]), (PALETTE["body"], cover["body"]),
                    (PALETTE["spine"], cover["spine"])])
    print(f"coverage {cover} -> lod fill {lod_fill}")

    doc = {
        "version": 1,
        "coordinates": "local",
        "lodPx": 11,
        "lod": [{
            "type": "path", "closed": True, "fill": lod_fill, "stroke": "none",
            "points": [[round(x, 6), round(y, 6)] for x, y in oct_scaled],
        }],
        "meta": {
            "tiling": {"p": P, "q": Q, "frameSymmetry": 4},
            "inradius": PSI,
            "circumradius": CHI,
            "source": args.image,
            "coverage": cover,
            "fit": {"diskRadiusPx": Rd, "centrePx": [CXp, CYp], "libraryToRasterDegrees": args.rotation},
            "note": (
                "One {8,3} octagon of Escher's Circle Limit III, traced from the raster and made EXACTLY "
                "C4-symmetric by construction: one 90-degree sector is traced and repeated by exact "
                "rotation, so the library's tile-symmetry check scores ~1e-16 rather than Infinity. The "
                "four fish in an octagon share a colour because C4 forces it -- Escher's alternating "
                "green/orange is only C2 and would visibly jump when the camera re-anchors. Colour "
                "variety comes from the tile CLASS instead, which is path-independent. "
                "See tools/trace_escher_tile.py."
            ),
        },
        "drawables": drawables,
    }
    with open(args.out, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    npts = sum(len(d["points"]) for d in drawables)
    print(f"wrote {args.out}: {len(drawables)} drawables, {npts} points")


if __name__ == "__main__":
    main()
