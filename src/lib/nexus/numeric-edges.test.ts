import { it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  analogIntegrate, opticalInterfere, scaleAnalog,
  type AnalogMethod, type AnalogState,
} from "./math.ts";
import { canonicalJson } from "./dynamics.ts";
import type { AnalogProgram } from "./types.ts";

interface EdgeVector {
  id: string;
  kind: "step" | "interfere" | "scale";
  program: AnalogProgram;
  method: AnalogMethod;
  state: AnalogState;
  dt: number;
  chaos: number;
  drive: number;
  args: [number, number, number, number];
  expected: { error?: string; outputHash?: string };
}

const vectors: EdgeVector[] = JSON.parse(readFileSync(
  new URL("../../../contracts/nexus-numeric-edges.json", import.meta.url), "utf8",
)).vectors;

for (const v of vectors) {
  it(`numeric edge: ${v.id}`, () => {
    const evaluate = () => v.kind === "interfere" ? opticalInterfere(...v.args)
      : v.kind === "scale" ? scaleAnalog(v.program, v.state)
      : analogIntegrate(v.program, v.state, v.dt, v.chaos, v.drive, v.method);
    if (v.expected.error) {
      assert.throws(evaluate, { code: v.expected.error });
    } else {
      const hash = createHash("sha256").update(canonicalJson(evaluate())).digest("hex");
      assert.equal(hash, v.expected.outputHash);
    }
  });
}
