# SPDX-License-Identifier: Apache-2.0
"""Lorenz system (sigma 10, rho from the chaos pot, beta 8/3).

Ported from ``src/lib/nexus/math.ts`` (``seedLorenz``, ``analogCoefficients``,
``analogStep``). Arithmetic order is kept identical so the ``euler4`` method is
bit-for-bit equal to the browser instrument and to IMMUNE's port.
"""
from __future__ import annotations

from ..schema import NexusState
from ._common import Coefficients, clamp01, lorenz_rho

NAME = "lorenz"
LABEL = "LRNZ"
MODEL = "lorenz/1"
METHODS = ("euler4", "rk4")

# Invariant envelope used by the tests (plan Phase 3 acceptance).
ABS_XY_BOUND = 60.0
Z_BOUNDS = (0.0, 80.0)


def coefficients(chaos: float) -> Coefficients:
    c = clamp01(chaos)
    rho = lorenz_rho(c)
    return Coefficients(
        sigma=10.0,
        rho=rho,
        beta=8 / 3,
        omega=1.0,
        mu=0.0,
        delta=0.0,
        gamma=0.0,
        alpha=0.0,
        label=f"σ 10 · ρ {rho:.1f} · β {(8 / 3):.2f}",
    )


def seed(nudge: float = 0.0) -> NexusState:
    return NexusState(
        x=0.12 + nudge * 0.31,
        y=-0.08 + nudge * 0.17,
        z=22 + (nudge % 1) * 6,
        t=0.0,
    )


def field(x: float, y: float, z: float, t: float, k: Coefficients, drive: float) -> tuple[float, float, float]:
    dx = k.sigma * (y - x)
    dy = x * (k.rho - z) - y
    dz = x * y - k.beta * z
    return dx, dy, dz


euler4_field = field
