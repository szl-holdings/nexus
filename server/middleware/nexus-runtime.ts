/**
 * Source-bound runtime endpoints for the canonical NEXUS Space.
 *
 * The full React/Web Audio workstation is served by Nitro. These two read-only
 * endpoints expose the immutable Git source injected by the central publisher;
 * they do not mint receipts, activate accounts, or authorize external effects.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildInfo, runtimeHealth } from "../../src/lib/nexus/source-identity";

interface NexusRuntimeEvent {
  url: URL;
  req: { method: string };
}

export const SOURCE_FILE =
  process.env.SOURCE_GITHUB_SHA_FILE || join(process.cwd(), "SOURCE_GITHUB_SHA");

export function readSourceRevision(path = SOURCE_FILE): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "UNAVAILABLE";
  }
}

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export default function nexusRuntimeMiddleware(
  event: NexusRuntimeEvent,
  next: () => unknown | Promise<unknown>,
): unknown | Promise<unknown> {
  if ((event.req.method || "GET").toUpperCase() !== "GET") return next();
  const path = event.url.pathname;
  if (path === "/api/build-info") return json(buildInfo(readSourceRevision()));
  if (path === "/health" || path === "/healthz") {
    return json(runtimeHealth(readSourceRevision()));
  }
  return next();
}
