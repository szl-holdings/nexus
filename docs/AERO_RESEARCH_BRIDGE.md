# Optional Aero-FF research bridge

This candidate preserves Nexus's React/TanStack workstation and browser-local audio. It adds a small connection panel for a separately mounted Python-rendered research interface. It adds no server endpoint, Python service, public claim catalog, PDF, proxy, credentials, or deployment.

## Exact read-only handshake

Only a user click requests `GET /research/aero/api/status`. The JSON response must have exactly these fields and values:

```json
{
  "schema": "szl.aero-research-bridge/v1",
  "state": "research_only",
  "claims_reviewed": 11,
  "proofs_established": 0,
  "operational_use_allowed": false,
  "source_verified": true,
  "capabilities": ["source_reference", "exact_arithmetic_diagnostic"],
  "interface_path": "/research/aero/"
}
```

`source_verified` means the Python service matched the original source PDF's bytes to its pinned digest. It does not mean mathematical or scientific verification. The frontend does not independently verify that server declaration. It never requests the claim-content endpoint or transports records into the audio engine.

The request is same-origin, read-only, uncached, redirect-rejecting, and bounded to 16 KiB and five seconds. Missing, malformed, overstated, oversized, stale-request, and failed responses cannot enable the link. No request runs automatically when the component mounts. The initial state is explicitly Not connected. A valid declaration enables only a fixed link to `/research/aero/`, whose page is rendered by Python.

## Runtime boundary

The existing canonical `space/Dockerfile` runs Node/Nitro and does not include Python. The private local Python candidate is a separate process restricted to loopback. Installing this UI patch alone cannot connect or deploy that service.

Do not publish the private PDF, reviewed claim summaries, original source text, or a local research API through public assets or an unauthenticated proxy. Any eventual shared/private mount requires its own approved audience, actual access controls, source handling, runtime ownership, and end-to-end security tests. Do not weaken the Python server's Host/Origin checks merely to make a proxy work. A server declaring source verification is not an access-control boundary.

Before admission: recheck the current default-branch head and overlapping writers; apply to an isolated branch; run normal typecheck, lint, tests, build, Python tests, container and browser checks on the complete source. Exercise disconnected, timeout, retry, absent backend, and successful private navigation paths. Then follow existing protected source and central publication controls, and separately verify exact runtime revision. The local candidate's focused tests do not establish any of these later gates.

No claim is promoted to a theorem or validated physical model. No operational or control use is allowed. Energy remains UNAVAILABLE; Conjecture 1 remains OPEN.
