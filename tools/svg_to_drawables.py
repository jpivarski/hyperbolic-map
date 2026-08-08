#!/usr/bin/env python3
"""Convert an SVG edited in Inkscape back into hyperbolic-map-widget drawables.

    python3 svg_to_drawables.py FROM-FILE TO-FILE JSON-PATH

FROM-FILE is the SVG, TO-FILE is a JSON document, and JSON-PATH picks the array inside it (see
`resolve_json_path`) that gets REPLACED by the shapes from the SVG.

This OVERWRITES that array in TO-FILE.  Copy the file first if you want to keep the original.

No --coords option: `drawables_to_svg.py` records the coordinate system it used in the SVG, and this
script reads it back and inverts the projection accordingly.  The
`class="hyperbolic-map-widget-guidelines"` group is recognized and ignored.

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

# The library's own defaults, from DEFAULT_STYLE in src/data/drawable.js (plus `closed`, which
# defaults to true, and `radius`, which falls back to markerRadius).  A field is written into the JSON
# only when it DIFFERS from these, so a round trip reproduces the original key set rather than a fully
# expanded one -- an omitted `fill` already means "none".
LIBRARY_DEFAULTS = {
    "closed": True,
    "fill": "none",
    "stroke": "#000000",
    "lineWidth": 1.0,
    "lineCap": "butt",
    "lineJoin": "miter",
    "miterLimit": 4.0,
    "radius": 3.5,
    "markerRadius": 3.5,
    "markerFill": "#000000",
    "align": "center",
    "baseline": "alphabetic",
    "font": "sans-serif",
}

# The fields this script derives from the SVG.  Anything else in `hmw:source` -- `class`, `visibleTo`,
# a field a future version adds -- is copied through untouched.
DERIVED_KEYS = frozenset(
    ["type", "closed", "points", "at", "up", "text", "fill", "stroke", "lineWidth", "lineCap",
     "lineJoin", "miterLimit", "radius", "markerFill", "align", "baseline", "font"]
)

DEFAULT_KEY_ORDER = {
    "path": ["type", "closed", "fill", "stroke", "lineWidth", "lineCap", "lineJoin", "miterLimit",
             "points"],
    "text": ["type", "text", "at", "up", "fill", "align", "baseline", "font"],
    "marker": ["type", "at", "radius", "markerFill"],
}

# From src/render/renderer.js, for reconstructing an `up` point from a hand-authored <text>.
FONT_SCALE = 0.05
BASE_FONT_PX = (14.0 * 96.0) / 72.0

# Recovered coordinates are written at the shortest precision that is still faithful to within
# COORDINATE_TOLERANCE, RELATIVE to the value.  Inverting the projection leaves float noise in the last
# few digits, and printing it would turn 0.43458 into 0.4345800000000001 for every point in the file;
# a relative tolerance strips that without coarsening small coordinates, which a fixed number of
# decimal places would.  1e-10 is far below anything the geometry or a pixel can see, and comfortably
# above the round trip's own error.
COORDINATE_TOLERANCE = 1e-10

# Containers whose contents are definitions rather than art.
SKIPPED_CONTAINERS = {"defs", "clipPath", "mask", "marker", "symbol", "pattern", "metadata",
                      "linearGradient", "radialGradient", "filter", "title", "desc", "style"}

# A <circle> or <ellipse> that is not a marker has to become a polygon, since the drawable format has
# no curves.  How many sides depends on how big it is: enough that the chords stay within a quarter of
# a user unit of the true curve, which is the same quarter-pixel threshold the renderer uses when it
# decides whether to draw a geodesic as an arc or a straight chord (src/render/renderer.js).
CIRCLE_SAGITTA = 0.25
CIRCLE_MIN_SAMPLES = 12
CIRCLE_MAX_SAMPLES = 256


def circle_samples(radius):
    if radius <= CIRCLE_SAGITTA:
        return CIRCLE_MIN_SAMPLES
    # sagitta = r * (1 - cos(pi/n)), so n = pi / acos(1 - sagitta/r)
    count = math.ceil(math.pi / math.acos(max(-1.0, 1.0 - CIRCLE_SAGITTA / radius)))
    return int(min(max(count, CIRCLE_MIN_SAMPLES), CIRCLE_MAX_SAMPLES))


def warn(message):
    print("warning: {}".format(message), file=sys.stderr)


# --------------------------------------------------------------------------------------------------
# Coordinates.  Ported from src/core/coords.js; the half-plane conversion is the CORRECTED form,
# whose comments there explain what the canceling version broke.
# --------------------------------------------------------------------------------------------------


def disk_to_local(zx, zy):
    r2 = zx * zx + zy * zy
    if r2 >= 1.0:
        # A point dragged onto or past the boundary circle is infinitely far away, which no local
        # coordinate can express.  Pull it just inside rather than crash, and say so.
        scale = (1.0 - 1e-12) / math.sqrt(r2)
        warn(
            "a point at disk radius {:.6f} is outside the unit circle (infinitely far away); "
            "clamped to the boundary".format(math.sqrt(r2))
        )
        zx, zy = zx * scale, zy * scale
        r2 = zx * zx + zy * zy
    k = 1.0 / math.sqrt(1.0 - r2)
    return zx * k, zy * k


def half_plane_to_local(px, py):
    if py <= 0.0:
        warn(
            "a point at half-plane y = {:.6f} is on or below the axis (outside the plane); "
            "clamped to just above it".format(py)
        )
        py = 1e-12
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


def target_to_local(x, y, coords):
    if coords == "local":
        return x, y
    if coords == "disk":
        return disk_to_local(x, y)
    if coords == "halfplane":
        return half_plane_to_local(x, y)
    raise ValueError("unknown coordinate system {!r}".format(coords))


# --------------------------------------------------------------------------------------------------
# SVG transforms.  Not optional: Inkscape writes a `transform` onto a group the moment you move it,
# so ignoring them would silently misplace everything the user touched.
# --------------------------------------------------------------------------------------------------

IDENTITY = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)

TRANSFORM_ITEM = re.compile(r"(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)")
NUMBER = re.compile(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")


def matrix_multiply(outer, inner):
    """Compose so that `inner` is applied first, then `outer`.  Both are SVG (a, b, c, d, e, f)."""
    a1, b1, c1, d1, e1, f1 = outer
    a2, b2, c2, d2, e2, f2 = inner
    return (
        a1 * a2 + c1 * b2,
        b1 * a2 + d1 * b2,
        a1 * c2 + c1 * d2,
        b1 * c2 + d1 * d2,
        a1 * e2 + c1 * f2 + e1,
        b1 * e2 + d1 * f2 + f1,
    )


def matrix_apply(matrix, x, y):
    a, b, c, d, e, f = matrix
    return a * x + c * y + e, b * x + d * y + f


def parse_transform(text):
    """An SVG transform list, composed left to right (leftmost applied last)."""
    if not text:
        return IDENTITY
    result = IDENTITY
    for name, body in TRANSFORM_ITEM.findall(text):
        numbers = [float(n) for n in NUMBER.findall(body)]
        if name == "matrix" and len(numbers) >= 6:
            item = tuple(numbers[:6])
        elif name == "translate" and numbers:
            item = (1.0, 0.0, 0.0, 1.0, numbers[0], numbers[1] if len(numbers) > 1 else 0.0)
        elif name == "scale" and numbers:
            sy = numbers[1] if len(numbers) > 1 else numbers[0]
            item = (numbers[0], 0.0, 0.0, sy, 0.0, 0.0)
        elif name == "rotate" and numbers:
            angle = math.radians(numbers[0])
            cos, sin = math.cos(angle), math.sin(angle)
            item = (cos, sin, -sin, cos, 0.0, 0.0)
            if len(numbers) >= 3:
                cx, cy = numbers[1], numbers[2]
                item = matrix_multiply((1.0, 0.0, 0.0, 1.0, cx, cy), item)
                item = matrix_multiply(item, (1.0, 0.0, 0.0, 1.0, -cx, -cy))
        elif name == "skewX" and numbers:
            item = (1.0, 0.0, math.tan(math.radians(numbers[0])), 1.0, 0.0, 0.0)
        elif name == "skewY" and numbers:
            item = (1.0, math.tan(math.radians(numbers[0])), 0.0, 1.0, 0.0, 0.0)
        else:
            warn("ignoring unparsable transform {!r}".format(text))
            continue
        result = matrix_multiply(result, item)
    return result


# --------------------------------------------------------------------------------------------------
# SVG styles.  Inkscape writes most of them into a `style` property list, which overrides the
# presentation attributes, so both have to be read.
# --------------------------------------------------------------------------------------------------

HEX_COLOR = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
RGB_COLOR = re.compile(r"^rgb\(\s*([\d.]+%?)\s*,\s*([\d.]+%?)\s*,\s*([\d.]+%?)\s*\)$")

STYLE_PROPERTIES = ("fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
                    "stroke-miterlimit", "fill-opacity", "stroke-opacity", "opacity", "display",
                    "font-size", "font-family", "text-anchor", "dominant-baseline")

# Canvas alignments and SVG's are not in bijection -- canvas `left` and `start` both mean
# text-anchor:start -- so these come in pairs and are used through `decide_mapped`, which asks whether
# the original still maps to what the SVG says rather than whether the reverse map reproduces it.
# These must stay the inverses of ALIGN_TO_ANCHOR / BASELINE_TO_DOMINANT in drawables_to_svg.py.
ALIGN_TO_ANCHOR = {"left": "start", "start": "start", "center": "middle",
                   "right": "end", "end": "end"}
ANCHOR_TO_ALIGN = {"start": "left", "middle": "center", "end": "right"}
BASELINE_TO_DOMINANT = {"top": "text-before-edge", "hanging": "hanging", "middle": "middle",
                        "alphabetic": "alphabetic", "ideographic": "ideographic",
                        "bottom": "text-after-edge"}
DOMINANT_TO_BASELINE = {"text-before-edge": "top", "hanging": "hanging", "middle": "middle",
                        "central": "middle", "alphabetic": "alphabetic",
                        "ideographic": "ideographic", "text-after-edge": "bottom"}


def element_style(element, inherited):
    """This element's resolved style: inherited, then presentation attributes, then `style`."""
    style = dict(inherited)
    for name in STYLE_PROPERTIES:
        value = element.get(name)
        if value is not None:
            style[name] = value.strip()
    declarations = element.get("style")
    if declarations:
        for declaration in declarations.split(";"):
            if ":" in declaration:
                name, _, value = declaration.partition(":")
                style[name.strip()] = value.strip()
    return style


def color_with_opacity(color, opacity):
    """Fold an opacity into the color, since the drawable format has no separate opacity field.

    `fill`/`stroke` strings go straight to a canvas context, so any CSS color works -- including
    `rgba(...)`.  Only hex and `rgb()` can be rewritten; anything else keeps its opacity dropped
    rather than being mangled.
    """
    if color is None or color == "none" or opacity is None or opacity >= 0.999:
        return color
    match = HEX_COLOR.match(color)
    if match:
        digits = color[1:]
        if len(digits) == 3:
            digits = "".join(c * 2 for c in digits)
        red, green, blue = (int(digits[i:i + 2], 16) for i in (0, 2, 4))
    else:
        match = RGB_COLOR.match(color)
        if not match:
            warn("cannot apply opacity {} to color {!r}; dropping the opacity".format(opacity, color))
            return color
        channels = []
        for group in match.groups():
            if group.endswith("%"):
                channels.append(int(round(float(group[:-1]) * 255.0 / 100.0)))
            else:
                channels.append(int(round(float(group))))
        red, green, blue = channels
    return "rgba({},{},{},{:g})".format(red, green, blue, round(opacity, 4))


def same_value(one, other):
    """Equal for round-trip purposes: 2 and 2.0 are, and so are two floats a division apart."""
    numeric = (int, float)
    if isinstance(one, numeric) and isinstance(other, numeric):
        if isinstance(one, bool) or isinstance(other, bool):
            return one == other
        one, other = float(one), float(other)
        return abs(one - other) <= 1e-9 * max(1.0, abs(one), abs(other))
    return one == other


UNSET = object()


def decide(out, key, value, source, default=UNSET):
    """Write `key` into `out`, preferring the original JSON wherever nothing actually changed.

    If the SVG says the same thing the source JSON said, the source's own spelling is kept -- so `2`
    does not become `2.0`, and an explicit `"stroke": "#000000"` neither disappears nor appears out of
    nowhere.  Otherwise the SVG wins, and the field is omitted when it merely restates a library
    default.  `value` of None means the SVG had nothing to say.
    """
    if value is None:
        if key in source:
            out[key] = source[key]
        return
    if key in source and same_value(value, source[key]):
        out[key] = source[key]
        return
    if default is UNSET:
        default = LIBRARY_DEFAULTS.get(key, UNSET)
    if default is UNSET or not same_value(value, default):
        out[key] = value


def decide_mapped(out, key, svg_value, source, forward, reverse):
    """`decide` for a field that went through a many-to-one mapping on the way out.

    `align: "start"` and `align: "left"` both write text-anchor:start, so the reverse map cannot tell
    which was meant.  The question that can be answered is whether the ORIGINAL still maps to what the
    SVG says -- if it does, nothing was edited, and the original stands.
    """
    if svg_value is None:
        if key in source:
            out[key] = source[key]
        return
    if key in source and forward.get(str(source[key])) == svg_value:
        out[key] = source[key]
        return
    decide(out, key, reverse.get(svg_value), source)


def assemble(order, decided, geometry):
    """Build the drawable, following the original key order so that diffs stay small."""
    fields = dict(decided)
    fields.update(geometry)
    out = {}
    for key in order:
        if key in fields:
            out[key] = fields.pop(key)
    out.update(fields)
    return out


def as_float(text, default=None):
    if text is None:
        return default
    match = NUMBER.search(str(text))
    return float(match.group(0)) if match else default


def resolved_paint(style):
    """(fill, stroke) as the drawable format wants them, with opacities folded in.

    Reading uses SVG's OWN defaults -- black fill, no stroke -- not the library's, so that a
    hand-written element without a `fill` comes in looking the way a browser draws it.  The library's
    defaults are used only when deciding which fields are worth writing back out.
    """
    overall = as_float(style.get("opacity"), 1.0)
    fill = style.get("fill", "#000000")
    stroke = style.get("stroke", "none")
    fill = color_with_opacity(fill, as_float(style.get("fill-opacity"), 1.0) * overall)
    stroke = color_with_opacity(stroke, as_float(style.get("stroke-opacity"), 1.0) * overall)
    return fill, stroke


# --------------------------------------------------------------------------------------------------
# SVG path data.
# --------------------------------------------------------------------------------------------------

PATH_TOKEN = re.compile(r"([MmZzLlHhVvCcSsQqTtAa])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)")

# Number of coordinates each command consumes per repetition, and how many trailing ones are the
# endpoint.  Curves keep only their endpoint: the drawable format has no curve segments, and the
# viewer joins consecutive points with geodesics.
COMMAND_ARITY = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "T": 2, "A": 7}
CURVE_COMMANDS = set("CcSsQqTtAa")


def parse_path_data(data):
    """Split a `d` attribute into subpaths: a list of (points, closed).  Returns curves flattened."""
    tokens = []
    for command, number in PATH_TOKEN.findall(data):
        tokens.append(command if command else float(number))

    subpaths = []
    points = []
    start = None
    current = (0.0, 0.0)
    command = None
    dropped_curves = False
    index = 0

    def flush(closed):
        # A one-point subpath is editing debris (a stray `M`), not a shape.
        if len(points) >= 2:
            subpaths.append((list(points), closed))
        points.clear()

    while index < len(tokens):
        token = tokens[index]
        if isinstance(token, str):
            command = token
            index += 1
            if command in ("Z", "z"):
                flush(True)
                if start is not None:
                    current = start
                command = None
                continue
            continue
        if command is None:
            warn("path data starts with a number, not a command; skipping it")
            return subpaths
        upper = command.upper()
        relative = command.islower()
        arity = COMMAND_ARITY[upper]
        numbers = []
        while len(numbers) < arity and index < len(tokens) and not isinstance(tokens[index], str):
            numbers.append(tokens[index])
            index += 1
        if len(numbers) < arity:
            warn("path data ends mid-command ({}); ignoring the remainder".format(command))
            break

        if upper == "H":
            point = (current[0] + numbers[0] if relative else numbers[0], current[1])
        elif upper == "V":
            point = (current[0], current[1] + numbers[0] if relative else numbers[0])
        else:
            end_x, end_y = numbers[-2], numbers[-1]
            point = (current[0] + end_x, current[1] + end_y) if relative else (end_x, end_y)
            if command in CURVE_COMMANDS:
                dropped_curves = True

        if upper == "M":
            flush(False)
            start = point
            # After a moveto, repeated coordinate pairs are implicit linetos.
            command = "l" if relative else "L"
        points.append(point)
        current = point

    flush(False)
    if dropped_curves:
        warn(
            "curve segments were reduced to their endpoints -- the drawable format has no curves, "
            "and the viewer joins consecutive points with geodesics"
        )
    return subpaths


# --------------------------------------------------------------------------------------------------
# Elements -> drawables.
# --------------------------------------------------------------------------------------------------


def local_name(tag):
    return tag.split("}", 1)[1] if "}" in tag else tag


def hmw(name):
    return "{{{}}}{}".format(NAMESPACE, name)


def points_attribute(text):
    numbers = [float(n) for n in NUMBER.findall(text or "")]
    return list(zip(numbers[0::2], numbers[1::2]))


class Converter:
    def __init__(self, params):
        self.coords = params["coords"]
        self.scale = float(params["scale"])
        self.origin_x = float(params["originX"])
        self.origin_y = float(params["originY"])
        self.stroke_scale = float(params.get("strokeScale") or (self.scale / 300.0))
        # What one unit of the SVG's own resolution comes to in target coordinates.  The writer emits
        # 12 significant digits of a value of order 1000, so about 1e-9 user units.
        self.noise_floor = 1e-9 / self.scale
        self.drawables = []

    # ---- geometry ----

    def to_target(self, svg_x, svg_y):
        return (svg_x - self.origin_x) / self.scale, (self.origin_y - svg_y) / self.scale

    def to_local(self, svg_x, svg_y):
        x, y = self.to_target(svg_x, svg_y)
        return target_to_local(x, y, self.coords)

    def tidy(self, value):
        """The shortest decimal that is faithful to `value`, with SVG-level noise snapped to zero."""
        if abs(value) < self.noise_floor:
            # Below what the SVG can carry at all.  A coordinate 1e-17 of the canvas across -- what
            # cos(pi/2) leaves behind -- cannot survive a trip through pixel space, because the affine
            # adds an origin of order 1000 to it.  Zero is the honest answer, not noise.
            return 0.0
        # The tolerance has an absolute part as well as a relative one, because an SVG's precision IS
        # absolute: every coordinate is stored to the same fraction of the canvas, so a small one has
        # a large relative error.  Without the absolute term, 0.003066 comes back as
        # 0.0030659999996 -- correct to the last digit the SVG could hold, and unreadable.
        tolerance = COORDINATE_TOLERANCE * abs(value) + self.noise_floor
        for digits in range(6, 18):
            candidate = float("%.*g" % (digits, value))
            if abs(candidate - value) <= tolerance:
                return candidate
        return value

    def round_point(self, x, y):
        return [self.tidy(x), self.tidy(y)]

    def local_points(self, svg_points):
        return [self.round_point(*self.to_local(x, y)) for x, y in svg_points]

    # ---- the original JSON, for anything the SVG cannot express ----

    def source(self, element):
        stored = element.get(hmw("source"))
        if not stored:
            return {}
        try:
            value = json.loads(stored)
        except ValueError:
            warn("ignoring unparsable hmw:source {!r}".format(stored))
            return {}
        return value if isinstance(value, dict) else {}

    def key_order(self, element, kind):
        stored = element.get(hmw("keys"))
        if stored:
            try:
                value = json.loads(stored)
            except ValueError:
                value = None
            if isinstance(value, list):
                return [str(key) for key in value]
            warn("ignoring unparsable hmw:keys {!r}".format(stored))
        return DEFAULT_KEY_ORDER[kind]

    @staticmethod
    def carried_over(decided, source):
        """Copy through every source field this script does not derive from the SVG itself."""
        for key, value in source.items():
            if key not in DERIVED_KEYS:
                decided[key] = value

    # ---- styles ----

    def style_fields(self, decided, style, source, stroked):
        fill, stroke = resolved_paint(style)
        decide(decided, "fill", fill, source)
        if not stroked:
            return stroke
        decide(decided, "stroke", stroke, source)
        width = as_float(style.get("stroke-width"), None)
        decide(
            decided,
            "lineWidth",
            None if width is None else round(width / self.stroke_scale, 6) + 0.0,
            source,
        )
        decide(decided, "lineCap", style.get("stroke-linecap"), source)
        decide(decided, "lineJoin", style.get("stroke-linejoin"), source)
        limit = as_float(style.get("stroke-miterlimit"), None)
        decide(decided, "miterLimit", None if limit is None else round(limit, 6) + 0.0, source)
        return stroke

    # ---- emitters ----

    def add_path(self, element, style, svg_points, closed):
        if len(svg_points) < 2:
            warn("skipping a path with fewer than two points")
            return
        source = self.source(element)
        decided = {}
        stroke = self.style_fields(decided, style, source, stroked=True)
        decide(decided, "closed", bool(closed), source)
        self.carried_over(decided, source)

        points = self.local_points(svg_points)
        flags = self.point_flags(element, len(points), stroke)
        for point, flag in zip(points, flags):
            if flag:
                point.append(flag)
        self.drawables.append(
            assemble(
                self.key_order(element, "path"), decided, {"type": "path", "points": points}
            )
        )

    def add_marker(self, element, style, center, radius_svg):
        source = self.source(element)
        decided = {}
        radius = as_float(element.get(hmw("radius")), None)
        if radius is None:
            radius = round(radius_svg / self.stroke_scale, 6)
        decide(decided, "radius", round(radius, 6) + 0.0, source)
        fill, _ = resolved_paint(style)
        decide(decided, "markerFill", fill, source)
        self.carried_over(decided, source)
        at = self.round_point(*self.to_local(*center))
        self.drawables.append(
            assemble(self.key_order(element, "marker"), decided, {"type": "marker", "at": at})
        )

    def add_text(self, element, style, matrix):
        text = "".join(element.itertext())
        anchor_x = as_float(element.get("x"), 0.0)
        anchor_y = as_float(element.get("y"), 0.0)
        at_svg = matrix_apply(matrix, anchor_x, anchor_y)

        # In the glyphs' own frame the up point is straight above the anchor, so only its DISTANCE
        # has to be recorded: the direction comes from the element's transform chain, which is what
        # makes an Inkscape move or rotation carry `up` along too.  Without hmw:upLength -- a
        # hand-authored <text> -- the font size gives the same number back, since the renderer's size
        # is FONT_SCALE * BASE_FONT_PX * |up - at| * scale.
        length = as_float(element.get(hmw("upLength")), None)
        if length is None:
            length = as_float(style.get("font-size"), 12.0) / (FONT_SCALE * BASE_FONT_PX)
        up_svg = matrix_apply(matrix, anchor_x, anchor_y - length)

        source = self.source(element)
        decided = {}
        decide(decided, "text", text, source)
        # Text is the one place where the library's own default is not what gets drawn: the renderer
        # falls back to black when a text drawable's fill is "none", so black is what "unchanged" means.
        fill, _ = resolved_paint(style)
        decide(decided, "fill", fill, source, default="#000000")
        decide_mapped(
            decided, "align", style.get("text-anchor"), source, ALIGN_TO_ANCHOR, ANCHOR_TO_ALIGN
        )
        decide_mapped(
            decided, "baseline", style.get("dominant-baseline"), source,
            BASELINE_TO_DOMINANT, DOMINANT_TO_BASELINE,
        )
        decide(decided, "font", style.get("font-family"), source)
        self.carried_over(decided, source)
        self.drawables.append(
            assemble(
                self.key_order(element, "text"),
                decided,
                {
                    "type": "text",
                    "at": self.round_point(*self.to_local(*at_svg)),
                    "up": self.round_point(*self.to_local(*up_svg)),
                },
            )
        )

    def point_flags(self, element, count, stroke):
        stored = element.get(hmw("flags"))
        if stored is not None:
            flags = stored.split(",")
            if len(flags) == count:
                return flags
            warn(
                "hmw:flags has {} entries but the path now has {} points, so the per-point "
                "stroke flags were re-inferred from the stroke".format(len(flags), count)
            )
        # No record, or the point count changed: a stroked shape strokes every edge, an unstroked
        # one strokes none -- which is exactly how the shipped data is written.
        return ["L"] * count if stroke and stroke != "none" else [""] * count

    # ---- traversal ----

    def walk(self, element, matrix, style):
        for child in element:
            if not isinstance(child.tag, str):
                continue  # a comment or a processing instruction
            if child.tag.startswith("{") and not child.tag.startswith("{" + SVG_NAMESPACE + "}"):
                continue  # sodipodi:namedview, inkscape:*, our own hmw:* -- not art
            name = local_name(child.tag)
            if name in SKIPPED_CONTAINERS:
                continue
            if GUIDELINES_CLASS in (child.get("class") or "").split():
                continue
            child_style = element_style(child, style)
            if child_style.get("display") == "none":
                continue
            child_matrix = matrix_multiply(matrix, parse_transform(child.get("transform")))
            self.visit(child, child_matrix, child_style)

    def visit(self, element, matrix, style):
        name = local_name(element.tag)

        if name in ("g", "a", "svg", "switch"):
            self.walk(element, matrix, style)
            return

        if name == "path":
            for points, closed in parse_path_data(element.get("d") or ""):
                self.add_path(element, style, [matrix_apply(matrix, x, y) for x, y in points], closed)
            return

        if name in ("polyline", "polygon"):
            points = points_attribute(element.get("points"))
            self.add_path(
                element,
                style,
                [matrix_apply(matrix, x, y) for x, y in points],
                closed=(name == "polygon"),
            )
            return

        if name == "line":
            corners = [
                (as_float(element.get("x1"), 0.0), as_float(element.get("y1"), 0.0)),
                (as_float(element.get("x2"), 0.0), as_float(element.get("y2"), 0.0)),
            ]
            self.add_path(element, style, [matrix_apply(matrix, x, y) for x, y in corners], False)
            return

        if name == "rect":
            x = as_float(element.get("x"), 0.0)
            y = as_float(element.get("y"), 0.0)
            width = as_float(element.get("width"), 0.0)
            height = as_float(element.get("height"), 0.0)
            if element.get("rx") or element.get("ry"):
                warn("a rect's rounded corners were squared off")
            corners = [(x, y), (x + width, y), (x + width, y + height), (x, y + height)]
            self.add_path(element, style, [matrix_apply(matrix, cx, cy) for cx, cy in corners], True)
            return

        if name in ("circle", "ellipse"):
            cx = as_float(element.get("cx"), 0.0)
            cy = as_float(element.get("cy"), 0.0)
            if name == "circle":
                rx = ry = as_float(element.get("r"), 0.0)
            else:
                rx = as_float(element.get("rx"), 0.0)
                ry = as_float(element.get("ry"), 0.0)
            if element.get(hmw("type")) == "marker":
                self.add_marker(element, style, matrix_apply(matrix, cx, cy), rx)
                return
            count = circle_samples(max(rx, ry))
            corners = [
                (cx + rx * math.cos(2.0 * math.pi * i / count),
                 cy + ry * math.sin(2.0 * math.pi * i / count))
                for i in range(count)
            ]
            self.add_path(element, style, [matrix_apply(matrix, x, y) for x, y in corners], True)
            return

        if name == "text":
            self.add_text(element, style, matrix)
            return

        if name in ("tspan", "textPath"):
            return  # already collected by the enclosing <text>

        warn("skipping unsupported element <{}>".format(name))


# --------------------------------------------------------------------------------------------------
# Metadata.
# --------------------------------------------------------------------------------------------------

REQUIRED_PARAMS = ("coords", "scale", "originX", "originY")


def read_params(root, filename):
    """Recover the projection parameters, from either of the two places they are written."""
    candidates = []
    stored = root.get(hmw("params"))
    if stored:
        candidates.append(("the hmw:params attribute on <svg>", stored))
    for metadata in root.iter(hmw("params")):
        if metadata.text:
            candidates.append(("<hmw:params> inside <metadata>", metadata.text))

    for where, blob in candidates:
        try:
            params = json.loads(blob)
        except ValueError:
            warn("{} is not valid JSON; trying the other copy".format(where))
            continue
        missing = [k for k in REQUIRED_PARAMS if k not in params]
        if missing:
            warn("{} is missing {}; trying the other copy".format(where, ", ".join(missing)))
            continue
        if len(candidates) > 1 and candidates[0][1] != candidates[-1][1]:
            warn("the two copies of hmw:params disagree; using {}".format(where))
        return params

    raise SystemExit(
        "error: {} carries no hyperbolic-map-widget metadata, so the coordinate system is "
        "unknown.\n       Only SVGs produced by drawables_to_svg.py can be converted back; if "
        "Inkscape stripped\n       the metadata, re-export from JSON and re-apply your edits.".format(
            filename
        )
    )


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Convert an SVG edited in Inkscape back into hyperbolic-map-widget drawables.",
        epilog="This OVERWRITES the array at JSON-path in to-file.  Copy the file first if you want "
        "to keep the original.",
    )
    parser.add_argument("from_file", metavar="from-file", help="the SVG file to read")
    parser.add_argument("to_file", metavar="to-file", help="the JSON document to modify in place")
    parser.add_argument(
        "json_path",
        metavar="JSON-path",
        help='dotted path to the drawables array to replace, e.g. "drawables" or "critters.fairy"',
    )
    args = parser.parse_args(argv)

    tree = ET.parse(args.from_file)
    root = tree.getroot()
    params = read_params(root, args.from_file)

    converter = Converter(params)
    root_style = element_style(root, {})
    converter.walk(root, parse_transform(root.get("transform")), root_style)

    with open(args.to_file, "r", encoding="utf-8") as stream:
        document = json.load(stream)

    parent, key, existing = resolve_json_path(document, args.json_path)
    if not isinstance(existing, list):
        raise SystemExit(
            "error: {} in {} is a {}, not an array of drawables -- refusing to overwrite it".format(
                args.json_path or "(root)", args.to_file, type(existing).__name__
            )
        )
    was = len(existing)
    if parent is None:
        document = converter.drawables
    else:
        parent[key] = converter.drawables

    with open(args.to_file, "w", encoding="utf-8") as stream:
        json.dump(document, stream, separators=(",", ":"))

    print(
        "wrote {}: {} at {} replaced by {} drawables from {} ({} coordinates)".format(
            args.to_file,
            was,
            args.json_path or "(root)",
            len(converter.drawables),
            args.from_file,
            converter.coords,
        ),
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, KeyError, IndexError, TypeError, OSError, ET.ParseError) as error:
        # A traceback tells the user about this script; a message tells them about their data.
        # OSError puts an errno in args[0], so only a string one is the message.
        detail = error.args[0] if error.args and isinstance(error.args[0], str) else error
        raise SystemExit("error: {}".format(detail)) from None
