#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Source-bound HTTP entrypoint for the NEXUS Hugging Face Space.

The analog runtime remains in ``server.py``.  This wrapper adds one immutable
provenance route and delegates every existing application route unchanged.
``SOURCE_GITHUB_SHA`` is injected by the governed central HF publisher from the
exact GitHub source revision derived from ``space/Dockerfile``.
"""
from __future__ import annotations

import json
import os
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import server

SOURCE_FILE = Path(__file__).with_name("SOURCE_GITHUB_SHA")
SOURCE_REPOSITORY = "szl-holdings/nexus"
HF_REPOSITORY = "SZLHOLDINGS/nexus"


def source_revision() -> str:
    try:
        value = SOURCE_FILE.read_text(encoding="utf-8").strip().lower()
    except OSError:
        return "UNAVAILABLE"
    if len(value) == 40 and all(ch in "0123456789abcdef" for ch in value):
        return value
    return "UNAVAILABLE"


class SourceBoundHandler(server.Handler):
    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/api/build-info":
            revision = source_revision()
            self._json(
                200,
                {
                    "schema": "szl.nexus-source-binding/v1",
                    "source_repository": SOURCE_REPOSITORY,
                    "source_revision": revision,
                    "hf_repository": HF_REPOSITORY,
                    "deployment_authority": "szl-holdings/.github/.github/workflows/publish-nexus-space.yml",
                    "source_bound": revision != "UNAVAILABLE",
                    "energy": "UNAVAILABLE",
                    "uniqueness": "Conjecture 1",
                },
            )
            return
        super().do_GET()


def main() -> None:
    if "--selftest" in os.sys.argv:
        server.selftest()
        revision = source_revision()
        if SOURCE_FILE.is_file() and revision == "UNAVAILABLE":
            raise SystemExit("invalid SOURCE_GITHUB_SHA")
        print("nexus source-bound wrapper selftest ok", flush=True)
        return
    port = int(os.environ.get("PORT", "7860"))
    httpd = ThreadingHTTPServer(("0.0.0.0", port), SourceBoundHandler)
    print(
        f"nexus source-bound hologram listening 0.0.0.0:{port} source={source_revision()}",
        flush=True,
    )
    httpd.serve_forever()


if __name__ == "__main__":
    main()
