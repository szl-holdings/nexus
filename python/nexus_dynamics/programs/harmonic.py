# SPDX-License-Identifier: Apache-2.0
"""Harmonic oscillator x'' = -omega^2 x (omega = 1 + 3 * chaos).

Forward Euler (the instrument's ``euler4``) multiplies the energy by
``1 + (omega h)^2`` every substep, so it is not conservative. The
``symplectic`` method is velocity Verlet, which conserves the modified energy
``shadow_energy`` exactly (up to rounding) and keeps the physical energy in a
bounded band with no secular drift.
"""
from __future__ import annotations

from ..schema import NexusState
from ._common import Coefficients, clamp01, lorenz_rho

NAME = "harmonic"
LABEL = "HARM"
MODEL = "harmonic/1"
METHODS = ("euler4", "rk4", "symplectic")


def coefficients(chaos: float) -> Coefficients:
    c = clamp01(chaos)
    omega = 1 + c * 3
    return Coefficients(
        sigma=10.0,
        rho=lorenz_rho(c),
        beta=8 / 3,
        omega=omega,
        mu=0.0,
        delta=0.0,
        gamma=0.0,
        alpha=0.0,
        label=f"ω {omega:.2f}",
    )


def seed(nudge: float = 0.0) -> NexusState:
    n = nudge % 1
    return NexusState(x=1.0, y=0.02 + n * 0.08, z=0.5, t=0.0)


def field(x: float, y: float, z: float, t: float, k: Coefficients, drive: float) -> tuple[float, float, float]:
    w2 = k.omega * k.omega
    return y, -w2 * x, 0.0


euler4_field = field


def symplectic_substep(
    x: float, y: float, t: float, h: float, k: Coefficients, drive: float
) -> tuple[float, float]:
    """One velocity-Verlet (kick-drift-kick) substep; returns (x, y)."""
    w2 = k.omega * k.omega
    v_half = y + 0.5 * h * (-w2 * x)
    x_new = x + h * v_half
    y_new = v_half + 0.5 * h * (-w2 * x_new)
    return x_new, y_new


def energy(x: float, y: float, omega: float) -> float:
    """Physical energy 1/2 y^2 + 1/2 omega^2 x^2."""
    return 0.5 * y * y + 0.5 * omega * omega * x * x


def shadow_energy(x: float, y: float, omega: float, h: float) -> float:
    """Quadratic invariant of velocity Verlet for this oscillator.

    For the map above, 1/2 y^2 + 1/2 omega^2 (1 - (omega h)^2 / 4) x^2 is
    preserved exactly by every substep of size h (a standard result for the
    Stormer-Verlet method on a linear oscillator; the tests check it numerically).
    """
    return 0.5 * y * y + 0.5 * omega * omega * (1 - (omega * h) ** 2 / 4) * x * x
