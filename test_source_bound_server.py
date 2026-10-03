# Copyright 2026 SZL Holdings — SPDX-License-Identifier: Apache-2.0
"""Byte-backed regression coverage for the source provenance HTTP wrapper."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

import source_bound_server

SOURCE_SHA = "bc69c1d792df63c9c680131c95e8684b61fd9a10"


def build_info(monkeypatch: pytest.MonkeyPatch) -> tuple[int, dict]:
    """Run the real GET handler without opening a socket or minting a receipt."""
    handler = object.__new__(source_bound_server.SourceBoundHandler)
    handler.path = "/api/build-info?probe=1"
    response: list[tuple[int, dict]] = []
    monkeypatch.setattr(handler, "_json", lambda status, payload: response.append((status, payload)))
    handler.do_GET()
    assert len(response) == 1
    return response[0]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (SOURCE_SHA.encode("utf-8"), SOURCE_SHA),
        (("  " + SOURCE_SHA.upper() + "\n").encode("utf-8"), SOURCE_SHA),
        (b"0" * 40, "UNAVAILABLE"),
        (b"", "UNAVAILABLE"),
        (b"f" * 39, "UNAVAILABLE"),
        (b"g" * 40, "UNAVAILABLE"),
        (b"\xff", "UNAVAILABLE"),
    ],
    ids=["valid", "normalized", "zero-placeholder", "empty", "short", "non-hex", "invalid-utf8"],
)
def test_build_info_uses_valid_source_bytes_only(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, raw: bytes, expected: str
) -> None:
    source_file = tmp_path / "SOURCE_GITHUB_SHA"
    source_file.write_bytes(raw)
    monkeypatch.setattr(source_bound_server, "SOURCE_FILE", source_file)

    status, payload = build_info(monkeypatch)

    assert status == 200
    assert payload["schema"] == "szl.nexus-source-binding/v1"
    assert payload["source_revision"] == expected
    assert payload["source_bound"] is (expected != "UNAVAILABLE")


def test_missing_source_has_an_unavailable_binding(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(source_bound_server, "SOURCE_FILE", tmp_path / "SOURCE_GITHUB_SHA")

    status, payload = build_info(monkeypatch)

    assert status == 200
    assert payload["source_revision"] == "UNAVAILABLE"
    assert payload["source_bound"] is False


@pytest.mark.parametrize("raw", [b"0" * 40, b"\xff"], ids=["zero-placeholder", "invalid-utf8"])
def test_selftest_rejects_invalid_present_source(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, raw: bytes
) -> None:
    source_file = tmp_path / "SOURCE_GITHUB_SHA"
    source_file.write_bytes(raw)
    monkeypatch.setattr(source_bound_server, "SOURCE_FILE", source_file)
    monkeypatch.setattr(source_bound_server.server, "selftest", lambda: None)
    monkeypatch.setattr(sys, "argv", ["source_bound_server.py", "--selftest"])

    with pytest.raises(SystemExit, match="invalid SOURCE_GITHUB_SHA"):
        source_bound_server.main()
