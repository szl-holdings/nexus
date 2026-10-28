# SPDX-License-Identifier: Apache-2.0
"""Python port of probeEstate() from src/lib/nexus/telemetry.ts."""
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

import nexus_runtime as rt

ROUTES = {
    "/ok": (200, b'{"status":"ok"}'),
    "/evidence": (200, b'{"evidenceState":"X"}'),
    "/sdk": (200, b'{"sdk":"docker"}'),
    "/text": (200, b"not json"),
    "/null": (200, b"null"),
    "/array": (200, b"[1,2]"),
    "/nan": (200, b"NaN"),
    "/missing": (404, b"nope"),
    "/broken": (500, b"{}"),
    "/role-live": (200, b'{"role":"hologram-not-instrument","energy":"UNAVAILABLE"}'),
    "/role-empty": (200, b"{}"),
}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        if self.path == "/slow":
            time.sleep(0.6)
            status, body = 200, b'{"status":"late"}'
        else:
            status, body = ROUTES[self.path]
        self.send_response(status)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


@pytest.fixture(scope="module")
def base():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


def closed_port_url():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return f"http://127.0.0.1:{sock.getsockname()[1]}/"


def one(base, path, endpoint_id="hatun", timeout_s=2.0):
    url = path if path.startswith("http") else base + path
    [probe] = rt.probe_estate(timeout_s, [{"id": endpoint_id, "label": "L", "url": url}])
    assert list(probe) == ["id", "label", "status", "detail", "at"]
    assert isinstance(probe["at"], int)
    return probe["status"], probe["detail"]


@pytest.mark.parametrize(
    "path,expected",
    [
        ("/ok", ("LIVE", "ok")),
        ("/evidence", ("LIVE", "X")),
        ("/sdk", ("LIVE", "docker")),
        ("/text", ("LIVE", "HTTP 200")),
        ("/null", ("LIVE", "HTTP 200")),
        ("/array", ("LIVE", "HTTP 200")),
        ("/nan", ("LIVE", "HTTP 200")),
        ("/missing", ("UNAVAILABLE", "HTTP 404")),
        ("/broken", ("UNAVAILABLE", "HTTP 500")),
    ],
)
def test_probe_semantics(base, path, expected):
    assert one(base, path) == expected


def test_nexus_space_requires_hologram_role(base):
    assert one(base, "/role-live", "nexus-space") == ("LIVE", "hologram-not-instrument")
    assert one(base, "/role-empty", "nexus-space") == ("UNAVAILABLE", "instrument not bound · hologram only")
    assert one(base, "/array", "nexus-space") == ("UNAVAILABLE", "instrument not bound · hologram only")
    assert one(base, "/null", "nexus-space") == ("LIVE", "HTTP 200")


def test_timeout_and_unreachable(base):
    assert one(base, "/slow", timeout_s=0.2) == ("UNAVAILABLE", "timeout")
    assert one(base, closed_port_url()) == ("UNAVAILABLE", "cors or unreachable")


def test_default_endpoints_match_typescript():
    assert [e["id"] for e in rt.ENDPOINTS] == ["hatun", "anatomy", "nexus-space"]
    assert rt.ENDPOINTS[2]["url"] == "https://szlholdings-nexus.hf.space/api/build-info"


def test_probes_run_concurrently(base):
    endpoints = [{"id": f"e{i}", "label": "L", "url": base + "/slow"} for i in range(3)]
    started = time.monotonic()
    probes = rt.probe_estate(2.0, endpoints)
    assert time.monotonic() - started < 1.5
    assert [p["id"] for p in probes] == ["e0", "e1", "e2"]


def test_environment_proxies_are_ignored(base, monkeypatch):
    monkeypatch.setenv("http_proxy", "http://127.0.0.1:9")
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:9")
    monkeypatch.delenv("no_proxy", raising=False)
    monkeypatch.delenv("NO_PROXY", raising=False)
    assert one(base, "/ok") == ("LIVE", "ok")
