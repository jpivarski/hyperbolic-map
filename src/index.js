// hyperbolic-map-widget -- public surface.
//
// This file is a barrel: it only re-exports. tools/build.mjs uses the names imported here to decide
// what the browser bundle exposes on the global `HyperbolicMap` object, so anything intended to be
// public must be listed here.
//
// Imports must stay one-per-line and single-line (see tools/check-bundle.mjs): the builder strips
// import lines individually, so a multi-line import would leave fragments behind.

import { Isom, localCompanion, movePointToPoint } from "./core/isom.js";
import { localToDisk, diskToLocal, localRadiusToDistance, distanceToLocalRadius, localDistance, halfPlaneToLocal, localToHalfPlane } from "./core/coords.js";
import { Cap, coshHalfDistance, coshHalfDistanceSquared, screenRadiusToThresholdSquared, capMayBeVisible, capThreshold } from "./core/minkowski.js";

export {
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
