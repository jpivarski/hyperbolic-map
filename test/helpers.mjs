// Shared test helpers.

// Wrap an angle into (-pi, pi].
//
// Written once, here, because getting it wrong bit me three separate times in this project. The trap
// is that JavaScript's % keeps the sign of the DIVIDEND, so the tempting one-liner
//
//     ((x + Math.PI) % (2 * Math.PI)) - Math.PI
//
// is correct only for x > -pi. For x = -3*pi/2 it returns -3*pi/2, not +pi/2, which makes a correct
// bearing look 360 degrees wrong.
export function wrapAngle(x) {
  let y = x % (2 * Math.PI);
  if (y > Math.PI) y -= 2 * Math.PI;
  if (y <= -Math.PI) y += 2 * Math.PI;
  return y;
}

// Deterministic PRNG, so a failure can be reproduced exactly.
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function uni(r, lo, hi) {
  return lo + (hi - lo) * r();
}

// ---- independent oracles ----
//
// Second implementations of quantities the library also computes, written straight from the defining
// formula rather than from the library's code. Their whole value is that they were derived
// separately: a test that compares the library against a rearrangement of itself proves nothing.
// Keep them naive. Do not "optimise" them to look like src/.

// Hyperbolic distance in the Poincare disk. Cross-validated during the audit against the hyperboloid
// inner product and the half-plane formula (agreement 8.2e-13).
export function diskDistance(z1x, z1y, z2x, z2y) {
  const dx = z1x - z2x;
  const dy = z1y - z2y;
  // 1 - conj(z2) z1
  const cr = 1 - (z2x * z1x + z2y * z1y);
  const ci = -(z2x * z1y - z2y * z1x);
  const t = Math.hypot(dx, dy) / Math.hypot(cr, ci);
  return 2 * Math.atanh(Math.min(t, 1 - 1e-16));
}

// The half-plane -> disk map this project uses, stated directly: z -> i (z - i) / (z + i).
export function halfPlaneToDiskDirect(hx, hy) {
  // (z - i) / (z + i)
  const nr = hx;
  const ni = hy - 1;
  const dr = hx;
  const di = hy + 1;
  const dd = dr * dr + di * di;
  const qr = (nr * dr + ni * di) / dd;
  const qi = (ni * dr - nr * di) / dd;
  // times i
  return [-qi, qr];
}

export function diskToHalfPlaneDirect(zx, zy) {
  // w = (1 - i z) / (z - i)
  const nr = 1 + zy;
  const ni = -zx;
  const dr = zx;
  const di = zy - 1;
  const dd = dr * dr + di * di;
  return [(nr * dr + ni * di) / dd, (ni * dr - nr * di) / dd];
}

// Walk a tiling's addresses n steps and GUARANTEE the walk travelled, by measuring the geometry rather
// than by counting symbols.
//
// Two traps here, both of which produced silently vacuous tests in this project.
//
// The first: `extendAddress(a, i % generatorCount())` looks like a walk and is not. Free reduction
// cancels a generator against its inverse, and for {8,3} with frameSymmetry 4 the generators pair up as
// inverses (0<->1, 2<->3, ...), so cycling the index alternately extends and cancels -- 5,000 steps left
// the address at length ZERO.
//
// The second is subtler and defeated the first fix. Refusing to backtrack does NOT make a walk travel,
// because a {p,q} generator can have FINITE ORDER. Measured, {8,3} m=4's generator 0 is a 2*pi/3 rotation
// about an octagon vertex: g^3 = -I, g^6 = +I. It is a perfectly good edge-neighbour step -- three
// octagons meet at each vertex and pairwise share edges -- but the word "0.0.0.0.0" has five symbols and
// names a tile 1.53 units away, and g0^5000 is still 1.53 units away. So WORD LENGTH IS NOT DISTANCE,
// and an assertion on `address.len` cannot detect a walk that is going in circles. That is what the old
// `addressDistance` did.
//
// So this walk is greedy-outward: at each step it takes the neighbour that most increases the distance
// travelled, and it verifies that the distance strictly grew. Ties broken by the seeded PRNG so
// different seeds give different rays.
export function advanceAddress(tiling, n, seed = 12345) {
  return advanceAddressWithDistance(tiling, n, seed).address;
}

// The same walk, also returning the hyperbolic distance actually travelled.
export function advanceAddressWithDistance(tiling, n, seed = 12345) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  let address = tiling.originAddress();
  // The accumulated frame, held in LOG-SCALED form so it never overflows: entries are kept at unit
  // magnitude and the discarded scale accumulates in `logScale`. Only a test may form this at all -- it
  // is precisely the global quantity the renderer must never build.
  let ar = 1;
  let ai = 0;
  let br = 0;
  let bi = 0;
  let logScale = 0;
  // log|a| of the accumulated frame; distance = 2 * acosh(|a|), monotone in log|a|.
  const logAbsA = () => Math.log(Math.hypot(ar, ai)) + logScale;
  let progress = logAbsA();

  for (let i = 0; i < n; i++) {
    const nbrs = tiling.neighbours(address);
    let best = null;
    const offset = Math.floor(rand() * nbrs.length);
    for (let k = 0; k < nbrs.length; k++) {
      const cand = nbrs[(k + offset) % nbrs.length];
      const g = tiling.generator(cand.gen);
      // (ar,ai,br,bi) * g, in SU(1,1): [[a,b],[conj b, conj a]].
      const nar = ar * g.ar - ai * g.ai + br * g.br + bi * g.bi;
      const nai = ar * g.ai + ai * g.ar - br * g.bi + bi * g.br;
      const nbr = ar * g.br - ai * g.bi + br * g.ar + bi * g.ai;
      const nbi = ar * g.bi + ai * g.br - br * g.ai + bi * g.ar;
      const score = Math.log(Math.hypot(nar, nai)) + logScale;
      if (best === null || score > best.score) best = { cand, nar, nai, nbr, nbi, score };
    }
    ar = best.nar;
    ai = best.nai;
    br = best.nbr;
    bi = best.nbi;
    address = best.cand.address;
    const m = Math.max(Math.abs(ar), Math.abs(ai), Math.abs(br), Math.abs(bi));
    if (m > 1e120) {
      ar /= m;
      ai /= m;
      br /= m;
      bi /= m;
      logScale += Math.log(m);
    }
    const now = logAbsA();
    if (!(now > progress)) {
      throw new Error(
        `advanceAddress: step ${i + 1} of ${n} did not travel (log|a| ${progress} -> ${now}). ` +
          "A walk that cannot make outward progress would make the caller's test vacuous.",
      );
    }
    progress = now;
  }
  // d = 2 acosh(|a|); for |a| >> 1 that is 2(log|a| + log 2), which is what avoids the overflow.
  const la = logAbsA();
  const distance = la > 20 ? 2 * (la + Math.LN2) : 2 * Math.acosh(Math.max(1, Math.exp(la)));
  return { address, distance };
}

// The hyperbolic distance an address sits at, measured from its own symbols -- NOT from their count.
//
// Regular tilings: compose the word's generators, log-scaled so any depth is representable.
// Binary tiling: `lat` is exact and each latitude step is a translation of log 2, giving a lower bound
// that is all an anti-vacuity assertion needs.
export function addressDistance(tiling, address) {
  if (typeof address.lat === "bigint") {
    const lat = address.lat < 0n ? -address.lat : address.lat;
    return Number(lat) * Math.LN2;
  }
  const gens = [];
  for (let a = address; a && a.len > 0; a = a.prev) gens.push(a.gen);
  gens.reverse();
  let ar = 1;
  let ai = 0;
  let br = 0;
  let bi = 0;
  let logScale = 0;
  for (const gi of gens) {
    const g = tiling.generator(gi);
    const nar = ar * g.ar - ai * g.ai + br * g.br + bi * g.bi;
    const nai = ar * g.ai + ai * g.ar - br * g.bi + bi * g.br;
    const nbr = ar * g.br - ai * g.bi + br * g.ar + bi * g.ai;
    const nbi = ar * g.bi + ai * g.br - br * g.ai + bi * g.ar;
    ar = nar;
    ai = nai;
    br = nbr;
    bi = nbi;
    const m = Math.max(Math.abs(ar), Math.abs(ai), Math.abs(br), Math.abs(bi));
    if (m > 1e120) {
      ar /= m;
      ai /= m;
      br /= m;
      bi /= m;
      logScale += Math.log(m);
    }
  }
  const la = Math.log(Math.hypot(ar, ai)) + logScale;
  return la > 20 ? 2 * (la + Math.LN2) : 2 * Math.acosh(Math.max(1, Math.exp(la)));
}
