# SPDX-License-Identifier: Apache-2.0
"""Typed, fail-closed errors for the UNRATIFIED acoustic importer PROPOSAL.

Codes reuse the NEXUS/IMMUNE names (``nexus_dynamics/errors.py``) where the
meaning is the same, so a host can map them to the same HTTP semantics. The
acoustic-only codes are new and are PROPOSAL names, not ratified contract.
"""
from __future__ import annotations

# Shared with nexus_dynamics.errors
NON_FINITE_NUMBER = "NON_FINITE_NUMBER"
OUT_OF_RANGE = "OUT_OF_RANGE"
UNSUPPORTED_FIELD = "UNSUPPORTED_FIELD"
MISSING_FIELD = "MISSING_FIELD"
INVALID_REQUEST = "INVALID_REQUEST"

# Acoustic import PROPOSAL codes
VERSION_MISMATCH = "VERSION_MISMATCH"
REVISION_MISMATCH = "REVISION_MISMATCH"
INVALID_REVISION = "INVALID_REVISION"
INVALID_RECORDING_ID = "INVALID_RECORDING_ID"
INVALID_SAMPLES = "INVALID_SAMPLES"
UNSUPPORTED_SOURCE = "UNSUPPORTED_SOURCE"
UNSUPPORTED_UNIT = "UNSUPPORTED_UNIT"
INVALID_CUSTODY = "INVALID_CUSTODY"
DIGEST_MISMATCH = "DIGEST_MISMATCH"
INVALID_TIMESTAMP = "INVALID_TIMESTAMP"
FUTURE_TIMESTAMP = "FUTURE_TIMESTAMP"
INVALID_CLOCK = "INVALID_CLOCK"
INVALID_RIGHTS = "INVALID_RIGHTS"


class AcousticImportError(ValueError):
    """Strict structural, version, custody or source-material contract failure."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"AcousticImportError({self.code!r}, {str(self)!r})"
