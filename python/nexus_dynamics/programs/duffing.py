# SPDX-License-Identifier: Apache-2.0
"""Forced, damped Duffing oscillator.

x'' = x - x^3 - delta x' + F cos(omega t), with delta = 0.08 + 0.32 * chaos,
F = gamma (0.45 + 0.7 * drive), gamma = 0.18 + 0.55 * chaos, omega = 1.2.

The ``symplectic`` method is a Strang splitting of the extended (x, y, t)
system into
  A: the conservative double-well part x' = y, y' = x - x^3 (t frozen),
     advanced with velocity Verlet (symplectic), and
  B: the dissipative/forced part y' = -delta y + F cos(omega t), t' = 1
     (x frozen), advanced with its exact closed-form flow.
One substep is B(h/2) A(h) B(h/2): second order, and with delta = F = 0 it is
exactly velocity Verlet on the Hamiltonian 1/2 y^2 - 1/2 x^2 + 1/4 x^4.
"""
from __future__ import annotations

import math

from ..schema import NexusState
from ._common import Coefficients, clamp01, lorenz_rho

NAME = "duffing"
LABEL = "DFFG"
MODEL = "duffing/1"
METHODS = ("euler4", "rk4", "symplectic")

# Invariant envelope used by the tests.
ABS_X_BOUND = 3.0
ABS_Y_BOUND = 4.0


def coefficients(chaos: float) -> Coefficients:
    c = clamp01(chaos)
    delta = 0.08 + c * 0.32
    gamma = 0.18 + c * 0.55
    return Coefficients(
        sigma=10.0,
        rho=lorenz_rho(c),
        beta=8 / 3,
        omega=1.2,
        mu=0.0,
        delta=delta,
        gamma=gamma,
        alpha=0.0,
        label=f"δ {delta:.2f} · γ {gamma:.2f}",
    )


def seed(nudge: float = 0.0) -> NexusState:
    n = nudge % 1
    return NexusState(x=0.18 + n * 0.12, y=0.0, z=0.5, t=0.0)


def forcing_amplitude(k: Coefficients, drive: float) -> float:
    return k.gamma * (0.45 + drive * 0.7)


def field(x: float, y: float, z: float, t: float, k: Coefficients, drive: float) -> tuple[float, float, float]:
    force = k.gamma * (0.45 + drive * 0.7) * math.cos(k.omega * t)
    return y, x - x * x * x - k.delta * y + force, 0.0


euler4_field = field


def dissipative_flow(y: float, t: float, s: float, delta: float, force: float, omega: float) -> float:
    """Exact solution after time s of y' = -delta y + force cos(omega t).

    Well conditioned while delta^2 + omega^2 is bounded away from 0 (the
    program always uses omega = 1.2).
    """
    decay = math.exp(-delta * s)
    denom = delta * delta + omega * omega
    if denom == 0:
        return y + force * s
    p1 = delta * math.cos(omega * (t + s)) + omega * math.sin(omega * (t + s))
    p0 = delta * math.cos(omega * t) + omega * math.sin(omega * t)
    return decay * y + force / denom * (p1 - decay * p0)


def verlet_conservative(x: float, y: float, h: float) -> tuple[float, float]:
    """Velocity Verlet for x'' = x - x^3."""
    v_half = y + 0.5 * h * (x - x * x * x)
    x_new = x + h * v_half
    y_new = v_half + 0.5 * h * (x_new - x_new * x_new * x_new)
    return x_new, y_new


def split_substep(
    x: float, y: float, t: float, h: float, delta: float, force: float, omega: float
) -> tuple[float, float]:
    """One Strang substep B(h/2) A(h) B(h/2); returns (x, y). Time advances by h."""
    half = 0.5 * h
    y = dissipative_flow(y, t, half, delta, force, omega)
    x, y = verlet_conservative(x, y, h)
    y = dissipative_flow(y, t + half, half, delta, force, omega)
    return x, y


def symplectic_substep(
    x: float, y: float, t: float, h: float, k: Coefficients, drive: float
) -> tuple[float, float]:
    return split_substep(x, y, t, h, k.delta, forcing_amplitude(k, drive), k.omega)


def conservative_energy(x: float, y: float) -> float:
    """Hamiltonian of the conservative part: 1/2 y^2 - 1/2 x^2 + 1/4 x^4."""
    return 0.5 * y * y - 0.5 * x * x + 0.25 * x * x * x * x
