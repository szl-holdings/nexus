// SPDX-License-Identifier: Apache-2.0
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import {
  AuthorityError,
  exactAuthorityJson,
  readAuthorityProfile,
  runAuthoritative,
  verifyAuthorityResult,
} from "./authoritative-node.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const LAMBDA = {
  program: "harmonic",
  mode: "IC",
  steps: 0,
  dt: 0.01,
  chaos: 0.5,
  drive: 0.5,
  seed: 0.2,
  repeatEvery: 32,
  axes: [0.1622758695],
};
const DUFFING = {
  program: "duffing",
  mode: "OP",
  steps: 2400,
  dt: 0.04,
  chaos: 0.9,
  drive: 0.8,
  seed: 0.3,
  repeatEvery: 32,
};
async function launchAuthority() {
  const env = { ...process.env };
  for (const key of [
    "NODE_OPTIONS",
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
  ])
    delete env[key];
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", `${ROOT}/src/lib/nexus/authoritative-node.ts`, "serve"],
    { cwd: ROOT, env },
  );
  const ready = await new Promise<{
    endpoint: string;
    profile: import("./authoritative-node.ts").AuthorityProfile;
  }>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("authority startup timed out"));
    }, 10_000);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.includes("\n")) {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(stdout.split("\n")[0]));
        } catch (error) {
          reject(error);
          child.kill();
        }
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(stderr));
    });
  });
  return {
    ...ready,
    close: async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        await once(child, "exit");
      }
    },
  };
}
let authority: Awaited<ReturnType<typeof launchAuthority>>;
before(async () => {
  authority = await launchAuthority();
});
after(async () => {
  await authority?.close();
});

function python(script: string, input: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const executable = process.platform === "win32" ? "py" : "python3";
    const args = process.platform === "win32" ? ["-3", "-c", script] : ["-c", script];
    const child = spawn(executable, args, {
      cwd: ROOT,
      env: { ...process.env, PYTHONPATH: `${ROOT}/python` },
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => child.kill(), 30_000);
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(Buffer.concat(err).toString()));
      else {
        try {
          resolve(JSON.parse(Buffer.concat(out).toString()));
        } catch (error) {
          reject(error);
        }
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
for (const [contract, input] of [
  ["immune-v1", LAMBDA],
  ["dynamics-v2", DUFFING],
] as const) {
  test(`${contract}: Python and Node share exact authority result for native mismatch case`, async () => {
    const node = await runAuthoritative(authority.endpoint, authority.profile, input, contract);
    const py = await python(
      `import json,sys\nfrom nexus_dynamics.authoritative import run_authoritative\nr=json.load(sys.stdin)\nprint(json.dumps(run_authoritative(r['input'],endpoint=r['endpoint'],expected_profile=r['profile'],contract=r['contract'])))`,
      { endpoint: authority.endpoint, profile: authority.profile, input, contract },
    );
    assert.deepEqual(py, node);
    assert.equal(node.execution, "DELEGATED_SINGLE_NODE_PROCESS");
    assert.equal(node.outputHash.length, 64);
  });
}
test("exact structural encoding agrees across clients at binary64 and Unicode boundaries", async () => {
  const values = [
    0,
    -0,
    Number.MIN_VALUE,
    Number.MAX_VALUE,
    0.010000000001,
    0.1622758695,
    2 ** -1022,
    { "\u{10000}": "\u0000", "\ue000": true, nested: [null, false, "number", "8000000000000000"] },
  ];
  const py = await python(
    "import json,sys\nfrom nexus_dynamics.authoritative import exact_authority_json\nprint(json.dumps(exact_authority_json(json.load(sys.stdin))))",
    values,
  );
  assert.equal(exactAuthorityJson(values), py);
});
test("sub-nine-decimal request substitution is rejected", async () => {
  const result = await runAuthoritative(authority.endpoint, authority.profile, DUFFING);
  assert.throws(
    () => verifyAuthorityResult(result, authority.profile, { ...DUFFING, dt: 0.040000000001 }),
    (error: unknown) => error instanceof AuthorityError && error.code === "INVALID_RESULT",
  );
});
test("a stale profile, changed contract, or changed source digest cannot execute", async () => {
  for (const change of [
    (p: any) => {
      p.authorityId = "00000000-0000-0000-0000-000000000000";
    },
    (p: any) => {
      p.runtime.v8 = "different";
    },
    (p: any) => {
      p.sourceFilesSha256["src/lib/nexus/math.ts"] = "0".repeat(64);
    },
  ]) {
    const profile = structuredClone(authority.profile);
    change(profile);
    await assert.rejects(
      runAuthoritative(authority.endpoint, profile, LAMBDA),
      (error: unknown) => error instanceof AuthorityError && error.code === "AUTHORITY_MISMATCH",
    );
  }
  await assert.rejects(
    runAuthoritative(authority.endpoint, authority.profile, LAMBDA, "immune-v1", "rk4"),
    (error: unknown) => error instanceof AuthorityError && error.code === "UNSUPPORTED_METHOD",
  );
});
test("tampered result, output, and request hashes fail verification", async () => {
  const original = await runAuthoritative(
    authority.endpoint,
    authority.profile,
    LAMBDA,
    "immune-v1",
  );
  for (const field of ["inputHash", "outputHash", "resultHash"] as const) {
    assert.throws(() =>
      verifyAuthorityResult(
        { ...original, [field]: "0".repeat(64) },
        authority.profile,
        LAMBDA,
        "immune-v1",
      ),
    );
  }
  const changed = structuredClone(original);
  changed.output.lambda.value += 1e-12;
  assert.throws(() => verifyAuthorityResult(changed, authority.profile, LAMBDA, "immune-v1"));
});
test("restarted process requires new explicit admission", async () => {
  const another = await launchAuthority();
  try {
    assert.notEqual(another.profile.authorityId, authority.profile.authorityId);
    await assert.rejects(
      runAuthoritative(another.endpoint, authority.profile, LAMBDA),
      (error: unknown) => error instanceof AuthorityError && error.code === "AUTHORITY_MISMATCH",
    );
    assert.deepEqual(await readAuthorityProfile(another.endpoint), another.profile);
  } finally {
    await another.close();
  }
});
test("endpoint cannot select remote hosts, redirects, credentials or paths", async () => {
  for (const endpoint of [
    "https://example.org",
    "http://localhost:123",
    "http://127.0.0.1:123/run",
    "http://user@127.0.0.1:123",
  ])
    await assert.rejects(
      readAuthorityProfile(endpoint),
      (error: unknown) => error instanceof AuthorityError && error.code === "INVALID_ENDPOINT",
    );
});
test("one total deadline bounds a drip-fed body", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.flushHeaders();
    const timer = setInterval(() => res.write(" "), 10);
    res.on("close", () => clearInterval(timer));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const start = Date.now();
    await assert.rejects(
      runAuthoritative(
        `http://127.0.0.1:${address.port}`,
        authority.profile,
        LAMBDA,
        "dynamics-v2",
        "euler4",
        60,
      ),
    );
    assert.ok(Date.now() - start < 1500);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
