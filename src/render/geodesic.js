// Geodesic edges in the Poincare disk.
//
// A geodesic through two interior points is an arc of the unique circle through them that is
// orthogonal to the unit circle. Writing that circle as
//
//     x^2 + y^2 + a x + b y + c = 0
//
// orthogonality to the unit circle holds exactly when c = 1 (and then it is a real circle whenever
// a^2 + b^2 > 4, which is automatic for two distinct interior points not collinear with the origin).
// Solving for a and b through the two points gives the closed form below.
//
// Special case: when the two points are collinear with the origin, the determinant x1*y2 - x2*y1
// vanishing is exactly that condition, and the geodesic really is a straight diameter. So the
// "degenerate" branch is not an approximation -- it is the correct answer there.
//
// Sweep direction: the whole in-disk portion of a geodesic subtends 2*atan(1/r) < pi at the arc's
// centre, so any sub-segment is the MINOR arc. Normalising the angle difference into (-pi, pi] and
// sweeping that way is therefore always right.

// Result object, reused by the caller to avoid allocating per edge.
export class Arc {
  constructor() {
    this.straight = true;
    this.cx = 0;
    this.cy = 0;
    this.r = 0;
    this.startAngle = 0;
    this.endAngle = 0;
    this.anticlockwise = false;
  }
}

const DEGENERATE = 1e-10;

// Compute the geodesic from (x1, y1) to (x2, y2), both in disk coordinates, into `out`.
//
// `straightIfShorterThan` is a chord-length threshold in DISK units below which the edge is drawn as
// a straight line. Pass 0 to always use an arc. The 2011 code used a fixed 0.1, which is
// zoom-independent and therefore visibly wrong when zoomed in; `sagittaTolerance` (in the same disk
// units) replaces it with a curvature-aware test. Pass sagittaTolerance = 0 to disable it.
export function geodesicArc(x1, y1, x2, y2, out, straightIfShorterThan, sagittaTolerance) {
  const denom = x1 * y2 - x2 * y1;
  const dist2 = (x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2);

  if (Math.abs(denom) <= DEGENERATE) {
    // Collinear with the origin: the geodesic is a diameter.
    out.straight = true;
    return out;
  }
  if (straightIfShorterThan > 0 && dist2 <= straightIfShorterThan * straightIfShorterThan) {
    out.straight = true;
    return out;
  }

  const a = (-x1 * x1 * y2 + x2 * x2 * y1 - y1 * y1 * y2 + y1 * y2 * y2 + y1 - y2) / denom;
  const b = (x1 * x1 * x2 - x1 * x2 * x2 - x1 * y2 * y2 - x1 + x2 * y1 * y1 + x2) / denom;
  const cx = -0.5 * a;
  const cy = -0.5 * b;
  const r2 = 0.25 * (a * a + b * b) - 1;
  if (!(r2 > 0)) {
    out.straight = true;
    return out;
  }
  const r = Math.sqrt(r2);

  if (sagittaTolerance > 0) {
    // Sagitta of the arc: how far the arc departs from its chord. If that is below the tolerance
    // the chord is indistinguishable from the arc, so draw a line and save the work.
    const halfChord2 = 0.25 * dist2;
    if (halfChord2 < r2) {
      const sagitta = r - Math.sqrt(r2 - halfChord2);
      if (sagitta <= sagittaTolerance) {
        out.straight = true;
        return out;
      }
    }
  }

  // Angles here are in the y-up mathematical frame. The caller flips y for canvas, which negates
  // them, and that flip also reverses the sweep sense -- so get this right or every arc goes the
  // long way round, outside the disk.
  //
  //   canvas angle       = -theta
  //   signed short sweep = d = wrap(theta2 - theta1) in (-pi, pi]
  //   d > 0 means increasing theta (counter-clockwise in the maths frame), which is DECREASING
  //   canvas angle, which is what canvas calls anticlockwise = true.
  //
  // With delta = theta1 - theta2 = -d, that is `anticlockwise = delta < 0`.
  const phi1 = Math.atan2(y1 - cy, x1 - cx);
  const phi2 = Math.atan2(y2 - cy, x2 - cx);
  let delta = phi1 - phi2;
  while (delta >= Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;

  out.straight = false;
  out.cx = cx;
  out.cy = cy;
  out.r = r;
  out.startAngle = phi1;
  out.endAngle = phi2;
  out.anticlockwise = delta < 0;
  return out;
}
