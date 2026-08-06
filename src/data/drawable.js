// Parse and compile drawables.
//
// Input is either the v2 schema (documented in README.md) or the 2011 shape, which is detected and
// converted. Compiling does the work that would otherwise be repeated every frame: the companion
// w = sqrt(1 + x^2 + y^2) for each point, the resolved style, and a Minkowski bounding cap for
// cheap culling.
//
// Point flags, preserved from the 2011 format rather than "modernised" into move/line commands: a
// point's flag string describes the edge LEAVING that point. "L" strokes it; absent means the edge
// still participates in the fill but is not stroked. "P" draws a marker at the point. The fill path
// always closes. A move/line model cannot express a closed fill with a disconnected stroke without
// duplicating geometry, which is why this is kept as-is.

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

function resolveStyle(spec, styleSheet) {
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
  return out;
}

// A single compiled drawable.
export class Drawable {
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
    this.visibleFrom = 0;
    this.visibleTo = 1;
  }
}

// Convert a 2011-shaped drawable into the v2 shape. Exported so callers with legacy data can
// convert explicitly; `compileDrawables` also detects and applies it automatically.
export function readLegacyDrawable(d) {
  if (d.type === "polygon") {
    const points = [];
    for (const p of d.d) {
      if (p.length > 2 && p[2]) points.push([p[0], p[1], p[2]]);
      else points.push([p[0], p[1]]);
    }
    const out = { type: "path", points: points, closed: true };
    if (d.fillStyle !== undefined) out.fill = d.fillStyle;
    if (d.strokeStyle !== undefined) out.stroke = d.strokeStyle;
    if (d.lineWidth !== undefined) out.lineWidth = d.lineWidth;
    if (d.lineCap !== undefined) out.lineCap = d.lineCap;
    if (d.lineJoin !== undefined) out.lineJoin = d.lineJoin;
    if (d.miterLimit !== undefined) out.miterLimit = d.miterLimit;
    if (d.class !== undefined) out.class = d.class;
    return out;
  }
  if (d.type === "text") {
    const out = {
      type: "text",
      text: d.d,
      at: [d.ax, d.ay],
      up: [d.upx, d.upy],
    };
    if (d.fillStyle !== undefined) out.fill = d.fillStyle;
    if (d.textAlign !== undefined) out.align = d.textAlign;
    if (d.textBaseline !== undefined) out.baseline = d.textBaseline;
    if (d.font !== undefined) out.font = d.font;
    if (d.class !== undefined) out.class = d.class;
    return out;
  }
  return null;
}

function isLegacy(d) {
  return d && (d.type === "polygon" || (d.type === "text" && d.ax !== undefined));
}

function compileOne(spec, styleSheet) {
  const src = isLegacy(spec) ? readLegacyDrawable(spec) : spec;
  if (!src) return null;

  if (src.type === "path" || src.type === "polygon") {
    const pts = src.points || src.d;
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
    if (src.visibleFrom !== undefined) out.visibleFrom = src.visibleFrom;
    if (src.visibleTo !== undefined) out.visibleTo = src.visibleTo;
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
    if (src.visibleFrom !== undefined) out.visibleFrom = src.visibleFrom;
    if (src.visibleTo !== undefined) out.visibleTo = src.visibleTo;
    return out;
  }

  if (src.type === "marker") {
    const out = new Drawable("marker");
    out.xs = new Float64Array([src.at[0]]);
    out.ys = new Float64Array([src.at[1]]);
    out.ws = new Float64Array([localCompanion(src.at[0], src.at[1])]);
    out.style = resolveStyle(src, styleSheet);
    if (src.radius !== undefined) out.style.markerRadius = src.radius;
    out.cap = Cap.enclosing(out.xs, out.ys, 0, 1);
    return out;
  }

  return null;
}

// Accepts an array of drawables, or a {version, drawables} document, in either schema.
export function compileDrawables(data, styleSheet) {
  let list;
  if (Array.isArray(data)) list = data;
  else if (data && Array.isArray(data.drawables)) list = data.drawables;
  else if (data == null) list = [];
  else throw new TypeError("expected an array of drawables or a { drawables: [...] } document");

  const out = [];
  for (let i = 0; i < list.length; i++) {
    // The 2011 renderer used `while (drawable = nextDrawable())`, so a falsy entry silently
    // truncated the whole stream. Skip and keep going instead.
    if (!list[i]) continue;
    const c = compileOne(list[i], styleSheet);
    if (c) out.push(c);
  }
  return out;
}
