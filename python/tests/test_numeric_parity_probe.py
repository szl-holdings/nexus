# SPDX-License-Identifier: Apache-2.0
"""The per-input gate must never turn errors or different inputs into success."""
from __future__ import annotations

import importlib.util
import io
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("numeric_parity_probe", ROOT / "experiments/numeric-parity-probe.py")
assert SPEC and SPEC.loader
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


@pytest.fixture
def node_runtime():
    if not shutil.which("node"):
        pytest.skip("real cross-runtime checks require Node with TypeScript stripping")
    version = subprocess.run(["node", "--version"], text=True, capture_output=True, check=True).stdout
    if tuple(int(part) for part in version.strip().lstrip("v").split(".")[:2]) < (22, 6):
        pytest.skip("real cross-runtime checks require Node >=22.6")


def stub_node(monkeypatch, *, changed_hash=False, changed_input=False):
    def run(*args, **kwargs):
        request = json.loads(kwargs["input"])
        result = probe.python_result(request["input"], request["contract"], request["method"])
        result["runtime"] = {"node": "test-double"}
        if changed_hash:
            result["outputHash"] = "0" * 64
        if changed_input:
            result["normalizedInput"]["steps"] = 1
        return subprocess.CompletedProcess(args, 0, json.dumps(result), "")
    monkeypatch.setattr(probe.subprocess, "run", run)


@pytest.mark.parametrize("changed_hash,changed_input", [(True, False), (False, True), (True, True)])
def test_any_output_or_normalization_disagreement_fails(monkeypatch, changed_hash, changed_input):
    stub_node(monkeypatch, changed_hash=changed_hash, changed_input=changed_input)
    report, code = probe.probe(probe.DEFAULT_INPUT, "immune-v1", "euler4")
    assert code == 1
    assert report["status"] == "MISMATCH"
    assert report["outputHashesMatch"] is not changed_hash
    assert report["normalizedInputsMatch"] is not changed_input


@pytest.mark.parametrize("failure", [
    FileNotFoundError("node not found"),
    subprocess.TimeoutExpired("node", 30),
    subprocess.CalledProcessError(1, "node", stderr="UNSUPPORTED_METHOD"),
])
def test_node_execution_failure_is_error(monkeypatch, failure):
    def run(*args, **kwargs):
        raise failure
    monkeypatch.setattr(probe.subprocess, "run", run)
    report, code = probe.probe(probe.DEFAULT_INPUT, "immune-v1", "euler4")
    assert (code, report["status"], report["error"]["stage"]) == (2, "ERROR", "node")


@pytest.mark.parametrize("stdout", ["not JSON", "null", "{}", '{"runtime":{},"normalizedInput":{},"outputHash":"bad"}'])
def test_malformed_node_response_is_error(monkeypatch, stdout):
    monkeypatch.setattr(probe.subprocess, "run", lambda *a, **kw: subprocess.CompletedProcess(a, 0, stdout, ""))
    report, code = probe.probe(probe.DEFAULT_INPUT, "immune-v1", "euler4")
    assert (code, report["status"], report["error"]["stage"]) == (2, "ERROR", "node")


def test_unexpected_engine_failure_is_error(monkeypatch):
    def broken(*args):
        raise RuntimeError("engine failure")
    monkeypatch.setattr(probe, "python_result", broken)
    report, code = probe.probe(probe.DEFAULT_INPUT, "immune-v1", "euler4")
    assert (code, report["status"], report["error"]["stage"]) == (2, "ERROR", "python")


def test_source_changes_cannot_be_admitted(monkeypatch):
    stub_node(monkeypatch)
    manifests = iter([{"file.py": "before"}, {"file.py": "after"}])
    monkeypatch.setattr(probe, "source_files", lambda: next(manifests))
    report, code = probe.probe(probe.DEFAULT_INPUT, "immune-v1", "euler4")
    assert (code, report["status"], report["error"]["stage"]) == (2, "ERROR", "source")


@pytest.mark.parametrize("contract,method,stage", [
    ("immune-v1", "rk4", "options"), ("dynamics-v2", "wrong", "options"),
    ("wrong", "euler4", "options"), ("dynamics-v2", "symplectic", "python"),
])
def test_unsupported_method_or_contract_is_error(contract, method, stage):
    payload = {**probe.DEFAULT_INPUT, "program": "lorenz"}
    report, code = probe.probe(payload, contract, method)
    assert (code, report["status"], report["error"]["stage"]) == (2, "ERROR", stage)


@pytest.mark.parametrize("raw", ["{", "null", '{"steps": NaN}', '{"steps": Infinity}', '{"steps": -Infinity}'])
def test_bad_stdin_is_structured_error(monkeypatch, capsys, raw):
    monkeypatch.setattr(probe.sys, "stdin", io.StringIO(raw))
    assert probe.main(["--input", "-"]) == 2
    assert json.loads(capsys.readouterr().out)["status"] == "ERROR"


def test_missing_input_file_is_error(tmp_path, capsys):
    assert probe.main(["--input", str(tmp_path / "missing.json")]) == 2
    report = json.loads(capsys.readouterr().out)
    assert report["error"]["stage"] == "input"


@pytest.mark.parametrize("contract,method", [
    ("immune-v1", "euler4"), ("dynamics-v2", "euler4"),
    ("dynamics-v2", "rk4"), ("dynamics-v2", "symplectic"),
])
def test_real_bindings_match_published_harmonic_vector(node_runtime, parity_doc, tmp_path, capsys, contract, method):
    vector = next(row for row in parity_doc["vectors"] if row["input"]["program"] == "harmonic" and row["method"] == method)
    path = tmp_path / "input.json"
    path.write_text(json.dumps(vector["input"]), encoding="utf-8")
    assert probe.main(["--input", str(path), "--contract", contract, "--method", method]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["status"] == "MATCH_THIS_CASE"
    assert report["normalizedInputsMatch"] is True
    assert report["outputHashesMatch"] is True
    if contract == "dynamics-v2":
        assert report["python"]["outputHash"] == vector["expected"]["outputHash"]
    assert "experiments/numeric-parity-probe.py" in report["sourceFilesSha256"]
    assert "src/lib/nexus/math.ts" in report["sourceFilesSha256"]
    assert "python/nexus_dynamics/programs/duffing.py" in report["sourceFilesSha256"]
    assert report["node"]["runtime"]["v8"]


def test_real_default_counterexample_reports_actual_result(node_runtime, capsys):
    code = probe.main([])
    report = json.loads(capsys.readouterr().out)
    assert code in (0, 1)  # libm/V8 versions may agree; do not manufacture a mismatch.
    equal = report["python"]["outputHash"] == report["node"]["outputHash"]
    assert code == (0 if equal else 1)
    assert report["status"] == ("MATCH_THIS_CASE" if equal else "MISMATCH")
    assert report["python"]["lambdaCanonical"]
    assert report["node"]["lambdaCanonical"]
