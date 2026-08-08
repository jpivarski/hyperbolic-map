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
// Keep them naive. Do not "optimize" them to look like src/.

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

// Walk a tiling's addresses n steps and GUARANTEE the walk traveled, by measuring the geometry.
//
// COUNTING STEPS IS NOT MEASURING DISTANCE, and the two traps below are why every test that wants to be
// "far out" has to come through here.
//
// The first: `extendAddress(a, i % generatorCount())` looks like a walk and is not. For {8,3} with
// frameSymmetry 4 the generators pair up as inverses (0<->1, 2<->3, ...), so cycling the index steps
// out and immediately back -- thousands of steps, no distance at all.
//
// The second is subtler and defeats a plain no-backtracking rule, because a {p,q} generator can have
// FINITE ORDER. {8,3} m=4's generator 0 is a 2*pi/3 rotation about an octagon vertex: g^3 = -I. It is a
// perfectly good edge-neighbor step -- three octagons meet at each vertex and pairwise share edges --
// but five of them name a tile 1.53 units away and five thousand are still 1.53 units away. A walk can
// go in circles forever while its step count grows.
//
// So this walk is greedy-outward: at each step it takes the neighbor that most increases the distance
// traveled, and it verifies that the distance strictly grew. Ties broken by the seeded PRNG so
// different seeds give different rays.
export function advanceAddress(tiling, n, seed = 12345) {
  return advanceAddressWithDistance(tiling, n, seed).address;
}

// The same walk, also returning the hyperbolic distance actually traveled.
export function advanceAddressWithDistance(tiling, n, seed = 12345) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  let address = tiling.originAddress();
  // Each step as {from, gen}, so a caller can retrace it. The `from` matters: with canonical addresses
  // the index that walks back out of the child is `tiling.reverseGenerator(from, gen)`, which needs to
  // know which edge was taken from where.
  const path = [];
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
    const nbrs = tiling.neighbors(address);
    let best = null;
    const offset = Math.floor(rand() * nbrs.length);
    for (let k = 0; k < nbrs.length; k++) {
      const cand = nbrs[(k + offset) % nbrs.length];
      // stepFrame, not generator: a walk step carries the C_m correction that lands in the child's
      // canonical frame, so accumulating the bare generator would build a frame belonging to no address
      // at all.
      const g = tiling.stepFrame(address, cand.gen);
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
    path.push({ from: address, gen: best.cand.gen });
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
  return { address, distance, path };
}

// log|x| for a ring element, evaluated safely at ANY size.
//
// The coefficients are BigInts that grow about 1.44 bits per unit of hyperbolic distance, so a tile
// 500 steps out has coefficients of a few thousand bits and `Number(c)` is simply Infinity. Shifting
// every coefficient down by the same amount and adding the shift back in logs keeps ~900 bits of the
// leading part -- around 850 bits more than a double needs -- so the only way this could lose the
// answer is cancellation nearly that deep, which cosh(d) >= 1 rules out.
function logAbsExact(R, a) {
  let widest = 0;
  for (const c of a) {
    const mag = c < 0n ? -c : c;
    if (mag !== 0n) {
      const bits = mag.toString(2).length;
      if (bits > widest) widest = bits;
    }
  }
  const shift = widest > 900 ? BigInt(widest - 900) : 0n;
  let s = 0;
  for (let i = R.deg - 1; i >= 0; i--) s = s * R.muFloat + Number(a[i] >> shift);
  return Math.log(Math.abs(s)) + Number(shift) * Math.LN2;
}

// The hyperbolic distance an address sits at, measured from the address itself.
//
// Regular tilings: straight from the defining formula in the hyperboloid model,
//
//     cosh d(O, F.O) = -B(O_hat, F O_hat) = B(v_O, F v_O) / B(v_O, v_O)
//
// with v_O the tile-center vector and B the Coxeter form. Deliberately NOT the route
// `globalFrameForTesting` takes (intertwiner -> SU(1,1) -> distanceMoved), so the two remain
// independent witnesses; the cross-check test below compares them where both are valid. The doubled
// Gram matrix the library stores is 2B, and the factor of two cancels in the ratio.
//
// Binary tiling: `lat` is exact and each latitude step is a translation of log 2, giving a lower bound
// that is all an anti-vacuity assertion needs.
export function addressDistance(tiling, address) {
  if (typeof address.lat === "bigint") {
    const lat = address.lat < 0n ? -address.lat : address.lat;
    return Number(lat) * Math.LN2;
  }
  const { R, G, vO } = tiling.exact;
  const F = address.F;
  const image = [0, 1, 2].map((i) =>
    R.add(R.add(R.mul(F[i][0], vO[0]), R.mul(F[i][1], vO[1])), R.mul(F[i][2], vO[2])));
  const form = (u, v) => {
    let s = R.zero();
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) s = R.add(s, R.mul(R.mul(G[i][j], u[i]), v[j]));
    }
    return s;
  };
  // log cosh d, so the answer survives distances where cosh d itself overflows.
  const logCosh = logAbsExact(R, form(vO, image)) - logAbsExact(R, form(vO, vO));
  // For large d, cosh d = e^d / 2 to far better than a double can tell.
  return logCosh > 20 ? logCosh + Math.LN2 : Math.acosh(Math.max(1, Math.exp(logCosh)));
}
