# SPDX-License-Identifier: Apache-2.0
"""Deterministic runs and the v2 parity output.

``simulate`` executes the four contract modes exactly as IMMUNE's
``_sample_trail`` does (IC -> seed, HALT -> initial state, OP -> ``steps``
ticks, REP -> reseed every ``repeatEvery`` ticks with nudge
``(seed + n * 0.137) % 1``), with a selectable integration method.

``deterministic_output`` is the v2 parity payload hashed by
``contracts/nexus-parity-v2.json``: program model version, integrator version,
mode, steps, the full final state and a strided trail (at most 257 points), plus
the invariant booleans. It carries no source revision, so the hashes change only
when the mathematics (or a declared model/integrator version) changes.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from . import programs
from .canonical import nexus_hash
from .integrators import METHOD_VERSIONS, check_method, step_with_events
from .schema import NexusRunInput, NexusState

INPUT_SCHEMA = "szl.nexus-dynamics-input/v2"
OUTPUT_SCHEMA = "szl.nexus-dynamics-output/v2"
RUN_SCHEMA = "szl.nexus-dynamics-run/v2"
MAX_TRAIL_POINTS = 256
REPEAT_NUDGE = 0.137


@dataclass(frozen=True)
class Simulation:
    initial_state: NexusState
    final_state: NexusState
    trail: tuple[tuple[float, float, float], ...]
    steps_executed: int
    repeat_count: int
    spikes: int


def initial_state(run_input: NexusRunInput) -> NexusState:
    if run_input.state is not None:
        return run_input.state
    return programs.seed(run_input.program, run_input.seed)


def simulate(run_input: NexusRunInput, method: str = "euler4") -> Simulation:
    program = run_input.program
    check_method(program, method)
    initial = initial_state(run_input)
    if run_input.mode == "IC":
        return Simulation(initial, programs.seed(program, run_input.seed), (), 0, 0, 0)
    if run_input.mode == "HALT":
        return Simulation(initial, initial, (), 0, 0, 0)
    state = initial
    trail: list[tuple[float, float, float]] = []
    steps = run_input.steps
    stride = max(1, math.ceil(max(1, steps) / MAX_TRAIL_POINTS))
    repeat_count = 0
    spikes = 0
    for index in range(steps):
        if run_input.mode == "REP" and index > 0 and index % run_input.repeat_every == 0:
            repeat_count += 1
            state = programs.seed(program, (run_input.seed + repeat_count * REPEAT_NUDGE) % 1)
        state, fired = step_with_events(
            program, state, run_input.dt, run_input.chaos, run_input.drive, method
        )
        spikes += fired
        if index % stride == 0 or index == steps - 1:
            trail.append((state.x, state.y, state.z))
    return Simulation(initial, state, tuple(trail), steps, repeat_count, spikes)


def invariants(program: str, sim: Simulation) -> dict[str, Any]:
    final = sim.final_state
    finite_state = final.is_finite()
    lotka_first_quadrant = (final.x > 0 and final.y > 0) if program == "lotka" else None
    nemo_bank_bounded = (
        programs.nemo.bank_bounded(final.bank or ()) if program == "nemo" else None
    )
    trail_bounded = len(sim.trail) <= MAX_TRAIL_POINTS + 1
    return {
        "finiteState": finite_state,
        "lotkaFirstQuadrant": lotka_first_quadrant,
        "nemoBankBounded": nemo_bank_bounded,
        "trailBounded": trail_bounded,
        "allHold": (
            finite_state
            and trail_bounded
            and lotka_first_quadrant is not False
            and nemo_bank_bounded is not False
        ),
    }


def input_payload(run_input: NexusRunInput, method: str) -> dict[str, Any]:
    return {"schema": INPUT_SCHEMA, "method": method, "input": run_input.to_dict()}


def deterministic_output(run_input: NexusRunInput, method: str = "euler4") -> dict[str, Any]:
    sim = simulate(run_input, method)
    return _output(run_input, method, sim)


def _output(run_input: NexusRunInput, method: str, sim: Simulation) -> dict[str, Any]:
    program = run_input.program
    return {
        "schema": OUTPUT_SCHEMA,
        "program": program,
        "model": programs.MODELS[program],
        "method": method,
        "integrator": METHOD_VERSIONS[method],
        "mode": run_input.mode,
        "stepsExecuted": sim.steps_executed,
        "repeatCount": sim.repeat_count,
        "finalState": sim.final_state.to_dict(),
        "trail": [list(point) for point in sim.trail],
        "invariants": invariants(program, sim),
    }


def input_hash(run_input: NexusRunInput, method: str = "euler4") -> str:
    return nexus_hash(input_payload(run_input, method))


def output_hash(run_input: NexusRunInput, method: str = "euler4") -> str:
    return nexus_hash(deterministic_output(run_input, method))


def run(run_input: NexusRunInput, method: str = "euler4") -> dict[str, Any]:
    """Execute and hash one run. Raises ``NexusDynamicsError`` on any failure."""
    from . import ENGINE_NAME, ENGINE_VERSION

    sim = simulate(run_input, method)
    output = _output(run_input, method, sim)
    return {
        "schema": RUN_SCHEMA,
        "engine": {"name": ENGINE_NAME, "version": ENGINE_VERSION},
        "truth": {
            "execution": "MEASURED_SOFTWARE_SIMULATION",
            "physicalHardware": False,
            "energy": "UNAVAILABLE",
            "uniqueness": "Conjecture 1 OPEN",
        },
        "coefficients": programs.coefficients(run_input.program, run_input.chaos).to_dict(),
        "initialState": sim.initial_state.to_dict(),
        "output": output,
        "inputHash": nexus_hash(input_payload(run_input, method)),
        "outputHash": nexus_hash(output),
    }
