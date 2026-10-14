/**
 * Which broker OAuth client this server may federate with, and how a request
 * is authenticated as a result (server-only; dependency-free so both decisions
 * are unit-tested without Better Auth, pg or the real preview credential).
 *
 * Modes, from `resolveFederation`:
 *   - `disabled`: `VITE_AUTH_ENABLED=false`. Unchanged: no providers; the dev
 *     user with no database, fail-closed once `DATABASE_URL` is set.
 *   - `preview`: no `BETTER_AUTH_URL`, so Better Auth runs on the dynamic
 *     baseURL validated against `PREVIEW_ALLOWED_HOSTS` (plus loopback for local
 *     `npm run dev`). This is the ONLY mode that may use the shared preview
 *     client, and only when no per-app pair is set.
 *   - `deployed`: `BETTER_AUTH_URL` set and BOTH `GROK_AUTH_CLIENT_ID` and
 *     `GROK_AUTH_CLIENT_SECRET` set. The per-app pair is used.
 *   - `refused`: `BETTER_AUTH_URL` set without both per-app values, or exactly
 *     one of the pair set anywhere. Fail closed: federated sign-in is
 *     unavailable, the shared preview client is NEVER substituted, and
 *     `requestAuthPolicy` never resolves the dev user.
 *
 * Messages name environment variables only, never their values.
 */

/** Reads one environment variable; empty or whitespace-only counts as unset. */
export type EnvReader = (key: string) => string | undefined;

/** A broker OAuth client registration. */
export type BrokerClient = {
  readonly clientId: string;
  readonly clientSecret: string;
};

export type FederationConfig =
  | { readonly mode: "disabled" }
  | ({
      readonly mode: "preview";
      /** `shared-preview` = the broker's shared live-preview client. */
      readonly client: "shared-preview" | "per-app";
    } & BrokerClient)
  | ({ readonly mode: "deployed"; readonly client: "per-app" } & BrokerClient)
  | { readonly mode: "refused"; readonly reason: string };

export type FederationMode = FederationConfig["mode"];

const CLIENT_ID_KEY = "GROK_AUTH_CLIENT_ID";
const CLIENT_SECRET_KEY = "GROK_AUTH_CLIENT_SECRET";

/**
 * Decide the broker client from the environment. `previewClient` is the shared
 * live-preview registration (`./preview`); it is returned only in `preview`
 * mode with no per-app pair present.
 */
export function resolveFederation(env: EnvReader, previewClient: BrokerClient): FederationConfig {
  const read = (key: string): string | undefined => {
    const value = env(key)?.trim();
    return value ? value : undefined;
  };

  if (read("VITE_AUTH_ENABLED") === "false") return { mode: "disabled" };

  const clientId = read(CLIENT_ID_KEY);
  const clientSecret = read(CLIENT_SECRET_KEY);
  const deployed = read("BETTER_AUTH_URL") !== undefined;

  if (clientId && clientSecret) {
    return deployed
      ? { mode: "deployed", client: "per-app", clientId, clientSecret }
      : { mode: "preview", client: "per-app", clientId, clientSecret };
  }

  const missing = [clientId ? null : CLIENT_ID_KEY, clientSecret ? null : CLIENT_SECRET_KEY].filter(
    (key): key is string => key !== null,
  );

  if (deployed) {
    return {
      mode: "refused",
      reason:
        `BETTER_AUTH_URL is set but ${missing.join(" and ")} ` +
        `${missing.length > 1 ? "are" : "is"} not, so federated sign-in is ` +
        "unavailable. Refusing to fall back to the shared preview client: a " +
        `deployment must provide its own ${CLIENT_ID_KEY} and ${CLIENT_SECRET_KEY}.`,
    };
  }
  if (missing.length === 1) {
    return {
      mode: "refused",
      reason:
        `${missing[0]} is not set but its pair is, so federated sign-in is ` +
        "unavailable. Refusing to mix a per-app value with the shared preview " +
        `client: set both ${CLIENT_ID_KEY} and ${CLIENT_SECRET_KEY}, or neither.`,
    };
  }
  return { mode: "preview", client: "shared-preview", ...previewClient };
}

/**
 * How `requireUserId` treats a request:
 *   - `session`: resolve the verified session; signed out -> 401.
 *   - `dev-user`: auth disabled with no database -> the shared dev user.
 *   - `refuse-database`: auth disabled but `DATABASE_URL` set -> throw.
 *   - `refuse-federation`: federated sign-in was refused -> throw. Never the
 *     dev user, whatever else is configured.
 */
export type RequestAuthPolicy = "session" | "dev-user" | "refuse-database" | "refuse-federation";

export function requestAuthPolicy(
  mode: FederationMode,
  options: { readonly gateIdentity: boolean; readonly databaseConfigured: boolean },
): RequestAuthPolicy {
  if (mode === "preview" || mode === "deployed" || options.gateIdentity) {
    return "session";
  }
  if (mode === "refused") return "refuse-federation";
  return options.databaseConfigured ? "refuse-database" : "dev-user";
}
