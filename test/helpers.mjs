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

// Walk a tiling's addresses n steps WITHOUT backtracking, and refuse to return an address that did not
// actually move.
//
// The naive `extendAddress(a, i % generatorCount())` looks like a walk and is not. Free reduction cancels
// a generator against its inverse, and for {8,3} with frameSymmetry 4 the generators pair up as inverses
// (0<->1, 2<->3, ...), so cycling the index alternately extends and cancels: 5,000 steps left the address
// at length ZERO. Several tests used that pattern and were quietly asserting things about the origin
// while claiming to be 5,000 tiles away. The `moved` assertion here is what makes that impossible to
// repeat.
export function advanceAddress(tiling, n, seed = 12345) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  let address = tiling.originAddress();
  let lastGen = -1;
  for (let i = 0; i < n; i++) {
    const nbrs = tiling.neighbours(address);
    // Never step straight back along the generator we just used.
    let pick = Math.floor(rand() * nbrs.length);
    if (lastGen >= 0 && tiling.inverseGenerator(nbrs[pick].gen) === lastGen) {
      pick = (pick + 1) % nbrs.length;
    }
    lastGen = nbrs[pick].gen;
    address = nbrs[pick].address;
  }
  return address;
}

// How far an address is from the origin, in whatever unit the tiling counts in. Used to assert a walk
// really travelled, so a test cannot silently degenerate to "at the origin".
export function addressDistance(tiling, address) {
  if (typeof address.len === "number") return address.len;
  // BinaryTiling: latitude plus the bit-length of the longitude is a fair proxy for depth.
  const lat = address.lat < 0n ? -address.lat : address.lat;
  const lon = address.lon < 0n ? -address.lon : address.lon;
  return Number(lat) + lon.toString(2).length;
}
