# SPDX-License-Identifier: Apache-2.0
"""Legacy hologram POST routes fail closed on non-finite, out-of-range and malformed input."""
from __future__ import annotations

import http.client
import importlib.util
import json
import math
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("nexus_hologram_server", ROOT / "server.py")
hologram = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hologram)


@pytest.fixture(scope="module")
def port():
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), hologram.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield httpd.server_address[1]
    httpd.shutdown()
    httpd.server_close()


def _reject_constant(name):
    raise ValueError(f"non-JSON constant {name}")


def post(port, path, raw: bytes):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        conn.request("POST", path, body=raw, headers={"Content-Type": "application/json"})
        response = conn.getresponse()
        return response.status, json.loads(response.read(), parse_constant=_reject_constant)
    finally:
        conn.close()


@pytest.mark.parametrize("raw", [
    b'{"axes":[NaN,NaN,NaN]}',
    b'{"axes":[Infinity,Infinity]}',
    b'{"axes":[-Infinity]}',
    b'{"axes":[0.99,0.99,NaN]}',
    b'{"axes":[5,5,5]}',
    b'{"axes":[1.0000001]}',
    b'{"axes":[-0.5]}',
    b'{"axes":["x"]}',
    b'{"axes":[true,true]}',
    b'{"axes":"abc"}',
    b'{"axes":{"a":1}}',
])
def test_lambda_rejects_bad_axes(port, raw):
    status, payload = post(port, "/api/lambda", raw)
    assert status == 400, payload
    assert payload.get("decision") != "ADMITTED"
    assert payload.get("honesty") != "MEASURED"


@pytest.mark.parametrize(("path", "raw"), [
    ("/api/lorenz", b'{"steps":"abc"}'),
    ("/api/lorenz", b'{"x":"q"}'),
    ("/api/lorenz", b'{"x":Infinity}'),
    ("/api/lorenz", b'{"z":NaN}'),
    ("/api/ouroboros", b'{"bars":"z"}'),
    ("/api/ouroboros", b'{"amplitude":"q"}'),
    ("/api/ouroboros", b'{"amplitude":Infinity}'),
])
def test_malformed_numerics_get_400_json(port, path, raw):
    status, payload = post(port, path, raw)
    assert status == 400, payload
    assert payload["energy"] == "UNAVAILABLE"
    assert "error" in payload


def test_default_floors_still_aggregate(port):
    status, payload = post(port, "/api/lambda", b"{}")
    assert status == 200
    assert math.isfinite(payload["lambda"])
    assert payload["decision"] == "ADMITTED"


def test_hidden_weak_geometric_mean_is_below_admit_floor():
    gm = hologram.lambda_aggregate([0.95, 0.95, 0.95, 0.40])
    assert round(gm, 4) == 0.7653
    assert gm < 0.80


@pytest.mark.parametrize("axes", [[math.nan], [math.inf], [-math.inf], [5.0], [-0.1], [True]])
def test_lambda_aggregate_raises(axes):
    with pytest.raises(ValueError):
        hologram.lambda_aggregate(axes)


def test_well_formed_lorenz_and_ouroboros_still_answer(port):
    assert post(port, "/api/lorenz", b'{"steps":10}')[0] == 200
    assert post(port, "/api/ouroboros", b'{"bars":4,"amplitude":0.5}')[0] == 200


def test_space_copy_is_byte_identical():
    assert (ROOT / "server.py").read_bytes() == (ROOT / "space" / "server.py").read_bytes()


_space_spec = importlib.util.spec_from_file_location("nexus_hologram_space_server", ROOT / "space" / "server.py")
space_hologram = importlib.util.module_from_spec(_space_spec)
_space_spec.loader.exec_module(space_hologram)


@pytest.fixture(scope="module", params=[hologram, space_hologram], ids=["server", "space_server"])
def any_port(request):
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), request.param.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield httpd.server_address[1]
    httpd.shutdown()
    httpd.server_close()


def test_handler_blocks_hidden_weak_below_gm_floor(any_port):
    status, payload = post(any_port, "/api/lambda", b'{"axes":[0.95,0.95,0.95,0.40]}')
    assert status == 200, payload
    assert round(payload["lambda"], 4) == 0.7653
    assert payload["blocked"] is True
    assert payload["decision"] == "BLOCKED"


@pytest.mark.parametrize("raw", [
    b'{"axes":[0.95,0.95,0.95,0.95]}',
    b'{"axes":[0.95,0.95,0.80,0.80]}',
])
def test_handler_admits_at_or_above_gm_floor(any_port, raw):
    status, payload = post(any_port, "/api/lambda", raw)
    assert status == 200, payload
    assert payload["lambda"] >= 0.80
    assert payload["blocked"] is False
    assert payload["decision"] == "ADMITTED"


@pytest.mark.parametrize("raw", [
    b'{"x":1e300,"steps":50}',
    b'{"y":-1e300,"steps":50}',
])
def test_lorenz_divergent_trail_gets_400_json(any_port, raw):
    status, payload = post(any_port, "/api/lorenz", raw)
    assert status == 400, payload
    assert payload["energy"] == "UNAVAILABLE"
    assert "non-finite" in payload["error"]
