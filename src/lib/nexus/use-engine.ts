import { useSyncExternalStore } from "react";
import { engine, type EngineSnapshot } from "./engine";

export function useEngine(): EngineSnapshot {
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getServerSnapshot);
}

export { engine };
