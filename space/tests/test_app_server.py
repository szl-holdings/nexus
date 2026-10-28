# SPDX-License-Identifier: Apache-2.0
"""space/app_server.py: static workstation plus the runtime API, matching Nitro."""
import socket
import threading
import time
import urllib.error
import urllib.request

import pytest

import app_server
import nexus_runtime as rt

SHA = "0123456789abcdef0123456789abcdef01234567"
INDEX = b"<!DOCTYPE html><html><body>nexus</body></html>"
ASSET = b"console.log(1)"
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


@pytest.fixture()
def site(tmp_path, monkeypatch):
    static = tmp_path / "static"
    (static / "assets").mkdir(parents=True)
    (static / "index.html").write_bytes(INDEX)
    (static / "assets" / "app-abc123.js").write_bytes(ASSET)
    (static / "favicon.svg").write_bytes(b"<svg/>")
    (tmp_path / "secret.txt").write_text("outside")
    source = tmp_path / "SOURCE_GITHUB_SHA"
    source.write_text(SHA + "\n")
    monkeypatch.setattr(rt, "probe_estate", lambda *a, **k: [{"id": "x", "label": "X", "status": "LIVE", "detail": "ok", "at": 1}])
    server = app_server.make_server("127.0.0.1", 0, static, source)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


def fetch(url, method="GET"):
    try:
        with OPENER.open(urllib.request.Request(url, method=method), timeout=5) as response:
            return response.status, {k.lower(): v for k, v in response.headers.items()}, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, {k.lower(): v for k, v in exc.headers.items()}, exc.read()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


API_HEADERS = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
}


def test_build_info_and_health_match_runtime(site):
    for path, payload in (
        ("/api/build-info", rt.build_info(SHA + "\n")),
        ("/healthz", rt.runtime_health(SHA + "\n")),
        ("/health", rt.runtime_health(SHA + "\n")),
        ("/healthz?probe=1", rt.runtime_health(SHA + "\n")),
    ):
        status, headers, body = fetch(site + path)
        assert status == 200, path
        assert body == rt.dumps(payload), path
        for key, value in API_HEADERS.items():
            assert headers[key] == value, (path, key)


def test_probes_use_response_json_content_type(site):
    status, headers, body = fetch(site + "/api/probes")
    assert status == 200
    assert headers["content-type"] == "application/json"
    assert body == b'[{"id":"x","label":"X","status":"LIVE","detail":"ok","at":1}]'


def test_index_and_assets(site):
    status, headers, body = fetch(site + "/")
    assert (status, headers["content-type"], body) == (200, "text/html; charset=utf-8", INDEX)
    assert "cache-control" not in headers
    status, headers, body = fetch(site + "/assets/app-abc123.js")
    assert (status, body) == (200, ASSET)
    assert headers["content-type"] == "text/javascript; charset=utf-8"
    assert headers["cache-control"] == "public, max-age=31536000, immutable"
    status, headers, _ = fetch(site + "/favicon.svg")
    assert (status, headers["content-type"]) == (200, "image/svg+xml")
    assert "cache-control" not in headers


def test_unknown_paths_are_404_html_like_nitro(site):
    for path in ("/some/client/route", "/assets/missing.js", "/" + "a" * 300):
        status, headers, _ = fetch(site + path)
        assert (status, headers["content-type"]) == (404, "text/html; charset=utf-8"), path


def test_traversal_never_leaves_static_dir(site):
    for path in ("/../secret.txt", "/%2e%2e/secret.txt", "/assets/..%2f..%2fsecret.txt"):
        status, _, body = fetch(site + path)
        assert status == 404, path
        assert b"outside" not in body, path


def test_non_get_methods_fall_through_to_404(site):
    for method in ("POST", "PUT", "DELETE", "PROPFIND"):
        status, headers, _ = fetch(site + "/healthz", method)
        assert (status, headers["x-content-type-options"]) == (404, "nosniff"), method


def test_api_paths_with_trailing_slashes_redirect_like_nitro(site):
    no_redirects = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    for path, location in (
        ("/api/build-info/", "/api/build-info"),
        ("/api/build-info/?x=1", "/api/build-info?x=1"),
        ("/healthz/", "/healthz"),
        ("/health//", "/health"),
        ("/api//build-info", "/api/build-info"),
    ):
        try:
            no_redirects.open(site + path, timeout=5)
        except urllib.error.HTTPError as exc:
            assert (exc.code, exc.headers["location"]) == (307, location), path
            assert exc.headers["x-content-type-options"] == "nosniff", path
        else:
            raise AssertionError(f"{path} was not redirected")
    assert fetch(site + "/api/probes/")[0] == 200


def test_malformed_requests_still_send_nosniff(site):
    host, port = site.removeprefix("http://").split(":")
    with socket.create_connection((host, int(port)), timeout=5) as conn:
        conn.sendall(b"GET / HTTP/1.1\r\nx-long: " + b"a" * 70000 + b"\r\n\r\n")
        reply = conn.recv(65536).decode("latin-1").lower()
    assert reply.startswith("http/1.0 431"), reply[:40]
    assert "x-content-type-options: nosniff" in reply


def test_head_is_get_without_body(site):
    status, headers, body = fetch(site + "/healthz", "HEAD")
    assert (status, body) == (200, b"")
    assert headers["content-type"] == API_HEADERS["content-type"]
    assert int(headers["content-length"]) == len(rt.dumps(rt.runtime_health(SHA + "\n")))


def test_nosniff_on_every_response(site):
    for path in ("/", "/assets/app-abc123.js", "/healthz", "/api/probes", "/nope"):
        assert fetch(site + path)[1]["x-content-type-options"] == "nosniff", path


def test_slow_probes_do_not_block_health(site, monkeypatch):
    monkeypatch.setattr(rt, "probe_estate", lambda *a, **k: time.sleep(1.0) or [])
    threading.Thread(target=fetch, args=(site + "/api/probes",), daemon=True).start()
    time.sleep(0.1)
    started = time.monotonic()
    assert fetch(site + "/healthz")[0] == 200
    assert time.monotonic() - started < 0.3
