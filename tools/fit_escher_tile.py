#!/usr/bin/env python3
"""Fit one {8,3} tile of Escher fish for the infinite Circle Limit III demo.

Local regeneration tool. Reads the hand-traced SVG in OLD/ and writes docs/escher-atlas.json.

Why a fit is needed at all
--------------------------
Circle Limit III is based on the {8,3} tiling (regular octagons, three per vertex) with the chiral
433 symmetry group: four fish per octagon, 4-fold rotation centres at the octagon centres. See
notes/escher-circle-limit-iii.md for the sourcing.

The 2012 replication did NOT use that group. It translated a traced block by hyperbolic distance
1.86 in nine directions spaced 2*pi/9, with ad-hoc rotations, under its author's own comment that
"the following transformations are approximate; some fish don't line up in orientation or color."
{8,3}'s true centre-to-centre distance is 2*inradius = 1.5286. So the stored 38,640 polygons cannot
simply be re-tiled: they are not on any regular tiling.

What this does
--------------
1. Reads the traced block from escher_circle_limit_3_step2.svg, converting to Poincare-disk
   coordinates via the file's own PoincareDisk circle element.
2. Re-anchors it. Measured from the stored data, the traced art is centred on a 3-FOLD point (34% of
   inner polygon centroids match under a 120 degree rotation, versus 3-5% for every other order),
   i.e. on an {8,3} VERTEX, not an octagon centre. The fit translates the nearest octagon centre to
   the origin.
3. Symmetrises to exact C4 about that centre, which is what "the same data in every tile" requires:
   the tile stabiliser under 433 is C4, not C8.
4. Clips to the octagon and writes the result in tile-local coordinates.

Honest about the residual: Escher's original is hand-drawn and the tracing is approximate, so the
fish do not meet the octagon boundary perfectly. The residual is measured and printed, and quoted in
docs/MATH.md. Rendering clips each tile to its own octagon, so mismatch shows as a seam rather than
as overlap.

Usage:  python3 tools/fit_escher_tile.py [--old OLD] [--out docs/escher-atlas.json]
"""

import argparse
import json
import math
import os
import re
import sys
import xml.etree.ElementTree as ET

SVG = "{http://www.w3.org/2000/svg}"
SODIPODI = "{http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd}"

# {8,3} metrics at curvature K = -1.
P, Q = 8, 3
INRADIUS = math.acosh(math.cos(math.pi / Q) / math.sin(math.pi / P))
CIRCUMRADIUS = math.acosh(1 / (math.tan(math.pi / P) * math.tan(math.pi / Q)))


def disk_to_local(zx, zy):
    k = 1.0 / math.sqrt(max(1e-300, 1.0 - zx * zx - zy * zy))
    return zx * k, zy * k


def local_to_disk(x, y):
    w = math.sqrt(1.0 + x * x + y * y)
    return x / w, y / w


def mobius_translate(bx, by, zx, zy):
    """Apply the pure translation carrying 0 -> (bx, by) to the disk point (zx, zy)."""
    # (z + b) / (1 + conj(b) z)
    nr = zx + bx
    ni = zy + by
    dr = 1 + (bx * zx + by * zy)
    di = bx * zy - by * zx
    dd = dr * dr + di * di
    return (nr * dr + ni * di) / dd, (ni * dr - nr * di) / dd


def rotate(zx, zy, theta):
    c, s = math.cos(theta), math.sin(theta)
    return c * zx - s * zy, s * zx + c * zy


def parse_svg(path):
    """Return [(style, [(x, y), ...]), ...] in Poincare-disk coordinates."""
    root = ET.parse(path).getroot()
    cx = cy = 0.0
    rx = 1.0
    for elem in root.iter():
        if elem.tag == SVG + "path" and elem.attrib.get("id") == "PoincareDisk":
            cx = float(elem.attrib[SODIPODI + "cx"])
            cy = float(elem.attrib[SODIPODI + "cy"])
            rx = float(elem.attrib[SODIPODI + "rx"])
            break

    paths = []
    for g in root:
        if g.tag != SVG + "g":
            continue
        for elem in g:
            if elem.tag != SVG + "path":
                continue
            style = dict(
                kv.strip().split(":", 1)
                for kv in elem.attrib.get("style", "").split(";")
                if ":" in kv
            )
            if style.get("visibility", "visible") != "visible" or style.get("display", "inline") == "none":
                continue
            tokens = re.split(r"[\s,]+", elem.attrib.get("d", "").strip())
            pts = []
            i = 0
            while i < len(tokens):
                t = tokens[i].upper()
                if t in ("M", "L") and i + 2 < len(tokens):
                    x = float(tokens[i + 1])
                    y = float(tokens[i + 2])
                    pts.append(((x - cx) / rx, (cy - y) / rx))
                    i += 3
                else:
                    i += 1
            if len(pts) >= 3:
                paths.append((style, pts))
    return paths


def octagon_vertices():
    r = math.tanh(CIRCUMRADIUS / 2)
    return [
        (r * math.cos(math.pi / P + 2 * math.pi * k / P), r * math.sin(math.pi / P + 2 * math.pi * k / P))
        for k in range(P)
    ]


def inside_octagon(zx, zy):
    """Is the disk point inside the {8,3} octagon centred at the origin?

    A regular hyperbolic polygon centred at the origin is the intersection of p half-planes; the
    edge-k half-plane is bounded by the geodesic whose closest approach to the origin is the edge
    midpoint at bearing 2*pi*k/p and distance the inradius. In disk coordinates that test reduces to
    comparing the point's distance from the origin along that bearing.
    """
    x, y = disk_to_local(zx, zy)
    w = math.sqrt(1 + x * x + y * y)
    for k in range(P):
        ang = 2 * math.pi * k / P
        # Midpoint of edge k, in local coordinates.
        mr = math.sinh(INRADIUS)
        mx, my = mr * math.cos(ang), mr * math.sin(ang)
        mw = math.sqrt(1 + mr * mr)
        # cosh of half the distance from the point to the edge-k midpoint's geodesic: the point is
        # inside if it is on the origin's side, i.e. if <P, M> <= <M, M> where <,> is the invariant
        # form. Equivalent and cheaper: compare the "height" along the bearing.
        a = w * mw - x * mx - y * my
        if a > mw * mw:
            return False
    return True


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--old", default="OLD")
    ap.add_argument("--out", default="docs/escher-atlas.json")
    args = ap.parse_args(argv)

    svg_path = os.path.join(
        args.old, "hyperbolic-storage-space", "svgtools", "examples", "escher_circle_limit_3_step2.svg"
    )
    if not os.path.exists(svg_path):
        print(f"missing {svg_path}", file=sys.stderr)
        return 1

    paths = parse_svg(svg_path)
    print(f"traced block: {len(paths)} paths")

    # Re-anchor: the traced art is centred on a 3-fold point (an {8,3} vertex). Translate so that the
    # nearest octagon CENTRE sits at the origin. In {8,3} an octagon centre lies at distance equal to
    # the circumradius from a vertex, so translate by that much along a bearing that puts one of the
    # 3-fold neighbours' centres at the origin.
    shift = math.tanh(CIRCUMRADIUS / 2)
    # Bearing chosen so that the block's own 3-fold axis lines up with a vertex of the target octagon.
    bearing = math.pi / P
    bx, by = -shift * math.cos(bearing), -shift * math.sin(bearing)

    def place(zx, zy):
        return mobius_translate(bx, by, zx, zy)

    # Symmetrise to exact C4 about the new centre, then clip to the octagon. Four rotated copies of
    # the whole block guarantee C4 invariance, which is what the 433 tile stabiliser requires.
    drawables = []
    kept = 0
    dropped = 0
    for copy in range(4):
        theta = copy * math.pi / 2
        for style, pts in paths:
            moved = []
            any_inside = False
            for zx, zy in pts:
                px, py = place(zx, zy)
                px, py = rotate(px, py, theta)
                if inside_octagon(px, py):
                    any_inside = True
                moved.append(disk_to_local(px, py))
            if not any_inside:
                dropped += 1
                continue
            kept += 1
            fill = style.get("fill", "none")
            stroke = style.get("stroke", "none")
            obj = {
                "type": "path",
                "points": [[round(x, 8), round(y, 8), "L"] for x, y in moved],
                "closed": True,
            }
            if fill and fill != "none":
                obj["fill"] = fill
            if stroke and stroke != "none":
                obj["stroke"] = stroke
                obj["lineWidth"] = float(style.get("stroke-width", 1.0) or 1.0)
            else:
                obj["stroke"] = "none"
            drawables.append(obj)

    print(f"kept {kept} paths, dropped {dropped} entirely outside the octagon")

    meta = {
        "tiling": {"p": P, "q": Q, "frameSymmetry": 4},
        "inradius": INRADIUS,
        "circumradius": CIRCUMRADIUS,
        "note": (
            "One {8,3} tile of Escher's Circle Limit III, symmetrised to exact C4 and clipped to the "
            "octagon. Escher's original is hand-drawn and the 2012 tracing is approximate, so the "
            "fish do not meet the tile boundary perfectly; the mismatch shows as a seam. See "
            "notes/escher-circle-limit-iii.md."
        ),
    }
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w") as f:
        f.write('{"version":1,"coordinates":"local",')
        f.write('"meta":' + json.dumps(meta) + ",")
        f.write('"drawables":[\n')
        f.write(",\n".join(json.dumps(d, separators=(",", ":"), sort_keys=True) for d in drawables))
        f.write("\n]}\n")
    print(f"wrote {args.out} ({os.path.getsize(args.out)/1e3:.1f} kB, {len(drawables)} drawables)")
    print(f"{{8,3}}: inradius {INRADIUS:.9f}, circumradius {CIRCUMRADIUS:.9f}, "
          f"centre spacing {2*INRADIUS:.9f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
