# SPDX-License-Identifier: Apache-2.0
"""Integrators: instrument compatibility, method matrix, fail-closed, order of accuracy."""
from __future__ import annotations

import dataclasses
import math

import pytest
from hypothesis import example, given, settings
from hypothesis import strategies as st

import nexus_dynamics as nd
from nexus_dynamics import NexusDynamicsError, NexusState
from nexus_dynamics._num import clamp01
from nexus_dynamics.analog import analog_circuit, analog_jack
from nexus_dynamics.integrators import SUBSTEPS, advance, rk4_substep, step_with_events
from nexus_dynamics.programs import duffing, harmonic, lotka
from nexus_dynamics.schema import DT_MAX, DT_MIN

unit = st.floats(min_value=0.0, max_value=1.0)
dts = st.floats(min_value=0.0004, max_value=0.08)


# ---------------------------------------------------------------- instrument compatibility


@settings(max_examples=40)
@given(program=st.sampled_from(nd.PROGRAMS), chaos=unit, drive=unit, seed=unit, dt=dts)
def test_euler4_is_bit_identical_to_the_hologram_server(hologram_server, program, chaos, drive, seed, dt) -> None:
    """euler4 == server.py analog_step (itself a line-by-line port of math.ts analogStep)."""
    ours = nd.seed(program, seed)
    theirs = hologram_server.seed_analog(program, seed)
    assert ours.to_dict() == {k: v for k, v in theirs.items()}
    ticks = 12 if program == "nemo" else 60
    for _ in range(ticks):
        try:
            ours = nd.step(program, ours, dt, chaos, drive, "euler4")
        except NexusDynamicsError as error:
            assert error.code == "NON_FINITE_OUTPUT"
            return  # server.py reseeds instead; strict binding fails closed
        theirs = hologram_server.analog_step(program, theirs, dt, chaos, drive)
        assert ours.to_dict() == theirs


def test_hologram_lotka_uses_the_fixed_beta(hologram_server, repo_root) -> None:
    for c in (0.0, 0.3, 0.45, 1.0):
        pots = hologram_server.analog_coefficients(c, "lotka")
        assert pots["beta"] == 0.42 + c * 0.7 == nd.coefficients("lotka", c).beta
        assert pots["label"].endswith(f"β {pots['beta']:.2f}")
    # space/server.py is the Docker projection copy and must stay byte-identical.
    assert (repo_root / "space" / "server.py").read_bytes() == (repo_root / "server.py").read_bytes()


def test_coefficients_and_seeds_match_the_hologram(hologram_server) -> None:
    for program in nd.PROGRAMS:
        for c in (0.0, 0.37, 1.0):
            theirs = hologram_server.analog_coefficients(c, program)
            ours = nd.coefficients(program, c).to_dict()
            assert {k: ours[k] for k in theirs if k != "label"} == {k: theirs[k] for k in theirs if k != "label"}


# ---------------------------------------------------------------- method matrix / fail closed


def test_method_support_matrix() -> None:
    assert nd.supported_methods("lorenz") == ("euler4", "rk4")
    assert nd.supported_methods("harmonic") == ("euler4", "rk4", "symplectic")
    assert nd.supported_methods("vanderpol") == ("euler4", "rk4")
    assert nd.supported_methods("duffing") == ("euler4", "rk4", "symplectic")
    assert nd.supported_methods("lotka") == ("euler4", "rk4")
    assert nd.supported_methods("nemo") == ("euler4",)
    assert nd.METHOD_VERSIONS == {"euler4": "euler4/1", "rk4": "rk4/1", "symplectic": "strang-verlet/1"}
    assert nd.MODELS["lotka"] == "lotka/2"


@pytest.mark.parametrize(
    ("program", "method", "code"),
    [
        ("nemo", "rk4", "UNSUPPORTED_METHOD"),
        ("nemo", "symplectic", "UNSUPPORTED_METHOD"),
        ("lorenz", "symplectic", "UNSUPPORTED_METHOD"),
        ("lotka", "symplectic", "UNSUPPORTED_METHOD"),
        ("vanderpol", "symplectic", "UNSUPPORTED_METHOD"),
        ("lorenz", "rk45", "UNKNOWN_METHOD"),
        ("chua", "rk4", "UNKNOWN_PROGRAM"),
    ],
)
def test_unsupported_combinations_fail_closed(program, method, code) -> None:
    with pytest.raises(NexusDynamicsError) as caught:
        nd.step(program, NexusState(0.1, 0.1, 0.1, 0.0), 0.01, 0.5, 0.5, method)
    assert caught.value.code == code


def test_euler4_lorenz_divergence_raises_non_finite_output() -> None:
    """Forward Euler at rho=40, h=0.02 blows up; the binding never returns NaN/Inf."""
    state = nd.seed("lorenz", 0.2)
    with pytest.raises(NexusDynamicsError) as caught:
        for _ in range(60):
            state = nd.step("lorenz", state, 0.08, 1.0, 0.5, "euler4")
    assert caught.value.code == "NON_FINITE_OUTPUT"
    # rk4 is stable on the same run.
    state = nd.seed("lorenz", 0.2)
    for _ in range(60):
        state = nd.step("lorenz", state, 0.08, 1.0, 0.5, "rk4")
    assert state.is_finite()


@pytest.mark.parametrize("method", ["euler4", "rk4"])
def test_overflow_raises_non_finite_output(method) -> None:
    with pytest.raises(NexusDynamicsError) as caught:
        nd.step("vanderpol", NexusState(1e300, 1e300, 0.0, 0.0), 0.08, 1.0, 0.5, method)
    assert caught.value.code == "NON_FINITE_OUTPUT"


def test_non_finite_inputs_are_rejected() -> None:
    for bad in (math.nan, math.inf):
        with pytest.raises(NexusDynamicsError) as caught:
            nd.step("duffing", NexusState(bad, 0.0, 0.0, 0.0), 0.01, 0.5)
        assert caught.value.code == "NON_FINITE_NUMBER"
        with pytest.raises(NexusDynamicsError) as caught:
            nd.step("duffing", nd.seed("duffing"), bad, 0.5)
        assert caught.value.code == "NON_FINITE_NUMBER"
    bank = list(nd.seed("nemo").bank or ())
    bank[3] = math.nan
    with pytest.raises(NexusDynamicsError) as caught:
        nd.step("nemo", NexusState(-65, -70, 0.0, 0.0, tuple(bank)), 0.01, 0.5)
    assert caught.value.code == "NON_FINITE_NUMBER"


NON_FINITE = [pytest.param(math.nan, id="nan"), pytest.param(math.inf, id="inf"), pytest.param(-math.inf, id="-inf")]
PROGRAM_METHODS = [(program, method) for program in nd.PROGRAMS for method in nd.supported_methods(program)]


@pytest.mark.parametrize(("program", "method"), PROGRAM_METHODS)
@pytest.mark.parametrize("field", ["x", "y", "z", "t"])
@pytest.mark.parametrize("bad", NON_FINITE)
def test_non_finite_state_fields_are_rejected_for_every_method(program, method, field, bad) -> None:
    state = dataclasses.replace(nd.seed(program, 0.3), **{field: bad})
    with pytest.raises(NexusDynamicsError) as caught:
        nd.step(program, state, 0.01, 0.5, 0.5, method)
    assert caught.value.code == "NON_FINITE_NUMBER"


@pytest.mark.parametrize("program", nd.PROGRAMS)
@pytest.mark.parametrize("name", ["dt", "chaos", "drive"])
@pytest.mark.parametrize("bad", [*NON_FINITE, pytest.param(True, id="bool"), pytest.param("0.5", id="string")])
def test_non_finite_or_non_number_scalars_are_rejected(program, name, bad) -> None:
    args = {"dt": 0.01, "chaos": 0.5, "drive": 0.5, name: bad}
    with pytest.raises(NexusDynamicsError) as caught:
        nd.step(program, nd.seed(program, 0.3), **args)
    assert caught.value.code == "NON_FINITE_NUMBER"


def _bits(state: NexusState) -> tuple[str, ...]:
    """Bitwise identity of every state value (float.hex also tells -0.0 from 0.0)."""
    return tuple(float(value).hex() for value in state.values())


@pytest.mark.parametrize(("program", "method"), [(p, m) for p, m in PROGRAM_METHODS if p != "nemo"])
def test_step_dt_outside_contract_is_clamped_like_the_instrument(program, method) -> None:
    """step() clamps an out-of-contract dt exactly like the instrument; it does not reject it.

    substep_size is Math.max(0.0004, Math.min(0.08, dt)) / 4, as in
    src/lib/nexus/math.ts (both dt clamps) and server.py analog_step. This is
    the instrument clamp shared by all methods (integrators module docstring);
    it is audio parity for euler4 only. The test pins today's behaviour and
    changes nothing; it is not a contract. Requests are still range-checked at
    the contract boundary (test_schema: dt -0.01 and 0.0 are OUT_OF_RANGE).

    TODO(owner decision D7): should step() reject a dt outside the contract
    range (for rk4 and symplectic at least) instead of clamping it? If so,
    replace this pin with a fail-closed test; a failure here after that change
    is the intended update, not a regression.
    """
    state = nd.seed(program, 0.3)
    low = _bits(nd.step(program, state, DT_MIN, 0.5, 0.7, method))
    for dt in (-0.01, -1e300, -0.0, 0.0, 1e-9, DT_MIN / 2):
        assert _bits(nd.step(program, state, dt, 0.5, 0.7, method)) == low, dt
    high = _bits(nd.step(program, state, DT_MAX, 0.5, 0.7, method))
    for dt in (0.0800001, 1.0, 1e300):
        assert _bits(nd.step(program, state, dt, 0.5, 0.7, method)) == high, dt


def test_nemo_step_dt_is_clamped_to_its_own_instrument_range() -> None:
    """NEMO clamps the tick to 0.25..80 ms (math.ts analogNemoTick, server.py analog_nemo_step), not 0.4..80 ms.

    Pinned as instrument parity: any dt below 0.25 ms runs a 0.25 ms tick, which
    is shorter than the contract minimum dt (0.4 ms). Requests never reach it,
    because the contract rejects dt < 0.0004.

    Both ends are anchored. The references are dt = 0.00025 and dt = DT_MAX,
    because 0.00025 * 1000 == 0.25 and 0.08 * 1000 == 80.0 exactly in binary
    floating point. A dt just outside an end must give the reference tick, and a
    dt just inside it (0.2500001 ms, 79.9999 ms) must not. Together these hold
    the floor in [0.25, 0.2500001) ms and the ceiling in (79.9999, 80] ms.
    """
    state = nd.seed("nemo", 0.3)
    floor = _bits(nd.step("nemo", state, 0.00025, 0.45, 0.7))
    for dt in (0.0002499999, 0.0002, 1e-9, 0.0, -0.0, -0.01):
        assert _bits(nd.step("nemo", state, dt, 0.45, 0.7)) == floor, dt
    for dt in (0.0002500001, DT_MIN):
        assert _bits(nd.step("nemo", state, dt, 0.45, 0.7)) != floor, dt
    high = _bits(nd.step("nemo", state, DT_MAX, 0.45, 0.7))
    for dt in (0.0800001, 1.0, 1e300):
        assert _bits(nd.step("nemo", state, dt, 0.45, 0.7)) == high, dt
    assert _bits(nd.step("nemo", state, 0.0799999, 0.45, 0.7)) != high


@pytest.mark.parametrize("length", [0, 3, 14, 16, 19, 21, 25])
def test_nemo_bank_of_wrong_length_is_rejected_at_step(length) -> None:
    state = NexusState(-65.0, -70.0, 0.06, 0.0, tuple([0.0] * length))
    with pytest.raises(NexusDynamicsError) as caught:
        nd.step("nemo", state, 0.01, 0.5)
    assert caught.value.code == "INVALID_NEMO_BANK"


@pytest.mark.parametrize("program", nd.PROGRAMS)
@pytest.mark.parametrize(
    "state",
    [(1.0, 0.0, 0.0, 0.0), [1.0, 0.0, 0.0, 0.0], {"x": 1.0, "y": 0.0, "z": 0.0, "t": 0.0}, None, "state"],
    ids=["tuple", "list", "dict", "none", "str"],
)
def test_non_nexus_state_is_rejected_as_invalid_state(program, state) -> None:
    """Owner decision D1: a state that is not a NexusState raises a typed INVALID_STATE.

    Before D1 this failed with an untyped AttributeError from state.is_finite.
    INVALID_STATE is the code the contract boundary already uses for a state
    that is not an object (test_schema).
    """
    with pytest.raises(NexusDynamicsError) as caught:
        nd.step(program, state, 0.01, 0.5)
    assert caught.value.code == "INVALID_STATE"


NON_NUMBER = [
    pytest.param(True, id="true"),
    pytest.param(False, id="false"),
    pytest.param("0.5", id="string"),
    pytest.param(None, id="none"),
]


@pytest.mark.parametrize(("program", "method"), PROGRAM_METHODS)
@pytest.mark.parametrize("field", ["x", "y", "z", "t"])
@pytest.mark.parametrize("bad", NON_NUMBER)
def test_non_number_state_fields_are_rejected_as_invalid_state(program, method, field, bad) -> None:
    """Owner decision D1: a bool (or any non-number) coordinate raises INVALID_STATE.

    Before D1 a bool coordinate was accepted as 0 or 1, and a string or None
    failed with an untyped TypeError. A NaN or infinite coordinate still raises
    NON_FINITE_NUMBER (test_non_finite_state_fields_are_rejected_for_every_method).
    """
    state = dataclasses.replace(nd.seed(program, 0.3), **{field: bad})
    with pytest.raises(NexusDynamicsError) as caught:
        nd.step(program, state, 0.01, 0.5, 0.5, method)
    assert caught.value.code == "INVALID_STATE"


@pytest.mark.parametrize(("program", "method"), PROGRAM_METHODS)
def test_int_state_fields_are_still_accepted(program, method) -> None:
    """D1 rejects bools, not ints: an int coordinate (a JSON number) steps like the equal float."""
    floats = nd.seed(program, 0.0)
    ints = dataclasses.replace(floats, x=int(round(floats.x)), y=int(round(floats.y)), z=0, t=0)
    as_floats = dataclasses.replace(floats, x=float(ints.x), y=float(ints.y), z=0.0, t=0.0)
    assert all(type(v) is int for v in (ints.x, ints.y, ints.z, ints.t))
    assert _bits(nd.step(program, ints, 0.01, 0.5, 0.5, method)) == _bits(
        nd.step(program, as_floats, 0.01, 0.5, 0.5, method)
    )


@pytest.mark.parametrize("bad", NON_NUMBER)
def test_non_number_nemo_bank_cells_are_rejected_as_invalid_state(bad) -> None:
    """Owner decision D1 for the bank: a bool or other non-number cell raises INVALID_STATE."""
    seeded = nd.seed("nemo", 0.3)
    bank = list(seeded.bank or ())
    bank[7] = bad
    with pytest.raises(NexusDynamicsError) as caught:
        nd.step("nemo", dataclasses.replace(seeded, bank=tuple(bank)), 0.01, 0.5)
    assert caught.value.code == "INVALID_STATE"


@pytest.mark.parametrize(
    "bank",
    ["v" * 20, 1.0, {index: 0.0 for index in range(20)}],
    ids=["str", "float", "dict"],
)
def test_nemo_bank_that_is_not_a_tuple_or_list_is_rejected_as_invalid_state(bank) -> None:
    """Before D1 a 20-key dict bank ran on its keys and a str or float bank raised TypeError."""
    state = dataclasses.replace(nd.seed("nemo", 0.3), bank=bank)
    with pytest.raises(NexusDynamicsError) as caught:
        nd.step("nemo", state, 0.01, 0.5)
    assert caught.value.code == "INVALID_STATE"


# ---------------------------------------------------------------- NaN propagation (owner decision D2)

# Math.min(1, Math.max(0, v)) in JavaScript (src/lib/nexus/math.ts clamp01),
# recorded with Node 24 for each input. -0 gives +0 there, and here.
JS_CLAMP01 = [
    (-0.0, 0.0),
    (0.0, 0.0),
    (1.0, 1.0),
    (-1.0, 0.0),
    (2.0, 1.0),
    (math.inf, 1.0),
    (-math.inf, 0.0),
    (0.5, 0.5),
    (5e-324, 5e-324),
    (-5e-324, 0.0),
    (1 - 2**-53, 1 - 2**-53),
]


def test_clamp01_propagates_nan_like_math_ts() -> None:
    assert math.isnan(clamp01(math.nan))
    for value, expected in JS_CLAMP01:
        assert clamp01(value).hex() == expected.hex(), value


@example(-0.0)
@example(0.0)
@example(1.0)
@example(math.inf)
@example(-math.inf)
@given(st.floats(allow_nan=False))
def test_clamp01_is_bit_identical_to_the_old_formula_off_nan(value) -> None:
    """D2 changes only NaN: every other input keeps the exact float, -0.0 included."""
    assert clamp01(value).hex() == min(1.0, max(0.0, value)).hex()


# Pots that are NaN in analogCoefficients(NaN, program) in src/lib/nexus/math.ts,
# recorded with Node 24 (the label is a string and is left out).
TS_NAN_POTS = {
    "lorenz": {"rho"},
    "harmonic": {"rho", "omega"},
    "vanderpol": {"rho", "mu"},
    "duffing": {"rho", "delta", "gamma"},
    "lotka": {"rho", "beta", "delta", "alpha"},
    "nemo": {"rho", "mu", "delta", "gamma"},
}


@pytest.mark.parametrize("program", nd.PROGRAMS)
def test_coefficients_propagate_a_nan_chaos(program) -> None:
    """D2: chaos = NaN gives NaN in exactly the chaos-dependent pots, as math.ts does.

    Before D2, clamp01 masked NaN to 0, so coefficients(p, nan) equalled
    coefficients(p, 0.0). The pots that do not depend on chaos are unchanged.
    """
    pots = nd.coefficients(program, math.nan).to_dict()
    low = nd.coefficients(program, 0.0).to_dict()
    high = nd.coefficients(program, 1.0).to_dict()
    numeric = [key for key in pots if key != "label"]
    nan_pots = {key for key in numeric if math.isnan(pots[key])}
    assert nan_pots == TS_NAN_POTS[program]
    assert nan_pots == {key for key in numeric if low[key] != high[key]}
    assert all(pots[key] == low[key] for key in numeric if key not in nan_pots)


@pytest.mark.parametrize(("program", "method"), [(p, m) for p, m in PROGRAM_METHODS if p != "nemo"])
def test_advance_with_nan_chaos_fails_closed(program, method) -> None:
    """D2: advance(chaos=nan) raises NON_FINITE_OUTPUT; before D2 it silently ran chaos = 0.

    step() still rejects a NaN chaos up front with NON_FINITE_NUMBER
    (test_non_finite_or_non_number_scalars_are_rejected).
    """
    with pytest.raises(NexusDynamicsError) as caught:
        advance(program, nd.seed(program, 0.3), 0.005, SUBSTEPS, math.nan, 0.7, method)
    assert caught.value.code == "NON_FINITE_OUTPUT"


def test_analog_jack_with_nan_drive_matches_math_ts() -> None:
    """D2: analogJack(analogCircuit(0.6, 0.3, 0.2), 0.4, NaN) is 0 in math.ts (recorded with
    Node 24). Before D2 the Python port masked the NaN drive to 0 and returned 0.33."""
    circuit = analog_circuit(0.6, 0.3, 0.2)
    assert analog_jack(circuit, 0.4, 0.0) == pytest.approx(0.33, abs=1e-15)
    assert analog_jack(circuit, 0.4, math.nan) == 0.0


@settings(max_examples=60)
@given(
    program=st.sampled_from(nd.PROGRAMS),
    x=st.floats(-1e154, 1e154),
    y=st.floats(-1e154, 1e154),
    z=st.floats(-1e154, 1e154),
    chaos=unit,
    drive=unit,
    dt=dts,
    data=st.data(),
)
def test_never_returns_non_finite(program, x, y, z, chaos, drive, dt, data) -> None:
    """Whatever finite state comes in: a finite state comes out, or NON_FINITE_OUTPUT."""
    method = data.draw(st.sampled_from(nd.supported_methods(program)))
    bank = None
    if program == "nemo":
        bank = tuple(data.draw(st.lists(st.floats(-1e154, 1e154), min_size=20, max_size=20)))
    state = NexusState(x, y, z, 0.0, bank)
    try:
        for _ in range(3):
            state = nd.step(program, state, dt, chaos, drive, method)
    except NexusDynamicsError as error:
        assert error.code == "NON_FINITE_OUTPUT"
        return
    assert state.is_finite()


# ---------------------------------------------------------------- order of accuracy


def _trajectory(program, method, h, horizon, chaos, drive, every=0.1, initial=None):
    """Sample a common grid; never round a nondivisible interval into a shorter run."""
    assert all(math.isfinite(v) and v > 0 for v in (h, horizon, every))
    per = round(every / h)
    count = round(horizon / every)
    assert per > 0 and math.isclose(per * h, every, rel_tol=1e-12, abs_tol=0), "every must be divisible by h"
    assert count > 0 and math.isclose(count * every, horizon, rel_tol=1e-12, abs_tol=0), "horizon must be divisible by every"
    state = nd.seed(program, 0.3) if initial is None else initial
    start = state.t
    points = []
    for i in range(1, count + 1):
        state = advance(program, state, h, per, chaos, drive, method)
        assert math.isclose(state.t, start + i * every, rel_tol=0, abs_tol=1e-10), "incorrect sample time"
        points.append(state)
    assert len(points) == count
    assert math.isclose(points[-1].t, start + horizon, rel_tol=0, abs_tol=1e-10), "incorrect final time"
    return points


def _sup_error(a, b) -> float:
    assert len(a) == len(b) > 0, "trajectory lengths must match and be nonzero"
    assert all(math.isclose(p.t, q.t, rel_tol=0, abs_tol=1e-10) for p, q in zip(a, b)), "sample times must match"
    return max(max(abs(p.x - q.x), abs(p.y - q.y), abs(p.z - q.z)) for p, q in zip(a, b))


def _assert_error_ratios(errors, order, tolerance) -> None:
    assert len(errors) >= 3 and all(math.isfinite(e) and e > 0 for e in errors), errors
    ratios = [coarse / fine for coarse, fine in zip(errors, errors[1:])]
    assert all(abs(ratio - 2**order) <= tolerance for ratio in ratios), (errors, ratios)


def test_trajectory_covers_the_requested_common_grid() -> None:
    for h in (0.02, 0.01, 0.005):
        points = _trajectory("harmonic", "rk4", h, 4.0, 0.5, 0.7)
        assert len(points) == 40
        assert [p.t for p in points] == pytest.approx(
            [i * 0.1 for i in range(1, 41)], rel=0, abs=1e-10,
        )


@pytest.mark.parametrize(("h", "horizon", "every"), [(0.02, 4.0, 0.05), (0.02, 0.35, 0.1)])
def test_trajectory_rejects_nondivisible_grids(h, horizon, every) -> None:
    # The first case previously rounded 2.5 substeps to 2 and ended at t=3.2.
    with pytest.raises(AssertionError, match="divisib"):
        _trajectory("harmonic", "rk4", h, horizon, 0.5, 0.7, every=every)


def test_trajectory_detects_under_advance(monkeypatch) -> None:
    real_advance = advance

    def under_advance(program, state, h, substeps, chaos, drive, method):
        return real_advance(program, state, h, substeps - 1, chaos, drive, method)

    monkeypatch.setitem(_trajectory.__globals__, "advance", under_advance)
    with pytest.raises(AssertionError, match="sample time"):
        _trajectory("harmonic", "rk4", 0.02, 4.0, 0.5, 0.7, every=0.1)


def test_sup_error_rejects_unequal_lengths() -> None:
    state = NexusState(1.0, 0.5, 0.0, 0.1)
    with pytest.raises(AssertionError, match="length"):
        _sup_error([state, state], [state])


def test_sup_error_rejects_misaligned_times() -> None:
    with pytest.raises(AssertionError, match="sample time"):
        _sup_error([NexusState(1.0, 0.5, 0.0, 0.1)], [NexusState(1.0, 0.5, 0.0, 0.08)])


def test_error_ratios_reject_a_bad_first_refinement() -> None:
    # The final ratio is exactly 2, but the first refinement has the wrong order.
    with pytest.raises(AssertionError):
        _assert_error_ratios([12.0, 8.0, 4.0], order=1, tolerance=0.3)


ORDER_CASES = [
    (program, chaos)
    for program in ("lorenz", "harmonic", "vanderpol", "duffing", "lotka")
    for chaos in (0.2, 0.8)
]


@pytest.mark.parametrize(("program", "chaos"), ORDER_CASES)
def test_rk4_error_ratio_is_16_when_h_halves(program, chaos) -> None:
    horizon, hs = (1.0, (0.01, 0.005, 0.0025)) if program == "lorenz" else (4.0, (0.02, 0.01, 0.005))
    reference = _trajectory(program, "rk4", hs[-1] / 64, horizon, chaos, 0.7)
    errors = [_sup_error(_trajectory(program, "rk4", h, horizon, chaos, 0.7), reference) for h in hs]
    _assert_error_ratios(errors, order=4, tolerance=1.5)


@pytest.mark.parametrize(("program", "method", "order"), [
    ("harmonic", "euler4", 1), ("vanderpol", "euler4", 1), ("duffing", "euler4", 1), ("lotka", "euler4", 1),
    ("harmonic", "symplectic", 2), ("duffing", "symplectic", 2),
])
def test_other_methods_have_their_expected_order(program, method, order) -> None:
    horizon, hs = 4.0, (0.02, 0.01, 0.005)
    reference = _trajectory(program, "rk4", hs[-1] / 64, horizon, 0.5, 0.7)
    errors = [_sup_error(_trajectory(program, method, h, horizon, 0.5, 0.7), reference) for h in hs]
    _assert_error_ratios(errors, order=order, tolerance=0.3 * order)


def _harmonic_exact(initial, omega, t) -> NexusState:
    """Independent solution of x' = y, y' = -omega**2*x, with z constant."""
    phase = omega * (t - initial.t)
    c, s = math.cos(phase), math.sin(phase)
    return NexusState(
        initial.x * c + initial.y / omega * s,
        initial.y * c - omega * initial.x * s,
        initial.z, t,
    )


@pytest.mark.parametrize(("chaos", "omega"), [(0.0, 1.0), (0.5, 2.5), (1.0, 4.0)])
@pytest.mark.parametrize(("x0", "y0"), [(1.0, 0.35), (-0.6, -0.8), (0.0, 0.7)])
@pytest.mark.parametrize(("method", "order", "hs", "tolerance"), [
    ("euler4", 1, (0.005, 0.0025, 0.00125), 0.2),
    ("symplectic", 2, (0.005, 0.0025, 0.00125), 0.1),
    ("rk4", 4, (0.02, 0.01, 0.005), 0.5),
])
def test_harmonic_order_against_analytic_solution(chaos, omega, x0, y0, method, order, hs, tolerance) -> None:
    # Explicit frequencies also check the chaos-to-frequency mapping. Nonzero
    # velocities exercise both sine terms; no numerical solver supplies the oracle.
    initial = NexusState(x0, y0, 0.3, 0.25)
    reference = [_harmonic_exact(initial, omega, initial.t + i * 0.1) for i in range(1, 41)]
    errors = [_sup_error(_trajectory("harmonic", method, h, 4.0, chaos, 0.7, initial=initial), reference) for h in hs]
    scale = max(1.0, *(max(abs(p.x), abs(p.y)) for p in reference))
    # Keep even the finest RK4 error comfortably above floating-point roundoff.
    assert min(errors) > 1000 * math.ulp(scale), errors
    _assert_error_ratios(errors, order=order, tolerance=tolerance)


# ---------------------------------------------------------------- method internals


def test_duffing_split_reduces_to_velocity_verlet_without_damping_or_forcing() -> None:
    x, y = 0.9, -0.3
    for _ in range(1000):
        sx, sy = duffing.split_substep(x, y, 0.0, 0.01, 0.0, 0.0, 1.2)
        vx, vy = duffing.verlet_conservative(x, y, 0.01)
        assert (sx, sy) == (vx, vy)
        x, y = sx, sy
    # ... and conserves the double-well Hamiltonian with bounded O(h^2) error.
    e0 = duffing.conservative_energy(0.9, -0.3)
    x, y = 0.9, -0.3
    worst = 0.0
    for _ in range(200_000):
        x, y = duffing.verlet_conservative(x, y, 0.01)
        worst = max(worst, abs(duffing.conservative_energy(x, y) - e0))
    assert worst < 1e-4


@given(
    y=st.floats(-5, 5), t=st.floats(0, 100), s=st.floats(0.0001, 0.05),
    delta=st.floats(0.0, 0.5), force=st.floats(0.0, 1.5), omega=st.floats(0.5, 3.0),
)
def test_duffing_dissipative_flow_is_the_exact_solution(y, t, s, delta, force, omega) -> None:
    """Compare against a very fine rk4 of y' = -delta y + F cos(omega t).

    The closed form divides by delta^2 + omega^2; the program always has
    omega = 1.2, so the domain keeps omega away from 0 (well conditioned).
    """

    def field(yy, _y2, _z, tt, _k, _d):
        return -delta * yy + force * math.cos(omega * tt), 0.0, 0.0

    n = 64
    h = s / n
    yy, tt = y, t
    for _ in range(n):
        yy, _, _ = rk4_substep(field, yy, 0.0, 0.0, tt, h, None, 0.0)
        tt += h
    assert abs(duffing.dissipative_flow(y, t, s, delta, force, omega) - yy) <= 1e-12 * (1 + abs(yy))


def test_duffing_dissipative_flow_degenerate_branch() -> None:
    assert duffing.dissipative_flow(0.25, 3.0, 0.01, 0.0, 0.5, 0.0) == 0.25 + 0.5 * 0.01


def test_harmonic_shadow_energy_is_exactly_preserved_per_substep() -> None:
    k = nd.coefficients("harmonic", 1.0)
    x, y, h = 1.0, 0.1, 0.02
    s0 = harmonic.shadow_energy(x, y, k.omega, h)
    for _ in range(100_000):
        x, y = harmonic.symplectic_substep(x, y, 0.0, h, k, 0.0)
    assert abs(harmonic.shadow_energy(x, y, k.omega, h) - s0) / s0 < 1e-12


def test_nemo_step_with_events_counts_spikes() -> None:
    state = nd.seed("nemo", 0.3)
    total = 0
    for _ in range(50):
        state, spikes = step_with_events("nemo", state, 0.016, 0.45, 1.0)
        total += spikes
    assert total > 0


def test_lotka_euler4_floor_matches_instrument() -> None:
    k = nd.coefficients("lotka", 0.5)
    assert lotka.euler4_field(-1.0, -1.0, 0.0, 0.0, k, 0.5) == lotka.euler4_field(0.02, 0.02, 0.0, 0.0, k, 0.5)
    assert lotka.euler4_post(-3.0, 0.5) == (0.02, 0.5)
    assert math.isnan(lotka.euler4_post(math.nan, 1.0)[0])  # a NaN is never floored into 0.02
