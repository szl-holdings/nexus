# SPDX-License-Identifier: Apache-2.0
"""Lotka-Volterra predator/prey.

x' = alpha x - beta x y, y' = delta x y - gamma y with
alpha = 0.85 + 0.55 c, beta = 0.42 + 0.7 c, delta = 0.4 + 0.35 c, gamma = 0.62.

F-05 (model version ``lotka/2``): nexus <= d087694 displayed this beta in the
label but integrated with ``beta = 8/3`` (``server.py:141``,
``src/lib/nexus/math.ts:123``). IMMUNE's import already used the labelled beta.
The fix is an intentional parity version bump; see
``contracts/nexus-parity-v2.json`` ``intentional_changes``.

The ``euler4`` method keeps the instrument's 0.02 floor (inside the field and
after each tick). ``rk4`` integrates the exact field, whose axes are invariant,
so the first quadrant is preserved by the flow itself and the first integral
``conserved`` is available as an accuracy check.
"""
from __future__ import annotations

import math

from ..schema import NexusState
from ._common import Coefficients, clamp01, jmax, lorenz_rho

NAME = "lotka"
LABEL = "LTKA"
MODEL = "lotka/2"
METHODS = ("euler4", "rk4")
EULER4_FLOOR = 0.02


def coefficients(chaos: float) -> Coefficients:
    c = clamp01(chaos)
    alpha = 0.85 + c * 0.55
    beta = 0.42 + c * 0.7
    return Coefficients(
        sigma=10.0,
        rho=lorenz_rho(c),
        beta=beta,
        omega=1.0,
        mu=0.0,
        delta=0.4 + c * 0.35,
        gamma=0.62,
        alpha=alpha,
        label=f"α {alpha:.2f} · β {beta:.2f}",
    )


def seed(nudge: float = 0.0) -> NexusState:
    n = nudge % 1
    return NexusState(x=1.15 + n * 0.25, y=0.82 + n * 0.12, z=0.5, t=0.0)


def field(x: float, y: float, z: float, t: float, k: Coefficients, drive: float) -> tuple[float, float, float]:
    return k.alpha * x - k.beta * x * y, k.delta * x * y - k.gamma * y, 0.0


def euler4_field(x: float, y: float, z: float, t: float, k: Coefficients, drive: float) -> tuple[float, float, float]:
    prey = jmax(EULER4_FLOOR, x)
    pred = jmax(EULER4_FLOOR, y)
    return k.alpha * prey - k.beta * prey * pred, k.delta * prey * pred - k.gamma * pred, 0.0


def euler4_post(x: float, y: float) -> tuple[float, float]:
    return jmax(EULER4_FLOOR, x), jmax(EULER4_FLOOR, y)


def conserved(x: float, y: float, k: Coefficients) -> float:
    """First integral V = delta x - gamma ln x + beta y - alpha ln y."""
    return k.delta * x - k.gamma * math.log(x) + k.beta * y - k.alpha * math.log(y)
