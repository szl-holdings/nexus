import assert from "node:assert/strict";
import { test } from "node:test";
import { restoreGrid } from "./persistence-grid.ts";
import { COLS, ROWS, emptyGrid } from "./types.ts";

test("copies a valid grid without retaining persisted array references", () => {
  const original = emptyGrid();
  const restored = restoreGrid(original);
  assert.deepEqual(restored, original);
  assert.notEqual(restored, original);
  assert.notEqual(restored?.[0], original[0]);
  restored![0]![0] = !original[0]![0];
  assert.notDeepEqual(restored, original);
});

test("valid all-dark grids are data, not malformed records", () => {
  const dark = Array.from({ length: COLS }, () => Array<boolean>(ROWS).fill(false));
  assert.deepEqual(restoreGrid(dark), dark);
  // This tests the decoder only. Hydrate and powerOn still apply their existing
  // lit-pattern fallback policy; changing that policy is deliberately deferred.
});

test("missing, empty, non-array and wrong-width grids are rejected", () => {
  for (const raw of [undefined, null, {}, false, "grid", [], [false], Array(COLS - 1)]) {
    assert.equal(restoreGrid(raw), null);
  }
});

test("malformed columns and cells never reach engine array operations", () => {
  for (const column of [null, {}, "00000000", [], Array(ROWS - 1).fill(false),
    Array(ROWS + 1).fill(false), Array(ROWS).fill(0), Array(ROWS).fill("false")]) {
    const raw: unknown[] = emptyGrid();
    raw[4] = column;
    assert.equal(restoreGrid(raw), null);
  }
});

test("sparse persisted arrays cannot pass structural validation", () => {
  assert.equal(restoreGrid(Array(COLS)), null);
  const raw: unknown[] = emptyGrid();
  raw[2] = Array(ROWS);
  assert.equal(restoreGrid(raw), null);
});

test("valid reconstruction does not mutate or repair the persisted source", () => {
  const original = Object.freeze(emptyGrid().map((column) => Object.freeze(column)));
  assert.deepEqual(restoreGrid(original), original);
});
