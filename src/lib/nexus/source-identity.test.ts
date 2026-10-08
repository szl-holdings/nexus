import assert from "node:assert/strict";
import test from "node:test";
import {
  DEPLOYMENT_AUTHORITY,
  HF_REPOSITORY,
  SOURCE_REPOSITORY,
  UNAVAILABLE,
  buildInfo,
  normalizeSourceRevision,
  runtimeHealth,
} from "./source-identity.ts";

const SHA = "c993af91740249825615be1c58a21af1f302ea2b";

test("normalizes one exact source revision", () => {
  assert.equal(normalizeSourceRevision(`  ${SHA.toUpperCase()}\n`), SHA);
});

for (const [label, value] of [
  ["zero placeholder", "0".repeat(40)],
  ["short", "f".repeat(39)],
  ["non-hex", "g".repeat(40)],
  ["empty", ""],
  ["missing", undefined],
] as const) {
  test(`rejects ${label}`, () => {
    assert.equal(normalizeSourceRevision(value), UNAVAILABLE);
  });
}

test("build information binds source, provider target, and central publisher", () => {
  assert.deepEqual(buildInfo(SHA), {
    schema: "szl.nexus-source-binding/v2",
    source_repository: SOURCE_REPOSITORY,
    source_revision: SHA,
    hf_repository: HF_REPOSITORY,
    deployment_authority: DEPLOYMENT_AUTHORITY,
    source_bound: true,
    runtime: "NITRO_NODE_WEB_AUDIO",
    frontend: "REACT_TANSTACK_WEB_AUDIO",
    audio_execution: "BROWSER_LOCAL_USER_GESTURE",
    deterministic_python_reference: "SOURCE_ONLY",
    energy: UNAVAILABLE,
    uniqueness: "Conjecture 1",
  });
});

test("health remains explicit when source binding is unavailable", () => {
  assert.deepEqual(runtimeHealth(UNAVAILABLE), {
    schema: "szl.nexus-runtime-health/v1",
    ok: true,
    status: "degraded",
    ready: false,
    service: "nexus",
    source_repository: SOURCE_REPOSITORY,
    source_revision: UNAVAILABLE,
    source_bound: false,
    runtime: "NITRO_NODE_WEB_AUDIO",
    frontend: "REACT_TANSTACK_WEB_AUDIO",
    audio: "USER_GESTURE_REQUIRED",
    state_storage: "BROWSER_INDEXEDDB",
    accounts_required: false,
    external_effectors: false,
    energy: UNAVAILABLE,
    uniqueness: "Conjecture 1",
  });
});

test("health becomes ready only for an exact bound revision", () => {
  const health = runtimeHealth(SHA);
  assert.equal(health.status, "ok");
  assert.equal(health.ready, true);
  assert.equal(health.source_revision, SHA);
});
