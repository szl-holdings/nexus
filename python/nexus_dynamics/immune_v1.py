# SPDX-License-Identifier: Apache-2.0
"""Reproduction of IMMUNE's v1 deterministic output (``szl.immune-nexus-parity/v1``).

IMMUNE (``szl-holdings/immune`` ``python/immune/nexus.py`` ``run_nexus``) hashes
a deterministic output built from an ``euler4`` run of the engine it imported
from nexus@617fb49. Rebuilding that payload from ``nexus_dynamics`` and matching
IMMUNE's published ``contracts/immune-nexus-parity-v1.json`` hashes proves that
this library (and, in ``src/lib/nexus/parity.test.ts``, the TypeScript
instrument engine) computes exactly what the live IMMUNE runtime computes, so
IMMUNE can vendor it instead of hand-porting.

Only ``euler4`` exists in v1. IMMUNE rounds reported numbers to 12 decimals
(``round(x, 12)``) before deriving the read-outs; that is reproduced here.
"""
from __future__ import annotations

import math
from typing import Any

from . import programs
from .analog import (
    analog_circuit,
    analog_correlate,
    analog_jack,
    optical_interfere,
    optical_reconstruct,
    scale,
)
from .canonical import nexus_hash
from .errors import non_finite_output
from .run import MAX_TRAIL_POINTS, simulate
from .schema import NexusRunInput, NexusState

IMMUNE_PARITY_SCHEMA = "szl.immune-nexus-parity/v1"
IMMUNE_SOURCE_REVISION = "617fb49f061c9eb369c4d879a7c29af64c08e72e"
TRUST_CEILING = 0.97


def round12(value: float) -> float:
    if not math.isfinite(value):
        raise non_finite_output("IMMUNE v1 projection")
    rounded = round(value, 12)
    return 0.0 if rounded == 0 else rounded


def rounded_state(state: NexusState) -> NexusState:
    return NexusState(
        x=round12(state.x),
        y=round12(state.y),
        z=round12(state.z),
        t=round12(state.t),
        bank=None if state.bank is None else tuple(round12(value) for value in state.bank),
    )


def lambda_aggregate(axes: tuple[float, ...] | None) -> dict[str, Any]:
    """IMMUNE's MODELED geometric aggregate. Lambda uniqueness is Conjecture 1 OPEN."""
    if axes is None:
        return {"value": None, "blocked": True, "label": "UNAVAILABLE"}
    if not axes or any(not math.isfinite(axis) or axis < 0 or axis > 1 for axis in axes):
        return {"value": 0.0, "blocked": True, "label": "MODELED_FROM_CALLER_AXES"}
    if any(axis == 0 for axis in axes):
        return {"value": 0.0, "blocked": True, "label": "MODELED_FROM_CALLER_AXES"}
    weight = 1 / len(axes)
    raw = math.exp(sum(weight * math.log(axis) for axis in axes))
    return {"value": min(TRUST_CEILING, raw), "blocked": False, "label": "MODELED_FROM_CALLER_AXES"}


def ouroboros_tax(amplitude: float, bars: int = 8) -> float:
    bounded = max(1, min(64, int(bars)))
    return max(0.0, amplitude * math.exp(-bounded / 8))


def deterministic_output(run_input: NexusRunInput) -> dict[str, Any]:
    program = run_input.program
    sim = simulate(run_input, "euler4")
    # IMMUNE rounds every trail point on the way; rounding also enforces finiteness.
    for point in sim.trail:
        for value in point:
            round12(value)
    final = rounded_state(sim.final_state)
    raw = scale(program, final)
    normalized = {"x": round12(raw["x"]), "y": round12(raw["y"]), "z": round12(raw["z"])}
    object_amplitude = max(0.0, 0.5 + 0.5 * math.hypot(normalized["x"], normalized["y"]))
    reference_amplitude = max(0.0, 0.35 + 0.55 * normalized["z"])
    phase_difference = math.atan2(normalized["y"], normalized["x"] + 1e-9)
    intensity = optical_interfere(object_amplitude, phase_difference, reference_amplitude, 0.0)
    reconstruct = optical_reconstruct(intensity, phase_difference)
    corr = analog_correlate(normalized["x"], normalized["y"], 0.0, run_input.dt)
    circuit_base = analog_circuit(normalized["x"], normalized["y"], normalized["z"], corr)
    circuit = {key: round12(value) for key, value in circuit_base.items()}
    circuit["jack"] = round12(analog_jack(circuit_base, reconstruct, run_input.drive))
    lotka_first_quadrant = (final.x > 0 and final.y > 0) if program == "lotka" else None
    nemo_bank_bounded = programs.nemo.bank_bounded(final.bank or ()) if program == "nemo" else None
    finite_state = final.is_finite()
    trail_bounded = len(sim.trail) <= MAX_TRAIL_POINTS + 1
    invariants = {
        "finiteState": finite_state,
        "lotkaFirstQuadrant": lotka_first_quadrant,
        "nemoBankBounded": nemo_bank_bounded,
        "trailBounded": trail_bounded,
        "externalCallsZero": True,
        "executableSoftwareNotHardware": True,
        "allHold": (
            finite_state
            and trail_bounded
            and lotka_first_quadrant is not False
            and nemo_bank_bounded is not False
        ),
    }
    return {
        "schema": IMMUNE_PARITY_SCHEMA,
        "sourceRevision": IMMUNE_SOURCE_REVISION,
        "program": program,
        "mode": run_input.mode,
        "stepsExecuted": sim.steps_executed,
        "repeatCount": sim.repeat_count,
        "finalState": final.to_dict(),
        "normalized": normalized,
        "optics": {
            "objectAmplitude": round12(object_amplitude),
            "referenceAmplitude": round12(reference_amplitude),
            "phaseDifference": round12(phase_difference),
            "intensity": round12(intensity),
            "reconstruct": round12(reconstruct),
        },
        "circuit": circuit,
        "lambda": lambda_aggregate(run_input.axes),
        "ouroborosTax": round12(ouroboros_tax(abs(reconstruct))),
        "invariants": invariants,
    }


def output_hash(run_input: NexusRunInput) -> str:
    return nexus_hash(deterministic_output(run_input))


def vector_input(vector: dict[str, Any], program: str) -> NexusRunInput:
    """Expand IMMUNE's compact parity-v1 ``input`` block for one program."""
    nemo = program == "nemo"
    payload: dict[str, Any] = {
        "program": program,
        "mode": vector["mode"],
        "steps": vector["steps_nemo"] if nemo else vector["steps_standard"],
        "dt": vector["dt_nemo"] if nemo else vector["dt_standard"],
        "chaos": vector["chaos"],
        "drive": vector["drive"],
        "seed": vector["seed"],
        "repeatEvery": vector["repeatEvery"],
    }
    if "axes" in vector:
        payload["axes"] = vector["axes"]
    return NexusRunInput.from_dict(payload)
