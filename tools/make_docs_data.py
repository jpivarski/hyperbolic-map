#!/usr/bin/env python3
"""Convert the extracted JSONL fixtures into the committed docs/*.json files.

Local regeneration tool; reads build/fixtures/*.jsonl from babudb_dump.py.

Output format is the v2 drawable schema (documented in README.md and notes/data-extraction.md).
Written for git stability:

  * one drawable per line, so diffs are line-based rather than one enormous line;
  * deterministic ordering (by the original `depth`, which is the z-order the 2011 server sorted
    by, then by id to break ties);
  * coordinates rounded to a fixed 8 significant digits.

8 digits rather than 17: the stored values were printed with %.18e, which is far more precision
than any rendering needs (the disk projection compresses these coordinates, and 8 digits is ~1e-8
relative, i.e. sub-nanopixel), and it takes the total from 27 MB to 19.5 MB.

Usage:
    python3 tools/make_docs_data.py [--fixtures build/fixtures] [--out docs] [dataset ...]
"""

import argparse
import glob
import gzip
import json
import os
import sys

DATASETS = ("escher", "dungeon", "clock", "relativity")
SIGNIFICANT_DIGITS = 8


def num(x):
    """Round to a fixed number of significant digits, deterministically."""
    v = float(f"%.{SIGNIFICANT_DIGITS}g" % x)
    # Normalise -0.0 to 0.0 so the output does not depend on the sign of a zero.
    return 0.0 if v == 0.0 else v


def convert(rec):
    """Legacy drawable -> v2 drawable. Returns None for shapes we do not recognise."""
    d = rec["drawable"]
    kind = d.get("type")
    out = {}

    if kind == "polygon":
        # Legacy semantics, preserved deliberately rather than "modernised": the third element of
        # a point is a flag string for the edge LEAVING that point. "L" means stroke that edge;
        # absent means the edge is part of the fill but is not stroked. "P" draws a vertex marker.
        # The fill path always closes. Reproducing this exactly is why `points` keeps per-point
        # flags instead of using move/line commands.
        points = []
        for p in d["d"]:
            if len(p) > 2 and p[2]:
                points.append([num(p[0]), num(p[1]), p[2]])
            else:
                points.append([num(p[0]), num(p[1])])
        out["type"] = "path"
        out["points"] = points
        out["closed"] = True
    elif kind == "text":
        out["type"] = "text"
        out["text"] = d["d"]
        out["at"] = [num(d["ax"]), num(d["ay"])]
        out["up"] = [num(d["upx"]), num(d["upy"])]
    else:
        return None

    # Style: carry over only what was explicitly set, so the library's defaults still apply and
    # the files stay small.
    if "fillStyle" in d:
        out["fill"] = d["fillStyle"]
    if "strokeStyle" in d:
        out["stroke"] = d["strokeStyle"]
    if "lineWidth" in d:
        out["lineWidth"] = num(d["lineWidth"])
    if "textAlign" in d:
        out["align"] = d["textAlign"]
    if "textBaseline" in d:
        out["baseline"] = d["textBaseline"]
    if "font" in d:
        out["font"] = d["font"]
    if "class" in d:
        out["class"] = d["class"]

    # Level of detail. The 2011 server tested whether a drawable's TILE fell inside a circle of
    # this radius; we reinterpret them as thresholds on the drawable's own position. Only escher
    # uses these (maxRadius 0.75 on some records). See notes/open-questions.md.
    if rec.get("minRadius", 0.0) != 0.0:
        out["visibleFrom"] = num(rec["minRadius"])
    if rec.get("maxRadius", 1.0) != 1.0:
        out["visibleTo"] = num(rec["maxRadius"])

    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fixtures", default="build/fixtures")
    ap.add_argument("--out", default="docs")
    ap.add_argument("--gzip-report", action="store_true", help="also report gzipped sizes")
    ap.add_argument("datasets", nargs="*", default=None)
    args = ap.parse_args(argv)

    wanted = args.datasets or list(DATASETS)
    os.makedirs(args.out, exist_ok=True)

    for name in wanted:
        src = os.path.join(args.fixtures, f"{name}.jsonl")
        if not os.path.exists(src):
            print(f"{name}: missing {src}; run tools/babudb_dump.py first", file=sys.stderr)
            return 1

        seen = {}
        with open(src) as f:
            for line in f:
                rec = json.loads(line)
                # De-duplicate by id, keeping the shallowest (the 2011 server kept the deepest
                # occurrence when a drawable was indexed into several tiles; ids are unique in
                # these four datasets, so this only guards against surprises).
                if rec["id"] not in seen:
                    seen[rec["id"]] = rec

        records = sorted(seen.values(), key=lambda r: (r["depth"], r["id"]))

        lines = []
        skipped = 0
        for rec in records:
            conv = convert(rec)
            if conv is None:
                skipped += 1
                continue
            lines.append(json.dumps(conv, separators=(",", ":"), sort_keys=True))

        out_path = os.path.join(args.out, f"{name}.json")
        with open(out_path, "w") as f:
            f.write('{"version":1,"coordinates":"local","drawables":[\n')
            f.write(",\n".join(lines))
            f.write("\n]}\n")

        size = os.path.getsize(out_path)
        msg = f"{name}: {len(lines)} drawables -> {out_path} ({size/1e6:.2f} MB"
        if args.gzip_report:
            with open(out_path, "rb") as f:
                gz = len(gzip.compress(f.read(), 9))
            msg += f", {gz/1e6:.2f} MB gzipped"
        msg += ")"
        if skipped:
            msg += f"  [skipped {skipped} unrecognised]"
        print(msg)

    return 0


if __name__ == "__main__":
    sys.exit(main())
