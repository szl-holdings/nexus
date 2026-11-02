# SPDX-License-Identifier: Apache-2.0
"""A shared authority is opt-in; errors, drift and tampering never trigger fallback."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from nexus_dynamics.authoritative import (
    AuthorityError, MAX_RESPONSE_BYTES, SOURCE_PATHS, _exact_hash,
    read_authority_profile, run_authoritative, verify_authority_result,
)
from nexus_dynamics.canonical import nexus_hash

ROOT = Path(__file__).resolve().parents[2]
LAMBDA = {"program": "harmonic", "mode": "IC", "steps": 0, "dt": .01, "chaos": .5,
          "drive": .5, "seed": .2, "repeatEvery": 32, "axes": [.1622758695]}
DUFFING = {"program": "duffing", "mode": "OP", "steps": 2400, "dt": .04, "chaos": .9,
           "drive": .8, "seed": .3, "repeatEvery": 32}


@pytest.fixture(scope="module")
def node():
    executable = shutil.which("node")
    if not executable:
        pytest.skip("integration requires Node >=22.6")
    version = subprocess.run([executable, "--version"], text=True, capture_output=True, check=True).stdout
    if tuple(int(x) for x in version.strip().lstrip("v").split(".")[:2]) < (22, 6):
        pytest.skip("integration requires Node >=22.6")
    return executable


def authority_env():
    # setup-python sets LD_LIBRARY_PATH for Python itself; a plain Node child
    # must not inherit loader/preload configuration from its test host.
    blocked = {"NODE_OPTIONS", "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH"}
    return {key: value for key, value in os.environ.items() if key not in blocked}


@contextmanager
def serve(node, root=ROOT):
    process = subprocess.Popen([node, "--experimental-strip-types", str(root / "src/lib/nexus/authoritative-node.ts"), "serve"],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=authority_env())
    try:
        ready = process.stdout.readline()
        assert ready, process.stderr.read()
        yield json.loads(ready)
    finally:
        process.terminate()
        try:
            process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()


@pytest.fixture(scope="module")
def authority(node):
    with serve(node) as ready:
        yield ready


def run(ready, payload=LAMBDA, **kwargs):
    return run_authoritative(payload, endpoint=ready["endpoint"], expected_profile=ready["profile"], **kwargs)


@pytest.mark.parametrize("contract,payload", [("immune-v1", LAMBDA), ("dynamics-v2", DUFFING)])
def test_exact_shared_result_for_known_native_mismatch_inputs(authority, node, contract, payload):
    result = run(authority, payload, contract=contract)
    script = """import {readFileSync} from 'node:fs';
import {runAuthoritative} from './src/lib/nexus/authoritative-node.ts';
const a=JSON.parse(readFileSync(0,'utf8'));
console.log(JSON.stringify(await runAuthoritative(a.endpoint,a.profile,a.input,a.contract)));
"""
    node_result = subprocess.run([node, "--experimental-strip-types", "--input-type=module", "-e", script],
                                 input=json.dumps({**authority, "input": payload, "contract": contract}),
                                 cwd=ROOT, text=True, capture_output=True, check=True, timeout=30)
    assert result == json.loads(node_result.stdout)
    assert result["outputHash"] == nexus_hash(result["output"])
    assert result["execution"] == "DELEGATED_SINGLE_NODE_PROCESS"


def test_exact_request_hash_distinguishes_legacy_canonical_collision(authority):
    altered = {**DUFFING, "dt": .040000000001}
    assert nexus_hash(altered) == nexus_hash(DUFFING)
    assert _exact_hash(altered) != _exact_hash(DUFFING)
    result = run(authority, DUFFING)
    with pytest.raises(AuthorityError, match="admitted request"):
        verify_authority_result(result, authority["profile"], altered)


@pytest.mark.parametrize("field", ["inputHash", "outputHash", "resultHash", "output", "profile", "contract", "method"])
def test_tampering_is_rejected(authority, field):
    result = run(authority, contract="immune-v1")
    if field == "output":
        result[field]["lambda"]["value"] += 1e-12  # Too small for legacy outputHash, still caught by resultHash.
    elif field == "profile":
        result[field]["runtime"]["v8"] = "altered"
    else:
        result[field] = "tampered"
    with pytest.raises(AuthorityError) as error:
        verify_authority_result(result, authority["profile"], LAMBDA, contract="immune-v1")
    assert error.value.code == "INVALID_RESULT"


def test_missing_profile_and_unsupported_contract_fail_before_transport(authority):
    with pytest.raises(AuthorityError) as error:
        run_authoritative(LAMBDA, endpoint=authority["endpoint"], expected_profile={})
    assert error.value.code == "INVALID_PROFILE"
    with pytest.raises(AuthorityError) as error:
        run(authority, contract="immune-v1", method="rk4")
    assert error.value.code == "UNSUPPORTED_METHOD"


def test_restarted_authority_requires_explicit_readmission(authority, node):
    with serve(node) as other:
        with pytest.raises(AuthorityError) as error:
            run_authoritative(LAMBDA, endpoint=other["endpoint"], expected_profile=authority["profile"])
        assert error.value.code == "AUTHORITY_MISMATCH"
        assert read_authority_profile(other["endpoint"]) == other["profile"]
        assert run(other)["profile"] == other["profile"]


def test_source_mutation_invalidates_running_authority(node, tmp_path):
    for name in SOURCE_PATHS:
        target = tmp_path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, target)
    with serve(node, tmp_path) as ready:
        assert run(ready)["outputHash"]
        with (tmp_path / "contracts/nexus-authoritative-execution-v1.json").open("a") as target:
            target.write("\n")
        with pytest.raises(AuthorityError) as error:
            run(ready)
        assert error.value.code == "SOURCE_CHANGED"
        (tmp_path / "contracts/nexus-authoritative-execution-v1.json").unlink()
        with pytest.raises(AuthorityError) as error:
            run(ready)
        assert error.value.code == "EXECUTION_ERROR"
        assert str(error.value) == "Authority execution failed"
        assert str(tmp_path) not in str(error.value)


@pytest.mark.parametrize("endpoint", ["https://example.com", "http://localhost:80", "http://127.0.0.1:99/run", "http://user@127.0.0.1:99"])
def test_endpoint_does_not_allow_remote_proxy_or_path_selection(endpoint):
    with pytest.raises(AuthorityError) as error:
        read_authority_profile(endpoint)
    assert error.value.code == "INVALID_ENDPOINT"


def test_cli_works_outside_checkout_without_node_in_client_path(authority, tmp_path):
    profile_file = tmp_path / "authority.json"
    profile_file.write_text(json.dumps(authority), encoding="utf-8")
    env = {**os.environ, "PATH": "", "PYTHONPATH": str(ROOT / "python")}
    result = subprocess.run([sys.executable, "-m", "nexus_dynamics.authoritative", "--authority-file", str(profile_file),
                             "--input", "-", "--contract", "immune-v1"], input=json.dumps(LAMBDA),
                            cwd=tmp_path, env=env, text=True, capture_output=True, check=True, timeout=30)
    assert json.loads(result.stdout) == run(authority, contract="immune-v1")


@contextmanager
def fake_authority(mode):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            self.rfile.read(int(self.headers["Content-Length"]))
            try:
                if mode == "headers":
                    for byte in b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n":
                        self.connection.send(bytes([byte])); time.sleep(.015)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                if mode == "truncated":
                    self.send_header("Content-Length", "100")
                self.end_headers()
                if mode == "body":
                    for _ in range(100):
                        self.wfile.write(b" "); self.wfile.flush(); time.sleep(.015)
                elif mode == "large":
                    self.wfile.write(b" " * (MAX_RESPONSE_BYTES + 1))
                elif mode == "truncated":
                    self.wfile.write(b"{}")
                else:
                    self.wfile.write(b"not JSON")
            except OSError:
                # Deadline/size-limit tests intentionally disconnect this fake peer.
                pass
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown(); server.server_close(); thread.join()


@pytest.mark.parametrize("mode", ["headers", "body"])
def test_total_deadline_covers_drip_fed_headers_and_body(authority, mode):
    with fake_authority(mode) as endpoint:
        start = time.monotonic()
        with pytest.raises(AuthorityError) as error:
            run_authoritative(LAMBDA, endpoint=endpoint, expected_profile=authority["profile"], timeout=.08)
        assert error.value.code == "TIMEOUT"
        assert time.monotonic() - start < 1


@pytest.mark.parametrize("mode,code", [("large", "BODY_TOO_LARGE"), ("truncated", "INVALID_RESPONSE"), ("json", "TRANSPORT_ERROR")])
def test_malformed_oversized_and_truncated_responses_fail(authority, mode, code):
    with fake_authority(mode) as endpoint:
        with pytest.raises(AuthorityError) as error:
            run_authoritative(LAMBDA, endpoint=endpoint, expected_profile=authority["profile"])
        assert error.value.code == code


def test_selected_methods_execute_and_unsupported_pair_fails(authority):
    payload = {**LAMBDA, "mode": "OP", "steps": 16}
    outputs = [run(authority, payload, method=method)["outputHash"] for method in ("euler4", "rk4", "symplectic")]
    assert len(set(outputs)) == 3
    with pytest.raises(AuthorityError) as error:
        run(authority, {**LAMBDA, "program": "nemo"}, method="rk4")
    assert error.value.code == "UNSUPPORTED_METHOD"


def test_custom_launch_options_are_rejected(node):
    result = subprocess.run([node, "--experimental-strip-types", "--expose-gc", str(ROOT / "src/lib/nexus/authoritative-node.ts"), "serve"],
                            text=True, capture_output=True, timeout=10, env=authority_env())
    assert result.returncode == 2
    assert result.stdout == ""
    assert "plain Node launch" in result.stderr


def test_host_loader_override_is_scrubbed_only_for_test_child(node, monkeypatch):
    monkeypatch.setenv("LD_LIBRARY_PATH", str(ROOT))
    with serve(node) as ready:
        assert run(ready)["outputHash"]
    # Production policy still rejects the inherited override when not scrubbed.
    rejected = subprocess.run([node, "--experimental-strip-types", str(ROOT / "src/lib/nexus/authoritative-node.ts"), "serve"],
                              text=True, capture_output=True, timeout=10)
    assert rejected.returncode == 2
    assert "plain Node launch" in rejected.stderr
