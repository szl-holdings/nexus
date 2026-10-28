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
        if self.path.startswith("/hop/"):
            hops = int(self.path.rsplit("/", 1)[1])
            if hops:
                self.send_response(302)
                self.send_header("location", f"/hop/{hops - 1}")
                self.send_header("content-length", "0")
                self.end_headers()
                return
            status, body = 200, b'{"status":"ok"}'
        elif self.path == "/slow-body":
            body = b'{"status":"late body"}'
            self.send_response(200)
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.flush()
            time.sleep(0.6)
            self.wfile.write(body)
            return
        elif self.path == "/slow":
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


def trickle_url(gap_s, pieces):
    """A server that sends the response head in pieces, each gap shorter than the timeout."""
    listener = socket.create_server(("127.0.0.1", 0))

    def serve():
        conn, _ = listener.accept()
        with conn:
            conn.recv(4096)
            body = b'{"status":"ok"}'
            parts = [b"HTTP/1.1 200 OK\r\n"] + [b"x-pad: 1\r\n"] * (pieces - 2)
            parts += [b"content-length: %d\r\n\r\n" % len(body) + body]
            for part in parts:
                time.sleep(gap_s)
                try:
                    conn.sendall(part)
                except OSError:
                    return
        listener.close()

    threading.Thread(target=serve, daemon=True).start()
    return f"http://127.0.0.1:{listener.getsockname()[1]}/"


def test_head_deadline_is_wall_clock_like_the_ts_abort(base):
    # TS aborts fetch() once timeoutMs passes before the head is complete, however
    # the time is split between connect, TLS and a slowly arriving head.
    started = time.monotonic()
    assert one(base, trickle_url(0.15, 6), timeout_s=0.4) == ("UNAVAILABLE", "timeout")
    assert time.monotonic() - started < 0.7


def test_head_deadline_covers_stalls_outside_socket_timeouts(base, monkeypatch):
    # A stalled DNS lookup has no socket timeout; the TS timer still fires.
    class StalledOpener:
        def open(self, url, timeout):
            time.sleep(1.5)
            raise AssertionError("unreachable")

    monkeypatch.setattr(rt, "_OPENER", StalledOpener())
    started = time.monotonic()
    assert one(base, "/ok", timeout_s=0.3) == ("UNAVAILABLE", "timeout")
    assert time.monotonic() - started < 0.9


def test_redirects_follow_fetch_limit(base):
    # fetch follows up to 20 redirects and fails the 21st as a network error.
    assert one(base, "/hop/12") == ("LIVE", "ok")
    assert one(base, "/hop/20") == ("LIVE", "ok")
    assert one(base, "/hop/21") == ("UNAVAILABLE", "cors or unreachable")


def test_body_is_read_after_the_head_deadline_like_fetch(base):
    # TS clears its timer once the head arrives; undici then allows 300 s of silence.
    assert one(base, "/slow-body", timeout_s=0.3) == ("LIVE", "late body")
