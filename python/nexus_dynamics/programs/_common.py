# SPDX-License-Identifier: Apache-2.0
"""Shared pieces of the six analog programs."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from .._num import clamp01, jclamp, jmax, jmin

__all__ = ["Coefficients", "clamp01", "jclamp", "jmax", "jmin", "lorenz_rho"]


@dataclass(frozen=True)
class Coefficients:
    """Coefficient pots, same keys as ``analogCoefficients`` in ``src/lib/nexus/math.ts``."""

    sigma: float
    rho: float
    beta: float
    omega: float
    mu: float
    delta: float
    gamma: float
    alpha: float
    label: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def lorenz_rho(c: float) -> float:
    return 18 + c * 22
