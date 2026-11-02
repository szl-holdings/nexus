# SPDX-License-Identifier: Apache-2.0
"""Python port of probeEstate() from src/lib/nexus/telemetry.ts."""
import socket
import threading
import time
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

import nexus_runtime as rt

ROUTES = {
    "/runtime-live": (200, rt.dumps(rt.build_info("0123456789abcdef0123456789abcdef01234567"))),
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
    "/body-at-limit": (200, b'{"status":"ok","pad":"' + b"x" * (65536 - 24) + b'"}'),
    "/body-over-limit": (200, b'{"status":"ok","pad":"' + b"x" * (65537 - 24) + b'"}'),
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
        elif self.path == "/truncated-body":
            body = ROUTES["/runtime-live"][1]
            self.send_response(200)
            self.send_header("content-length", str(len(body) + 10))
            self.end_headers()
            self.wfile.write(body)
            return
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


def one(base, path, endpoint_id="generic", timeout_s=2.0):
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


def test_nexus_space_requires_current_source_bound_runtime(base):
    assert one(base, "/runtime-live", "nexus-space") == ("LIVE", "source-bound Python runtime")
    for path in ("/role-live", "/role-empty", "/array", "/null", "/text", "/nan"):
        assert one(base, path, "nexus-space") == ("UNAVAILABLE", "runtime source identity unavailable"), path


def test_timeout(base):
    assert one(base, "/slow", timeout_s=0.2) == ("UNAVAILABLE", "timeout")


def test_connection_refused_is_unreachable(base, monkeypatch):
    class RefusedOpener:
        def open(self, url, timeout):
            raise urllib.error.URLError(ConnectionRefusedError("refused"))

    monkeypatch.setattr(rt, "_OPENER", RefusedOpener())
    assert one(base, "/ok") == ("UNAVAILABLE", "cors or unreachable")


def test_default_endpoints_match_typescript():
    assert [e["id"] for e in rt.ENDPOINTS] == ["hatun", "anatomy", "nexus-space"]
    assert rt.ENDPOINTS[2]["url"] == "https://szlholdings-nexus.hf.space/api/build-info"
    assert rt.ENDPOINTS[2]["label"] == "NEXUS runtime"


def test_hatun_uses_declared_product_transport(monkeypatch):
    def request_contract(request, timeout, *, mcp):
        import json
        assert mcp is True
        assert request.full_url == "https://szlholdings-a11oy.hf.space/mcp/"
        assert request.get_method() == "POST"
        assert json.loads(request.data) == rt.HATUN_INITIALIZE
        return 200, b'{"status":"ok"}'

    monkeypatch.setattr(rt, "_read_response", request_contract)
    hatun = next(e for e in rt.ENDPOINTS if e["id"] == "hatun")
    [probe] = rt.probe_estate(endpoints=[hatun], now_ms=lambda: 123)
    assert probe == {
        "id": "hatun", "label": "Hatun product gateway", "status": "UNAVAILABLE",
        "detail": "A11oy MCP handshake unavailable", "at": 123,
    }


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
    # the time is split between connect, TLS and a slowly arriving head. Keep the
    # full head well beyond the assertion budget so a loaded Windows runner may
    # schedule late without allowing the drip-fed response to finish.
    started = time.monotonic()
    assert one(base, trickle_url(0.15, 12), timeout_s=0.4) == ("UNAVAILABLE", "timeout")
    assert time.monotonic() - started < 1.2


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


def test_body_must_arrive_within_the_same_deadline(base):
    started = time.monotonic()
    assert one(base, "/slow-body", timeout_s=0.3) == ("UNAVAILABLE", "timeout")
    assert time.monotonic() - started < 0.55


def test_probe_body_limit_uses_actual_bytes(base):
    assert len(ROUTES["/body-at-limit"][1]) == rt.MAX_PROBE_BYTES
    assert one(base, "/body-at-limit") == ("LIVE", "ok")
    assert one(base, "/body-over-limit") == ("UNAVAILABLE", "response too large")


def test_truncated_response_cannot_qualify_runtime(base):
    assert one(base, "/truncated-body", "nexus-space") == ("UNAVAILABLE", "cors or unreachable")


def test_timed_out_body_attempt_closes_response(base, monkeypatch):
    closed = threading.Event()

    class SlowResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *args):
            closed.set()

        def read1(self, size):
            time.sleep(0.15)
            return b" "

    class Opener:
        def open(self, url, timeout):
            assert timeout == 0.1
            return SlowResponse()

    monkeypatch.setattr(rt, "_OPENER", Opener())
    assert one(base, "/ok", timeout_s=0.1) == ("UNAVAILABLE", "timeout")
    assert closed.wait(0.5)


def test_sse_parser_accepts_fragmented_utf8_and_crlf_before_eof():
    reply = {"jsonrpc": "2.0", "id": "nexus-probe", "result": {}}
    wire = b"\xef\xbb\xbf: " + "λ🫀".encode() + b"\r\nevent: message\r\ndata: " + rt.dumps(reply) + b"\r\n\r\n"
    parser = rt._MCPEventStream()
    result = None
    for byte in wire:
        parsed = parser.feed(bytes([byte]))
        if parsed is not None:
            result = parsed
            break
    assert result == rt.dumps(reply)


def test_sse_byte_limit_counts_comments_but_stops_at_matching_event():
    good = b'data: {"jsonrpc":"2.0","id":"nexus-probe","result":{}}\n\n'
    padding = b":" + b"x" * (rt.MAX_PROBE_BYTES - len(good) - 3) + b"\n\n"
    assert rt._MCPEventStream().feed(padding + good + b"x" * 70000) is not None
    with pytest.raises(rt._ProbeTooLarge):
        rt._MCPEventStream().feed(b":" + b"x" * rt.MAX_PROBE_BYTES + b"\n\n" + good)
