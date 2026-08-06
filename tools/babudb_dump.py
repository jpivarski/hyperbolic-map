#!/usr/bin/env python3
"""Dump the 2011 BabuDB example databases to JSON Lines.

Local regeneration tool. It reads from OLD/, which is .gitignored source material, so this is not
part of the build and not shipped in the npm package. Its output (docs/*.json, via
make_docs_data.py) is committed instead.

No dependencies: not BabuDB, not a JVM, not JPype. The stores are BabuDB 0.5.6 block files whose
values happen to be plain JSON, and the block format is simple enough to read with struct.
(The legacy route, OLD/hyperbolic-storage-space/svgtools/dumpdb.py, is broken anyway: hardcoded
Java 6 paths, Python 2 syntax, and a jar that was never built.)

Block layout, all big-endian:

    int32 valuesOffset
    int32 numEntries
    int32 fixedKeyLen        (-1 = variable)
    int32 fixedValLen        (-1 = variable; 6 in blockindex.idx)
    byte[] keys              concatenated, from offset 16
    int32[numEntries]        key END offsets, relative to 16, at (valuesOffset - 4*numEntries)
    byte[] values            concatenated, from valuesOffset
    int32[numEntries]        value END offsets, relative to valuesOffset, at (end - 4*numEntries)

blockindex.idx gives each block's offset within blockfile_0.idx (int32 offset + int16 file number).
In blockfile_0.idx the key is 20 bytes (int32 latitude, int64 longitude, int64 id) and the value is
three doubles (depth, minRadius, maxRadius) followed by raw UTF-8 JSON.

Do NOT be tempted to extract with `strings`: the JSON is plain text, but the 24-byte numeric prefix
carries the z-order (depth) and the level-of-detail gates, and the key carries the tile assignment.

Usage:
    python3 tools/babudb_dump.py [--old OLD] [--out build/fixtures] [dataset ...]
"""

import argparse
import glob
import json
import os
import struct
import sys

DATASETS = ("escher", "dungeon", "clock", "relativity")


def block_offsets(index_path):
    """Read blockindex.idx and return the sorted block offsets into the block file."""
    data = open(index_path, "rb").read()
    values_offset, num_entries, _fixed_key, fixed_val = struct.unpack_from(">iiii", data, 0)
    if fixed_val != 6:
        raise ValueError(f"{index_path}: expected 6-byte index values, got {fixed_val}")
    offsets = []
    for i in range(num_entries):
        offset, _file_no = struct.unpack_from(">ih", data, values_offset + 6 * i)
        offsets.append(offset)
    return sorted(offsets)


def read_block(data, start, end):
    """Yield (key_bytes, value_bytes) for one block spanning [start, end)."""
    values_offset, num_entries, _fk, _fv = struct.unpack_from(">iiii", data, start)

    key_ends = struct.unpack_from(f">{num_entries}i", data, start + values_offset - 4 * num_entries)
    keys = []
    prev = 0
    for e in key_ends:
        keys.append(data[start + 16 + prev : start + 16 + e])
        prev = e

    # The value-end array sits at the end of the block, so its position follows from the block
    # boundary rather than from anything stored in the header.
    values_len = end - start - values_offset - 4 * num_entries
    value_ends = struct.unpack_from(f">{num_entries}i", data, start + values_offset + values_len)
    prev = 0
    for i, e in enumerate(value_ends):
        yield keys[i], data[start + values_offset + prev : start + values_offset + e]
        prev = e


def records(dataset_dir):
    """Yield dicts for every record in one dataset directory."""
    index_paths = glob.glob(os.path.join(dataset_dir, "databases", "geoTiles", "*", "blockindex.idx"))
    block_paths = glob.glob(os.path.join(dataset_dir, "databases", "geoTiles", "*", "blockfile_0.idx"))
    if not index_paths or not block_paths:
        raise FileNotFoundError(f"no geoTiles index/blockfile under {dataset_dir}")

    offsets = block_offsets(index_paths[0])
    data = open(block_paths[0], "rb").read()
    bounds = offsets + [len(data)]

    for i in range(len(offsets)):
        for key, value in read_block(data, bounds[i], bounds[i + 1]):
            latitude, longitude, ident = struct.unpack(">iqq", key)
            depth, min_radius, max_radius = struct.unpack_from(">ddd", value, 0)
            yield {
                "latitude": latitude,
                "longitude": longitude,
                "id": ident,
                "depth": depth,
                "minRadius": min_radius,
                "maxRadius": max_radius,
                "drawable": json.loads(value[24:]),
            }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--old", default="OLD", help="path to the OLD/ source tree (default: OLD)")
    ap.add_argument("--out", default="build/fixtures", help="output directory for .jsonl files")
    ap.add_argument("datasets", nargs="*", default=None, help=f"which datasets (default: all of {', '.join(DATASETS)})")
    args = ap.parse_args(argv)

    wanted = args.datasets or list(DATASETS)
    os.makedirs(args.out, exist_ok=True)

    total = 0
    failures = 0
    for name in wanted:
        dataset_dir = os.path.join(args.old, "disk1", "hyperbolicdb", name)
        if not os.path.isdir(dataset_dir):
            print(f"{name}: MISSING at {dataset_dir}", file=sys.stderr)
            failures += 1
            continue

        out_path = os.path.join(args.out, f"{name}.jsonl")
        count = 0
        unique = set()
        with open(out_path, "w") as f:
            for rec in records(dataset_dir):
                f.write(json.dumps(rec, separators=(",", ":"), sort_keys=True))
                f.write("\n")
                count += 1
                unique.add(rec["id"])
        total += count
        print(f"{name}: {count} records ({len(unique)} unique ids) -> {out_path}")

    print(f"total: {total} records")
    if total and total != 137080:
        # The audited record count. A mismatch means the parse drifted or the source changed.
        print(f"WARNING: expected 137080 records across all four datasets, got {total}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
