// The automated half of the tiling diagnostics. NOT part of the library.
//
// Each check builds its own offscreen viewport so it controls every option and cannot be disturbed by
// the visible one. Each is written to fail loudly on one specific way the atlas could be wrong:
//
//   1  near-origin ground truth   the anchored path agrees with the naive global computation, in the
//                                 one regime where the naive one is still trustworthy
//   2  translation invariance     the picture 2000 tiles out matches the picture at the origin, to the
//                                 last antialiasing level; see checkInvariance for what "matches" means
//                                 exactly and why the distance is 2000
//   3  tile ownership             every pixel is painted by exactly the tile that contains it -- the
//                                 sharp test for clipping
//   4  nothing outside the disk   no drawn pixel beyond the disk, at any distance
//   5  coverage                   no gaps between abutting tiles
//   6  address round-trip         walking out and back restores the same addresses, hence colors
//   7  boundedness                max|V| and the relative frames stay O(1) at every distance
//   8  picking                    the tile under the cursor is the tile that was drawn there
//   9  smoothness                 crossing a tile boundary changes nothing discontinuously
//  10  hundred-step scroll        a full tile spacing in a hundred equal steps, with fully asymmetric
//                                 art colored by tile id, must not jump at any step
//
// Check 2 uses the SYMMETRISED motif on purpose. Canonicalization is lex-min over a coset, which is not
// equivariant under translating the whole tiling, so the arrangement far out is the near one with each
// tile turned about its own center by a multiple of 2*pi/m. With C_m-symmetric art that is invisible and
// the pictures match; with asymmetric art it would differ by construction rather than by bug. Checks 1,
// 3, 9 and 10 use the asymmetric motif, where a turned tile is exactly what we want to catch.

/* global window, document, HyperbolicMap */

import { makeTiling, motifFor, colorFor, DIAG_TILINGS } from "./diagnostics.js";

const KEYS = ["8,3,4", "8,3,0", "7,3,0", "5,4,0", "4,5,0", "6,4,0", "3,7,0", "12,3,0", "binary"];
const SIZE = 320;

function hiddenHost() {
  let el = document.getElementById("__diagHost");
  if (!el) {
    el = document.createElement("div");
    el.id = "__diagHost";
    el.style.cssText = "position:absolute;left:-10000px;top:0;width:1px;height:1px;overflow:hidden";
    document.body.appendChild(el);
  }
  el.innerHTML = "";
  return el;
}

function build(key, opts) {
  const H = window.HyperbolicMap;
  const spec = DIAG_TILINGS[key];
  const tiling = makeTiling(key);
  const host = hiddenHost();
  const div = document.createElement("div");
  host.appendChild(div);
  const vp = new H.HyperbolicViewport({
    container: div,
    width: SIZE,
    height: SIZE,
    devicePixelRatio: 1,
    zoom: opts.zoom || 0.95,
    minZoom: 0.2,
    maxZoom: 30,
    interactRadius: 0.92,
    background: "#ffffff",
    rimFill: "#eeeeee",
    drawRadius: opts.drawRadius !== undefined ? opts.drawRadius : 0.82,
    atlas: {
      tiling,
      maxTiles: opts.maxTiles || 200,
      clip: opts.clip === false ? "never" : "always",
      tileData: (tile) => ({
        version: 1,
        coordinates: "local",
        drawables: motifFor(tiling, spec, tile.address, opts),
      }),
    },
  });
  return { vp, tiling, spec, canvas: div.querySelector("canvas") };
}

async function settle(vp) {
  for (let i = 0; i < 30; i++) {
    vp.render();
    if (!vp.atlas || vp.atlas.pending.size === 0) break;
    await Promise.all([...vp.atlas.pending.values()]);
    // Not rAF: an automated run often has the tab backgrounded, where rAF throttles to ~1 Hz.
    // Nothing here needs the compositor -- getImageData reads the backing store, which draw calls
    // update synchronously, and settle() calls render() explicitly.
    await new Promise((r) => setTimeout(r, 0));
  }
  vp.render();
}

function pixels(canvas) {
  return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
}

function diffCount(a, b) {
  let n = 0;
  let worst = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d) {
      n++;
      if (d > worst) worst = d;
    }
  }
  return { n, worst };
}

// Walk the ADDRESS n tiles away, and PROVE the walk traveled. The renderer forms no global coordinate,
// which is why the picture 2000 tiles out is as ACCURATE as the one at 1 -- but the walk itself has to
// know how far it got, or "the picture 2000 tiles out" is an unchecked claim.
//
// It cannot count steps to find out. A {p,q} generator may have finite order: {8,3} m=4 steps with
// 2*pi/3 rotations about octagon vertices, so `g0` has order 3 and five thousand repetitions of it name
// a tile 1.53 units from home. A plain random walk does travel, but nothing here would notice if it
// stopped doing so. So: greedy outward, with the distance measured in log-scaled form (a test may form
// the global frame; the renderer may not) and strict progress required at every step.
function walkWithDistance(tiling, n, seed) {
  let address = tiling.originAddress();
  let s = (seed || 991) >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  let ar = 1;
  let ai = 0;
  let br = 0;
  let bi = 0;
  let logScale = 0;
  const logAbsA = () => Math.log(Math.hypot(ar, ai)) + logScale;
  let progress = logAbsA();
  for (let i = 0; i < n; i++) {
    const nbrs = tiling.neighbors(address);
    let best = null;
    const off = Math.floor(rand() * nbrs.length);
    for (let k = 0; k < nbrs.length; k++) {
      const cand = nbrs[(k + off) % nbrs.length];
      // stepFrame, not generator: a walk step carries the C_m correction that lands in the child's
      // CANONICAL frame, and accumulating the bare generator would build a frame belonging to no
      // address at all. (The symptom is unmistakable -- the walk reports zero distance.)
      const g = tiling.stepFrame(address, cand.gen);
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
    if (!(now > progress)) throw new Error(`walkAddress: step ${i + 1} of ${n} made no outward progress`);
    progress = now;
  }
  const la = logAbsA();
  return { address, distance: la > 20 ? 2 * (la + Math.LN2) : 2 * Math.acosh(Math.max(1, Math.exp(la))) };
}

function walkAddress(tiling, n, seed) {
  return walkWithDistance(tiling, n, seed).address;
}

// ---- 1. near-origin ground truth -------------------------------------------------------------
//
// Compare the anchored screen positions against ones computed the naive way: build each tile's GLOBAL
// frame and compose it with the global view. Near the origin those frames are small and trustworthy,
// so agreement there says the anchored machinery computes the same thing rather than merely something
// self-consistent. (Far from the origin the naive route is the broken one, which is checked separately
// in dev/audit_atlas_numeric.py against a 60-digit oracle.)
export async function checkGroundTruth(lines) {
  const H = window.HyperbolicMap;
  let worst = 0;
  let where = "";
  for (const key of KEYS) {
    const { vp, tiling } = build(key, { motif: "asym", hashColor: true });
    await settle(vp);
    const view = vp.surface.buildView(vp.view, vp.options);
    // The camera's own global frame has to be divided out. `view.matrix` is V_c = V . F_c, so the
    // global composite for a tile is V . F_k = V_c . (F_c^-1 . F_k). Omitting the F_c^-1 works by
    // accident for regular tilings, whose origin tile is the empty word and hence the identity -- but
    // the binary origin CELL has frame z -> 2^0.5 z + 0.5, and the check failed there by 0.8 disk
    // units. That was the test being wrong, not the code.
    const camInv = tiling.globalFrameForTesting(vp.atlas.anchor.address).inverse();
    for (const t of vp.atlas.lastTiles) {
      // The anchored composite the renderer used...
      const got = t.net;
      // ...versus the same thing assembled from GLOBAL frames, which is trustworthy this close in.
      const want = view.matrix.mul(camInv.mul(tiling.globalFrameForTesting(t.address)));
      for (const p of [[0, 0], [0.2, 0.05], [-0.1, 0.22]]) {
        const a = got.applyToLocal(p[0], p[1], undefined, [0, 0]);
        const b = want.applyToLocal(p[0], p[1], undefined, [0, 0]);
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (d > worst) {
          worst = d;
          where = `${key} tile ${t.id}`;
        }
      }
    }
    vp.destroy();
  }
  lines.push({
    ok: worst < 1e-10,
    text: `1. near-origin ground truth: anchored vs naive global agree to ${worst.toExponential(2)} ` +
      `disk units${worst > 1e-10 ? ` (worst at ${where})` : ""} over ${KEYS.length} tilings`,
  });
}

// ---- 2. translation invariance ----------------------------------------------------------------
//
// The decisive check, and the user's own acceptance criterion: a regular tiling is homogeneous, so
// however far you scroll the picture must look exactly as it did at the origin. Demanded here as
// BYTE-IDENTICAL output, not as a similarity score.
//
// A FRESH viewport, and therefore a fresh canvas, per capture. This is not fussiness: Chrome moves a
// canvas between software and GPU rasterization as it decides the canvas is worth promoting, and the
// two antialias differently. Re-panning one canvas and re-reading it made the SAME view differ from
// itself by 28,841 color channels (worst 101) while two genuinely different views differed by 6 --
// the measurement was pure canvas state. With a fresh canvas the control (same address twice) is
// exactly 0, which is what makes the comparison mean anything. See notes/canvas-testing.md.
async function renderFresh(key, address, opts) {
  const H = window.HyperbolicMap;
  const spec = DIAG_TILINGS[key];
  const tiling = makeTiling(key);
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-10000px;top:0";
  document.body.appendChild(host);
  const vp = new H.HyperbolicViewport({
    container: host,
    width: SIZE,
    height: SIZE,
    devicePixelRatio: 1,
    zoom: opts.zoom || 0.95,
    interactRadius: 0.92,
    background: "#ffffff",
    rimFill: "#eeeeee",
    drawRadius: opts.drawRadius !== undefined ? opts.drawRadius : 0.82,
    anchor: address,
    atlas: {
      tiling,
      maxTiles: opts.maxTiles || 200,
      clip: opts.clip === false ? "never" : "always",
      tileData: (tile) => ({
        version: 1,
        coordinates: "local",
        drawables: motifFor(tiling, spec, tile.address, opts),
      }),
    },
  });
  await settle(vp);
  const canvas = host.querySelector("canvas");
  const data = new Uint8ClampedArray(canvas.getContext("2d").getImageData(0, 0, SIZE, SIZE).data);
  const info = { tiles: vp.atlas.lastTiles.length, truncated: vp.atlas.anchor.lastTruncated };
  vp.destroy();
  host.remove();
  return { data, info };
}

export async function checkInvariance(lines, only) {
  // 2000 tiles, which is about 3000 hyperbolic units, and the number is chosen from both ends.
  //
  // It has to be far enough: what is being tested is that the rendering does not know how far out it
  // is, and that fails at d ~ 16 if it fails at all, since that is where a global float frame starts
  // losing digits. 3000 units is two hundred times past it.
  //
  // It cannot be much further, because GETTING there is not free. Each tile discovered on the way is
  // named in exact integer arithmetic and an id's width grows linearly with distance, so a greedy walk
  // on {8,3} m=4 costs 1.9 s and peaks at 142 MB at 2000 tiles, against 11.7 s and 520 MB at 5000.
  // Times eight regular tilings, the larger figure exceeds the DevTools protocol timeout and threatens
  // the browser tab.
  const distances = [1, 5, 50, 500, 2000];
  const failures = [];
  const traveled = [];
  const antialiased = [];
  let checked = 0;
  const opts = { motif: "sym", hashColor: false, uniform: true };
  for (const key of only || KEYS) {
    const tiling0 = makeTiling(key);
    // The binary tiling's exact symmetry is LATITUDE SHIFT: z -> 2z maps cell (lat, lon) to
    // (lat+1, lon) bijectively. It is only weakly aperiodic, so a LATERAL walk is NOT a symmetry and
    // comparing across one would be demanding something false. Regular tilings are homogeneous, so any
    // walk works.
    const addresses = key === "binary"
      // A latitude step is the translation z -> 2z, i.e. exactly log 2 of hyperbolic distance.
      ? distances.map((n) => ({ n, address: { lat: BigInt(n), lon: 0n }, dist: n * Math.LN2 }))
      : distances.map((n) => {
        const w = walkWithDistance(tiling0, n, 77 + n);
        return { n, address: w.address, dist: w.distance };
      });
    // Report how far the far views actually ARE, so "byte-identical at 5000 tiles" is a checked claim
    // rather than a label. Word length would not do: see walkWithDistance.
    for (const a of addresses) traveled.push(a.dist);

    const ref = await renderFresh(key, tiling0.originAddress(), opts);
    // The control: the same address rendered again must be byte-identical, or the instrument is broken
    // and nothing below it means anything.
    const ctrl = await renderFresh(key, tiling0.originAddress(), opts);
    const cd = diffCount(ref.data, ctrl.data);
    if (cd.n > 0) {
      failures.push(`${key} CONTROL: the same address rendered twice differs by ${cd.n} channels -- the measurement is unreliable`);
      continue;
    }
    // BYTE-IDENTICAL, or within one level on a handful of channels. The exception is new and it is not
    // slack, it is a consequence of canonical orientation.
    //
    // Canonicalization is lex-min over the coset, which is not equivariant under translating the whole
    // tiling: the far arrangement is the near one with each tile turned about its own center by some
    // multiple of 2*pi/m. With C_m-symmetric art the drawn SHAPE is unchanged -- that is what C_m
    // symmetry means -- but the coordinates handed to the rasteriser are the rotated ones, and for m
    // whose rotation has irrational cosines that differs in the last bit. Measured across the nine
    // tilings, eight are still byte-identical and {3,7} (m = 3, so 120 degrees) differs on 1 to 4
    // channels of 409,600 by exactly 1 level of 255.
    //
    // The tolerance is kept at that scale on purpose, because the bug this check exists to catch is
    // enormous by comparison: a tile drawn in the wrong orientation moves thousands of channels by tens
    // or hundreds of levels (check 9 measures 3,000-5,000 at a threshold of 64). One level on fifty
    // pixels cannot hide one.
    const SLACK_CHANNELS = 100;
    for (const { n, address } of addresses) {
      const got = await renderFresh(key, address, opts);
      const d = diffCount(ref.data, got.data);
      checked++;
      if (d.n > SLACK_CHANNELS || d.worst > 1) {
        failures.push(`${key} at ${n} tiles: ${d.n} channels differ (worst ${d.worst}), ` +
          `${got.info.tiles} tiles vs ${ref.info.tiles}`);
      } else if (d.n > 0) {
        antialiased.push(`${key}@${n}:${d.n}`);
      }
    }
  }
  lines.push({
    ok: failures.length === 0,
    text: `2. translation invariance: ${checked - failures.length}/${checked} views match the origin view ` +
      `(${distances.join(", ")} tiles out = up to ` +
      `${Math.max(...traveled).toFixed(0)} hyperbolic units, verified traveled)` +
      (antialiased.length ? `; byte-identical except for last-level antialiasing on ${antialiased.join(" ")}` : "; all byte-identical") +
      (failures.length ? `\n     ${failures.slice(0, 5).join("\n     ")}` : ""),
  });
}

// ---- 3 + 5. tile ownership and coverage -------------------------------------------------------
//
// Fill each tile flat with hash(address) and OVERFLOW it past its own boundary, so clipping has to trim
// it. Then for a grid of pixels: find which returned tile contains that point, and require the pixel to
// be that tile's color. A clipping error is a band of the wrong color along a boundary; a gap is a
// background-colored pixel where a tile should be.
export async function checkOwnership(lines) {
  const results = [];
  const gaps = [];
  for (const key of KEYS) {
    for (const walk of [0, 40]) {
      const { vp, tiling, canvas } = build(key, {
        motif: "over",
        hashColor: true,
        clip: true,
        drawRadius: 0.72,
      });
      if (walk) vp.panToTile(walkAddress(tiling, walk, 313), [0, 0]);
      await settle(vp);
      const px = pixels(canvas);
      const view = vp.surface.buildView(vp.view, vp.options);

      // Expected color per tile, and the inverse of each tile's composite for point tests.
      const tiles = vp.atlas.lastTiles.map((t) => ({
        id: t.id,
        inv: t.net.inverse(),
        rgb: rgbOf(colorFor(t.id)),
      }));

      let wrong = 0;
      let missing = 0;
      let tested = 0;
      const R = view.radius;
      for (let y = 4; y < canvas.height; y += 7) {
        for (let x = 4; x < canvas.width; x += 7) {
          const zx = (x - view.cx) / R;
          const zy = -(y - view.cy) / R;
          const rr = zx * zx + zy * zy;
          // Stay well inside the drawn region so the rim annulus and the sub-pixel fringe are excluded.
          if (rr > 0.62 * 0.62) continue;
          // Which tile contains this screen point? Test strictly inside, with a margin, so pixels lying
          // on a boundary -- where antialiasing legitimately blends two colors -- are not counted.
          let owner = null;
          let ambiguous = false;
          for (const t of tiles) {
            const q = t.inv.applyToDisk(zx, zy, [0, 0]);
            const k = 1 / Math.sqrt(Math.max(1e-300, 1 - q[0] * q[0] - q[1] * q[1]));
            if (tiling.containsLocal(q[0] * k, q[1] * k, -0.06)) {
              if (owner) ambiguous = true;
              owner = t;
            }
          }
          if (ambiguous) continue;
          if (!owner) continue;
          tested++;
          const i = (y * canvas.width + x) * 4;
          const dr = Math.abs(px[i] - owner.rgb[0]);
          const dg = Math.abs(px[i + 1] - owner.rgb[1]);
          const db = Math.abs(px[i + 2] - owner.rgb[2]);
          const isBackground = px[i] > 250 && px[i + 1] > 250 && px[i + 2] > 250;
          if (isBackground) missing++;
          else if (dr + dg + db > 24) wrong++;
        }
      }
      results.push({ key, walk, tested, wrong, missing });
      if (missing) gaps.push(`${key} walk ${walk}: ${missing}/${tested} pixels show background`);
      vp.destroy();
    }
  }
  const totWrong = results.reduce((a, r) => a + r.wrong, 0);
  const totTested = results.reduce((a, r) => a + r.tested, 0);
  const totMissing = results.reduce((a, r) => a + r.missing, 0);
  const bad = results.filter((r) => r.wrong > 0).map((r) => `${r.key} walk ${r.walk}: ${r.wrong}/${r.tested}`);
  lines.push({
    ok: totWrong === 0,
    text: `3. tile ownership with overflowing art + clipping: ${totTested - totWrong}/${totTested} ` +
      `pixels painted by the tile that contains them` + (bad.length ? `\n     ${bad.slice(0, 5).join("\n     ")}` : ""),
  });
  lines.push({
    ok: totMissing === 0,
    text: `5. coverage: ${totMissing} of ${totTested} interior pixels show background through a seam` +
      (gaps.length ? `\n     ${gaps.slice(0, 4).join("\n     ")}` : ""),
  });
}

function rgbOf(css) {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const ctx = c.getContext("2d");
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

// ---- 4. nothing outside the disk --------------------------------------------------------------
export async function checkOutsideDisk(lines) {
  let worst = 0;
  let where = "";
  for (const key of KEYS) {
    for (const walk of [0, 200]) {
      const { vp, tiling, canvas } = build(key, { motif: "over", hashColor: true, clip: true, zoom: 0.7 });
      if (walk) vp.panToTile(walkAddress(tiling, walk, 55), [0, 0]);
      await settle(vp);
      const px = pixels(canvas);
      const view = vp.surface.buildView(vp.view, vp.options);
      let outside = 0;
      for (let y = 0; y < canvas.height; y += 3) {
        for (let x = 0; x < canvas.width; x += 3) {
          const dx = x - view.cx;
          const dy = y - view.cy;
          // Beyond the rim annulus entirely: nothing the library draws belongs here.
          if (dx * dx + dy * dy < (view.radius * 1.04) ** 2) continue;
          const i = (y * canvas.width + x) * 4;
          if (px[i + 3] > 8 && !(px[i] > 250 && px[i + 1] > 250 && px[i + 2] > 250)) outside++;
        }
      }
      if (outside > worst) {
        worst = outside;
        where = `${key} walk ${walk}`;
      }
      vp.destroy();
    }
  }
  lines.push({
    ok: worst === 0,
    text: `4. nothing outside the disk: ${worst} stray pixels beyond the rim` + (worst ? ` (worst ${where})` : ""),
  });
}

// ---- 6. address round-trip -------------------------------------------------------------------
export async function checkAddressRoundTrip(lines) {
  const failures = [];
  for (const key of KEYS) {
    const tiling = makeTiling(key);
    let address = tiling.originAddress();
    const path = [];
    let s = 4242;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < 300; i++) {
      const nbrs = tiling.neighbors(address);
      const pick = nbrs[Math.floor(rand() * nbrs.length)];
      // `reverseGenerator`, not `inverseGenerator`, and recorded FROM the tile it was taken from. On a
      // regular tiling the child's canonical frame differs from the frame the step produced by a power
      // of P, and conjugating by P permutes the generators, so the index that walks back is a different
      // one. The plain inverse index lands on a real but wrong neighbor and the walk never comes home.
      path.push(tiling.reverseGenerator(address, pick.gen));
      address = pick.address;
    }
    const far = tiling.addressToString(address);
    for (let i = path.length - 1; i >= 0; i--) {
      const want = path[i];
      const nb = tiling.neighbors(address).find((n) => n.gen === want);
      if (!nb) {
        failures.push(`${key}: no neighbor with generator ${want}`);
        break;
      }
      address = nb.address;
    }
    if (!tiling.addressEquals(address, tiling.originAddress())) {
      failures.push(`${key}: returned to ${tiling.addressToString(address)} instead of the origin (went out to ${far.slice(0, 20)}…)`);
    }
  }
  lines.push({
    ok: failures.length === 0,
    text: `6. address round-trip over 300 random steps and back: ${KEYS.length - failures.length}/${KEYS.length} tilings restore the origin address` +
      (failures.length ? `\n     ${failures.join("\n     ")}` : ""),
  });
}

// ---- 7. boundedness --------------------------------------------------------------------------
export async function checkBounded(lines) {
  const H = window.HyperbolicMap;
  let worstV = 0;
  let worstRel = 0;
  let where = "";
  for (const key of KEYS) {
    const { vp, tiling } = build(key, { motif: "asym", hashColor: true });
    for (const walk of [0, 5, 500, 2000]) {
      const address = key === "binary" ? { lat: BigInt(walk), lon: 0n } : walkAddress(tiling, walk, 8 + walk);
      vp.panToTile(address, [0, 0]);
      await settle(vp);
      const v = H.Anchor.maxEntry(vp.view.liveMatrix);
      if (v > worstV) {
        worstV = v;
        where = `${key} at ${walk}`;
      }
      for (const t of vp.atlas.lastTiles) {
        worstRel = Math.max(worstRel, H.Anchor.maxEntry(t.rel));
      }
    }
    vp.destroy();
  }
  lines.push({
    ok: worstV < 10 && worstRel < 1e4 && Number.isFinite(worstRel),
    text: `7. boundedness: max|V| reached ${worstV.toFixed(4)} (worst ${where}), max relative-frame entry ` +
      `${worstRel.toFixed(1)} -- both must be independent of distance traveled`,
  });
}

// ---- 8. picking agrees with what is on screen -----------------------------------------------
//
// `tileAtScreen` must name the tile the RENDERER used, and the artwork here is colored by a hash of
// the ADDRESS, so any disagreement between what was picked and what was painted shows up as a wrong
// color under the cursor -- which is the sharpest form this question has.
export async function checkPicking(lines) {
  let tested = 0;
  let wrong = 0;
  const failures = [];
  for (const key of KEYS) {
    const tiling0 = makeTiling(key);
    for (const far of [0, 500, 2000]) {
      const address = far
        ? (key === "binary" ? { lat: BigInt(far), lon: 0n } : walkAddress(tiling0, far, 5))
        : tiling0.originAddress();
      const { vp, tiling, canvas } = build(key, { motif: "fill", hashColor: true, clip: true, drawRadius: 0.72 });
      vp.panToTile(address, [0, 0]);
      await settle(vp);
      const px = pixels(canvas);
      const view = vp.surface.buildView(vp.view, vp.options);
      const at = (x, y) => { const i = (y * canvas.width + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
      const same = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 6;
      for (let y = 6; y < canvas.height - 6; y += 6) {
        for (let x = 6; x < canvas.width - 6; x += 6) {
          const dx = (x - view.cx) / view.radius;
          const dy = -(y - view.cy) / view.radius;
          if (dx * dx + dy * dy > 0.55 * 0.55) continue;
          const col = at(x, y);
          if (col[0] > 250 && col[1] > 250 && col[2] > 250) continue;
          // Flat regions only: on an antialiased boundary the rendered color is legitimately a blend.
          if (!same(col, at(x - 2, y)) || !same(col, at(x + 2, y)) ||
              !same(col, at(x, y - 2)) || !same(col, at(x, y + 2))) continue;
          const pick = vp.tileAtScreen(x, y);
          if (!pick) continue;
          tested++;
          if (!same(col, rgbOf(colorFor(pick.id)))) {
            wrong++;
            if (failures.length < 3) failures.push(`${key} at ${far} tiles, pixel (${x},${y}): picked ${pick.id}`);
          }
        }
      }
      vp.destroy();
    }
  }
  lines.push({
    ok: wrong === 0,
    text: `8. picking: ${tested - wrong}/${tested} sampled pixels name the tile that painted them, at ` +
      `0, 500 and 2000 tiles out` + (failures.length ? `\n     ${failures.join("\n     ")}` : ""),
  });
}

export async function runAllChecks() {
  const lines = [];
  const t0 = performance.now();
  await checkGroundTruth(lines);
  await checkInvariance(lines);
  await checkOwnership(lines);
  await checkOutsideDisk(lines);
  await checkAddressRoundTrip(lines);
  await checkBounded(lines);
  await checkPicking(lines);
  await checkSmoothness(lines);
  await checkHundredStep(lines);
  lines.sort((a, b) => parseInt(a.text, 10) - parseInt(b.text, 10));
  lines.push({
    ok: lines.every((l) => l.ok),
    text: `${lines.filter((l) => l.ok).length}/${lines.length} checks pass  (${Math.round(performance.now() - t0)} ms)`,
  });
  return { lines, ok: lines.every((l) => l.ok) };
}

window.runAllChecks = runAllChecks;

// Each check is exported separately as well, so an automated driver can run them one at a time. The
// whole suite takes minutes -- it builds and settles a viewport per tiling per distance -- and a single
// call that long hits protocol timeouts.
//
// `smoothness` and `hundredStep` are declared below this point and are included here by hoisting.
// `smoothness` was MISSING from this map for a while, which meant any driver iterating
// `window.diagChecks` silently skipped the most sensitive check in the suite -- the one that caught the
// stabilizer bug. Anything added below must be added here too.
window.diagChecks = {
  groundTruth: checkGroundTruth,
  invariance: checkInvariance,
  ownership: checkOwnership,
  outsideDisk: checkOutsideDisk,
  addressRoundTrip: checkAddressRoundTrip,
  bounded: checkBounded,
  picking: checkPicking,
  smoothness: checkSmoothness,
  hundredStep: checkHundredStep,
};

// ---- 9. SMOOTHNESS across a tile boundary -------------------------------------------------------
//
// Panning across a tile center forces a re-anchor, which is the moment at which a tile's frame or its
// name could conceivably change. Neither may: frames and ids are functions of the tile. Nothing here
// may jump.
//
// Measuring it needs care, because the obvious ways are not sensitive enough:
//
//   * comparing consecutive frames of an ordinary pan buries the jump, because a pan changes a lot of
//     pixels by itself -- the asymmetric motif scored only 1.3x the median that way;
//   * even a sub-pixel hop is not enough: a 0.35 px shift still re-antialiases every stroke edge, which
//     came to 1,994 changed channels against 5,017 for a real jump. 2.5x is not a separation.
//
// So: BISECT to the boundary, then compare the picture at t* - eps and t* + eps with eps = 1e-4 of a
// tile spacing, i.e. about 0.01 px of motion. Now the continuous part contributes essentially nothing
// and any difference at all is the discontinuity. Each frame is rendered in a FRESH viewport, because
// re-reading one canvas across renders is not reproducible in Chrome.
//
// Nothing here is required to jump, so nothing here can fail by finding a jump that is missing -- and
// this suite has been burned more than once by checks that could not fail. A SENSITIVITY PROBE supplies
// the missing half: see below.
export async function checkSmoothness(lines, only) {
  const H = window.HyperbolicMap;
  const SZ = 240;
  const failures = [];
  const detail = [];

  // The camera at parameter t along a straight pan of one tile spacing, canonicalized: build it in a
  // fresh viewport from the origin tile and let the library re-anchor, so the state is exactly what
  // scrolling there would produce.
  const makeVp = (key, opts) => {
    const spec = DIAG_TILINGS[key];
    const tiling = makeTiling(key);
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;left:-10000px;top:0";
    document.body.appendChild(host);
    const vp = new H.HyperbolicViewport({
      container: host, width: SZ, height: SZ, devicePixelRatio: 1,
      zoom: 0.95, interactRadius: 0.92, background: "#ffffff", rimFill: "#eeeeee", drawRadius: 0.8,
      atlas: {
        tiling, maxTiles: 160, clip: "always", checkTileSymmetry: "off",
        tileData: (t) => ({ version: 1, coordinates: "local", drawables: motifFor(tiling, spec, t.address, opts) }),
      },
    });
    return { vp, host, tiling };
  };

  const at = async (key, opts, t, wantPixels) => {
    const { vp, host, tiling } = makeVp(key, opts);
    const d = tiling.metrics.centerSpacing * t;
    if (d > 0) {
      const T = H.Isom.translationToDisk(0, -Math.tanh(d / 2));
      vp.view.matrix = T.mul(vp.view.matrix).normalize();
      vp.view.liveMatrix = vp.view.matrix.clone();
    }
    await settle(vp);
    const addr = tiling.addressToString(vp.atlas.anchor.address);
    let data = null;
    if (wantPixels) {
      const canvas = host.querySelector("canvas");
      data = new Uint8ClampedArray(canvas.getContext("2d").getImageData(0, 0, SZ, SZ).data);
    }
    vp.destroy();
    host.remove();
    return { addr, data };
  };

  // Compare only the INTERIOR. At the rim, tiles legitimately enter and leave the visible set and the
  // maxTiles budget as the camera moves, which changes pixels for reasons that have nothing to do with
  // the stabilizer. Including the rim put the flat-fill control at 2x when it should be ~1x.
  // Count only SUBSTANTIAL changes. Two pictures that differ by 0.03 px of pan differ slightly on every
  // stroke edge, and rotating a tile's clip polygon onto itself re-rasterises its edge pixels even
  // though the region is identical -- both are antialiasing, not motion. A pixel that changes by more
  // than a quarter of full scale has changed what it is showing, which is the thing being measured.
  // Without this the flat-fill case sat at 2x while a real jump was 3x, which is not a separation.
  const BIG = 64;
  const interiorDiff = (a, b) => {
    const c = SZ / 2;
    const R = SZ * 0.34;
    let n = 0;
    let worst = 0;
    for (let y = 0; y < SZ; y++) {
      for (let x = 0; x < SZ; x++) {
        if (Math.hypot(x - c, y - c) > R) continue;
        const i = (y * SZ + x) * 4;
        for (let k = 0; k < 3; k++) {
          const d = Math.abs(a[i + k] - b[i + k]);
          if (d > worst) worst = d;
          if (d > BIG) n++;
        }
      }
    }
    return { n, worst };
  };

  // The two hostile cases are the last two: an id-hash color, and a fully asymmetric shape with an
  // id-hash color. Those are the combinations that a route-dependent frame or a route-dependent name
  // would break instantly, and they must be as still as the symmetric ones. The binary tiling is
  // carried through all five as a control, being the tiling whose addresses are integers and whose
  // stabilizer is trivial, so it has nothing to get wrong.
  const cases = [];
  for (const key of only || KEYS) {
    cases.push({ key, opts: { motif: "art", hashColor: false } });
    cases.push({ key, opts: { motif: "sym", hashColor: false } });
    cases.push({ key, opts: { motif: "fill", hashColor: false } });
    cases.push({ key, opts: { motif: "art", hashColor: true } });
    cases.push({ key, opts: { motif: "asym", hashColor: true } });
  }

  // SENSITIVITY PROBE. A check where nothing may jump is a check that a dead renderer passes: if every
  // frame came back blank, or `interiorDiff` counted nothing, all of the above would read as perfect.
  // So measure a difference that MUST be large -- the same art half a tile spacing apart -- and require
  // it. This is the assertion that the instrument is switched on.
  for (const key of (only || KEYS).slice(0, 3)) {
    const [p0, p1] = [await at(key, { motif: "art", hashColor: false }, 0, true),
      await at(key, { motif: "art", hashColor: false }, 0.5, true)];
    let ink = 0;
    for (let i = 0; i < p0.data.length; i += 4) {
      if (p0.data[i] < 200 || p0.data[i + 1] < 200 || p0.data[i + 2] < 200) ink++;
    }
    const moved = interiorDiff(p0.data, p1.data);
    if (ink < 500) failures.push(`${key}: the reference frame is essentially blank (${ink} inked pixels)`);
    if (moved.n < 500) {
      failures.push(
        `${key}: SENSITIVITY PROBE FAILED -- half a tile spacing of motion changed only ${moved.n} ` +
          "channels, so this check could not detect a jump either",
      );
    }
    detail.push(`${key} probe ${moved.n}/${ink}`);
  }

  for (const { key, opts } of cases) {
    const a0 = (await at(key, opts, 0, false)).addr;
    const a1 = (await at(key, opts, 1, false)).addr;
    if (a0 === a1) {
      failures.push(`${key}/${opts.motif}: panning a full tile spacing never changed the anchor`);
      continue;
    }
    // Bisect for the parameter at which the anchor changes.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if ((await at(key, opts, mid, false)).addr === a0) lo = mid;
      else hi = mid;
    }
    const eps = 1e-4;
    const [before, after] = [await at(key, opts, lo - eps, true), await at(key, opts, hi + eps, true)];
    // The control: the same 2*eps of motion, nowhere near a boundary.
    const [cA, cB] = [await at(key, opts, 0.25 - eps, true), await at(key, opts, 0.25 + eps, true)];
    const jump = interiorDiff(before.data, after.data);
    const ctrl = interiorDiff(cA.data, cB.data);
    const budget = Math.max(40, ctrl.n * 3 + 30);
    const hash = opts.hashColor ? "+hash" : "";
    detail.push(`${key} ${opts.motif}${hash} ${jump.n}/${ctrl.n}`);
    if (jump.n > budget) {
      failures.push(
        `${key} (${opts.motif}${hash}): crossing the boundary changed ${jump.n} channels ` +
          `(worst ${jump.worst}) against ${ctrl.n} for the same motion elsewhere -- the picture JUMPS`,
      );
    }
  }
  lines.push({
    ok: failures.length === 0,
    text: `9. smoothness across tile boundaries: ${cases.length - failures.length}/${cases.length} pans ` +
      `behave as required; boundary/elsewhere changed channels:\n     ` +
      detail.join("  ") +
      (failures.length ? `\n     ${failures.slice(0, 6).join("\n     ")}` : ""),
  });
}

// ---- 10. THE HUNDRED-STEP SCROLL ----------------------------------------------------------------
//
// The acceptance test for canonical tile identity: scroll smoothly from one tile center to the next in
// a hundred equal steps, with the most hostile art available -- a fully asymmetric stroke colored by a
// hash of the tile id -- and require that NO step shows a discontinuity. Every regular tiling, plus the
// binary one as a control.
//
// Why this and not check 9. Check 9 bisects to the boundary and compares two frames a hundredth of a
// pixel apart, which isolates the discontinuity but only looks at ONE crossing, the one it went hunting
// for. This looks at the whole traverse and does not know where the crossing is -- so it also catches a
// jump at some other tile's re-anchor, a jump that happens twice, or art that drifts rather than snaps.
//
// The measure is per-step interior difference: a steady pan changes pixels at a steady rate, so a jump
// is a step that stands far above its own neighbors. See the budget below for how far above, and how
// that number was calibrated.
export async function checkHundredStep(lines, only) {
  const H = window.HyperbolicMap;
  const SZ = 200;
  const STEPS = 100;
  const failures = [];
  const detail = [];

  for (const key of only || KEYS) {
    const spec = DIAG_TILINGS[key];
    const tiling = makeTiling(key);
    const opts = { motif: "asym", hashColor: true };
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;left:-10000px;top:0";
    document.body.appendChild(host);
    const vp = new H.HyperbolicViewport({
      container: host, width: SZ, height: SZ, devicePixelRatio: 1,
      zoom: 0.95, interactRadius: 0.92, background: "#ffffff", rimFill: "#eeeeee", drawRadius: 0.8,
      atlas: {
        tiling, maxTiles: 160, clip: "always", checkTileSymmetry: "off",
        tileData: (t) => ({ version: 1, coordinates: "local", drawables: motifFor(tiling, spec, t.address, opts) }),
      },
    });
    const canvas = host.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    // ONE viewport for the whole traverse, unlike check 9. That is the point: this is a real scroll,
    // with the library's own re-anchoring happening between the frames being compared, rather than a
    // sequence of independently rebuilt cameras.
    const spacing = tiling.metrics.centerSpacing;
    const diffs = [];
    let prev = null;
    let anchors = 0;
    let lastAnchor = null;
    const c = SZ / 2;
    const R = SZ * 0.34;
    // INCREMENTAL steps, composed onto the live view, with the library doing its own re-anchoring in
    // between -- that is what makes this a scroll rather than a hundred independent cameras.
    //
    // The first version set an absolute view built from the ORIGIN tile at every step. That is
    // incoherent once the camera has re-anchored, because `view.matrix` is then expressed relative to
    // whatever tile the camera is in, and feeding it an origin-relative matrix made the anchor chase
    // back and forth: 50 re-anchors across a traverse that should cross one boundary. The re-anchor
    // count is asserted below so that cannot happen again unnoticed.
    const stepT = H.Isom.translationToDisk(0, -Math.tanh(spacing / STEPS / 2));
    for (let i = 0; i <= STEPS; i++) {
      if (i > 0) {
        vp.view.matrix = stepT.mul(vp.view.matrix).normalize();
        vp.view.liveMatrix = vp.view.matrix.clone();
      }
      await settle(vp);
      const addr = tiling.addressToString(vp.atlas.anchor.address);
      if (lastAnchor !== null && addr !== lastAnchor) anchors++;
      lastAnchor = addr;
      const data = new Uint8ClampedArray(ctx.getImageData(0, 0, SZ, SZ).data);
      if (prev) {
        let n = 0;
        for (let y = 0; y < SZ; y++) {
          for (let x = 0; x < SZ; x++) {
            if (Math.hypot(x - c, y - c) > R) continue;
            const j = (y * SZ + x) * 4;
            for (let k = 0; k < 3; k++) {
              if (Math.abs(data[j + k] - prev[j + k]) > 64) n++;
            }
          }
        }
        diffs.push(n);
      }
      prev = data;
    }
    vp.destroy();
    host.remove();

    const sorted = [...diffs].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    const max = sorted[sorted.length - 1];
    const worstStep = diffs.indexOf(max);
    // The budget, calibrated from the measured distribution rather than guessed. A steady pan is
    // steady: across the nine tilings the ninetieth percentile sits 1.1-1.2x the median and the worst
    // ordinary step 1.2-1.9x it (the extremes are {8,3} m=4 at 573/687/792/848 for min/median/p90/max
    // and {3,7} at 237/294/338/549). Against that, a stabilizer jump is not marginal: check 9 measures a
    // real one at 3,000-5,000 changed channels on a 240 px canvas, so 2,000-3,500 here.
    //
    // Twice the ninetieth percentile leaves 1.6x headroom over the worst ordinary step actually seen
    // and still catches a jump of about a thousand channels -- a third of the smallest real one. Using
    // p90 rather than the median is what keeps the one or two genuinely larger steps near the boundary
    // from inflating the budget they are being judged against.
    const budget = Math.max(400, p90 * 2 + 200);
    detail.push(`${key} max ${max} p90 ${p90} median ${median} budget ${budget} (${anchors} re-anchors)`);
    // Anti-vacuity, in both directions. The traverse must actually have crossed a tile boundary, or the
    // hard part never happened; and the art must actually be moving, or a frozen renderer scores zero
    // at every step and passes perfectly.
    // Exactly one boundary crossing is expected: the traverse is one tile spacing along a straight
    // geodesic. Zero means the hard part never happened; several means the camera is oscillating, which
    // is a bug in the traverse rather than in the library and would make the whole measurement noise.
    if (anchors < 1) failures.push(`${key}: the traverse never re-anchored, so it tested nothing`);
    if (anchors > 3) failures.push(`${key}: the traverse re-anchored ${anchors} times over one tile spacing`);
    if (median < 5) failures.push(`${key}: the picture barely changed between steps (median ${median})`);
    if (max > budget) {
      failures.push(
        `${key}: step ${worstStep + 1} of ${STEPS} changed ${max} channels against a median of ` +
          `${median} -- the asymmetric art JUMPS while scrolling`,
      );
    }
  }
  lines.push({
    ok: failures.length === 0,
    text: `10. hundred-step scroll, fully asymmetric art colored by tile id:\n     ` +
      detail.join("\n     ") +
      (failures.length ? `\n     ${failures.slice(0, 6).join("\n     ")}` : ""),
  });
}
