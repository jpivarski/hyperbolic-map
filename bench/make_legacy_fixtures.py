#!/usr/bin/env python3
"""Emit legacy-format drawable arrays for the baseline harness.

The 2011 HyperbolicViewport.js consumes its own drawable shape, not the v2 schema, so the baseline
harness needs the data in the original form. Output goes to build/baseline/ and is NOT committed:
it exists only so the original code can be benchmarked as it was.

Ordering matches docs/*.json (by depth, then id) so the two are drawing the same thing in the same
order and the comparison is apples to apples.

Usage:  python3 bench/make_legacy_fixtures.py [--fixtures build/fixtures] [--out build/baseline]
"""

import argparse
import json
import os
import sys

DATASETS = ("escher", "dungeon", "clock", "relativity")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fixtures", default="build/fixtures")
    ap.add_argument("--out", default="build/baseline")
    ap.add_argument("datasets", nargs="*", default=None)
    args = ap.parse_args(argv)

    os.makedirs(args.out, exist_ok=True)
    for name in args.datasets or list(DATASETS):
        src = os.path.join(args.fixtures, f"{name}.jsonl")
        if not os.path.exists(src):
            print(f"{name}: missing {src}; run tools/babudb_dump.py first", file=sys.stderr)
            return 1
        seen = {}
        with open(src) as f:
            for line in f:
                rec = json.loads(line)
                seen.setdefault(rec["id"], rec)
        records = sorted(seen.values(), key=lambda r: (r["depth"], r["id"]))
        drawables = [r["drawable"] for r in records]
        out_path = os.path.join(args.out, f"{name}-legacy.json")
        with open(out_path, "w") as f:
            json.dump(drawables, f, separators=(",", ":"))
        print(f"{name}: {len(drawables)} legacy drawables -> {out_path} ({os.path.getsize(out_path)/1e6:.2f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
