// SPDX-License-Identifier: Apache-2.0
/** Opt-in, loopback-only delegation to one admitted Node process. Not native Python parity. */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage, type Server } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJson,
  dynamicsInputPayload,
  dynamicsOutput,
  immuneV1Output,
  normalizeDynamicsInput,
} from "./dynamics.ts";
import type { AnalogMethod } from "./math.ts";

export const AUTHORITY_PROFILE_SCHEMA = "szl.nexus-authority-profile/v1";
export const AUTHORITY_REQUEST_SCHEMA = "szl.nexus-authoritative-request/v1";
export const AUTHORITY_RESULT_SCHEMA = "szl.nexus-authoritative-execution/v1";
export const AUTHORITY_ERROR_SCHEMA = "szl.nexus-authority-error/v1";
export const AUTHORITY_EXECUTION = "DELEGATED_SINGLE_NODE_PROCESS";
const MAX_REQUEST_BYTES = 65_536;
const MAX_RESPONSE_BYTES = 1_048_576;
const DEADLINE_MS = 30_000;
const SOURCE_PATHS = [
  "src/lib/nexus/authoritative-node.ts",
  "src/lib/nexus/dynamics.ts",
  "src/lib/nexus/math.ts",
  "contracts/nexus-authoritative-execution-v1.json",
] as const;
const ROOT = new URL("../../../", import.meta.url);

type Contract = "immune-v1" | "dynamics-v2";
type JsonObject = Record<string, any>;
export interface AuthorityProfile {
  schema: typeof AUTHORITY_PROFILE_SCHEMA;
  authorityId: string;
  algorithmContract: typeof AUTHORITY_RESULT_SCHEMA;
  execution: typeof AUTHORITY_EXECUTION;
  runtime: {
    node: string;
    v8: string;
    platform: string;
    arch: string;
    execArgv: string[];
    executableSha256: string;
  };
  sourceFilesSha256: Record<string, string>;
}
export interface AuthorityResult {
  schema: typeof AUTHORITY_RESULT_SCHEMA;
  execution: typeof AUTHORITY_EXECUTION;
  profile: AuthorityProfile;
  contract: Contract;
  method: AnalogMethod;
  input: JsonObject;
  inputHash: string;
  output: JsonObject;
  outputHash: string;
  resultHash: string;
}
export class AuthorityError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AuthorityError";
    this.code = code;
  }
}
function fail(code: string, message: string): never {
  throw new AuthorityError(code, message);
}
function record(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function keys(value: JsonObject, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}
function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
function hash(value: unknown): string {
  return sha256(canonicalJson(value));
}
/** Exact binary64 structural encoding; signed zero folds to zero for JSON transport. */
export function exactAuthorityJson(value: unknown): string {
  function project(item: unknown): unknown {
    if (item === null) return ["null"];
    if (typeof item === "boolean") return ["bool", item];
    if (typeof item === "string") return ["string", item];
    if (typeof item === "number") {
      if (!Number.isFinite(item)) fail("NON_FINITE_NUMBER", "Authority values must be finite");
      const bytes = Buffer.alloc(8);
      bytes.writeDoubleBE(item === 0 ? 0 : item);
      return ["number", bytes.toString("hex")];
    }
    if (Array.isArray(item)) return ["array", item.map(project)];
    if (record(item))
      return [
        "object",
        Object.keys(item)
          .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
          .map((key) => [key, project(item[key])]),
      ];
    return fail("INVALID_VALUE", "Authority values must be JSON values");
  }
  return JSON.stringify(project(value));
}
function exactHash(value: unknown): string {
  return sha256(exactAuthorityJson(value));
}
function digest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
function sources(): Record<string, string> {
  return Object.fromEntries(
    SOURCE_PATHS.map((path) => [path, sha256(readFileSync(new URL(path, ROOT)))]),
  );
}
export function validateAuthorityProfile(value: unknown): asserts value is AuthorityProfile {
  if (
    !record(value) ||
    !keys(value, [
      "schema",
      "authorityId",
      "algorithmContract",
      "execution",
      "runtime",
      "sourceFilesSha256",
    ]) ||
    value.schema !== AUTHORITY_PROFILE_SCHEMA ||
    value.algorithmContract !== AUTHORITY_RESULT_SCHEMA ||
    value.execution !== AUTHORITY_EXECUTION ||
    typeof value.authorityId !== "string" ||
    !/^[0-9a-f-]{36}$/.test(value.authorityId) ||
    !record(value.runtime) ||
    !keys(value.runtime, ["node", "v8", "platform", "arch", "execArgv", "executableSha256"]) ||
    !["node", "v8", "platform", "arch"].every(
      (key) => typeof value.runtime[key] === "string" && value.runtime[key],
    ) ||
    !Array.isArray(value.runtime.execArgv) ||
    !value.runtime.execArgv.every((v: unknown) => typeof v === "string") ||
    !digest(value.runtime.executableSha256) ||
    !record(value.sourceFilesSha256) ||
    !keys(value.sourceFilesSha256, SOURCE_PATHS) ||
    !Object.values(value.sourceFilesSha256).every(digest)
  ) {
    fail("INVALID_PROFILE", "A complete admitted authority profile is required");
  }
}
function assertCleanLaunch(): void {
  const forbidden = [
    "NODE_OPTIONS",
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
  ];
  if (
    forbidden.some((key) => process.env[key]) ||
    process.execArgv.some((arg) => arg !== "--experimental-strip-types")
  ) {
    fail(
      "UNSUPPORTED_LAUNCH",
      "Authority requires a plain Node launch without preload, loader or custom V8 options",
    );
  }
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 6))
    fail("UNSUPPORTED_RUNTIME", "Node >=22.6 is required");
}
function newProfile(): AuthorityProfile {
  assertCleanLaunch();
  const profile: AuthorityProfile = {
    schema: AUTHORITY_PROFILE_SCHEMA,
    authorityId: randomUUID(),
    algorithmContract: AUTHORITY_RESULT_SCHEMA,
    execution: AUTHORITY_EXECUTION,
    runtime: {
      node: process.version,
      v8: process.versions.v8,
      platform: process.platform,
      arch: process.arch,
      execArgv: [...process.execArgv],
      executableSha256: sha256(readFileSync(process.execPath)),
    },
    sourceFilesSha256: sources(),
  };
  Object.freeze(profile.runtime.execArgv);
  Object.freeze(profile.runtime);
  Object.freeze(profile.sourceFilesSha256);
  return Object.freeze(profile);
}
function requestPayload(
  profile: AuthorityProfile,
  input: unknown,
  contract: Contract,
  method: AnalogMethod,
): JsonObject {
  if (contract !== "immune-v1" && contract !== "dynamics-v2")
    fail("UNKNOWN_CONTRACT", "Unknown output contract");
  if (!["euler4", "rk4", "symplectic"].includes(method))
    fail("UNKNOWN_METHOD", "Unknown integration method");
  if (contract === "immune-v1" && method !== "euler4")
    fail("UNSUPPORTED_METHOD", "immune-v1 supports only euler4");
  const normalized = dynamicsInputPayload(normalizeDynamicsInput(input), method).input;
  return {
    schema: AUTHORITY_REQUEST_SCHEMA,
    expectedProfile: profile,
    contract,
    method,
    input: normalized,
  };
}
function execute(value: unknown, profile: AuthorityProfile): AuthorityResult {
  if (
    !record(value) ||
    !keys(value, ["schema", "expectedProfile", "contract", "method", "input"]) ||
    value.schema !== AUTHORITY_REQUEST_SCHEMA
  )
    fail("INVALID_REQUEST", "Invalid authoritative request envelope");
  validateAuthorityProfile(value.expectedProfile);
  if (canonicalJson(value.expectedProfile) !== canonicalJson(profile))
    fail("AUTHORITY_MISMATCH", "Authority profile changed; explicit re-admission is required");
  if (canonicalJson(sources()) !== canonicalJson(profile.sourceFilesSha256))
    fail("SOURCE_CHANGED", "Authority source changed; restart and explicitly re-admit");
  const request = requestPayload(profile, value.input, value.contract, value.method);
  const input = normalizeDynamicsInput(request.input);
  const output =
    request.contract === "immune-v1"
      ? immuneV1Output(input)
      : dynamicsOutput(input, request.method);
  if (canonicalJson(sources()) !== canonicalJson(profile.sourceFilesSha256))
    fail("SOURCE_CHANGED", "Authority source changed during execution");
  const result = {
    schema: AUTHORITY_RESULT_SCHEMA,
    execution: AUTHORITY_EXECUTION,
    profile,
    contract: request.contract,
    method: request.method,
    input: request.input,
    inputHash: exactHash(request),
    output,
    outputHash: hash(output),
  };
  return { ...result, resultHash: exactHash(result) } as AuthorityResult;
}
export function verifyAuthorityResult(
  value: unknown,
  profile: AuthorityProfile,
  input: unknown,
  contract: Contract = "dynamics-v2",
  method: AnalogMethod = "euler4",
): AuthorityResult {
  validateAuthorityProfile(profile);
  const request = requestPayload(profile, input, contract, method);
  if (
    !record(value) ||
    !keys(value, [
      "schema",
      "execution",
      "profile",
      "contract",
      "method",
      "input",
      "inputHash",
      "output",
      "outputHash",
      "resultHash",
    ]) ||
    value.schema !== AUTHORITY_RESULT_SCHEMA ||
    value.execution !== AUTHORITY_EXECUTION ||
    canonicalJson(value.profile) !== canonicalJson(profile) ||
    value.contract !== contract ||
    value.method !== method ||
    exactAuthorityJson(value.input) !== exactAuthorityJson(request.input) ||
    value.inputHash !== exactHash(request) ||
    !record(value.output) ||
    value.output.schema !==
      (contract === "immune-v1" ? "szl.immune-nexus-parity/v1" : "szl.nexus-dynamics-output/v2") ||
    value.outputHash !== hash(value.output)
  )
    fail(
      "INVALID_RESULT",
      "Authority result does not match the admitted request and payload hashes",
    );
  const { resultHash, ...body } = value;
  if (resultHash !== exactHash(body))
    fail("INVALID_RESULT", "Authority result hash does not match");
  return value as AuthorityResult;
}
function endpointUrl(endpoint: string, path: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return fail("INVALID_ENDPOINT", "Use an explicit http://127.0.0.1:port endpoint");
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    fail("INVALID_ENDPOINT", "Only an explicit loopback authority endpoint is allowed");
  return new URL(path, url);
}
function readBody(message: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    message.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new AuthorityError("BODY_TOO_LARGE", "Authority message exceeds its size limit"));
        message.destroy();
      } else chunks.push(chunk);
    });
    message.on("end", () => resolveBody(Buffer.concat(chunks)));
    message.on("error", reject);
    message.on("aborted", () =>
      reject(new AuthorityError("TRUNCATED_RESPONSE", "Authority message was interrupted")),
    );
  });
}
function exchange(
  endpoint: string,
  path: string,
  payload?: unknown,
  timeoutMs = DEADLINE_MS,
): Promise<unknown> {
  const url = endpointUrl(endpoint, path);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000)
    fail("INVALID_TIMEOUT", "Timeout must be between 0 and 120000 ms");
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  if (body && Buffer.byteLength(body) > MAX_REQUEST_BYTES)
    fail("BODY_TOO_LARGE", "Authority request exceeds its size limit");
  return new Promise((resolveResult, reject) => {
    const req = httpRequest(
      url,
      {
        method: body === undefined ? "GET" : "POST",
        agent: false,
        headers:
          body === undefined
            ? {}
            : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      async (res) => {
        try {
          if (res.headers["content-type"] !== "application/json")
            fail("INVALID_RESPONSE", "Authority must return JSON");
          const value = JSON.parse((await readBody(res, MAX_RESPONSE_BYTES)).toString("utf8"));
          if (res.statusCode !== 200) {
            if (
              record(value) &&
              value.schema === AUTHORITY_ERROR_SCHEMA &&
              record(value.error) &&
              typeof value.error.code === "string" &&
              typeof value.error.message === "string"
            ) {
              fail(value.error.code, value.error.message);
            }
            fail("INVALID_RESPONSE", "Authority returned an invalid error response");
          }
          resolveResult(value);
        } catch (error) {
          reject(error);
          res.destroy();
        } finally {
          clearTimeout(timer);
        }
      },
    );
    const timer = setTimeout(
      () =>
        req.destroy(new AuthorityError("TIMEOUT", "Authority request exceeded its total deadline")),
      timeoutMs,
    );
    req.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    req.end(body);
  });
}
/** Explicit discovery/admission step. Execution never refreshes this profile automatically. */
export async function readAuthorityProfile(endpoint: string): Promise<AuthorityProfile> {
  const value = await exchange(endpoint, "/profile");
  validateAuthorityProfile(value);
  return value;
}
export async function runAuthoritative(
  endpoint: string,
  expectedProfile: AuthorityProfile,
  input: unknown,
  contract: Contract = "dynamics-v2",
  method: AnalogMethod = "euler4",
  timeoutMs = DEADLINE_MS,
): Promise<AuthorityResult> {
  validateAuthorityProfile(expectedProfile);
  const profile = JSON.parse(JSON.stringify(expectedProfile)) as AuthorityProfile;
  const request = requestPayload(profile, input, contract, method);
  return verifyAuthorityResult(
    await exchange(endpoint, "/run", request, timeoutMs),
    profile,
    input,
    contract,
    method,
  );
}
async function startAuthority(): Promise<{
  endpoint: string;
  profile: AuthorityProfile;
  server: Server;
  close: () => Promise<void>;
}> {
  const profile = newProfile();
  const server = createServer(async (req, res) => {
    const timer = setTimeout(
      () =>
        req.destroy(new AuthorityError("TIMEOUT", "Authority request exceeded its total deadline")),
      DEADLINE_MS,
    );
    const send = (status: number, value: unknown) => {
      const body = JSON.stringify(value);
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "Cache-Control": "no-store",
        Connection: "close",
      });
      res.end(body);
    };
    try {
      if (req.headers.origin) fail("ORIGIN_FORBIDDEN", "Browser-origin requests are not admitted");
      if (req.method === "GET" && req.url === "/profile") send(200, profile);
      else if (req.method === "POST" && req.url === "/run") {
        if (req.headers["content-type"] !== "application/json")
          fail("INVALID_REQUEST", "Content-Type must be application/json");
        const body = await readBody(req, MAX_REQUEST_BYTES);
        send(200, execute(JSON.parse(body.toString("utf8")), profile));
      } else fail("INVALID_ROUTE", "Only GET /profile and POST /run are supported");
    } catch (error) {
      const code =
        error instanceof Error && "code" in error && typeof error.code === "string"
          ? error.code
          : "EXECUTION_ERROR";
      if (!res.destroyed)
        send(422, {
          schema: AUTHORITY_ERROR_SCHEMA,
          error: { code, message: error instanceof Error ? error.message : String(error) },
        });
    } finally {
      clearTimeout(timer);
    }
  });
  server.headersTimeout = DEADLINE_MS;
  server.requestTimeout = DEADLINE_MS;
  server.maxRequestsPerSocket = 1;
  // Cover slow headers too: createServer's request callback begins after headers.
  server.on("connection", (socket) => {
    const deadline = setTimeout(() => socket.destroy(), DEADLINE_MS);
    socket.once("close", () => clearTimeout(deadline));
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    fail("LISTEN_FAILED", "Loopback address unavailable");
  }
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    profile,
    server,
    close: () =>
      new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      ),
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== "serve") {
    process.stderr.write(
      "Usage: node --experimental-strip-types src/lib/nexus/authoritative-node.ts serve\n",
    );
    process.exitCode = 2;
  } else {
    try {
      const authority = await startAuthority();
      process.stdout.write(
        `${JSON.stringify({ endpoint: authority.endpoint, profile: authority.profile })}\n`,
      );
      for (const signal of ["SIGINT", "SIGTERM"] as const)
        process.once(signal, () => {
          void authority.close();
        });
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
      process.exitCode = 2;
    }
  }
}
