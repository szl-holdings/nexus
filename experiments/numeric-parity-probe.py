#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Check one exact input on both bindings; exit 0 on match, 1 on mismatch, 2 on error.

Run from any directory: python experiments/numeric-parity-probe.py --help
Requires Node >=22.6 with TypeScript type stripping. The default case diagnoses
known platform rounding differences. A matching case never proves universal
parity or qualifies a deployed IMMUNE runtime.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))
SCHEMA = "szl.nexus-runtime-parity-probe/v2"
DEFAULT_INPUT = {
    "program": "harmonic", "mode": "IC", "steps": 0, "dt": .01,
    "chaos": .5, "drive": .5, "seed": .2, "repeatEvery": 32,
    "axes": [.1622758695],
}

NODE = r"""
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {canonicalJson,canonicalNumber,dynamicsInputPayload,dynamicsOutput,
        immuneV1Output,normalizeDynamicsInput} from './src/lib/nexus/dynamics.ts';
const request = JSON.parse(readFileSync(0, 'utf8'));
const input = normalizeDynamicsInput(request.input);
const output = request.contract === 'immune-v1'
  ? immuneV1Output(input) : dynamicsOutput(input, request.method);
const result = {
  runtime: {node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch},
  normalizedInput:dynamicsInputPayload(input, request.method).input,
  outputHash:createHash('sha256').update(canonicalJson(output)).digest('hex')
};
if (request.contract === 'immune-v1') {
  result.lambda = output.lambda.value;
  result.lambdaCanonical = output.lambda.value === null ? null : canonicalNumber(output.lambda.value);
}
console.log(JSON.stringify(result));
"""


def source_files() -> dict[str, str]:
    """Record the local source bytes, including uncommitted edits."""
    files = [Path(__file__).resolve(), ROOT / "src/lib/nexus/math.ts", ROOT / "src/lib/nexus/dynamics.ts"]
    files.extend((ROOT / "python/nexus_dynamics").rglob("*.py"))
    return {
        path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(files)
    }


def python_result(payload: Any, contract: str, method: str) -> dict[str, Any]:
    # Import after taking the source snapshot; do not alter engine/hash APIs.
    from nexus_dynamics.canonical import canonical_number, nexus_hash
    from nexus_dynamics.immune_v1 import deterministic_output as immune_output
    from nexus_dynamics.run import deterministic_output as dynamics_output
    from nexus_dynamics.schema import NexusRunInput

    run_input = NexusRunInput.from_dict(payload)
    output = immune_output(run_input) if contract == "immune-v1" else dynamics_output(run_input, method)
    result = {
        "runtime": {"python": platform.python_version(), "implementation": platform.python_implementation(),
                    "platform": sys.platform, "system": platform.system(), "release": platform.release(),
                    "machine": platform.machine(), "libc": platform.libc_ver()},
        "normalizedInput": run_input.to_dict(),
        "outputHash": nexus_hash(output),
    }
    if contract == "immune-v1":
        value = output["lambda"]["value"]
        result.update({"lambda": value, "lambdaCanonical": None if value is None else canonical_number(value)})
    return result


def reject_constant(value: str) -> None:
    raise ValueError(f"non-JSON numeric constant: {value}")


def probe(payload: Any, contract: str, method: str) -> tuple[dict[str, Any], int]:
    """Fail closed: even identical execution errors never count as parity."""
    report: dict[str, Any] = {
        "schema": SCHEMA, "status": "ERROR", "contract": contract, "method": method,
        "scope": "Only this input and these local implementations; no universal or deployed-runtime guarantee.",
    }
    stage = "options"
    try:
        if contract not in ("immune-v1", "dynamics-v2") or method not in ("euler4", "rk4", "symplectic"):
            raise ValueError("unknown contract or method")
        if contract == "immune-v1" and method != "euler4":
            raise ValueError("immune-v1 supports only euler4; use --contract dynamics-v2 for other methods")
        stage = "source"
        before = source_files()
        report["sourceFilesSha256"] = before
        stage = "python"
        python = python_result(payload, contract, method)
        report["python"] = python
        stage = "node"
        result = subprocess.run(
            ["node", "--experimental-strip-types", "--input-type=module", "-e", NODE],
            cwd=ROOT, input=json.dumps({"input": payload, "contract": contract, "method": method}, allow_nan=False),
            text=True, capture_output=True, check=True, timeout=30,
        )
        node = json.loads(result.stdout, parse_constant=reject_constant)
        if (not isinstance(node, dict) or not isinstance(node.get("runtime"), dict)
                or not isinstance(node.get("normalizedInput"), dict)
                or not isinstance(node.get("outputHash"), str)
                or not re.fullmatch(r"[0-9a-f]{64}", node["outputHash"])):
            raise ValueError("Node returned a malformed probe result")
        json.dumps(node, allow_nan=False)  # Refuse non-finite values from an invalid Node response.
        report["node"] = node
        stage = "source"
        if source_files() != before:
            raise ValueError("source files changed during the probe; rerun on a stable checkout")
        report["normalizedInputsMatch"] = python["normalizedInput"] == node["normalizedInput"]
        report["outputHashesMatch"] = python["outputHash"] == node["outputHash"]
        equal = report["normalizedInputsMatch"] and report["outputHashesMatch"]
        report["status"] = "MATCH_THIS_CASE" if equal else "MISMATCH"
        return report, 0 if equal else 1
    except Exception as exc:
        # An unexpected engine/transport failure is ERROR too, never MISMATCH.
        report["error"] = {"stage": stage, "type": type(exc).__name__, "message": str(exc)}
        if hasattr(exc, "code"):
            report["error"]["code"] = exc.code
        if isinstance(exc, subprocess.CalledProcessError):
            report["error"]["stderr"] = (exc.stderr or "")[-2000:]
        return report, 2


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", metavar="FILE", help="engine input JSON file, or - for stdin; default: lambda counterexample")
    parser.add_argument("--contract", choices=("immune-v1", "dynamics-v2"), default="immune-v1")
    parser.add_argument("--method", choices=("euler4", "rk4", "symplectic"), default="euler4")
    args = parser.parse_args(argv)
    try:
        if args.input:
            raw = sys.stdin.read() if args.input == "-" else Path(args.input).read_text(encoding="utf-8")
            payload = json.loads(raw, parse_constant=reject_constant)
        else:
            payload = DEFAULT_INPUT
        report, code = probe(payload, args.contract, args.method)
    except (OSError, ValueError) as exc:
        report = {"schema": SCHEMA, "status": "ERROR",
                  "error": {"stage": "input", "type": type(exc).__name__, "message": str(exc)}}
        code = 2
    print(json.dumps(report, indent=2, allow_nan=False))
    return code


if __name__ == "__main__":
    sys.exit(main())
