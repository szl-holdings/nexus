# Security Policy

**Control before action. Evidence after.** Security reports are evidence and
are handled with the same discipline as everything else in this estate.

## Reporting a vulnerability

- **Preferred:** open a private vulnerability report via GitHub Security
  Advisories on this repository (*Security → Advisories → Report a
  vulnerability*).
- **Email:** security@a-11-oy.com — encrypt when sensitive; include the
  affected repo and commit, a minimal reproducer, and the impact.
- Do **not** open public issues, pull requests, or discussions for
  undisclosed vulnerabilities.

You will receive an acknowledgement within 72 hours and a triage decision
(accepted / needs-info / declined, with reasoning) within 7 days.

## Supported versions

| Version                   | Supported    |
| ------------------------- | ------------ |
| default branch (`main`)   | yes          |
| latest tagged release     | yes          |
| anything older            | best-effort  |

<!-- Adjust this table to the repo's actual release cadence. UNKNOWN is
     never claimed as supported. -->

## Receipt verification

Every security-relevant change in this estate ships with a receipt — a CI
run, scan output, or an audit artifact — verifiable on the proof surface:

- Receipts and verification: <https://a11oy.net>
- Product surface: <https://a-11-oy.com>
- Org: <https://github.com/szl-holdings>

A fix is not done until its receipt verifies. UNKNOWN is never reported as
PASS.
