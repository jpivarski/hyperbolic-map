# The 2011 client, decoded

Source: `OLD/hyperbolic-storage-space/WebContent/HyperbolicViewport.js` (1000 lines), plus the Java
server in `OLD/hyperbolic-storage-space/src/org/hyperbolicstorage/` and the Python tools in
`svgtools/`. Verification status of every formula is in `math-audit.md`; this file is about *semantics*
and traps.

## Architecture

One file, prototype-based, `var` everywhere, no modules and no CSS. Three "service" classes supplying
drawables (`HyperbolicMapServlet` over `XMLHttpRequest`, `HyperbolicMapStatic` from an array, and a
per-example subclass in `clock.html`) and one `HyperbolicViewport` doing math, rendering, input and
option handling.

The client↔server protocol was `GET <url>?Bx=<offsetReal>&By=<offsetImag>&a=<downloadThreshold>`
returning a bare JSON array of drawables. It fetched **synchronously** on first draw and
**asynchronously on `mouseup`/`touchend` only** — which is the entire cause of "distant elements only
appear when you let go".

## Semantic traps

These cost real time; read them before touching the corresponding code.

- **`finger1Real`/`finger1Imag` is a *view-frame* point, not a data point.** On `mousedown` inside the
  interaction radius it stores `x/sqrt(1−x²−y²)` where `(x,y)` is the *screen* position in disk
  coordinates — i.e. the local-coordinate form of where the cursor is, not of what is under it.
  `updateCoordinates` then computes the *change* in offset that carries that view-frame point to the
  new cursor position, and composes it with the committed `(B, R)`. Modelling it as a data point makes
  a correct solver look catastrophically broken.
- **In the rim-rotation branch the same field means something different**: `finger1Real = x` raw,
  undivided, because only its angle is used.
- **`this.zoom` vs `this.zoomNow`.** `zoom`/`offsetReal`/`offsetImag`/`rotation` are the *committed*
  values; the `*Now` variants are live during a gesture. `draw()` uses `zoomNow`, but
  `mousePosition()` divides by `zoom` — so wheel-zooming mid-drag desynchronises pointer mapping from
  rendering.
- **`halfPlaneOrientation()` reads `rotationCosNow`/`rotationSinNow`, which are only assigned inside
  `draw()`** — so it sees the *previous* frame's rotation. This looks like a bug and is not: the stale
  rotation cancels algebraically in the compass update (verified, no drift over 8 uncommitted moves).
- **The disk is sized by `canvas.width` on both axes.** Not `min(width, height)`. Consistent between
  drawing and hit-testing, so it is correct, but on a non-square canvas the disk overflows vertically.
  Changing this is a behaviour change, not a fix.
- **`while (drawable = this.service.nextDrawable())`** — any falsy element silently truncates the
  stream.

## Bug inventory

With file:line. Verification evidence in `math-audit.md`.

| location | bug |
|---|---|
| `:256,280,301` | **the stuck drag** — `mousedown`/`mousemove`/`mouseup` are all on the canvas, so releasing outside it never clears `isMouseScrolling` |
| `:637` | pan is *gated* on `x²+y² < viewThreshold²`, so dragging past the rim **freezes** instead of clamping — and then resumes where it froze. This compounds the stuck-drag symptom |
| `:539-546` | `pageX − canvas.offsetLeft` (wrong when nested or scrolled) and the committed-vs-live zoom desync |
| `:3-23` | `halfPlane_to_hyperShadow` double cancellation: returns exactly 0 near the basepoint |
| `:790` | polygon culling tests only the two endpoints, dropping long crossing edges — and it runs *after* all the projection work |
| `:846-879` | `save()` → build path → `clip()` → rebuild the identical path → `fill()` → `restore()`. `fill ∩ clip == fill`, so the clip is a **no-op**, and the path is built twice |
| `:926` | `pointRadius = drawable["pointFill"]` → `NaN` radius → all vertex dots silently vanish |
| `:167` | `MAX_STRAIGHT_LINE_LENGTH = 0.1` is zoom-independent; ~93 px at the dungeon's `initialZoom: 3` |
| `:684-689` | `allowZoom`/`allowRotate` are consulted **only** in the two-finger path, so they do not gate the wheel or rim rotation |
| `:656-676` | `updateZoom` never re-requests data, so LOD-gated content does not appear on zoom until the next mouseup |
| `:678-708` | pinch uses arithmetic means of local coordinates and of screen coordinates instead of hyperbolic midpoints |
| `:939-978` | text is a `ctx.scale()` on a `14pt` font, so `MIN_TEXT_SIZE` is a unitless scale; `ctx.scale` also scales strokes and defeats hinting |
| `:213` | `this.backgroundImage == null;` — `==` where `=` was meant |
| `:347`, `:589-591` | missing `var` → implicit globals (`viewThreshold2`, `px`, `py`, `pc`) |
| `:326-327` | `stopPropagation()` followed by `cancelBubble = false` — contradictory |
| `GeographicalTiles.java:75-81` | `hyperShadow_to_halfPlane` divides by zero at `y ≳ 10⁴`, inside the dungeon's range, and silently (Java gives `Infinity`) |
| `GeographicalTiles.java:124-137` | `longitudeRange` samples the band bottom; misses 45.8 % of visible cells |
| `GeographicalTiles.java:228,230` | dungeon room-number `ax/ay` ↔ `upx/upy` swapped. Note `:185,187` (grid text) is **correct** |
| `clock.html:106-111` | `updateTime()` re-registers `setInterval` every tick → `60n` timers after `n` minutes |
| all four example pages | no `devicePixelRatio`, fixed `width`/`height`, no resize handling |

## Original option defaults

For the compatibility shim and the alias table (`HyperbolicViewport.js:537`):

```js
{initialOffsetX: 0.0, initialOffsetY: 0.0, initialZoom: 0.95, initialRotation: 0.0,
 allowRotate: true, rotationMode: "parallel-transport", allowZoom: true, zoomMouseWheel: 1.10,
 minZoom: 0.5, maxZoom: null, viewThreshold: 0.9, downloadThreshold: 0.95,
 rimStrokeStyle: "#000000", rimFillStyle: "#f5d6ab", backgroundColor: "#ffffff",
 backgroundImage: null, shellImage: null, shellImageScale: 1.0}
```

Constants: `MAX_STRAIGHT_LINE_LENGTH = 0.1`, `FONT_SCALE = 0.05`, `MIN_TEXT_SIZE = 0.5`.

Per-example options are recorded in `data-extraction.md` alongside each dataset.
