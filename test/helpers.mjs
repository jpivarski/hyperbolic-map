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
