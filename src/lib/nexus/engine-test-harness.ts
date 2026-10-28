/**
 * Node-only test support that loads the real browser engine (`engine.ts`)
 * under `node:test` with a fake clock, a fake Web Audio graph and fake
 * IndexedDB/localStorage. Nothing in the app imports this file.
 *
 * What it can show: the engine's own control flow (voice allocation, release
 * timers, hydrate/scene restore) against a deterministic clock and a graph that
 * records every start/stop/connect/disconnect. What it cannot show: real
 * browser audio, real Web Audio node lifetime/GC, or real IndexedDB behavior.
 */
import { registerHooks } from "node:module";

type EngineModule = typeof import("./engine.ts");
export type Engine = EngineModule["engine"];

let hooksRegistered = false;

/**
 * `engine.ts` uses bundler-style extensionless relative imports (`./types`).
 * Node's type stripping needs the explicit `.ts`, so add it for this directory.
 */
function registerExtensionlessTsResolve() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        /^\.\.?\//.test(specifier) &&
        !/\.[cm]?[jt]sx?$/.test(specifier) &&
        context.parentURL?.includes("/src/lib/nexus/")
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      return nextResolve(specifier, context);
    },
  });
}

/** A `window.setTimeout` replacement driven only by `advance()`. */
export class FakeClock {
  now = 0;
  private nextId = 0;
  private timers = new Map<number, { due: number; fn: () => void }>();

  setTimeout = (fn: () => void, ms = 0): number => {
    const id = ++this.nextId;
    this.timers.set(id, { due: this.now + Math.max(0, Number(ms) || 0), fn });
    return id;
  };

  clearTimeout = (id?: number) => {
    if (id !== undefined) this.timers.delete(id);
  };

  get pending() {
    return this.timers.size;
  }

  /** Move time forward by `ms`, firing due timers in (due, creation) order. */
  advance(ms: number) {
    const end = this.now + ms;
    for (;;) {
      let nextId = -1;
      let nextDue = Infinity;
      for (const [id, timer] of this.timers) {
        if (timer.due <= end && timer.due < nextDue) {
          nextDue = timer.due;
          nextId = id;
        }
      }
      if (nextId < 0) break;
      const timer = this.timers.get(nextId)!;
      this.timers.delete(nextId);
      this.now = Math.max(this.now, timer.due);
      timer.fn();
    }
    this.now = end;
  }
}

/** Records the automation calls the engine makes; values are not simulated. */
export class FakeParam {
  value = 0;
  readonly calls: string[] = [];
  private record(name: string) {
    this.calls.push(name);
    return this;
  }
  setValueAtTime(v: number) {
    this.value = v;
    return this.record("setValueAtTime");
  }
  setTargetAtTime() {
    return this.record("setTargetAtTime");
  }
  linearRampToValueAtTime() {
    return this.record("linearRampToValueAtTime");
  }
  exponentialRampToValueAtTime() {
    return this.record("exponentialRampToValueAtTime");
  }
  cancelScheduledValues() {
    return this.record("cancelScheduledValues");
  }
  cancelAndHoldAtTime() {
    return this.record("cancelAndHoldAtTime");
  }
  setValueCurveAtTime() {
    return this.record("setValueCurveAtTime");
  }
}

/** Every node the fake context creates. Unknown properties become params. */
export class FakeNode {
  readonly outputs = new Set<unknown>();
  started: number | null = null;
  stoppedAt: number | null = null;
  stopCalls = 0;
  disconnectCalls = 0;
  readonly kind: string;
  readonly ctx: FakeAudioContext;
  [key: string]: unknown;

  // No parameter properties: node's type stripping only accepts erasable syntax.
  constructor(kind: string, ctx: FakeAudioContext) {
    this.kind = kind;
    this.ctx = ctx;
  }

  connect(destination: unknown) {
    this.outputs.add(destination);
    return destination;
  }

  disconnect() {
    this.outputs.clear();
    this.disconnectCalls += 1;
  }

  start(when = 0) {
    this.started = when;
  }

  stop(when = 0) {
    this.stoppedAt = when;
    this.stopCalls += 1;
  }

  /** Started, still connected, and not past its scheduled stop. */
  get sounding() {
    return (
      this.started !== null &&
      this.outputs.size > 0 &&
      (this.stoppedAt === null || this.stoppedAt > this.ctx.currentTime)
    );
  }
}

function proxiedNode(kind: string, ctx: FakeAudioContext): FakeNode {
  return new Proxy(new FakeNode(kind, ctx), {
    get(target, prop, receiver) {
      if (typeof prop === "symbol" || prop === "then") return Reflect.get(target, prop, receiver);
      if (!(prop in target)) target[prop] = new FakeParam();
      return Reflect.get(target, prop, receiver);
    },
  });
}

export class FakeAudioContext {
  readonly sampleRate = 48000;
  state: "running" | "suspended" | "closed" = "running";
  readonly created: FakeNode[] = [];
  readonly destination: FakeNode;
  readonly clock: FakeClock;

  constructor(clock: FakeClock) {
    this.clock = clock;
    this.destination = proxiedNode("Destination", this);
  }

  get currentTime() {
    return this.clock.now / 1000;
  }

  resume() {
    this.state = "running";
    return Promise.resolve();
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: (channel: number) => data[channel]!,
    };
  }

  node(kind: string) {
    const created = proxiedNode(kind, this);
    this.created.push(created);
    return created;
  }

  createGain() {
    return this.node("Gain");
  }
  createOscillator() {
    return this.node("Oscillator");
  }
  createBiquadFilter() {
    return this.node("BiquadFilter");
  }
  createDelay() {
    return this.node("Delay");
  }
  createWaveShaper() {
    return this.node("WaveShaper");
  }
  createDynamicsCompressor() {
    return this.node("DynamicsCompressor");
  }
  createAnalyser() {
    return this.node("Analyser");
  }
  createStereoPanner() {
    return this.node("StereoPanner");
  }
  createConvolver() {
    return this.node("Convolver");
  }
  createBufferSource() {
    return this.node("BufferSource");
  }
  createConstantSource() {
    return this.node("ConstantSource");
  }
  createChannelSplitter() {
    return this.node("ChannelSplitter");
  }
  createChannelMerger() {
    return this.node("ChannelMerger");
  }
  createMediaStreamDestination() {
    return this.node("MediaStreamDestination");
  }
}

/** Minimal async IndexedDB holding one `state/session` record. */
export function fakeIndexedDB(record: unknown, opts: { failOpen?: boolean } = {}) {
  const store = new Map<string, unknown>([["session", record]]);
  const later = (fn: () => void) => queueMicrotask(fn);
  return {
    store,
    open() {
      const req: Record<string, any> = {};
      later(() => {
        if (opts.failOpen) {
          req.error = new Error("IndexedDB unavailable (fake)");
          req.onerror?.();
          return;
        }
        req.result = {
          objectStoreNames: { contains: () => true },
          createObjectStore() {},
          transaction() {
            const tx: Record<string, any> = {
              objectStore() {
                return {
                  get(key: string) {
                    const q: Record<string, any> = {};
                    later(() => {
                      q.result = store.get(key);
                      q.onsuccess?.();
                    });
                    return q;
                  },
                  put(value: unknown, key: string) {
                    store.set(key, value);
                    later(() => tx.oncomplete?.());
                  },
                };
              },
            };
            return tx;
          },
        };
        req.onsuccess?.();
      });
      return req;
    },
  };
}

export function fakeLocalStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, String(value)),
    removeItem: (key: string) => void data.delete(key),
  };
}

export interface Harness {
  clock: FakeClock;
  /** A fresh, unpowered engine instance (same class as the app's singleton). */
  newEngine(): Engine;
  /** A fresh engine after `powerOn()`, with its fake audio context. */
  poweredEngine(): Promise<{ engine: Engine; ctx: FakeAudioContext }>;
  setStorage(storage: { indexedDB?: unknown; localStorage?: unknown }): void;
}

/**
 * Install browser globals for this test process and load `engine.ts`.
 * `node:test` runs each test file in its own process, so these globals never
 * leak into another test file.
 */
export async function loadEngineHarness(): Promise<Harness> {
  registerExtensionlessTsResolve();
  const clock = new FakeClock();
  const g = globalThis as any;
  g.window = {
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    AudioContext: function FakeAudioContextCtor() {
      return new FakeAudioContext(clock);
    },
  };
  g.document = {
    visibilityState: "visible",
    addEventListener() {},
    removeEventListener() {},
  };
  g.requestAnimationFrame = () => 0;
  g.cancelAnimationFrame = () => {};
  // No network from tests: probe refreshes see an unreachable estate.
  g.fetch = () => Promise.reject(new Error("network disabled in tests"));

  const mod: EngineModule = await import("./engine.ts");
  const Engine = mod.engine.constructor as new () => Engine;

  const harness: Harness = {
    clock,
    newEngine: () => new Engine(),
    async poweredEngine() {
      const engine = new Engine();
      await engine.powerOn();
      return { engine, ctx: engine.getCtx() as unknown as FakeAudioContext };
    },
    setStorage(storage) {
      for (const key of ["indexedDB", "localStorage"] as const) {
        if (!(key in storage)) continue;
        Object.defineProperty(globalThis, key, {
          value: storage[key],
          configurable: true,
          writable: true,
        });
      }
    },
  };
  return harness;
}
