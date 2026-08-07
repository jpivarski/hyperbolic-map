// The automated half of the tiling diagnostics. NOT part of the library.
//
// Each check builds its own offscreen viewport so it controls every option and cannot be disturbed by
// the visible one. They are written to fail loudly on the specific defects this rewrite was about:
//
//   1  near-origin ground truth   the anchored path agrees with the naive global computation, in the
//                                 one regime where the naive one is still trustworthy
//   2  translation invariance     the picture at 5000 tiles out is BYTE-IDENTICAL to the picture at the
//                                 origin, which is the user's own acceptance criterion
//   3  tile ownership             every pixel is painted by exactly the tile that contains it -- the
//                                 sharp test for clipping
//   4  nothing outside the disk   no drawn pixel beyond the disk, at any distance
//   5  coverage                   no gaps between abutting tiles
//   6  address round-trip         walking out and back restores the same addresses, hence colours
//   7  boundedness                max|V| and the relative frames stay O(1) at every distance
//
// Check 2 uses the SYMMETRISED motif on purpose. With asymmetric art the decorated tiling is not
// invariant under the tile stabiliser, so byte-identity would fail by construction rather than by bug.
// Checks 1 and 3 use the asymmetric one, where orientation errors are what we want to catch.

/* global window, document, HyperbolicMap */

import { makeTiling, motifFor, colourFor, DIAG_TILINGS } from "./diagnostics.js";

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

// Walk the ADDRESS n tiles away, and PROVE the walk travelled. The renderer forms no global coordinate,
// which is why 5000 costs the same as 1 -- but the walk itself must know how far it got, or "the picture
// at 5000 tiles out" is an unchecked claim.
//
// It cannot count symbols to find out. A {p,q} generator may have finite order: {8,3} m=4 steps with
// 2*pi/3 rotations about octagon vertices, so `g0` has order 3 and the 5000-symbol word "0.0.0..." names
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
    const nbrs = tiling.neighbours(address);
    let best = null;
    const off = Math.floor(rand() * nbrs.length);
    for (let k = 0; k < nbrs.length; k++) {
      const cand = nbrs[(k + off) % nbrs.length];
      const g = tiling.generator(cand.gen);
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
// in tools/audit_atlas_numeric.py against a 60-digit oracle.)
export async function checkGroundTruth(lines) {
  const H = window.HyperbolicMap;
  let worst = 0;
  let where = "";
  for (const key of KEYS) {
    const { vp, tiling } = build(key, { motif: "illegal", hashColour: true });
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
// itself by 28,841 colour channels (worst 101) while two genuinely different views differed by 6 --
// the measurement was pure canvas state. With a fresh canvas the control (same address twice) is
// exactly 0, which is what makes the comparison mean anything. See notes/legacy-decoded.md.
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
  const distances = [1, 5, 50, 500, 5000];
  const failures = [];
  const travelled = [];
  let checked = 0;
  const opts = { motif: "legal", hashColour: false, uniform: true };
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
    for (const a of addresses) travelled.push(a.dist);

    const ref = await renderFresh(key, tiling0.originAddress(), opts);
    // The control: the same address rendered again must be byte-identical, or the instrument is broken
    // and nothing below it means anything.
    const ctrl = await renderFresh(key, tiling0.originAddress(), opts);
    const cd = diffCount(ref.data, ctrl.data);
    if (cd.n > 0) {
      failures.push(`${key} CONTROL: the same address rendered twice differs by ${cd.n} channels -- the measurement is unreliable`);
      continue;
    }
    for (const { n, address } of addresses) {
      const got = await renderFresh(key, address, opts);
      const d = diffCount(ref.data, got.data);
      checked++;
      if (d.n > 0) {
        failures.push(`${key} at ${n} tiles: ${d.n} channels differ (worst ${d.worst}), ` +
          `${got.info.tiles} tiles vs ${ref.info.tiles}`);
      }
    }
  }
  lines.push({
    ok: failures.length === 0,
    text: `2. translation invariance: ${checked - failures.length}/${checked} views BYTE-IDENTICAL to ` +
      `the origin view (${distances.join(", ")} tiles out = up to ` +
      `${Math.max(...travelled).toFixed(0)} hyperbolic units, verified travelled)` +
      (failures.length ? `\n     ${failures.slice(0, 5).join("\n     ")}` : ""),
  });
}

// ---- 3 + 5. tile ownership and coverage -------------------------------------------------------
//
// Fill each tile flat with hash(address) and OVERFLOW it past its own boundary, so clipping has to trim
// it. Then for a grid of pixels: find which returned tile contains that point, and require the pixel to
// be that tile's colour. A clipping error is a band of the wrong colour along a boundary; a gap is a
// background-coloured pixel where a tile should be.
export async function checkOwnership(lines) {
  const results = [];
  const gaps = [];
  for (const key of KEYS) {
    for (const walk of [0, 40]) {
      const { vp, tiling, canvas } = build(key, {
        motif: "over",
        hashColour: true,
        clip: true,
        drawRadius: 0.72,
      });
      if (walk) vp.panToTile(walkAddress(tiling, walk, 313), [0, 0]);
      await settle(vp);
      const px = pixels(canvas);
      const view = vp.surface.buildView(vp.view, vp.options);

      // Expected colour per tile, and the inverse of each tile's composite for point tests.
      const tiles = vp.atlas.lastTiles.map((t) => ({
        id: t.id,
        inv: t.net.inverse(),
        rgb: rgbOf(colourFor(t.id)),
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
          // on a boundary -- where antialiasing legitimately blends two colours -- are not counted.
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
      const { vp, tiling, canvas } = build(key, { motif: "over", hashColour: true, clip: true, zoom: 0.7 });
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
      const nbrs = tiling.neighbours(address);
      const pick = nbrs[Math.floor(rand() * nbrs.length)];
      path.push(pick.gen);
      address = pick.address;
    }
    const far = tiling.addressToString(address);
    for (let i = path.length - 1; i >= 0; i--) {
      const want = tiling.inverseGenerator(path[i]);
      const nb = tiling.neighbours(address).find((n) => n.gen === want);
      if (!nb) {
        failures.push(`${key}: no neighbour with generator ${want}`);
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
    const { vp, tiling } = build(key, { motif: "illegal", hashColour: true });
    for (const walk of [0, 5, 500, 5000]) {
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
      `${worstRel.toFixed(1)} -- both must be independent of distance travelled`,
  });
}

// ---- 8. picking agrees with what is on screen -----------------------------------------------
//
// `tileAtScreen` must name the tile the RENDERER used, not merely a tile that geometrically contains the
// point. For word-addressed tilings those differ: {p,q} words are not canonical, so an independent
// descent can land on the same tile by a different word -- for {5,4}, "2.3" and "1.0" name one tile with
// centres agreeing to 2.8e-17. Since the artwork's colour is a hash of the ADDRESS, that shows up here
// as a wrong colour, which is exactly what caught it.
export async function checkPicking(lines) {
  let tested = 0;
  let wrong = 0;
  const failures = [];
  for (const key of KEYS) {
    const tiling0 = makeTiling(key);
    for (const far of [0, 500, 5000]) {
      const address = far
        ? (key === "binary" ? { lat: BigInt(far), lon: 0n } : walkAddress(tiling0, far, 5))
        : tiling0.originAddress();
      const { vp, tiling, canvas } = build(key, { motif: "fill", hashColour: true, clip: true, drawRadius: 0.72 });
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
          // Flat regions only: on an antialiased boundary the rendered colour is legitimately a blend.
          if (!same(col, at(x - 2, y)) || !same(col, at(x + 2, y)) ||
              !same(col, at(x, y - 2)) || !same(col, at(x, y + 2))) continue;
          const pick = vp.tileAtScreen(x, y);
          if (!pick) continue;
          tested++;
          if (!same(col, rgbOf(colourFor(pick.id)))) {
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
      `0, 500 and 5000 tiles out` + (failures.length ? `\n     ${failures.join("\n     ")}` : ""),
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
window.diagChecks = {
  groundTruth: checkGroundTruth,
  invariance: checkInvariance,
  ownership: checkOwnership,
  outsideDisk: checkOutsideDisk,
  addressRoundTrip: checkAddressRoundTrip,
  bounded: checkBounded,
  picking: checkPicking,
};

// ---- 9. SMOOTHNESS across a tile boundary -------------------------------------------------------
//
// The check the user's own report demanded, and the one the rest of the suite could not make.
//
// Panning across a tile centre forces a re-anchor, and at that instant every tile's frame may change by
// an element of the stabiliser C_m, and every word address may change too. If the art obeys the rule,
// neither is visible; if it does not, the picture snaps.
//
// Measuring it needs care, and the first two attempts were not sensitive enough:
//
//   * comparing consecutive frames of an ordinary pan buries the jump, because a pan changes a lot of
//     pixels by itself -- the illegal motif scored only 1.3x the median that way;
//   * even a sub-pixel hop is not enough: a 0.35 px shift still re-antialiases every stroke edge, which
//     came to 1,994 changed channels against 5,017 for a real jump. 2.5x is not a separation.
//
// So: BISECT to the boundary, then compare the picture at t* - eps and t* + eps with eps = 1e-4 of a
// tile spacing, i.e. about 0.01 px of motion. Now the continuous part contributes essentially nothing
// and any difference at all is the discontinuity. Each frame is rendered in a FRESH viewport, because
// re-reading one canvas across renders is not reproducible in Chrome.
//
// Includes a NEGATIVE CONTROL -- art that breaks the rule must be caught -- because this suite has
// already been burned more than once by checks that could not fail.
export async function checkSmoothness(lines, only) {
  const H = window.HyperbolicMap;
  const SZ = 240;
  const failures = [];
  const detail = [];

  // The camera at parameter t along a straight pan of one tile spacing, canonicalised: build it in a
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
    const d = tiling.metrics.centreSpacing * t;
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
  // the stabiliser. Including the rim put the flat-fill control at 2x when it should be ~1x.
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

  const cases = [];
  for (const key of only || KEYS) {
    cases.push({ key, opts: { motif: "art", hashColour: false }, mustJump: false });
    cases.push({ key, opts: { motif: "legal", hashColour: false }, mustJump: false });
    cases.push({ key, opts: { motif: "fill", hashColour: false }, mustJump: false });
    // The other half of the rule on its own: legal SHAPE, illegal address-hash colour. It must still
    // be caught, or the check is only testing shapes.
    if (key !== "binary") cases.push({ key, opts: { motif: "art", hashColour: true }, mustJump: true });
  }
  // The negative control. Not for the binary tiling: its stabiliser is trivial and its addresses are
  // canonical, so even the "illegal" motif is perfectly legal there and correctly does NOT jump.
  for (const key of (only || KEYS).filter((k) => k !== "binary").slice(0, 3)) {
    cases.push({ key, opts: { motif: "illegal", hashColour: true }, mustJump: true });
  }

  for (const { key, opts, mustJump } of cases) {
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
    const jumped = jump.n > budget;
    detail.push(`${key} ${opts.motif}${mustJump ? "*" : ""} ${jump.n}/${ctrl.n}`);
    if (jumped && !mustJump) {
      failures.push(
        `${key} (${opts.motif}): crossing the boundary changed ${jump.n} channels (worst ${jump.worst}) ` +
          `against ${ctrl.n} for the same motion elsewhere -- the picture JUMPS`,
      );
    }
    if (!jumped && mustJump) {
      failures.push(
        `${key} (${opts.motif}): NEGATIVE CONTROL FAILED -- rule-breaking art changed only ${jump.n} ` +
          `channels against a budget of ${budget}, so this check could not detect a jump`,
      );
    }
  }
  lines.push({
    ok: failures.length === 0,
    text: `9. smoothness across tile boundaries: ${cases.length - failures.length}/${cases.length} pans ` +
      `behave as required; boundary/elsewhere changed channels, * = must jump:\n     ` +
      detail.join("  ") +
      (failures.length ? `\n     ${failures.slice(0, 6).join("\n     ")}` : ""),
  });
}
