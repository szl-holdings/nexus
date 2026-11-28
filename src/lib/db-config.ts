/**
 * Database configuration resolution — fail closed in production (gap G1).
 *
 * Before: no `DATABASE_URL` (or a blank one) silently selected the in-memory
 * PGLite fallback everywhere, including a production deploy, so data written in
 * production could vanish on restart. Same rule as lyte-services settings
 * ("production requires a PostgreSQL DATABASE_URL"):
 *
 *   strict production  (SZL_ENV=production, VERCEL_ENV=production, or
 *                       SZL_REQUIRE_DATABASE=1)
 *                      -> DATABASE_URL (postgres:// | postgresql://) required.
 *                         No override exists.
 *   NODE_ENV=production (any other production-mode server, e.g. a preview deploy)
 *                      -> DATABASE_URL required, unless the operator sets
 *                         SZL_ALLOW_EPHEMERAL_DB=1 to opt in to an in-memory
 *                         database on purpose (logged as a warning).
 *   anything else      -> PGLite fallback as before (local dev, live preview, tests).
 *
 * Whenever DATABASE_URL is set it must be a PostgreSQL URL.
 * Pure function of the environment so it can be unit tested.
 */
export type DbSource = "neon" | "pglite";

export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigError";
  }
}

export interface DbConfig {
  source: DbSource;
  url?: string;
  /** Why this source was chosen; never contains the URL. */
  reason: string;
  /** Set when the configuration must not serve traffic. getSql() throws it. */
  error?: DatabaseConfigError;
  /** True when PGLite was explicitly allowed in a production-mode runtime. */
  ephemeralInProduction?: boolean;
}

type Env = Record<string, string | undefined>;

const truthy = (v: string | undefined) => /^(1|true|yes|on)$/i.test((v ?? "").trim());

export function isStrictProduction(env: Env): boolean {
  return (
    (env.SZL_ENV ?? "").trim().toLowerCase() === "production" ||
    (env.VERCEL_ENV ?? "").trim().toLowerCase() === "production" ||
    truthy(env.SZL_REQUIRE_DATABASE)
  );
}

export function resolveDbConfig(env: Env): DbConfig {
  const raw = env.DATABASE_URL;
  // An empty/whitespace DATABASE_URL (an easy misconfig in deploy UIs) means "unset".
  const url = raw && raw.trim() ? raw.trim() : undefined;
  if (url) {
    if (!/^postgres(ql)?:\/\//i.test(url)) {
      return {
        source: "neon",
        reason: "DATABASE_URL set",
        error: new DatabaseConfigError("DATABASE_URL must be a postgres:// or postgresql:// URL"),
      };
    }
    return { source: "neon", url, reason: "DATABASE_URL set" };
  }
  if (isStrictProduction(env)) {
    return {
      source: "pglite",
      reason: "strict production without DATABASE_URL",
      error: new DatabaseConfigError(
        "production requires a PostgreSQL DATABASE_URL; refusing the in-memory PGLite fallback " +
          "(SZL_ENV/VERCEL_ENV=production or SZL_REQUIRE_DATABASE=1)",
      ),
    };
  }
  if ((env.NODE_ENV ?? "").trim() === "production") {
    if (truthy(env.SZL_ALLOW_EPHEMERAL_DB)) {
      return { source: "pglite", reason: "SZL_ALLOW_EPHEMERAL_DB=1", ephemeralInProduction: true };
    }
    return {
      source: "pglite",
      reason: "NODE_ENV=production without DATABASE_URL",
      error: new DatabaseConfigError(
        "NODE_ENV=production requires a PostgreSQL DATABASE_URL; refusing the in-memory PGLite fallback. " +
          "Set DATABASE_URL, or SZL_ALLOW_EPHEMERAL_DB=1 for a deliberately throwaway preview.",
      ),
    };
  }
  return { source: "pglite", reason: "no DATABASE_URL outside production (local/preview)" };
}
