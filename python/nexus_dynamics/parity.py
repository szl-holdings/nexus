# SPDX-License-Identifier: Apache-2.0
"""Parity vectors: ``contracts/nexus-parity-v2.json``.

    python -m nexus_dynamics.parity write   # regenerate from this binding
    python -m nexus_dynamics.parity check   # recompute and compare (exit 1 on drift)

Every vector names a program, a method and a contract input. Its expected
``inputHash``/``outputHash`` (or expected error code) are computed here, by the
Python binding. ``src/lib/nexus/parity.test.ts`` recomputes all of them from the
TypeScript engine (``math.ts`` + ``dynamics.ts``) and must match exactly.

The file also keeps IMMUNE's v1 parity hashes verbatim for provenance; both
bindings must still reproduce them (see ``immune_v1.py``).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

from . import ENGINE_NAME, ENGINE_VERSION, immune_v1, programs
from .canonical import CANONICAL_DECIMAL_PLACES, canonical_number
from .errors import NexusDynamicsError
from .integrators import METHOD_VERSIONS, METHODS, SUBSTEPS
from .run import input_hash, output_hash
from .schema import CONTRACT_SHA256, PROGRAMS, NexusRunInput

PARITY_SCHEMA = "szl.nexus-parity-vectors/v2"
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PATH = REPO_ROOT / "contracts" / "nexus-parity-v2.json"

IMMUNE_REVISION = "33a8009e240976583e8465ba20ef40c4eee68946"

# Verbatim copy of szl-holdings/immune@33a8009:contracts/immune-nexus-parity-v1.json
# (sha256 13fe120d817a79c4c17a53da02cd1c642ee33df2394ee50d95316529c583c86f).
IMMUNE_V1: dict[str, Any] = {
    "schema": "szl.immune-nexus-parity-vectors/v1",
    "source": f"szl-holdings/immune@{IMMUNE_REVISION}:contracts/immune-nexus-parity-v1.json",
    "sha256": "13fe120d817a79c4c17a53da02cd1c642ee33df2394ee50d95316529c583c86f",
    "source_repository": "szl-holdings/nexus",
    "source_revision": "617fb49f061c9eb369c4d879a7c29af64c08e72e",
    "numeric_hash_precision_decimal_places": 9,
    "input": {
        "mode": "OP",
        "steps_standard": 64,
        "steps_nemo": 40,
        "dt_standard": 0.01,
        "dt_nemo": 0.002,
        "chaos": 0.45,
        "drive": 0.92,
        "seed": 0.2,
        "repeatEvery": 32,
        "axes": [0.97, 0.96, 0.93, 0.91, 0.9],
    },
    "output_hashes": {
        "lorenz": "8c22f52d231d76c1b712f8e23449b4b6383ec8d2e376fbd1fb0f24db4ea564f4",
        "harmonic": "109357851e006764b0292f2ad35987fe1e649dd4ad698b197f860bb5140b8736",
        "vanderpol": "898bf5347e5a4a9c1237a496b399df3acf0a42f7390607c7d7238651d735c708",
        "duffing": "aaa392333d8680d70ad33be51cd471c554b62e6b8d9eab197659895cb29df396",
        "lotka": "5189c3ecca14fe1ca3f3c794ad7dce05b134bac1f773b4a6b98c6a08b148c612",
        "nemo": "2b1dd69a8d95b352b91642f7b5202b3b788bf17f398ae9bcab7a90594b10a348",
    },
}

# The IMMUNE-v1 Lotka output hash that nexus <= d087694 would have produced
# (beta = 8/3). ``tests/test_parity.py`` recomputes it by forcing the old beta.
PRE_F05_IMMUNE_V1_LOTKA_HASH = "2bf1f6e2a6f3db9c96c7f04ab0b53db871dfa389c17584d74b4aeada5d074135"

NEMO_BANK_15 = [-64.0, -61.5, -69.0, -57.25, -66.0, -12.8, -12.3, -13.8, -11.45, -13.2, 2.5, 0.0, 7.75, 0.0, 1.25]
NEMO_BANK_20 = [-60.0, -63.0, -71.0, -55.0, -66.5, -12.0, -12.6, -14.2, -11.0, -13.3, 0.0, 4.0, 0.0, 9.5, 0.0, 1.1, 0.9, 1.3, 0.75, 1.0]

# Values whose nine-decimal projection is easy to get wrong: exact binary ties
# (odd multiples of 2^-10), huge magnitudes where toFixed switches to exponent
# form, negative values that round to zero, subnormals.
CANONICAL_NUMBER_SAMPLES: list[float] = [
    0.0,
    -0.0,
    1.0,
    -1.0,
    0.1,
    0.5,
    1 / 3,
    -2 / 3,
    8 / 3,
    22.0,
    -65.0,
    0.0009765625,
    -0.0009765625,
    0.0029296875,
    0.0048828125,
    1.0009765625,
    123.4560009765625,
    -1e-10,
    1e-10,
    5e-10,
    1.0000000005,
    2.0000000005,
    0.1234567895,
    9007199254740993.0,
    1e21,
    -1.5e22,
    1.7976931348623157e308,
    5e-324,
    2.220446049250313e-16,
    60.12345678949999,
    -37.000000000499996,
]
ROUND12_SAMPLES: list[float] = [
    0.1234567890125,
    -0.1234567890125,
    1.0000000000005,
    2.5e-13,
    -4.9e-13,
    123.456789012345678,
    0.000244140625,
    1e21,
]


def _vector(vid: str, method: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {"id": vid, "method": method, "input": payload}


def vector_specs() -> list[dict[str, Any]]:
    specs: list[dict[str, Any]] = []
    for program in PROGRAMS:
        nemo = program == "nemo"
        for method in programs.methods(program):
            base = {"program": program, "mode": "OP", "repeatEvery": 64}
            specs.append(_vector(f"{program}.{method}.nominal", method, {
                **base, "steps": 64 if nemo else 256, "dt": 0.002 if nemo else 0.01,
                "chaos": 0.45, "drive": 0.7, "seed": 0.2,
            }))
            specs.append(_vector(f"{program}.{method}.low", method, {
                **base, "steps": 32 if nemo else 400, "dt": 0.0004,
                "chaos": 0.0, "drive": 0.0, "seed": 0.0,
            }))
            specs.append(_vector(f"{program}.{method}.high", method, {
                **base, "steps": 24 if nemo else 120, "dt": 0.08,
                "chaos": 1.0, "drive": 1.0, "seed": 1.0,
            }))
            specs.append(_vector(f"{program}.{method}.rep", method, {
                **base, "mode": "REP", "steps": 96 if nemo else 300, "repeatEvery": 32 if nemo else 64,
                "dt": 0.004 if nemo else 0.02, "chaos": 0.7, "drive": 0.35, "seed": 0.61,
            }))
    common = {"mode": "OP", "repeatEvery": 64}
    specs += [
        _vector("lorenz.rk4.long", "rk4", {
            **common, "program": "lorenz", "steps": 2400, "dt": 0.02, "chaos": 0.8, "drive": 0.5, "seed": 0.9,
        }),
        _vector("lorenz.euler4.long", "euler4", {
            **common, "program": "lorenz", "steps": 2400, "dt": 0.01, "chaos": 0.6, "drive": 0.5, "seed": 0.33,
        }),
        _vector("lorenz.rk4.state", "rk4", {
            **common, "program": "lorenz", "steps": 200, "dt": 0.01, "chaos": 0.6, "drive": 0.5, "seed": 0.5,
            "state": {"x": -8.5, "y": 3.25, "z": 27.0, "t": 12.5},
        }),
        _vector("harmonic.symplectic.state", "symplectic", {
            **common, "program": "harmonic", "steps": 500, "dt": 0.05, "chaos": 0.9, "drive": 0.2, "seed": 0.1,
            "state": {"x": -0.4, "y": 2.2, "z": 0.0, "t": 3.0},
        }),
        _vector("duffing.symplectic.state", "symplectic", {
            **common, "program": "duffing", "steps": 400, "dt": 0.03, "chaos": 0.69, "drive": 0.8, "seed": 0.3,
            "state": {"x": -1.1, "y": 0.35, "z": 0.5, "t": 7.25},
        }),
        _vector("lotka.rk4.state", "rk4", {
            **common, "program": "lotka", "steps": 1000, "dt": 0.05, "chaos": 0.25, "drive": 0.0, "seed": 0.0,
            "state": {"x": 0.6, "y": 2.4, "z": 0.5, "t": 0.0},
        }),
        _vector("vanderpol.rk4.long", "rk4", {
            **common, "program": "vanderpol", "steps": 2400, "dt": 0.05, "chaos": 0.8, "drive": 0.5, "seed": 0.7,
        }),
        _vector("nemo.euler4.bank15", "euler4", {
            **common, "program": "nemo", "steps": 40, "dt": 0.004, "chaos": 0.3, "drive": 0.9, "seed": 0.4,
            "state": {"x": -64.0, "y": -69.0, "z": 0.2, "t": 0.5, "bank": NEMO_BANK_15},
        }),
        _vector("nemo.euler4.bank20", "euler4", {
            **common, "program": "nemo", "steps": 400, "dt": 0.016, "chaos": 0.55, "drive": 1.0, "seed": 0.8,
            "state": {"x": -60.0, "y": -71.0, "z": 0.0, "t": 0.0, "bank": NEMO_BANK_20},
        }),
        _vector("lorenz.euler4.ic", "euler4", {
            **common, "mode": "IC", "program": "lorenz", "steps": 100, "dt": 0.01, "chaos": 0.5, "drive": 0.5,
            "seed": 0.37,
        }),
        _vector("duffing.rk4.halt", "rk4", {
            **common, "mode": "HALT", "program": "duffing", "steps": 100, "dt": 0.01, "chaos": 0.5,
            "drive": 0.5, "seed": 0.5, "state": {"x": 0.25, "y": -0.5, "z": 0.5, "t": 1.0},
        }),
        # Fail-closed vectors: both bindings must raise the same code.
        _vector("lorenz.euler4.diverge", "euler4", {
            **common, "program": "lorenz", "steps": 60, "dt": 0.08, "chaos": 1.0, "drive": 0.5, "seed": 0.2,
        }),
        _vector("nemo.rk4.unsupported", "rk4", {
            **common, "program": "nemo", "steps": 10, "dt": 0.01, "chaos": 0.5, "drive": 0.5, "seed": 0.5,
        }),
        _vector("lorenz.symplectic.unsupported", "symplectic", {
            **common, "program": "lorenz", "steps": 10, "dt": 0.01, "chaos": 0.5, "drive": 0.5, "seed": 0.5,
        }),
        _vector("nemo.euler4.halt", "euler4", {
            **common, "mode": "HALT", "program": "nemo", "steps": 10, "dt": 0.01, "chaos": 0.5,
            "drive": 0.5, "seed": 0.5, "state": {"x": -60.0, "y": -71.0, "z": 0.0, "t": 0.0, "bank": NEMO_BANK_20},
        }),
    ]
    return specs


def expected_for(spec: dict[str, Any]) -> dict[str, Any]:
    run_input = NexusRunInput.from_dict(spec["input"])
    method = spec["method"]
    out: dict[str, Any] = {"inputHash": input_hash(run_input, method)}
    try:
        out["outputHash"] = output_hash(run_input, method)
    except NexusDynamicsError as error:
        out["error"] = error.code
    return out


def build_document() -> dict[str, Any]:
    vectors = []
    for spec in vector_specs():
        vectors.append({**spec, "expected": expected_for(spec)})
    immune = dict(IMMUNE_V1)
    immune["reproduced"] = {
        program: immune_v1.output_hash(immune_v1.vector_input(IMMUNE_V1["input"], program))
        == IMMUNE_V1["output_hashes"][program]
        for program in PROGRAMS
    }
    return {
        "schema": PARITY_SCHEMA,
        "engine": {
            "name": ENGINE_NAME,
            "version": ENGINE_VERSION,
            "python": "python/nexus_dynamics",
            "typescript": ["src/lib/nexus/math.ts", "src/lib/nexus/dynamics.ts"],
            "generated_by": "python -m nexus_dynamics.parity write (run from python/)",
        },
        "hash": {
            "algorithm": "sha256",
            "text": "compact JSON (separators ',' ':'), keys sorted, UTF-8, non-ASCII unescaped",
            "numbers": f"strings with exactly {CANONICAL_DECIMAL_PLACES} decimals of the exact binary value, "
            "rounded half-to-even (Python format(x, '.9f')); negative zero -> '0.000000000'",
            "non_finite": "NON_FINITE_OUTPUT is raised; NaN/Infinity are never serialized",
            "input_payload": {"schema": "szl.nexus-dynamics-input/v2", "method": "<method>", "input": "<contract input>"},
            "output_payload": "python/nexus_dynamics/run.py deterministic_output == src/lib/nexus/dynamics.ts dynamicsOutput",
            "compatible_with": "IMMUNE nexus_hash (python/immune/nexus.py), identical for every finite value",
        },
        "contract": {
            "path": "contracts/immune-nexus.v1.json",
            "sha256": CONTRACT_SHA256,
            "source": f"szl-holdings/immune@{IMMUNE_REVISION}:contracts/immune-nexus.v1.json",
        },
        "integration": {
            "substeps_per_tick": SUBSTEPS,
            "dt_clamp": [0.0004, 0.08],
            "methods": {method: METHOD_VERSIONS[method] for method in METHODS},
            "method_support": {program: list(programs.methods(program)) for program in PROGRAMS},
            "models": dict(programs.MODELS),
        },
        "intentional_changes": [
            {
                "id": "F-05",
                "kind": "parity version bump",
                "model": "lotka/2",
                "previous_model": "lotka/1",
                "previous": "Lotka-Volterra integrated with beta = 8/3 while the label showed beta = 0.42 + 0.7 * chaos",
                "current": "beta = 0.42 + 0.7 * chaos (the labelled value)",
                "fixed_in": ["server.py:141", "space/server.py:141", "src/lib/nexus/math.ts:123-124"],
                "previous_revision": "d087694088251067992c2fc9966556cae74d9eda",
                "affects": "every lotka trajectory and hash; the other five programs are unchanged",
                "immune": "IMMUNE's import already used the labelled beta, so IMMUNE v1 hashes (kept below) are "
                "reproduced unchanged; the pre-fix nexus engine did not reproduce the v1 lotka hash",
                "pre_fix_immune_v1_lotka_output_hash": PRE_F05_IMMUNE_V1_LOTKA_HASH,
            }
        ],
        "vectors": vectors,
        "canonical_number_vectors": [[value, canonical_number(value)] for value in CANONICAL_NUMBER_SAMPLES],
        "round12_vectors": [[value, round(value, 12)] for value in ROUND12_SAMPLES],
        "provenance": {"immune_v1": immune},
        "boundary": {
            "execution": "MEASURED_SOFTWARE_SIMULATION",
            "physical_hardware": False,
            "external_calls": 0,
            "energy": "UNAVAILABLE",
            "uniqueness": "Conjecture 1 OPEN",
        },
    }


def render(document: dict[str, Any]) -> str:
    return json.dumps(document, indent=2, ensure_ascii=False, allow_nan=False) + "\n"


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check(path: Path) -> list[str]:
    """Return a list of human-readable problems (empty when the file is current)."""
    problems: list[str] = []
    stored = json.loads(path.read_text(encoding="utf-8"))
    fresh = build_document()
    stored_vectors = {vector["id"]: vector for vector in stored.get("vectors", [])}
    for vector in fresh["vectors"]:
        old = stored_vectors.pop(vector["id"], None)
        if old is None:
            problems.append(f"{vector['id']}: missing from file")
        elif old != vector:
            problems.append(f"{vector['id']}: stored {old.get('expected')} != computed {vector['expected']}")
    problems += [f"{vid}: in file but no longer generated" for vid in stored_vectors]
    for key in ("canonical_number_vectors", "round12_vectors", "provenance", "integration", "hash", "contract",
                "intentional_changes", "engine", "schema", "boundary"):
        if stored.get(key) != fresh.get(key):
            problems.append(f"{key}: differs from the generated value")
    if not all(fresh["provenance"]["immune_v1"]["reproduced"].values()):
        problems.append(f"IMMUNE v1 not reproduced: {fresh['provenance']['immune_v1']['reproduced']}")
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m nexus_dynamics.parity")
    parser.add_argument("command", choices=("write", "check"))
    parser.add_argument("--path", type=Path, default=DEFAULT_PATH)
    args = parser.parse_args(argv)
    if args.command == "write":
        text = render(build_document())
        args.path.write_bytes(text.encode("utf-8"))
        print(f"wrote {args.path} sha256={file_sha256(args.path)}")
        return 0
    problems = check(args.path)
    for problem in problems:
        print(problem, file=sys.stderr)
    print(f"{'FAIL' if problems else 'OK'}: {args.path} ({len(problems)} problems)")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
