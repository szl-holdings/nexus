# SPDX-License-Identifier: Apache-2.0
"""Van der Pol oscillator x'' - mu (1 - x^2) x' + x = 0 (mu = 0.25 + 2.7 * chaos).

For every mu > 0 the flow has a unique stable limit cycle whose x amplitude is
close to 2 (2.00 for small mu, about 2.02 at mu = 3).
"""
from __future__ import annotations

from ..schema import NexusState
from ._common import Coefficients, clamp01, lorenz_rho

NAME = "vanderpol"
LABEL = "VDP"
MODEL = "vanderpol/1"
METHODS = ("euler4", "rk4")


def coefficients(chaos: float) -> Coefficients:
    c = clamp01(chaos)
    mu = 0.25 + c * 2.7
    return Coefficients(
        sigma=10.0,
        rho=lorenz_rho(c),
        beta=8 / 3,
        omega=1.0,
        mu=mu,
        delta=0.0,
        gamma=0.0,
        alpha=0.0,
        label=f"μ {mu:.2f}",
    )


def seed(nudge: float = 0.0) -> NexusState:
    n = nudge % 1
    return NexusState(x=0.12 + n * 0.2, y=0.04, z=0.4, t=0.0)


def field(x: float, y: float, z: float, t: float, k: Coefficients, drive: float) -> tuple[float, float, float]:
    return y, k.mu * (1 - x * x) * y - x, 0.0


euler4_field = field
