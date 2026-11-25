# nexus — Domain Leader Study Card r1 (propose-only)

OUROBOROS pass 1 of 10 - 2026-11-25 - CTO web lane. Propose-only: never merge without owner GO.

## Domain leaders
- SINDy: Sparse Identification of Nonlinear Dynamics with Control (SINDYc) - Brunton, Proctor, Kutz (arXiv:1605.06682): data-driven discovery of governing equations from measurement.
- Classical dynamics canon: Lorenz 1963, van der Pol, Duffing - the exact families nexus implements and the SINDy literature validates against.

## Moat to absorb
- DISCOVERY-vs-SIMULATION honesty: every dynamics family carries fitted-vs-known distinction ({KNOWN_CLOSED_FORM | DISCOVERED_SINDY} + residual when discovered).
- Channel A/B Lorenz OP hash parity becomes a formal invariance test with numerically derived drift floors (SINDy-style identification error floors, float-precision epsilon).
- NEMO R1-R5 gates adopt trajectory-error qualification metrics, fail-closed on divergence.

## Recommended upgrades (owner-gated)
1. README discovery-lineage section + fitted/known disclosure doctrine.
2. Receipt field: dynamics_class + residual.
3. Cross-channel parity test with bounded drift epsilon, fail-closed.