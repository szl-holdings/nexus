import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { betterAuth } from "better-auth";
import { genericOAuth } from "better-auth/plugins";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthClient } from "better-auth/react";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://nexus-test.example.invalid";

test("app client and popup use the installed social API, not removed OAuth2 APIs", () => {
  const client = readFileSync(join(ROOT, "src/lib/auth/client.ts"), "utf8");
  const popup = readFileSync(join(ROOT, "src/lib/auth/popup.server.ts"), "utf8");
  assert.doesNotMatch(client + popup, /genericOAuthClient|signInWithOAuth2|signIn\.oauth2/);
  assert.match(client, /authClient\.signIn\.social\(\{\s*provider: providerId/);
  assert.match(popup, /auth\.api\.signInSocial\(\{\s*body: \{\s*provider: providerId/);
});

test("real client social API serializes the provider to the standard endpoint", async () => {
  const requests = [];
  const client = createAuthClient({
    baseURL: BASE,
    fetchOptions: {
      customFetchImpl: async (url, init) => {
        requests.push({ url: String(url), body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ url: BASE + "/complete", redirect: false }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  });
  const result = await client.signIn.social({ provider: "fixture-oauth", callbackURL: "/" });
  assert.equal(result.error, null);
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].url).pathname, "/api/auth/sign-in/social");
  assert.equal(requests[0].body.provider, "fixture-oauth");
});

test("real server initializes PKCE and the 1.7 callback without contacting a provider", async () => {
  let networkCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { networkCalls++; throw new Error("external network forbidden in fixture"); };
  try {
    const auth = betterAuth({
      baseURL: BASE,
      secret: "synthetic-test-only-not-an-operational-secret-20260929",
      logger: { disabled: true },
      database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
      trustedOrigins: [BASE],
      plugins: [genericOAuth({ config: [{
        providerId: "fixture-oauth",
        clientId: "synthetic-fixture-client",
        clientSecret: "synthetic-fixture-client-secret",
        authorizationUrl: "https://provider.example.invalid/authorize",
        tokenUrl: "https://provider.example.invalid/token",
        userInfoUrl: "https://provider.example.invalid/userinfo",
      }] })],
    });
    const response = await auth.api.signInSocial({
      body: { provider: "fixture-oauth", callbackURL: BASE + "/complete" },
      headers: new Headers({ origin: BASE }),
      asResponse: true,
    });
    assert.equal(response.status, 200);
    const target = new URL((await response.json()).url);
    assert.equal(target.origin, "https://provider.example.invalid");
    assert.equal(new URL(target.searchParams.get("redirect_uri")).pathname, "/api/auth/callback/fixture-oauth");
    assert.equal(target.searchParams.get("code_challenge_method"), "S256");
    assert.ok(target.searchParams.get("code_challenge"));
    assert.ok(target.searchParams.get("state"));
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
