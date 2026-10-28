#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""HTTP server for the Python-only NEXUS Space runtime.

Serves the prerendered browser workstation from a static directory and answers
the read-only runtime API (/api/build-info, /health, /healthz, /api/probes).
Response codes and headers follow what the previous Nitro runtime sent: unknown
paths and non-GET methods are 404 HTML, hashed /assets/* are immutable. It mints
no receipts, holds no credentials and has no external effectors.
"""
from __future__ import annotations

import mimetypes
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import nexus_runtime as rt  # noqa: E402

API_JSON_HEADERS = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
}
IMMUTABLE = "public, max-age=31536000, immutable"


class NexusHandler(BaseHTTPRequestHandler):
    server_version = "nexus"
    sys_version = ""

    def do_GET(self) -> None:  # noqa: N802
        self._respond(*self._route(), head=False)

    def do_HEAD(self) -> None:  # noqa: N802
        self._respond(*self._route(), head=True)

    def _fall_through(self) -> None:
        self._respond(*self._not_found(), head=False)

    do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = _fall_through

    def _route(self) -> tuple[int, dict[str, str], bytes]:
        path = urlsplit(self.path).path
        if path == "/api/build-info":
            return 200, dict(API_JSON_HEADERS), rt.dumps(rt.build_info(self._revision()))
        if path in ("/health", "/healthz"):
            return 200, dict(API_JSON_HEADERS), rt.dumps(rt.runtime_health(self._revision()))
        if path == "/api/probes":
            return 200, {"content-type": "application/json"}, rt.dumps(rt.probe_estate())
        return self._static(path)

    def _revision(self) -> str:
        return rt.read_source_revision(self.server.source_file)

    def _static(self, path: str) -> tuple[int, dict[str, str], bytes]:
        root: Path = self.server.static_dir
        relative = "index.html" if path == "/" else unquote(path).lstrip("/")
        if "\x00" in relative:
            return self._not_found()
        candidate = (root / relative).resolve()
        if not candidate.is_relative_to(root) or not candidate.is_file():
            return self._not_found()
        headers = {"content-type": _content_type(candidate)}
        if candidate.is_relative_to(root / "assets"):
            headers["cache-control"] = IMMUTABLE
        return 200, headers, candidate.read_bytes()

    def _not_found(self) -> tuple[int, dict[str, str], bytes]:
        index = self.server.static_dir / "index.html"
        body = index.read_bytes() if index.is_file() else b"Not Found"
        return 404, {"content-type": "text/html; charset=utf-8"}, body

    def _respond(self, status: int, headers: dict[str, str], body: bytes, head: bool) -> None:
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.send_header("x-content-type-options", "nosniff")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        if not head:
            self.wfile.write(body)


def _content_type(path: Path) -> str:
    kind = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return f"{kind}; charset=utf-8" if kind.startswith("text/") else kind


def make_server(host: str, port: int, static_dir: Path, source_file: Path) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((host, port), NexusHandler)
    server.daemon_threads = True
    server.static_dir = Path(static_dir).resolve()
    server.source_file = Path(source_file)
    return server


def main() -> int:
    server = make_server(
        os.environ.get("HOST", "0.0.0.0"),
        int(os.environ.get("PORT", "7860")),
        Path(os.environ.get("NEXUS_STATIC_DIR", "/app/static")),
        Path(os.environ.get("SOURCE_GITHUB_SHA_FILE", "/app/SOURCE_GITHUB_SHA")),
    )
    print(f"nexus runtime listening on {server.server_address[0]}:{server.server_address[1]}", flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
