import type { PatchCable, SeqParams, SeqStep, TapeParams, VoiceParams } from "./types";

const DB = "nexus-v1";
const STORE = "state";
const VERSION = 1;

export interface PersistedState {
  v: number;
  voice: VoiceParams;
  tape: TapeParams;
  seq: SeqParams;
  steps: SeqStep[];
  grid: boolean[][];
  patches: PatchCable[];
  master: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadPersisted(): Promise<PersistedState | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const q = tx.objectStore(STORE).get("session");
      q.onsuccess = () => {
        const val = q.result as PersistedState | undefined;
        resolve(val && val.v === VERSION ? val : null);
      };
      q.onerror = () => reject(q.error);
    });
  } catch {
    return readLocal();
  }
}

export async function savePersisted(state: PersistedState): Promise<void> {
  if (typeof indexedDB === "undefined") {
    writeLocal(state);
    return;
  }
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(state, "session");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    writeLocal(state);
  }
}

function writeLocal(state: PersistedState) {
  try {
    localStorage.setItem("nexus-v1", JSON.stringify(state));
  } catch {
    /* quota */
  }
}

function readLocal(): PersistedState | null {
  try {
    const raw = localStorage.getItem("nexus-v1");
    if (!raw) return null;
    const val = JSON.parse(raw) as PersistedState;
    return val.v === VERSION ? val : null;
  } catch {
    return null;
  }
}

let timer: number | null = null;
export function scheduleSave(state: PersistedState) {
  if (typeof window === "undefined") return;
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    void savePersisted(state);
  }, 420);
}
