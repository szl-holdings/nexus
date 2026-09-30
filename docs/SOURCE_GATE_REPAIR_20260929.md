# Source gate repair and authentication admission boundary

The failing immutable base was `0ad36daa90cac37bee9177c5cb43ac273ff21c9f`.
The TypeScript 7 dependency violated the installed lint tooling's peer contract.
The repaired graph uses the supported TypeScript 6.0 patch line and a real
package-manager-generated lockfile. No peer override, scanner reduction, or
test-floor reduction is used. The deprecated `baseUrl` is removed while the
explicit source alias remains covered by the actual compiler resolver.

The first repaired head passed hosted Python, Node 24, and CodeQL checks, but
Node 22's bundled npm 10.9.8 rejected the npm 11-generated lock: the optional
`unstorage` peer inside Nitro required a separate `lru-cache` 11 resolution,
while the root `lru-cache` 5 resolution serves Babel. The identical npm 10.9.8
failure was reproduced locally. Regenerating the real lock with npm 10.9.8
records the separate optional peer; both npm 10.9.8 and npm 11.17.0 now accept
the frozen graph in dry-run checks. Those checks do not replace clean hosted
installs or the full Node 22/24 source matrix. No runtime lane, peer check, or
frozen-install gate is disabled.

The clean install exposed additional source-gate errors. The repair preserves
caught error causes, updates the oscilloscope mode ref after React commits,
narrows unknown router errors, and uses the installed Better Auth 1.7 social
client/server APIs. Synthetic in-memory tests establish API serialization and
PKCE/callback initialization without contacting a provider or authenticating a
real user. These tests are not live sign-in evidence.

Authentication activation/publication remains NOT ADMITTED. Better Auth 1.7
changes generic-provider callbacks to `/api/auth/callback/<providerId>`.
The installed 1.7.6 account schema recognizes `(providerId, accountId)` and does
not require an `issuer` column: that requirement existed only in 1.7.0–1.7.2
and was removed in 1.7.3. Do not add or backfill that column based on obsolete
upgrade guidance. A database that actually ran 1.7.0–1.7.2 needs a separately
reviewed constraint inspection; no such production database was inspected here.

Before activation, inspect duplicate `(providerId, accountId)` keys without
merging different users or deleting rows, qualify the broker's immutable account
subject, and verify registered callbacks. With explicit OAuth endpoints, the
installed provider uses profile `id`, not a runtime fallback to OIDC `sub`.
The broker's production profile contract and identity-token verification are
not established by the synthetic fixture. Installed-library tests cover the
account schema, provider-key isolation, duplicate-key rejection without row
mutation, and the static endpoint subject boundary. They are not broker callback
or live sign-in evidence. Real sign-in/sign-out/session-isolation probes remain
required. This source repair does not modify broker registrations, secrets,
existing account rows, migrations, or auth flags.

Reference: [Better Auth 1.7 upgrade guide](https://better-auth.com/docs/guides/1-7-upgrade-guide),
[lint-tool dependency support](https://typescript-eslint.io/users/dependency-versions/),
and [TypeScript 6 migration guidance](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html).

Keep source CI, protected admission, central HF publication, IMMUNE Channel A
runtime readback, and proof-site publication separate, as required by `AGENTS.md`.
