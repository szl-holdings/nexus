#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Runtime payloads for the Python-served NEXUS Space.

Byte-for-byte port of ``src/lib/nexus/source-identity.ts``. The parity test
``scripts/space-runtime-parity.test.mjs`` runs both implementations on the same
inputs, so any change here must be made in the TypeScript source as well.
"""
from __future__ import annotations

import json
import os
import re
import sys

SOURCE_REPOSITORY = "szl-holdings/nexus"
HF_REPOSITORY = "SZLHOLDINGS/nexus"
DEPLOYMENT_AUTHORITY = "szl-holdings/.github/.github/workflows/publish-nexus-space.yml"
UNAVAILABLE = "UNAVAILABLE"
RUNTIME = "PYTHON_STDLIB_STATIC_WEB_AUDIO"

_EXACT_GIT_REVISION = re.compile(r"[0-9a-f]{40}")
_ZERO_REVISION = "0" * 40
# String.prototype.trim(): ECMAScript WhiteSpace plus LineTerminator. Differs from
# str.strip(), which keeps U+FEFF and also removes U+001C..U+001F and U+0085.
_JS_TRIM = (
    "\t\n\v\f\r          "
    "        　﻿"
)


def normalize_source_revision(raw: object) -> str:
    value = ("" if raw is None else str(raw)).strip(_JS_TRIM).lower()
    if not _EXACT_GIT_REVISION.fullmatch(value) or value == _ZERO_REVISION:
        return UNAVAILABLE
    return value


def read_source_revision(path: str | os.PathLike[str]) -> str:
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.read()
    except OSError:
        return UNAVAILABLE


def build_info(raw_revision: object) -> dict:
    source_revision = normalize_source_revision(raw_revision)
    return {
        "schema": "szl.nexus-source-binding/v2",
        "source_repository": SOURCE_REPOSITORY,
        "source_revision": source_revision,
        "hf_repository": HF_REPOSITORY,
        "deployment_authority": DEPLOYMENT_AUTHORITY,
        "source_bound": source_revision != UNAVAILABLE,
        "runtime": RUNTIME,
        "frontend": "REACT_TANSTACK_WEB_AUDIO",
        "audio_execution": "BROWSER_LOCAL_USER_GESTURE",
        "deterministic_python_reference": "SOURCE_ONLY",
        "energy": UNAVAILABLE,
        "uniqueness": "Conjecture 1",
    }


def runtime_health(raw_revision: object) -> dict:
    info = build_info(raw_revision)
    return {
        "schema": "szl.nexus-runtime-health/v1",
        "ok": True,
        "status": "ok" if info["source_bound"] else "degraded",
        "ready": info["source_bound"],
        "service": "nexus",
        "source_repository": info["source_repository"],
        "source_revision": info["source_revision"],
        "source_bound": info["source_bound"],
        "runtime": info["runtime"],
        "frontend": info["frontend"],
        "audio": "USER_GESTURE_REQUIRED",
        "state_storage": "BROWSER_INDEXEDDB",
        "accounts_required": False,
        "external_effectors": False,
        "energy": info["energy"],
        "uniqueness": info["uniqueness"],
    }


def dumps(payload: object) -> bytes:
    """Serialize like JavaScript ``JSON.stringify`` for these payloads."""
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def main(argv: list[str]) -> int:
    commands = {"build-info": build_info, "health": runtime_health}
    if len(argv) != 2 or argv[0] not in commands:
        print("usage: nexus_runtime.py build-info|health <revision>", file=sys.stderr)
        return 2
    sys.stdout.buffer.write(dumps(commands[argv[0]](argv[1])))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
