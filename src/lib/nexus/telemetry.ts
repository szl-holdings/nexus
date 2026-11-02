/** Hatun + anatomy probes. Honest LIVE / UNAVAILABLE. Never fabricate green. */
import { DEPLOYMENT_AUTHORITY, HF_REPOSITORY, SOURCE_REPOSITORY, UNAVAILABLE, normalizeSourceRevision } from "./source-identity.ts";

export type ProbeStatus = "LIVE" | "UNAVAILABLE";

export interface Probe {
  id: string;
  label: string;
  status: ProbeStatus;
  detail: string;
  at: number;
}

type ProbeEndpoint = { id: string; label: string } & (
  { url: string; unavailable?: never } | { url?: never; unavailable: string }
);

export const ENDPOINTS: ProbeEndpoint[] = [
  // A11oy's /wires + /hatun-mcp product surfaces declare this MCP transport.
  // This is szl-a11oy-mcp, not the retired standalone Python Hatun deployment.
  { id: "hatun", label: "Hatun product gateway", url: "https://szlholdings-a11oy.hf.space/mcp/" },
  { id: "anatomy", label: "Anatomy", url: "https://betterwithage-anatomy.hf.space/healthz" },
  { id: "nexus-space", label: "NEXUS runtime", url: "https://szlholdings-nexus.hf.space/api/build-info" },
];

export function idleProbes(): Probe[] {
  return ENDPOINTS.map((e) => ({
    id: e.id,
    label: e.label,
    status: "UNAVAILABLE" as const,
    detail: e.unavailable ?? "not probed",
    at: 0,
  }));
}

export function parseProbes(data: unknown): Probe[] | null {
  if (!Array.isArray(data)) return null;
  const out: Probe[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") return null;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.label !== "string") return null;
    if (r.status !== "LIVE" && r.status !== "UNAVAILABLE") return null;
    if (typeof r.detail !== "string") return null;
    out.push({
      id: r.id,
      label: r.label,
      status: r.status,
      detail: r.detail,
      at: typeof r.at === "number" ? r.at : 0,
    });
  }
  if (out.length !== ENDPOINTS.length) return null;
  if (!ENDPOINTS.every((e) => out.some((p) => p.id === e.id))) return null;
  return out;
}

export async function probeEstate(timeoutMs = 2800): Promise<Probe[]> {
  return Promise.all(ENDPOINTS.map((e) => probeOne(e, timeoutMs)));
}

const MAX_PROBE_BYTES = 64 * 1024;
const HATUN_INITIALIZE = {
  jsonrpc: "2.0", id: "nexus-probe", method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "nexus-probe", version: "1" } },
};

class ProbeTooLarge extends Error {}

async function readProbeBody(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PROBE_BYTES) {
        void reader.cancel().catch(() => {});
        throw new ProbeTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function probeOne(e: ProbeEndpoint, timeoutMs: number): Promise<Probe> {
  const at = Date.now();
  if (e.unavailable !== undefined) {
    return { id: e.id, label: e.label, status: "UNAVAILABLE", detail: e.unavailable, at };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const hatun = e.id === "hatun";
    const res = await fetch(e.url, {
      signal: ctrl.signal,
      ...(hatun ? {
        redirect: "error",
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify(HATUN_INITIALIZE),
      } : {}),
    });
    if (!res.ok) {
      ctrl.abort(); // Do not consume an error response body.
      return { id: e.id, label: e.label, status: "UNAVAILABLE", detail: `HTTP ${res.status}`, at };
    }
    // Keep the same deadline active through the body, including chunked responses.
    const body = await readProbeBody(res);
    const nexus = e.id === "nexus-space";
    const anatomy = e.id === "anatomy";
    const unavailable = nexus ? "runtime source identity unavailable" : anatomy ? "anatomy transport contract unavailable"
      : hatun ? "A11oy MCP handshake unavailable" : `HTTP ${res.status}`;
    let detail = unavailable;
    let live = !nexus && !anatomy && !hatun;
    try {
      const j = JSON.parse(body) as Record<string, unknown>;
      if (nexus) {
        const revision = typeof j.source_revision === "string" ? j.source_revision : "";
        live = j.schema === "szl.nexus-source-binding/v2"
          && j.source_repository === SOURCE_REPOSITORY
          && j.hf_repository === HF_REPOSITORY
          && j.deployment_authority === DEPLOYMENT_AUTHORITY
          && j.source_bound === true
          && revision !== UNAVAILABLE
          && normalizeSourceRevision(revision) === revision
          && j.runtime === "PYTHON_STDLIB_STATIC_WEB_AUDIO"
          && j.energy === UNAVAILABLE
          && j.uniqueness === "Conjecture 1";
        detail = live ? "source-bound Python runtime" : "runtime source identity unavailable";
      } else if (anatomy) {
        // This is transport for a read-only snapshot, never scientific or model qualification.
        live = j.service === "anatomy-space" && j.organ === "anatomy"
          && j.status === "ok" && j.transport_state === "REACHABLE"
          && j.authority_state === "READ_ONLY" && j.evidence_state === "SNAPSHOT"
          && j.verification_state === "STRUCTURAL_ONLY";
        detail = live ? "read-only transport; snapshot evidence" : unavailable;
      } else if (hatun) {
        const result = j.result as Record<string, unknown> | undefined;
        const server = result?.serverInfo as Record<string, unknown> | undefined;
        const capabilities = result?.capabilities as Record<string, unknown> | undefined;
        const tools = capabilities?.tools as Record<string, unknown> | undefined;
        live = j.jsonrpc === "2.0" && j.id === HATUN_INITIALIZE.id && !("error" in j)
          && result?.protocolVersion === "2024-11-05"
          && server?.name === "szl-a11oy-mcp" && server?.version === "1.1.0"
          && tools?.listChanged === false;
        detail = live ? "A11oy MCP transport; signing unverified" : unavailable;
      } else if (typeof j.status === "string") detail = j.status;
      else if (typeof j.evidenceState === "string") detail = j.evidenceState;
      else if (typeof j.sdk === "string") detail = String(j.sdk);
    } catch {
      detail = unavailable;
    }
    return { id: e.id, label: e.label, status: live ? "LIVE" : "UNAVAILABLE", detail, at };
  } catch (err) {
    const reason = err instanceof Error ? err.name : "error";
    return {
      id: e.id,
      label: e.label,
      status: "UNAVAILABLE",
      detail: err instanceof ProbeTooLarge ? "response too large"
        : ctrl.signal.aborted || reason === "AbortError" ? "timeout" : "cors or unreachable",
      at,
    };
  } finally {
    clearTimeout(t);
  }
}
