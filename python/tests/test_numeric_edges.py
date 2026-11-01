# SPDX-License-Identifier: Apache-2.0
"""Cross-binding overflow regressions; do not regenerate the published hashes."""
from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from nexus_dynamics import NexusDynamicsError, NexusRunInput, NexusState, nexus_hash, step
from nexus_dynamics._num import jcos, jsin
from nexus_dynamics.analog import optical_interfere, optical_reconstruct, scale

VECTORS = json.loads((Path(__file__).resolve().parents[2] / "contracts" / "nexus-numeric-edges.json").read_text())["vectors"]


def evaluate(vector):
    if vector["kind"] == "interfere":
        return optical_interfere(*vector["args"])
    state = NexusState(**vector["state"])
    if vector["kind"] == "scale":
        return scale(vector["program"], state)
    return step(vector["program"], state, vector["dt"], vector["chaos"], vector["drive"], vector["method"]).to_dict()


@pytest.mark.parametrize("vector", VECTORS, ids=lambda v: v["id"])
def test_numeric_edge_matches_typescript(vector):
    expected = vector["expected"]
    if "error" in expected:
        with pytest.raises(NexusDynamicsError) as caught:
            evaluate(vector)
        assert caught.value.code == expected["error"]
    else:
        assert nexus_hash(evaluate(vector)) == expected["outputHash"]


@pytest.mark.parametrize("method", ["euler4", "rk4", "symplectic"])
def test_direct_integer_state_uses_binary64_before_products(method):
    # Keep this an actual Python integer: JSON round-tripping through JS loses
    # the type difference that caused the original raw OverflowError.
    with pytest.raises(NexusDynamicsError) as caught:
        step("duffing", NexusState(10**300, 0, 0, 0), .01, .5, method=method)
    assert caught.value.code == "NON_FINITE_OUTPUT"


@pytest.mark.parametrize("value", [math.inf, -math.inf, math.nan])
def test_trig_nonfinite_reaches_existing_fallbacks(value):
    assert math.isnan(jsin(value))
    assert math.isnan(jcos(value))
    assert optical_reconstruct(1.0, value) == 0.0


@pytest.mark.parametrize("value", [-0.0, 0.0, 1e-300, -1e-300, .1622758695, 1., -2., 1e300])
def test_finite_trig_keeps_platform_bits(value):
    assert jsin(value).hex() == math.sin(value).hex()
    assert jcos(value).hex() == math.cos(value).hex()


def test_direct_state_is_not_mutated():
    bank = [-65., -62., -70., -58., -67.] + [0.] * 10
    original = list(bank)
    state = NexusState(-65, -70, 0, 0, bank)
    step("nemo", state, .01, .5)
    assert bank == original
    assert type(state.t) is int


def test_direct_input_and_from_dict_have_different_integer_normalization():
    value = 2**53 + 1
    payload = {"program": "lorenz", "mode": "HALT", "steps": 0, "dt": .01,
               "chaos": .5, "drive": .5, "seed": .2, "repeatEvery": 32,
               "state": {"x": value, "y": 0., "z": 0., "t": 0.}}
    normalized = NexusRunInput.from_dict(payload)
    assert normalized.state.x == float(value)
    assert normalized.state.x != value
    with pytest.raises(NexusDynamicsError) as caught:
        NexusRunInput("lorenz", "HALT", 0, .01, .5, .5, .2, 32,
                      NexusState(value, 0., 0., 0.))
    assert caught.value.code == "INVALID_REQUEST"
