/** Read-only connection declaration, never a scientific verification or audio input. */
export const AERO_STATUS_PATH = "/research/aero/api/status";
export const AERO_INTERFACE_PATH = "/research/aero/";
export const MAX_AERO_STATUS_BYTES = 16 * 1024;

export interface AeroResearchStatus {
  schema: "szl.aero-research-bridge/v1";
  state: "research_only";
  claims_reviewed: 11;
  proofs_established: 0;
  operational_use_allowed: false;
  source_verified: true;
  capabilities: ["source_reference", "exact_arithmetic_diagnostic"];
  interface_path: typeof AERO_INTERFACE_PATH;
}

const STATUS_KEYS = [
  "schema",
  "state",
  "claims_reviewed",
  "proofs_established",
  "operational_use_allowed",
  "source_verified",
  "capabilities",
  "interface_path",
].sort();

export function parseAeroResearchStatus(value: unknown): AeroResearchStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  if (keys.length !== STATUS_KEYS.length || keys.some((key, i) => key !== STATUS_KEYS[i]))
    return null;
  if (
    row.schema !== "szl.aero-research-bridge/v1" ||
    row.state !== "research_only" ||
    row.claims_reviewed !== 11 ||
    row.proofs_established !== 0 ||
    row.operational_use_allowed !== false ||
    row.source_verified !== true ||
    row.interface_path !== AERO_INTERFACE_PATH ||
    !Array.isArray(row.capabilities) ||
    row.capabilities.length !== 2 ||
    row.capabilities[0] !== "source_reference" ||
    row.capabilities[1] !== "exact_arithmetic_diagnostic"
  )
    return null;
  return {
    schema: "szl.aero-research-bridge/v1",
    state: "research_only",
    claims_reviewed: 11,
    proofs_established: 0,
    operational_use_allowed: false,
    source_verified: true,
    capabilities: ["source_reference", "exact_arithmetic_diagnostic"],
    interface_path: AERO_INTERFACE_PATH,
  };
}

/** Call only after an explicit user gesture. No endpoint or destination comes from source prose. */
export async function readAeroResearchStatus(
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<AeroResearchStatus | null> {
  try {
    const response = await fetcher(AERO_STATUS_PATH, {
      method: "GET",
      signal,
      redirect: "error",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (
      !response.ok ||
      !response.body ||
      response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
        "application/json"
    )
      return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_AERO_STATUS_BYTES) return null;
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    if (signal.aborted) return null;
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return parseAeroResearchStatus(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
  } catch {
    return null;
  }
}
