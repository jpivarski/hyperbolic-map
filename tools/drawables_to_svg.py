#!/usr/bin/env python3
"""Convert hyperbolic-map-widget drawables into an SVG you can edit in Inkscape.

    python3 drawables_to_svg.py FROM-FILE TO-FILE JSON-PATH [--coords ...] [--guidelines ...]

FROM-FILE is a JSON document, JSON-PATH picks the array of drawables inside it (see
`resolve_json_path`), and TO-FILE is the SVG to write.  Edit that SVG in Inkscape, then feed it back
through `svg_to_drawables.py`.

The chosen coordinate system is recorded in the SVG, in a namespace Inkscape leaves alone, so
`svg_to_drawables.py` can invert the projection without being told which one you used.

Standard library only, and deliberately standalone -- users of this library have Python available but
no environment in which to install anything.  See tools/README.md.
"""

import argparse
import json
import math
import re
import sys
import xml.etree.ElementTree as ET

# --------------------------------------------------------------------------------------------------
# KEEP IN SYNC.  `resolve_json_path` below is duplicated VERBATIM in drawables_to_svg.py and
# svg_to_drawables.py.  The two scripts are deliberately standalone -- there is no shared module to
# install -- so the only defense against the copies drifting apart is that they are, and remain,
# character-for-character identical.  If you change one, change the other.
# --------------------------------------------------------------------------------------------------


def resolve_json_path(document, json_path):
    """Follow a dotted path into a JSON document.

    Returns `(parent, key, value)`, so that a reader can use `value` and a writer can replace it with
    `parent[key] = new_value`.  For the empty path, `parent` and `key` are None and `value` is the
    whole document.

    A path is a dot-separated list of steps, as in `drawables` or `critters.fairy` or
    `layers.3.shapes`.  At each step, the step is used as a key if the current node is a JSON object
    and as an integer index if it is a JSON array; a step that is not a valid integer at an array
    level, or that is missing at an object level, is an error naming the path so far.
    """
    if json_path is None:
        json_path = ""
    json_path = json_path.strip()
    if json_path in ("", "."):
        return None, None, document

    steps = json_path.split(".")
    parent, key, value = None, None, document
    for depth, step in enumerate(steps):
        so_far = ".".join(steps[:depth]) or "(root)"
        if isinstance(value, dict):
            if step not in value:
                raise KeyError(
                    "no key {!r} at {} -- available keys: {}".format(
                        step, so_far, ", ".join(sorted(value)) or "(none)"
                    )
                )
            parent, key = value, step
        elif isinstance(value, list):
            try:
                index = int(step)
            except ValueError:
                raise KeyError(
                    "{} is a JSON array, so the next step must be an integer index, not {!r}".format(
                        so_far, step
                    )
                ) from None
            if not -len(value) <= index < len(value):
                raise IndexError(
                    "index {} is out of range at {} -- the array has {} entries".format(
                        index, so_far, len(value)
                    )
                )
            parent, key = value, index
        else:
            raise TypeError(
                "cannot descend into the {} at {} -- {!r} is not an object or an array".format(
                    type(value).__name__, so_far, value
                )
            )
        value = parent[key]

    return parent, key, value


# --------------------------------------------------------------------------------------------------
# End of the shared region.
# --------------------------------------------------------------------------------------------------

NAMESPACE = "https://github.com/jpivarski/hyperbolic-map-widget"
SVG_NAMESPACE = "http://www.w3.org/2000/svg"

GUIDELINES_CLASS = "hyperbolic-map-widget-guidelines"
DRAWABLES_CLASS = "hyperbolic-map-widget-drawables"

# The library's own defaults, from DEFAULT_STYLE in src/data/drawable.js.  A style attribute is
# written into the SVG whenever it matters for display, but `svg_to_drawables.py` only writes one
# back into the JSON when it differs from these -- which is what makes a round trip reproduce the
# original key set rather than a fully expanded one.
DEFAULT_FILL = "none"
DEFAULT_STROKE = "#000000"
DEFAULT_LINE_WIDTH = 1.0
DEFAULT_LINE_CAP = "butt"
DEFAULT_LINE_JOIN = "miter"
DEFAULT_MITER_LIMIT = 4.0
DEFAULT_MARKER_RADIUS = 3.5
DEFAULT_MARKER_FILL = "#000000"

# From src/render/renderer.js: text size is FONT_SCALE * BASE_FONT_PX * (projected |up - at|) * scale.
FONT_SCALE = 0.05
BASE_FONT_PX = (14.0 * 96.0) / 72.0

# Layout.  The content is fitted to CANVAS_PX on its longer side, with MARGIN_FRACTION of that as a
# border, and the exact affine is recorded in the metadata so the inverse is read rather than guessed.
CANVAS_PX = 1000.0
MARGIN_FRACTION = 0.04

# `lineWidth` and `markerRadius` are viewer PIXELS, not geometry, so they have no canonical size in
# SVG user units.  Peg them to a nominal viewer scale: 300 px per unit is about what `view.radius`
# comes to for a 620 px canvas at zoom 1.
NOMINAL_VIEWER_SCALE = 300.0

# Guidelines are sampled along the true hyperbolic curve, not drawn straight between vertices -- a
# {8,3} tile edge bows a long way in every one of the three coordinate systems.
SAMPLES_PER_TILE_EDGE = 48
SAMPLES_PER_R_STROKE = 16

GRAY_BASE = "#bbbbbb"
GRAY_NEIGHBOR = "#dddddd"


# --------------------------------------------------------------------------------------------------
# Coordinates.  Ported from src/core/coords.js and src/core/isom.js; the half-plane pair are the
# CORRECTED forms, whose comments there explain what the canceling versions broke.
# --------------------------------------------------------------------------------------------------


def local_companion(x, y):
    return math.sqrt(1.0 + x * x + y * y)


def local_to_disk(x, y):
    w = local_companion(x, y)
    return x / w, y / w


def disk_to_local(zx, zy):
    r2 = zx * zx + zy * zy
    if r2 >= 1.0:
        raise ValueError("disk coordinate ({}, {}) is not inside the unit circle".format(zx, zy))
    k = 1.0 / math.sqrt(1.0 - r2)
    return zx * k, zy * k


def local_to_half_plane(px, py):
    r2 = px * px + py * py
    w = math.sqrt(r2 + 1.0)
    if py > 0.0:
        denom = (4.0 * px * px * w * w + 1.0) / (2.0 * r2 + 1.0 + 2.0 * py * w)
    else:
        denom = 2.0 * r2 + 1.0 - 2.0 * py * w
    return (2.0 * px * w) / denom, 1.0 / denom


def half_plane_to_local(px, py):
    minus = math.hypot(px, py - 1.0)
    plus = math.hypot(px, py + 1.0)
    if plus == 0.0:
        return 0.0, 0.0
    t = minus / plus
    if t == 0.0:
        return 0.0, 0.0
    if t >= 1.0:
        t = 1.0 - sys.float_info.epsilon
    sinh_half = t / math.sqrt((1.0 - t) * (1.0 + t))
    dd = px * px + (py + 1.0) * (py + 1.0)
    qr = (px * px + (py - 1.0) * (py + 1.0)) / dd
    qi = ((py - 1.0) * px - px * (py + 1.0)) / dd
    zx, zy = -qi, qr
    mod = math.hypot(zx, zy)
    if mod == 0.0:
        return 0.0, 0.0
    return sinh_half * zx / mod, sinh_half * zy / mod


def local_to_target(x, y, coords):
    if coords == "local":
        return x, y
    if coords == "disk":
        return local_to_disk(x, y)
    if coords == "halfplane":
        return local_to_half_plane(x, y)
    raise ValueError("unknown coordinate system {!r}".format(coords))


def target_to_local(x, y, coords):
    """The inverse, used only to measure what the round trip costs -- see `check_precision`."""
    if coords == "local":
        return x, y
    if coords == "disk":
        return disk_to_local(x, y)
    if coords == "halfplane":
        return half_plane_to_local(x, y)
    raise ValueError("unknown coordinate system {!r}".format(coords))


class Isom:
    """An orientation-preserving isometry as an SU(1,1) matrix; see src/core/isom.js."""

    __slots__ = ("ar", "ai", "br", "bi")

    def __init__(self, ar, ai, br, bi):
        self.ar, self.ai, self.br, self.bi = ar, ai, br, bi

    @staticmethod
    def rotation(theta):
        # Half-angle because this is the spin double cover, not a typo.
        return Isom(math.cos(theta / 2.0), math.sin(theta / 2.0), 0.0, 0.0)

    @staticmethod
    def translation_to_disk(bx, by):
        k = 1.0 / math.sqrt(1.0 - bx * bx - by * by)
        return Isom(k, 0.0, bx * k, by * k)

    def mul(self, o):
        return Isom(
            self.ar * o.ar - self.ai * o.ai + self.br * o.br + self.bi * o.bi,
            self.ar * o.ai + self.ai * o.ar + self.bi * o.br - self.br * o.bi,
            self.ar * o.br - self.ai * o.bi + self.br * o.ar + self.bi * o.ai,
            self.ar * o.bi + self.ai * o.br + self.bi * o.ar - self.br * o.ai,
        )

    def apply_to_disk(self, zx, zy):
        nr = self.ar * zx - self.ai * zy + self.br
        ni = self.ar * zy + self.ai * zx + self.bi
        dr = self.br * zx + self.bi * zy + self.ar
        di = self.br * zy - self.bi * zx - self.ai
        s = 1.0 / (dr * dr + di * di)
        return (nr * dr + ni * di) * s, (ni * dr - nr * di) * s


def geodesic_samples_disk(z1, z2, segments):
    """Sample the geodesic from z1 to z2 (both disk coordinates), endpoints included.

    Translate z1 to the origin, where the geodesic is a straight ray and arc length is
    2*atanh(r), step along it at equal hyperbolic distance, and translate back.
    """
    a = complex(z1[0], z1[1])
    b = complex(z2[0], z2[1])
    t = (b - a) / (1.0 - a.conjugate() * b)
    r = abs(t)
    if r < 1e-15 or segments < 1:
        return [z1, z2]
    distance = 2.0 * math.atanh(min(r, 1.0 - 1e-15))
    direction = t / r
    out = []
    for i in range(segments + 1):
        step = math.tanh((i / segments) * distance / 2.0) * direction
        z = (step + a) / (1.0 + a.conjugate() * step)
        out.append((z.real, z.imag))
    return out


def geodesic_polyline_disk(points, segments):
    """Sample a whole polyline of disk points, geodesic by geodesic, without duplicating joints."""
    out = []
    for i in range(len(points) - 1):
        piece = geodesic_samples_disk(points[i], points[i + 1], segments)
        out.extend(piece if i == 0 else piece[1:])
    return out


# --------------------------------------------------------------------------------------------------
# Guidelines.  Only this script computes them -- `svg_to_drawables.py` merely skips the group -- so
# nothing here has to be kept in sync with anything.
# --------------------------------------------------------------------------------------------------

# A capital R as thin polylines, in a normalized box: u across, v up, both roughly 0..1.  Its job is
# to show the ORIENTATION each neighboring tile is placed in, which needs a glyph that is neither
# rotationally symmetric nor mirror-symmetric.
R_STROKES = [
    [(0.0, 0.0), (0.0, 1.0)],
    [(0.0, 1.0), (0.55, 1.0), (0.75, 0.87), (0.75, 0.63), (0.55, 0.5), (0.0, 0.5)],
    [(0.3, 0.5), (0.78, 0.0)],
]
R_CENTER_U = 0.39


def letter_r_disk(height_local):
    """The letter R, centered on the tile center, as geodesic-sampled polylines in disk coordinates."""
    out = []
    for stroke in R_STROKES:
        corners = [
            local_to_disk((u - R_CENTER_U) * height_local, (v - 0.5) * height_local)
            for u, v in stroke
        ]
        out.append(geodesic_polyline_disk(corners, SAMPLES_PER_R_STROKE))
    return out


def regular_metrics(p, q):
    """{p, q} metric relations at K = -1; see src/data/atlas/tiling.js and notes/tilings.md."""
    if not (1.0 / p + 1.0 / q < 0.5):
        raise ValueError("{{{},{}}} is not hyperbolic (need 1/p + 1/q < 1/2)".format(p, q))
    chi = math.acosh(1.0 / (math.tan(math.pi / p) * math.tan(math.pi / q)))
    psi = math.acosh(math.cos(math.pi / q) / math.sin(math.pi / p))
    return chi, psi


def regular_tiling_guides(p, q, frame_symmetry):
    """Base tile border, one ring of neighbors, and an R showing each neighbor's orientation."""
    m = frame_symmetry or p
    if p % m != 0:
        raise ValueError("frameSymmetry {} must divide p = {}".format(m, p))
    chi, psi = regular_metrics(p, q)

    # Vertices at pi/p + 2*pi*k/p, so that edge midpoints land on 2*pi*k/p.
    circum = math.tanh(chi / 2.0)
    vertices = []
    for k in range(p):
        angle = math.pi / p + (2.0 * math.pi * k) / p
        vertices.append((circum * math.cos(angle), circum * math.sin(angle)))

    if m == p:
        # Half-turn about each edge midpoint: the "2" of the (2, p, q) triangle group.
        g0 = Isom(0.0, math.cosh(psi), 0.0, -math.sinh(psi))
        generators = [
            Isom.rotation(2.0 * math.pi * k / p).mul(g0).mul(Isom.rotation(-2.0 * math.pi * k / p))
            for k in range(p)
        ]
    else:
        # The half-turn is outside the subgroup whose stabilizer is C_m, so rotate about every m-th
        # vertex instead.  This is the {8,3} frameSymmetry=4 case that Circle Limit III needs.
        generators = []
        for k in range(0, p, p // m):
            vx, vy = vertices[k]
            for sense in (1, -1):
                generators.append(
                    Isom.translation_to_disk(vx, vy)
                    .mul(Isom.rotation(sense * 2.0 * math.pi / q))
                    .mul(Isom.translation_to_disk(-vx, -vy))
                )

    border = geodesic_polyline_disk(vertices + [vertices[0]], SAMPLES_PER_TILE_EDGE)
    letter = letter_r_disk(1.2 * math.sinh(psi / 2.0))

    curves = [{"disk": border, "closed": True, "stroke": GRAY_BASE}]
    seen = []
    for g in generators:
        center = g.apply_to_disk(0.0, 0.0)
        if any(math.hypot(center[0] - sx, center[1] - sy) < 1e-9 for sx, sy in seen):
            continue
        seen.append(center)
        curves.append(
            {
                "disk": [g.apply_to_disk(*z) for z in border],
                "closed": True,
                "stroke": GRAY_NEIGHBOR,
            }
        )
        for stroke in letter:
            curves.append(
                {
                    "disk": [g.apply_to_disk(*z) for z in stroke],
                    "closed": False,
                    "stroke": GRAY_NEIGHBOR,
                }
            )
    return curves, len(seen)


# The binary cell, in its own half-plane frame: the same box for every (lat, lon), which is what lets
# one prototype room be drawn in every cell.  From src/data/atlas/tiling.js.
BINARY_HALF_WIDTH = 0.5 / math.sqrt(2.0)
BINARY_Y_LOW = 1.0 / math.sqrt(2.0)
BINARY_Y_HIGH = math.sqrt(2.0)


def binary_scale_shift(scale, shift):
    """The half-plane map z -> scale*z + shift, conjugated into SU(1,1) by the Cayley transform."""
    rs = math.sqrt(scale)
    inv = 1.0 / rs
    return Isom((rs + inv) / 2.0, (shift * inv) / 2.0, (shift * inv) / 2.0, (rs - inv) / 2.0)


def binary_cell_border_disk():
    """The cell outline: two horocyclic sides (y constant) and two geodesic sides (x constant).

    Sampled in the half-plane, where both kinds are exactly straight, then converted -- so the
    curvature they pick up in the disk and in local coordinates is captured rather than lost.
    """
    n = SAMPLES_PER_TILE_EDGE
    half_plane = []

    def horocycle(y, x_from, x_to):
        # y = const is a horocycle, exactly straight in the half-plane: sample linearly in x.
        return [(x_from + (x_to - x_from) * i / n, y) for i in range(n + 1)]

    def geodesic(x, y_from, y_to):
        # x = const is a geodesic; y stepped geometrically is uniform in hyperbolic arc length.
        ratio = y_to / y_from
        return [(x, y_from * ratio ** (i / n)) for i in range(n + 1)]

    half_plane.extend(horocycle(BINARY_Y_LOW, -BINARY_HALF_WIDTH, BINARY_HALF_WIDTH))
    half_plane.extend(geodesic(BINARY_HALF_WIDTH, BINARY_Y_LOW, BINARY_Y_HIGH)[1:])
    half_plane.extend(horocycle(BINARY_Y_HIGH, BINARY_HALF_WIDTH, -BINARY_HALF_WIDTH)[1:])
    half_plane.extend(geodesic(-BINARY_HALF_WIDTH, BINARY_Y_HIGH, BINARY_Y_LOW)[1:-1])

    return [local_to_disk(*half_plane_to_local(hx, hy)) for hx, hy in half_plane]


def binary_tiling_guides():
    """Base cell plus its neighbors.

    A prototype cell does not know its own longitude, so it does not know which of the two parent
    steps applies -- the even one when it is a left child, the odd one when it is a right child.  Both
    are drawn; only one of them is a real neighbor of any given cell.
    """
    root2 = math.sqrt(2.0)
    generators = [
        binary_scale_shift(1.0, 1.0 / root2),  # lateral, right
        binary_scale_shift(1.0, -1.0 / root2),  # lateral, left
        binary_scale_shift(0.5, -0.25 / root2),  # child 0
        binary_scale_shift(0.5, 0.25 / root2),  # child 1
        binary_scale_shift(2.0, 0.5 / root2),  # parent, even longitude
        binary_scale_shift(2.0, -0.5 / root2),  # parent, odd longitude
    ]
    border = binary_cell_border_disk()
    curves = [{"disk": border, "closed": True, "stroke": GRAY_BASE}]
    for g in generators:
        curves.append(
            {
                "disk": [g.apply_to_disk(*z) for z in border],
                "closed": True,
                "stroke": GRAY_NEIGHBOR,
            }
        )
    return curves, len(generators)


GUIDELINES_PATTERN = re.compile(r"^\s*(BinaryTiling|RegularTiling)\s*(?:\(\s*([^)]*?)\s*\))?\s*$")


def build_guidelines(spec):
    """Parse a --guidelines spec and build its curves.  Returns (curves, description)."""
    match = GUIDELINES_PATTERN.match(spec)
    if match is None:
        raise ValueError(
            "--guidelines must be BinaryTiling() or RegularTiling(p, q, frameSymmetry), "
            "got {!r}".format(spec)
        )
    kind = match.group(1)
    raw = (match.group(2) or "").strip()
    args = [a.strip() for a in raw.split(",") if a.strip()] if raw else []

    if kind == "BinaryTiling":
        if args:
            raise ValueError("BinaryTiling() takes no arguments, got {!r}".format(spec))
        curves, count = binary_tiling_guides()
        return curves, "BinaryTiling(), {} neighboring cells".format(count)

    if not 2 <= len(args) <= 3:
        raise ValueError(
            "RegularTiling needs p, q and optionally frameSymmetry, got {!r}".format(spec)
        )
    try:
        numbers = [int(a) for a in args]
    except ValueError:
        raise ValueError("RegularTiling arguments must be integers, got {!r}".format(spec)) from None
    p, q = numbers[0], numbers[1]
    m = numbers[2] if len(numbers) == 3 else p
    curves, count = regular_tiling_guides(p, q, m)
    return curves, "RegularTiling({}, {}, {}), {} neighboring tiles".format(p, q, m, count)


# --------------------------------------------------------------------------------------------------
# Drawables -> geometry in the target coordinate system.
# --------------------------------------------------------------------------------------------------


def drawable_points(drawable, index):
    """The (x, y) local points a drawable is built from, whatever its type."""
    kind = drawable.get("type", "path")
    if kind == "path":
        points = drawable.get("points")
        if not isinstance(points, list):
            raise ValueError("drawable {} of type path has no points array".format(index))
        out = []
        for point in points:
            if not isinstance(point, list) or len(point) < 2:
                raise ValueError("drawable {} has a malformed point {!r}".format(index, point))
            out.append((float(point[0]), float(point[1])))
        return out
    if kind == "text":
        at, up = drawable.get("at"), drawable.get("up")
        if not (isinstance(at, list) and isinstance(up, list)):
            raise ValueError("drawable {} of type text needs both `at` and `up`".format(index))
        return [(float(at[0]), float(at[1])), (float(up[0]), float(up[1]))]
    if kind == "marker":
        at = drawable.get("at")
        if not isinstance(at, list):
            raise ValueError("drawable {} of type marker needs `at`".format(index))
        return [(float(at[0]), float(at[1]))]
    raise ValueError("drawable {} has unknown type {!r}".format(index, kind))


def point_flags(drawable):
    """The per-point flag strings of a path -- one per point, empty where there is no flag.

    Recorded even when every one is empty, which is not redundant: a path with no "L" anywhere strokes
    nothing however its `stroke` is set, and without the record `svg_to_drawables.py` would have to
    guess from the SVG's stroke and would wrongly stroke every edge.
    """
    flags = []
    for point in drawable.get("points") or []:
        flags.append(str(point[2]) if len(point) > 2 and isinstance(point[2], str) else "")
    return flags


# Everything about a drawable except its geometry is recorded verbatim, in `hmw:source`, alongside the
# original key ORDER in `hmw:keys`.  Two reasons.  Styles: an SVG attribute cannot say whether the JSON
# said `"stroke": "#000000"` or left it to the default, nor whether `lineWidth` was `2` or `2.0`, so a
# shape you did not touch would come back subtly rewritten; with the original to compare against,
# `svg_to_drawables.py` can leave it exactly as it was and change only what you actually edited.  And
# fields the SVG has no way to express at all -- `class`, `visibleTo`, `withinTile`, whatever a future
# version adds -- survive rather than being quietly dropped.
GEOMETRY_KEYS = ("points", "at", "up")


def source_record(drawable):
    return {k: v for k, v in drawable.items() if k not in GEOMETRY_KEYS}


# --------------------------------------------------------------------------------------------------
# Layout and SVG emission.
# --------------------------------------------------------------------------------------------------


def fmt(value):
    """Twelve significant digits: about 1e-9 of a 1000-unit canvas, far finer than the projection."""
    text = "%.12g" % (value,)
    return "0" if text in ("-0", "-0.0") else text


class Layout:
    """The affine from target coordinates to SVG user units, and its record for the metadata.

    `svg_x = origin_x + scale * x` and `svg_y = origin_y - scale * y`.  The y flip matches the
    renderer (`sy = -y * scale + cy`, src/render/renderer.js), so the SVG reads the same way up as
    the map viewer does.
    """

    def __init__(self, xs, ys):
        if not xs:
            raise ValueError("nothing to draw: the drawables array is empty")
        min_x, max_x, min_y, max_y = min(xs), max(xs), min(ys), max(ys)
        span = max(max_x - min_x, max_y - min_y)
        if span <= 0.0:
            span = 1.0
        self.scale = CANVAS_PX / span
        margin = MARGIN_FRACTION * CANVAS_PX
        self.origin_x = margin - min_x * self.scale
        self.origin_y = margin + max_y * self.scale
        self.width = (max_x - min_x) * self.scale + 2.0 * margin
        self.height = (max_y - min_y) * self.scale + 2.0 * margin
        self.stroke_scale = self.scale / NOMINAL_VIEWER_SCALE

    def to_svg(self, x, y):
        return self.origin_x + self.scale * x, self.origin_y - self.scale * y


def check_precision(layout, drawables, projected, coords):
    """Measure what a trip through the SVG actually costs, and say so.

    An SVG's precision is ABSOLUTE -- every coordinate is stored to the same fraction of the canvas --
    while `local` coordinates grow like `sinh(d/2)`.  So a dataset spanning a large hyperbolic distance
    cannot survive being squeezed into one page, and near the disk boundary the inverse projection
    amplifies whatever is left.  That is the conditioning limit docs/MATH.md section 6 describes, not
    something a tool can work around, so it is measured and reported rather than hidden.

    Returns (worst error in local units, its drawable index, its point index).
    """
    worst, where = 0.0, None
    for index, (drawable, shape) in enumerate(zip(drawables, projected)):
        original = drawable_points(drawable, index)
        for point, (x, y) in enumerate(shape):
            svg_x, svg_y = layout.to_svg(x, y)
            # Through the very text the file will carry, so this is the real thing and not a bound.
            svg_x, svg_y = float(fmt(svg_x)), float(fmt(svg_y))
            back_x = (svg_x - layout.origin_x) / layout.scale
            back_y = (layout.origin_y - svg_y) / layout.scale
            try:
                local_x, local_y = target_to_local(back_x, back_y, coords)
            except ValueError:
                return float("inf"), (index, point)
            error = max(abs(local_x - original[point][0]), abs(local_y - original[point][1]))
            if error > worst:
                worst, where = error, (index, point)
    return worst, where


def path_data(svg_points, closed):
    """`M x,y L x,y x,y ... Z` -- one `L` covering every subsequent point, as SVG allows."""
    head = "M {},{}".format(fmt(svg_points[0][0]), fmt(svg_points[0][1]))
    if len(svg_points) == 1:
        return head + " Z" if closed else head
    rest = " ".join("{},{}".format(fmt(x), fmt(y)) for x, y in svg_points[1:])
    return "{} L {}{}".format(head, rest, " Z" if closed else "")


def hmw(name):
    return "{{{}}}{}".format(NAMESPACE, name)


def style_attributes(drawable, layout, stroked):
    """Style attributes for display.  Written unconditionally where they matter, because SVG's own
    defaults are not the library's -- an omitted `fill` means "none" here but black in SVG."""
    attributes = {"fill": str(drawable.get("fill", DEFAULT_FILL))}
    if not stroked:
        return attributes
    attributes["stroke"] = str(drawable.get("stroke", DEFAULT_STROKE))
    if attributes["stroke"] != "none":
        line_width = float(drawable.get("lineWidth", DEFAULT_LINE_WIDTH))
        attributes["stroke-width"] = fmt(line_width * layout.stroke_scale)
        attributes["stroke-linecap"] = str(drawable.get("lineCap", DEFAULT_LINE_CAP))
        attributes["stroke-linejoin"] = str(drawable.get("lineJoin", DEFAULT_LINE_JOIN))
        attributes["stroke-miterlimit"] = fmt(
            float(drawable.get("miterLimit", DEFAULT_MITER_LIMIT))
        )
    return attributes


ALIGN_TO_ANCHOR = {"left": "start", "start": "start", "center": "middle",
                   "right": "end", "end": "end"}
BASELINE_TO_DOMINANT = {"top": "text-before-edge", "hanging": "hanging", "middle": "middle",
                        "alphabetic": "alphabetic", "ideographic": "ideographic",
                        "bottom": "text-after-edge"}


def emit_drawable(parent, drawable, svg_points, layout, index):
    kind = drawable.get("type", "path")

    if kind == "path":
        closed = drawable.get("closed", True) is not False
        attributes = {"d": path_data(svg_points, closed)}
        flags = point_flags(drawable)
        attributes.update(style_attributes(drawable, layout, stroked=True))
        element = ET.SubElement(parent, "path", attributes)
        element.set(hmw("flags"), ",".join(flags))

    elif kind == "marker":
        radius = float(drawable.get("radius", drawable.get("markerRadius", DEFAULT_MARKER_RADIUS)))
        element = ET.SubElement(
            parent,
            "circle",
            {
                "cx": fmt(svg_points[0][0]),
                "cy": fmt(svg_points[0][1]),
                "r": fmt(max(radius * layout.stroke_scale, 0.1)),
                "fill": str(drawable.get("markerFill", DEFAULT_MARKER_FILL)),
            },
        )
        element.set(hmw("type"), "marker")
        element.set(hmw("radius"), fmt(radius))

    elif kind == "text":
        # `up` is stored as a LENGTH, not a point, and the element is rotated to match.
        #
        # The renderer turns the text so that `up` points up in the glyphs' own frame, so in that
        # frame the up point is always straight above the anchor at distance |up - at|.  Storing the
        # length and letting the element's transform carry the direction means Inkscape moving,
        # rotating or scaling the text carries `up` with it -- which storing an absolute point does
        # not.  It also makes a hand-authored <text> with no hmw: attributes work, since the font
        # size alone then gives the length back.
        (ax, ay), (ux, uy) = svg_points
        length = math.hypot(ux - ax, uy - ay)
        attributes = {
            "x": fmt(ax),
            "y": fmt(ay),
            "font-size": fmt(max(length * FONT_SCALE * BASE_FONT_PX, 0.01)),
            "font-family": str(drawable.get("font", "sans-serif")),
            "fill": str(drawable.get("fill", "#000000")),
        }
        align = str(drawable.get("align", "center"))
        baseline = str(drawable.get("baseline", "alphabetic"))
        attributes["text-anchor"] = ALIGN_TO_ANCHOR.get(align, "middle")
        attributes["dominant-baseline"] = BASELINE_TO_DOMINANT.get(baseline, "alphabetic")
        if length > 0.0:
            degrees = math.degrees(math.atan2(uy - ay, ux - ax) + math.pi / 2.0)
            if abs(degrees) > 1e-12:
                attributes["transform"] = "rotate({},{},{})".format(fmt(degrees), fmt(ax), fmt(ay))
        element = ET.SubElement(parent, "text", attributes)
        element.text = str(drawable.get("text", ""))
        element.set(hmw("type"), "text")
        element.set(hmw("upLength"), fmt(length))

    else:
        raise ValueError("drawable {} has unknown type {!r}".format(index, kind))

    element.set(hmw("keys"), json.dumps(list(drawable.keys())))
    element.set(hmw("source"), json.dumps(source_record(drawable)))
    return element


def indent(element, level=0):
    """Two-space indentation, so the file is readable and diffable.  (ET.indent is 3.9+ only.)"""
    pad = "\n" + "  " * level
    if len(element):
        if not (element.text or "").strip():
            element.text = pad + "  "
        for child in element:
            indent(child, level + 1)
            if not (child.tail or "").strip():
                child.tail = pad + "  "
        if not (element[-1].tail or "").strip():
            element[-1].tail = pad
    return element


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Convert hyperbolic-map-widget drawables into an SVG for editing in Inkscape.",
        epilog="The coordinate system is recorded in the SVG, so svg_to_drawables.py can invert it.",
    )
    parser.add_argument("from_file", metavar="from-file", help="the JSON document to read")
    parser.add_argument("to_file", metavar="to-file", help="the SVG file to write")
    parser.add_argument(
        "json_path",
        metavar="JSON-path",
        help='dotted path to the drawables array, e.g. "drawables" or "critters.fairy"',
    )
    parser.add_argument(
        "--coords",
        choices=("local", "halfplane", "disk"),
        default="local",
        help="local: the drawables' own coordinates (default); halfplane: a Poincare half-plane; "
        "disk: a Poincare disk, as the map viewer presents it",
    )
    parser.add_argument(
        "--guidelines",
        metavar="SPEC",
        default=None,
        help='light gray tile borders beneath the art: "BinaryTiling()" or '
        '"RegularTiling(p, q, frameSymmetry)".  Omit for none.',
    )
    args = parser.parse_args(argv)

    with open(args.from_file, "r", encoding="utf-8") as stream:
        document = json.load(stream)

    _, _, drawables = resolve_json_path(document, args.json_path)
    if not isinstance(drawables, list):
        raise SystemExit(
            "error: {} in {} is a {}, not an array of drawables".format(
                args.json_path or "(root)", args.from_file, type(drawables).__name__
            )
        )
    drawables = [d for d in drawables if d]
    if any(not isinstance(d, dict) for d in drawables):
        raise SystemExit(
            "error: {} in {} is an array, but its entries are not drawable objects (found a {}).\n"
            "       Did you mean the array one level up?  A drawable looks like\n"
            '       {{"type": "path", "points": [[0.1, 0.2], ...]}}.'.format(
                args.json_path or "(root)",
                args.from_file,
                type(next(d for d in drawables if not isinstance(d, dict))).__name__,
            )
        )

    guidelines = []
    description = None
    if args.guidelines:
        curves, description = build_guidelines(args.guidelines)
        for curve in curves:
            guidelines.append(
                {
                    "target": [local_to_target(*disk_to_local(*z), args.coords) for z in curve["disk"]],
                    "closed": curve["closed"],
                    "stroke": curve["stroke"],
                }
            )

    # Project the art.
    projected = []
    for index, drawable in enumerate(drawables):
        points = drawable_points(drawable, index)
        projected.append([local_to_target(x, y, args.coords) for x, y in points])

    # Fit.  The unit circle and the half-plane's axis take part in the bounding box, since they are
    # drawn; the axis spans only the guidelines' own width, as it is an orientation aid, not an edge.
    xs = [x for shape in projected for x, _ in shape]
    ys = [y for shape in projected for _, y in shape]
    for curve in guidelines:
        xs.extend(x for x, _ in curve["target"])
        ys.extend(y for _, y in curve["target"])
    boundary_circle = False
    if guidelines and args.coords == "disk":
        boundary_circle = True
        xs.extend((-1.0, 1.0))
        ys.extend((-1.0, 1.0))
    if guidelines and args.coords == "halfplane":
        axis_xs = [x for curve in guidelines for x, _ in curve["target"]]
        guidelines.append(
            {
                "target": [(min(axis_xs), 0.0), (max(axis_xs), 0.0)],
                "closed": False,
                "stroke": GRAY_NEIGHBOR,
            }
        )
        xs.extend((min(axis_xs), max(axis_xs)))
        ys.append(0.0)

    layout = Layout(xs, ys)

    ET.register_namespace("", SVG_NAMESPACE)
    ET.register_namespace("hmw", NAMESPACE)
    root = ET.Element(
        "svg",
        {
            "width": fmt(layout.width),
            "height": fmt(layout.height),
            "viewBox": "0 0 {} {}".format(fmt(layout.width), fmt(layout.height)),
            "version": "1.1",
        },
    )

    params = {
        "generator": "hyperbolic-map-widget tools/drawables_to_svg.py",
        "version": 1,
        "coords": args.coords,
        "scale": layout.scale,
        "originX": layout.origin_x,
        "originY": layout.origin_y,
        "strokeScale": layout.stroke_scale,
        "guidelines": args.guidelines,
        "source": {"file": args.from_file, "jsonPath": args.json_path},
    }
    blob = json.dumps(params, sort_keys=True)
    # Written twice on purpose.  Both channels were verified to survive an Inkscape 1.1.2 save; two
    # of them means a future Inkscape dropping one is a warning rather than a broken round trip.
    root.set(hmw("params"), blob)
    metadata = ET.SubElement(root, "metadata")
    ET.SubElement(metadata, hmw("params")).text = blob

    # Guidelines first, so they sit underneath the art.
    if guidelines:
        group = ET.SubElement(
            root, "g", {"class": GUIDELINES_CLASS, "fill": "none", "stroke-width": "1.5"}
        )
        if boundary_circle:
            center = layout.to_svg(0.0, 0.0)
            ET.SubElement(
                group,
                "circle",
                {
                    "cx": fmt(center[0]),
                    "cy": fmt(center[1]),
                    "r": fmt(layout.scale),
                    "fill": "none",
                    "stroke": GRAY_NEIGHBOR,
                },
            )
        for curve in guidelines:
            svg_points = [layout.to_svg(x, y) for x, y in curve["target"]]
            ET.SubElement(
                group,
                "path",
                {"d": path_data(svg_points, curve["closed"]), "stroke": curve["stroke"]},
            )

    group = ET.SubElement(root, "g", {"class": DRAWABLES_CLASS})
    for index, (drawable, shape) in enumerate(zip(drawables, projected)):
        emit_drawable(group, drawable, [layout.to_svg(x, y) for x, y in shape], layout, index)

    indent(root)
    tree = ET.ElementTree(root)
    with open(args.to_file, "wb") as stream:
        tree.write(stream, encoding="utf-8", xml_declaration=True)

    print(
        "wrote {}: {} drawables in {} coordinates, {:.0f} x {:.0f} units".format(
            args.to_file, len(drawables), args.coords, layout.width, layout.height
        ),
        file=sys.stderr,
    )
    if description:
        print("guidelines: {}".format(description), file=sys.stderr)

    # The error is measured in LOCAL units, so the yardstick has to be the local extent too, not the
    # projected one -- in `disk` coordinates everything is inside 1 no matter how far out the data goes.
    extent = max(
        (abs(v) for index, d in enumerate(drawables) for p in drawable_points(d, index) for v in p),
        default=0.0,
    )
    worst, where = check_precision(layout, drawables, projected, args.coords)
    tolerable = 1e-6 * max(1.0, extent)
    print(
        "round-trip precision: worst {:.2g} local units of {:.4g} (drawable {}, point {})".format(
            worst, extent, *(where if where else ("-", "-"))
        ),
        file=sys.stderr,
    )
    if worst > tolerable:
        print(
            "WARNING: that is coarse.  An SVG stores every coordinate to the same fraction of the\n"
            "         page, but local coordinates grow like sinh(d/2), so data spanning a large\n"
            "         hyperbolic distance cannot survive one page -- see docs/MATH.md section 6.\n"
            "         Editing this array in Inkscape will move points by that much.  Try\n"
            "         --coords local, or split the data into an atlas of tiles and convert one\n"
            "         tile at a time.",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, KeyError, IndexError, TypeError, OSError) as error:
        # A traceback tells the user about this script; a message tells them about their data.
        # OSError puts an errno in args[0], so only a string one is the message.
        detail = error.args[0] if error.args and isinstance(error.args[0], str) else error
        raise SystemExit("error: {}".format(detail)) from None
