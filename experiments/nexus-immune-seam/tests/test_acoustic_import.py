# SPDX-License-Identifier: Apache-2.0
"""UNRATIFIED acoustic importer PROPOSAL: fail-closed, rights-aware admission.

Built against the constraints in the 2026-10-28 master recovery appendix
(line 1606) because the original ``ACOUSTIC_IMPORT_CONTRACT.md`` was not found
in any ref of szl-holdings/nexus or szl-holdings/immune. FIXTURE_ONLY.
"""
from __future__ import annotations

import copy
import math
from datetime import timedelta

import pytest

from acoustic_import import AcousticImportError, admit
from acoustic_import import importer as I
from conftest import NOW, SOURCE_REVISION, build_payload, rehash, samples_digest


def code_of(payload, **kwargs) -> str:
    kwargs.setdefault("now", NOW)
    with pytest.raises(AcousticImportError) as info:
        admit(payload, **kwargs)
    return info.value.code


# --------------------------------------------------------------------------
# Admission and what the record carries
# --------------------------------------------------------------------------


def test_synthetic_fixture_with_stated_rights_is_admitted_fixture_only(payload, now) -> None:
    record = admit(payload, now=now)
    assert record.admitted is True
    assert record.decision == "ADMITTED_FIXTURE_ONLY"
    assert record.reasons == ()
    assert record.evidence_label == "FIXTURE_ONLY"


def test_record_never_claims_physical_eligibility(payload, now) -> None:
    record = admit(payload, now=now)
    assert record.physical_analysis_eligible is False
    assert record.calibration == "MISSING"
    as_dict = record.to_dict()
    assert as_dict["physicalAnalysisEligible"] is False
    assert as_dict["evidenceLabel"] == "FIXTURE_ONLY"


def test_record_carries_custody_units_and_rights(payload, now) -> None:
    out = admit(payload, now=now).to_dict()
    assert out["custody"] == {
        "custodian": "lane:nexus-chad",
        "acquiredAt": "2026-10-28T03:50:00Z",
        "chainLength": 2,
        "samplesSha256": samples_digest(payload["samples"]),
        "digestVerified": True,
    }
    assert out["units"] == {"amplitude": "FS", "time": "s", "sampleRate": "Hz"}
    assert out["rights"] == {
        "status": "SYNTHETIC_NO_THIRD_PARTY",
        "holder": "SZL Holdings (synthetic fixture)",
        "basis": "arithmetically generated sine table; no third-party material",
    }
    assert out["source"] == {"kind": "synthetic", "sourceRevision": SOURCE_REVISION}
    assert (out["sampleRateHz"], out["channels"], out["frames"]) == (8000, 1, 64)
    assert out["durationS"] == 64 / 8000


def test_stereo_fixture_is_admitted(now) -> None:
    record = admit(build_payload(frames=32, channels=2), now=now)
    assert record.admitted and record.channels == 2 and record.frames == 32


@pytest.mark.parametrize("status", ["UNKNOWN", "RESTRICTED"])
def test_unknown_or_restricted_rights_are_recorded_but_not_admitted(payload, now, status) -> None:
    payload["rights"]["status"] = status
    record = admit(payload, now=now)
    assert record.admitted is False
    assert record.decision == "NOT_ADMITTED"
    assert record.reasons == (f"RIGHTS_{status}",)
    # Custody and units are still recorded for a refused import.
    assert record.to_dict()["custody"]["digestVerified"] is True
    assert record.to_dict()["rights"]["status"] == status


def test_admissible_status_without_basis_is_not_admitted(payload, now) -> None:
    payload["rights"]["basis"] = ""
    record = admit(payload, now=now)
    assert record.admitted is False
    assert record.reasons == ("RIGHTS_BASIS_MISSING",)


def test_unrecognised_rights_status_fails_closed(payload) -> None:
    payload["rights"]["status"] = "PROBABLY_FINE"
    assert code_of(payload) == "INVALID_RIGHTS"


def test_decision_is_deterministic_and_hash_bound(payload, now) -> None:
    first = admit(copy.deepcopy(payload), now=now)
    second = admit(copy.deepcopy(payload), now=now)
    assert first == second
    assert len(first.decision_hash) == 64
    payload["rights"]["status"] = "UNKNOWN"
    assert admit(payload, now=now).decision_hash != first.decision_hash


def test_decision_hash_is_not_presented_as_a_signature(payload, now) -> None:
    out = admit(payload, now=now).to_dict()
    assert out["decisionHashKind"] == "sha256-canonical-json-unsigned"
    assert "signature" not in out


# --------------------------------------------------------------------------
# Malformed input
# --------------------------------------------------------------------------


@pytest.mark.parametrize("bad", [None, [], "payload", 7, True])
def test_non_object_payload(bad) -> None:
    assert code_of(bad) == "INVALID_REQUEST"


@pytest.mark.parametrize("field", list(I.REQUIRED_FIELDS))
def test_missing_top_level_field(payload, field) -> None:
    del payload[field]
    assert code_of(payload) == "MISSING_FIELD"


def test_unsupported_top_level_field(payload) -> None:
    payload["calibration"] = {"sensitivity": 1.0}
    assert code_of(payload) == "UNSUPPORTED_FIELD"


@pytest.mark.parametrize("block", ["source", "custody", "rights", "units"])
def test_unsupported_nested_field(payload, block) -> None:
    payload[block]["extra"] = "x"
    assert code_of(payload) == "UNSUPPORTED_FIELD"


@pytest.mark.parametrize("block", ["source", "custody", "rights", "units"])
def test_nested_block_must_be_object(payload, block) -> None:
    payload[block] = ["not", "an", "object"]
    assert code_of(payload) == "INVALID_REQUEST"


@pytest.mark.parametrize("bad_id", ["", "short", "has space-0001", "-leading-dash", "x" * 129, 12345678])
def test_invalid_recording_id(payload, bad_id) -> None:
    payload["recordingId"] = bad_id
    assert code_of(payload) == "INVALID_RECORDING_ID"


def test_samples_must_be_list_of_channels(payload) -> None:
    payload["samples"] = [0.1, 0.2]
    assert code_of(payload) == "INVALID_SAMPLES"


def test_channel_count_must_match_declared(payload) -> None:
    payload["channels"] = 2
    assert code_of(payload) == "INVALID_SAMPLES"


def test_ragged_channels_rejected(now) -> None:
    payload = build_payload(frames=16, channels=2)
    payload["samples"][1] = payload["samples"][1][:-1]
    assert code_of(rehash(payload)) == "INVALID_SAMPLES"


def test_empty_channel_rejected(payload) -> None:
    payload["samples"] = [[]]
    assert code_of(rehash(payload)) == "OUT_OF_RANGE"


@pytest.mark.parametrize("bad", ["0.1", True, None, [0.1], {"v": 0.1}])
def test_sample_must_be_a_json_number(payload, bad) -> None:
    payload["samples"][0][3] = bad
    assert code_of(payload) == "NON_FINITE_NUMBER"


@pytest.mark.parametrize("bad", ["8000", 8000.5, True, None])
def test_sample_rate_must_be_an_integer(payload, bad) -> None:
    payload["sampleRateHz"] = bad
    assert code_of(payload) == "OUT_OF_RANGE"


# --------------------------------------------------------------------------
# Non-finite input
# --------------------------------------------------------------------------


@pytest.mark.parametrize("bad", [math.nan, math.inf, -math.inf])
def test_non_finite_sample_rejected(payload, bad) -> None:
    payload["samples"][0][5] = bad
    assert code_of(payload) == "NON_FINITE_NUMBER"


@pytest.mark.parametrize("bad", [math.nan, math.inf])
def test_non_finite_sample_rate_rejected(payload, bad) -> None:
    payload["sampleRateHz"] = bad
    assert code_of(payload) == "OUT_OF_RANGE"


# --------------------------------------------------------------------------
# Out-of-range input
# --------------------------------------------------------------------------


@pytest.mark.parametrize("bad", [1.0000001, -1.0000001, 2.0, -40.0])
def test_sample_outside_full_scale_rejected(payload, bad) -> None:
    payload["samples"][0][0] = bad
    assert code_of(rehash(payload)) == "OUT_OF_RANGE"


@pytest.mark.parametrize("edge", [1.0, -1.0, 0.0])
def test_full_scale_edges_admitted(payload, now, edge) -> None:
    payload["samples"][0][0] = edge
    assert admit(rehash(payload), now=now).admitted is True


@pytest.mark.parametrize("rate", [I.SAMPLE_RATE_MIN - 1, I.SAMPLE_RATE_MAX + 1, 0, -8000])
def test_sample_rate_out_of_range(payload, rate) -> None:
    payload["sampleRateHz"] = rate
    assert code_of(payload) == "OUT_OF_RANGE"


@pytest.mark.parametrize("rate", [I.SAMPLE_RATE_MIN, I.SAMPLE_RATE_MAX])
def test_sample_rate_edges_admitted(now, rate) -> None:
    assert admit(build_payload(frames=8, rate=rate), now=now).admitted is True


@pytest.mark.parametrize("channels", [0, I.CHANNELS_MAX + 1])
def test_channel_count_out_of_range(payload, channels) -> None:
    payload["channels"] = channels
    assert code_of(payload) == "OUT_OF_RANGE"


def test_frame_count_above_bound_rejected_before_element_scan(payload) -> None:
    # One oversized channel of zeros; the bound must trip on length alone.
    payload["samples"] = [[0.0] * (I.MAX_FRAMES + 1)]
    assert code_of(payload) == "OUT_OF_RANGE"


def test_future_acquisition_time_rejected(payload) -> None:
    payload["custody"]["acquiredAt"] = "2026-10-28T04:00:01Z"
    assert code_of(payload) == "FUTURE_TIMESTAMP"


def test_acquisition_time_equal_to_now_admitted(payload, now) -> None:
    payload["custody"]["acquiredAt"] = "2026-10-28T04:00:00Z"
    payload["custody"]["chain"] = [{"actor": "lane:nexus-chad", "action": "generated", "at": "2026-10-28T04:00:00Z"}]
    assert admit(payload, now=now).admitted is True


def test_future_chain_entry_rejected(payload) -> None:
    payload["custody"]["chain"][1]["at"] = "2026-10-29T00:00:00Z"
    assert code_of(payload) == "FUTURE_TIMESTAMP"


def test_naive_clock_is_refused(payload) -> None:
    assert code_of(payload, now=NOW.replace(tzinfo=None)) == "INVALID_CLOCK"


# --------------------------------------------------------------------------
# Version and revision mismatch
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "schema", ["szl.nexus-immune.acoustic-import/v1", "szl.nexus-immune.acoustic-import/v0", "", None]
)
def test_schema_version_mismatch(payload, schema) -> None:
    payload["schema"] = schema
    assert code_of(payload) == "VERSION_MISMATCH"


def test_contract_revision_mismatch(payload) -> None:
    payload["contractRevision"] = "PROPOSAL-UNRATIFIED-2026-10-27"
    assert code_of(payload) == "VERSION_MISMATCH"


def test_pinned_source_revision_mismatch(payload) -> None:
    assert code_of(payload, expected_source_revision="f" * 40) == "REVISION_MISMATCH"


def test_pinned_source_revision_match_admitted(payload, now) -> None:
    assert admit(payload, now=now, expected_source_revision=SOURCE_REVISION).admitted is True


@pytest.mark.parametrize("rev", ["", "abc123", "G" * 40, "A" * 40, None, 7])
def test_source_revision_must_be_full_lowercase_sha(payload, rev) -> None:
    payload["source"]["sourceRevision"] = rev
    assert code_of(payload) == "INVALID_REVISION"


# --------------------------------------------------------------------------
# Unsupported source material and units
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "kind", ["recording", "microphone_capture", "scraped", "pdf_extract", "unknown", "", None]
)
def test_only_synthetic_source_material_is_supported(payload, kind) -> None:
    payload["source"]["kind"] = kind
    assert code_of(payload) == "UNSUPPORTED_SOURCE"


def test_synthetic_source_must_name_its_generator(payload) -> None:
    payload["source"]["generator"] = ""
    assert code_of(payload) == "UNSUPPORTED_SOURCE"


@pytest.mark.parametrize("unit", ["Pa", "dB SPL", "V", "", None])
def test_physical_amplitude_units_unsupported_without_calibration(payload, unit) -> None:
    payload["units"]["amplitude"] = unit
    assert code_of(payload) == "UNSUPPORTED_UNIT"


@pytest.mark.parametrize(("key", "unit"), [("time", "ms"), ("sampleRate", "kHz")])
def test_time_base_units_are_fixed(payload, key, unit) -> None:
    payload["units"][key] = unit
    assert code_of(payload) == "UNSUPPORTED_UNIT"


# --------------------------------------------------------------------------
# Custody
# --------------------------------------------------------------------------


def test_custody_digest_mismatch_rejected(payload) -> None:
    payload["samples"][0][1] = 0.0  # tampered after the custodian hashed it
    assert code_of(payload) == "DIGEST_MISMATCH"


@pytest.mark.parametrize("digest", ["", "0" * 63, "Z" * 64, "A" * 64, None])
def test_custody_digest_must_be_lowercase_sha256(payload, digest) -> None:
    payload["custody"]["samplesSha256"] = digest
    assert code_of(payload) == "INVALID_CUSTODY"


def test_empty_custody_chain_rejected(payload) -> None:
    payload["custody"]["chain"] = []
    assert code_of(payload) == "INVALID_CUSTODY"


def test_custody_chain_must_be_time_ordered(payload) -> None:
    payload["custody"]["chain"][1]["at"] = "2026-10-28T03:49:00Z"
    assert code_of(payload) == "INVALID_CUSTODY"


def test_custody_chain_cannot_start_before_acquisition(payload) -> None:
    payload["custody"]["chain"][0]["at"] = "2026-10-28T03:40:00Z"
    assert code_of(payload) == "INVALID_CUSTODY"


@pytest.mark.parametrize("field", ["actor", "action", "at"])
def test_custody_chain_entry_fields_required(payload, field) -> None:
    del payload["custody"]["chain"][0][field]
    assert code_of(payload) == "INVALID_CUSTODY"


def test_custody_chain_entry_extra_field_rejected(payload) -> None:
    payload["custody"]["chain"][0]["note"] = "x"
    assert code_of(payload) == "UNSUPPORTED_FIELD"


@pytest.mark.parametrize(
    "stamp", ["2026-10-28 03:50:00", "2026-10-28T03:50:00", "2026-10-28T03:50:00+02:00", "yesterday", "", 1730000000]
)
def test_custody_timestamps_must_be_utc_z(payload, stamp) -> None:
    payload["custody"]["acquiredAt"] = stamp
    assert code_of(payload) == "INVALID_TIMESTAMP"


def test_empty_custodian_rejected(payload) -> None:
    payload["custody"]["custodian"] = ""
    assert code_of(payload) == "INVALID_CUSTODY"


def test_clock_is_injected_not_read(payload, now) -> None:
    # A clock one day later still admits; a clock before acquisition refuses.
    assert admit(payload, now=now + timedelta(days=1)).admitted is True
    assert code_of(payload, now=now - timedelta(hours=1)) == "FUTURE_TIMESTAMP"
