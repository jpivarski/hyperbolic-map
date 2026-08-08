#!/usr/bin/env python3
"""Serve the repo and accept canvas captures over HTTP.

Local test tool. Page screenshots include browser chrome and get rescaled; this instead takes the
canvas's own pixels via toDataURL and writes them to disk, so rendered output can be inspected and
diffed exactly.

    GET  /...                     serve files from the repo root
    POST /__shot/<name>.png       body is a data: URL or raw base64; written to build/shots/<name>.png

Usage:  python3 dev/capture_server.py [--port 8820] [--root .] [--out build/shots]
"""

import argparse
import base64
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

OUT_DIR = "build/shots"


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass  # quiet

    def end_headers(self):
        # No caching, so a rebuilt bundle is never served stale to a test run.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_POST(self):
        if not self.path.startswith("/__shot/"):
            self.send_error(404)
            return
        name = os.path.basename(self.path[len("/__shot/") :]) or "shot.png"
        if not name.endswith(".png"):
            name += ".png"
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode("ascii", "replace")
        if body.startswith("data:"):
            body = body.split(",", 1)[1]
        try:
            raw = base64.b64decode(body)
        except Exception as exc:  # noqa: BLE001
            self.send_error(400, f"bad base64: {exc}")
            return
        os.makedirs(OUT_DIR, exist_ok=True)
        path = os.path.join(OUT_DIR, name)
        with open(path, "wb") as f:
            f.write(raw)
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(f"{path} {len(raw)}\n".encode())


def main(argv=None):
    global OUT_DIR
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8820)
    ap.add_argument("--root", default=".")
    ap.add_argument("--out", default="build/shots")
    args = ap.parse_args(argv)
    OUT_DIR = args.out
    os.chdir(args.root)
    os.makedirs(OUT_DIR, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"serving {os.getcwd()} on http://127.0.0.1:{args.port}  (captures -> {OUT_DIR})", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    sys.exit(main())
