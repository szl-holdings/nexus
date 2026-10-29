# SPDX-License-Identifier: Apache-2.0
"""JavaScript min/max edge semantics, including D2 NaN propagation."""
from __future__ import annotations

import math

import pytest

from nexus_dynamics._num import clamp01, jclamp, jmax, jmin


@pytest.mark.parametrize("operation", [jmin, jmax])
@pytest.mark.parametrize("other", [0.0, -0.0, math.inf, -math.inf, math.nan, 10**400])
def test_min_max_propagate_nan_from_either_argument(operation, other) -> None:
    assert math.isnan(operation(math.nan, other))
    assert math.isnan(operation(other, math.nan))


@pytest.mark.parametrize(("a", "b", "minimum", "maximum"), [
    (-0.0, 0.0, -0.0, 0.0),
    (0.0, -0.0, -0.0, 0.0),
    (-0.0, -0.0, -0.0, -0.0),
    (0.0, 0.0, 0.0, 0.0),
    (-math.inf, math.inf, -math.inf, math.inf),
    (math.inf, -math.inf, -math.inf, math.inf),
    (math.inf, math.inf, math.inf, math.inf),
    (-math.inf, -math.inf, -math.inf, -math.inf),
    (1.0, math.inf, 1.0, math.inf),
    (-math.inf, 1.0, -math.inf, 1.0),
])
def test_min_max_preserve_signed_zero_and_infinities(a, b, minimum, maximum) -> None:
    assert jmin(a, b).hex() == minimum.hex()
    assert jmax(a, b).hex() == maximum.hex()


@pytest.mark.parametrize("value", [2**1024, -(10**400)])
def test_min_max_do_not_coerce_unequal_oversized_integers(value) -> None:
    for a, b in ((value, 0), (0, value)):
        assert jmin(a, b) == min(a, b)
        assert jmax(a, b) == max(a, b)


@pytest.mark.parametrize(("value", "low", "high"), [
    (math.nan, 0.0, 1.0),
    (0.5, math.nan, 1.0),
    (0.5, 0.0, math.nan),
])
def test_clamp_propagates_nan_from_every_position(value, low, high) -> None:
    assert math.isnan(jclamp(value, low, high))


def test_clamp_preserves_the_expected_zero_sign() -> None:
    assert jclamp(-0.0, -1.0, 1.0).hex() == (-0.0).hex()
    assert jclamp(-0.0, 0.0, 1.0).hex() == (0.0).hex()
    assert clamp01(-0.0).hex() == (0.0).hex()
