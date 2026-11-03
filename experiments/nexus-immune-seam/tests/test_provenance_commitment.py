# SPDX-License-Identifier: Apache-2.0
"""Unsigned metadata commitments, not authenticated custody or physical evidence."""
from __future__ import annotations

import copy
import hashlib
import json

import pytest

from acoustic_import import AcousticImportError, admit
from acoustic_import import importer as I
from conftest import NOW, build_payload, rehash


MUTATIONS = [
    (("recordingId",), "syn-tone-0002"),
    (("source", "generator"), "another.arithmetic_generator"),
    (("source", "sourceRevision"), "2" * 40),
    (("custody", "custodian"), "another-custodian"),
    (("custody", "acquiredAt"), "2026-10-28T03:49:00Z"),
    (("custody", "chain", 0, "actor"), "another-actor-0"),
    (("custody", "chain", 0, "action"), "another-action-0"),
    (("custody", "chain", 0, "at"), "2026-10-28T03:50:01Z"),
    (("custody", "chain", 1, "actor"), "another-actor-1"),
    (("custody", "chain", 1, "action"), "another-action-1"),
    (("custody", "chain", 1, "at"), "2026-10-28T03:52:00Z"),
    (("rights", "status"), "OWNED"),
    (("rights", "holder"), "another stated holder"),
    (("rights", "basis"), "another stated basis"),
    (("sampleRateHz",), 16000),
]


def mutate(payload, path, value):
    obj = payload
    for key in path[:-1]:
        obj = obj[key]
    obj[path[-1]] = value


@pytest.mark.parametrize("path,value", MUTATIONS)
def test_every_mutable_provenance_leaf_changes_commitment(payload, path, value):
    before = admit(payload, now=NOW)
    mutate(payload, path, value)
    after = admit(payload, now=NOW)
    assert after.admitted and before.admitted
    assert after.decision_hash != before.decision_hash
    assert after.evidence_label == "FIXTURE_ONLY"
    assert after.calibration == "MISSING"
    assert after.physical_analysis_eligible is False


@pytest.mark.parametrize("path", [
    ("schema",), ("contractRevision",), ("source", "kind"),
    ("units", "amplitude"), ("units", "time"), ("units", "sampleRate"),
    ("custody", "samplesSha256"),
])
def test_fixed_or_digest_bound_provenance_cannot_be_mutated_and_accepted(payload, path):
    mutate(payload, path, "not-an-accepted-value")
    with pytest.raises(AcousticImportError):
        admit(payload, now=NOW)


def reverse_objects(value):
    if isinstance(value, dict):
        return {key: reverse_objects(item) for key, item in reversed(list(value.items()))}
    if isinstance(value, list):
        return [reverse_objects(item) for item in value]
    return value


def test_object_order_is_canonical_but_chain_order_is_not(payload):
    original = admit(payload, now=NOW)
    assert admit(reverse_objects(payload), now=NOW) == original
    # Equal timestamps permit both orderings; the accepted sequence still matters.
    payload["custody"]["chain"][1]["at"] = payload["custody"]["chain"][0]["at"]
    ordered = admit(payload, now=NOW)
    payload["custody"]["chain"].reverse()
    assert admit(payload, now=NOW).decision_hash != ordered.decision_hash


def test_chain_length_samples_channels_and_frames_are_committed(payload):
    original = admit(payload, now=NOW)
    appended = copy.deepcopy(payload)
    appended["custody"]["chain"].append({
        "actor": "next", "action": "retained", "at": "2026-10-28T03:59:00Z",
    })
    assert admit(appended, now=NOW).decision_hash != original.decision_hash
    payload["samples"][0][0] = 0.25
    assert admit(rehash(payload), now=NOW).decision_hash != original.decision_hash
    assert admit(build_payload(channels=2), now=NOW).decision_hash != original.decision_hash
    assert admit(build_payload(frames=65), now=NOW).decision_hash != original.decision_hash


def test_committed_body_is_detached_from_input_and_export(payload):
    decision = admit(payload, now=NOW)
    body = decision.body()
    assert body["source"]["generator"] == payload["source"]["generator"]
    assert body["custody"]["chain"] == payload["custody"]["chain"]
    payload["custody"]["chain"][0]["actor"] = "changed input"
    payload["source"]["generator"] = "changed input"
    body["custody"]["chain"][0]["actor"] = "changed export"
    body["source"]["generator"] = "changed export"
    assert I.canonical_hash(decision.body()) == decision.decision_hash
    assert decision.body()["custody"]["chain"][0]["actor"] == "lane:nexus-chad"


def test_decision_version_separates_new_commitment_from_historical_v0(payload):
    decision = admit(payload, now=NOW)
    body = decision.body()
    assert payload["schema"] == "szl.nexus-immune.acoustic-import/v0-proposal"
    assert body["schema"] == "szl.nexus-immune.acoustic-import-decision/v1-proposal"
    assert body["decisionHashKind"] == "sha256-canonical-json-provenance-v1-unsigned"
    # Frozen v0 control from exact pre-fix main. Do not re-label old hashes as v1.
    legacy = copy.deepcopy(body)
    legacy["schema"] = "szl.nexus-immune.acoustic-import-decision/v0-proposal"
    legacy["decisionHashKind"] = "sha256-canonical-json-unsigned"
    del legacy["source"]["generator"]
    del legacy["custody"]["chain"]
    assert I.canonical_hash(legacy) == "e87f7466b4e2b515c73f7f9ad1f7667c159b9c6afffc661a7ae7f5cd12c441f8"
    assert decision.decision_hash != I.canonical_hash(legacy)
    assert I.canonical_hash(body) == hashlib.sha256(json.dumps(
        body, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False,
    ).encode("utf-8")).hexdigest()


@pytest.mark.parametrize("block", [(), ("source",), ("custody",), ("rights",),
                                    ("units",), ("custody", "chain", 0)])
def test_non_string_object_keys_are_explicitly_refused(payload, block):
    obj = payload
    for key in block:
        obj = obj[key]
    obj[42] = "not a JSON object key"
    obj[None] = "also not a JSON object key"
    with pytest.raises(AcousticImportError):
        admit(payload, now=NOW)


@pytest.mark.parametrize("path", [
    ("source", "generator"), ("custody", "custodian"),
    ("custody", "chain", 0, "actor"), ("custody", "chain", 0, "action"),
    ("rights", "holder"), ("rights", "basis"),
])
def test_invalid_unicode_is_a_typed_failure_not_an_unhashable_admission(payload, path):
    mutate(payload, path, "invalid\ud800")
    with pytest.raises(AcousticImportError):
        admit(payload, now=NOW)


def test_unicode_code_points_are_preserved_not_silently_normalized(payload):
    payload["source"]["generator"] = "générateur"
    composed = admit(payload, now=NOW)
    assert composed.body()["source"]["generator"] == "générateur"
    payload["source"]["generator"] = "ge\u0301ne\u0301rateur"
    assert admit(payload, now=NOW).decision_hash != composed.decision_hash


@pytest.mark.parametrize("invalid", [
    {1: "coerced key"}, {"v": float("nan")}, {"v": float("inf")},
    {"v": "\ud800"}, {"v": b"bytes"}, {"v": (1, 2)},
])
def test_canonical_hash_accepts_only_strict_json_values(invalid):
    with pytest.raises(AcousticImportError):
        I.canonical_hash(invalid)
