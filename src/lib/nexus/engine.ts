import {
  COLS,
  DEFAULT_PATCHES,
  DEFAULT_SEQ,
  DEFAULT_TAPE,
  DEFAULT_VOICE,
  DEST_PORTS,
  emptyGrid,
  emptySteps,
  ROWS,
  SCALE_CHROMATIC,
  SCALE_MINOR,
  SCALE_PENTA,
  SCENE_COUNT,
  SOURCE_PORTS,
  type PatchCable,
  type PortId,
  type Scene,
  type ScopeMode,
  type SeqParams,
  type SeqStep,
  type TapeParams,
  type VoiceParams,
  type Waveform,
} from "./types";
import { loadPersisted, scheduleSave, type PersistedState } from "./store";

export interface EngineSnapshot {
  powered: boolean;
  ready: boolean;
  voice: VoiceParams;
  tape: TapeParams;
  seq: SeqParams;
  steps: SeqStep[];
  grid: boolean[][];
  patches: PatchCable[];
  master: number;
  muted: boolean;
  activeNotes: number;
  heldKeys: number[];
  module: "grid" | "scope" | "tape" | "patch" | "seq" | "voice";
  scopeMode: ScopeMode;
  orbit: number;
  sceneSlot: number;
  scenes: (Scene | null)[];
  bouncing: boolean;
  version: number;
}

type Listener = () => void;

const MORPH_PAIRS: Record<Waveform, [OscillatorType, OscillatorType]> = {
  sine: ["sine", "triangle"],
  triangle: ["triangle", "sawtooth"],
  sawtooth: ["sawtooth", "square"],
  square: ["square", "sine"],
  pluck: ["triangle", "sawtooth"],
};

function midiToHz(m: number) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function euclid(hits: number, steps: number, rot: number): boolean[] {
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

function makeSpringImpulse(ctx: AudioContext) {
  const len = Math.floor(ctx.sampleRate * 1.85);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const ch = buf.getChannelData(c);
    const comb = Math.floor(ctx.sampleRate * (0.018 + c * 0.003));
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      const env = Math.exp(-t * 2.2);
      const ping = Math.sin(t * (1620 + c * 90)) * Math.exp(-t * 7.5);
      let s = (Math.random() * 2 - 1) * env * 0.28 + ping * 0.12;
      if (comb > 0 && i > comb) s += (ch[i - comb] ?? 0) * 0.35;
      ch[i] = s;
    }
  }
  return buf;
}

function makeFoldCurve(amount: number) {
  const n = 2048;
  const curve = new Float32Array(n);
  const drive = 1 + amount * 6.5;
  const stages = Math.max(1, Math.round(1 + amount * 5));
  for (let i = 0; i < n; i++) {
    let x = ((i / (n - 1)) * 2 - 1) * drive;
    for (let s = 0; s < stages; s++) {
      if (x > 1) x = 2 - x;
      else if (x < -1) x = -2 - x;
    }
    curve[i] = Math.tanh(x * (0.85 + amount * 0.4));
  }
  return curve;
}

function makeClipCurve(amount: number) {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = 1 + amount * 6;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * k);
  }
  return curve;
}

function scaleFor(kind: SeqParams["scale"]) {
  if (kind === "minor") return SCALE_MINOR;
  if (kind === "chromatic") return SCALE_CHROMATIC;
  return SCALE_PENTA;
}

interface VoiceSlot {
  busy: boolean;
  midi: number;
  born: number;
  oscs: OscillatorNode[];
  noise: AudioBufferSourceNode | null;
  env: GainNode;
  filterA: BiquadFilterNode;
  filterB: BiquadFilterNode;
  pan: StereoPannerNode;
  stopAt: number;
}

class NexusEngine {
  private listeners = new Set<Listener>();
  private ctx: AudioContext | null = null;
  private voiceMix!: GainNode;
  private vcfIn!: GainNode;
  private filterA!: BiquadFilterNode;
  private filterB!: BiquadFilterNode;
  private vcfSend!: GainNode;
  private vcoSend!: GainNode;
  private vcfSendOut!: GainNode;
  private tapeSend!: GainNode;
  private lfoSend!: GainNode;
  private tapeIn!: GainNode;
  private delayL!: DelayNode;
  private delayR!: DelayNode;
  private tapeFb!: GainNode;
  private tapeClip!: WaveShaperNode;
  private tapeOut!: GainNode;
  private tapeDry!: GainNode;
  private tapeWet!: GainNode;
  private vca!: GainNode;
  private preMaster!: GainNode;
  private masterGain!: GainNode;
  private compressor!: DynamicsCompressorNode;
  private analyser!: AnalyserNode;
  private analyserL!: AnalyserNode;
  private analyserR!: AnalyserNode;
  private vuIn!: AnalyserNode;
  private vuOut!: AnalyserNode;
  private orbitConv!: ConvolverNode;
  private orbitGain!: GainNode;
  private masterPan!: StereoPannerNode;
  private noiseSrc!: AudioBufferSourceNode;
  private noiseOut!: GainNode;
  private lfo!: OscillatorNode;
  private lfoOut!: GainNode;
  private wowOsc!: OscillatorNode;
  private flutterOsc!: OscillatorNode;
  private wowGain!: GainNode;
  private flutterGain!: GainNode;
  private gridOut!: GainNode;
  private seqClick!: GainNode;
  private cutoffMod!: GainNode;
  private foldShaper!: WaveShaperNode;
  private foldDry!: GainNode;
  private foldWet!: GainNode;
  private foldMix!: GainNode;
  private ringOsc!: OscillatorNode;
  private ringVca!: GainNode;
  private ringDry!: GainNode;
  private ringWet!: GainNode;
  private ringMix!: GainNode;
  private shHold!: ConstantSourceNode;
  private shOut!: GainNode;
  private shAmtGain!: GainNode;
  private bounceDest: MediaStreamAudioDestinationNode | null = null;
  private bounceTimer = 0;
  private nodes: Partial<Record<PortId, AudioNode>> = {};
  private paramTargets: Partial<Record<PortId, AudioParam>> = {};
  private live: AudioNode[] = [];
  private slots: VoiceSlot[] = [];
  private nextNoteTime = 0;
  private stepIndex = 0;
  private raf = 0;
  private saveQueued = false;
  snapshot: EngineSnapshot = {
    powered: false,
    ready: false,
    voice: { ...DEFAULT_VOICE },
    tape: { ...DEFAULT_TAPE },
    seq: { ...DEFAULT_SEQ },
    steps: emptySteps(),
    grid: emptyGrid(),
    patches: DEFAULT_PATCHES.map((p) => ({ ...p })),
    master: 0.72,
    muted: false,
    activeNotes: 0,
    heldKeys: [],
    module: "grid",
    scopeMode: "yt",
    orbit: 0.16,
    sceneSlot: 0,
    scenes: Array.from({ length: SCENE_COUNT }, () => null),
    bouncing: false,
    version: 0,
  };

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => this.snapshot;

  private emit(partial: Partial<EngineSnapshot> = {}) {
    this.snapshot = {
      ...this.snapshot,
      ...partial,
      voice: partial.voice ?? this.snapshot.voice,
      tape: partial.tape ?? this.snapshot.tape,
      seq: partial.seq ?? this.snapshot.seq,
      version: this.snapshot.version + 1,
    };
    for (const l of this.listeners) l();
    this.queueSave();
  }

  private queueSave() {
    if (this.saveQueued) return;
    this.saveQueued = true;
    if (typeof window === "undefined") return;
    window.setTimeout(() => {
      this.saveQueued = false;
      scheduleSave(this.persistNow());
    }, 80);
  }

  async hydrate() {
    const data = await loadPersisted();
    if (!data || this.snapshot.powered) return;
    const savedGrid = data.grid?.length === COLS ? data.grid : emptyGrid();
    const lit = savedGrid.some((col) => col.some(Boolean));
    this.snapshot = {
      ...this.snapshot,
      voice: { ...DEFAULT_VOICE, ...data.voice },
      tape: { ...DEFAULT_TAPE, ...data.tape, motor: false, rec: false },
      seq: { ...DEFAULT_SEQ, ...data.seq, playing: false },
      steps: data.steps?.length === COLS ? data.steps : this.snapshot.steps,
      grid: lit ? savedGrid : emptyGrid(),
      patches: data.patches?.length ? data.patches : this.snapshot.patches,
      master: data.master ?? this.snapshot.master,
      orbit: data.orbit ?? this.snapshot.orbit,
      scopeMode: data.scopeMode ?? this.snapshot.scopeMode,
      scenes: data.scenes?.length === SCENE_COUNT ? data.scenes : this.snapshot.scenes,
      sceneSlot: data.sceneSlot ?? 0,
      version: this.snapshot.version + 1,
    };
    for (const l of this.listeners) l();
  }

  getCtx() {
    return this.ctx;
  }
  getAnalyser() {
    return this.analyser;
  }
  getAnalyserL() {
    return this.analyserL;
  }
  getAnalyserR() {
    return this.analyserR;
  }
  getVuIn() {
    return this.vuIn;
  }
  getVuOut() {
    return this.vuOut;
  }
  getPlayhead() {
    return this.stepIndex;
  }

  async powerOn() {
    if (this.snapshot.powered && this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: "interactive" });
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.buildGraph();
    this.applyVoice();
    this.applyTape();
    this.applyOrbit();
    this.applyMaster();
    this.rebuildPatches();
    this.loop();
    document.addEventListener("visibilitychange", this.onVis);
    const lit = this.snapshot.grid.some((col) => col.some(Boolean));
    if (!lit) this.snapshot.grid = emptyGrid();
    this.emit({ powered: true, ready: true });
  }

  private onVis = () => {
    if (document.visibilityState === "visible" && this.ctx?.state === "suspended") {
      void this.ctx.resume();
    }
  };

  private buildGraph() {
    const ctx = this.ctx!;
    this.voiceMix = ctx.createGain();
    this.voiceMix.gain.value = 1;
    this.vcfIn = ctx.createGain();
    this.filterA = ctx.createBiquadFilter();
    this.filterA.type = "lowpass";
    this.filterB = ctx.createBiquadFilter();
    this.filterB.type = "lowpass";
    this.vcfSend = ctx.createGain();
    this.vcfSend.gain.value = 1;
    this.tapeIn = ctx.createGain();
    this.delayL = ctx.createDelay(2.5);
    this.delayR = ctx.createDelay(2.5);
    this.tapeFb = ctx.createGain();
    this.tapeClip = ctx.createWaveShaper();
    this.tapeClip.curve = makeClipCurve(0.45);
    this.tapeClip.oversample = "2x";
    this.tapeOut = ctx.createGain();
    this.tapeDry = ctx.createGain();
    this.tapeWet = ctx.createGain();
    this.vca = ctx.createGain();
    this.preMaster = ctx.createGain();
    this.masterGain = ctx.createGain();
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -12;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.18;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.18;
    this.vuIn = ctx.createAnalyser();
    this.vuIn.fftSize = 512;
    this.vuOut = ctx.createAnalyser();
    this.vuOut.fftSize = 512;
    this.masterPan = ctx.createStereoPanner();
    this.noiseOut = ctx.createGain();
    this.noiseOut.gain.value = 0.18;
    this.lfo = ctx.createOscillator();
    this.lfo.type = "sine";
    this.lfo.frequency.value = 0.35;
    this.lfoOut = ctx.createGain();
    this.lfoOut.gain.value = 0;
    this.wowOsc = ctx.createOscillator();
    this.wowOsc.type = "sine";
    this.wowOsc.frequency.value = 0.72;
    this.flutterOsc = ctx.createOscillator();
    this.flutterOsc.type = "sine";
    this.flutterOsc.frequency.value = 6.4;
    this.wowGain = ctx.createGain();
    this.flutterGain = ctx.createGain();
    this.gridOut = ctx.createGain();
    this.gridOut.gain.value = 0.8;
    this.seqClick = ctx.createGain();
    this.seqClick.gain.value = 0.6;
    this.cutoffMod = ctx.createGain();
    this.cutoffMod.gain.value = 0;

    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    this.noiseSrc = ctx.createBufferSource();
    this.noiseSrc.buffer = noiseBuf;
    this.noiseSrc.loop = true;
    this.noiseSrc.connect(this.noiseOut);

    this.vcfIn.connect(this.filterA);
    this.filterA.connect(this.filterB);
    this.filterB.connect(this.vcfSend);
    this.tapeDry.connect(this.tapeOut);
    this.delayL.connect(this.tapeClip);
    this.delayR.connect(this.tapeClip);
    this.tapeClip.connect(this.tapeFb);
    this.tapeFb.connect(this.delayL);
    this.tapeFb.connect(this.delayR);
    this.tapeClip.connect(this.tapeWet);
    this.tapeWet.connect(this.tapeOut);
    this.wowOsc.connect(this.wowGain);
    this.flutterOsc.connect(this.flutterGain);
    this.wowGain.connect(this.delayL.delayTime);
    this.wowGain.connect(this.delayR.delayTime);
    this.flutterGain.connect(this.delayL.delayTime);
    this.flutterGain.connect(this.delayR.delayTime);
    this.lfo.connect(this.lfoOut);
    this.lfoOut.connect(this.cutoffMod);
    this.lfoSend = ctx.createGain();
    this.lfo.connect(this.lfoSend);
    this.cutoffMod.connect(this.filterA.frequency);
    this.cutoffMod.connect(this.filterB.frequency);
    this.preMaster.connect(this.masterPan);
    this.masterPan.connect(this.compressor);
    this.compressor.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);
    this.preMaster.connect(this.analyser);
    this.preMaster.connect(this.vuOut);
    this.voiceMix.connect(this.vuIn);

    this.analyserL = ctx.createAnalyser();
    this.analyserL.fftSize = 2048;
    this.analyserL.smoothingTimeConstant = 0.25;
    this.analyserR = ctx.createAnalyser();
    this.analyserR.fftSize = 2048;
    this.analyserR.smoothingTimeConstant = 0.25;
    const split = ctx.createChannelSplitter(2);
    this.preMaster.connect(split);
    split.connect(this.analyserL, 0);
    split.connect(this.analyserR, 1);

    this.orbitConv = ctx.createConvolver();
    this.orbitConv.buffer = makeSpringImpulse(ctx);
    this.orbitGain = ctx.createGain();
    this.orbitGain.gain.value = 0.16;
    this.preMaster.connect(this.orbitConv);
    this.orbitConv.connect(this.orbitGain);
    this.orbitGain.connect(this.compressor);

    this.vcoSend = ctx.createGain();
    this.vcfSendOut = ctx.createGain();
    this.tapeSend = ctx.createGain();
    this.voiceMix.connect(this.vcoSend);
    this.vcfSend.connect(this.vcfSendOut);
    this.tapeOut.connect(this.tapeSend);

    this.foldShaper = ctx.createWaveShaper();
    this.foldShaper.curve = makeFoldCurve(0);
    this.foldShaper.oversample = "4x";
    this.foldDry = ctx.createGain();
    this.foldDry.gain.value = 1;
    this.foldWet = ctx.createGain();
    this.foldWet.gain.value = 0;
    this.foldMix = ctx.createGain();
    this.ringOsc = ctx.createOscillator();
    this.ringOsc.type = "sine";
    this.ringOsc.frequency.value = 218;
    this.ringVca = ctx.createGain();
    this.ringVca.gain.value = 0;
    this.ringDry = ctx.createGain();
    this.ringDry.gain.value = 1;
    this.ringWet = ctx.createGain();
    this.ringWet.gain.value = 0;
    this.ringMix = ctx.createGain();
    this.shHold = ctx.createConstantSource();
    this.shHold.offset.value = 0;
    this.shOut = ctx.createGain();
    this.shOut.gain.value = 0.85;
    this.shAmtGain = ctx.createGain();
    this.shAmtGain.gain.value = 0;

    try {
      this.voiceMix.disconnect(this.vcoSend);
    } catch {
      /* ok */
    }
    this.voiceMix.connect(this.foldDry);
    this.voiceMix.connect(this.foldShaper);
    this.foldShaper.connect(this.foldWet);
    this.foldDry.connect(this.foldMix);
    this.foldWet.connect(this.foldMix);
    this.foldMix.connect(this.ringDry);
    this.foldMix.connect(this.ringVca);
    this.ringOsc.connect(this.ringVca.gain);
    this.ringVca.connect(this.ringWet);
    this.ringDry.connect(this.ringMix);
    this.ringWet.connect(this.ringMix);
    this.ringMix.connect(this.vcoSend);
    this.shHold.connect(this.shOut);
    this.shHold.connect(this.shAmtGain);
    this.shAmtGain.connect(this.filterA.frequency);
    this.shAmtGain.connect(this.filterB.frequency);

    this.lfo.start();
    this.wowOsc.start();
    this.flutterOsc.start();
    this.noiseSrc.start();
    this.ringOsc.start();
    this.shHold.start();

    this.nodes = {
      vco: this.vcoSend,
      noise: this.noiseOut,
      lfo: this.lfoSend,
      grid: this.gridOut,
      tape: this.tapeSend,
      vcfout: this.vcfSendOut,
      sh: this.shOut,
      vcf: this.vcfIn,
      vca: this.vca,
      delay: this.tapeIn,
      tapein: this.tapeIn,
      scope: this.analyser,
      out: this.preMaster,
    };
    this.paramTargets = {
      vcf: this.filterA.frequency,
      pan: this.masterPan.pan,
    };

    this.slots = Array.from({ length: 6 }, () => this.makeSlot());
  }

  private makeSlot(): VoiceSlot {
    const ctx = this.ctx!;
    const env = ctx.createGain();
    env.gain.value = 0;
    const filterA = ctx.createBiquadFilter();
    filterA.type = "lowpass";
    const filterB = ctx.createBiquadFilter();
    filterB.type = "lowpass";
    const pan = ctx.createStereoPanner();
    env.connect(pan);
    pan.connect(this.voiceMix);
    pan.connect(this.gridOut);
    return {
      busy: false,
      midi: -1,
      born: 0,
      oscs: [],
      noise: null,
      env,
      filterA,
      filterB,
      pan,
      stopAt: 0,
    };
  }

  private rebuildPatches() {
    const srcIds = SOURCE_PORTS;
    for (const id of srcIds) {
      try {
        this.nodes[id]?.disconnect();
      } catch {
        /* already */
      }
    }
    try {
      this.vca.disconnect();
    } catch {
      /* already */
    }
    for (const n of this.live) {
      try {
        n.disconnect();
      } catch {
        /* already */
      }
    }
    this.live = [];
    const patches = this.snapshot.patches;
    for (const p of patches) {
      const src = this.nodes[p.from];
      const dstNode = this.nodes[p.to];
      const dstParam = this.paramTargets[p.to];
      if (!src) continue;
      if ((p.from === "lfo" || p.from === "sh") && dstParam) {
        const g = this.ctx!.createGain();
        g.gain.value = p.to === "pan" ? 0.55 : p.from === "sh" ? 2600 : 900;
        src.connect(g);
        g.connect(dstParam);
        this.live.push(g);
        continue;
      }
      if (dstNode) {
        try {
          src.connect(dstNode);
        } catch {
          /* cycle */
        }
      }
    }
    try {
      this.tapeIn.disconnect();
    } catch {
      /* ok */
    }
    try {
      this.tapeIn.connect(this.delayL);
      this.tapeIn.connect(this.delayR);
      this.tapeIn.connect(this.tapeDry);
    } catch {
      /* ok */
    }
  }

  private applyVoice() {
    if (!this.ctx || !this.foldShaper) return;
    const v = this.snapshot.voice;
    const now = this.ctx.currentTime;
    this.filterA.frequency.setTargetAtTime(v.cutoff, now, 0.04);
    this.filterB.frequency.setTargetAtTime(v.cutoff * 0.96, now, 0.04);
    this.filterA.Q.setTargetAtTime(v.resonance * 0.55, now, 0.05);
    this.filterB.Q.setTargetAtTime(v.resonance * 0.4, now, 0.05);
    this.masterPan.pan.setTargetAtTime(v.pan, now, 0.05);
    this.lfo.frequency.setTargetAtTime(Math.max(0.04, v.lfoRate), now, 0.08);
    this.lfoOut.gain.setTargetAtTime(1, now, 0.08);
    this.cutoffMod.gain.setTargetAtTime(v.lfoDepth * 2200, now, 0.08);
    this.foldShaper.curve = makeFoldCurve(v.fold);
    this.foldWet.gain.setTargetAtTime(v.fold, now, 0.05);
    this.foldDry.gain.setTargetAtTime(Math.max(0.12, 1 - v.fold * 0.78), now, 0.05);
    this.ringWet.gain.setTargetAtTime(v.ring, now, 0.05);
    this.ringDry.gain.setTargetAtTime(Math.max(0.08, 1 - v.ring * 0.88), now, 0.05);
    this.ringOsc.frequency.setTargetAtTime(110 + v.morph * 520, now, 0.1);
    this.shAmtGain.gain.setTargetAtTime(v.shAmt * 3400, now, 0.06);
    for (const s of this.slots) {
      s.filterA.frequency.setTargetAtTime(v.cutoff, now, 0.04);
      s.filterB.frequency.setTargetAtTime(v.cutoff * 0.97, now, 0.04);
      s.filterA.Q.setTargetAtTime(Math.max(0.2, v.resonance * 0.7), now, 0.05);
      s.filterB.Q.setTargetAtTime(Math.max(0.2, v.resonance * 0.45), now, 0.05);
      s.pan.pan.setTargetAtTime(v.pan, now, 0.05);
    }
  }

  private applyTape() {
    if (!this.ctx) return;
    const t = this.snapshot.tape;
    const now = this.ctx.currentTime;
    const running = t.motor;
    this.delayL.delayTime.setTargetAtTime(t.time, now, 0.08);
    this.delayR.delayTime.setTargetAtTime(t.time * 1.035, now, 0.08);
    this.tapeFb.gain.setTargetAtTime(running && t.rec ? t.feedback * 1.05 : running ? t.feedback : 0, now, 0.06);
    this.tapeWet.gain.setTargetAtTime(running ? t.mix : 0, now, 0.05);
    this.tapeDry.gain.setTargetAtTime(running ? Math.max(0.15, 1 - t.mix * 0.85) : 1, now, 0.05);
    this.tapeOut.gain.setTargetAtTime(1, now, 0.05);
    this.wowGain.gain.setTargetAtTime(running ? t.wow * 0.012 : 0, now, 0.1);
    this.flutterGain.gain.setTargetAtTime(running ? t.flutter * 0.0035 : 0, now, 0.1);
    this.tapeClip.curve = makeClipCurve(t.saturate);
    this.tapeIn.gain.setTargetAtTime(1, now, 0.05);
  }

  private applyMaster() {
    if (!this.ctx) return;
    const g = this.snapshot.muted ? 0 : this.snapshot.master * this.snapshot.master;
    this.masterGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.03);
  }

  private applyOrbit() {
    if (!this.ctx || !this.orbitGain) return;
    this.orbitGain.gain.setTargetAtTime(this.snapshot.orbit * 0.85, this.ctx.currentTime, 0.08);
  }

  setOrbit(v: number) {
    this.snapshot = { ...this.snapshot, orbit: Math.min(1, Math.max(0, v)), version: this.snapshot.version + 1 };
    this.applyOrbit();
    for (const l of this.listeners) l();
    this.queueSave();
  }

  setScopeMode(scopeMode: ScopeMode) {
    this.emit({ scopeMode });
  }

  cycleScopeMode() {
    const order: ScopeMode[] = ["yt", "xy", "fft"];
    const i = order.indexOf(this.snapshot.scopeMode);
    this.setScopeMode(order[(i + 1) % order.length]!);
  }

  bounce(seconds = 8) {
    if (!this.ctx || this.snapshot.bouncing) return;
    const dest = this.ctx.createMediaStreamDestination();
    this.masterGain.connect(dest);
    this.bounceDest = dest;
    const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"];
    const mime = types.find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(dest.stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      try {
        this.masterGain.disconnect(dest);
      } catch {
        /* already */
      }
      this.bounceDest = null;
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      const ext = blob.type.includes("ogg") ? "ogg" : "webm";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nexus-bounce-${Date.now()}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      this.emit({ bouncing: false });
    };
    rec.start(250);
    this.emit({ bouncing: true });
    this.bounceTimer = window.setTimeout(() => {
      if (rec.state === "recording") rec.stop();
    }, Math.max(2, seconds) * 1000);
  }

  captureScene(): Scene {
    const s = this.snapshot;
    return {
      voice: { ...s.voice },
      tape: { ...s.tape, rec: false },
      seq: { ...s.seq, playing: false },
      steps: s.steps.map((st) => ({ ...st })),
      grid: s.grid.map((c) => c.slice()),
      patches: s.patches.map((p) => ({ ...p })),
      orbit: s.orbit,
      scopeMode: s.scopeMode,
    };
  }

  saveScene(slot: number) {
    const i = Math.max(0, Math.min(SCENE_COUNT - 1, slot));
    const scenes = this.snapshot.scenes.slice();
    scenes[i] = this.captureScene();
    this.emit({ scenes, sceneSlot: i });
  }

  loadScene(slot: number) {
    const i = Math.max(0, Math.min(SCENE_COUNT - 1, slot));
    const sc = this.snapshot.scenes[i];
    if (!sc) {
      this.emit({ sceneSlot: i });
      return;
    }
    this.snapshot = {
      ...this.snapshot,
      voice: { ...DEFAULT_VOICE, ...sc.voice },
      tape: { ...DEFAULT_TAPE, ...sc.tape, rec: false },
      seq: { ...DEFAULT_SEQ, ...sc.seq, playing: this.snapshot.seq.playing },
      steps: sc.steps?.length === COLS ? sc.steps.map((st) => ({ ...st })) : this.snapshot.steps,
      grid: sc.grid?.length === COLS ? sc.grid.map((c) => c.slice()) : this.snapshot.grid,
      patches: sc.patches?.length ? sc.patches.map((p) => ({ ...p })) : this.snapshot.patches,
      orbit: sc.orbit,
      scopeMode: sc.scopeMode,
      sceneSlot: i,
      version: this.snapshot.version + 1,
    };
    this.applyVoice();
    this.applyTape();
    this.applyOrbit();
    if (this.ctx) this.rebuildPatches();
    for (const l of this.listeners) l();
    this.queueSave();
  }

  frontier() {
    const grid = emptyGrid();
    for (let c = 0; c < COLS; c++) {
      const col = grid[c]!;
      col[(c * 3) % ROWS] = true;
      col[(c * 2 + 3) % ROWS] = true;
      if (c % 5 === 0) col[7] = true;
    }
    const steps = emptySteps().map((s, i) => ({
      ...s,
      gate: i % 3 !== 2,
      accent: i % 6 === 0,
      note: (i * 2) % 8,
      slide: i % 8 === 7,
    }));
    this.snapshot = {
      ...this.snapshot,
      voice: {
        ...DEFAULT_VOICE,
        waveform: "sawtooth",
        morph: 0.72,
        cutoff: 2650,
        resonance: 10.5,
        fmIndex: 7.2,
        unison: 3,
        detune: 16,
        attack: 0.006,
        decay: 0.22,
        sustain: 0.42,
        release: 0.38,
        fold: 0.58,
        lfoRate: 0.22,
        lfoDepth: 0.48,
        shAmt: 0.42,
        ring: 0.28,
      },
      tape: {
        ...DEFAULT_TAPE,
        motor: true,
        rec: false,
        time: 0.46,
        feedback: 0.58,
        mix: 0.48,
        wow: 0.38,
        flutter: 0.2,
        saturate: 0.62,
      },
      seq: {
        ...DEFAULT_SEQ,
        bpm: 94,
        swing: 0.14,
        euclidHits: 7,
        euclidSteps: 16,
        scale: "minor",
        arp: true,
        playing: this.snapshot.powered,
      },
      steps,
      grid,
      orbit: 0.46,
      scopeMode: "xy",
      version: this.snapshot.version + 1,
    };
    this.applyVoice();
    this.applyTape();
    this.applyOrbit();
    if (this.snapshot.powered && this.ctx && !this.snapshot.seq.playing) {
      this.stepIndex = 0;
      this.nextNoteTime = this.ctx.currentTime + 0.05;
      this.snapshot = { ...this.snapshot, seq: { ...this.snapshot.seq, playing: true } };
    }
    for (const l of this.listeners) l();
    this.queueSave();
  }

  setVoice(partial: Partial<VoiceParams>) {
    const voice = { ...this.snapshot.voice, ...partial };
    this.snapshot = { ...this.snapshot, voice, version: this.snapshot.version + 1 };
    this.applyVoice();
    for (const l of this.listeners) l();
    this.queueSave();
  }

  setTape(partial: Partial<TapeParams>) {
    const tape = { ...this.snapshot.tape, ...partial };
    this.snapshot = { ...this.snapshot, tape, version: this.snapshot.version + 1 };
    this.applyTape();
    for (const l of this.listeners) l();
    this.queueSave();
  }

  setSeq(partial: Partial<SeqParams>) {
    const seq = { ...this.snapshot.seq, ...partial };
    this.snapshot = { ...this.snapshot, seq, version: this.snapshot.version + 1 };
    for (const l of this.listeners) l();
    this.queueSave();
  }

  setSteps(steps: SeqStep[]) {
    this.emit({ steps });
  }

  setStep(i: number, partial: Partial<SeqStep>) {
    const steps = this.snapshot.steps.map((s, idx) => (idx === i ? { ...s, ...partial } : s));
    this.emit({ steps });
  }

  setGrid(grid: boolean[][]) {
    this.emit({ grid });
  }

  toggleCell(col: number, row: number) {
    const grid = this.snapshot.grid.map((c, i) =>
      i === col ? c.map((v, r) => (r === row ? !v : v)) : c,
    );
    this.emit({ grid });
  }

  setMaster(v: number) {
    this.snapshot = { ...this.snapshot, master: v, version: this.snapshot.version + 1 };
    this.applyMaster();
    for (const l of this.listeners) l();
    this.queueSave();
  }

  setMuted(m: boolean) {
    this.snapshot = { ...this.snapshot, muted: m, version: this.snapshot.version + 1 };
    this.applyMaster();
    for (const l of this.listeners) l();
  }

  setModule(module: EngineSnapshot["module"]) {
    this.emit({ module });
  }

  applyEuclid() {
    const { euclidHits, euclidSteps, euclidRot } = this.snapshot.seq;
    const pat = euclid(euclidHits, euclidSteps, euclidRot);
    const steps = this.snapshot.steps.map((s, i) => ({
      ...s,
      gate: Boolean(pat[i % pat.length]),
    }));
    const grid = emptyGrid();
    for (let c = 0; c < COLS; c++) {
      if (pat[c % pat.length]) {
        grid[c]![3] = true;
        if (c % 2 === 0) grid[c]![5] = true;
      }
    }
    this.emit({ steps, grid });
  }

  addPatch(from: PortId, to: PortId) {
    if (from === to) return;
    if (!SOURCE_PORTS.includes(from) || !DEST_PORTS.includes(to)) return;
    const exists = this.snapshot.patches.some((p) => p.from === from && p.to === to);
    if (exists) return;
    const patches = [...this.snapshot.patches, { id: `p${Date.now()}`, from, to }];
    this.snapshot = { ...this.snapshot, patches, version: this.snapshot.version + 1 };
    if (this.ctx) this.rebuildPatches();
    for (const l of this.listeners) l();
    this.queueSave();
  }

  removePatch(id: string) {
    const patches = this.snapshot.patches.filter((p) => p.id !== id);
    this.snapshot = { ...this.snapshot, patches, version: this.snapshot.version + 1 };
    if (this.ctx) this.rebuildPatches();
    for (const l of this.listeners) l();
    this.queueSave();
  }

  removePatchAt(from: PortId, to: PortId) {
    const hit = this.snapshot.patches.find((p) => p.from === from && p.to === to);
    if (hit) this.removePatch(hit.id);
  }

  play() {
    if (!this.ctx) return;
    if (this.snapshot.seq.playing) return;
    this.stepIndex = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    this.emit({ seq: { ...this.snapshot.seq, playing: true } });
  }

  stop() {
    this.panic();
    this.emit({ seq: { ...this.snapshot.seq, playing: false } });
  }

  togglePlay() {
    if (this.snapshot.seq.playing) this.stop();
    else this.play();
  }

  noteOn(midi: number, vel = 0.8, time?: number, slide = false) {
    if (!this.ctx) return;
    const now = time ?? this.ctx.currentTime;
    let slot = this.slots.find((s) => s.busy && s.midi === midi);
    if (slot && slide) {
      this.glideSlot(slot, midi, now);
      return;
    }
    slot = this.slots.find((s) => !s.busy) ?? this.slots.slice().sort((a, b) => a.born - b.born)[0];
    if (!slot) return;
    this.triggerSlot(slot, midi, vel, now, slide);
    const held = this.snapshot.heldKeys.includes(midi)
      ? this.snapshot.heldKeys
      : [...this.snapshot.heldKeys, midi];
    this.snapshot = {
      ...this.snapshot,
      heldKeys: held,
      activeNotes: this.slots.filter((s) => s.busy).length,
      version: this.snapshot.version + 1,
    };
    for (const l of this.listeners) l();
  }

  noteOff(midi: number, time?: number) {
    if (!this.ctx) return;
    const now = time ?? this.ctx.currentTime;
    for (const slot of this.slots) {
      if (slot.busy && slot.midi === midi) this.releaseSlot(slot, now);
    }
    const held = this.snapshot.heldKeys.filter((k) => k !== midi);
    this.snapshot = {
      ...this.snapshot,
      heldKeys: held,
      activeNotes: this.slots.filter((s) => s.busy).length,
      version: this.snapshot.version + 1,
    };
    for (const l of this.listeners) l();
  }

  panic() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const slot of this.slots) this.releaseSlot(slot, now, true);
    this.snapshot = { ...this.snapshot, heldKeys: [], activeNotes: 0, version: this.snapshot.version + 1 };
    for (const l of this.listeners) l();
  }

  private triggerSlot(slot: VoiceSlot, midi: number, vel: number, time: number, slide: boolean) {
    const ctx = this.ctx!;
    time = Math.max(time, ctx.currentTime);
    const v = this.snapshot.voice;
    this.killOsc(slot, time);
    slot.busy = true;
    slot.midi = midi;
    slot.born = time;
    const freq = midiToHz(midi);
    slot.filterA.frequency.setValueAtTime(v.cutoff, time);
    slot.filterB.frequency.setValueAtTime(v.cutoff * 0.97, time);
    slot.filterA.Q.setValueAtTime(Math.max(0.2, v.resonance * 0.7), time);
    slot.filterB.Q.setValueAtTime(Math.max(0.2, v.resonance * 0.45), time);
    slot.pan.pan.setValueAtTime(v.pan, time);

    if (v.waveform === "pluck") {
      this.startPluck(slot, freq, vel, time);
    } else {
      const [a, b] = MORPH_PAIRS[v.waveform];
      const count = v.unison >= 5 ? 3 : v.unison >= 3 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const spread = count === 1 ? 0 : ((i - (count - 1) / 2) * v.detune) / 14;
        const oscA = ctx.createOscillator();
        const oscB = ctx.createOscillator();
        oscA.type = a;
        oscB.type = b;
        const gA = ctx.createGain();
        const gB = ctx.createGain();
        gA.gain.value = (1 - v.morph) / count;
        gB.gain.value = v.morph / count;
        oscA.frequency.value = freq;
        oscB.frequency.value = freq;
        oscA.detune.value = spread * 100;
        oscB.detune.value = spread * 100 + 3;
        if (slide && v.glide > 0) {
          const from = midiToHz(Math.max(20, midi - 3));
          oscA.frequency.setValueAtTime(from, time);
          oscB.frequency.setValueAtTime(from, time);
          oscA.frequency.setTargetAtTime(freq, time, Math.max(0.01, v.glide));
          oscB.frequency.setTargetAtTime(freq, time, Math.max(0.01, v.glide));
        }
        if (v.fmIndex > 0) {
          const fm = ctx.createOscillator();
          fm.type = "sine";
          fm.frequency.value = freq * 2;
          const fmG = ctx.createGain();
          fmG.gain.value = v.fmIndex * freq * 0.35;
          fm.connect(fmG);
          fmG.connect(oscA.frequency);
          fm.start(time);
          slot.oscs.push(fm);
        }
        oscA.connect(gA);
        oscB.connect(gB);
        gA.connect(slot.env);
        gB.connect(slot.env);
        oscA.start(time);
        oscB.start(time);
        slot.oscs.push(oscA, oscB);
      }
    }

    const env = slot.env.gain;
    env.cancelScheduledValues(time);
    env.setValueAtTime(0.0001, time);
    env.exponentialRampToValueAtTime(Math.max(0.001, vel * v.gain), time + Math.max(0.004, v.attack));
    env.exponentialRampToValueAtTime(
      Math.max(0.001, vel * v.gain * v.sustain),
      time + Math.max(0.004, v.attack) + Math.max(0.02, v.decay),
    );
    slot.stopAt = time + 12;
  }

  private startPluck(slot: VoiceSlot, freq: number, vel: number, time: number) {
    const ctx = this.ctx!;
    const period = Math.min(0.05, Math.max(0.001, 1 / freq));
    const delay = ctx.createDelay(0.2);
    delay.delayTime.value = period;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = Math.min(8000, freq * 8);
    const fb = ctx.createGain();
    fb.gain.value = 0.92 - this.snapshot.voice.morph * 0.18;
    const burst = ctx.createBufferSource();
    const n = Math.floor(ctx.sampleRate * period * 2);
    const buf = ctx.createBuffer(1, Math.max(32, n), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * vel;
    burst.buffer = buf;
    burst.connect(delay);
    delay.connect(lp);
    lp.connect(fb);
    fb.connect(delay);
    delay.connect(slot.env);
    burst.start(time);
    burst.stop(time + period * 4);
    slot.noise = burst;
  }

  private glideSlot(slot: VoiceSlot, midi: number, time: number) {
    const freq = midiToHz(midi);
    const t = Math.max(0.01, this.snapshot.voice.glide);
    for (const o of slot.oscs) {
      try {
        o.frequency.setTargetAtTime(freq, time, t);
      } catch {
        /* not osc */
      }
    }
    slot.midi = midi;
  }

  private releaseSlot(slot: VoiceSlot, time: number, hard = false) {
    if (!slot.busy && !hard) return;
    const rel = hard ? 0.03 : Math.max(0.02, this.snapshot.voice.release);
    slot.env.gain.cancelScheduledValues(time);
    slot.env.gain.setTargetAtTime(0.0001, time, rel / 3);
    slot.stopAt = time + rel + 0.05;
    slot.busy = false;
    slot.midi = -1;
    window.setTimeout(() => this.killOsc(slot, time + rel), (rel + 0.08) * 1000);
  }

  private killOsc(slot: VoiceSlot, time: number) {
    for (const o of slot.oscs) {
      try {
        o.stop(time);
        o.disconnect();
      } catch {
        /* ended */
      }
    }
    slot.oscs = [];
    if (slot.noise) {
      try {
        slot.noise.stop(time);
        slot.noise.disconnect();
      } catch {
        /* ended */
      }
      slot.noise = null;
    }
  }

  triggerCell(col: number, row: number, vel = 0.85) {
    const scale = scaleFor(this.snapshot.seq.scale);
    const midi = scale[row] ?? 48;
    this.noteOn(midi, vel);
    window.setTimeout(() => this.noteOff(midi), 180 + this.snapshot.voice.release * 400);
    void col;
  }

  setGridXY(x: number, y: number) {
    if (!this.ctx) return;
    const cutoff = 180 + y * 6200;
    const pan = x * 2 - 1;
    const now = this.ctx.currentTime;
    this.filterA.frequency.setTargetAtTime(cutoff, now, 0.05);
    this.filterB.frequency.setTargetAtTime(cutoff * 0.96, now, 0.05);
    this.masterPan.pan.setTargetAtTime(pan, now, 0.04);
  }

  private scheduleStep(step: number, time: number) {
    if (this.shHold) {
      const sample = Math.random() * 2 - 1;
      this.shHold.offset.setValueAtTime(sample, time);
    }
    const s = this.snapshot.steps[step];
    const seq = this.snapshot.seq;
    const scale = scaleFor(seq.scale);
    const gridCol = this.snapshot.grid[step];
    const fire = (row: number, accent: boolean, slide: boolean, gateProb: number) => {
      if (Math.random() > gateProb * seq.probability) return;
      const midi = scale[row] ?? 48;
      const vel = accent ? 1 : 0.72;
      this.noteOn(midi, vel, time, slide);
      const dur = (60 / seq.bpm / 4) * (slide ? 1.4 : 0.7);
      this.noteOff(midi, time + dur);
    };
    if (s?.gate) fire(s.note, s.accent, s.slide, s.prob);
    if (gridCol) {
      for (let r = 0; r < ROWS; r++) {
        if (gridCol[r]) fire(r, Boolean(s?.accent), Boolean(s?.slide), s?.prob ?? 1);
      }
    }
    if (seq.arp && this.snapshot.heldKeys.length > 0) {
      const midi = this.snapshot.heldKeys[step % this.snapshot.heldKeys.length]!;
      this.noteOn(midi, 0.82, time, false);
      this.noteOff(midi, time + (60 / seq.bpm / 4) * 0.62);
    }
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.ctx || !this.snapshot.seq.playing) return;
    const t = this.ctx.currentTime;
    const stepDur = 60 / this.snapshot.seq.bpm / 4;
    const swing = this.snapshot.seq.swing;
    while (this.nextNoteTime < t + 0.12) {
      const step = this.stepIndex;
      this.scheduleStep(step, this.nextNoteTime);
      const odd = step % 2 === 1;
      this.nextNoteTime += odd ? stepDur * (1 + swing) : stepDur * (1 - swing);
      this.stepIndex = (step + 1) % COLS;
    }
  };

  persistNow(): PersistedState {
    const s = this.snapshot;
    return {
      v: 3,
      voice: s.voice,
      tape: s.tape,
      seq: { ...s.seq, playing: false },
      steps: s.steps,
      grid: s.grid,
      patches: s.patches,
      master: s.master,
      orbit: s.orbit,
      scopeMode: s.scopeMode,
      scenes: s.scenes,
      sceneSlot: s.sceneSlot,
    };
  }
}

export const engine = new NexusEngine();
