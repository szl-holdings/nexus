import type { AnalogProgram } from "./types";

export function midiToHz(m: number) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function euclid(hits: number, steps: number, rot: number): boolean[] {
  const n = Math.max(1, Math.min(32, Math.floor(steps)));
  const k = Math.max(0, Math.min(n, Math.floor(hits)));
  const pattern: boolean[] = Array.from({ length: n }, () => false);
  if (k === 0) return pattern;
  let bucket = 0;
  for (let i = 0; i < n; i++) {
    bucket += k;
    if (bucket >= n) {
      bucket -= n;
      pattern[i] = true;
    }
  }
  const r = ((rot % n) + n) % n;
  return pattern.slice(n - r).concat(pattern.slice(0, n - r));
}

/** F18 Reed-Solomon singleton d = n−k+1 on the Euclid lattice. k=locked-8. Advisory. */
export function singletonBound(n: number, k = 8) {
  return n - k + 1;
}

export function f18Face(hits: number, steps: number, k = 8) {
  const n = Math.max(1, Math.floor(steps));
  const h = Math.max(0, Math.floor(hits));
  if (n < k) {
    return { hits: h, bound: 0, vHit: 0, vBnd: 0, side: "unavailable" as const };
  }
  const bound = singletonBound(n, k);
  return {
    hits: h,
    bound,
    vHit: h / n,
    vBnd: bound / n,
    side: (h < bound ? "under" : h === bound ? "on" : "over") as "under" | "on" | "over",
  };
}

export interface LorenzState {
  x: number;
  y: number;
  z: number;
}

export interface AnalogState {
  x: number;
  y: number;
  z: number;
  t: number;
  /** NEMO: 5 membranes + 5 recovery + 5 synaptic traces + 5 optical STDP weights. */
  bank?: number[];
}

function clamp01(c: number) {
  return Math.min(1, Math.max(0, c));
}

export function seedLorenz(nudge = 0): LorenzState {
  return {
    x: 0.12 + nudge * 0.31,
    y: -0.08 + nudge * 0.17,
    z: 22 + (nudge % 1) * 6,
  };
}

export function seedNemoBank(nudge = 0): number[] {
  const n = nudge % 1;
  const v = [-65 + n * 6, -62 - n * 4, -70 + n * 5, -58 - n * 3, -67 + n * 8];
  const u = v.map((m) => 0.2 * m);
  return [...v, ...u, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1];
}

/** Accept a 15-cell NEMO bank (pre-STDP persist) by padding optical weights to 1. */
export function padNemoBank(raw?: number[]): number[] {
  if (raw && raw.length >= 20 && raw.slice(0, 20).every((n) => Number.isFinite(n))) {
    return raw.slice(0, 20);
  }
  if (raw && raw.length === 15 && raw.every((n) => Number.isFinite(n))) {
    return [...raw, 1, 1, 1, 1, 1];
  }
  return seedNemoBank();
}

export function seedAnalogState(program: AnalogProgram, nudge = 0): AnalogState {
  const n = nudge % 1;
  if (program === "harmonic") return { x: 1, y: 0.02 + n * 0.08, z: 0.5, t: 0 };
  if (program === "vanderpol") return { x: 0.12 + n * 0.2, y: 0.04, z: 0.4, t: 0 };
  if (program === "duffing") return { x: 0.18 + n * 0.12, y: 0, z: 0.5, t: 0 };
  if (program === "lotka") return { x: 1.15 + n * 0.25, y: 0.82 + n * 0.12, z: 0.5, t: 0 };
  if (program === "nemo") {
    const bank = seedNemoBank(nudge);
    return { x: bank[0] ?? -65, y: bank[2] ?? -70, z: 0.06, t: 0, bank };
  }
  const L = seedLorenz(nudge);
  return { x: L.x, y: L.y, z: L.z, t: 0 };
}

/** Coefficient pots: σ fixed, ρ from chaos 0–1, β classic 8/3. */
export function analogCoefficients(chaos: number, program: AnalogProgram = "lorenz") {
  const c = clamp01(chaos);
  if (program === "harmonic") {
    const omega = 1 + c * 3;
    return { sigma: 10, rho: 18 + c * 22, beta: 8 / 3, omega, mu: 0, delta: 0, gamma: 0, alpha: 0, label: `ω ${omega.toFixed(2)}` };
  }
  if (program === "vanderpol") {
    const mu = 0.25 + c * 2.7;
    return { sigma: 10, rho: 18 + c * 22, beta: 8 / 3, omega: 1, mu, delta: 0, gamma: 0, alpha: 0, label: `μ ${mu.toFixed(2)}` };
  }
  if (program === "duffing") {
    const delta = 0.08 + c * 0.32;
    const gamma = 0.18 + c * 0.55;
    return { sigma: 10, rho: 18 + c * 22, beta: 8 / 3, omega: 1.2, mu: 0, delta, gamma, alpha: 0, label: `δ ${delta.toFixed(2)} · γ ${gamma.toFixed(2)}` };
  }
  if (program === "lotka") {
    const alpha = 0.85 + c * 0.55;
    const beta = 0.42 + c * 0.7;
    // F-05 (model lotka/2): integrate with the labelled β. nexus ≤ d087694 returned β = 8/3 here.
    return { sigma: 10, rho: 18 + c * 22, beta, omega: 1, mu: 0, delta: 0.4 + c * 0.35, gamma: 0.62, alpha, label: `α ${alpha.toFixed(2)} · β ${beta.toFixed(2)}` };
  }
  if (program === "nemo") {
    const a = 0.02 + c * 0.08;
    const w = 3.5 + c * 14;
    const tau = 3 + (1 - c) * 9;
    return { sigma: 10, rho: 18 + c * 22, beta: 8 / 3, omega: 1, mu: a, delta: w, gamma: tau, alpha: 0.2, label: `AdEx · 5ORG · 2BRN` };
  }
  return {
    sigma: 10,
    rho: 18 + c * 22,
    beta: 8 / 3,
    omega: 1,
    mu: 0,
    delta: 0,
    gamma: 0,
    alpha: 0,
    label: `σ 10 · ρ ${(18 + c * 22).toFixed(1)} · β ${(8 / 3).toFixed(2)}`,
  };
}

/** One integration tick of the Lorenz analog computer. `chaos` 0–1 maps ρ. */
export function lorenzStep(s: LorenzState, dt: number, chaos: number): LorenzState {
  const { sigma, rho, beta } = analogCoefficients(chaos, "lorenz");
  let { x, y, z } = s;
  const n = 4;
  const h = Math.max(0.0004, Math.min(0.08, dt)) / n;
  for (let i = 0; i < n; i++) {
    const dx = sigma * (y - x);
    const dy = x * (rho - z) - y;
    const dz = x * y - beta * z;
    x += dx * h;
    y += dy * h;
    z += dz * h;
  }
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return seedLorenz();
  return { x, y, z };
}

/**
 * Integration methods (see python/nexus_dynamics/integrators.py, the Python
 * binding of the same engine). Every method advances one tick of dt (clamped to
 * 0.0004..0.08) in 4 substeps of h = dt / 4:
 *   euler4      forward Euler, the instrument's historical scheme (audio parity)
 *   rk4         classical Runge-Kutta 4 on the exact vector field
 *   symplectic  velocity Verlet (harmonic); Strang split with velocity Verlet on
 *               the conservative double well + exact damped/forced flow (Duffing)
 * NEMO is a hybrid threshold/reset system and only runs its own scheme.
 */
export type AnalogMethod = "euler4" | "rk4" | "symplectic";
export const ANALOG_METHODS: readonly AnalogMethod[] = ["euler4", "rk4", "symplectic"];
/** Hashed into every parity output: changing an algorithm must bump its version. */
export const ANALOG_METHOD_VERSIONS: Readonly<Record<AnalogMethod, string>> = {
  euler4: "euler4/1",
  rk4: "rk4/1",
  symplectic: "strang-verlet/1",
};
/** Program model versions. lotka/2 = F-05 (β now matches its label). */
export const ANALOG_MODEL_VERSIONS: Readonly<Record<AnalogProgram, string>> = {
  lorenz: "lorenz/1",
  harmonic: "harmonic/1",
  vanderpol: "vanderpol/1",
  duffing: "duffing/1",
  lotka: "lotka/2",
  nemo: "nemo/1",
};
export const ANALOG_METHOD_SUPPORT: Readonly<Record<AnalogProgram, readonly AnalogMethod[]>> = {
  lorenz: ["euler4", "rk4"],
  harmonic: ["euler4", "rk4", "symplectic"],
  vanderpol: ["euler4", "rk4"],
  duffing: ["euler4", "rk4", "symplectic"],
  lotka: ["euler4", "rk4"],
  nemo: ["euler4"],
};

/** Fail-closed engine error. Codes match python/nexus_dynamics/errors.py and IMMUNE. */
export class AnalogEngineError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AnalogEngineError";
    this.code = code;
  }
}

type AnalogPots = ReturnType<typeof analogCoefficients>;
type Vec3 = [number, number, number];

const ANALOG_SUBSTEPS = 4;
const LOTKA_FLOOR = 0.02;

/** Substep size of one tick, exactly as the instrument has always clamped it. */
export function analogSubstep(dt: number): number {
  return Math.max(0.0004, Math.min(0.08, dt)) / ANALOG_SUBSTEPS;
}

/** Exact vector field of a non-NEMO program (no instrument guards). */
export function analogField(
  program: AnalogProgram,
  pots: AnalogPots,
  drive: number,
  x: number,
  y: number,
  z: number,
  t: number,
): Vec3 {
  if (program === "harmonic") {
    const w2 = pots.omega * pots.omega;
    return [y, -w2 * x, 0];
  }
  if (program === "vanderpol") return [y, pots.mu * (1 - x * x) * y - x, 0];
  if (program === "duffing") {
    const force = pots.gamma * (0.45 + drive * 0.7) * Math.cos(pots.omega * t);
    return [y, x - x * x * x - pots.delta * y + force, 0];
  }
  if (program === "lotka") return [pots.alpha * x - pots.beta * x * y, pots.delta * x * y - pots.gamma * y, 0];
  return [pots.sigma * (y - x), x * (pots.rho - z) - y, x * y - pots.beta * z];
}

/** The instrument's field: analogField plus Lotka's 0.02 floor. */
function euler4Field(program: AnalogProgram, pots: AnalogPots, drive: number, x: number, y: number, z: number, t: number): Vec3 {
  if (program === "lotka") {
    const prey = Math.max(LOTKA_FLOOR, x);
    const pred = Math.max(LOTKA_FLOOR, y);
    return [pots.alpha * prey - pots.beta * prey * pred, pots.delta * prey * pred - pots.gamma * pred, 0];
  }
  return analogField(program, pots, drive, x, y, z, t);
}

function rk4Substep(program: AnalogProgram, pots: AnalogPots, drive: number, x: number, y: number, z: number, t: number, h: number): Vec3 {
  const [k1x, k1y, k1z] = analogField(program, pots, drive, x, y, z, t);
  const [k2x, k2y, k2z] = analogField(program, pots, drive, x + 0.5 * h * k1x, y + 0.5 * h * k1y, z + 0.5 * h * k1z, t + 0.5 * h);
  const [k3x, k3y, k3z] = analogField(program, pots, drive, x + 0.5 * h * k2x, y + 0.5 * h * k2y, z + 0.5 * h * k2z, t + 0.5 * h);
  const [k4x, k4y, k4z] = analogField(program, pots, drive, x + h * k3x, y + h * k3y, z + h * k3z, t + h);
  return [
    x + (h * (k1x + 2 * k2x + 2 * k3x + k4x)) / 6,
    y + (h * (k1y + 2 * k2y + 2 * k3y + k4y)) / 6,
    z + (h * (k1z + 2 * k2z + 2 * k3z + k4z)) / 6,
  ];
}

/** Exact solution after time s of y' = -δ y + F cos(ω t) (Duffing's dissipative/forced part). */
export function duffingDissipativeFlow(y: number, t: number, s: number, delta: number, force: number, omega: number): number {
  const decay = Math.exp(-delta * s);
  const denom = delta * delta + omega * omega;
  if (denom === 0) return y + force * s;
  const p1 = delta * Math.cos(omega * (t + s)) + omega * Math.sin(omega * (t + s));
  const p0 = delta * Math.cos(omega * t) + omega * Math.sin(omega * t);
  return decay * y + (force / denom) * (p1 - decay * p0);
}

function symplecticSubstep(program: AnalogProgram, pots: AnalogPots, drive: number, x: number, y: number, t: number, h: number): [number, number] {
  if (program === "harmonic") {
    const w2 = pots.omega * pots.omega;
    const vHalf = y + 0.5 * h * (-w2 * x);
    const xNew = x + h * vHalf;
    return [xNew, vHalf + 0.5 * h * (-w2 * xNew)];
  }
  // Duffing: B(h/2) A(h) B(h/2); A = velocity Verlet on x'' = x - x^3.
  const force = pots.gamma * (0.45 + drive * 0.7);
  const half = 0.5 * h;
  let v = duffingDissipativeFlow(y, t, half, pots.delta, force, pots.omega);
  const vHalf = v + 0.5 * h * (x - x * x * x);
  const xNew = x + h * vHalf;
  v = vHalf + 0.5 * h * (xNew - xNew * xNew * xNew);
  v = duffingDissipativeFlow(v, t + half, half, pots.delta, force, pots.omega);
  return [xNew, v];
}

/** Throws UNKNOWN_PROGRAM / UNKNOWN_METHOD / UNSUPPORTED_METHOD like the Python binding. */
export function assertAnalogMethod(program: AnalogProgram, method: AnalogMethod) {
  const supported = ANALOG_METHOD_SUPPORT[program];
  if (!supported) throw new AnalogEngineError("UNKNOWN_PROGRAM", `unknown program: ${String(program)}`);
  if (!ANALOG_METHODS.includes(method)) throw new AnalogEngineError("UNKNOWN_METHOD", `unknown method: ${String(method)}`);
  if (!supported.includes(method)) {
    throw new AnalogEngineError("UNSUPPORTED_METHOD", `${program} supports ${supported.join(", ")}, not ${method}`);
  }
}

function requireFinite(name: string, value: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AnalogEngineError("NON_FINITE_NUMBER", `${name} must be finite`);
  }
}

function advanceCore(
  program: AnalogProgram,
  s: AnalogState,
  h: number,
  substeps: number,
  chaos: number,
  drive: number,
  method: AnalogMethod,
): AnalogState {
  const pots = analogCoefficients(chaos, program);
  let { x, y, z, t } = s;
  if (method === "euler4") {
    for (let i = 0; i < substeps; i++) {
      const [dx, dy, dz] = euler4Field(program, pots, drive, x, y, z, t);
      x += dx * h;
      y += dy * h;
      z += dz * h;
      t += h;
    }
    if (program === "lotka") {
      x = Math.max(LOTKA_FLOOR, x);
      y = Math.max(LOTKA_FLOOR, y);
    }
  } else if (method === "rk4") {
    for (let i = 0; i < substeps; i++) {
      [x, y, z] = rk4Substep(program, pots, drive, x, y, z, t, h);
      t += h;
    }
  } else {
    for (let i = 0; i < substeps; i++) {
      [x, y] = symplecticSubstep(program, pots, drive, x, y, t, h);
      t += h;
    }
  }
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(t)) {
    throw new AnalogEngineError("NON_FINITE_OUTPUT", `${program} produced a non-finite value`);
  }
  return { x, y, z, t };
}

/** Advance `substeps` substeps of size h with no dt clamp (convergence studies). Not for NEMO. */
export function analogAdvance(
  program: AnalogProgram,
  s: AnalogState,
  h: number,
  substeps: number,
  chaos: number,
  drive: number,
  method: AnalogMethod,
): AnalogState {
  assertAnalogMethod(program, method);
  if (program === "nemo") throw new AnalogEngineError("UNSUPPORTED_METHOD", "NEMO advances only through analogIntegrate()");
  return advanceCore(program, s, h, substeps, chaos, drive, method);
}

function strictNemoBank(raw?: number[]): number[] {
  if (raw === undefined) return seedNemoBank();
  if (!Array.isArray(raw) || (raw.length !== 15 && raw.length !== 20)) {
    throw new AnalogEngineError("INVALID_NEMO_BANK", "NEMO bank must contain exactly 15 or 20 values");
  }
  if (!raw.every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new AnalogEngineError("NON_FINITE_NUMBER", "NEMO bank values must be finite");
  }
  return raw.length === 15 ? [...raw, 1, 1, 1, 1, 1] : raw.slice();
}

/**
 * One strict tick: validates inputs and never reseeds. Throws AnalogEngineError
 * (NON_FINITE_OUTPUT on NaN/Infinity, UNSUPPORTED_METHOD, ...). Hash-identical
 * to python/nexus_dynamics integrators.step().
 */
export function analogIntegrate(
  program: AnalogProgram,
  s: AnalogState,
  dt: number,
  chaos: number,
  drive = 0.5,
  method: AnalogMethod = "euler4",
): AnalogState {
  assertAnalogMethod(program, method);
  requireFinite("dt", dt);
  requireFinite("chaos", chaos);
  requireFinite("drive", drive);
  requireFinite("state.x", s.x);
  requireFinite("state.y", s.y);
  requireFinite("state.z", s.z);
  requireFinite("state.t", s.t);
  if (program === "nemo") return analogNemoTick(s, strictNemoBank(s.bank), dt, chaos, drive);
  return advanceCore(program, s, analogSubstep(dt), ANALOG_SUBSTEPS, chaos, drive, method);
}

/** Instrument tick (euler4). Audio must not die: any non-finite result reseeds the program. */
export function analogStep(program: AnalogProgram, s: AnalogState, dt: number, chaos: number, drive = 0.5): AnalogState {
  try {
    if (program === "nemo") return analogNemoTick(s, padNemoBank(s.bank), dt, chaos, drive);
    return advanceCore(program, s, analogSubstep(dt), ANALOG_SUBSTEPS, chaos, drive, "euler4");
  } catch (error) {
    if (error instanceof AnalogEngineError) return seedAnalogState(program);
    throw error;
  }
}

export function scaleLorenz(s: LorenzState) {
  return {
    x: Math.max(-1, Math.min(1, s.x / 24)),
    y: Math.max(-1, Math.min(1, s.y / 24)),
    z: Math.max(0, Math.min(1, s.z / 48)),
  };
}

export function scaleAnalog(program: AnalogProgram, s: AnalogState) {
  if (program === "harmonic") {
    const e = 0.5 * (s.y * s.y + s.x * s.x);
    return {
      x: Math.max(-1, Math.min(1, s.x)),
      y: Math.max(-1, Math.min(1, s.y / 3)),
      z: Math.max(0, Math.min(1, e * 0.5)),
    };
  }
  if (program === "vanderpol") {
    return {
      x: Math.max(-1, Math.min(1, s.x / 2.4)),
      y: Math.max(-1, Math.min(1, s.y / 3.2)),
      z: Math.max(0, Math.min(1, (s.x * s.x + s.y * s.y) / 10)),
    };
  }
  if (program === "duffing") {
    return {
      x: Math.max(-1, Math.min(1, s.x / 2)),
      y: Math.max(-1, Math.min(1, s.y / 2.4)),
      z: Math.max(0, Math.min(1, 0.5 + 0.5 * Math.sin(s.t))),
    };
  }
  if (program === "lotka") {
    return {
      x: Math.max(-1, Math.min(1, (s.x - 1.4) / 1.8)),
      y: Math.max(-1, Math.min(1, (s.y - 1.1) / 1.6)),
      z: Math.max(0, Math.min(1, (s.x + s.y) / 6)),
    };
  }
  if (program === "nemo") {
    return {
      x: Math.max(-1, Math.min(1, (s.x + 45) / 40)),
      y: Math.max(-1, Math.min(1, (s.y + 45) / 40)),
      z: Math.max(0, Math.min(1, s.z)),
    };
  }
  return scaleLorenz(s);
}

export function analogCell(x: number, y: number, cols: number, rows: number) {
  const col = Math.round((x * 0.5 + 0.5) * (cols - 1));
  const row = Math.round((y * 0.5 + 0.5) * (rows - 1));
  return {
    col: Math.max(0, Math.min(cols - 1, col)),
    row: Math.max(0, Math.min(rows - 1, row)),
  };
}

/**
 * Analog computing elements (THAT *jobs*, not the circuit): integrator,
 * summer, multiplier, inverter, comparator as live voltages. Analog
 * correlator is the BrainScaleS analog-correlator *job* (leaky product of
 * two traces). Analog Schmitt is the analog-computer event detector.
 * Not a 7th module. Not a chip clone.
 */
export interface AnalogCircuit {
  intg: number;
  sum: number;
  mul: number;
  inv: number;
  cmp: number;
  corr: number;
}

function clampUnit(n: number) {
  const v = Number.isFinite(n) ? n : 0;
  return Math.max(-1, Math.min(1, v));
}

export function analogCircuit(x: number, y: number, z: number, corr = 0): AnalogCircuit {
  const xi = clampUnit(x);
  const yi = clampUnit(y);
  const zi = clampUnit(z);
  return {
    intg: xi,
    sum: clampUnit((xi + yi + zi) / 3),
    mul: clampUnit(xi * yi),
    inv: clampUnit(-xi),
    cmp: xi >= 0 ? 1 : -1,
    corr: clampUnit(corr),
  };
}

/** Leaky analog correlator: corr ← corr + (pre·post − corr)·(1−e^{−dt/τ}). */
export function analogCorrelate(pre: number, post: number, corr: number, dt: number, tau = 0.18): number {
  const product = clampUnit(pre) * clampUnit(post);
  const t = Math.max(1e-4, tau);
  const a = 1 - Math.exp(-Math.max(0, dt) / t);
  const prev = clampUnit(corr);
  return clampUnit(prev + (product - prev) * a);
}

/** Analog Schmitt trigger. Holds last polarity through the hysteresis band. */
export function analogSchmitt(x: number, last: number, hyst = 0.08): number {
  const h = Math.max(0.01, Math.min(0.45, hyst));
  const xi = clampUnit(x);
  if (last >= 0) return xi > -h ? 1 : -1;
  return xi < h ? -1 : 1;
}

/** Analog computer output jack — summer of integrator, multiplier, correlator, optical reconstruct. */
export function analogJack(ckt: AnalogCircuit, recon: number, drive: number): number {
  const d = Math.min(1, Math.max(0, drive));
  const r = clampUnit(recon);
  const corr = clampUnit(ckt.corr ?? 0);
  return clampUnit(ckt.intg * 0.55 + ckt.mul * 0.22 * d + corr * 0.12 * d + r * 0.22 * d);
}

export function funcGenStep(
  value: number,
  rising: boolean,
  dt: number,
  rise: number,
  fall: number,
): { value: number; rising: boolean } {
  const r = Math.max(0.02, rise);
  const f = Math.max(0.02, fall);
  let v = value;
  let up = rising;
  if (up) {
    v += dt / r;
    if (v >= 1) {
      v = 1;
      up = false;
    }
  } else {
    v -= dt / f;
    if (v <= 0) {
      v = 0;
      up = true;
    }
  }
  return { value: v, rising: up };
}

/** Two-beam analog optical inner product. Not a digital FFT. Energy UNAVAILABLE. */
export function opticalInterfere(objAmp: number, objPhase: number, refAmp: number, refPhase: number) {
  const ao = Math.max(0, objAmp);
  const ar = Math.max(0, refAmp);
  const I = ao * ao + ar * ar + 2 * ao * ar * Math.cos(objPhase - refPhase);
  return Number.isFinite(I) ? Math.max(0, I) : 0;
}

/** First-order diffraction as a signed analog voltage. */
export function opticalReconstruct(intensity: number, dphi: number) {
  const v = intensity * Math.cos(dphi);
  if (!Number.isFinite(v)) return 0;
  return Math.max(-1, Math.min(1, v / 2));
}

/**
 * Analog neuromorphic core — five-organ anatomy as analog physics,
 * WILLAY as optical second brain (not a sixth organ, not a seventh module).
 *
 * Membranes: AdEx (Brette & Gerstner 2005; BrainScaleS-2 analog job, not the circuit).
 * Organ jobs (analog, not a digital state machine):
 *   0 YACHAY  cognition — Drive injected current
 *   1 YUYAY   pacemaker — analog SA-node If (DiFrancesco job, not a cardiac cell)
 *   2 YAWAR   traveling wave — nearest-neighbor depolarizing current around the ring
 *               (Miller 2026 analog traveling-wave job, not their circuit)
 *   3 OTel    optical nervous write — extra two-beam coupling; never a joule
 *   4 KHIPU   bound — extra leak toward rest
 * Chemical synapses: Tsodyks–Markram analog STP.
 * Three-factor optical STDP: eligibility × Drive × WILLAY reconstruct.
 * WILLAY conscience field = mean first-order diffraction of the five optical pairs.
 * Dark hologram soft-inhibits the ring (analog fail-closed). Not a chip. Energy UNAVAILABLE.
 */
function analogNemoTick(s: AnalogState, bank: number[], dt: number, chaos: number, drive: number): AnalogState {
  // `bank` is a fresh 20-cell copy (padNemoBank for the instrument, strictNemoBank for analogIntegrate).
  const c = clamp01(chaos);
  const pots = analogCoefficients(c, "nemo");
  const aAdapt = pots.mu;
  const chemW = pots.delta;
  const tau = Math.max(1.4, pots.gamma);
  const I0 = 2.2 + drive * 10.5;
  const EL = -65;
  const VT = -52 + c * 6;
  const dT = 2;
  const gL = 0.12;
  const tauW = Math.max(8, 42 - c * 28);
  const vr = -58 + c * 8;
  const bJump = 4 + c * 10;
  const vPeak = 20;
  const M = clamp01(drive);
  let rate = Number.isFinite(s.z) ? Math.max(0, Math.min(1, s.z)) : 0;
  let t = Number.isFinite(s.t) ? s.t : 0;
  const totalMs = Math.max(0.25, Math.min(80, dt * 1000));
  const n = Math.max(4, Math.min(48, Math.ceil(totalMs / 0.5)));
  const h = totalMs / n;

  for (let k = 0; k < n; k++) {
    const I = [0, 0, 0, 0, 0];
    const iopt = [0, 0, 0, 0, 0];
    const tMs = t * 1000;
    const paceT = 170 + (1 - M) * 260;
    const Ipace = M * (1.6 + 3.8 * (0.5 + 0.5 * Math.sin((tMs * Math.PI * 2) / paceT)));
    let willayField = 0;
    for (let i = 0; i < 5; i++) {
      const opp = (i + 2) % 5;
      const prev = (i + 4) % 5;
      const ao = Math.max(0, (bank[i]! + 70) / 110);
      const ar = Math.max(0, (bank[opp]! + 70) / 110);
      iopt[i] = opticalInterfere(ao, bank[i]! * 0.035, ar, bank[opp]! * 0.035);
      willayField += opticalReconstruct(iopt[i]!, (bank[i]! - bank[opp]!) * 0.035);
      const Iwave = 0.72 * Math.max(0, (bank[prev]! - EL) / 40);
      const wi = Math.max(0.05, Math.min(4, bank[15 + i]!));
      let inj = bank[10 + i]! + iopt[i]! * (1.1 + drive * 0.9) * wi + Iwave;
      if (i === 0) inj += I0;
      else if (i === 1) inj += 0.8 + drive * 2.4 + Ipace;
      else inj += 0.8 + drive * 2.4;
      if (i === 3) inj += 0.45 * (iopt[i] ?? 0);
      I[i] = inj;
    }
    willayField /= 5;
    const gate = 0.35 + 0.65 * (0.5 + 0.5 * willayField);
    const fired: number[] = [];
    for (let i = 0; i < 5; i++) {
      let vi = bank[i]!;
      let ui = bank[5 + i]!;
      let si = bank[10 + i]!;
      const arg = Math.max(-20, Math.min(8, (vi - VT) / dT));
      const expNa = Math.exp(arg);
      const dv = -gL * (vi - EL) + gL * dT * expNa - ui + I[i]!;
      const du = (aAdapt * (vi - EL) - ui) / tauW;
      vi += dv * h;
      ui += du * h;
      if (i === 4) vi += (EL - vi) * (h / 420);
      si += (-si / tau) * h;
      if (vi >= vPeak) {
        vi = vr;
        ui += bJump;
        fired.push(i);
      }
      bank[i] = Math.max(-90, Math.min(40, vi));
      bank[5 + i] = Math.max(-40, Math.min(80, ui));
      bank[10 + i] = Math.max(0, Math.min(48, si));
    }
    for (const i of fired) {
      const post = (i + 1) % 5;
      const opp = (i + 2) % 5;
      const avail = 1 - Math.min(1, (bank[10 + post] ?? 0) / 48);
      const jump = chemW * avail * (0.55 + 0.45 * gate);
      bank[10 + post] = Math.min(48, (bank[10 + post] ?? 0) + jump);
      const nervous = i === 3 ? 1.35 : 1;
      bank[15 + i] = (bank[15 + i] ?? 1) + 0.018 * ((bank[10 + opp] ?? 0) / 48) * (iopt[i] ?? 0) * M * gate * nervous;
      bank[15 + opp] = (bank[15 + opp] ?? 1) - 0.006;
    }
    for (let i = 0; i < 5; i++) {
      const leaked = (bank[15 + i] ?? 1) + (1 - (bank[15 + i] ?? 1)) * (h / 180);
      bank[15 + i] = Math.max(0.05, Math.min(4, leaked));
    }
    const decay = Math.exp(-h / 38);
    rate = rate * decay + (fired.length / 5) * (1 - decay) * 10;
    if (rate > 1) rate = 1;
    t += h * 0.001;
    if (!Number.isFinite(bank[0]) || !Number.isFinite(rate) || !Number.isFinite(t)) {
      throw new AnalogEngineError("NON_FINITE_OUTPUT", "NEMO produced a non-finite value");
    }
  }

  if (!bank.every(Number.isFinite)) throw new AnalogEngineError("NON_FINITE_OUTPUT", "NEMO produced a non-finite value");
  return { x: bank[0]!, y: bank[2]!, z: rate, t, bank };
}
