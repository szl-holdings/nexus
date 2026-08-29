import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analogCell, analogCoefficients, euclid, funcGenStep, lorenzStep, midiToHz, scaleLorenz, seedLorenz } from "./math.ts";
import {
  COLS,
  DEFAULT_ANALOG,
  emptyGrid,
  emptySteps,
  DEFAULT_PATCHES,
  FRONTIER_PATCHES,
  SOURCE_PORTS,
  DEST_PORTS,
} from "./types.ts";
import { canalOf, instantCycles, yarqaLeak } from "./kernel.ts";

describe("euclid", () => {
  it("Bjorklund 5/16 has five hits", () => {
    const p = euclid(5, 16, 0);
    assert.equal(p.length, 16);
    assert.equal(p.filter(Boolean).length, 5);
  });

  it("rotation preserves hit count", () => {
    const a = euclid(7, 16, 0).filter(Boolean).length;
    const b = euclid(7, 16, 3).filter(Boolean).length;
    assert.equal(a, b);
  });

  it("zero hits is silent", () => {
    assert.deepEqual(euclid(0, 8, 0), Array.from({ length: 8 }, () => false));
  });
});

describe("midiToHz", () => {
  it("A4 is 440", () => {
    assert.equal(midiToHz(69), 440);
  });
  it("A3 is 220", () => {
    assert.ok(Math.abs(midiToHz(57) - 220) < 0.001);
  });
});

describe("lorenz analog computer", () => {
  it("stays finite over a long integration", () => {
    let s = seedLorenz(0.2);
    for (let i = 0; i < 4000; i++) s = lorenzStep(s, 0.012, 0.6);
    assert.equal(Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.z), true);
    const n = scaleLorenz(s);
    assert.ok(n.x >= -1 && n.x <= 1);
    assert.ok(n.y >= -1 && n.y <= 1);
    assert.ok(n.z >= 0 && n.z <= 1);
  });

  it("chaos changes the attractor energy", () => {
    let calm = seedLorenz();
    let wild = seedLorenz();
    for (let i = 0; i < 800; i++) {
      calm = lorenzStep(calm, 0.01, 0.05);
      wild = lorenzStep(wild, 0.01, 0.95);
    }
    assert.ok(Math.abs(wild.x) + Math.abs(wild.y) > 0.5);
    assert.ok(Number.isFinite(calm.z));
  });
});

describe("function generator", () => {
  it("cycles between 0 and 1", () => {
    let v = 0;
    let up = true;
    let sawTop = false;
    let sawBottom = false;
    for (let i = 0; i < 400; i++) {
      const n = funcGenStep(v, up, 0.02, 0.2, 0.3);
      v = n.value;
      up = n.rising;
      if (v >= 0.99) sawTop = true;
      if (v <= 0.01) sawBottom = true;
    }
    assert.equal(sawTop, true);
    assert.equal(sawBottom, true);
  });
});

describe("analog coefficients and cell", () => {
  it("maps chaos onto rho between 18 and 40", () => {
    assert.equal(analogCoefficients(0).sigma, 10);
    assert.equal(analogCoefficients(0).rho, 18);
    assert.equal(analogCoefficients(1).rho, 40);
    assert.ok(Math.abs(analogCoefficients(0.5).beta - 8 / 3) < 1e-9);
  });
  it("maps unit voltages onto the 16×8 grid", () => {
    const mid = analogCell(0, 0, 16, 8);
    assert.equal(mid.col, 8);
    assert.equal(mid.row, 4);
    const corner = analogCell(-1, 1, 16, 8);
    assert.equal(corner.col, 0);
    assert.equal(corner.row, 7);
  });
});

describe("defaults", () => {
  it("grid is 16×8 with some cells lit", () => {
    const g = emptyGrid();
    assert.equal(g.length, COLS);
    assert.equal(g[0]?.length, 8);
    assert.ok(g.some((col) => col.some(Boolean)));
  });
  it("steps match columns", () => {
    assert.equal(emptySteps().length, COLS);
  });
  it("default patches only use known ports", () => {
    const ports = [...SOURCE_PORTS, ...DEST_PORTS];
    for (const p of DEFAULT_PATCHES) {
      assert.ok(ports.includes(p.from), p.from);
      assert.ok(ports.includes(p.to), p.to);
    }
  });
  it("frontier patches wire analog computer into the voice chain", () => {
    const ports = [...SOURCE_PORTS, ...DEST_PORTS];
    for (const p of FRONTIER_PATCHES) {
      assert.ok(ports.includes(p.from), p.from);
      assert.ok(ports.includes(p.to), p.to);
    }
    assert.ok(FRONTIER_PATCHES.some((p) => p.from === "anlg" && p.to === "vcf"));
    assert.ok(FRONTIER_PATCHES.some((p) => p.from === "func" && p.to === "pan"));
    assert.ok(FRONTIER_PATCHES.some((p) => p.from === "vco" && p.to === "vcf"));
    assert.ok(FRONTIER_PATCHES.some((p) => p.from === "vca" && p.to === "out"));
    assert.equal(DEFAULT_ANALOG.mode, "op");
  });
  it("default and frontier patches have no F4 instant cycle", () => {
    assert.equal(instantCycles(DEFAULT_PATCHES).length, 0);
    assert.equal(instantCycles(FRONTIER_PATCHES).length, 0);
    assert.equal(canalOf("anlg"), "voice");
    assert.equal(canalOf("func"), "voice");
    const leak = yarqaLeak(FRONTIER_PATCHES);
    assert.ok(leak > 0);
    assert.ok(leak < 1);
  });
});
