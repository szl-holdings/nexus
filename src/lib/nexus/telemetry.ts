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

export const ENDPOINTS: { id: string; label: string; url: string }[] = [
  { id: "hatun", label: "Hatun gateway", url: "https://a-11-oy.com/api/hatun/evidence" },
  { id: "anatomy", label: "Anatomy", url: "https://betterwithage-anatomy.hf.space/healthz" },
  { id: "nexus-space", label: "NEXUS runtime", url: "https://szlholdings-nexus.hf.space/api/build-info" },
];

export function idleProbes(): Probe[] {
  return ENDPOINTS.map((e) => ({
    id: e.id,
    label: e.label,
    status: "UNAVAILABLE" as const,
    detail: "not probed",
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

async function probeOne(e: { id: string; label: string; url: string }, timeoutMs: number): Promise<Probe> {
  const at = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(e.url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) {
      return { id: e.id, label: e.label, status: "UNAVAILABLE", detail: `HTTP ${res.status}`, at };
    }
    const nexus = e.id === "nexus-space";
    const anatomy = e.id === "anatomy";
    const hatun = e.id === "hatun";
    const unavailable = nexus ? "runtime source identity unavailable" : anatomy ? "anatomy transport contract unavailable" : hatun ? "hatun gateway contract unavailable" : `HTTP ${res.status}`;
    let detail = unavailable;
    let live = !nexus && !anatomy && !hatun;
    try {
      const j = (await res.json()) as Record<string, unknown>;
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
        // GET declares gateway/tool availability; it never proves signing or execution.
        const runtime = j.runtime as Record<string, unknown> | null;
        const catalog = j.tool_catalog as Record<string, unknown> | null;
        live = j.schema === "szl.hatun.evidence.v1" && j.namespace === "a11oy"
          && j.read_only === true && j.get_mints_receipt === false
          && runtime?.status === "AVAILABLE" && runtime?.mcp_endpoint === "/mcp/"
          && catalog?.status === "RUNTIME_DECLARED";
        detail = live ? "read-only gateway; tools declared; execution unverified" : unavailable;
      } else if (typeof j.status === "string") detail = j.status;
      else if (typeof j.evidenceState === "string") detail = j.evidenceState;
      else if (typeof j.sdk === "string") detail = String(j.sdk);
    } catch {
      detail = unavailable;
    }
    return { id: e.id, label: e.label, status: live ? "LIVE" : "UNAVAILABLE", detail, at };
  } catch (err) {
    clearTimeout(t);
    const reason = err instanceof Error ? err.name : "error";
    return {
      id: e.id,
      label: e.label,
      status: "UNAVAILABLE",
      detail: reason === "AbortError" ? "timeout" : "cors or unreachable",
      at,
    };
  }
}
