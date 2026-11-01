# SPDX-License-Identifier: Apache-2.0
"""Numeric helpers for JavaScript's non-finite arithmetic behavior.

Finite transcendental results still use Python's platform math library; these
helpers do not promise bit-identical V8 rounding.
"""
from __future__ import annotations

import math


def clamp01(value: float) -> float:
    """``Math.min(1, Math.max(0, value))``, the TypeScript ``clamp01`` in
    ``src/lib/nexus/math.ts``: a NaN stays NaN (owner decision D2; the old
    ``min(1.0, max(0.0, value))`` masked it to 0.0). Every other input gives
    the same float as before, bit for bit: -0.0 still gives +0.0 (as
    ``Math.max(0, -0)`` does), +inf gives 1.0 and -inf gives 0.0."""
    return jmin(1.0, jmax(0.0, float(value)))


def jmax(a: float, b: float) -> float:
    """``Math.max(a, b)``: NaN-propagating (Python's ``max`` silently drops a NaN
    second argument), and +0 wins over -0. Identical to ``max`` for all other
    inputs. This helper cannot mask a NaN into a finite value."""
    # Guard float predicates to avoid coercing arbitrarily large ints to float.
    if (isinstance(a, float) and math.isnan(a)) or (isinstance(b, float) and math.isnan(b)):
        return math.nan
    if a == b:
        return b if math.copysign(1.0, a) < 0 else a
    return a if a > b else b


def jmin(a: float, b: float) -> float:
    """``Math.min(a, b)``: NaN-propagating, and -0 wins over +0."""
    if (isinstance(a, float) and math.isnan(a)) or (isinstance(b, float) and math.isnan(b)):
        return math.nan
    if a == b:
        return a if math.copysign(1.0, a) < 0 else b
    return a if a < b else b


def jclamp(value: float, lo: float, hi: float) -> float:
    """``Math.max(lo, Math.min(hi, value))``."""
    return jmax(lo, jmin(hi, value))


def jsin(value: float) -> float:
    """Like Math.sin for infinite inputs: return NaN instead of ValueError.

    Finite inputs retain the platform's math.sin result, including signed zero.
    """
    return math.nan if math.isinf(value) else math.sin(value)


def jcos(value: float) -> float:
    """Like Math.cos for infinite inputs; finite results use platform math.cos."""
    return math.nan if math.isinf(value) else math.cos(value)
