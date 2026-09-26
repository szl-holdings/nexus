import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  ANALOG_METHOD_SUPPORT,
  ANALOG_METHOD_VERSIONS,
  ANALOG_MODEL_VERSIONS,
  AnalogEngineError,
  analogCoefficients,
  analogIntegrate,
  analogStep,
  seedAnalogState,
  type AnalogMethod,
} from "./math.ts";
import {
  canonicalJson,
  canonicalNumber,
  dynamicsInputPayload,
  dynamicsOutput,
  immuneV1Output,
  normalizeDynamicsInput,
  pyRound,
} from "./dynamics.ts";
import type { AnalogProgram } from "./types.ts";

/**
 * TS half of contracts/nexus-parity-v2.json. The Python binding
 * (python/nexus_dynamics) generated every expected hash; this file recomputes
 * all of them from math.ts + dynamics.ts. Any drift between the bindings fails.
 */
interface ParityVector {
  id: string;
  method: AnalogMethod;
  input: Record<string, unknown>;
  expected: { inputHash: string; outputHash?: string; error?: string };
}

const doc = JSON.parse(
  readFileSync(new URL("../../../contracts/nexus-parity-v2.json", import.meta.url), "utf8"),
);
const vectors: ParityVector[] = doc.vectors;
const sha256 = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
const PROGRAMS: AnalogProgram[] = ["lorenz", "harmonic", "vanderpol", "duffing", "lotka", "nemo"];

describe("nexus parity v2: TS == Python", () => {
  it("covers every program and every supported method", () => {
    assert.equal(doc.schema, "szl.nexus-parity-vectors/v2");
    assert.ok(vectors.length >= 60, `only ${vectors.length} vectors`);
    for (const program of PROGRAMS) {
      for (const method of ANALOG_METHOD_SUPPORT[program]) {
        assert.ok(
          vectors.some(
            (v) => v.input.program === program && v.method === method && v.expected.outputHash,
          ),
          `${program}/${method} has no output vector`,
        );
      }
    }
  });

  it("declares the same method/model versions and support matrix as math.ts", () => {
    assert.deepEqual(doc.integration.methods, ANALOG_METHOD_VERSIONS);
    assert.deepEqual(doc.integration.models, ANALOG_MODEL_VERSIONS);
    assert.deepEqual(doc.integration.method_support, ANALOG_METHOD_SUPPORT);
  });

  for (const vector of vectors) {
    it(`${vector.id}`, () => {
      const input = normalizeDynamicsInput(vector.input);
      assert.equal(
        sha256(dynamicsInputPayload(input, vector.method)),
        vector.expected.inputHash,
        "inputHash",
      );
      if (vector.expected.error) {
        assert.throws(
          () => dynamicsOutput(input, vector.method),
          (error: unknown) =>
            error instanceof AnalogEngineError && error.code === vector.expected.error,
        );
      } else {
        assert.equal(
          sha256(dynamicsOutput(input, vector.method)),
          vector.expected.outputHash,
          "outputHash",
        );
      }
    });
  }
});

describe("IMMUNE parity v1 (provenance) from the instrument engine", () => {
  const immune = doc.provenance.immune_v1;
  for (const program of PROGRAMS) {
    it(`${program} reproduces IMMUNE's published hash`, () => {
      const v = immune.input;
      const nemo = program === "nemo";
      const input = normalizeDynamicsInput({
        program,
        mode: v.mode,
        steps: nemo ? v.steps_nemo : v.steps_standard,
        dt: nemo ? v.dt_nemo : v.dt_standard,
        chaos: v.chaos,
        drive: v.drive,
        seed: v.seed,
        repeatEvery: v.repeatEvery,
        axes: v.axes,
      });
      assert.equal(sha256(immuneV1Output(input)), immune.output_hashes[program]);
    });
  }
});

describe("canonical projection is Python-exact", () => {
  it("formats every fixture exactly like Python format(x, '.9f')", () => {
    for (const [value, expected] of doc.canonical_number_vectors as Array<[number, string]>) {
      assert.equal(canonicalNumber(value), expected, `value ${value}`);
    }
  });

  it("differs from toFixed on exact binary ties (why toFixed is not used)", () => {
    assert.equal((0.0009765625).toFixed(9), "0.000976563");
    assert.equal(canonicalNumber(0.0009765625), "0.000976562");
    assert.equal((1e21).toFixed(9), "1e+21");
    assert.equal(canonicalNumber(1e21), "1000000000000000000000.000000000");
  });

  it("pyRound(x, 12) equals Python round(x, 12)", () => {
    for (const [value, expected] of doc.round12_vectors as Array<[number, number]>) {
      assert.equal(pyRound(value, 12), expected, `value ${value}`);
    }
  });

  it("never serializes NaN or Infinity", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      assert.throws(
        () => canonicalJson({ x: bad }),
        (e: unknown) => e instanceof AnalogEngineError && e.code === "NON_FINITE_OUTPUT",
      );
    }
  });
});

describe("F-05 Lotka-Volterra beta", () => {
  it("integrates with the labelled beta (model lotka/2)", () => {
    for (const c of [0, 0.25, 0.45, 0.8, 1]) {
      const pots = analogCoefficients(c, "lotka");
      assert.equal(pots.beta, 0.42 + c * 0.7);
      assert.ok(pots.label.endsWith(`β ${pots.beta.toFixed(2)}`), pots.label);
    }
    assert.equal(ANALOG_MODEL_VERSIONS.lotka, "lotka/2");
    assert.equal(doc.intentional_changes[0].id, "F-05");
  });

  it("other programs keep β = 8/3 where it is used", () => {
    assert.equal(analogCoefficients(0.5, "lorenz").beta, 8 / 3);
  });
});

describe("NON_FINITE_OUTPUT", () => {
  it("strict integration throws instead of serializing NaN/Infinity", () => {
    const huge = { x: 1e200, y: -1e200, z: 1e200, t: 0 };
    assert.throws(
      () => analogIntegrate("lorenz", huge, 0.08, 1, 0.5, "rk4"),
      (e: unknown) => e instanceof AnalogEngineError && e.code === "NON_FINITE_OUTPUT",
    );
    assert.throws(
      () =>
        analogIntegrate("vanderpol", { x: 1e300, y: 1e300, z: 0, t: 0 }, 0.08, 1, 0.5, "euler4"),
      (e: unknown) => e instanceof AnalogEngineError && e.code === "NON_FINITE_OUTPUT",
    );
    assert.throws(
      () => analogIntegrate("duffing", { x: NaN, y: 0, z: 0, t: 0 }, 0.01, 0.5),
      (e: unknown) => e instanceof AnalogEngineError && e.code === "NON_FINITE_NUMBER",
    );
  });

  it("the audio instrument still reseeds instead of dying", () => {
    const huge = { x: 1e200, y: -1e200, z: 1e200, t: 0 };
    assert.deepEqual(analogStep("lorenz", huge, 0.08, 1, 0.5), seedAnalogState("lorenz"));
  });

  it("unsupported methods fail closed", () => {
    assert.throws(
      () => analogIntegrate("nemo", seedAnalogState("nemo"), 0.01, 0.5, 0.5, "rk4"),
      (e: unknown) => e instanceof AnalogEngineError && e.code === "UNSUPPORTED_METHOD",
    );
    assert.throws(
      () => analogIntegrate("lotka", seedAnalogState("lotka"), 0.01, 0.5, 0.5, "symplectic"),
      (e: unknown) => e instanceof AnalogEngineError && e.code === "UNSUPPORTED_METHOD",
    );
  });
});
