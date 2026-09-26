# SPDX-License-Identifier: Apache-2.0
"""Canonical hashing identical to IMMUNE ``nexus_hash``.

IMMUNE (``python/immune/nexus.py`` ``_canonical_number`` /
``_canonicalize_for_parity`` / ``nexus_hash``) projects every JSON number to a
string with exactly nine decimal places (``f"{x:.9f}"``, negative zero folded to
zero), sorts object keys, serialises with ``separators=(",", ":")`` and
``ensure_ascii=False`` and hashes the UTF-8 bytes with SHA-256.

This module reproduces that byte for byte. The one deliberate tightening is
that a non-finite number raises ``NON_FINITE_OUTPUT`` instead of being
serialised as ``nan``/``inf``: no NaN or Infinity can ever reach a hash.

Python's ``format(x, ".9f")`` rounds the exact binary value half-to-even. The
TypeScript binding (``src/lib/nexus/dynamics.ts``) implements the same exact
rounding rather than ``Number.prototype.toFixed`` (which rounds exact ties up
and switches to exponent notation at 1e21).
"""
from __future__ import annotations

import hashlib
import json
import math
from typing import Any

from .errors import NexusDynamicsError, non_finite_output

CANONICAL_DECIMAL_PLACES = 9


def canonical_number(value: float | int) -> str:
    number = float(value)
    if not math.isfinite(number):
        raise non_finite_output("canonical projection")
    safe = 0.0 if number == 0 else number
    return f"{safe:.{CANONICAL_DECIMAL_PLACES}f}"


def canonicalize(value: Any) -> Any:
    """Replace every number by its nine-decimal string, recursively."""
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        return canonical_number(value)
    if isinstance(value, (list, tuple)):
        return [canonicalize(item) for item in value]
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key in sorted(value):
            if not isinstance(key, str):
                raise NexusDynamicsError("INVALID_REQUEST", "canonical object keys must be strings")
            out[key] = canonicalize(value[key])
        return out
    raise NexusDynamicsError(
        "INVALID_REQUEST", f"cannot canonicalize value of type {type(value).__name__}"
    )


def canonical_json(value: Any) -> str:
    return json.dumps(
        canonicalize(value),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def nexus_hash(value: Any) -> str:
    """SHA-256 hex digest of the canonical JSON projection (IMMUNE ``nexus_hash``)."""
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()
