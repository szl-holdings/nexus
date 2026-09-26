/**
 * NEXUS dynamics: deterministic runs and canonical hashing (TypeScript binding).
 *
 * The Python binding is python/nexus_dynamics (stdlib only). Both bindings must
 * produce identical hashes for every vector in contracts/nexus-parity-v2.json
 * (enforced by src/lib/nexus/parity.test.ts and python/tests/test_parity.py).
 *
 * Canonical hashing is IMMUNE's `nexus_hash`: every number is projected to a
 * string with exactly nine decimals, object keys are sorted, and the compact
 * JSON is hashed with SHA-256. Python formats with `format(x, ".9f")`, which
 * rounds the exact binary value half-to-even; `Number.prototype.toFixed` rounds
 * exact ties up and switches to exponent notation at 1e21, so this module
 * formats from the exact binary expansion instead. A non-finite number throws
 * NON_FINITE_OUTPUT: NaN/Infinity is never serialized.
 *
 * Browser-safe (no node: imports). Callers hash `canonicalJson(...)` with
 * SHA-256 (node:crypto in tests, WebCrypto in the browser).
 *
 * Executable software simulation, not a physical chip. Energy UNAVAILABLE.
 * Λ uniqueness is Conjecture 1 (OPEN).
 */
import type { AnalogProgram } from "./types.ts";
import {
  ANALOG_METHOD_VERSIONS,
  ANALOG_MODEL_VERSIONS,
  AnalogEngineError,
  analogCircuit,
  analogCorrelate,
  analogIntegrate,
  analogJack,
  assertAnalogMethod,
  opticalInterfere,
  opticalReconstruct,
  scaleAnalog,
  seedAnalogState,
  type AnalogMethod,
  type AnalogState,
} from "./math.ts";

export const DYNAMICS_INPUT_SCHEMA = "szl.nexus-dynamics-input/v2";
export const DYNAMICS_OUTPUT_SCHEMA = "szl.nexus-dynamics-output/v2";
export const IMMUNE_V1_PARITY_SCHEMA = "szl.immune-nexus-parity/v1";
export const IMMUNE_V1_SOURCE_REVISION = "617fb49f061c9eb369c4d879a7c29af64c08e72e";
export const CANONICAL_DECIMAL_PLACES = 9;

const PROGRAMS: readonly AnalogProgram[] = [
  "lorenz",
  "harmonic",
  "vanderpol",
  "duffing",
  "lotka",
  "nemo",
];
export const DYNAMICS_MODES = ["IC", "OP", "HALT", "REP"] as const;
export type DynamicsMode = (typeof DYNAMICS_MODES)[number];

const STEPS_MAX = 2400;
const NEMO_STEPS_MAX = 400;
const MAX_TRAIL_POINTS = 256;
const REPEAT_NUDGE = 0.137;
const TRUST_CEILING = 0.97;
const INPUT_FIELDS = [
  "program",
  "mode",
  "steps",
  "dt",
  "chaos",
  "drive",
  "seed",
  "repeatEvery",
  "state",
  "axes",
];
const REQUIRED_INPUT_FIELDS = [
  "program",
  "mode",
  "steps",
  "dt",
  "chaos",
  "drive",
  "seed",
  "repeatEvery",
];
const STATE_FIELDS = ["x", "y", "z", "t", "bank"];

export interface DynamicsState {
  x: number;
  y: number;
  z: number;
  t: number;
  bank?: number[];
}

/** Engine input of contracts/immune-nexus.v1.json (without the actor/requestId envelope). */
export interface DynamicsInput {
  program: AnalogProgram;
  mode: DynamicsMode;
  steps: number;
  dt: number;
  chaos: number;
  drive: number;
  seed: number;
  repeatEvery: number;
  state?: DynamicsState;
  axes?: number[];
}

// ---------------------------------------------------------------- canonical

function decompose(value: number): { negative: boolean; mantissa: bigint; exponent: number } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const negative = hi >>> 31 === 1;
  const exponentBits = (hi >>> 20) & 0x7ff;
  let mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let exponent = -1074;
  if (exponentBits !== 0) {
    mantissa |= 1n << 52n;
    exponent = exponentBits - 1075;
  }
  return { negative, mantissa, exponent };
}

/**
 * Python `format(value, f".{digits}f")`: fixed notation of the exact binary
 * value, rounded half-to-even, sign kept (so -1e-10 gives "-0.000000000").
 */
export function formatFixed(value: number, digits: number): string {
  if (!Number.isFinite(value))
    throw new AnalogEngineError(
      "NON_FINITE_OUTPUT",
      "canonical projection produced a non-finite value",
    );
  if (!Number.isInteger(digits) || digits < 0 || digits > 100)
    throw new RangeError("digits must be an integer in 0..100");
  const { negative, mantissa, exponent } = decompose(value);
  const scale = 10n ** BigInt(digits);
  let q: bigint;
  if (exponent >= 0) {
    q = (mantissa << BigInt(exponent)) * scale;
  } else {
    const numerator = mantissa * scale;
    const shift = BigInt(-exponent);
    q = numerator >> shift;
    const remainder = numerator - (q << shift);
    const half = 1n << (shift - 1n);
    if (remainder > half || (remainder === half && (q & 1n) === 1n)) q += 1n;
  }
  const text = q.toString().padStart(digits + 1, "0");
  const integerPart = text.slice(0, text.length - digits);
  const fraction = text.slice(text.length - digits);
  return `${negative ? "-" : ""}${integerPart}${digits > 0 ? `.${fraction}` : ""}`;
}

/** Python `round(value, digits)` for floats (correctly rounded, half-to-even). */
export function pyRound(value: number, digits: number): number {
  return Number(formatFixed(value, digits));
}

export function canonicalNumber(value: number): string {
  return formatFixed(value === 0 ? 0 : value, CANONICAL_DECIMAL_PLACES);
}

export function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return canonicalNumber(value);
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) out[key] = canonicalize(record[key]);
    return out;
  }
  throw new AnalogEngineError(
    "INVALID_REQUEST",
    `cannot canonicalize value of type ${typeof value}`,
  );
}

/** The exact UTF-8 text IMMUNE / nexus_dynamics hash with SHA-256. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

// ---------------------------------------------------------------- validation

function fail(code: string, message: string): never {
  throw new AnalogEngineError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(name: string, value: unknown): number {
  if (typeof value !== "number") fail("NON_FINITE_NUMBER", `${name} must be a JSON number`);
  if (!Number.isFinite(value)) fail("NON_FINITE_NUMBER", `${name} must be finite`);
  return value;
}

function numberInRange(name: string, value: unknown, min: number, max: number): number {
  const number = finiteNumber(name, value);
  if (number < min || number > max)
    fail("OUT_OF_RANGE", `${name} must be between ${min} and ${max}`);
  return number;
}

function integerInRange(name: string, value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    fail("OUT_OF_RANGE", `${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function normalizeState(program: AnalogProgram, raw: unknown): DynamicsState {
  if (!isRecord(raw)) fail("INVALID_STATE", "state must be an object");
  const extras = Object.keys(raw)
    .filter((key) => !STATE_FIELDS.includes(key))
    .sort();
  if (extras.length)
    fail("UNSUPPORTED_STATE_FIELD", `unsupported state fields: ${extras.join(", ")}`);
  const missing = ["x", "y", "z", "t"].filter((key) => !(key in raw));
  if (missing.length) fail("INVALID_STATE", `state missing required fields: ${missing.join(", ")}`);
  const state: DynamicsState = {
    x: finiteNumber("state.x", raw.x),
    y: finiteNumber("state.y", raw.y),
    z: finiteNumber("state.z", raw.z),
    t: numberInRange("state.t", raw.t, 0, 1_000_000),
  };
  if (program === "nemo") {
    const bank = raw.bank;
    if (!Array.isArray(bank) || (bank.length !== 15 && bank.length !== 20)) {
      fail("INVALID_NEMO_BANK", "NEMO state.bank must contain exactly 15 or 20 finite values");
    }
    const values = bank.map((value, index) => finiteNumber(`state.bank[${index}]`, value));
    state.bank = values.length === 15 ? [...values, 1, 1, 1, 1, 1] : values;
  } else if ("bank" in raw) {
    fail("UNSUPPORTED_STATE_FIELD", "state.bank is accepted only for the NEMO program");
  }
  return state;
}

/** Strict validation mirroring python/nexus_dynamics/schema.py NexusRunInput.from_dict. */
export function normalizeDynamicsInput(payload: unknown): DynamicsInput {
  if (!isRecord(payload)) fail("INVALID_REQUEST", "NEXUS input must be an object");
  const extras = Object.keys(payload)
    .filter((key) => !INPUT_FIELDS.includes(key))
    .sort();
  if (extras.length) fail("UNSUPPORTED_FIELD", `unsupported fields: ${extras.join(", ")}`);
  const missing = REQUIRED_INPUT_FIELDS.filter((key) => !(key in payload));
  if (missing.length) fail("MISSING_FIELD", `missing required fields: ${missing.join(", ")}`);
  const program = payload.program;
  if (typeof program !== "string" || !PROGRAMS.includes(program as AnalogProgram))
    fail("UNKNOWN_PROGRAM", `unknown program: ${String(program)}`);
  const mode = payload.mode;
  if (typeof mode !== "string" || !DYNAMICS_MODES.includes(mode as DynamicsMode))
    fail("UNKNOWN_MODE", `unknown mode: ${String(mode)}`);
  const p = program as AnalogProgram;
  const out: DynamicsInput = {
    program: p,
    mode: mode as DynamicsMode,
    steps: integerInRange("steps", payload.steps, 0, p === "nemo" ? NEMO_STEPS_MAX : STEPS_MAX),
    dt: numberInRange("dt", payload.dt, 0.0004, 0.08),
    chaos: numberInRange("chaos", payload.chaos, 0, 1),
    drive: numberInRange("drive", payload.drive, 0, 1),
    seed: numberInRange("seed", payload.seed, 0, 1),
    repeatEvery: integerInRange("repeatEvery", payload.repeatEvery, 1, 512),
  };
  if ("state" in payload) out.state = normalizeState(p, payload.state);
  if ("axes" in payload) {
    const axes = payload.axes;
    if (!Array.isArray(axes) || axes.length < 1 || axes.length > 64)
      fail("INVALID_AXES", "axes must contain between 1 and 64 values");
    out.axes = axes.map((value, index) => numberInRange(`axes[${index}]`, value, 0, 1));
  }
  return out;
}

// ---------------------------------------------------------------- simulation

export interface DynamicsSimulation {
  initialState: DynamicsState;
  finalState: DynamicsState;
  trail: Array<[number, number, number]>;
  stepsExecuted: number;
  repeatCount: number;
}

function stateDict(state: AnalogState | DynamicsState): DynamicsState {
  const out: DynamicsState = { x: state.x, y: state.y, z: state.z, t: state.t };
  if (state.bank) out.bank = state.bank.slice();
  return out;
}

function seedState(program: AnalogProgram, nudge: number): DynamicsState {
  return stateDict(seedAnalogState(program, nudge));
}

/** The four contract modes, exactly as python/nexus_dynamics/run.py simulate(). */
export function simulateDynamics(
  input: DynamicsInput,
  method: AnalogMethod = "euler4",
): DynamicsSimulation {
  const { program } = input;
  assertAnalogMethod(program, method);
  const initial = input.state ? stateDict(input.state) : seedState(program, input.seed);
  if (input.mode === "IC") {
    return {
      initialState: initial,
      finalState: seedState(program, input.seed),
      trail: [],
      stepsExecuted: 0,
      repeatCount: 0,
    };
  }
  if (input.mode === "HALT") {
    return {
      initialState: initial,
      finalState: stateDict(initial),
      trail: [],
      stepsExecuted: 0,
      repeatCount: 0,
    };
  }
  let state: AnalogState = stateDict(initial);
  const trail: Array<[number, number, number]> = [];
  const stride = Math.max(1, Math.ceil(Math.max(1, input.steps) / MAX_TRAIL_POINTS));
  let repeatCount = 0;
  for (let index = 0; index < input.steps; index++) {
    if (input.mode === "REP" && index > 0 && index % input.repeatEvery === 0) {
      repeatCount += 1;
      state = seedState(program, (input.seed + repeatCount * REPEAT_NUDGE) % 1);
    }
    state = analogIntegrate(program, state, input.dt, input.chaos, input.drive, method);
    if (index % stride === 0 || index === input.steps - 1) trail.push([state.x, state.y, state.z]);
  }
  return {
    initialState: initial,
    finalState: stateDict(state),
    trail,
    stepsExecuted: input.steps,
    repeatCount,
  };
}

function nemoBankBounded(bank: number[] | undefined): boolean {
  return Boolean(
    bank &&
    bank.length === 20 &&
    bank.slice(0, 5).every((v) => v >= -90 && v <= 40) &&
    bank.slice(5, 10).every((v) => v >= -40 && v <= 80) &&
    bank.slice(10, 15).every((v) => v >= 0 && v <= 48) &&
    bank.slice(15, 20).every((v) => v >= 0.05 && v <= 4),
  );
}

function isFiniteState(state: DynamicsState): boolean {
  return [state.x, state.y, state.z, state.t, ...(state.bank ?? [])].every(Number.isFinite);
}

function invariantsOf(program: AnalogProgram, sim: DynamicsSimulation) {
  const final = sim.finalState;
  const finiteState = isFiniteState(final);
  const lotkaFirstQuadrant = program === "lotka" ? final.x > 0 && final.y > 0 : null;
  const nemoBounded = program === "nemo" ? nemoBankBounded(final.bank) : null;
  const trailBounded = sim.trail.length <= MAX_TRAIL_POINTS + 1;
  return {
    finiteState,
    lotkaFirstQuadrant,
    nemoBankBounded: nemoBounded,
    trailBounded,
    allHold: finiteState && trailBounded && lotkaFirstQuadrant !== false && nemoBounded !== false,
  };
}

function inputDict(input: DynamicsInput): Record<string, unknown> {
  const out: Record<string, unknown> = {
    program: input.program,
    mode: input.mode,
    steps: input.steps,
    dt: input.dt,
    chaos: input.chaos,
    drive: input.drive,
    seed: input.seed,
    repeatEvery: input.repeatEvery,
  };
  if (input.state) out.state = stateDict(input.state);
  if (input.axes) out.axes = input.axes.slice();
  return out;
}

/** Hashed as `inputHash` (python run.input_payload). */
export function dynamicsInputPayload(input: DynamicsInput, method: AnalogMethod = "euler4") {
  return { schema: DYNAMICS_INPUT_SCHEMA, method, input: inputDict(input) };
}

/** Hashed as `outputHash` (python run.deterministic_output). */
export function dynamicsOutput(input: DynamicsInput, method: AnalogMethod = "euler4") {
  const sim = simulateDynamics(input, method);
  return {
    schema: DYNAMICS_OUTPUT_SCHEMA,
    program: input.program,
    model: ANALOG_MODEL_VERSIONS[input.program],
    method,
    integrator: ANALOG_METHOD_VERSIONS[method],
    mode: input.mode,
    stepsExecuted: sim.stepsExecuted,
    repeatCount: sim.repeatCount,
    finalState: sim.finalState,
    trail: sim.trail,
    invariants: invariantsOf(input.program, sim),
  };
}

// ---------------------------------------------------------------- IMMUNE v1

function round12(value: number): number {
  if (!Number.isFinite(value))
    throw new AnalogEngineError(
      "NON_FINITE_OUTPUT",
      "IMMUNE v1 projection produced a non-finite value",
    );
  const rounded = pyRound(value, 12);
  return rounded === 0 ? 0 : rounded;
}

function immuneLambda(axes?: number[]): { value: number | null; blocked: boolean; label: string } {
  if (axes === undefined) return { value: null, blocked: true, label: "UNAVAILABLE" };
  if (!axes.length || axes.some((a) => !Number.isFinite(a) || a < 0 || a > 1))
    return { value: 0, blocked: true, label: "MODELED_FROM_CALLER_AXES" };
  if (axes.some((a) => a === 0))
    return { value: 0, blocked: true, label: "MODELED_FROM_CALLER_AXES" };
  const weight = 1 / axes.length;
  const raw = Math.exp(axes.reduce((sum, a) => sum + weight * Math.log(a), 0));
  return { value: Math.min(TRUST_CEILING, raw), blocked: false, label: "MODELED_FROM_CALLER_AXES" };
}

function ouroborosTax(amplitude: number, bars = 8): number {
  const bounded = Math.max(1, Math.min(64, Math.trunc(bars)));
  return Math.max(0, amplitude * Math.exp(-bounded / 8));
}

/**
 * IMMUNE's v1 deterministic output (python/immune/nexus.py run_nexus), rebuilt
 * from the instrument engine in math.ts. Its hash must equal IMMUNE's published
 * contracts/immune-nexus-parity-v1.json value (see contracts/nexus-parity-v2.json).
 */
export function immuneV1Output(input: DynamicsInput) {
  const { program } = input;
  const sim = simulateDynamics(input, "euler4");
  for (const point of sim.trail) point.forEach(round12);
  const f = sim.finalState;
  const finalState: DynamicsState = {
    x: round12(f.x),
    y: round12(f.y),
    z: round12(f.z),
    t: round12(f.t),
  };
  if (f.bank) finalState.bank = f.bank.map(round12);
  const raw = scaleAnalog(program, finalState);
  const normalized = { x: round12(raw.x), y: round12(raw.y), z: round12(raw.z) };
  const objectAmplitude = Math.max(0, 0.5 + 0.5 * Math.hypot(normalized.x, normalized.y));
  const referenceAmplitude = Math.max(0, 0.35 + 0.55 * normalized.z);
  const phaseDifference = Math.atan2(normalized.y, normalized.x + 1e-9);
  const intensity = opticalInterfere(objectAmplitude, phaseDifference, referenceAmplitude, 0);
  const reconstruct = opticalReconstruct(intensity, phaseDifference);
  const corr = analogCorrelate(normalized.x, normalized.y, 0, input.dt);
  const circuitBase = analogCircuit(normalized.x, normalized.y, normalized.z, corr);
  const circuit: Record<string, number> = {};
  for (const [key, value] of Object.entries(circuitBase)) circuit[key] = round12(value);
  circuit.jack = round12(analogJack(circuitBase, reconstruct, input.drive));
  const lotkaFirstQuadrant = program === "lotka" ? finalState.x > 0 && finalState.y > 0 : null;
  const nemoBounded = program === "nemo" ? nemoBankBounded(finalState.bank) : null;
  const finiteState = isFiniteState(finalState);
  const trailBounded = sim.trail.length <= MAX_TRAIL_POINTS + 1;
  return {
    schema: IMMUNE_V1_PARITY_SCHEMA,
    sourceRevision: IMMUNE_V1_SOURCE_REVISION,
    program,
    mode: input.mode,
    stepsExecuted: sim.stepsExecuted,
    repeatCount: sim.repeatCount,
    finalState,
    normalized,
    optics: {
      objectAmplitude: round12(objectAmplitude),
      referenceAmplitude: round12(referenceAmplitude),
      phaseDifference: round12(phaseDifference),
      intensity: round12(intensity),
      reconstruct: round12(reconstruct),
    },
    circuit,
    lambda: immuneLambda(input.axes),
    ouroborosTax: round12(ouroborosTax(Math.abs(reconstruct))),
    invariants: {
      finiteState,
      lotkaFirstQuadrant,
      nemoBankBounded: nemoBounded,
      trailBounded,
      externalCallsZero: true,
      executableSoftwareNotHardware: true,
      allHold: finiteState && trailBounded && lotkaFirstQuadrant !== false && nemoBounded !== false,
    },
  };
}
