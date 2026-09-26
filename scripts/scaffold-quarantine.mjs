/**
 * Quarantined Grok App Builder scaffold tests.
 *
 * NEXUS was generated from the Grok App Builder template. The scaffold (Grok
 * PWA plugin, og brand skill, auth/app-data/multiplayer) is not part of the
 * NEXUS product. NEXUS plan Phase 1 deletes it together with these tests.
 * Until then the tests below cannot pass in this repository for the reasons
 * given, and none of them tests NEXUS code.
 *
 * A quarantined test is passed `{ skip: <reason> }`, so node:test reports it as
 * skipped with this reason and `scripts/run-tests.mjs` lists it at the end of
 * every run. Do not quarantine anything else here: a NEXUS test that fails must
 * fail `npm test`.
 */

const PREFIX = "QUARANTINED Grok App Builder scaffold, removed in NEXUS P1";

export const SCAFFOLD_QUARANTINE = Object.freeze({
  /**
   * brand-check.test.mjs and write-atomic.test.mjs pin their CLIs to the Grok
   * og skill docs in `.grok/skills/og/`. This repository does not track them
   * (`.gitignore` lists `.grok/skills/`), so the read throws ENOENT.
   */
  ogSkillDocs: `${PREFIX}: reads .grok/skills/og/ docs, which this repo does not track (.gitignore: .grok/skills/)`,
  /**
   * grok-pwa-plugin.test.mjs fixtures expect the blank template identity
   * ("Hello World", "Wild Race"). The plugin resolves og:title from this repo's
   * `src/lib/og/site.json` (`"title": "NEXUS MK-II"`) first, so the injected
   * metadata is NEXUS's, not the fixture's.
   */
  pwaTemplateIdentity: `${PREFIX}: fixtures assume the blank template title, but src/lib/og/site.json sets og:title "NEXUS MK-II"`,
});
