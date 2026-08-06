#!/usr/bin/env python3
"""Build the tiled dungeon: a prototype room plus per-cell character overlays.

Local regeneration tool. Reads build/fixtures/dungeon.jsonl (from babudb_dump.py) and writes
docs/dungeon-atlas.json.

The tiling is the binary (Boroczky) tiling that the 2011 server already used, so the 2012 layout is
reproduced exactly rather than approximated. Cell (latitude, longitude) occupies, in the upper
half-plane,

    x in [longitude * 2^latitude, (longitude + 1) * 2^latitude]
    y in [2^latitude,             2^(latitude + 1)]

Tile-local coordinates. Writing (u, v) for a position in the cell's own normalised box -- u in [0,1]
across, v in [1,2] up -- the tile-local half-plane coordinates are

    x_local = (u - 0.5) / sqrt(2)        y_local = v / sqrt(2)

independent of latitude and longitude, because the frame's scale factor 2^(lat+0.5) divides out. That
is precisely what lets ONE prototype room be repeated in every cell.

Output structure:

    {"room": [...],                        # the prototype, in every cell
     "critters": {"lat,lon": [...]},       # finitely many cells carry characters
     ...}

Room numbers are NOT stored: the demo generates them in the callback from the cell coordinates, since
there are infinitely many.

Usage:  python3 tools/make_dungeon_atlas.py [--fixtures build/fixtures] [--out docs/dungeon-atlas.json]
"""

import argparse
import json
import math
import os
import sys

SQRT2 = math.sqrt(2.0)


def half_plane_to_local(px, py):
    """Stable half-plane -> local. See src/core/coords.js for why the 2011 form is unusable."""
    minus = math.hypot(px, py - 1.0)
    plus = math.hypot(px, py + 1.0)
    if plus == 0.0:
        return 0.0, 0.0
    t = minus / plus
    if t == 0.0:
        return 0.0, 0.0
    t = min(t, 1.0 - 2.220446049250313e-16)
    sinh_half = t / math.sqrt((1.0 - t) * (1.0 + t))
    # disk image: i (z - i) / (z + i)
    nr, ni = px, py - 1.0
    dr, di = px, py + 1.0
    dd = dr * dr + di * di
    qr = (nr * dr + ni * di) / dd
    qi = (ni * dr - nr * di) / dd
    zx, zy = -qi, qr
    mod = math.hypot(zx, zy)
    if mod == 0.0:
        return 0.0, 0.0
    return sinh_half * zx / mod, sinh_half * zy / mod


def local_to_half_plane(px, py):
    r2 = px * px + py * py
    w = math.sqrt(r2 + 1.0)
    if py > 0.0:
        denom = (4.0 * px * px * w * w + 1.0) / (2.0 * r2 + 1.0 + 2.0 * py * w)
    else:
        denom = 2.0 * r2 + 1.0 - 2.0 * py * w
    return 2.0 * px * w / denom, 1.0 / denom


def cell_of(hx, hy):
    lat = math.floor(math.log2(hy))
    lon = math.floor(hx * math.pow(2.0, -lat))
    return lat, lon


def world_to_cell_local(hx, hy, lat, lon):
    """World half-plane -> the cell's tile-local half-plane box."""
    size = math.pow(2.0, lat)
    u = hx / size - lon
    v = hy / size
    return (u - 0.5) / SQRT2, v / SQRT2


# The room art, transcribed from GeographicalTiles.writeDungeon. Verified against the Java source:
# 7 polygons, 32 points, exact. Coordinates are (u, v) in the cell's normalised box.
FLOOR = [
    (0.94, 1.7), (1.06, 1.7), (1.06, 1.88), (1.2, 1.88), (1.2, 2.0), (1.076, 2.0),
    (1.076, 2.02), (0.924, 2.02), (0.924, 2.0), (0.8, 2.0), (0.8, 1.88), (0.94, 1.88),
]
DOORWAY = [(0.96, 1.0), (0.96, 1.2), (1.04, 1.2), (1.04, 1.0)]
DOORS = [
    [(0.20857304, 1.96806026), (0.49841873, 1.95639801), (0.49685719, 1.91759007), (0.2070115, 1.92925251)],
    [(0.79103657, 1.96806026), (0.50119088, 1.95639801), (0.50275239, 1.91759007), (0.79259808, 1.92925251)],
    [(1.0209121, 1.69446172), (1.0110929, 1.45042076), (0.97841788, 1.45173553), (0.98823729, 1.69577649)],
    [(1.0209121, 1.20404573), (1.0110929, 1.4480867), (0.97841788, 1.44677195), (0.98823729, 1.20273099)],
]


def local_path(uv_points, style, closed=True):
    pts = []
    for u, v in uv_points:
        hx = (u - 0.5) / SQRT2
        hy = v / SQRT2
        x, y = half_plane_to_local(hx, hy)
        pts.append([round(x, 9), round(y, 9), "L"])
    if not closed:
        pts[-1] = pts[-1][:2]
    out = {"type": "path", "points": pts, "closed": True}
    out.update(style)
    return out


def prototype_room():
    out = [
        local_path(FLOOR, {"fill": "#8a8a91", "stroke": "#000000", "lineWidth": 2}),
        local_path(DOORWAY, {"fill": "#8a8a91", "stroke": "none", "lineWidth": 2}),
        local_path(DOORWAY, {"stroke": "#000000", "lineWidth": 2}, closed=False),
    ]
    for door in DOORS:
        out.append(local_path(door, {"fill": "#803300", "stroke": "#000000", "lineWidth": 2}))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fixtures", default="build/fixtures")
    ap.add_argument("--out", default="docs/dungeon-atlas.json")
    args = ap.parse_args(argv)

    src = os.path.join(args.fixtures, "dungeon.jsonl")
    if not os.path.exists(src):
        print(f"missing {src}; run tools/babudb_dump.py first", file=sys.stderr)
        return 1

    # Group the character art by cell, converting each drawable's points into that cell's frame.
    #
    # ORDER MATTERS. babudb_dump.py emits records in KEY order (latitude, longitude, id), which is
    # not the drawing order. The 2011 server sorted by `depth` before streaming, and that is the
    # z-order the art was authored for: body first, then features on top. An earlier version of this
    # script appended in file order, which painted the hero's orange body over his own face and cap.
    # Sort first.
    records = []
    seen = set()
    with open(src) as f:
        for line in f:
            rec = json.loads(line)
            if rec["id"] in seen:
                continue
            seen.add(rec["id"])
            records.append(rec)
    records.sort(key=lambda r: (r["depth"], r["id"]))

    by_cell = {}
    skipped = 0
    for rec in records:
        d = rec["drawable"]
        if d.get("type") != "polygon":
            skipped += 1
            continue
        pts = d["d"]
        # Assign the drawable to the cell containing its centroid, so a shape is never split.
        cxs = sum(p[0] for p in pts) / len(pts)
        cys = sum(p[1] for p in pts) / len(pts)
        hx, hy = local_to_half_plane(cxs, cys)
        if not (math.isfinite(hx) and math.isfinite(hy) and hy > 0):
            skipped += 1
            continue
        lat, lon = cell_of(hx, hy)

        local_pts = []
        ok = True
        for p in pts:
            phx, phy = local_to_half_plane(p[0], p[1])
            if not (math.isfinite(phx) and math.isfinite(phy) and phy > 0):
                ok = False
                break
            lx, ly = world_to_cell_local(phx, phy, lat, lon)
            x, y = half_plane_to_local(lx, ly)
            flag = p[2] if len(p) > 2 else None
            local_pts.append([round(x, 9), round(y, 9), flag] if flag else [round(x, 9), round(y, 9)])
        if not ok:
            skipped += 1
            continue

        obj = {"type": "path", "points": local_pts, "closed": True}
        if "fillStyle" in d:
            obj["fill"] = d["fillStyle"]
        if "strokeStyle" in d:
            obj["stroke"] = d["strokeStyle"]
        if "lineWidth" in d:
            obj["lineWidth"] = d["lineWidth"]
        by_cell.setdefault(f"{lat},{lon}", []).append(obj)

    room = prototype_room()
    doc = {
        "version": 1,
        "coordinates": "local",
        "tiling": {"kind": "binary"},
        "note": (
            "Tiled dungeon on the binary (Boroczky) tiling, the same one the 2011 server used, so the "
            "2012 layout is reproduced exactly. `room` is the prototype drawn in EVERY cell; "
            "`critters` holds the finitely many cells that carry characters. Room numbers are not "
            "stored -- the demo generates them from the cell coordinates."
        ),
        "room": room,
        "critters": by_cell,
    }

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(doc, f, separators=(",", ":"), sort_keys=True)
        f.write("\n")

    total = sum(len(v) for v in by_cell.values())
    print(f"room prototype: {len(room)} drawables")
    print(f"characters: {total} drawables across {len(by_cell)} cells" + (f" ({skipped} skipped)" if skipped else ""))
    lats = sorted({int(k.split(',')[0]) for k in by_cell})
    print(f"latitude range: {lats[0]} .. {lats[-1]}")
    print(f"wrote {args.out} ({os.path.getsize(args.out)/1e6:.2f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
