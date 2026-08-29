import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analogCell, analogCircuit, analogCoefficients, analogJack, analogStep, euclid, funcGenStep, lorenzStep, midiToHz, opticalInterfere, opticalReconstruct, scaleAnalog, scaleLorenz, seedAnalogState, seedLorenz } from "./math.ts";
import {
  ANALOG_PROGRAMS,
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
    assert.equal(DEFAULT_ANALOG.program, "lorenz");
    assert.equal(ANALOG_PROGRAMS.length, 6);
    assert.equal(ANALOG_PROGRAMS[5]?.id, "nemo");
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

describe("analog computer programs", () => {
  it("harmonic oscillator stays finite and changes sign", () => {
    let s = seedAnalogState("harmonic");
    let sawNeg = false;
    let sawPos = false;
    for (let i = 0; i < 2400; i++) s = analogStep("harmonic", s, 0.012, 0.4);
    for (let i = 0; i < 800; i++) {
      s = analogStep("harmonic", s, 0.012, 0.4);
      if (s.x < 0) sawNeg = true;
      if (s.x > 0) sawPos = true;
    }
    assert.equal(Number.isFinite(s.x) && Number.isFinite(s.y), true);
    assert.equal(sawNeg && sawPos, true);
    const n = scaleAnalog("harmonic", s);
    assert.ok(n.x >= -1 && n.x <= 1);
  });

  it("van der Pol stays bounded", () => {
    let s = seedAnalogState("vanderpol", 0.2);
    for (let i = 0; i < 3000; i++) s = analogStep("vanderpol", s, 0.01, 0.55);
    assert.ok(Math.abs(s.x) < 8 && Math.abs(s.y) < 12);
  });

  it("Duffing stays finite under drive", () => {
    let s = seedAnalogState("duffing");
    for (let i = 0; i < 2500; i++) s = analogStep("duffing", s, 0.01, 0.7, 0.8);
    assert.equal(Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.t), true);
  });

  it("Lotka-Volterra prey and predator stay positive", () => {
    let s = seedAnalogState("lotka", 0.1);
    for (let i = 0; i < 2500; i++) s = analogStep("lotka", s, 0.01, 0.45);
    assert.ok(s.x > 0 && s.y > 0);
  });

  it("NEMO analog neuromorphic core stays finite and spikes under drive", () => {
    let s = seedAnalogState("nemo", 0.2);
    assert.equal(s.bank?.length, 20);
    let resets = 0;
    let prev = s.x;
    for (let i = 0; i < 2400; i++) {
      s = analogStep("nemo", s, 0.002, 0.45, 0.92);
      if (s.x < prev - 20) resets++;
      prev = s.x;
    }
    assert.equal(Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.z), true);
    assert.ok(resets > 8, `expected spikes, got ${resets}`);
    assert.equal(s.bank?.length, 20);
    const n = scaleAnalog("nemo", s);
    assert.ok(n.x >= -1 && n.x <= 1);
    assert.ok(n.y >= -1 && n.y <= 1);
    assert.ok(n.z >= 0 && n.z <= 1);
    const weights = (s.bank ?? []).slice(15, 20);
    assert.ok(weights.every((v) => v >= 0.05 && v <= 4), `STDP weights out of range ${weights.join(",")}`);
  });

  it("NEMO three-factor optical STDP is gated by Drive", () => {
    const run = (drive: number) => {
      let s = seedAnalogState("nemo", 0.2);
      for (let i = 0; i < 1800; i++) s = analogStep("nemo", s, 0.002, 0.45, drive);
      const w = (s.bank ?? []).slice(15, 20);
      return w.reduce((a, b) => a + Math.abs(b - 1), 0) / 5;
    };
    const quiet = run(0);
    const driven = run(0.95);
    assert.ok(driven > quiet + 0.002, `3-factor should move more under Drive, quiet ${quiet.toFixed(4)} driven ${driven.toFixed(4)}`);
  });

  it("NEMO synaptic traces decay with no drive", () => {
    let s = seedAnalogState("nemo");
    const bank = (s.bank ?? []).slice();
    for (let i = 10; i < 15; i++) bank[i] = 12;
    s = { ...s, bank };
    for (let i = 0; i < 80; i++) s = analogStep("nemo", s, 0.002, 0, 0);
    const traces = (s.bank ?? []).slice(10, 15);
    assert.ok(traces.every((v) => v < 8), `traces should leak, got ${traces.join(",")}`);
    assert.ok(s.x < 0, "membrane should rest subthreshold without drive");
  });

  it("NEMO pads a 15-cell bank and optical STDP leaks toward 1", () => {
    let s = seedAnalogState("nemo");
    s = { ...s, bank: (s.bank ?? []).slice(0, 15) };
    s = analogStep("nemo", s, 0.002, 0, 0);
    assert.equal(s.bank?.length, 20);
    const loaded = (s.bank ?? []).slice();
    for (let i = 15; i < 20; i++) loaded[i] = 2.6;
    loaded[0] = -80;
    s = { ...s, bank: loaded };
    for (let i = 0; i < 120; i++) s = analogStep("nemo", s, 0.002, 0, 0);
    const weights = (s.bank ?? []).slice(15, 20);
    assert.ok(weights.every((v) => v < 2.6 && v > 0.05), `weights should leak toward 1, got ${weights.join(",")}`);
  });

  it("NEMO YUYAY pacemaker fires more under Drive than at rest", () => {
    const spikes = (drive: number) => {
      let s = seedAnalogState("nemo", 0.2);
      let prev = s.bank![1]!;
      let n = 0;
      for (let i = 0; i < 1800; i++) {
        s = analogStep("nemo", s, 0.002, 0.4, drive);
        const v = s.bank![1]!;
        if (v < prev - 20) n++;
        prev = v;
      }
      return n;
    };
    const quiet = spikes(0);
    const paced = spikes(0.95);
    assert.ok(paced > quiet + 2, `YUYAY pacemaker should spike more under Drive, quiet ${quiet} paced ${paced}`);
  });

  it("NEMO YAWAR traveling wave carries YACHAY depolarization to YUYAY first", () => {
    let s = seedAnalogState("nemo");
    const bank = (s.bank ?? []).slice();
    for (let i = 0; i < 5; i++) {
      bank[i] = -70;
      bank[5 + i] = 0;
      bank[10 + i] = 0;
    }
    bank[0] = -55;
    s = { ...s, bank, t: 0, z: 0 };
    for (let i = 0; i < 4; i++) s = analogStep("nemo", s, 0.002, 0, 0);
    const yuyay = s.bank![1]!;
    const otel = s.bank![3]!;
    const khipu = s.bank![4]!;
    assert.ok(yuyay > otel + 0.6, `wave should hit YUYAY before OTel, YUYAY ${yuyay.toFixed(2)} OTel ${otel.toFixed(2)}`);
    assert.ok(yuyay > khipu + 0.6, `wave should hit YUYAY before KHIPU, YUYAY ${yuyay.toFixed(2)} KHIPU ${khipu.toFixed(2)}`);
  });
});

describe("optical analog inner product", () => {
  it("constructive interference is (Ao+Ar)^2", () => {
    const I = opticalInterfere(0.6, 0, 0.4, 0);
    assert.ok(Math.abs(I - 1) < 1e-9);
  });
  it("destructive interference is (Ao-Ar)^2", () => {
    const I = opticalInterfere(0.6, 0, 0.4, Math.PI);
    assert.ok(Math.abs(I - 0.04) < 1e-9);
  });
  it("reconstruction is signed and finite", () => {
    const I = opticalInterfere(0.7, 0.3, 0.5, 1.1);
    const r = opticalReconstruct(I, 0.3 - 1.1);
    assert.equal(Number.isFinite(r), true);
    assert.ok(r >= -1 && r <= 1);
  });
});

describe("analog computing circuits", () => {
  it("multiplier is analog product and inverter negates", () => {
    const c = analogCircuit(0.5, -0.4, 0.2);
    assert.ok(Math.abs(c.mul - -0.2) < 1e-9);
    assert.ok(Math.abs(c.inv - -0.5) < 1e-9);
    assert.equal(c.cmp, 1);
    assert.equal(analogCircuit(-0.2, 0, 0).cmp, -1);
  });
  it("ANLG jack summers integrator, multiplier, and reconstruct", () => {
    const c = analogCircuit(0.8, 0.5, 0);
    const quiet = analogJack(c, 0, 0);
    const driven = analogJack(c, 0.6, 1);
    assert.ok(Math.abs(quiet - 0.8 * 0.55) < 1e-9);
    assert.ok(driven > quiet);
    assert.ok(driven >= -1 && driven <= 1);
  });
});
