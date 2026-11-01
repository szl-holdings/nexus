#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Report actual cross-runtime hashes; exit 1 on disagreement, 2 on failure.

Run from any directory: python experiments/numeric-parity-probe.py
Requires Node >=22 with TypeScript type stripping. This is a diagnostic of a
known limitation, not a replacement for the published parity-vector gate.
"""
from __future__ import annotations

import json
import platform
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))

from nexus_dynamics.canonical import canonical_number, nexus_hash
from nexus_dynamics.immune_v1 import deterministic_output
from nexus_dynamics.schema import NexusRunInput

NODE = r"""
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {canonicalJson,canonicalNumber,immuneV1Output,normalizeDynamicsInput}
  from './src/lib/nexus/dynamics.ts';
const input = normalizeDynamicsInput(JSON.parse(readFileSync(0, 'utf8')));
const output = immuneV1Output(input);
console.log(JSON.stringify({
  runtime: {node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch},
  lambda:output.lambda.value,
  lambdaCanonical:canonicalNumber(output.lambda.value),
  outputHash:createHash('sha256').update(canonicalJson(output)).digest('hex')
}));
"""


def main() -> int:
    payload = {
        "program": "harmonic", "mode": "IC", "steps": 0, "dt": .01,
        "chaos": .5, "drive": .5, "seed": .2, "repeatEvery": 32,
        "axes": [.1622758695],
    }
    output = deterministic_output(NexusRunInput.from_dict(payload))
    python = {
        "runtime": {"python": platform.python_version(), "platform": platform.platform(),
                    "libc": platform.libc_ver()},
        "lambda": output["lambda"]["value"],
        "lambdaCanonical": canonical_number(output["lambda"]["value"]),
        "outputHash": nexus_hash(output),
    }
    try:
        result = subprocess.run(
            ["node", "--experimental-strip-types", "--input-type=module", "-e", NODE],
            cwd=ROOT, input=json.dumps(payload), text=True, capture_output=True,
            check=True, timeout=30,
        )
        node = json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "ERROR", "error": str(exc)}))
        return 2
    equal = python["outputHash"] == node["outputHash"]
    print(json.dumps({
        "schema": "szl.nexus-runtime-parity-probe/v1",
        "status": "MATCH_THIS_CASE" if equal else "MISMATCH",
        "scope": "One counterexample candidate; a match does not establish universal parity.",
        "input": payload, "python": python, "node": node,
    }, indent=2))
    return 0 if equal else 1


if __name__ == "__main__":
    sys.exit(main())
