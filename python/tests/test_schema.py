# SPDX-License-Identifier: Apache-2.0
"""schema.py mirrors contracts/immune-nexus.v1.json and enforces it strictly."""
from __future__ import annotations

import hashlib
import math

import pytest
from hypothesis import given
from hypothesis import strategies as st

from nexus_dynamics import NexusDynamicsError, NexusRunInput, NexusRunRequest
from nexus_dynamics import schema as S


def test_vendored_contract_is_byte_identical_to_immune(repo_root) -> None:
    raw = (repo_root / "contracts" / "immune-nexus.v1.json").read_bytes()
    assert hashlib.sha256(raw).hexdigest() == S.CONTRACT_SHA256


def test_constants_mirror_the_contract(contract: dict) -> None:
    props = contract["properties"]
    assert contract["$id"] == S.CONTRACT_ID
    assert contract["additionalProperties"] is False
    assert tuple(contract["required"]) == S.REQUIRED_FIELDS
    assert set(props) == set(S.INPUT_FIELDS) | {"actor", "requestId"}
    assert tuple(props["program"]["enum"]) == S.PROGRAMS
    assert tuple(props["mode"]["enum"]) == S.MODES
    assert (props["steps"]["type"], props["steps"]["minimum"], props["steps"]["maximum"]) == (
        "integer", S.STEPS_MIN, S.STEPS_MAX)
    assert (props["dt"]["minimum"], props["dt"]["maximum"]) == (S.DT_MIN, S.DT_MAX)
    for name in ("chaos", "drive", "seed"):
        assert (props[name]["type"], props[name]["minimum"], props[name]["maximum"]) == (
            "number", S.UNIT_MIN, S.UNIT_MAX)
    assert (props["repeatEvery"]["minimum"], props["repeatEvery"]["maximum"]) == (
        S.REPEAT_EVERY_MIN, S.REPEAT_EVERY_MAX)
    state = props["state"]
    assert state["additionalProperties"] is False
    assert tuple(state["required"]) == S.STATE_REQUIRED
    assert tuple(state["properties"]) == S.STATE_FIELDS
    assert (state["properties"]["t"]["minimum"], state["properties"]["t"]["maximum"]) == (
        S.STATE_T_MIN, S.STATE_T_MAX)
    bank = state["properties"]["bank"]
    assert (bank["minItems"], bank["maxItems"]) == (S.BANK_MIN_ITEMS, S.BANK_MAX_ITEMS)
    axes = props["axes"]
    assert (axes["minItems"], axes["maxItems"]) == (S.AXES_MIN_ITEMS, S.AXES_MAX_ITEMS)
    assert (axes["items"]["minimum"], axes["items"]["maximum"]) == (S.UNIT_MIN, S.UNIT_MAX)
    assert (props["actor"]["minLength"], props["actor"]["maxLength"]) == (S.ACTOR_MIN_LENGTH, S.ACTOR_MAX_LENGTH)
    rid = props["requestId"]
    assert (rid["minLength"], rid["maxLength"], rid["pattern"]) == (
        S.REQUEST_ID_MIN_LENGTH, S.REQUEST_ID_MAX_LENGTH, S.REQUEST_ID_PATTERN)
    # The runtime-only NEMO cap is stated in the contract text.
    assert "400" in props["steps"]["description"]
    assert contract["x-szl-boundary"]["energy"] == "UNAVAILABLE"


def valid(**overrides):
    payload = {
        "actor": "lab:tester",
        "requestId": "req-0001",
        "program": "lorenz",
        "mode": "OP",
        "steps": 64,
        "dt": 0.01,
        "chaos": 0.45,
        "drive": 0.7,
        "seed": 0.2,
        "repeatEvery": 32,
    }
    payload.update(overrides)
    return payload


def test_request_round_trip() -> None:
    request = NexusRunRequest.from_dict(valid(axes=[0.9, 0.95]))
    assert request.to_dict() == valid(axes=[0.9, 0.95])
    assert request.input.repeat_every == 32


def test_nemo_bank_15_is_padded_with_unit_weights() -> None:
    bank = [float(-60 - i) for i in range(5)] + [0.0] * 10
    run = NexusRunInput.from_dict(
        {k: v for k, v in valid(program="nemo", state={"x": -60, "y": -62, "z": 0, "t": 0, "bank": bank}).items()
         if k not in ("actor", "requestId")}
    )
    assert run.state is not None and run.state.bank is not None
    assert len(run.state.bank) == 20 and run.state.bank[15:] == (1.0,) * 5


@pytest.mark.parametrize(
    ("overrides", "code"),
    [
        ({"extra": 1}, "UNSUPPORTED_FIELD"),
        ({"program": "lorenz2"}, "UNKNOWN_PROGRAM"),
        ({"mode": "op"}, "UNKNOWN_MODE"),
        ({"steps": 2401}, "OUT_OF_RANGE"),
        ({"steps": 10.5}, "OUT_OF_RANGE"),
        ({"steps": True}, "OUT_OF_RANGE"),
        ({"program": "nemo", "steps": 401}, "OUT_OF_RANGE"),
        ({"dt": "0.01"}, "NON_FINITE_NUMBER"),
        ({"dt": math.nan}, "NON_FINITE_NUMBER"),
        ({"dt": 0.0}, "OUT_OF_RANGE"),
        ({"chaos": True}, "NON_FINITE_NUMBER"),
        ({"drive": 1.5}, "OUT_OF_RANGE"),
        ({"seed": -0.1}, "OUT_OF_RANGE"),
        ({"repeatEvery": 0}, "OUT_OF_RANGE"),
        ({"axes": []}, "INVALID_AXES"),
        ({"axes": [0.5] * 65}, "INVALID_AXES"),
        ({"axes": [1.2]}, "OUT_OF_RANGE"),
        ({"state": {"x": 0, "y": 0, "z": 0}}, "INVALID_STATE"),
        ({"state": {"x": 0, "y": 0, "z": 0, "t": 0, "w": 1}}, "UNSUPPORTED_STATE_FIELD"),
        ({"state": {"x": 0, "y": 0, "z": 0, "t": 0, "bank": [0.0] * 20}}, "UNSUPPORTED_STATE_FIELD"),
        ({"state": {"x": math.inf, "y": 0, "z": 0, "t": 0}}, "NON_FINITE_NUMBER"),
        ({"state": {"x": 0, "y": 0, "z": 0, "t": 2e6}}, "OUT_OF_RANGE"),
        ({"program": "nemo", "state": {"x": 0, "y": 0, "z": 0, "t": 0, "bank": [1, 2]}}, "INVALID_NEMO_BANK"),
        ({"program": "nemo", "state": {"x": 0, "y": 0, "z": 0, "t": 0}}, "INVALID_NEMO_BANK"),
        ({"actor": ""}, "INVALID_ACTOR"),
        ({"requestId": "short"}, "INVALID_REQUEST_ID"),
        ({"requestId": "bad id!!"}, "INVALID_REQUEST_ID"),
        ({"requestId": "req-0001\n"}, "INVALID_REQUEST_ID"),
    ],
)
def test_invalid_requests_fail_closed(overrides, code) -> None:
    with pytest.raises(NexusDynamicsError) as caught:
        NexusRunRequest.from_dict(valid(**overrides))
    assert caught.value.code == code


def test_missing_required_fields() -> None:
    payload = valid()
    del payload["dt"]
    with pytest.raises(NexusDynamicsError) as caught:
        NexusRunRequest.from_dict(payload)
    assert caught.value.code == "MISSING_FIELD"
    payload = valid()
    del payload["requestId"]
    with pytest.raises(NexusDynamicsError) as caught:
        NexusRunRequest.from_dict(payload)
    assert caught.value.code == "MISSING_FIELD"


unit = st.floats(min_value=0.0, max_value=1.0)
inputs = st.fixed_dictionaries(
    {
        "program": st.sampled_from(S.PROGRAMS),
        "mode": st.sampled_from(S.MODES),
        "steps": st.integers(0, S.NEMO_STEPS_MAX),
        "dt": st.floats(min_value=S.DT_MIN, max_value=S.DT_MAX),
        "chaos": unit,
        "drive": unit,
        "seed": unit,
        "repeatEvery": st.integers(S.REPEAT_EVERY_MIN, S.REPEAT_EVERY_MAX),
    },
    optional={"axes": st.lists(unit, min_size=1, max_size=64)},
)


@given(inputs)
def test_valid_inputs_round_trip(payload) -> None:
    run = NexusRunInput.from_dict(payload)
    assert run.to_dict() == payload
    assert NexusRunInput.from_dict(run.to_dict()) == run
