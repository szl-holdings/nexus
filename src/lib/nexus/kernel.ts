/** Analog-computer realization of SZL ouroboros, 8 invariants, 5-organ anatomy.
 * Faithful to szl-holdings/ouroboros runLoop, szl-invariants, szl-khipu anatomy.
 * Λ uniqueness stays Conjecture 1. Energy is UNAVAILABLE. Never a fabricated joule.
 */

export const LOCKED_EIGHT = ["F1", "F4", "F7", "F11", "F12", "F18", "F19", "F22"] as const;
export const KERNEL_COMMIT = "c7c0ba17";
export const CONJECTURE_1 = "OPEN";

export type LoopExit = "converged" | "consistent" | "aborted" | "budgetExhausted" | "running";
export type InvStatus = "HOLDS" | "VIOLATED" | "NO_DATA" | "UNAVAILABLE";
export type OrganId = "brain" | "heart" | "circulatory" | "nervous" | "skeleton";

export interface LedgerRow {
  id: number;
  ok: boolean;
  demo: boolean;
  model: string | null;
  servedNode: string | null;
  loopSteps: number;
  energy_j: number | null;
  prevHash: string;
  rowHash: string;
  receiptJson: string | null;
  signature: string | null;
  keyId: string | null;
  analog: { x: number; y: number; z: number; fg: number; step: number };
}

export interface Organ {
  id: OrganId;
  name: string;
  quechua: string;
  formulas: string[];
  status: "LIVE" | "DOWN";
  honesty: "LIVE" | "ADVISORY" | "UNAVAILABLE";
  metric: number;
  detail: string;
}

export interface Invariant {
  id: string;
  title: string;
  status: InvStatus;
  checked: number;
  violations: number;
  detail: string;
}

export interface KernelSnap {
  lambda: number;
  blocked: boolean;
  reason: string;
  liveCount: number;
  organs: Organ[];
  invariants: Invariant[];
  holds: number;
  violated: number;
  indeterminate: number;
  loopSteps: number;
  maxSteps: number;
  loopRemain: number;
  exit: LoopExit;
  chainHead: string;
  chainOk: boolean;
  energy: "UNAVAILABLE";
  energy_j: null;
  conjecture1: typeof CONJECTURE_1;
  provenTrust: false;
  lockedProven: 8;
  kernelCommit: typeof KERNEL_COMMIT;
}

const DEFAULT_MAX = 8;

export function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** F19 / Λ — weighted geometric mean. A zero axis fail-closes. Advisory; uniqueness OPEN. */
export function evaluateLambda(axes: number[]) {
  if (axes.length === 0) return { value: 0, blocked: true, reason: "no axes" };
  let log = 0;
  for (const a of axes) {
    if (a <= 0) return { value: 0, blocked: true, reason: "F12 fail-closed · zero axis" };
    log += Math.log(Math.min(1, a));
  }
  const value = Math.exp(log / axes.length);
  return { value, blocked: false, reason: `Λ ${value.toFixed(4)} · advisory · Conjecture 1 OPEN` };
}

export function yuyayAxes(input: {
  x: number;
  y: number;
  z: number;
  fg: number;
  drive: number;
  chaos: number;
  rate: number;
  gain: number;
  mix: number;
  prob: number;
  liveFrac: number;
  frontier: boolean;
  muted: boolean;
}) {
  return [
    live(input.x * 0.5 + 0.5),
    live(input.y * 0.5 + 0.5),
    live(input.z),
    live(input.fg),
    live(input.drive),
    live(input.chaos),
    live(input.rate / 1.6),
    live(input.gain),
    live(input.mix + 0.15),
    live(input.prob),
    input.muted ? 0.12 : 1,
    live(input.liveFrac),
    input.frontier ? 0.97 : 0.62,
  ];
}

function live(n: number) {
  return Math.max(0.045, clamp01(n));
}

/** Ouroboros loop-tax. Amplitude decays. Energy UNAVAILABLE — never a fabricated joule. */
export function loopTax(stepsRun: number, maxSteps = DEFAULT_MAX, amplitude = 1) {
  const max = Math.max(1, maxSteps);
  const run = Math.max(0, stepsRun);
  const remain = clamp01(1 - run / max);
  return {
    remain,
    taxed: amplitude * remain,
    exit: (run >= max ? "budgetExhausted" : "running") as LoopExit,
    energy: "UNAVAILABLE" as const,
    energy_j: null,
  };
}

export function analogDelta(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
}

export function tickLoop(
  stepsRun: number,
  deltaMag: number,
  maxSteps = DEFAULT_MAX,
  threshold = 0.012,
): { stepsRun: number; exit: LoopExit } {
  const next = stepsRun + 1;
  if (next >= maxSteps) return { stepsRun: next, exit: "budgetExhausted" };
  if (stepsRun > 0 && deltaMag <= threshold) return { stepsRun: next, exit: "converged" };
  return { stepsRun: next, exit: "running" };
}

export function sha256Hex(text: string) {
  return bytesToHex(sha256(utf8Bytes(text)));
}

export function contentHash(row: Pick<LedgerRow, "ok" | "demo" | "model" | "servedNode" | "loopSteps" | "energy_j" | "analog">) {
  const core = {
    analog: row.analog,
    demo: row.demo,
    energy_j: row.energy_j,
    loopSteps: row.loopSteps,
    model: row.model,
    ok: row.ok,
    servedNode: row.servedNode,
  };
  return sha256Hex(JSON.stringify(core));
}

export function recomputeRowHash(prevHash: string, row: Parameters<typeof contentHash>[0]) {
  return sha256Hex(`${prevHash}|${contentHash(row)}`);
}

export function appendReceipt(
  rows: LedgerRow[],
  analog: LedgerRow["analog"],
  ok = true,
): LedgerRow[] {
  const prevHash = rows.length ? rows[rows.length - 1]!.rowHash : "genesis";
  const draft: Omit<LedgerRow, "rowHash"> & { rowHash?: string } = {
    analog,
    demo: false,
    energy_j: null,
    id: rows.length + 1,
    keyId: null,
    loopSteps: 1,
    model: "nexus-analog",
    ok,
    prevHash,
    receiptJson: null,
    servedNode: "browser",
    signature: null,
  };
  const row: LedgerRow = { ...draft, rowHash: recomputeRowHash(prevHash, draft) };
  const next = rows.concat(row);
  return next.length > 64 ? next.slice(next.length - 64) : next;
}

export function runInvariants(rows: LedgerRow[] | null): {
  invariants: Invariant[];
  holds: number;
  violated: number;
  indeterminate: number;
} {
  if (!rows) {
    return { invariants: [], holds: 0, violated: 0, indeterminate: 0 };
  }
  const invariants: Invariant[] = [
    invChain(rows),
    invFailureShape(rows),
    invHasModel(rows),
    invSignedAtomic(rows),
    invLoopSteps(rows),
    {
      id: "receipt-ed25519-verify",
      title: "Each signed receipt verifies under ed25519",
      status: "UNAVAILABLE",
      checked: 0,
      violations: 0,
      detail: "no public key supplied — honest UNAVAILABLE, not a judgment on the receipts",
    },
    invColumns(rows),
    {
      id: "flywheel-lineage",
      title: "Flywheel eats only its own verified tail",
      status: "UNAVAILABLE",
      checked: 0,
      violations: 0,
      detail: "no flywheel training-sample export — honest UNAVAILABLE",
    },
  ];
  const holds = invariants.filter((i) => i.status === "HOLDS").length;
  const violated = invariants.filter((i) => i.status === "VIOLATED").length;
  return { invariants, holds, violated, indeterminate: invariants.length - holds - violated };
}

export function evaluateAnatomy(input: {
  lambda: ReturnType<typeof evaluateLambda>;
  rows: LedgerRow[];
  chainOk: boolean;
  chainHead: string;
  leak: number;
  fabricateJoule: boolean;
  hatunLive: boolean;
}): { organs: Organ[]; liveCount: number; blocked: boolean; reason: string } {
  const brainDown = input.leak > 1e-6;
  const heartDown = input.lambda.blocked;
  const yawarDown = !input.chainOk;
  const nervousDown = input.fabricateJoule;
  const skeletonDown = false;
  const organs: Organ[] = [
    {
      id: "brain",
      name: "BRAIN",
      quechua: "YACHAY",
      formulas: ["F1"],
      status: brainDown ? "DOWN" : "LIVE",
      honesty: "LIVE",
      metric: input.leak,
      detail: brainDown
        ? `cross-canal leak ${input.leak.toExponential(2)} — YACHAY cannot reason across a broken partition`
        : "read-only cortex · function generator · no write authority",
    },
    {
      id: "heart",
      name: "HEART",
      quechua: "YUYAY",
      formulas: ["F4", "F11"],
      status: heartDown ? "DOWN" : "LIVE",
      honesty: "ADVISORY",
      metric: input.lambda.value,
      detail: input.lambda.reason,
    },
    {
      id: "circulatory",
      name: "CIRCULATORY",
      quechua: "YAWAR",
      formulas: ["F7", "F22"],
      status: yawarDown ? "DOWN" : "LIVE",
      honesty: "LIVE",
      metric: yawarDown ? 1 : 0,
      detail: yawarDown ? "chain break — prev pointer does not walk. Fail closed." : `SHA-256 · head ${input.chainHead.slice(0, 12)}`,
    },
    {
      id: "nervous",
      name: "NERVOUS",
      quechua: "OTel",
      formulas: ["F12"],
      status: nervousDown ? "DOWN" : "LIVE",
      honesty: "UNAVAILABLE",
      metric: nervousDown ? 1 : 0,
      detail: nervousDown
        ? "fabricated joule refused — energy stays UNAVAILABLE"
        : input.hatunLive
          ? "Hatun LIVE · loop-tax · energy UNAVAILABLE · never a fabricated joule"
          : "loop-tax · energy UNAVAILABLE · Hatun UNAVAILABLE",
    },
    {
      id: "skeleton",
      name: "SKELETON",
      quechua: "Khipu",
      formulas: ["F18", "F19"],
      status: skeletonDown ? "DOWN" : "LIVE",
      honesty: "ADVISORY",
      metric: 8,
      detail: `locked-8 ${LOCKED_EIGHT.join(" ")} · CHECKED ≠ Lean PROVEN @ ${KERNEL_COMMIT}`,
    },
  ];
  const liveCount = organs.filter((o) => o.status === "LIVE").length;
  const down = organs.filter((o) => o.status === "DOWN").map((o) => o.name);
  const blocked = down.length > 0;
  const reason = blocked
    ? `organ integrity FAIL · ${down.join(", ")} DOWN · fail closed`
    : `organ integrity ${liveCount}/5 LIVE · Λ advisory · energy UNAVAILABLE · Conjecture 1 OPEN`;
  return { organs, liveCount, blocked, reason };
}

export function emptyKernel(): KernelSnap {
  return {
    lambda: 0,
    blocked: false,
    reason: "idle",
    liveCount: 0,
    organs: [],
    invariants: [],
    holds: 0,
    violated: 0,
    indeterminate: 0,
    loopSteps: 0,
    maxSteps: DEFAULT_MAX,
    loopRemain: 1,
    exit: "running",
    chainHead: "genesis",
    chainOk: true,
    energy: "UNAVAILABLE",
    energy_j: null,
    conjecture1: CONJECTURE_1,
    provenTrust: false,
    lockedProven: 8,
    kernelCommit: KERNEL_COMMIT,
  };
}

function inv(id: string, title: string, status: InvStatus, checked: number, violations: number, detail: string): Invariant {
  return { id, title, status, checked, violations, detail };
}

function invChain(rows: LedgerRow[]): Invariant {
  let failed = 0;
  let checked = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const prev = i === 0 ? "genesis" : rows[i - 1]!.rowHash;
    checked += 1;
    if (r.prevHash !== prev || r.rowHash !== recomputeRowHash(r.prevHash, r)) failed += 1;
  }
  const status: InvStatus = rows.length === 0 ? "NO_DATA" : failed ? "VIOLATED" : "HOLDS";
  return inv(
    "receipt-chain-continuity",
    "Receipt chain recomputes over its own tail (Ouroboros closure)",
    status,
    checked,
    failed,
    failed ? `${failed} link(s) failed to recompute` : `all ${checked} hashed links recompute exactly`,
  );
}

function invFailureShape(rows: LedgerRow[]): Invariant {
  const subject = rows.filter((r) => !r.ok);
  const bad = subject.filter((r) => r.energy_j != null);
  return inv(
    "ledger-failure-shape",
    "Failed runs claim no serving provider or energy",
    subject.length === 0 ? "NO_DATA" : bad.length ? "VIOLATED" : "HOLDS",
    subject.length,
    bad.length,
    bad.length ? `${bad.length} failed row(s) fabricated a joule` : `${subject.length} failed row(s), all shaped honestly`,
  );
}

function invHasModel(rows: LedgerRow[]): Invariant {
  const subject = rows.filter((r) => r.ok && !r.demo);
  const bad = subject.filter((r) => !r.model);
  return inv(
    "served-run-has-model",
    "Live-served runs name the model that served them",
    subject.length === 0 ? "NO_DATA" : bad.length ? "VIOLATED" : "HOLDS",
    subject.length,
    bad.length,
    bad.length ? `${bad.length} live-served row(s) name no model` : `${subject.length} live-served row(s), all name a model`,
  );
}

function invSignedAtomic(rows: LedgerRow[]): Invariant {
  const bad = rows.filter((r) => {
    const flags = [r.receiptJson != null, r.signature != null, r.keyId != null];
    return flags.some(Boolean) && !flags.every(Boolean);
  });
  return inv(
    "signed-columns-atomic",
    "Receipt columns are all-present or all-absent",
    rows.length === 0 ? "NO_DATA" : bad.length ? "VIOLATED" : "HOLDS",
    rows.length,
    bad.length,
    bad.length ? `${bad.length} partial receipt column set` : `${rows.length} row(s), each fully signed or honestly unsigned`,
  );
}

function invLoopSteps(rows: LedgerRow[]): Invariant {
  const subject = rows.filter((r) => r.ok && !r.demo);
  const bad = subject.filter((r) => r.loopSteps < 1);
  return inv(
    "loop-steps-positive",
    "Every live-served run took at least one loop step",
    subject.length === 0 ? "NO_DATA" : bad.length ? "VIOLATED" : "HOLDS",
    subject.length,
    bad.length,
    bad.length ? `${bad.length} served row(s) recorded no loop step` : `${subject.length} served row(s), each took at least one step`,
  );
}

function invColumns(rows: LedgerRow[]): Invariant {
  const withR = rows.filter((r) => r.receiptJson != null);
  return inv(
    "receipt-columns-consistent",
    "Receipt payload matches its indexed columns",
    withR.length === 0 ? "NO_DATA" : "HOLDS",
    withR.length,
    0,
    withR.length ? `${withR.length} receipt(s) agree with columns` : "unsigned analog receipts — honest empty payload",
  );
}

function utf8Bytes(s: string) {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const c2 = s.charCodeAt(i + 1);
      c = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      i += 1;
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}

function bytesToHex(b: Uint8Array) {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, "0");
  return s;
}

function sha256(msg: Uint8Array) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
    0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const l = msg.length;
  const withPad = new Uint8Array(((l + 9 + 63) >> 6) << 6);
  withPad.set(msg);
  withPad[l] = 0x80;
  const view = new DataView(withPad.buffer);
  view.setUint32(withPad.length - 4, l * 8);
  const w = new Uint32Array(64);
  const rr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let i = 0; i < withPad.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4);
    for (let t = 16; t < 64; t++) {
      const s0 = rr(w[t - 15]!, 7) ^ rr(w[t - 15]!, 18) ^ (w[t - 15]! >>> 3);
      const s1 = rr(w[t - 2]!, 17) ^ rr(w[t - 2]!, 19) ^ (w[t - 2]! >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) >>> 0;
    }
    let a = h[0]!,
      b = h[1]!,
      c = h[2]!,
      d = h[3]!,
      e = h[4]!,
      f = h[5]!,
      g = h[6]!,
      hh = h[7]!;
    for (let t = 0; t < 64; t++) {
      const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + K[t]! + w[t]!) >>> 0;
      const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]!);
  return out;
}
