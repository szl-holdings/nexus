import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseConfigError, resolveDbConfig } from "./db-config.ts";

const PG = "postgresql://app:secret@db.example:5432/app?sslmode=require";

test("local dev / preview without DATABASE_URL keeps the PGLite fallback", () => {
  for (const env of [{}, { NODE_ENV: "development" }, { NODE_ENV: "test", DATABASE_URL: "   " }]) {
    const c = resolveDbConfig(env);
    assert.equal(c.source, "pglite");
    assert.equal(c.error, undefined);
  }
});

test("strict production without DATABASE_URL fails closed, with no override", () => {
  for (const env of [
    { SZL_ENV: "production" },
    { VERCEL_ENV: "production", NODE_ENV: "production" },
    { SZL_REQUIRE_DATABASE: "1", NODE_ENV: "development" },
    { SZL_ENV: "production", DATABASE_URL: " ", SZL_ALLOW_EPHEMERAL_DB: "1" },
  ]) {
    const c = resolveDbConfig(env);
    assert.ok(c.error instanceof DatabaseConfigError, JSON.stringify(env));
    assert.match(c.error.message, /requires a PostgreSQL DATABASE_URL/);
  }
});

test("NODE_ENV=production without DATABASE_URL fails closed unless explicitly made ephemeral", () => {
  assert.ok(resolveDbConfig({ NODE_ENV: "production" }).error instanceof DatabaseConfigError);
  const opted = resolveDbConfig({ NODE_ENV: "production", SZL_ALLOW_EPHEMERAL_DB: "1" });
  assert.equal(opted.error, undefined);
  assert.equal(opted.ephemeralInProduction, true);
});

test("a PostgreSQL DATABASE_URL selects Postgres; other schemes are refused", () => {
  const c = resolveDbConfig({ SZL_ENV: "production", DATABASE_URL: ` ${PG} ` });
  assert.equal(c.source, "neon");
  assert.equal(c.url, PG);
  assert.equal(c.error, undefined);
  const bad = resolveDbConfig({ DATABASE_URL: "sqlite:///tmp/x.db" });
  assert.ok(bad.error instanceof DatabaseConfigError);
});

test("error messages and reasons never contain the connection string", () => {
  for (const env of [{ DATABASE_URL: "mysql://u:secret@h/db" }, { SZL_ENV: "production" }]) {
    const c = resolveDbConfig(env);
    assert.ok(!`${c.reason} ${c.error?.message}`.includes("secret"));
  }
});
