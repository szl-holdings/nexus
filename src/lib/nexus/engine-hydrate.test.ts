/**
 * NEX-01 wiring: the real `engine.hydrate()` and `engine.loadScene()` callers
 * route persisted grids through `restoreGrid`, whichever store the record came
 * from. Fake IndexedDB/localStorage only; no browser storage is exercised.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
  fakeIndexedDB,
  fakeLocalStorage,
  loadEngineHarness,
  type Harness,
} from "./engine-test-harness.ts";
import { savePersisted } from "./store.ts";
import { COLS, ROWS, SCENE_COUNT, emptyGrid } from "./types.ts";

let h: Harness;
before(async () => {
  h = await loadEngineHarness();
});

/** A lit grid that differs from the default pattern. */
function diagonalGrid(): boolean[][] {
  return Array.from({ length: COLS }, (_, c) =>
    Array.from({ length: ROWS }, (_, r) => r === c % ROWS),
  );
}

function darkGrid(): boolean[][] {
  return Array.from({ length: COLS }, () => Array<boolean>(ROWS).fill(false));
}

/**
 * Grids with one malformed column ahead of the first lit column. The pre-fix
 * hydrate scanned columns with `col.some(...)` and threw on the non-array ones;
 * the others were accepted into the snapshot as if they were valid.
 */
function malformedGrids(): unknown[] {
  const columns: unknown[] = [
    null,
    "00000000",
    {},
    Array(ROWS - 1).fill(false),
    Array(ROWS).fill(0),
    Array(ROWS),
  ];
  return columns.map((column) => {
    const grid: unknown[] = diagonalGrid().map((col, c) => (c < 5 ? col.map(() => false) : col));
    grid[2] = column;
    return grid;
  });
}

function record(grid: unknown, extra: Record<string, unknown> = {}) {
  return { v: 5, grid, master: 0.41, ...extra };
}

async function hydrateFromIndexedDB(value: unknown) {
  h.setStorage({ indexedDB: fakeIndexedDB(value), localStorage: fakeLocalStorage() });
  const engine = h.newEngine();
  await engine.hydrate();
  return engine;
}

describe("engine.hydrate grid restore (NEX-01)", () => {
  it("restores a valid persisted grid as a fresh copy", async () => {
    const saved = record(diagonalGrid());
    const engine = await hydrateFromIndexedDB(saved);
    const { grid, master } = engine.getSnapshot();
    assert.deepEqual(grid, diagonalGrid());
    assert.notEqual(grid, saved.grid);
    assert.notEqual(grid[0], (saved.grid as boolean[][])[0]);
    assert.equal(master, 0.41);
  });

  it("falls back to the default pattern for a malformed nested grid instead of throwing", async () => {
    for (const grid of malformedGrids()) {
      const engine = await hydrateFromIndexedDB(record(grid));
      const snap = engine.getSnapshot();
      assert.deepEqual(snap.grid, emptyGrid());
      // The rest of the record still hydrates: only the grid is rejected.
      assert.equal(snap.master, 0.41);
    }
  });

  it("rejects a wrong-width or non-array grid without discarding the record", async () => {
    for (const grid of [undefined, null, "grid", {}, [], diagonalGrid().slice(1)]) {
      const engine = await hydrateFromIndexedDB(record(grid));
      assert.deepEqual(engine.getSnapshot().grid, emptyGrid());
      assert.equal(engine.getSnapshot().master, 0.41);
    }
  });

  it("routes the localStorage fallback (IndexedDB open fails) through the same decoder", async () => {
    for (const [grid, expected] of [
      [malformedGrids()[0], emptyGrid()],
      [diagonalGrid(), diagonalGrid()],
    ] as const) {
      h.setStorage({
        indexedDB: fakeIndexedDB(undefined, { failOpen: true }),
        localStorage: fakeLocalStorage({ "nexus-v1": JSON.stringify(record(grid)) }),
      });
      const engine = h.newEngine();
      await engine.hydrate();
      assert.deepEqual(engine.getSnapshot().grid, expected);
      assert.equal(engine.getSnapshot().master, 0.41);
    }
  });

  it("keeps the existing lit-pattern fallback for an all-dark grid (product policy unchanged)", async () => {
    // A valid all-dark grid decodes as data (see persistence-grid.test.ts), but
    // hydrate still replaces it with the default pattern. Whether silence
    // should persist is an open product decision; this pins today's behavior.
    const engine = await hydrateFromIndexedDB(record(darkGrid()));
    assert.deepEqual(engine.getSnapshot().grid, emptyGrid());
  });
});

describe("engine.loadScene grid restore (NEX-01)", () => {
  function scene(grid: unknown, orbit: number) {
    return {
      voice: {},
      tape: {},
      seq: {},
      analog: {},
      steps: [],
      grid,
      patches: [],
      orbit,
      scopeMode: "yt",
    };
  }

  async function engineWithScenes(scenes: unknown[]) {
    const padded = Array.from({ length: SCENE_COUNT }, (_, i) => scenes[i] ?? null);
    return hydrateFromIndexedDB(record(diagonalGrid(), { scenes: padded }));
  }

  it("keeps the current grid when a persisted scene grid is malformed", async () => {
    const scenes = malformedGrids().map((grid, i) => scene(grid, 0.1 + i / 100));
    const engine = await engineWithScenes(scenes);
    for (let slot = 0; slot < scenes.length; slot++) {
      assert.doesNotThrow(() => engine.loadScene(slot));
      const snap = engine.getSnapshot();
      assert.deepEqual(snap.grid, diagonalGrid());
      assert.equal(snap.sceneSlot, slot);
      // The rest of the scene still loads.
      assert.equal(snap.orbit, 0.1 + slot / 100);
    }
  });

  it("restores a valid scene grid as a copy that does not alias the stored scene", async () => {
    const stored = darkGrid();
    stored[3]![2] = true;
    const engine = await engineWithScenes([scene(stored, 0.2)]);
    engine.loadScene(0);
    const { grid, scenes } = engine.getSnapshot();
    assert.deepEqual(grid, stored);
    const sceneGrid = (scenes[0] as { grid: boolean[][] }).grid;
    assert.notEqual(grid, sceneGrid);
    assert.notEqual(grid[3], sceneGrid[3]);
  });
});

describe("persistence fallback symmetry (NEX-01)", () => {
  it("restores from localStorage when IndexedDB is absent, where the save path writes", async () => {
    const storage = fakeLocalStorage();
    h.setStorage({ indexedDB: undefined, localStorage: storage });
    const writer = h.newEngine();
    await savePersisted({ ...writer.persistNow(), master: 0.33, grid: diagonalGrid() });
    assert.ok(storage.data.has("nexus-v1"), "save path wrote the localStorage fallback");

    const reader = h.newEngine();
    await reader.hydrate();
    assert.equal(reader.getSnapshot().master, 0.33);
    assert.deepEqual(reader.getSnapshot().grid, diagonalGrid());
  });

  it("still routes that localStorage record through the grid decoder", async () => {
    const [malformed] = malformedGrids();
    h.setStorage({
      indexedDB: undefined,
      localStorage: fakeLocalStorage({ "nexus-v1": JSON.stringify(record(malformed)) }),
    });
    const engine = h.newEngine();
    await engine.hydrate();
    assert.deepEqual(engine.getSnapshot().grid, emptyGrid());
    assert.equal(engine.getSnapshot().master, 0.41);
  });
});
