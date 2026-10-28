import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AERO_INTERFACE_PATH,
  AERO_STATUS_PATH,
  MAX_AERO_STATUS_BYTES,
  parseAeroResearchStatus,
  readAeroResearchStatus,
} from "./aero-research.ts";

const valid = () => ({
  schema: "szl.aero-research-bridge/v1",
  state: "research_only",
  claims_reviewed: 11,
  proofs_established: 0,
  operational_use_allowed: false,
  source_verified: true,
  capabilities: ["source_reference", "exact_arithmetic_diagnostic"],
  interface_path: AERO_INTERFACE_PATH,
});
const response = (body: unknown, status = 200, type = "application/json") =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": type } });
const load = (res: Response) =>
  readAeroResearchStatus(new AbortController().signal, async () => res);

test("accepts only the bounded research contract, returning a detached value", () => {
  const original = valid();
  const parsed = parseAeroResearchStatus(original);
  assert.deepEqual(parsed, original);
  assert.notEqual(parsed, original);
  assert.notEqual(parsed?.capabilities, original.capabilities);
});

for (const invalid of [
  null,
  [],
  true,
  "research_only",
  {},
  { ...valid(), extra: "claim content" },
]) {
  test(`rejects invalid shape ${JSON.stringify(invalid)}`, () =>
    assert.equal(parseAeroResearchStatus(invalid), null));
}

for (const [key, value] of Object.entries({
  schema: "unknown",
  state: "verified",
  claims_reviewed: 12,
  proofs_established: 1,
  operational_use_allowed: true,
  source_verified: false,
  capabilities: ["physical_control"],
  interface_path: "https://example.com/private-claims",
})) {
  test(`fails closed on changed ${key}`, () => {
    assert.equal(parseAeroResearchStatus({ ...valid(), [key]: value }), null);
    const missing: Record<string, unknown> = valid();
    delete missing[key];
    assert.equal(parseAeroResearchStatus(missing), null);
  });
}

test("rejects coercion, reordered or duplicate capabilities, and external/path variants", () => {
  for (const alteration of [
    { claims_reviewed: "11" },
    { proofs_established: false },
    { operational_use_allowed: 0 },
    { source_verified: "true" },
    { capabilities: ["exact_arithmetic_diagnostic", "source_reference"] },
    { capabilities: ["source_reference", "source_reference"] },
    { interface_path: "//example.com/" },
    { interface_path: "/research/aero/?redirect=https://example.com" },
  ])
    assert.equal(parseAeroResearchStatus({ ...valid(), ...alteration }), null);
});

test("requests only fixed same-origin metadata with no redirects or cache", async () => {
  let calls = 0;
  const controller = new AbortController();
  const result = await readAeroResearchStatus(controller.signal, async (url, options) => {
    calls++;
    assert.equal(url, AERO_STATUS_PATH);
    assert.deepEqual(options, {
      method: "GET",
      signal: controller.signal,
      redirect: "error",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    return response(valid());
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, valid());
});

test("missing backend and non-JSON fallback remain disconnected", async () => {
  for (const res of [
    response(valid(), 404),
    response(valid(), 503),
    response(valid(), 200, "text/html"),
    response(valid(), 200, "application/json-not-really"),
    new Response(null, { status: 204 }),
  ]) {
    assert.equal(await load(res), null);
  }
});

test("malformed, invalid UTF-8, oversized, and truncated bodies fail closed", async () => {
  for (const data of ["{", " ".repeat(MAX_AERO_STATUS_BYTES + 1), new Uint8Array([0xff])]) {
    assert.equal(
      await load(new Response(data, { headers: { "content-type": "application/json" } })),
      null,
    );
  }
});

test("oversized stream is cancelled before its remainder is read", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_AERO_STATUS_BYTES + 1));
    },
    cancel() {
      cancelled = true;
    },
  });
  assert.equal(
    await load(new Response(stream, { headers: { "content-type": "application/json" } })),
    null,
  );
  assert.equal(cancelled, true);
});

test("network errors and aborted checks never establish a connection", async () => {
  const controller = new AbortController();
  assert.equal(
    await readAeroResearchStatus(controller.signal, async () => {
      throw new Error("offline");
    }),
    null,
  );
  controller.abort();
  assert.equal(
    await readAeroResearchStatus(controller.signal, async () => response(valid())),
    null,
  );
});

test("UI begins disconnected and links only after a successful user-requested check", () => {
  const ui = readFileSync(
    new URL("../../components/nexus/AeroResearch.tsx", import.meta.url),
    "utf8",
  );
  const workstation = readFileSync(
    new URL("../../components/nexus/Workstation.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /useState<[^;]+>\("disconnected"\)/);
  assert.match(ui, /onClick=\{\(\) => void inspect\(\)\}/);
  assert.match(ui, /state === "available" \?\s*\(?\s*<a href=\{AERO_INTERFACE_PATH\}/);
  assert.match(ui, /request\.current = null/);
  assert.equal((ui.match(/readAeroResearchStatus\(controller.signal\)/g) || []).length, 1);
  assert.doesNotMatch(ui, /engine\.|dangerouslySetInnerHTML|claims\.json|source\.pdf/);
  assert.match(workstation, /<AeroResearch \/>/);
});
