import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  requestAuthPolicy,
  resolveFederation,
  type BrokerClient,
  type EnvReader,
  type FederationMode,
} from "./federation.ts";

// Sentinels only. The real shared preview credential is never imported here.
const PREVIEW: BrokerClient = {
  clientId: "preview-id-sentinel",
  clientSecret: "preview-secret-sentinel-not-a-credential",
};
const PER_APP: BrokerClient = {
  clientId: "per-app-id-test",
  clientSecret: "per-app-secret-test-not-real",
};
const DEPLOYED_URL = "https://app.example.test";

function envOf(values: Record<string, string | undefined>): EnvReader {
  return (key) => values[key];
}

function resolve(values: Record<string, string | undefined>) {
  return resolveFederation(envOf(values), PREVIEW);
}

function carriesPreviewClient(config: object): boolean {
  const text = JSON.stringify(config);
  return text.includes(PREVIEW.clientSecret) || text.includes(PREVIEW.clientId);
}

const MODES: FederationMode[] = ["disabled", "preview", "deployed", "refused"];
const BOOLS = [false, true];

describe("deployed without the per-app broker client fails closed", () => {
  it("refuses when BETTER_AUTH_URL is set and neither value is", () => {
    const config = resolve({ BETTER_AUTH_URL: DEPLOYED_URL });
    assert.equal(config.mode, "refused");
    assert.ok(!carriesPreviewClient(config), "refusal must not carry the preview client");
    assert.equal("clientSecret" in config, false);
    assert.equal("clientId" in config, false);
    if (config.mode !== "refused") return;
    assert.match(config.reason, /GROK_AUTH_CLIENT_ID and GROK_AUTH_CLIENT_SECRET are not/);
    assert.match(config.reason, /Refusing to fall back to the shared preview client/);
  });

  for (const [present, missing] of [
    ["GROK_AUTH_CLIENT_ID", "GROK_AUTH_CLIENT_SECRET"],
    ["GROK_AUTH_CLIENT_SECRET", "GROK_AUTH_CLIENT_ID"],
  ] as const) {
    it(`refuses when only ${present} is set, without echoing its value`, () => {
      const value = present === "GROK_AUTH_CLIENT_ID" ? PER_APP.clientId : PER_APP.clientSecret;
      const config = resolve({ BETTER_AUTH_URL: DEPLOYED_URL, [present]: value });
      assert.equal(config.mode, "refused");
      assert.ok(!carriesPreviewClient(config), "refusal must not carry the preview client");
      assert.ok(!JSON.stringify(config).includes(value), "refusal must not echo env values");
      if (config.mode !== "refused") return;
      assert.match(config.reason, new RegExp(`but ${missing} is not`));
    });
  }

  it("treats empty and whitespace-only per-app values as unset", () => {
    const config = resolve({
      BETTER_AUTH_URL: DEPLOYED_URL,
      GROK_AUTH_CLIENT_ID: "   ",
      GROK_AUTH_CLIENT_SECRET: "",
    });
    assert.equal(config.mode, "refused");
    assert.ok(!carriesPreviewClient(config), "refusal must not carry the preview client");
  });

  it("never resolves the dev user, with or without a database", () => {
    for (const databaseConfigured of BOOLS) {
      assert.equal(
        requestAuthPolicy("refused", { gateIdentity: false, databaseConfigured }),
        "refuse-federation",
      );
    }
  });

  it("still honours a platform gate-identity session (not the dev user)", () => {
    for (const databaseConfigured of BOOLS) {
      assert.equal(
        requestAuthPolicy("refused", { gateIdentity: true, databaseConfigured }),
        "session",
      );
    }
  });
});

describe("deployed with the per-app broker client", () => {
  it("uses exactly the injected pair", () => {
    const config = resolve({
      BETTER_AUTH_URL: DEPLOYED_URL,
      GROK_AUTH_CLIENT_ID: PER_APP.clientId,
      GROK_AUTH_CLIENT_SECRET: PER_APP.clientSecret,
    });
    assert.deepEqual(config, { mode: "deployed", client: "per-app", ...PER_APP });
    assert.ok(!carriesPreviewClient(config), "deployed must not carry the preview client");
  });

  it("trims surrounding whitespace from injected values", () => {
    const config = resolve({
      BETTER_AUTH_URL: ` ${DEPLOYED_URL} `,
      GROK_AUTH_CLIENT_ID: ` ${PER_APP.clientId}\n`,
      GROK_AUTH_CLIENT_SECRET: `\t${PER_APP.clientSecret} `,
    });
    assert.deepEqual(config, { mode: "deployed", client: "per-app", ...PER_APP });
  });

  it("authenticates requests by session", () => {
    for (const gateIdentity of BOOLS) {
      for (const databaseConfigured of BOOLS) {
        assert.equal(
          requestAuthPolicy("deployed", { gateIdentity, databaseConfigured }),
          "session",
        );
      }
    }
  });
});

describe("dynamic sandbox preview (no BETTER_AUTH_URL)", () => {
  it("uses the shared preview client when no per-app pair is set", () => {
    assert.deepEqual(resolve({}), { mode: "preview", client: "shared-preview", ...PREVIEW });
  });

  it("treats an empty or whitespace-only BETTER_AUTH_URL as the preview path", () => {
    for (const BETTER_AUTH_URL of ["", "   "]) {
      assert.deepEqual(resolve({ BETTER_AUTH_URL }), {
        mode: "preview",
        client: "shared-preview",
        ...PREVIEW,
      });
    }
  });

  it("prefers a complete per-app pair over the preview client", () => {
    const config = resolve({
      GROK_AUTH_CLIENT_ID: PER_APP.clientId,
      GROK_AUTH_CLIENT_SECRET: PER_APP.clientSecret,
    });
    assert.deepEqual(config, { mode: "preview", client: "per-app", ...PER_APP });
  });

  it("refuses to pair one per-app value with the preview client", () => {
    for (const values of [
      { GROK_AUTH_CLIENT_ID: PER_APP.clientId },
      { GROK_AUTH_CLIENT_SECRET: PER_APP.clientSecret },
    ]) {
      const config = resolve(values);
      assert.equal(config.mode, "refused");
      assert.ok(!carriesPreviewClient(config), "refusal must not carry the preview client");
      assert.ok(
        !JSON.stringify(config).includes(Object.values(values)[0] as string),
        "refusal must not echo env values",
      );
    }
  });

  it("authenticates requests by session", () => {
    assert.equal(
      requestAuthPolicy("preview", { gateIdentity: false, databaseConfigured: false }),
      "session",
    );
  });
});

describe("auth disabled (VITE_AUTH_ENABLED=false) is unchanged", () => {
  it("wins over every other setting", () => {
    for (const values of [
      {},
      { BETTER_AUTH_URL: DEPLOYED_URL },
      {
        BETTER_AUTH_URL: DEPLOYED_URL,
        GROK_AUTH_CLIENT_ID: PER_APP.clientId,
        GROK_AUTH_CLIENT_SECRET: PER_APP.clientSecret,
      },
      { GROK_AUTH_CLIENT_ID: PER_APP.clientId },
    ]) {
      const config = resolve({ ...values, VITE_AUTH_ENABLED: "false" });
      assert.deepEqual(config, { mode: "disabled" });
    }
  });

  it('only an exact "false" disables auth', () => {
    for (const VITE_AUTH_ENABLED of ["true", "FALSE", "0", undefined]) {
      assert.notEqual(resolve({ VITE_AUTH_ENABLED }).mode, "disabled");
    }
  });

  it("keeps the dev user without a database and fails closed with one", () => {
    assert.equal(
      requestAuthPolicy("disabled", { gateIdentity: false, databaseConfigured: false }),
      "dev-user",
    );
    assert.equal(
      requestAuthPolicy("disabled", { gateIdentity: false, databaseConfigured: true }),
      "refuse-database",
    );
  });
});

describe("request policy invariants", () => {
  it("resolves the dev user only when auth is disabled", () => {
    for (const mode of MODES) {
      for (const gateIdentity of BOOLS) {
        for (const databaseConfigured of BOOLS) {
          const policy = requestAuthPolicy(mode, { gateIdentity, databaseConfigured });
          if (policy !== "dev-user") continue;
          assert.equal(mode, "disabled");
          assert.equal(gateIdentity, false);
          assert.equal(databaseConfigured, false);
        }
      }
    }
  });
});

describe("server.ts wiring", () => {
  const source = readFileSync(new URL("./server.ts", import.meta.url), "utf8");

  it("decides the broker client through resolveFederation", () => {
    assert.match(source, /resolveFederation\(env,/);
  });

  it("never backfills an env value with the preview client", () => {
    assert.doesNotMatch(source, /\?\?\s*PREVIEW_CLIENT_(ID|SECRET)/);
    assert.doesNotMatch(source, /\|\|\s*PREVIEW_CLIENT_(ID|SECRET)/);
  });
});
