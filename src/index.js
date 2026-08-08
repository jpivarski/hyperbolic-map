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
import { compileDrawables, DEFAULT_STYLE } from "./data/drawable.js";
import { StaticSource, CallbackSource } from "./data/source.js";
import { Renderer } from "./render/renderer.js";
import { Surface } from "./render/surface.js";
import { PointerInput, clampToRadius } from "./input/pointer.js";
import { geodesicArc, Arc } from "./render/geodesic.js";
import { Atlas, CLIP_AUTO, CLIP_ALWAYS, CLIP_NEVER } from "./data/atlas/atlas.js";
import { Anchor } from "./data/atlas/anchor.js";
import { RegularTiling, BinaryTiling, binaryDrawOrder, regularMetrics, BINARY_LOCAL_HALF_WIDTH, BINARY_LOCAL_Y_LOW, BINARY_LOCAL_Y_HIGH, BIN_RIGHT, BIN_LEFT, BIN_CHILD0, BIN_CHILD1, BIN_PARENT_EVEN, BIN_PARENT_ODD } from "./data/atlas/tiling.js";
// The exact machinery behind canonical tile ids. Not needed to USE a tiling -- an id is just the string
// `addressToString` hands you -- but exported so that the claim can be checked from outside: build the
// Coxeter group for any {p,q} and see that the relations hold, or watch `exactMulCount` stay flat across
// a rendered frame, which is the assertion that no exact arithmetic happens per frame.
import { ExactRing, minPolyFor2Cos, exactMulCount, resetExactMulCount } from "./data/atlas/exactring.js";
import { buildExactCoxeter, serializeExactVector } from "./data/atlas/exactcoxeter.js";

export {
  ExactRing,
  minPolyFor2Cos,
  exactMulCount,
  resetExactMulCount,
  buildExactCoxeter,
  serializeExactVector,
  Atlas,
  Anchor,
  CLIP_AUTO,
  CLIP_ALWAYS,
  CLIP_NEVER,
  RegularTiling,
  BinaryTiling,
  binaryDrawOrder,
  regularMetrics,
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
  DEFAULT_STYLE,
  StaticSource,
  CallbackSource,
  Renderer,
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
