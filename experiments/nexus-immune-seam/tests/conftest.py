# SPDX-License-Identifier: Apache-2.0
"""Synthetic fixtures for the UNRATIFIED acoustic importer PROPOSAL.

Every payload here is generated arithmetically (a pure sine table). Nothing is
captured from a microphone, read from a recording, scraped or derived from a
PDF. A pass against these fixtures is FIXTURE_ONLY evidence about the
importer's admission logic, never physical, apparatus or scientific validation.
"""
from __future__ import annotations

import copy
import hashlib
import math
import struct
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

IMPORTER_DIR = Path(__file__).resolve().parents[1]
if str(IMPORTER_DIR) not in sys.path:
    sys.path.insert(0, str(IMPORTER_DIR))

# Injected deterministic clock: no test reads the wall clock.
NOW = datetime(2026, 10, 28, 4, 0, 0, tzinfo=timezone.utc)
SOURCE_REVISION = "0" * 39 + "1"  # synthetic 40-hex generator revision, not a real commit


def sine_channel(frames: int, rate: int, freq: float, amplitude: float, phase: float = 0.0) -> list[float]:
    return [amplitude * math.sin(2 * math.pi * freq * n / rate + phase) for n in range(frames)]


def samples_digest(samples: list[list[float]]) -> str:
    """Test-side restatement of the digest rule: float64 big-endian, channel-major."""
    h = hashlib.sha256()
    for channel in samples:
        for value in channel:
            h.update(struct.pack(">d", value))
    return h.hexdigest()


def build_payload(frames: int = 64, rate: int = 8000, channels: int = 1) -> dict:
    samples = [sine_channel(frames, rate, 440.0 * (c + 1), 0.5, 0.25 * c) for c in range(channels)]
    return {
        "schema": "szl.nexus-immune.acoustic-import/v0-proposal",
        "contractRevision": "PROPOSAL-UNRATIFIED-2026-10-28",
        "recordingId": "syn-tone-0001",
        "source": {
            "kind": "synthetic",
            "generator": "conftest.sine_channel",
            "sourceRevision": SOURCE_REVISION,
        },
        "custody": {
            "custodian": "lane:nexus-chad",
            "acquiredAt": "2026-10-28T03:50:00Z",
            "chain": [
                {"actor": "lane:nexus-chad", "action": "generated", "at": "2026-10-28T03:50:00Z"},
                {"actor": "lane:nexus-chad", "action": "handed_to_importer", "at": "2026-10-28T03:51:00Z"},
            ],
            "samplesSha256": samples_digest(samples),
        },
        "rights": {
            "status": "SYNTHETIC_NO_THIRD_PARTY",
            "holder": "SZL Holdings (synthetic fixture)",
            "basis": "arithmetically generated sine table; no third-party material",
        },
        "units": {"amplitude": "FS", "time": "s", "sampleRate": "Hz"},
        "sampleRateHz": rate,
        "channels": channels,
        "samples": samples,
    }


def rehash(payload: dict) -> dict:
    """Keep the custody digest consistent after a test edits samples."""
    payload["custody"]["samplesSha256"] = samples_digest(payload["samples"])
    return payload


@pytest.fixture
def payload() -> dict:
    return copy.deepcopy(build_payload())


@pytest.fixture
def now() -> datetime:
    return NOW
