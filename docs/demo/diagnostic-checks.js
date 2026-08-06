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

// Walk the ADDRESS n tiles away. No global coordinate is formed, which is why 5000 costs the same as 1.
function walkAddress(tiling, n, seed) {
  let address = tiling.originAddress();
  let s = (seed || 991) >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < n; i++) {
    const nbrs = tiling.neighbours(address);
    address = nbrs[Math.floor(rand() * nbrs.length)].address;
  }
  return address;
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
    const { vp, tiling } = build(key, { motif: "asym", hashColour: true });
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
  let checked = 0;
  const opts = { motif: "sym", hashColour: false };
  for (const key of only || KEYS) {
    const tiling0 = makeTiling(key);
    // The binary tiling's exact symmetry is LATITUDE SHIFT: z -> 2z maps cell (lat, lon) to
    // (lat+1, lon) bijectively. It is only weakly aperiodic, so a LATERAL walk is NOT a symmetry and
    // comparing across one would be demanding something false. Regular tilings are homogeneous, so any
    // walk works.
    const addresses = key === "binary"
      ? distances.map((n) => ({ n, address: { lat: BigInt(n), lon: 0n } }))
      : distances.map((n) => ({ n, address: walkAddress(tiling0, n, 77 + n) }));

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
      `the origin view (distances ${distances.join(", ")} tiles)` +
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
    const { vp, tiling } = build(key, { motif: "asym", hashColour: true });
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

export async function runAllChecks() {
  const lines = [];
  const t0 = performance.now();
  await checkGroundTruth(lines);
  await checkInvariance(lines);
  await checkOwnership(lines);
  await checkOutsideDisk(lines);
  await checkAddressRoundTrip(lines);
  await checkBounded(lines);
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
};
