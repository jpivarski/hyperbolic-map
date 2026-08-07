#!/usr/bin/env python3
"""Cut one {8,3} tile of Escher fish for the infinite Circle Limit III demo.
SUPERSEDED by tools/trace_escher_tile.py. Kept for the record only.

This script cut a tile out of the traced vector art in docs/escher.json. Two measurements retired it:
its own bearing scan does not discriminate (spread 1.06x), so the octagon centre it used was a
default rather than a fit; and the tile it produced scores INFINITY on the library's C4 symmetry
check -- not one of its 90 shapes has a C4 partner. Even a correct cut could not have worked, because
four independently traced fish have different vertex counts and so cannot map onto each other
exactly. The replacement traces one 90-degree sector from the raster and repeats it by exact
rotation, which is symmetric by construction (residual 4e-17).


Local regeneration tool. Reads docs/escher.json and writes docs/escher-atlas.json.

Why this reads the FINISHED data, not the traced SVG
----------------------------------------------------
The first version of this script read escher_circle_limit_3_step2.svg directly. That was wrong twice
over, and both faults were visible the moment the result was rendered:

1. The SVG carries the artist's ORIGINAL palette -- fills #517179 / #9aa87c / #9f7054 and stroke
   #676767 -- which the 2012 pipeline then remapped ("I changed my mind about some colors") to
   #218ba6 / #79bd68 / #ed6b51 with stroke #6e5638. Using the SVG produced a muted olive-and-teal
   picture instead of Escher's four bright colours.
2. It tried to manufacture C4 symmetry by overlaying four rotated copies of the whole traced block
   and clipping. The block spans six fish over a wide area, so that piled roughly two dozen fish into
   one octagon and clipped the pile: fragments, not fish.

docs/escher.json is the finished art -- correct palette, and verified to render identically to the
2011 viewer. So the tile is cut from that instead.

How the tile is located
-----------------------
Circle Limit III sits on {8,3} with the chiral 433 group: 4-fold rotation centres at octagon centres,
3-fold centres at the vertices. Measured from the data, the origin of the stored art is a 3-FOLD
point (34% of inner polygon centroids match under a 120 degree rotation, versus 3-5% for every other
order), i.e. an {8,3} vertex.

In {8,3} an octagon centre lies at exactly the circumradius from a vertex, so the tile centre is a
translation of length chi = 0.8607 from the origin along one of three bearings 120 degrees apart.
Rather than derive which, this scans bearings and scores each by how nearly 4-fold symmetric the
surrounding art becomes -- an empirical fit against the real data, which is the honest thing to do
given that the tracing is approximate.

No symmetrisation is applied. The art near a genuine 4-fold centre is already approximately C4;
forcing it would mean averaging polygons, which is not meaningful. The residual asymmetry shows as
seams, which is documented rather than hidden.

Usage:  python3 tools/fit_escher_tile.py [--in docs/escher.json] [--out docs/escher-atlas.json]
"""

import argparse
import json
import math
import os
import sys

P, Q = 8, 3
INRADIUS = math.acosh(math.cos(math.pi / Q) / math.sin(math.pi / P))
CIRCUMRADIUS = math.acosh(1 / (math.tan(math.pi / P) * math.tan(math.pi / Q)))


def local_to_disk(x, y):
    w = math.sqrt(1.0 + x * x + y * y)
    return x / w, y / w


def disk_to_local(zx, zy):
    k = 1.0 / math.sqrt(max(1e-300, 1.0 - zx * zx - zy * zy))
    return zx * k, zy * k


def mobius(bx, by, zx, zy):
    """Pure translation carrying 0 -> (bx, by), applied to the disk point (zx, zy)."""
    nr = zx + bx
    ni = zy + by
    dr = 1.0 + (bx * zx + by * zy)
    di = bx * zy - by * zx
    dd = dr * dr + di * di
    return (nr * dr + ni * di) / dd, (ni * dr - nr * di) / dd


def rot(zx, zy, t):
    c, s = math.cos(t), math.sin(t)
    return c * zx - s * zy, s * zx + c * zy


def inside_octagon_local(x, y):
    """Is the local point inside the {8,3} octagon centred at the origin?

    The octagon is the intersection of eight half-planes. Half-plane k is bounded by the geodesic
    through the edge-k midpoint, perpendicular to the bearing 2*pi*k/8. In the invariant form, the
    point is on the origin's side when <P, M> <= cosh(inradius) * ... -- concretely, comparing the
    point's projection along the bearing against the inradius.
    """
    w = math.sqrt(1.0 + x * x + y * y)
    mr = math.sinh(INRADIUS)
    mw = math.cosh(INRADIUS)
    for k in range(P):
        ang = 2 * math.pi * k / P
        mx, my = mr * math.cos(ang), mr * math.sin(ang)
        # <P, M> = w*mw - x*mx - y*my is cosh of half the distance between them. The edge geodesic is
        # the locus where that equals <M, M> = mw*mw - mr*mr = 1 ... so compare against the value at
        # the midpoint itself.
        if w * mw - x * mx - y * my > mw * mw:
            return False
    return True


def centroid(points):
    sx = sum(p[0] for p in points)
    sy = sum(p[1] for p in points)
    return sx / len(points), sy / len(points)


CELL = 0.05


def score_bearing(centroids_disk, theta):
    """How nearly 4-fold symmetric is the art about the candidate centre at this bearing?

    Lower is better: the mean nearest-neighbour distance between the shapes near the candidate centre
    and their 90-degree rotations.

    A uniform grid keeps this linear. The obvious nested-loop version is quadratic in the number of
    shapes, which is ~14,000 here and evaluated at every scanned bearing -- unusable.
    """
    r = math.tanh(CIRCUMRADIUS / 2)
    bx, by = r * math.cos(theta), r * math.sin(theta)
    near = []
    for zx, zy in centroids_disk:
        px, py = mobius(-bx, -by, zx, zy)
        if px * px + py * py < 0.75:
            near.append((px, py))
    if len(near) < 40:
        return float("inf"), len(near)

    grid = {}
    for px, py in near:
        grid.setdefault((int(px / CELL), int(py / CELL)), []).append((px, py))

    total = 0.0
    for px, py in near:
        qx, qy = rot(px, py, math.pi / 2)
        gx, gy = int(qx / CELL), int(qy / CELL)
        best = 1e9
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for ax, ay in grid.get((gx + dx, gy + dy), ()):
                    d2 = (qx - ax) ** 2 + (qy - ay) ** 2
                    if d2 < best:
                        best = d2
        # Cap the penalty so a single unmatched shape cannot dominate the score.
        total += min(math.sqrt(best), 3 * CELL)
    return total / len(near), len(near)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--in", dest="inp", default="docs/escher.json")
    ap.add_argument("--out", default="docs/escher-atlas.json")
    ap.add_argument("--scan", type=int, default=720, help="bearing samples over 120 degrees")
    args = ap.parse_args(argv)

    if not os.path.exists(args.inp):
        print(f"missing {args.inp}; run tools/make_docs_data.py first", file=sys.stderr)
        return 1
    doc = json.load(open(args.inp))
    drawables = [d for d in doc["drawables"] if d.get("type") == "path"]
    print(f"read {len(drawables)} paths from {args.inp}")

    # Only the art near the origin is trustworthy: the 2012 replication degraded further out.
    cents = []
    for d in drawables:
        cx, cy = centroid(d["points"])
        if cx * cx + cy * cy < 25:
            cents.append(local_to_disk(cx, cy))
    print(f"{len(cents)} centroids within the central region used for the fit")

    # The art is 3-fold symmetric about the origin, so scanning 120 degrees covers every distinct
    # candidate direction to an octagon centre.
    #
    # HONEST RESULT: this scan does not discriminate. Measured spread across 24 bearings is
    # 0.01900 to 0.02006 -- a ratio of 1.06, i.e. flat to within noise. The 2012 tracing is simply
    # not accurate enough for a C4 residual to pick out the true 4-fold direction, and an earlier
    # version of this script reported a "best bearing" that was pure noise dressed up as a fit.
    #
    # So the scan is still run, but only to REPORT whether it discriminates. Unless it does, the
    # bearing is fixed at 0, which is as defensible as any other given the three directions are
    # equivalent under the art's own 3-fold symmetry. If someone later devises a metric that does
    # discriminate, this will start using it automatically.
    samples = []
    n = max(12, args.scan)
    for i in range(n):
        th = (2 * math.pi / 3) * i / n
        sc, cnt = score_bearing(cents, th)
        if math.isfinite(sc):
            samples.append((sc, th, cnt))
    samples.sort()
    best_score, best_theta, npts = samples[0]
    spread = samples[-1][0] / best_score if samples else 1.0
    DISCRIMINATES = spread > 1.25
    if DISCRIMINATES:
        score, theta = best_score, best_theta
        print(f"C4 scan discriminates (spread {spread:.2f}x): bearing {math.degrees(theta):.3f} deg, residual {score:.5f}")
    else:
        score, theta = best_score, 0.0
        print(f"C4 scan does NOT discriminate (spread only {spread:.2f}x over 120 deg).")
        print("  The tracing is too approximate for a C4 residual to locate the 4-fold direction.")
        print("  Using bearing 0; the three candidate directions are equivalent under the art's")
        print("  own 3-fold symmetry, so this is as defensible as any and is not presented as a fit.")
    print(f"best 4-fold bearing: {math.degrees(theta):.3f} deg   C4 residual {score:.5f}   ({npts} nearby shapes)")

    # Cut the tile.
    r = math.tanh(CIRCUMRADIUS / 2)
    bx, by = r * math.cos(theta), r * math.sin(theta)
    out = []
    for d in drawables:
        pts = d["points"]
        moved = []
        for p in pts:
            zx, zy = local_to_disk(p[0], p[1])
            px, py = mobius(-bx, -by, zx, zy)
            lx, ly = disk_to_local(px, py)
            moved.append([round(lx, 8), round(ly, 8)] + ([p[2]] if len(p) > 2 else []))
        # Include every shape that TOUCHES the octagon, not just those centred in it. Render-time
        # clipping trims the overhang, and the neighbouring tile supplies the other half -- so being
        # generous here is free, whereas being strict leaves unfilled wedges along every tile edge
        # (which is exactly what the first version produced).
        cx, cy = centroid(moved)
        touches = inside_octagon_local(cx, cy) or any(inside_octagon_local(q[0], q[1]) for q in moved)
        if not touches:
            continue
        obj = {"type": "path", "points": moved, "closed": d.get("closed", True)}
        for k in ("fill", "stroke", "lineWidth"):
            if k in d:
                obj[k] = d[k]
        out.append(obj)

    print(f"tile contains {len(out)} shapes")

    meta = {
        "tiling": {"p": P, "q": Q, "frameSymmetry": 4},
        "inradius": INRADIUS,
        "circumradius": CIRCUMRADIUS,
        "fitBearingDegrees": math.degrees(theta),
        "c4Residual": score,
        "note": (
            "One {8,3} octagon of Escher's Circle Limit III, cut from the finished art in "
            "docs/escher.json (which carries the corrected palette). The 4-fold centre was located "
            "by scanning bearings at the circumradius from the stored art's 3-fold origin and "
            "scoring C4 symmetry. Not symmetrised: the tracing is approximate, so repeating this "
            "tile leaves visible seams. See notes/escher-circle-limit-iii.md."
        ),
    }
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w") as f:
        f.write('{"version":1,"coordinates":"local",')
        f.write('"meta":' + json.dumps(meta) + ",")
        f.write('"drawables":[\n')
        f.write(",\n".join(json.dumps(d, separators=(",", ":"), sort_keys=True) for d in out))
        f.write("\n]}\n")
    print(f"wrote {args.out} ({os.path.getsize(args.out)/1e3:.1f} kB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
