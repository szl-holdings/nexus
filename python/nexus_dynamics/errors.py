# SPDX-License-Identifier: Apache-2.0
"""Typed, fail-closed errors for the NEXUS dynamics engine.

Error codes match the IMMUNE NEXUS plane (``szl-holdings/immune``
``python/immune/nexus.py``) wherever the two overlap, so a host can map them
to the same HTTP semantics.
"""
from __future__ import annotations

NON_FINITE_OUTPUT = "NON_FINITE_OUTPUT"
NON_FINITE_NUMBER = "NON_FINITE_NUMBER"
OUT_OF_RANGE = "OUT_OF_RANGE"
UNKNOWN_PROGRAM = "UNKNOWN_PROGRAM"
UNKNOWN_MODE = "UNKNOWN_MODE"
UNKNOWN_METHOD = "UNKNOWN_METHOD"
UNSUPPORTED_METHOD = "UNSUPPORTED_METHOD"
UNSUPPORTED_FIELD = "UNSUPPORTED_FIELD"
UNSUPPORTED_STATE_FIELD = "UNSUPPORTED_STATE_FIELD"
MISSING_FIELD = "MISSING_FIELD"
INVALID_REQUEST = "INVALID_REQUEST"
INVALID_STATE = "INVALID_STATE"
INVALID_NEMO_BANK = "INVALID_NEMO_BANK"
INVALID_AXES = "INVALID_AXES"
INVALID_ACTOR = "INVALID_ACTOR"
INVALID_REQUEST_ID = "INVALID_REQUEST_ID"


class NexusDynamicsError(ValueError):
    """Strict input, method or deterministic-output contract failure."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"NexusDynamicsError({self.code!r}, {str(self)!r})"


# IMMUNE names the same exception ``NexusValidationError``; keep the alias so a
# vendored copy can be dropped in without renaming call sites.
NexusValidationError = NexusDynamicsError


def non_finite_output(what: str = "simulation") -> NexusDynamicsError:
    return NexusDynamicsError(NON_FINITE_OUTPUT, f"{what} produced a non-finite value")
