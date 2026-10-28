import { COLS, ROWS } from "./types.ts";

/**
 * Copy a structurally valid persisted grid without deciding whether an all-dark
 * pattern should be restored. Hydrate's existing lit-pattern policy stays at
 * the call site. The input may originate from IndexedDB or localStorage.
 */
export function restoreGrid(raw: unknown): boolean[][] | null {
  if (!Array.isArray(raw) || raw.length !== COLS) return null;
  const grid: boolean[][] = [];
  for (const column of raw) {
    if (!Array.isArray(column) || column.length !== ROWS) return null;
    const copy: boolean[] = [];
    for (const cell of column) {
      if (typeof cell !== "boolean") return null;
      copy.push(cell);
    }
    grid.push(copy);
  }
  return grid;
}
