/**
 * Shared LIVE-PREVIEW OAuth client (server-only — NEVER import from the client).
 *
 * The sandbox serves each live preview on a dynamic `https://*.grok-sandbox.com`
 * URL, which can't be pre-registered per app. The broker instead exposes ONE
 * shared "preview" client that accepts any
 * Historical callback registration: `https://*.grok-sandbox.com/api/auth/oauth2/callback/*`.
 * Better Auth 1.7 uses `/api/auth/callback/*`; acceptance of that registration
 * remains unqualified and must be verified before enabling/publishing auth.
 * (broker: `app-builder-deployer/auth/src/preview-oauth.ts`). The preview
 * client id is listed here. The client secret must come from
 * `GROK_AUTH_CLIENT_SECRET` in the environment and is never baked into the
 * source. Used ONLY on that dynamic preview path (no `BETTER_AUTH_URL`):
 * a deployment must inject its own per-app `GROK_AUTH_*`, and one that does not
 * fails closed (see `federation.ts`).
 *
 * The preview client id is `grok_preview`. The matching client secret must
 * be provided as `GROK_AUTH_CLIENT_SECRET` in the environment (the broker
 * stores only the secret's `base64url(SHA-256)` hash). This is a dedicated,
 * low-privilege client (preview-only, `*.grok-sandbox.com`). Rotate it by
 * regenerating the broker env var and updating every consumer's environment.
 */
export const PREVIEW_CLIENT_ID = "grok_preview";

/** The shared auth broker issuer (OIDC discovery lives under it). */
export const GROK_ISSUER_DEFAULT = "https://auth.grok.me";

/**
 * Host patterns whose callbacks the preview client accepts. Better Auth derives
 * the live preview's real origin from the request host and validates it against
 * this list (wildcard-matched), so the OAuth `redirect_uri` becomes the concrete
 * Historical broker allowance: `https://<preview-host>/api/auth/oauth2/callback/...`.
 * This does not establish acceptance of the Better Auth 1.7 callback path.
 */
export const PREVIEW_ALLOWED_HOSTS = ["*.grok-sandbox.com"] as const;
