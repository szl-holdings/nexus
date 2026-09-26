# SPDX-License-Identifier: Apache-2.0
"""Canonical projection and hashing (IMMUNE ``nexus_hash`` semantics)."""
from __future__ import annotations

import hashlib
import json
import math
from decimal import ROUND_HALF_EVEN, Decimal, localcontext

import pytest
from hypothesis import given
from hypothesis import strategies as st

from nexus_dynamics import NexusDynamicsError, canonical_json, canonical_number, canonicalize, nexus_hash


def reference_nine_decimals(value: float) -> str:
    """Independent reference: exact binary value, half-even, via ``decimal``."""
    if value == 0:
        value = 0.0
    exact = Decimal(value)  # exact binary expansion
    with localcontext() as ctx:
        ctx.prec = 1000  # enough for 1.8e308 with nine decimals
        quantized = exact.quantize(Decimal("1e-9"), rounding=ROUND_HALF_EVEN)
    text = f"{quantized.copy_abs():f}"  # copy_abs never rounds (abs() would, at prec 28)
    return ("-" if math.copysign(1.0, value) < 0 and value != 0 else "") + text


@given(st.floats(allow_nan=False, allow_infinity=False))
def test_canonical_number_is_exact_half_even(value: float) -> None:
    assert canonical_number(value) == reference_nine_decimals(value)


def test_exact_binary_ties_round_half_even() -> None:
    assert canonical_number(0.0009765625) == "0.000976562"  # 1/1024: tie, 2 is even
    assert canonical_number(0.0029296875) == "0.002929688"  # 3/1024: tie, 7 is odd
    assert canonical_number(-0.0009765625) == "-0.000976562"
    assert canonical_number(1e21) == "1000000000000000000000.000000000"


def test_negative_zero_folds_and_small_negatives_keep_sign() -> None:
    assert canonical_number(-0.0) == "0.000000000"
    assert canonical_number(-1e-10) == "-0.000000000"  # Python format keeps the sign


@pytest.mark.parametrize("bad", [math.nan, math.inf, -math.inf])
def test_non_finite_is_never_serialized(bad: float) -> None:
    with pytest.raises(NexusDynamicsError) as caught:
        canonical_json({"x": [1.0, bad]})
    assert caught.value.code == "NON_FINITE_OUTPUT"


def test_canonical_json_shape() -> None:
    value = {"b": [1, 2.5, True, None], "a": {"z": "ω", "y": -0.0}}
    text = canonical_json(value)
    assert text == '{"a":{"y":"0.000000000","z":"ω"},"b":["1.000000000","2.500000000",true,null]}'
    assert nexus_hash(value) == hashlib.sha256(text.encode("utf-8")).hexdigest()


def test_matches_immune_algorithm_on_nested_payload() -> None:
    """IMMUNE's implementation, restated literally (python/immune/nexus.py:676-703)."""

    def immune_canonical_number(v: float) -> str:
        safe = 0.0 if v == 0 else v
        return f"{safe:.9f}"

    def immune_canonicalize(v):
        if isinstance(v, bool) or v is None or isinstance(v, str):
            return v
        if isinstance(v, (int, float)):
            return immune_canonical_number(float(v))
        if isinstance(v, list):
            return [immune_canonicalize(i) for i in v]
        if isinstance(v, dict):
            return {k: immune_canonicalize(v[k]) for k in sorted(v)}
        return v

    def immune_hash(v) -> str:
        payload = json.dumps(immune_canonicalize(v), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    payload = {
        "schema": "szl.immune-nexus-parity/v1",
        "finalState": {"x": 1.23456789012, "y": -0.0, "z": 22, "t": 0.64, "bank": [0.1, -65.0, 1e-12]},
        "invariants": {"allHold": True, "lotkaFirstQuadrant": None},
        "label": "α 1.10 · β 0.74",
    }
    assert nexus_hash(payload) == immune_hash(payload)


def test_parity_fixture_strings_match(parity_doc: dict) -> None:
    for value, expected in parity_doc["canonical_number_vectors"]:
        assert canonical_number(value) == expected
        assert reference_nine_decimals(value) == expected
    for value, expected in parity_doc["round12_vectors"]:
        assert round(value, 12) == expected


def test_rejects_non_string_keys_and_unknown_types() -> None:
    with pytest.raises(NexusDynamicsError):
        canonicalize({1: 2})
    with pytest.raises(NexusDynamicsError):
        canonicalize({"x": object()})
