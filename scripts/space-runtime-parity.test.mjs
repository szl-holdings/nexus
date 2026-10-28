#!/usr/bin/env node
// TS ↔ Python parity for the Python-served Space runtime (space/nexus_runtime.py).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { buildInfo, runtimeHealth } from "../src/lib/nexus/source-identity.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const REVISIONS = [
  "",
  SHA,
  " " + SHA.toUpperCase() + " \r\n",
  "0".repeat(40),
  "abc",
  SHA + "0",
  "g".repeat(40),
  // JavaScript trim() strips a byte-order mark; Python str.strip() does not.
  "﻿" + SHA,
  // Python str.strip() strips U+001C; JavaScript trim() does not.
  "\u001c" + SHA,
];

function python(...args) {
  return execFileSync("python3", ["space/nexus_runtime.py", ...args], { encoding: "utf8" });
}

test("build-info JSON is byte-identical in TS and Python", () => {
  for (const rev of REVISIONS) {
    assert.equal(python("build-info", rev), JSON.stringify(buildInfo(rev)), JSON.stringify(rev));
  }
});

test("health JSON is byte-identical in TS and Python", () => {
  for (const rev of REVISIONS) {
    assert.equal(python("health", rev), JSON.stringify(runtimeHealth(rev)), JSON.stringify(rev));
  }
});
