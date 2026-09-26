# SPDX-License-Identifier: Apache-2.0
"""Registry of the six NEXUS analog programs."""
from __future__ import annotations

from types import ModuleType

from ..errors import UNKNOWN_PROGRAM, NexusDynamicsError
from ..schema import PROGRAMS, NexusState
from . import duffing, harmonic, lorenz, lotka, nemo, vanderpol
from ._common import Coefficients

_MODULES: dict[str, ModuleType] = {
    "lorenz": lorenz,
    "harmonic": harmonic,
    "vanderpol": vanderpol,
    "duffing": duffing,
    "lotka": lotka,
    "nemo": nemo,
}
assert tuple(_MODULES) == PROGRAMS

LABELS = {name: module.LABEL for name, module in _MODULES.items()}
MODELS = {name: module.MODEL for name, module in _MODULES.items()}


def get(program: str) -> ModuleType:
    try:
        return _MODULES[program]
    except (KeyError, TypeError):
        raise NexusDynamicsError(UNKNOWN_PROGRAM, f"unknown program: {program!r}") from None


def coefficients(program: str, chaos: float) -> Coefficients:
    return get(program).coefficients(chaos)


def seed(program: str, nudge: float = 0.0) -> NexusState:
    return get(program).seed(nudge)


def methods(program: str) -> tuple[str, ...]:
    return tuple(get(program).METHODS)


__all__ = [
    "Coefficients",
    "LABELS",
    "MODELS",
    "PROGRAMS",
    "coefficients",
    "duffing",
    "get",
    "harmonic",
    "lorenz",
    "lotka",
    "methods",
    "nemo",
    "seed",
    "vanderpol",
]
