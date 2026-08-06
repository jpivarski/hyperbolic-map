// Data sources, with a regression test for the bug that made async providers useless.

import test from "node:test";
import assert from "node:assert/strict";

import { Isom } from "../src/core/isom.js";
import { StaticSource, CallbackSource } from "../src/data/source.js";

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
