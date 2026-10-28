# SPDX-License-Identifier: Apache-2.0
"""UNRATIFIED acoustic importer PROPOSAL for the Nexus/Immune seam.

Status: PROPOSAL. The original ``experiments/nexus-immune-seam/
ACOUSTIC_IMPORT_CONTRACT.md`` was not present in any ref of
``szl-holdings/nexus`` or ``szl-holdings/immune`` (searched 2026-10-28 UTC), so
this draft is built against the owner constraints in the 2026-10-28 master
recovery appendix instead:

* reject malformed, non-finite and out-of-range inputs;
* reject schema-version / contract-revision / pinned source-revision mismatch;
* reject unsupported source material (only arithmetic ``synthetic`` input is
  supported, because actual recordings, calibration, metadata, rights and the
  measurement procedure are missing);
* record custody, units and rights status; rights UNKNOWN (or RESTRICTED, or an
  admissible status with no stated basis) is recorded but NOT admitted.

Structural, version, custody and source-material failures raise a typed
:class:`AcousticImportError`. A structurally valid payload always yields an
:class:`ImportDecision`, admitted or not. Every admitted decision is
``FIXTURE_ONLY`` with ``physicalAnalysisEligible`` false: an admission is not a
recording, a calibration, apparatus proof or a scientific claim. The decision
hash is an unsigned canonical-JSON SHA-256, not a signature or receipt.

Stdlib only, like ``nexus_dynamics``. The clock is injected; nothing here reads
the wall clock, the network or the filesystem.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import struct
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping

from .errors import (
    DIGEST_MISMATCH,
    FUTURE_TIMESTAMP,
    INVALID_CLOCK,
    INVALID_CUSTODY,
    INVALID_RECORDING_ID,
    INVALID_REQUEST,
    INVALID_REVISION,
    INVALID_RIGHTS,
    INVALID_SAMPLES,
    INVALID_TIMESTAMP,
    MISSING_FIELD,
    NON_FINITE_NUMBER,
    OUT_OF_RANGE,
    REVISION_MISMATCH,
    UNSUPPORTED_FIELD,
    UNSUPPORTED_SOURCE,
    UNSUPPORTED_UNIT,
    VERSION_MISMATCH,
    AcousticImportError,
)

CONTRACT_STATUS = "PROPOSAL_UNRATIFIED"
SCHEMA = "szl.nexus-immune.acoustic-import/v0-proposal"
CONTRACT_REVISION = "PROPOSAL-UNRATIFIED-2026-10-28"
DECISION_SCHEMA = "szl.nexus-immune.acoustic-import-decision/v0-proposal"
DECISION_HASH_KIND = "sha256-canonical-json-unsigned"
EVIDENCE_LABEL = "FIXTURE_ONLY"
CALIBRATION_STATE = "MISSING"

REQUIRED_FIELDS: tuple[str, ...] = (
    "schema",
    "contractRevision",
    "recordingId",
    "source",
    "custody",
    "rights",
    "units",
    "sampleRateHz",
    "channels",
    "samples",
)
SOURCE_FIELDS: tuple[str, ...] = ("kind", "generator", "sourceRevision")
CUSTODY_FIELDS: tuple[str, ...] = ("custodian", "acquiredAt", "chain", "samplesSha256")
CHAIN_FIELDS: tuple[str, ...] = ("actor", "action", "at")
RIGHTS_FIELDS: tuple[str, ...] = ("status", "holder", "basis")
UNITS_FIELDS: tuple[str, ...] = ("amplitude", "time", "sampleRate")

SUPPORTED_SOURCE_KINDS: tuple[str, ...] = ("synthetic",)
# Amplitude is dimensionless full scale. Physical units (Pa, dB SPL, V) need a
# calibration chain that does not exist yet, so they are refused, not guessed.
UNITS: dict[str, str] = {"amplitude": "FS", "time": "s", "sampleRate": "Hz"}
AMPLITUDE_MIN = -1.0
AMPLITUDE_MAX = 1.0

RIGHTS_STATUSES: tuple[str, ...] = ("SYNTHETIC_NO_THIRD_PARTY", "OWNED", "LICENSED", "RESTRICTED", "UNKNOWN")
ADMISSIBLE_RIGHTS: tuple[str, ...] = ("SYNTHETIC_NO_THIRD_PARTY", "OWNED", "LICENSED")

SAMPLE_RATE_MIN = 8_000
SAMPLE_RATE_MAX = 192_000
CHANNELS_MIN = 1
CHANNELS_MAX = 2
MIN_FRAMES = 1
MAX_FRAMES = 1 << 20
TEXT_MAX_LENGTH = 256
RECORDING_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$"
REVISION_PATTERN = r"^[0-9a-f]{40}$"
SHA256_PATTERN = r"^[0-9a-f]{64}$"
TIMESTAMP_PATTERN = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$"

_RECORDING_ID_RE = re.compile(RECORDING_ID_PATTERN)
_REVISION_RE = re.compile(REVISION_PATTERN)
_SHA256_RE = re.compile(SHA256_PATTERN)
_TIMESTAMP_RE = re.compile(TIMESTAMP_PATTERN)


# --------------------------------------------------------------------------
# Primitive checks (same JSON-number discipline as nexus_dynamics.schema)
# --------------------------------------------------------------------------


def finite_number(name: str, value: Any) -> float:
    """A JSON number (never a bool or a numeric string) that is finite."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise AcousticImportError(NON_FINITE_NUMBER, f"{name} must be a JSON number")
    number = float(value)
    if not math.isfinite(number):
        raise AcousticImportError(NON_FINITE_NUMBER, f"{name} must be finite")
    return number


def integer_in_range(name: str, value: Any, minimum: int, maximum: int) -> int:
    message = f"{name} must be an integer between {minimum} and {maximum}"
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise AcousticImportError(OUT_OF_RANGE, message)
    if isinstance(value, float) and (not math.isfinite(value) or not value.is_integer()):
        raise AcousticImportError(OUT_OF_RANGE, message)
    number = int(value)
    if number < minimum or number > maximum:
        raise AcousticImportError(OUT_OF_RANGE, message)
    return number


def _object(name: str, value: Any, fields: tuple[str, ...], missing_code: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise AcousticImportError(INVALID_REQUEST, f"{name} must be an object")
    extras = sorted(set(value) - set(fields))
    if extras:
        raise AcousticImportError(UNSUPPORTED_FIELD, f"unsupported {name} fields: {extras}")
    missing = [key for key in fields if key not in value]
    if missing:
        raise AcousticImportError(missing_code, f"{name} missing required fields: {missing}")
    return value


def _text(value: Any, code: str, name: str, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str) or len(value) > TEXT_MAX_LENGTH or (not allow_empty and not value):
        raise AcousticImportError(code, f"{name} must be a {'' if allow_empty else 'non-empty '}string")
    return value


def _timestamp(name: str, value: Any, now: datetime) -> datetime:
    if not isinstance(value, str) or not _TIMESTAMP_RE.match(value):
        raise AcousticImportError(INVALID_TIMESTAMP, f"{name} must be UTC 'YYYY-MM-DDTHH:MM:SSZ'")
    try:
        stamp = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError as exc:
        raise AcousticImportError(INVALID_TIMESTAMP, f"{name} is not a calendar time") from exc
    if stamp > now:
        raise AcousticImportError(FUTURE_TIMESTAMP, f"{name} is later than the injected clock")
    return stamp


def samples_sha256(samples: tuple[tuple[float, ...], ...]) -> str:
    """SHA-256 over IEEE-754 float64 big-endian values, channel-major."""
    digest = hashlib.sha256()
    for channel in samples:
        for value in channel:
            digest.update(struct.pack(">d", value))
    return digest.hexdigest()


def canonical_hash(payload: Mapping[str, Any]) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------
# Section parsers
# --------------------------------------------------------------------------


def _parse_source(value: Any, expected_source_revision: str | None) -> tuple[str, str]:
    source = _object("source", value, SOURCE_FIELDS, MISSING_FIELD)
    kind = source["kind"]
    if not isinstance(kind, str) or kind not in SUPPORTED_SOURCE_KINDS:
        raise AcousticImportError(
            UNSUPPORTED_SOURCE,
            f"source.kind {kind!r} is not supported; only {list(SUPPORTED_SOURCE_KINDS)} until recordings, "
            "calibration, rights and procedure exist",
        )
    _text(source["generator"], UNSUPPORTED_SOURCE, "source.generator")
    revision = source["sourceRevision"]
    if not isinstance(revision, str) or not _REVISION_RE.match(revision):
        raise AcousticImportError(INVALID_REVISION, "source.sourceRevision must be a 40-char lowercase git sha")
    if expected_source_revision is not None and revision != expected_source_revision:
        raise AcousticImportError(REVISION_MISMATCH, "source.sourceRevision does not match the pinned revision")
    return kind, revision


def _parse_units(value: Any) -> None:
    units = _object("units", value, UNITS_FIELDS, MISSING_FIELD)
    for key, expected in UNITS.items():
        if units[key] != expected:
            raise AcousticImportError(
                UNSUPPORTED_UNIT, f"units.{key} must be {expected!r}; physical units need calibration (MISSING)"
            )


def _parse_samples(value: Any, channels: int) -> tuple[tuple[float, ...], ...]:
    if not isinstance(value, list) or not all(isinstance(channel, list) for channel in value):
        raise AcousticImportError(INVALID_SAMPLES, "samples must be a list of per-channel lists")
    if len(value) != channels:
        raise AcousticImportError(INVALID_SAMPLES, f"samples has {len(value)} channels, declared {channels}")
    frames = len(value[0])
    if any(len(channel) != frames for channel in value):
        raise AcousticImportError(INVALID_SAMPLES, "channels must have equal length")
    # Bound on length alone, before touching any element.
    if frames < MIN_FRAMES or frames > MAX_FRAMES:
        raise AcousticImportError(OUT_OF_RANGE, f"frames must be between {MIN_FRAMES} and {MAX_FRAMES}")
    out = []
    for c, channel in enumerate(value):
        parsed = []
        for n, raw in enumerate(channel):
            number = finite_number(f"samples[{c}][{n}]", raw)
            if number < AMPLITUDE_MIN or number > AMPLITUDE_MAX:
                raise AcousticImportError(
                    OUT_OF_RANGE, f"samples[{c}][{n}] outside full scale [{AMPLITUDE_MIN}, {AMPLITUDE_MAX}]"
                )
            parsed.append(number)
        out.append(tuple(parsed))
    return tuple(out)


def _parse_custody(value: Any, samples: tuple[tuple[float, ...], ...], now: datetime) -> tuple[str, str, int, str]:
    custody = _object("custody", value, CUSTODY_FIELDS, INVALID_CUSTODY)
    custodian = _text(custody["custodian"], INVALID_CUSTODY, "custody.custodian")
    acquired = _timestamp("custody.acquiredAt", custody["acquiredAt"], now)
    chain = custody["chain"]
    if not isinstance(chain, list) or not chain:
        raise AcousticImportError(INVALID_CUSTODY, "custody.chain must be a non-empty list")
    previous = acquired
    for index, raw in enumerate(chain):
        entry = _object(f"custody.chain[{index}]", raw, CHAIN_FIELDS, INVALID_CUSTODY)
        _text(entry["actor"], INVALID_CUSTODY, f"custody.chain[{index}].actor")
        _text(entry["action"], INVALID_CUSTODY, f"custody.chain[{index}].action")
        at = _timestamp(f"custody.chain[{index}].at", entry["at"], now)
        if at < previous:
            raise AcousticImportError(
                INVALID_CUSTODY, f"custody.chain[{index}] precedes acquisition or the previous entry"
            )
        previous = at
    stated = custody["samplesSha256"]
    if not isinstance(stated, str) or not _SHA256_RE.match(stated):
        raise AcousticImportError(INVALID_CUSTODY, "custody.samplesSha256 must be 64 lowercase hex")
    if samples_sha256(samples) != stated:
        raise AcousticImportError(DIGEST_MISMATCH, "samples do not match the custodian's digest")
    return custodian, custody["acquiredAt"], len(chain), stated


def _parse_rights(value: Any) -> tuple[str, str, str]:
    rights = _object("rights", value, RIGHTS_FIELDS, MISSING_FIELD)
    status = rights["status"]
    if not isinstance(status, str) or status not in RIGHTS_STATUSES:
        raise AcousticImportError(INVALID_RIGHTS, f"rights.status must be one of {list(RIGHTS_STATUSES)}")
    holder = _text(rights["holder"], INVALID_RIGHTS, "rights.holder", allow_empty=True)
    basis = _text(rights["basis"], INVALID_RIGHTS, "rights.basis", allow_empty=True)
    return status, holder, basis


def _refusal_reasons(status: str, basis: str) -> tuple[str, ...]:
    if status not in ADMISSIBLE_RIGHTS:
        return (f"RIGHTS_{status}",)
    if not basis.strip():
        return ("RIGHTS_BASIS_MISSING",)
    return ()


# --------------------------------------------------------------------------
# Decision
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class ImportDecision:
    """What the importer decided and the custody/units/rights it recorded."""

    recording_id: str
    admitted: bool
    reasons: tuple[str, ...]
    source_kind: str
    source_revision: str
    custodian: str
    acquired_at: str
    chain_length: int
    samples_sha256: str
    rights_status: str
    rights_holder: str
    rights_basis: str
    sample_rate_hz: int
    channels: int
    frames: int
    decision_hash: str = ""

    @property
    def decision(self) -> str:
        return "ADMITTED_FIXTURE_ONLY" if self.admitted else "NOT_ADMITTED"

    @property
    def evidence_label(self) -> str:
        return EVIDENCE_LABEL

    @property
    def physical_analysis_eligible(self) -> bool:
        return False

    @property
    def calibration(self) -> str:
        return CALIBRATION_STATE

    def body(self) -> dict[str, Any]:
        return {
            "schema": DECISION_SCHEMA,
            "contractStatus": CONTRACT_STATUS,
            "contractRevision": CONTRACT_REVISION,
            "recordingId": self.recording_id,
            "admitted": self.admitted,
            "decision": self.decision,
            "reasons": list(self.reasons),
            "evidenceLabel": self.evidence_label,
            "physicalAnalysisEligible": self.physical_analysis_eligible,
            "calibration": self.calibration,
            "source": {"kind": self.source_kind, "sourceRevision": self.source_revision},
            "custody": {
                "custodian": self.custodian,
                "acquiredAt": self.acquired_at,
                "chainLength": self.chain_length,
                "samplesSha256": self.samples_sha256,
                "digestVerified": True,
            },
            "units": dict(UNITS),
            "rights": {"status": self.rights_status, "holder": self.rights_holder, "basis": self.rights_basis},
            "sampleRateHz": self.sample_rate_hz,
            "channels": self.channels,
            "frames": self.frames,
            "durationS": self.frames / self.sample_rate_hz,
            "decisionHashKind": DECISION_HASH_KIND,
        }

    def to_dict(self) -> dict[str, Any]:
        out = self.body()
        out["decisionHash"] = self.decision_hash
        return out


def admit(payload: Any, *, now: datetime, expected_source_revision: str | None = None) -> ImportDecision:
    """Validate one synthetic acoustic payload and return the admission decision.

    ``now`` must be a timezone-aware clock supplied by the caller.
    ``expected_source_revision`` optionally pins the producer revision.
    """
    if not isinstance(now, datetime) or now.tzinfo is None or now.utcoffset() is None:
        raise AcousticImportError(INVALID_CLOCK, "now must be a timezone-aware datetime")
    now = now.astimezone(timezone.utc)
    if not isinstance(payload, Mapping):
        raise AcousticImportError(INVALID_REQUEST, "payload must be an object")
    _object("payload", payload, REQUIRED_FIELDS, MISSING_FIELD)
    if payload["schema"] != SCHEMA:
        raise AcousticImportError(VERSION_MISMATCH, f"schema must be {SCHEMA!r}")
    if payload["contractRevision"] != CONTRACT_REVISION:
        raise AcousticImportError(VERSION_MISMATCH, f"contractRevision must be {CONTRACT_REVISION!r}")
    recording_id = payload["recordingId"]
    if not isinstance(recording_id, str) or not _RECORDING_ID_RE.match(recording_id):
        raise AcousticImportError(INVALID_RECORDING_ID, f"recordingId must match {RECORDING_ID_PATTERN}")
    kind, revision = _parse_source(payload["source"], expected_source_revision)
    _parse_units(payload["units"])
    rate = integer_in_range("sampleRateHz", payload["sampleRateHz"], SAMPLE_RATE_MIN, SAMPLE_RATE_MAX)
    channels = integer_in_range("channels", payload["channels"], CHANNELS_MIN, CHANNELS_MAX)
    samples = _parse_samples(payload["samples"], channels)
    custodian, acquired_at, chain_length, digest = _parse_custody(payload["custody"], samples, now)
    status, holder, basis = _parse_rights(payload["rights"])
    reasons = _refusal_reasons(status, basis)
    decision = ImportDecision(
        recording_id=recording_id,
        admitted=not reasons,
        reasons=reasons,
        source_kind=kind,
        source_revision=revision,
        custodian=custodian,
        acquired_at=acquired_at,
        chain_length=chain_length,
        samples_sha256=digest,
        rights_status=status,
        rights_holder=holder,
        rights_basis=basis,
        sample_rate_hz=rate,
        channels=channels,
        frames=len(samples[0]),
    )
    return ImportDecision(**{**decision.__dict__, "decision_hash": canonical_hash(decision.body())})
