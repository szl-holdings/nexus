export type Waveform = "sine" | "triangle" | "sawtooth" | "square" | "pluck";
export type ScopeMode = "yt" | "xy" | "fft";
export type AnalogMode = "ic" | "op" | "halt" | "rep";

export type PortId =
  | "vco"
  | "noise"
  | "lfo"
  | "grid"
  | "tape"
  | "vcfout"
  | "sh"
  | "anlg"
  | "func"
  | "vcf"
  | "vca"
  | "delay"
  | "pan"
  | "tapein"
  | "scope"
  | "out";

export type ModuleId = "grid" | "scope" | "tape" | "patch" | "seq" | "voice";

export interface VoiceParams {
  waveform: Waveform;
  morph: number;
  cutoff: number;
  resonance: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  unison: number;
  detune: number;
  fmIndex: number;
  pan: number;
  glide: number;
  gain: number;
  fold: number;
  lfoRate: number;
  lfoDepth: number;
  shAmt: number;
  ring: number;
}

export interface AnalogParams {
  rate: number;
  chaos: number;
  drive: number;
  cycle: boolean;
  mode: AnalogMode;
}

export interface TapeParams {
  time: number;
  feedback: number;
  wow: number;
  flutter: number;
  mix: number;
  saturate: number;
  motor: boolean;
  rec: boolean;
}

export interface SeqStep {
  gate: boolean;
  note: number;
  accent: boolean;
  slide: boolean;
  prob: number;
}

export interface SeqParams {
  bpm: number;
  swing: number;
  playing: boolean;
  euclidHits: number;
  euclidSteps: number;
  euclidRot: number;
  probability: number;
  scale: "penta" | "minor" | "chromatic";
  arp: boolean;
}

export interface PatchCable {
  id: string;
  from: PortId;
  to: PortId;
}

export interface Scene {
  voice: VoiceParams;
  tape: TapeParams;
  seq: SeqParams;
  analog: AnalogParams;
  steps: SeqStep[];
  grid: boolean[][];
  patches: PatchCable[];
  orbit: number;
  scopeMode: ScopeMode;
  frontier: boolean;
}

export const SCALE_PENTA = [36, 39, 41, 43, 46, 48, 51, 53];
export const SCALE_MINOR = [36, 38, 39, 41, 43, 44, 46, 48];
export const SCALE_CHROMATIC = [36, 37, 38, 39, 40, 41, 42, 43];

export const COLS = 16;
export const ROWS = 8;
export const SCENE_COUNT = 8;

export const DEFAULT_VOICE: VoiceParams = {
  waveform: "sawtooth",
  morph: 0.35,
  cutoff: 1800,
  resonance: 6,
  attack: 0.012,
  decay: 0.18,
  sustain: 0.55,
  release: 0.28,
  unison: 1,
  detune: 8,
  fmIndex: 0,
  pan: 0,
  glide: 0.02,
  gain: 0.7,
  fold: 0,
  lfoRate: 0.35,
  lfoDepth: 0.12,
  shAmt: 0,
  ring: 0,
};

export const DEFAULT_ANALOG: AnalogParams = {
  rate: 0.62,
  chaos: 0.58,
  drive: 0.72,
  cycle: true,
  mode: "op",
};

export const DEFAULT_TAPE: TapeParams = {
  time: 0.32,
  feedback: 0.42,
  wow: 0.22,
  flutter: 0.12,
  mix: 0.28,
  saturate: 0.45,
  motor: false,
  rec: false,
};

export const DEFAULT_SEQ: SeqParams = {
  bpm: 112,
  swing: 0.08,
  playing: false,
  euclidHits: 5,
  euclidSteps: 16,
  euclidRot: 0,
  probability: 1,
  scale: "penta",
  arp: false,
};

export function emptyGrid(): boolean[][] {
  const g = Array.from({ length: COLS }, () => Array.from({ length: ROWS }, () => false));
  const pat = [0, 3, 0, 5, 0, 3, 7, 5, 0, 3, 0, 5, 2, 3, 5, 7];
  pat.forEach((row, c) => {
    const col = g[c];
    if (!col) return;
    col[row % ROWS] = true;
    if (c % 4 === 0) col[4] = true;
  });
  return g;
}

export function emptySteps(): SeqStep[] {
  return Array.from({ length: COLS }, (_, i) => ({
    gate: i % 4 === 0,
    note: 0,
    accent: i % 8 === 0,
    slide: false,
    prob: 1,
  }));
}

export const DEFAULT_PATCHES: PatchCable[] = [
  { id: "p1", from: "vco", to: "vcf" },
  { id: "p2", from: "vcfout", to: "delay" },
  { id: "p3", from: "tape", to: "vca" },
  { id: "p4", from: "vca", to: "out" },
];

export const FRONTIER_PATCHES: PatchCable[] = [
  { id: "p1", from: "vco", to: "vcf" },
  { id: "p2", from: "vcfout", to: "delay" },
  { id: "p3", from: "tape", to: "vca" },
  { id: "p4", from: "vca", to: "out" },
  { id: "pf-anlg", from: "anlg", to: "vcf" },
  { id: "pf-func", from: "func", to: "pan" },
  { id: "pf-sh", from: "sh", to: "vcf" },
];

export const PORT_META: Record<
  PortId,
  { label: string; kind: "src" | "dst"; row: number; col: number }
> = {
  vco: { label: "VCO", kind: "src", row: 0, col: 0 },
  noise: { label: "NOISE", kind: "src", row: 0, col: 1 },
  lfo: { label: "LFO", kind: "src", row: 0, col: 2 },
  grid: { label: "GRID", kind: "src", row: 0, col: 3 },
  tape: { label: "TAPE", kind: "src", row: 0, col: 4 },
  vcfout: { label: "VCF", kind: "src", row: 0, col: 5 },
  sh: { label: "S&H", kind: "src", row: 0, col: 6 },
  anlg: { label: "ANLG", kind: "src", row: 0, col: 7 },
  func: { label: "FUNC", kind: "src", row: 0, col: 8 },
  vcf: { label: "VCF IN", kind: "dst", row: 1, col: 0 },
  vca: { label: "VCA", kind: "dst", row: 1, col: 1 },
  delay: { label: "DELAY", kind: "dst", row: 1, col: 2 },
  pan: { label: "PAN", kind: "dst", row: 1, col: 3 },
  tapein: { label: "TAPE IN", kind: "dst", row: 1, col: 4 },
  scope: { label: "SCOPE", kind: "dst", row: 1, col: 5 },
  out: { label: "OUT", kind: "dst", row: 1, col: 6 },
};

export const SOURCE_PORTS: PortId[] = ["vco", "noise", "lfo", "grid", "tape", "vcfout", "sh", "anlg", "func"];
export const DEST_PORTS: PortId[] = ["vcf", "vca", "delay", "pan", "tapein", "scope", "out"];
