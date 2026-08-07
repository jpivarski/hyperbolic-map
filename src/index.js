// hyperbolic-map-widget -- public surface.
//
// This file is a barrel: it only re-exports. dev/build.mjs uses the names imported here to decide
// what the browser bundle exposes on the global `HyperbolicMap` object, so anything intended to be
// public must be listed here.
//
// Imports must stay one-per-line and single-line (see dev/check-bundle.mjs): the builder strips
// import lines individually, so a multi-line import would leave fragments behind.

import { Isom, localCompanion, movePointToPoint } from "./core/isom.js";
import { localToDisk, diskToLocal, localRadiusToDistance, distanceToLocalRadius, localDistance, halfPlaneToLocal, localToHalfPlane } from "./core/coords.js";
import { Cap, coshHalfDistance, coshHalfDistanceSquared, screenRadiusToThresholdSquared, capMayBeVisible, capThreshold } from "./core/minkowski.js";
import { ViewState, ROTATION_PARALLEL_TRANSPORT, ROTATION_COMPASS } from "./core/view.js";
import { HyperbolicViewport, DEFAULT_OPTIONS } from "./viewport.js";
import { compileDrawables, readLegacyDrawable, DEFAULT_STYLE } from "./data/drawable.js";
import { StaticSource, CallbackSource } from "./data/source.js";
import { Renderer, CULL_CAP, CULL_ENDPOINTS } from "./render/renderer.js";
import { Surface } from "./render/surface.js";
import { PointerInput, clampToRadius } from "./input/pointer.js";
import { geodesicArc, Arc } from "./render/geodesic.js";
import { Atlas, CLIP_AUTO, CLIP_ALWAYS, CLIP_NEVER } from "./data/atlas/atlas.js";
import { Anchor } from "./data/atlas/anchor.js";
import { RegularTiling, BinaryTiling, regularMetrics, binaryCellCentreLocal, BINARY_LOCAL_HALF_WIDTH, BINARY_LOCAL_Y_LOW, BINARY_LOCAL_Y_HIGH, BIN_RIGHT, BIN_LEFT, BIN_CHILD0, BIN_CHILD1, BIN_PARENT_EVEN, BIN_PARENT_ODD } from "./data/atlas/tiling.js";

export {
  Atlas,
  Anchor,
  CLIP_AUTO,
  CLIP_ALWAYS,
  CLIP_NEVER,
  RegularTiling,
  BinaryTiling,
  regularMetrics,
  binaryCellCentreLocal,
  BINARY_LOCAL_HALF_WIDTH,
  BINARY_LOCAL_Y_LOW,
  BINARY_LOCAL_Y_HIGH,
  BIN_RIGHT,
  BIN_LEFT,
  BIN_CHILD0,
  BIN_CHILD1,
  BIN_PARENT_EVEN,
  BIN_PARENT_ODD,
  HyperbolicViewport,
  DEFAULT_OPTIONS,
  compileDrawables,
  readLegacyDrawable,
  DEFAULT_STYLE,
  StaticSource,
  CallbackSource,
  Renderer,
  CULL_CAP,
  CULL_ENDPOINTS,
  Surface,
  PointerInput,
  clampToRadius,
  geodesicArc,
  Arc,
  ViewState,
  ROTATION_PARALLEL_TRANSPORT,
  ROTATION_COMPASS,
  Isom,
  localCompanion,
  movePointToPoint,
  localToDisk,
  diskToLocal,
  localRadiusToDistance,
  distanceToLocalRadius,
  localDistance,
  halfPlaneToLocal,
  localToHalfPlane,
  Cap,
  coshHalfDistance,
  coshHalfDistanceSquared,
  screenRadiusToThresholdSquared,
  capMayBeVisible,
  capThreshold,
};
