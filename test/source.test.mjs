// Data sources, with a regression test for the bug that made async providers useless.

import test from "node:test";
import assert from "node:assert/strict";

import { Isom } from "../src/core/isom.js";
import { StaticSource, CallbackSource, SourceSet } from "../src/data/source.js";
import { HyperbolicViewport } from "../src/viewport.js";

// CallbackSource invokes the provider from a microtask (Promise.resolve().then(...)), so a counter
// read immediately after get() is always one behind. Yield first.
const tick = () => new Promise((r) => setTimeout(r, 0));

// A minimal stand-in for the descriptor the surface builds.
function viewFor(matrix, { zoom = 0.95, drawRadius = 1.0, effectiveRadius = 1.0 } = {}) {
  return { matrix, zoom, drawRadius, effectiveRadius };
}

test("StaticSource compiles once and returns the same array", () => {
  const s = new StaticSource([
    { type: "path", points: [[0, 0], [1, 0], [0, 1]], closed: true, fill: "#000" },
  ]);
  const a = s.get(viewFor(Isom.identity()));
  const b = s.get(viewFor(Isom.translationToLocal(3, 4)));
  assert.equal(a.length, 1);
  assert.equal(a, b, "a static source must not recompile per view");
});

test("REGRESSION: an async provider is re-asked when the view scrolls", async () => {
  // The first implementation compared the hyperbolic distance moved against
  // 2*artanh(drawRadius). drawRadius defaults to 1.0 and artanh(1) is infinite -- the whole plane is
  // inside the disk -- so the threshold worked out to ~7.3 hyperbolic units and the provider was
  // asked exactly ONCE, at construction, no matter how far the user scrolled. Content never arrived.
  let calls = 0;
  const source = new CallbackSource(
    (req) => {
      calls++;
      return { version: 1, drawables: [] };
    },
    { throttleMs: 0 },
  );

  source.get(viewFor(Isom.identity()), 0);
  await tick();
  assert.equal(calls, 1, "should ask once at the start");

  // A modest pan: the previously requested centre slides well across the screen.
  const moved = Isom.translationToLocal(0.8, 0.4).inverse();
  source.get(viewFor(moved), 1000);
  await tick();
  assert.ok(calls >= 2, `scrolling must trigger a new request (calls = ${calls})`);
});

test("the gate is measured on screen, so it behaves at every zoom", async () => {
  let calls = 0;
  const source = new CallbackSource(() => { calls++; return { drawables: [] }; }, { throttleMs: 0 });
  source.get(viewFor(Isom.identity()), 0);
  await tick();
  const after = calls;

  // A pan far too small to matter: the old centre barely moves on screen.
  const tiny = Isom.translationToLocal(0.001, 0.0).inverse();
  source.get(viewFor(tiny), 1000);
  await tick();
  assert.equal(calls, after, "a sub-pixel pan should not trigger a request");

  // A pan of a third of the disk: it should.
  const big = Isom.translationToDisk(0.35, 0).inverse();
  source.get(viewFor(big), 2000);
  await tick();
  assert.ok(calls > after, "a third-of-a-disk pan should trigger a request");
});

test("the throttle suppresses bursts but refresh() always gets through", async () => {
  let calls = 0;
  const source = new CallbackSource(() => { calls++; return { drawables: [] }; }, { throttleMs: 500 });
  const far = viewFor(Isom.translationToDisk(0.5, 0).inverse());
  source.get(viewFor(Isom.identity()), 0);
  await tick();
  const base = calls;
  // Within the throttle window, repeated significant moves are suppressed.
  for (let t = 1; t < 400; t += 50) source.get(far, t);
  await tick();
  assert.equal(calls, base, "throttle should suppress the burst");
  // refresh() bypasses both the throttle and the gate. This is what runs at the end of a gesture, so
  // the view the user actually stopped on is never left stale.
  source.refresh(far);
  await tick();
  assert.equal(calls, base + 1, "refresh must always issue a request");
});

test("a superseded request does not overwrite a newer one", async () => {
  const resolvers = [];
  const source = new CallbackSource(
    () => new Promise((resolve) => resolvers.push(resolve)),
    { throttleMs: 0 },
  );
  source.get(viewFor(Isom.identity()), 0);
  await tick();
  source.refresh(viewFor(Isom.translationToDisk(0.4, 0).inverse()));
  await tick();
  assert.equal(resolvers.length, 2);
  // Resolve them out of order: the FIRST (superseded) one lands last and must be ignored.
  resolvers[1]({ drawables: [{ type: "path", points: [[0, 0], [1, 0], [0, 1]], closed: true }] });
  await new Promise((r) => setTimeout(r, 0));
  resolvers[0]({ drawables: [] });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(source.drawables.length, 1, "the superseded response must not clobber the newer one");
});

test("a provider that throws does not break the source", async () => {
  const errors = [];
  const source = new CallbackSource(
    () => { throw new Error("boom"); },
    { throttleMs: 0, onError: (e) => errors.push(e) },
  );
  source.get(viewFor(Isom.identity()), 0);
  await source.inFlight;
  assert.equal(errors.length, 1);
  assert.deepEqual(source.drawables, [], "should stay empty rather than crash");
});

// ---- SourceSet: the pass-producer interface shared with Atlas -------------------------------------

test("SourceSet produces render passes, one per non-empty source, in insertion order", () => {
  // The interface that lets HyperbolicViewport.render() be a single loop instead of a branch on mode:
  // a SourceSet and an Atlas both answer passes(view) with [{drawables, matrix}].
  const ss = new SourceSet({ styleSheet: { default: {} } });
  const view = viewFor(Isom.identity());
  assert.deepEqual(ss.passes(view), [], "an empty set contributes nothing");

  ss.add("a", [{ type: "path", points: [[0, 0], [0.1, 0]] }]);
  ss.add("b", [{ type: "path", points: [[0, 0], [0.2, 0]] }]);
  const passes = ss.passes(view);
  assert.equal(passes.length, 2);
  assert.ok(passes.every((p) => p.drawables && p.matrix), "a pass is {drawables, matrix}");
  // No transform means the view matrix itself, not a copy: the renderer must not be handed extra work.
  assert.equal(passes[0].matrix, view.matrix);

  // A source with nothing in it is skipped entirely rather than contributing an empty pass. That is
  // what makes the always-present "default" source free in atlas mode.
  ss.setData("a", []);
  assert.equal(ss.passes(view).length, 1);
});

test("a source's transform is composed on the RIGHT and survives setData", () => {
  // The clock demo's hands: an O(1) matrix change per tick, with the hand geometry never rebuilt.
  const ss = new SourceSet({ styleSheet: { default: {} } });
  const view = viewFor(Isom.rotation(0.3));
  ss.add("hands", [{ type: "path", points: [[0, 0], [0.2, 0]] }], { transform: Isom.rotation(0.7) });
  const withT = ss.passes(view)[0].matrix;
  assert.notEqual(withT, view.matrix, "a transformed source needs its own matrix");
  // Composed on the right: view . transform, so the drawables stay in their own frame.
  const want = view.matrix.mul(Isom.rotation(0.7));
  for (const k of ["ar", "ai", "br", "bi"]) {
    assert.ok(Math.abs(withT[k] - want[k]) < 1e-12, `transform composed on the wrong side (${k})`);
  }
  ss.setTransform("hands", Isom.rotation(1.1));
  assert.ok(Math.abs(ss.passes(view)[0].matrix.ar - view.matrix.mul(Isom.rotation(1.1)).ar) < 1e-12);
  // Replacing the data must not silently drop the transform.
  ss.setData("hands", [{ type: "path", points: [[0, 0], [0.3, 0]] }]);
  assert.notEqual(ss.passes(view)[0].matrix, view.matrix, "setData dropped the transform");
  assert.throws(() => ss.setTransform("nope", Isom.identity()), /no source named/);
});

test("SourceSet removes and destroys its sources", () => {
  let aborted = 0;
  const ss = new SourceSet({ styleSheet: { default: {} } });
  ss.add("cb", async () => ({ drawables: [] }));
  ss.entries.get("cb").source.destroy = () => { aborted++; };
  ss.remove("cb");
  assert.equal(aborted, 1, "remove() must destroy the source it drops");
  assert.equal(ss.has("cb"), false);
  ss.add("x", []);
  ss.entries.get("x").source.destroy = () => { aborted++; };
  ss.destroy();
  assert.equal(aborted, 2, "destroy() must destroy every source");
});

// ---- the mode guards ------------------------------------------------------------------------------

test("the mode guards refuse in the right mode and name the alternative", () => {
  // Three rules in one place. Exercised on the prototype with a stand-in `this`, because constructing a
  // viewport needs a DOM and these guards deliberately do not.
  const P = HyperbolicViewport.prototype;
  const atlasMode = { atlas: { anchor: { atOrigin: () => true } } };
  const singlePatch = { atlas: null };

  // requireAtlas: atlas-only methods.
  assert.throws(() => P.requireAtlas.call(singlePatch, "panToTile", "panTo()"), /panToTile\(\) requires an atlas; use panTo\(\)/);
  assert.doesNotThrow(() => P.requireAtlas.call(atlasMode, "panToTile", "panTo()"));

  // refuseInAtlasMode: single-patch-only methods.
  assert.throws(
    () => P.refuseInAtlasMode.call(atlasMode, "setData", "a source's coordinates are global"),
    /setData is not available in atlas mode -- a source's coordinates are global\. Use the atlas/,
  );
  assert.doesNotThrow(() => P.refuseInAtlasMode.call(singlePatch, "setData", "why"));

  // assertGlobalCoordinatesUsable: fine at the origin tile, refuses past it.
  assert.doesNotThrow(() => P.assertGlobalCoordinatesUsable.call(atlasMode, "panTo"));
  assert.doesNotThrow(() => P.assertGlobalCoordinatesUsable.call(singlePatch, "panTo"));
  const wandered = {
    atlas: { anchor: { atOrigin: () => false, address: "A" }, tiling: { addressToString: () => "3.1.4" } },
  };
  assert.throws(() => P.assertGlobalCoordinatesUsable.call(wandered, "panTo"), /anchored to tile 3\.1\.4/);
  assert.throws(() => P.assertGlobalCoordinatesUsable.call(wandered, "panTo"), /Use getCamera\(\)/);
});

// ---- panning must not rotate -----------------------------------------------------------------------

test("panTo/panToTile preserve the screen rotation", () => {
  // Both used to assign a bare `translationToLocal(...).inverse()`, which has screen rotation zero, so
  // any pan silently levelled the map. Invisible on a page that never rotates; on dungeon-atlas.html,
  // which opens at rotation pi because its art is drawn upside down in the cell frame, pressing "jump
  // to row" turned the whole dungeon over.
  //
  // Tested on the prototype with a stand-in `this`: panMatrix needs no DOM, and the two callers differ
  // only in which guard they run first.
  const P = HyperbolicViewport.prototype;

  // The assumption the fix rests on: the pure translation carries no rotation of its own, so
  // left-multiplying by Rot(theta) sets the total to exactly theta.
  for (const [x, y] of [[0, 0], [0.3, -1.2], [-4, 7], [120, -35]]) {
    assert.ok(
      Math.abs(Isom.translationToLocal(x, y).inverse().screenRotation()) < 1e-15,
      `translationToLocal(${x}, ${y}).inverse() should have zero screen rotation`,
    );
  }

  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  for (const theta of [0, Math.PI, 2.86, -1.1, Math.PI / 2]) {
    const self = { view: { matrix: Isom.rotation(theta) } };
    for (const [x, y] of [[0, 0], [0.3, -1.2], [-4, 7]]) {
      const m = P.panMatrix.call(self, x, y);
      // 1. the rotation is carried over...
      assert.ok(
        Math.abs(wrap(m.screenRotation() - theta)) < 1e-12,
        `pan to (${x}, ${y}) at rotation ${theta} gave ${m.screenRotation()}`,
      );
      // 2. ...and it still actually pans: the requested point lands at the centre.
      const at = m.applyToLocal(x, y, undefined, [0, 0]);
      assert.ok(
        Math.hypot(at[0], at[1]) < 1e-12,
        `pan to (${x}, ${y}) left it at ${at} instead of the centre`,
      );
    }
  }

  // NEGATIVE CONTROL: the old implementation must fail assertion 1, or the test proves nothing.
  const old = Isom.translationToLocal(0.3, -1.2).inverse();
  assert.ok(
    Math.abs(wrap(old.screenRotation() - Math.PI)) > 3,
    "the old bare-translation form should NOT preserve a pi rotation",
  );
});
