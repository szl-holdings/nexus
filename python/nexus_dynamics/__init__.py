# SPDX-License-Identifier: Apache-2.0
"""nexus_dynamics: the canonical NEXUS simulation engine (Python binding).

Stdlib only, so IMMUNE Channel B can vendor it unchanged. Executable software
simulation, not a physical analog or neuromorphic chip. Energy UNAVAILABLE.
Lambda uniqueness is Conjecture 1 (OPEN); nothing here proves it.
"""
from __future__ import annotations

from .canonical import canonical_json, canonical_number, canonicalize, nexus_hash
from .errors import NexusDynamicsError, NexusValidationError
from .integrators import METHOD_VERSIONS, METHODS, advance, check_method, step, step_with_events, supported_methods
from .programs import LABELS, MODELS, coefficients, seed
from .schema import MODES, PROGRAMS, NexusRunInput, NexusRunRequest, NexusState

ENGINE_NAME = "nexus_dynamics"
ENGINE_VERSION = "2.0.0"

__all__ = [
    "ENGINE_NAME",
    "ENGINE_VERSION",
    "LABELS",
    "METHODS",
    "METHOD_VERSIONS",
    "MODELS",
    "MODES",
    "PROGRAMS",
    "NexusDynamicsError",
    "NexusRunInput",
    "NexusRunRequest",
    "NexusState",
    "NexusValidationError",
    "advance",
    "canonical_json",
    "canonical_number",
    "canonicalize",
    "check_method",
    "coefficients",
    "nexus_hash",
    "seed",
    "step",
    "step_with_events",
    "supported_methods",
]
