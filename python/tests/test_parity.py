# SPDX-License-Identifier: Apache-2.0
"""contracts/nexus-parity-v2.json: current, reproducible, and IMMUNE-compatible.

The TypeScript half (src/lib/nexus/parity.test.ts) recomputes the same vectors
from math.ts; together the two suites enforce Python == TS for every vector.
"""
from __future__ import annotations

import dataclasses

import pytest

import nexus_dynamics as nd
from nexus_dynamics import NexusRunInput, immune_v1, parity
from nexus_dynamics.programs import lotka

DOC_VECTORS = parity.vector_specs()


def test_parity_file_is_current() -> None:
    assert parity.check(parity.DEFAULT_PATH) == []


def test_parity_file_is_rendered_deterministically(repo_root) -> None:
    on_disk = (repo_root / "contracts" / "nexus-parity-v2.json").read_text(encoding="utf-8")
    assert parity.render(parity.build_document()) == on_disk


@pytest.mark.parametrize("vector", DOC_VECTORS, ids=[v["id"] for v in DOC_VECTORS])
def test_vector_hash(parity_doc, vector) -> None:
    stored = {v["id"]: v for v in parity_doc["vectors"]}[vector["id"]]
    assert stored["input"] == vector["input"] and stored["method"] == vector["method"]
    assert parity.expected_for(vector) == stored["expected"]


def test_every_program_method_pair_has_an_output_vector(parity_doc) -> None:
    for program in nd.PROGRAMS:
        for method in nd.supported_methods(program):
            assert any(
                v["input"]["program"] == program and v["method"] == method and "outputHash" in v["expected"]
                for v in parity_doc["vectors"]
            ), (program, method)


def test_fail_closed_vectors(parity_doc) -> None:
    errors = {v["id"]: v["expected"]["error"] for v in parity_doc["vectors"] if "error" in v["expected"]}
    assert errors == {
        "lorenz.euler4.diverge": "NON_FINITE_OUTPUT",
        "nemo.rk4.unsupported": "UNSUPPORTED_METHOD",
        "lorenz.symplectic.unsupported": "UNSUPPORTED_METHOD",
    }


@pytest.mark.parametrize("program", nd.PROGRAMS)
def test_reproduces_immune_v1_parity_hashes(program) -> None:
    run_input = immune_v1.vector_input(parity.IMMUNE_V1["input"], program)
    assert immune_v1.output_hash(run_input) == parity.IMMUNE_V1["output_hashes"][program]


def test_immune_v1_provenance_block_is_verbatim(parity_doc) -> None:
    block = dict(parity_doc["provenance"]["immune_v1"])
    assert block.pop("reproduced") == {program: True for program in nd.PROGRAMS}
    assert block == parity.IMMUNE_V1


def test_f05_is_the_only_difference_from_the_pre_fix_engine(monkeypatch, parity_doc) -> None:
    """Forcing the old beta = 8/3 reproduces the recorded pre-fix hash, which
    IMMUNE's v1 vector rejects; the fixed engine matches IMMUNE."""
    change = parity_doc["intentional_changes"][0]
    assert change["id"] == "F-05" and change["model"] == nd.MODELS["lotka"] == "lotka/2"
    run_input = immune_v1.vector_input(parity.IMMUNE_V1["input"], "lotka")
    fixed = immune_v1.output_hash(run_input)
    original = lotka.coefficients
    monkeypatch.setattr(lotka, "coefficients", lambda chaos: dataclasses.replace(original(chaos), beta=8 / 3))
    pre_fix = immune_v1.output_hash(run_input)
    assert pre_fix == change["pre_fix_immune_v1_lotka_output_hash"] == parity.PRE_F05_IMMUNE_V1_LOTKA_HASH
    assert pre_fix != parity.IMMUNE_V1["output_hashes"]["lotka"]
    assert fixed == parity.IMMUNE_V1["output_hashes"]["lotka"]


def test_lotka_beta_matches_its_label() -> None:
    for c in (0.0, 0.25, 0.45, 0.8, 1.0):
        k = nd.coefficients("lotka", c)
        assert k.beta == 0.42 + c * 0.7
        assert k.label.endswith(f"β {k.beta:.2f}")


def test_run_is_deterministic_and_hash_bound_to_input() -> None:
    payload = {"program": "duffing", "mode": "REP", "steps": 300, "dt": 0.02, "chaos": 0.69, "drive": 0.8,
               "seed": 0.3, "repeatEvery": 64}
    run_input = NexusRunInput.from_dict(payload)
    first = nd_run(run_input, "symplectic")
    second = nd_run(run_input, "symplectic")
    assert first == second
    other = nd_run(run_input, "rk4")
    assert other["outputHash"] != first["outputHash"] and other["inputHash"] != first["inputHash"]
    assert first["output"]["repeatCount"] == 4
    assert first["truth"]["energy"] == "UNAVAILABLE" and first["truth"]["uniqueness"] == "Conjecture 1 OPEN"


def nd_run(run_input, method):
    from nexus_dynamics.run import run

    return run(run_input, method)
