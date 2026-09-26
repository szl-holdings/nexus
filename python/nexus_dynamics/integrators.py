# SPDX-License-Identifier: Apache-2.0
"""Selectable, versioned integration methods.

Every method advances one instrument tick of ``dt`` (clamped to the contract
range 0.0004..0.08) in ``SUBSTEPS = 4`` substeps of ``h = dt / 4``, so all
methods share the same time grid:

``euler4``  forward Euler, bit-for-bit the browser instrument
            (``analogStep`` in ``src/lib/nexus/math.ts``) and IMMUNE's port.
            Kept for audio parity. First order; not conservative.
``rk4``     classical fourth-order Runge-Kutta on the exact vector field
            (Lorenz, harmonic, van der Pol, Duffing, Lotka-Volterra).
``symplectic``  velocity Verlet for the harmonic oscillator; Strang splitting
            with velocity Verlet on the conservative double well for Duffing.

NEMO is a hybrid threshold/reset system and only runs its instrument scheme
(``euler4``). Asking a program for a method it does not support raises
``UNSUPPORTED_METHOD``; a non-finite result raises ``NON_FINITE_OUTPUT``.

A method's version string is part of every hashed output, so changing an
algorithm must bump its version (and the parity vectors) on purpose.
"""
from __future__ import annotations

import math
from typing import Callable

from . import programs
from .errors import (
    NON_FINITE_NUMBER,
    UNKNOWN_METHOD,
    UNSUPPORTED_METHOD,
    NexusDynamicsError,
    non_finite_output,
)
from ._num import jmax, jmin
from .programs._common import Coefficients
from .schema import DT_MAX, DT_MIN, NexusState, finite_number

METHODS: tuple[str, ...] = ("euler4", "rk4", "symplectic")
METHOD_VERSIONS: dict[str, str] = {
    "euler4": "euler4/1",
    "rk4": "rk4/1",
    "symplectic": "strang-verlet/1",
}
SUBSTEPS = 4

Field = Callable[[float, float, float, float, Coefficients, float], "tuple[float, float, float]"]


def check_method(program: str, method: str) -> None:
    module = programs.get(program)
    if method not in METHODS:
        raise NexusDynamicsError(UNKNOWN_METHOD, f"unknown method: {method!r}")
    if method not in module.METHODS:
        raise NexusDynamicsError(
            UNSUPPORTED_METHOD,
            f"{program} supports {list(module.METHODS)}, not {method!r}",
        )


def supported_methods(program: str) -> tuple[str, ...]:
    return programs.methods(program)


def substep_size(dt: float) -> float:
    """``Math.max(0.0004, Math.min(0.08, dt)) / 4`` exactly as the instrument."""
    return jmax(DT_MIN, jmin(DT_MAX, dt)) / SUBSTEPS


def rk4_substep(
    field: Field, x: float, y: float, z: float, t: float, h: float, k: Coefficients, drive: float
) -> tuple[float, float, float]:
    k1x, k1y, k1z = field(x, y, z, t, k, drive)
    k2x, k2y, k2z = field(x + 0.5 * h * k1x, y + 0.5 * h * k1y, z + 0.5 * h * k1z, t + 0.5 * h, k, drive)
    k3x, k3y, k3z = field(x + 0.5 * h * k2x, y + 0.5 * h * k2y, z + 0.5 * h * k2z, t + 0.5 * h, k, drive)
    k4x, k4y, k4z = field(x + h * k3x, y + h * k3y, z + h * k3z, t + h, k, drive)
    return (
        x + h * (k1x + 2 * k2x + 2 * k3x + k4x) / 6,
        y + h * (k1y + 2 * k2y + 2 * k3y + k4y) / 6,
        z + h * (k1z + 2 * k2z + 2 * k3z + k4z) / 6,
    )


def _require_finite_state(state: NexusState) -> None:
    if not state.is_finite():
        raise NexusDynamicsError(NON_FINITE_NUMBER, "state values must be finite")


def advance(
    program: str,
    state: NexusState,
    h: float,
    substeps: int,
    chaos: float,
    drive: float,
    method: str,
) -> NexusState:
    """Advance ``substeps`` substeps of size ``h`` (no dt clamp). Not for NEMO.

    ``step`` is ``advance`` with ``h = substep_size(dt)`` and ``substeps = 4``;
    the convergence tests use ``advance`` directly to sweep h.
    """
    check_method(program, method)
    if program == "nemo":
        raise NexusDynamicsError(UNSUPPORTED_METHOD, "NEMO advances only through step()")
    module = programs.get(program)
    k = module.coefficients(chaos)
    x, y, z, t = state.x, state.y, state.z, state.t
    if method == "euler4":
        field = module.euler4_field
        for _ in range(substeps):
            dx, dy, dz = field(x, y, z, t, k, drive)
            x += dx * h
            y += dy * h
            z += dz * h
            t += h
        if program == "lotka":
            x, y = module.euler4_post(x, y)
    elif method == "rk4":
        for _ in range(substeps):
            x, y, z = rk4_substep(module.field, x, y, z, t, h, k, drive)
            t += h
    else:
        for _ in range(substeps):
            x, y = module.symplectic_substep(x, y, t, h, k, drive)
            t += h
    if not all(math.isfinite(value) for value in (x, y, z, t)):
        raise non_finite_output(program)
    return NexusState(x=x, y=y, z=z, t=t)


def step_with_events(
    program: str,
    state: NexusState,
    dt: float,
    chaos: float,
    drive: float = 0.5,
    method: str = "euler4",
) -> tuple[NexusState, int]:
    """One instrument tick; also returns the NEMO spike count (0 elsewhere)."""
    check_method(program, method)
    dt = finite_number("dt", dt)
    chaos = finite_number("chaos", chaos)
    drive = finite_number("drive", drive)
    _require_finite_state(state)
    if program == "nemo":
        return programs.nemo.step(state, dt, chaos, drive)
    return advance(program, state, substep_size(dt), SUBSTEPS, chaos, drive, method), 0


def step(
    program: str,
    state: NexusState,
    dt: float,
    chaos: float,
    drive: float = 0.5,
    method: str = "euler4",
) -> NexusState:
    """One instrument tick of ``dt`` with the chosen method."""
    return step_with_events(program, state, dt, chaos, drive, method)[0]
