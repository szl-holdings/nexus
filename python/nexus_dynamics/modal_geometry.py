# SPDX-License-Identifier: Apache-2.0
"""Dimensionless modal geometry for simulation and research fixtures.

These pure functions describe ideal fixed-ended strings and uniform, unloaded
Euler--Bernoulli cantilevers. Positions are fractions of length. Results are
spatial coefficients, not measured responses or complete time-domain models.
They provide no physical proof or runtime qualification; Energy UNAVAILABLE.

Formula references (implemented independently, with no external code):
* University of Texas, "Normal Modes of Uniform String", equation (4.37):
  https://farside.ph.utexas.edu/teaching/315/Waves/node28.html
* Georgia Tech, "Beam Bending Example", equations (15)--(17):
  https://aeresources.gatech.edu/strdyn/Webpage/BeamBending/Examples/BeamBending_p2.php
* TU Graz, "Cantilever beam", characteristic equation and boundary conditions:
  https://lampz.tugraz.at/~hadley/memm/mechanics/cbeam.php
"""

from __future__ import annotations

from math import cos, cosh, isfinite, pi, sin, sinh
from numbers import Real

__all__ = [
    "string_mode_weights",
    "string_modal_response",
    "cantilever_mode_shape",
]

# First four positive roots of cosh(beta) * cos(beta) + 1 = 0,
# where beta is the dimensionless wavenumber (physical wavenumber * length).
# Roots rounded to binary64 avoid a runtime root solver. The references
# above give the characteristic equation and lower-precision root tables.
_CANTILEVER_ROOTS = (
    1.8751040687119611,
    4.694091132974175,
    7.854757438237613,
    10.995540734875467,
)


def _position(value: float, name: str) -> float:
    """Validate a real, finite position before converting it to float."""
    if isinstance(value, bool) or not isinstance(value, Real):
        raise TypeError(f"{name} must be a real number, not a boolean")
    # Check bounds first so an arbitrarily large integer cannot overflow a
    # float conversion. NaN and infinities also fail this bounded comparison.
    if not 0.0 <= value <= 1.0 or not isfinite(value):
        raise ValueError(f"{name} must be finite and between 0 and 1 inclusive")
    return float(value)


def _mode_count(value: int, name: str, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(f"{name} must be an integer, not a boolean")
    if not 1 <= value <= maximum:
        raise ValueError(f"{name} must be between 1 and {maximum} inclusive")
    return value


def string_mode_weights(excitation: float, modes: int) -> tuple[float, ...]:
    """Return signed weights sin(n*pi*excitation), for n from 1 to modes.

    ``excitation`` is a real, finite fraction of string length in [0, 1].
    ``modes`` is an integer in [1, 64]. Booleans are rejected for both.
    Invalid types raise TypeError; values outside the bounds raise ValueError.

    These unit-peak spatial weights describe ideal point coupling, without
    modal-mass, frequency, damping, or force scaling. Both fixed endpoints
    return exact zeros. Interior nodes can have floating-point roundoff;
    in particular, midpoint excitation suppresses even modes to tolerance.
    """
    position = _position(excitation, "excitation")
    count = _mode_count(modes, "modes", 64)
    if position == 0.0 or position == 1.0:
        return (0.0,) * count
    return tuple(sin(n * pi * position) for n in range(1, count + 1))


def string_modal_response(
    excitation: float, pickup: float, modes: int
) -> tuple[float, ...]:
    """Return excitation and pickup weight products for modes 1 through modes.

    Each coefficient is sin(n*pi*excitation) * sin(n*pi*pickup). Both positions
    and the mode count follow string_mode_weights validation. A pickup at a
    node suppresses that mode even if the excitation weight is nonzero.
    This is spatial coupling only, without a time or frequency response.
    """
    excitation_weights = string_mode_weights(excitation, modes)
    pickup_weights = string_mode_weights(pickup, modes)
    return tuple(a * b for a, b in zip(excitation_weights, pickup_weights))


def cantilever_mode_shape(mode: int, position: float) -> float:
    """Return one of the first four cantilever shapes, normalized by its tip.

    ``mode`` is an integer in [1, 4]; ``position`` is a real, finite fraction
    of length in [0, 1], measured from the clamp. Booleans are rejected.
    Invalid types raise TypeError; values outside the bounds raise ValueError.

    For the selected root beta, the unnormalized shape is
    cosh(beta*x) - cos(beta*x) - sigma*(sinh(beta*x) - sin(beta*x)), with
    sigma = (cosh(beta) + cos(beta)) / (sinh(beta) + sin(beta)). Dividing by
    its signed tip value fixes every mode's tip at +1 and the clamp at 0.
    This is tip normalization, not unit modal mass normalization. Mode 2 at
    the midpoint is approximately -0.713666, so the midpoint is not its node.
    """
    index = _mode_count(mode, "mode", len(_CANTILEVER_ROOTS))
    x = _position(position, "position")
    beta = _CANTILEVER_ROOTS[index - 1]
    sigma = (cosh(beta) + cos(beta)) / (sinh(beta) + sin(beta))
    argument = beta * x
    shape = (
        cosh(argument) - cos(argument)
        - sigma * (sinh(argument) - sin(argument))
    )
    tip = cosh(beta) - cos(beta) - sigma * (sinh(beta) - sin(beta))
    return shape / tip
