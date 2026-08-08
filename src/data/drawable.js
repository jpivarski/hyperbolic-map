// Parse and compile drawables.
//
// Compiling does the work that would otherwise be repeated every frame: the companion
// w = sqrt(1 + x^2 + y^2) for each point, the resolved style, and a Minkowski bounding cap for
// cheap culling.
//
// Point flags rather than move/line commands: a point's flag string describes the edge LEAVING that
// point. "L" strokes it; absent means the edge still participates in the fill but is not stroked.
// "P" draws a marker at the point. The fill path always closes. A move/line model cannot express a
// closed fill with a disconnected stroke without duplicating geometry, which is why this is the
// format.

import { localCompanion } from "../core/isom.js";
import { Cap } from "../core/minkowski.js";

export const FLAG_STROKE = 1;
export const FLAG_MARKER = 2;

export const DEFAULT_STYLE = {
  fill: "none",
  stroke: "#000000",
  lineWidth: 1.0,
  lineCap: "butt",
  lineJoin: "miter",
  miterLimit: 4.0,
  markerRadius: 3.5,
  markerFill: "#000000",
  align: "center",
  baseline: "alphabetic",
  font: "sans-serif",
};

// Resolved styles are INTERNED: identical styles share one frozen object.
//
// They were not, and the cost was quietly large. The Escher scene has about half a dozen distinct
// appearances but was compiling 38,640 separate style objects, one per drawable -- measured, the
// count of distinct style objects exactly equalled the count of drawables in all three datasets.
// That is pure memory bloat, it defeats identity comparison in the renderer's canvas-state cache,
// and it makes it impossible to spot runs of same-styled shapes.
//
// The table is module-scope so that the atlas, which compiles each tile separately, shares one set
// across every tile. It is capped: a pathological generator emitting a unique color per shape would
// otherwise grow it without bound, and falling back to unshared objects is merely the old behavior.
const styleTable = new Map();
const STYLE_TABLE_LIMIT = 4096;

const STYLE_KEYS = [
  "fill", "stroke", "lineWidth", "lineCap", "lineJoin", "miterLimit",
  "markerRadius", "markerFill", "align", "baseline", "font",
];

function internStyle(out) {
  let key = "";
  for (let i = 0; i < STYLE_KEYS.length; i++) key += out[STYLE_KEYS[i]] + "\u0001";
  const hit = styleTable.get(key);
  if (hit) return hit;
  // Frozen so that a later mutation cannot silently restyle every drawable that shares it. Anything
  // that varies per drawable (a marker's radius) has to be folded in BEFORE interning, not written
  // onto the resolved style afterwards.
  const frozen = Object.freeze(out);
  if (styleTable.size < STYLE_TABLE_LIMIT) styleTable.set(key, frozen);
  return frozen;
}

function resolveStyle(spec, styleSheet, extra) {
  const base = spec.class && styleSheet && styleSheet[spec.class] ? styleSheet[spec.class] : (styleSheet && styleSheet.default) || DEFAULT_STYLE;
  const out = Object.assign({}, DEFAULT_STYLE, base);
  if (spec.fill !== undefined) out.fill = spec.fill;
  if (spec.stroke !== undefined) out.stroke = spec.stroke;
  if (spec.lineWidth !== undefined) out.lineWidth = spec.lineWidth;
  if (spec.lineCap !== undefined) out.lineCap = spec.lineCap;
  if (spec.lineJoin !== undefined) out.lineJoin = spec.lineJoin;
  if (spec.miterLimit !== undefined) out.miterLimit = spec.miterLimit;
  if (spec.markerRadius !== undefined) out.markerRadius = spec.markerRadius;
  if (spec.markerFill !== undefined) out.markerFill = spec.markerFill;
  if (spec.align !== undefined) out.align = spec.align;
  if (spec.baseline !== undefined) out.baseline = spec.baseline;
  if (spec.font !== undefined) out.font = spec.font;
  if (extra !== undefined) Object.assign(out, extra);
  return internStyle(out);
}

// A single compiled drawable.
class Drawable {
  constructor(kind) {
    this.kind = kind; // "path" | "text" | "marker"
    this.xs = null;
    this.ys = null;
    this.ws = null;
    this.flags = null;
    this.closed = true;
    this.text = null;
    this.style = DEFAULT_STYLE;
    this.cap = null;
  }
}

function compileOne(src, styleSheet) {
  if (!src) return null;

  if (src.type === "path") {
    const pts = src.points;
    const n = pts.length;
    if (n === 0) return null;
    const out = new Drawable("path");
    out.xs = new Float64Array(n);
    out.ys = new Float64Array(n);
    out.ws = new Float64Array(n);
    out.flags = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      out.xs[i] = p[0];
      out.ys[i] = p[1];
      out.ws[i] = localCompanion(p[0], p[1]);
      const f = p.length > 2 && typeof p[2] === "string" ? p[2].toLowerCase() : "";
      let bits = 0;
      if (f.indexOf("l") !== -1) bits |= FLAG_STROKE;
      if (f.indexOf("p") !== -1) bits |= FLAG_MARKER;
      out.flags[i] = bits;
    }
    out.closed = src.closed !== false;
    out.style = resolveStyle(src, styleSheet);
    out.cap = Cap.enclosing(out.xs, out.ys, 0, n);
    return out;
  }

  if (src.type === "text") {
    const out = new Drawable("text");
    const at = src.at;
    const up = src.up;
    out.xs = new Float64Array([at[0], up[0]]);
    out.ys = new Float64Array([at[1], up[1]]);
    out.ws = new Float64Array([localCompanion(at[0], at[1]), localCompanion(up[0], up[1])]);
    out.text = String(src.text);
    out.style = resolveStyle(src, styleSheet);
    out.cap = Cap.enclosing(out.xs, out.ys, 0, 2);
    return out;
  }

  if (src.type === "marker") {
    const out = new Drawable("marker");
    out.xs = new Float64Array([src.at[0]]);
    out.ys = new Float64Array([src.at[1]]);
    out.ws = new Float64Array([localCompanion(src.at[0], src.at[1])]);
    // Fold the radius in BEFORE interning: styles are shared and frozen, so mutating one here would
    // change the radius of every marker that happens to look the same.
    out.style = resolveStyle(src, styleSheet, src.radius !== undefined ? { markerRadius: src.radius } : undefined);
    out.cap = Cap.enclosing(out.xs, out.ys, 0, 1);
    return out;
  }

  return null;
}

// Accepts an array of drawables, or a {version, coordinates, drawables} document.
export function compileDrawables(data, styleSheet) {
  let list;
  if (Array.isArray(data)) list = data;
  else if (data && Array.isArray(data.drawables)) list = data.drawables;
  else if (data == null) list = [];
  else throw new TypeError("expected an array of drawables or a { drawables: [...] } document");

  const out = [];
  for (let i = 0; i < list.length; i++) {
    // A falsy entry skips rather than truncating: a generator that returns a hole in its output
    // should lose one shape, not everything after it.
    if (!list[i]) continue;
    const c = compileOne(list[i], styleSheet);
    if (c) out.push(c);
  }
  return out;
}
