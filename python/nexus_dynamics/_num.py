# SPDX-License-Identifier: Apache-2.0
"""Numeric helpers with JavaScript ``Math.max``/``Math.min`` semantics."""
from __future__ import annotations

import math


def clamp01(value: float) -> float:
    return min(1.0, max(0.0, float(value)))


def jmax(a: float, b: float) -> float:
    """``Math.max(a, b)``: NaN-propagating (Python's ``max`` silently drops a NaN
    second argument), and +0 wins over -0. Identical to ``max`` for all other
    inputs, so finite trajectories stay bit-identical to the TypeScript binding
    while a NaN can never be masked into a finite value."""
    if a != a or b != b:
        return math.nan
    if a == b:
        return b if math.copysign(1.0, a) < 0 else a
    return a if a > b else b


def jmin(a: float, b: float) -> float:
    """``Math.min(a, b)``: NaN-propagating, and -0 wins over +0."""
    if a != a or b != b:
        return math.nan
    if a == b:
        return a if math.copysign(1.0, a) < 0 else b
    return a if a < b else b


def jclamp(value: float, lo: float, hi: float) -> float:
    """``Math.max(lo, Math.min(hi, value))``."""
    return jmax(lo, jmin(hi, value))
