// SPDX-License-Identifier: Apache-2.0
// © 2026 SZL Holdings · Stephen P. Lutar · ORCID 0009-0001-0110-4173
// Port of szl-holdings/szl-formulas (21 canonical) + szl-khipu analog silhouettes.
// CHECKED ≠ Lean locked-8. Λ uniqueness = Conjecture 1 (open) — NEVER proven.

import type { PatchCable, PortId } from "./types";

export const EPS = 1e-9;
export const GENESIS = "0".repeat(64);
export const LOCKED_EIGHT = ["F1", "F4", "F7", "F11", "F12", "F18", "F19", "F22"] as const;
export type LockedId = (typeof LOCKED_EIGHT)[number];
export const LOCKED_PROVEN_COUNT = 8;

export const LAMBDA_LABEL =
  "ADVISORY — Λ = Conjecture 1 (open); non-compensatory roll-up, NOT proven trust";

export const ORG_AXIS_NAMES = [
  "soundness",
  "calibration",
  "robustness",
  "provenance",
  "consent",
  "reversibility",
  "transparency",
  "fairness",
  "containment",
  "attestation",
  "freshness",
  "authority",
  "auditability",
] as const;

export type AxisName = (typeof ORG_AXIS_NAMES)[number];

/** Canonical weights (Σ = 1.0) from a11oy szl_org_lambda.py */
export const ORG_AXIS_WEIGHTS = [
  0.12, 0.06, 0.08, 0.11, 0.06, 0.07, 0.07, 0.05, 0.08, 0.1, 0.05, 0.07, 0.08,
];

export const YARQA_CANALS: Record<"voice" | "tape" | "out", PortId[]> = {
  voice: ["vco", "noise", "lfo", "sh", "vcf", "vcfout"],
  tape: ["tape", "delay", "tapein"],
  out: ["grid", "vca", "pan", "scope", "out"],
};

export const ORGAN_NODES = ["BRAIN", "HEART", "BLOOD", "IMMUNE", "SKELETON", "NERVOUS"] as const;
export type OrganId = (typeof ORGAN_NODES)[number];

export const LOCKED_NOTE: Record<LockedId, { name: string; analog: string }> = {
  F1: { name: "Receipt integrity", analog: "same payload → same digest; replay the last burst" },
  F4: { name: "Acyclic policy", analog: "prune instant feedback; delay loops may remain" },
  F7: { name: "FIFO clock", analog: "drain the sequencer; playhead returns to 00" },
  F11: { name: "Ayni", analog: "tape wet + dry conserve; receipts.in ≡ receipts.out" },
  F12: { name: "Fail-closed", analog: "zero axis mutes the VCA; master cannot compensate" },
  F18: { name: "Singleton bound", analog: "Euclid hits = n−k+1 on the 16-step lattice" },
  F19: { name: "Λ geometric mean", analog: "13-axis VCA; uniqueness stays Conjecture 1" },
  F22: { name: "Monotone seq", analog: "receipt indices strictly increase" },
};

export interface AxisReading {
  name: AxisName;
  score: number;
  weight: number;
}

export interface KhipuReceipt {
  index: number;
  formula: string;
  scalar: number;
  prev: string;
  hash: string;
  digest: string;
  ts: number;
}

export interface AnalogSense {
  powered: boolean;
  muted: boolean;
  failClosed: boolean;
  patches: PatchCable[];
  master: number;
  pan: number;
  fold: number;
  saturate: number;
  motor: boolean;
  rmsIn: number;
  rmsOut: number;
  loopTax: number;
  withinBudget: boolean;
  receiptAgeMs: number;
  receiptCount: number;
  replayOk: boolean;
  seqIncreasing: boolean;
  hasGates: boolean;
  analyserLive: boolean;
}

export interface KernelState {
  axes: AxisReading[];
  lambda: number;
  lambdaMin: number;
  lambdaMax: number;
  boundHolds: boolean;
  uniqueness: "CONJECTURE 1 OPEN";
  failClosed: boolean;
  receipts: KhipuReceipt[];
  rootHash: string;
  replayOk: boolean;
  loopCycle: number;
  loopTax: number;
  withinBudget: boolean;
  yarqaLeak: number;
  energy: "UNAVAILABLE";
  signer: "UNSIGNED-honest";
  puriqRunning: boolean;
  haltReason: string | null;
  organs: Record<OrganId, boolean>;
  lockedLive: Record<LockedId, boolean>;
}

export function emptyKernel(): KernelState {
  const axes = ORG_AXIS_NAMES.map((name, i) => ({
    name,
    score: 0.9,
    weight: ORG_AXIS_WEIGHTS[i]!,
  }));
  return {
    axes,
    lambda: 0.9,
    lambdaMin: 0.9,
    lambdaMax: 0.9,
    boundHolds: true,
    uniqueness: "CONJECTURE 1 OPEN",
    failClosed: false,
    receipts: [],
    rootHash: GENESIS,
    replayOk: true,
    loopCycle: 0,
    loopTax: 1,
    withinBudget: true,
    yarqaLeak: 0,
    energy: "UNAVAILABLE",
    signer: "UNSIGNED-honest",
    puriqRunning: false,
    haltReason: null,
    organs: {
      BRAIN: false,
      HEART: false,
      BLOOD: false,
      IMMUNE: true,
      SKELETON: false,
      NERVOUS: false,
    },
    lockedLive: {
      F1: false,
      F4: true,
      F7: true,
      F11: true,
      F12: true,
      F18: true,
      F19: true,
      F22: true,
    },
  };
}

function approx(a: number, b: number, eps = EPS) {
  return Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
}

/** F19 family — Λ_w(x) = ∏ xᵢ^{wᵢ}. Zero axis → 0 (A4 zero-absorption). */
export function lambdaAggregate(axes: number[], weights?: number[]): number {
  const xs = axes.map(Number);
  if (!xs.length) throw new Error("axes must be non-empty");
  if (xs.some((x) => x < 0)) throw new Error("axes must be non-negative");
  const k = xs.length;
  const ws = weights ?? Array.from({ length: k }, () => 1 / k);
  if (ws.length !== k) throw new Error("weights length must match axes");
  const sw = ws.reduce((a, b) => a + b, 0);
  if (!approx(sw, 1)) throw new Error(`weights must sum to 1 (got ${sw})`);
  if (xs.some((x) => x === 0)) return 0;
  let acc = 0;
  for (let i = 0; i < k; i++) acc += ws[i]! * Math.log(xs[i]!);
  return Math.exp(acc);
}

export function lambdaHomogeneous(c: number, x: number[]): boolean {
  if (c < 0) throw new Error("c must be >= 0");
  return approx(lambdaAggregate(x.map((xi) => c * xi)), c * lambdaAggregate(x));
}

export function lambdaBounded(x: number[]): boolean {
  return lambdaAggregate(x) <= Math.max(...x) + EPS;
}

export function pacBayesMcallester(empiricalRisk: number, kl: number, n: number, delta: number): number {
  if (n <= 0) throw new Error("n must be positive");
  if (!(delta > 0 && delta < 1)) throw new Error("delta must be in (0,1)");
  if (kl < 0) throw new Error("KL divergence must be >= 0");
  const complexity = (kl + Math.log((2 * Math.sqrt(n)) / delta)) / (2 * n);
  return empiricalRisk + Math.sqrt(Math.max(0, complexity));
}

export function bekensteinCascade(R: number, E: number): number {
  if (R < 0 || E < 0) throw new Error("R and E must be >= 0");
  const hbar = 1.054571817e-34;
  const c = 299792458;
  return (2 * Math.PI * R * E) / (hbar * c);
}

export function reidemeisterInvariant(braidWord: string, move: "R1" | "R2" | "R3"): string {
  const pairs = (a: string, b: string) => a.toLowerCase() === b.toLowerCase() && a !== b;
  if (move === "R1" || move === "R2") {
    const out: string[] = [];
    for (const ch of braidWord) {
      if (out.length && pairs(out[out.length - 1]!, ch)) out.pop();
      else out.push(ch);
    }
    return out.join("");
  }
  for (let i = 0; i < braidWord.length - 2; i++) {
    const a = braidWord[i]!;
    const b = braidWord[i + 1]!;
    const c = braidWord[i + 2]!;
    if (a === c && a !== b) return braidWord.slice(0, i) + b + a + b + braidWord.slice(i + 3);
  }
  return braidWord;
}

export function khipuMerkleRoot(receipts: { decision_id: string; value: number }[]): string {
  const leaf: string[] = [];
  let total = 0;
  for (const r of receipts) {
    total += r.value | 0;
    leaf.push(sha256Hex(`${r.decision_id}|${r.value | 0}`));
  }
  leaf.sort();
  return sha256Hex(`khipu|${leaf.join("|")}|${total}`);
}

export function dsseEnvelope(payload: string, signer: string) {
  const pae = `DSSEv1 24 application/vnd.szl+json ${payload.length} ${payload}`;
  return {
    payloadType: "application/vnd.szl+json",
    payload,
    signatures: [{ keyid: signer, sig: `PLACEHOLDER:${sha256Hex(pae)}` }],
  };
}

export function gleasonQuantumLambda(state: number[][]): number {
  const n = state.length;
  let s = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) s += (state[i]?.[j] ?? 0) * (state[j]?.[i] ?? 0);
  }
  return s;
}

export function hoeffdingTail(t: number, n: number): number {
  if (n <= 0) throw new Error("n must be positive");
  if (t < 0) throw new Error("t must be >= 0");
  return Math.min(1, 2 * Math.exp(-2 * n * t * t));
}

export function pinskerKlBound(p: number[], q: number[]): number {
  if (p.length !== q.length) throw new Error("p and q must have equal length");
  const tv = 0.5 * p.reduce((s, pi, i) => s + Math.abs(pi - (q[i] ?? 0)), 0);
  return 2 * tv * tv;
}

export function fisherRaoDistance(p: number[], q: number[]): number {
  if (p.length !== q.length) throw new Error("p and q must have equal length");
  let bc = 0;
  for (let i = 0; i < p.length; i++) bc += Math.sqrt(Math.max(0, p[i]!) * Math.max(0, q[i]!));
  bc = Math.min(1, Math.max(-1, bc));
  return 2 * Math.acos(bc);
}

export function bohrComplementarityFloor(sigmaA: number, sigmaB: number): boolean {
  if (sigmaA < 0 || sigmaB < 0) throw new Error("std deviations must be >= 0");
  return sigmaA * sigmaB >= 0.25 - EPS;
}

export function reedSolomonSingleton(n: number, k: number): number {
  if (n <= 0 || k <= 0 || k > n) throw new Error("require 0 < k <= n");
  return n - k + 1;
}

export function madhavaSeries(x: number, terms: number): number {
  if (terms <= 0) throw new Error("terms must be positive");
  if (Math.abs(x) > 1) throw new Error("Madhava atan series requires |x| <= 1");
  let total = 0;
  for (let m = 0; m < terms; m++) {
    total += ((-1) ** m) * x ** (2 * m + 1) / (2 * m + 1);
  }
  return total;
}

export function schurConcaveLambdaTwoAxis(x1: number, x2: number): boolean {
  if (x1 < 0 || x2 < 0) throw new Error("axes must be >= 0");
  const m = (x1 + x2) / 2;
  return lambdaAggregate([m, m]) >= lambdaAggregate([x1, x2]) - EPS;
}

export const REGISTRY = {
  lambda_aggregate: lambdaAggregate,
  lambda_homogeneous: lambdaHomogeneous,
  lambda_bounded: lambdaBounded,
  pac_bayes_mcallester: pacBayesMcallester,
  bekenstein_cascade: bekensteinCascade,
  reidemeister_invariant: reidemeisterInvariant,
  khipu_merkle_root: khipuMerkleRoot,
  dsse_envelope: dsseEnvelope,
  gleason_quantum_lambda: gleasonQuantumLambda,
  hoeffding_tail: hoeffdingTail,
  pinsker_kl_bound: pinskerKlBound,
  fisher_rao_distance: fisherRaoDistance,
  bohr_complementarity_floor: bohrComplementarityFloor,
  reed_solomon_singleton: reedSolomonSingleton,
  madhava_series: madhavaSeries,
  schur_concave_lambda_two_axis: schurConcaveLambdaTwoAxis,
};

export const PROOF_STATUS: Record<string, string> = {
  lambda_aggregate: "PROVEN(A1-A4); uniqueness CONJECTURE",
  lambda_homogeneous: "AXIOM(A2)",
  lambda_bounded: "PROVEN(A4, Bound.lean)",
  pac_bayes_mcallester: "SORRY(PACBayes)",
  bekenstein_cascade: "PROVEN(TH6 DPI form); dimensional helper",
  reidemeister_invariant: "AXIOM(r1/r2/audit_reidemeister_invariance)",
  khipu_merkle_root: "PROVEN(TH11 SummationInvariant)",
  dsse_envelope: "PROVEN(structure); signature PLACEHOLDER",
  gleason_quantum_lambda: "AXIOM(gleason_length_mod_8)",
  hoeffding_tail: "PROVEN(MomentSubGaussian)",
  pinsker_kl_bound: "AXIOM(pinsker)",
  fisher_rao_distance: "PROVEN(closed-form)",
  bohr_complementarity_floor: "PROVEN(inequality)",
  reed_solomon_singleton: "PROVEN(Singleton bound)",
  madhava_series: "PROVEN(alternating series)",
  schur_concave_lambda_two_axis: "AXIOM(n-axis); 2-axis PROVEN",
};

export function registryCount() {
  return Object.keys(REGISTRY).length;
}

export function canalOf(port: string): "voice" | "tape" | "out" {
  if ((YARQA_CANALS.voice as string[]).includes(port)) return "voice";
  if ((YARQA_CANALS.tape as string[]).includes(port)) return "tape";
  return "out";
}

/** Cross-canal mass. Leak is the bound — not forbidden. */
export function yarqaLeak(patches: { from: string; to: string }[]): number {
  if (!patches.length) return 0;
  let leak = 0;
  for (const p of patches) if (canalOf(p.from) !== canalOf(p.to)) leak++;
  return leak / patches.length;
}

/** Instant (delayless) cycles — analog F4. Tape feedback is a canal, not a crime. */
export function instantCycles(patches: { from: string; to: string }[]): { from: string; to: string }[] {
  const dual: Record<string, string[]> = {
    vcfout: ["vcf"],
    vca: ["vca"],
    out: ["out", "vca"],
  };
  return patches.filter((p) => (dual[p.from] ?? []).includes(p.to));
}

export function fifoOk<T>(msgs: T[]): boolean {
  const q = [...msgs];
  const out: T[] = [];
  while (q.length) out.push(q.shift() as T);
  return out.length === msgs.length && out.every((v, i) => v === msgs[i]);
}

export function ayniOk(inn: number, out: number): boolean {
  return Math.abs(inn - out) < 1e-9;
}

export function seqStrictlyIncreasing(seq: number[]): boolean {
  return seq.every((v, i) => i === 0 || v > seq[i - 1]!);
}

/** Ouroboros loop tax. Energy is UNAVAILABLE — never fabricate a joule. */
export function loopTaxGain(cycle: number, maxBudget = 16): { gain: number; withinBudget: boolean; exit: string } {
  const withinBudget = cycle < maxBudget;
  const gain = Math.max(0.38, 1 / (1 + cycle * 0.045));
  const exit = !withinBudget ? "budgetExhausted" : cycle === 0 ? "idle" : "converged";
  return { gain, withinBudget, exit };
}

export function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

function floorTrust(x: number) {
  return Math.min(0.97, Math.max(0, x));
}

export function senseYuyay(s: AnalogSense): AxisReading[] {
  const chain =
    s.patches.some((p) => p.from === "vco" && (p.to === "vcf" || p.to === "vca" || p.to === "out")) &&
    s.patches.some((p) => p.to === "out");
  const soundness = floorTrust(chain ? 0.94 : s.patches.length ? 0.62 : 0.28);
  const drift = Math.abs(s.rmsIn - s.rmsOut);
  const calibration = floorTrust(0.97 - clamp01(drift * 2.4) * 0.22);
  const robustness = floorTrust(0.96 - ((s.fold + s.saturate) / 2) * 0.18);
  const provenance = floorTrust(s.replayOk ? (s.receiptCount ? 0.93 : 0.8) : 0.55);
  const consent = s.failClosed ? 0 : 0.95;
  const reversibility = floorTrust(s.motor ? 0.93 : 0.84);
  const transparency = floorTrust(s.analyserLive ? 0.94 : 0.48);
  const fairness = floorTrust(0.96 - Math.abs(s.pan) * 0.22);
  const containment = floorTrust(s.withinBudget ? 0.7 + s.loopTax * 0.26 : 0.42);
  const attestation = 0.88;
  const freshness = floorTrust(
    s.receiptCount === 0 ? 0.78 : s.receiptAgeMs < 1800 ? 0.94 : Math.max(0.55, 0.94 - s.receiptAgeMs / 24000),
  );
  const authority = floorTrust(s.powered ? 0.72 + s.master * 0.22 : 0.36);
  const auditability = floorTrust(s.seqIncreasing ? 0.93 : 0.58);

  const scores: Record<AxisName, number> = {
    soundness,
    calibration,
    robustness,
    provenance,
    consent,
    reversibility,
    transparency,
    fairness,
    containment,
    attestation,
    freshness,
    authority,
    auditability,
  };
  return ORG_AXIS_NAMES.map((name, i) => ({
    name,
    score: scores[name],
    weight: ORG_AXIS_WEIGHTS[i]!,
  }));
}

export function organsFromSense(
  s: AnalogSense,
  leak: number,
): Record<OrganId, boolean> {
  return {
    BRAIN: s.powered && s.master > 0.05,
    HEART: s.motor,
    BLOOD: s.patches.length > 0 && leak < 0.85,
    IMMUNE: !s.failClosed,
    SKELETON: s.hasGates,
    NERVOUS: s.analyserLive,
  };
}

export function lockedLiveFromSense(
  s: AnalogSense,
  receipts: KhipuReceipt[],
  leak: number,
): Record<LockedId, boolean> {
  const idxs = receipts.map((r) => r.index);
  return {
    F1: s.replayOk && receipts.length > 0,
    F4: instantCycles(s.patches).length === 0,
    F7: true,
    F11: ayniOk(1, 1) && leak <= 1,
    F12: !s.failClosed,
    F18: true,
    F19: !s.failClosed,
    F22: seqStrictlyIncreasing(idxs) || idxs.length <= 1,
  };
}

export function foldKernel(s: AnalogSense, prev: KernelState, cycle: number): KernelState {
  const axes = senseYuyay(s);
  const xs = axes.map((a) => a.score);
  const ws = axes.map((a) => a.weight);
  const lambda = lambdaAggregate(xs, ws);
  const lambdaMin = Math.min(...xs);
  const lambdaMax = Math.max(...xs);
  const tax = loopTaxGain(cycle);
  const leak = yarqaLeak(s.patches);
  const failClosed = s.failClosed || lambda === 0;
  return {
    ...prev,
    axes,
    lambda,
    lambdaMin,
    lambdaMax,
    boundHolds: lambdaMin - 1e-9 <= lambda && lambda <= lambdaMax + 1e-9,
    uniqueness: "CONJECTURE 1 OPEN",
    failClosed,
    loopCycle: cycle,
    loopTax: tax.gain,
    withinBudget: tax.withinBudget,
    yarqaLeak: leak,
    energy: "UNAVAILABLE",
    signer: "UNSIGNED-honest",
    organs: organsFromSense({ ...s, failClosed }, leak),
    lockedLive: lockedLiveFromSense({ ...s, failClosed }, prev.receipts, leak),
  };
}

export function receiptHash(prev: string, idx: number, name: string, argsDigest: string, scalar: number): string {
  return sha256Hex(`${prev}|${idx}|${name}|${argsDigest}|${scalar.toFixed(9)}`);
}

export function argsDigest(name: string, args: unknown): string {
  return sha256Hex(`${name}|${JSON.stringify(args)}`);
}

export function appendReceipt(
  receipts: KhipuReceipt[],
  formula: string,
  scalar: number,
  extra: unknown = {},
): KhipuReceipt[] {
  const prev = receipts.at(-1)?.hash ?? GENESIS;
  const index = receipts.length ? receipts[receipts.length - 1]!.index + 1 : 0;
  const digest = argsDigest(formula, extra);
  const hash = receiptHash(prev, index, formula, digest, scalar);
  return [...receipts, { index, formula, scalar, prev, hash, digest, ts: Date.now() }].slice(-16);
}

export function verifyReceipts(receipts: KhipuReceipt[]): boolean {
  let prev = GENESIS;
  for (const r of receipts) {
    if (r.prev !== prev) return false;
    const expected = receiptHash(prev, r.index, r.formula, r.digest, r.scalar);
    if (expected !== r.hash) return false;
    prev = r.hash;
  }
  return true;
}

export interface FormulaCall {
  formula_name: string;
  args: unknown[];
}

export interface GovernedChain {
  receipts: { formula_name: string; scalar: number; hash: string; ok: boolean }[];
  lambda: number;
  halted: boolean;
  halt_reason: string | null;
  lambda_label: string;
}

const RISK_LIKE = new Set(["pac_bayes_mcallester", "hoeffding_tail", "pinsker_kl_bound", "fisher_rao_distance", "bekenstein_cascade"]);
const STRUCTURAL = new Set(["reed_solomon_singleton"]);

function toScalar(out: unknown, name: string): number {
  if (STRUCTURAL.has(name)) return 1;
  let base = 0.5;
  if (typeof out === "boolean") base = out ? 1 : 0;
  else if (typeof out === "number" && Number.isFinite(out)) {
    base = out >= 0 && out <= 1 ? out : out > 1 ? 1 / (1 + Math.abs(out)) : Math.max(0, out);
  } else if (typeof out === "string") {
    const n = parseInt(out.slice(0, 8), 16);
    base = Number.isFinite(n) ? (n % 1_000_000) / 1_000_000 : 0.5;
  }
  if (RISK_LIKE.has(name)) return clamp01(1 - base);
  return clamp01(base);
}

export function runGovernedLoop(calls: FormulaCall[]): GovernedChain {
  const receipts: GovernedChain["receipts"] = [];
  const scalars: number[] = [];
  let prev = GENESIS;
  let halted = false;
  let halt_reason: string | null = null;

  for (let idx = 0; idx < calls.length; idx++) {
    const call = calls[idx]!;
    const fn = (REGISTRY as Record<string, ((...a: unknown[]) => unknown) | undefined>)[call.formula_name];
    if (!fn) {
      halted = true;
      halt_reason = `unknown formula: ${call.formula_name}`;
      break;
    }
    let out: unknown;
    try {
      out = fn(...call.args);
    } catch (err) {
      halted = true;
      halt_reason = `step ${idx} (${call.formula_name}) raised: ${err instanceof Error ? err.message : "err"}`;
      break;
    }
    const scalar = toScalar(out, call.formula_name);
    const running = lambdaAggregate([...scalars, scalar]);
    const ok = scalar >= 0 && scalar <= 1 && running >= 0.5 - EPS;
    const hash = receiptHash(prev, idx, call.formula_name, argsDigest(call.formula_name, call.args), scalar);
    receipts.push({ formula_name: call.formula_name, scalar, hash, ok });
    if (!ok) {
      halted = true;
      halt_reason = `step ${idx} (${call.formula_name}) HALT on axis_floor`;
      break;
    }
    scalars.push(scalar);
    prev = hash;
  }

  return {
    receipts,
    lambda: scalars.length ? lambdaAggregate(scalars) : 0,
    halted,
    halt_reason,
    lambda_label: LAMBDA_LABEL,
  };
}

export function braidFromPatches(patches: { from: string; to: string }[]): string {
  const letters = "abcdefghijklmnop";
  return patches
    .map((p, i) => {
      const a = p.from.charCodeAt(0) % 8;
      const b = p.to.charCodeAt(0) % 8;
      const ch = letters[(a + b + i) % letters.length]!;
      return i % 2 === 0 ? ch : ch.toUpperCase();
    })
    .join("");
}

export function rmsFromAnalyser(analyser: AnalyserNode | null): number {
  if (!analyser) return 0;
  const buf = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = ((buf[i] ?? 128) - 128) / 128;
    s += x * x;
  }
  return Math.sqrt(s / buf.length);
}

const SHA_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

export function sha256Hex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  const bitLen = bytes.length * 8;
  const withPad = bytes.length + 1 + 8;
  const blocks = ((withPad + 63) >> 6) * 64;
  const buf = new Uint8Array(blocks);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(blocks - 4, bitLen, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  const rr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let i = 0; i < blocks; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4, false);
    for (let t = 16; t < 64; t++) {
      const s0 = rr(w[t - 15]!, 7) ^ rr(w[t - 15]!, 18) ^ (w[t - 15]! >>> 3);
      const s1 = rr(w[t - 2]!, 17) ^ rr(w[t - 2]!, 19) ^ (w[t - 2]! >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA_K[t]! + w[t]!) >>> 0;
      const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, "0")).join("");
}
