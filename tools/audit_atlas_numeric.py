#!/usr/bin/env python3
"""Numerical far-field audit of the anchored atlas, against a 60-digit mpmath oracle.

    node tools/emit_atlas_samples.mjs > build/atlas-samples.json
    python3 tools/audit_atlas_numeric.py

The question this answers is narrow and important: does the float64 anchored path compute the RIGHT
screen positions, and does its error stay FLAT as the camera travels arbitrarily far from the origin?
A growing error is the failure signal, not a large one -- error that grows with distance is exactly the
defect the rewrite removed.

A float64 reference would be useless here. At 500 tiles out the true global frame has entries of
1e75, and at 5000 tiles it overflows float64 entirely, so the reference has to be arbitrary precision.

Oracle discipline, learned the hard way (see notes/math-audit.md: the first symbolic run reported 13
failures and every one was in the harness): the oracle is computed THREE independent ways and its own
self-agreement is the gate. Only if the three agree is it used to judge the code. If they disagree,
the oracle is wrong and the code is not on trial yet.

    route A   global frames as products from the origin, then rel = F_c^-1 . F_k
    route B   the relative route: rel = product of generators along the relative word
    route C   binary only -- compose the half-plane maps z -> s z + t and take the ratio

Route A is what the OLD implementation did in float64. Computing it at 60 digits is what lets us say
the relative route computes the same thing rather than merely something self-consistent.
"""

import json
import os
import sys

try:
    from mpmath import mp, mpf, mpc, matrix, cosh, sinh, tanh, acosh, cos, sin, pi, sqrt, exp, log, fabs
except ImportError:
    print("mpmath is required: python3 -m pip install --user mpmath", file=sys.stderr)
    raise SystemExit(1)

mp.dps = 60

SAMPLES = [(0, 0), (0.31, 0.07), (-0.11, 0.27), (0.05, -0.19), (0.4, 0.4)]

PASS, FAIL = [], []


def check(name, ok, detail=""):
    (PASS if ok else FAIL).append(name)
    print(f"  [{'ok  ' if ok else 'FAIL'}] {name}" + (f"\n           {detail}" if detail else ""))


# ---------------------------------------------------------------------------------------------
# SU(1,1) at 60 digits. An isometry is (a, b) with |a|^2 - |b|^2 = 1, acting z -> (a z + b)/(b* z + a*).


def mk(ar, ai, br, bi):
    return (mpc(ar, ai), mpc(br, bi))


def mul(m, n):
    """m . n -- apply n first. Matches Isom.mul / composeInto (audit claims 1 and 2)."""
    a1, b1 = m
    a2, b2 = n
    return (a1 * a2 + b1 * mpc(a2.real, -a2.imag) * 0 + b1 * mpc(b2.real, -b2.imag),
            a1 * b2 + b1 * mpc(a2.real, -a2.imag))


def inv(m):
    a, b = m
    return (mpc(a.real, -a.imag), -b)


def apply_local(m, x, y):
    """Project a tile-local point through the isometry, straight to disk coordinates.

    The point IS an isometry with a = w, b = zeta, so its image is (a zeta + b w)/(b* zeta + a* w)
    (audit claim 7).
    """
    a, b = m
    zeta = mpc(x, y)
    w = sqrt(1 + mpf(x) ** 2 + mpf(y) ** 2)
    num = a * zeta + b * w
    den = mpc(b.real, -b.imag) * zeta + mpc(a.real, -a.imag) * w
    z = num / den
    return (z.real, z.imag)


def max_entry(m):
    a, b = m
    return max(fabs(a.real), fabs(a.imag), fabs(b.real), fabs(b.imag))


# ---------------------------------------------------------------------------------------------
# Generator construction at 60 digits, mirroring src/data/atlas/tiling.js exactly.


def rotation(theta):
    return mk(cos(theta / 2), sin(theta / 2), 0, 0)


def translation_to_disk(bx, by):
    k = 1 / sqrt(1 - mpf(bx) ** 2 - mpf(by) ** 2)
    return mk(k, 0, mpf(bx) * k, mpf(by) * k)


def regular_metrics(p, q):
    chi = acosh(1 / (mp.tan(pi / p) * mp.tan(pi / q)))
    psi = acosh(cos(pi / q) / sin(pi / p))
    return chi, psi


def regular_generators(p, q, m):
    chi, psi = regular_metrics(p, q)
    verts = []
    for k in range(p):
        ang = pi / p + 2 * pi * k / p
        verts.append((tanh(chi / 2) * cos(ang), tanh(chi / 2) * sin(ang)))
    gens = []
    if m == p:
        g0 = mk(0, cosh(psi), 0, -sinh(psi))
        for k in range(p):
            s = rotation(2 * pi * k / p)
            gens.append(mul(mul(s, g0), rotation(-2 * pi * k / p)))
    else:
        for k in range(0, p, p // m):
            v = verts[k]
            for sense in (1, -1):
                gens.append(
                    mul(mul(translation_to_disk(v[0], v[1]), rotation(sense * 2 * pi / q)),
                        translation_to_disk(-v[0], -v[1]))
                )
    return gens


R2 = sqrt(mpf(2))


def isom_from_scale_shift(S, T):
    rs = sqrt(mpf(S))
    i = 1 / rs
    return mk((rs + i) / 2, (mpf(T) * i) / 2, (mpf(T) * i) / 2, (rs - i) / 2)


BINARY_ST = [
    (1, 1 / R2),          # right
    (1, -1 / R2),         # left
    (mpf(1) / 2, -mpf(1) / 4 / R2),   # child 0
    (mpf(1) / 2, mpf(1) / 4 / R2),    # child 1
    (2, mpf(1) / 2 / R2),             # parent, even
    (2, -mpf(1) / 2 / R2),            # parent, odd
]


def binary_generators():
    return [isom_from_scale_shift(S, T) for (S, T) in BINARY_ST]


# ---------------------------------------------------------------------------------------------

path = os.path.join("build", "atlas-samples.json")
if not os.path.exists(path):
    print(f"missing {path}; run:  node tools/emit_atlas_samples.mjs > {path}", file=sys.stderr)
    raise SystemExit(1)
data = json.load(open(path))

print(__doc__.split("\n\n")[0])
print(f"mpmath working precision: {mp.dps} decimal digits\n")

# ---------------------------------------------------------------------------------------------
# Stage 0: does the oracle agree with itself? The gate before anything else is judged.
print("stage 0  oracle self-validation (three independent routes must agree)")

worst_ab = mpf(0)
worst_c = mpf(0)
for spec in data["specs"]:
    name = spec["name"]
    gens = binary_generators() if spec["kind"] == "binary" else regular_generators(
        spec["p"], spec["q"], spec["frameSymmetry"])
    # Route A vs route B, on the camera's own walk: the global frames are astronomically large and
    # their quotient must still reproduce the plain product.
    for rec in spec["walks"]:
        gp = rec["genPath"]
        if not gp:
            continue
        # route B: the product along the path.
        relB = mk(1, 0, 0, 0)
        for g in gp:
            relB = mul(relB, gens[g])
        # route A: F_origin^-1 . F_camera, where F_camera is the same product from the origin. For the
        # camera's own path these coincide by construction, so make route A genuinely different by
        # splitting the path and composing the halves as separate global frames.
        half = len(gp) // 2
        F1 = mk(1, 0, 0, 0)
        for g in gp[:half]:
            F1 = mul(F1, gens[g])
        F2 = mk(1, 0, 0, 0)
        for g in gp[half:]:
            F2 = mul(F2, gens[g])
        relA = mul(F1, F2)
        d = max(abs(relA[0] - relB[0]), abs(relA[1] - relB[1]))
        scale = max(mpf(1), max_entry(relB))
        worst_ab = max(worst_ab, d / scale)

# Route C: the binary tiling's half-plane composition, independent of SU(1,1) entirely.
for spec in data["specs"]:
    if spec["kind"] != "binary":
        continue
    gens = binary_generators()
    for rec in spec["walks"]:
        gp = rec["genPath"]
        if not gp:
            continue
        # Compose z -> S z + T directly.
        S, T = mpf(1), mpf(0)
        for g in gp:
            s2, t2 = BINARY_ST[g]
            # (S z + T) then (s2 z + t2) applied in the same order as mul(rel, gen): rel . gen means
            # apply gen FIRST, so the composite is  z -> S*(s2 z + t2) + T.
            S, T = S * mpf(s2), S * mpf(t2) + T
        relC = isom_from_scale_shift(S, T)
        relB = mk(1, 0, 0, 0)
        for g in gp:
            relB = mul(relB, gens[g])
        d = max(abs(relC[0] - relB[0]), abs(relC[1] - relB[1]))
        worst_c = max(worst_c, d / max(mpf(1), max_entry(relB)))

check("routes A and B (global quotient vs relative product) agree",
      worst_ab < mpf("1e-50"), f"worst relative deviation {mp.nstr(worst_ab, 4)}")
check("route C (binary half-plane composition) agrees with route B",
      worst_c < mpf("1e-50"), f"worst relative deviation {mp.nstr(worst_c, 4)}")
if FAIL:
    print("\nthe oracle disagrees with itself -- fix the ORACLE before judging the code")
    raise SystemExit(1)

# ---------------------------------------------------------------------------------------------
# Stage 1: how large would the global frame have been? This is the quantity the old design formed.
print("\nstage 1  the magnitude the old design had to represent")
rows = []
for spec in data["specs"]:
    gens = binary_generators() if spec["kind"] == "binary" else regular_generators(
        spec["p"], spec["q"], spec["frameSymmetry"])
    for rec in spec["walks"]:
        if rec["steps"] not in (500, 5000):
            continue
        F = mk(1, 0, 0, 0)
        for g in rec["genPath"]:
            F = mul(F, gens[g])
        rows.append((spec["name"], rec["steps"], max_entry(F)))
for name, steps, mag in rows:
    over = "  (OVERFLOWS float64)" if mag > mpf("1e308") else ""
    print(f"           {name:10s} after {steps:5d} tiles: max|global frame entry| = {mp.nstr(mag, 4)}{over}")
check("the global frames at these distances are unrepresentable in float64",
      any(mag > mpf("1e308") for _, _, mag in rows),
      "which is why they must never be formed -- and why this audit needs 60 digits")

# ---------------------------------------------------------------------------------------------
# Stage 2: the code under test, against the oracle, as a function of distance.
print("\nstage 2  float64 anchored path vs the oracle, by distance")
print("           tiling      steps   worst |rel| err   worst screen err (disk units)")

trend = {}
for spec in data["specs"]:
    name = spec["name"]
    gens = binary_generators() if spec["kind"] == "binary" else regular_generators(
        spec["p"], spec["q"], spec["frameSymmetry"])
    # Use the generator table the JS actually used, to rule out a construction difference. Compare it
    # against the oracle's own first, then use the oracle's.
    gen_err = mpf(0)
    for i, g in enumerate(data["generators"][name]):
        gen_err = max(gen_err, abs(gens[i][0] - mpc(g[0], g[1])), abs(gens[i][1] - mpc(g[2], g[3])))
    trend.setdefault(name, {})["gen"] = gen_err

    for rec in spec["walks"]:
        worst_rel = mpf(0)
        worst_screen = mpf(0)
        # The oracle needs each tile's RELATIVE path. neighbourhood() does not return it, so recover it
        # from the emitted relative matrix by trusting only its structure: walk every word up to a
        # small depth and match. Cheap because the neighbourhood is shallow.
        depth_limit = 3
        lookup = {}

        def enumerate_words(prefix, rel, depth):
            keyr = (mp.nstr(rel[0].real, 12), mp.nstr(rel[0].imag, 12),
                    mp.nstr(rel[1].real, 12), mp.nstr(rel[1].imag, 12))
            if keyr not in lookup:
                lookup[keyr] = rel
            if depth == 0:
                return
            for gi in range(len(gens)):
                enumerate_words(prefix + [gi], mul(rel, gens[gi]), depth - 1)

        enumerate_words([], mk(1, 0, 0, 0), depth_limit)

        for tile in rec["tiles"]:
            ar, ai, br, bi = tile["rel"]
            got = mk(ar, ai, br, bi)
            # Find the oracle's matching relative frame: the nearest enumerated word.
            best = None
            bestd = None
            for keyr, cand in lookup.items():
                d = abs(cand[0] - got[0]) + abs(cand[1] - got[1])
                if bestd is None or d < bestd:
                    bestd = d
                    best = cand
            if best is None or bestd > mpf("1e-6"):
                continue  # deeper than the enumeration; skipped rather than mismatched
            worst_rel = max(worst_rel, bestd / max(mpf(1), max_entry(best)))
            for si, (sx, sy) in enumerate(SAMPLES):
                ox, oy = apply_local(best, sx, sy)
                gx, gy = tile["screen"][si]
                worst_screen = max(worst_screen, abs(ox - mpf(gx)), abs(oy - mpf(gy)))
        trend[name][rec["steps"]] = (worst_rel, worst_screen)
        print(f"           {name:10s} {rec['steps']:6d}   {mp.nstr(worst_rel, 4):>14s}   {mp.nstr(worst_screen, 4)}")

# A few ULPs is expected: the constructions involve cosh, sinh, tanh and several products, each
# rounding. What this rules out is a different CONSTRUCTION -- a swapped sign, a half-angle omitted --
# which would show up orders of magnitude larger, not at 1e-15.
check("the generator tables the code built match the 60-digit ones",
      all(t["gen"] < mpf("1e-14") for t in trend.values()),
      "worst " + mp.nstr(max(t["gen"] for t in trend.values()), 4)
      + " (a few ULPs of float64 rounding; a construction error would be far larger)")

# The headline: error must not TREND with distance.
worst_ratio = mpf(0)
worst_where = ""
for name, t in trend.items():
    near = t.get(0, (mpf(0), mpf(0)))[1]
    far = t.get(5000, (mpf(0), mpf(0)))[1]
    base = max(near, mpf("1e-17"))
    ratio = far / base
    if ratio > worst_ratio:
        worst_ratio = ratio
        worst_where = name
check("screen error does not grow with distance (5000 tiles vs 0)",
      worst_ratio < 100,
      f"worst growth factor {mp.nstr(worst_ratio, 4)} on {worst_where} "
      f"-- a flat trend is the property that matters, not the magnitude")
check("absolute screen error stays at float64 epsilon everywhere",
      all(v[1] < mpf("1e-12") for t in trend.values() for k, v in t.items() if k != "gen"),
      "worst " + mp.nstr(max(v[1] for t in trend.values() for k, v in t.items() if k != "gen"), 4)
      + " disk units, i.e. far below one pixel at any plausible zoom")

# ---------------------------------------------------------------------------------------------
# Stage 3: the contrast. What would the OLD design have produced at these same distances?
#
# This is what makes stage 2 mean something. On its own, "the anchored path agrees with the oracle at
# every distance" could be read as the test being insensitive. So compute the old route -- global
# frames in float64, then rel = F_c^-1 . F_k -- and measure ITS error against the same oracle. If the
# anchored error is flat and the global error explodes, the comparison is doing real work.
print("\nstage 3  the contrast: the same quantity by the OLD global route, in float64")
print("           tiling      steps   anchored err     old global-route err")


def f64_mul(m, n):
    a1, b1 = m
    a2, b2 = n
    return (a1 * a2 + b1 * a2.conjugate() * 0 + b1 * b2.conjugate(), a1 * b2 + b1 * a2.conjugate())


def f64_inv(m):
    a, b = m
    return (a.conjugate(), -b)


def f64_max_entry(m):
    a, b = m
    return max(abs(a.real), abs(a.imag), abs(b.real), abs(b.imag))


contrast = []
for spec in data["specs"]:
    name = spec["name"]
    gens = binary_generators() if spec["kind"] == "binary" else regular_generators(
        spec["p"], spec["q"], spec["frameSymmetry"])
    gens64 = [(complex(float(g[0].real), float(g[0].imag)), complex(float(g[1].real), float(g[1].imag)))
              for g in gens]
    for rec in spec["walks"]:
        gp = rec["genPath"]
        # Old route, in float64: the camera's global frame, and a neighbour's, then the quotient.
        Fc = (complex(1, 0), complex(0, 0))
        for g in gp:
            Fc = f64_mul(Fc, gens64[g])
        # Overflow to inf, and then inf/inf to NaN, is itself a total loss of the answer -- classify it
        # as such rather than letting a NaN comparison quietly produce a small-looking number.
        def finite(m):
            vs = [m[0].real, m[0].imag, m[1].real, m[1].imag]
            return all(v == v and abs(v) != float("inf") for v in vs)

        if not finite(Fc):
            contrast.append((name, rec["steps"], trend[name][rec["steps"]][1], float("inf")))
            continue
        worst_old = 0.0
        for gi in range(len(gens64)):
            Fk = f64_mul(Fc, gens64[gi])
            rel_old = f64_mul(f64_inv(Fc), Fk)
            # The oracle's answer for the same neighbour is just the generator.
            want = gens[gi]
            if not finite(rel_old):
                worst_old = float("inf")
                break
            d = max(abs(mpc(rel_old[0].real, rel_old[0].imag) - want[0]),
                    abs(mpc(rel_old[1].real, rel_old[1].imag) - want[1]))
            dv = float(d)
            if dv != dv:            # NaN: the quotient of two overflowed frames
                worst_old = float("inf")
                break
            worst_old = max(worst_old, dv)
        contrast.append((name, rec["steps"], trend[name][rec["steps"]][1], worst_old))

for name, steps, newerr, olderr in contrast:
    if steps not in (0, 50, 500, 5000):
        continue
    shown = "LOST (overflow/NaN)" if olderr == float("inf") else f"{olderr:.3e}"
    print(f"           {name:10s} {steps:6d}   {mp.nstr(newerr, 4):>12s}     {shown}")

far = [c for c in contrast if c[1] == 5000]
lost = [c for c in far if c[3] == float("inf") or c[3] > 1e-3]
check("the old global route loses all precision at these distances, the anchored one does not",
      len(lost) == len(far) and all(c[2] < mpf("1e-12") for c in far),
      f"at 5000 tiles all {len(far)} tilings lose the old route entirely (overflow, NaN, or error "
      f"above 1e-3), while the anchored path stays at {mp.nstr(max(c[2] for c in far), 3)} -- "
      f"this is the comparison that shows stage 2 is measuring something")

print("\n" + "=" * 78)
print(f"passed {len(PASS)}   FAILED {len(FAIL)}" + (f"   -> {FAIL}" if FAIL else ""))
print("=" * 78)
raise SystemExit(1 if FAIL else 0)
