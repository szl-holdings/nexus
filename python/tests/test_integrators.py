# SPDX-License-Identifier: Apache-2.0
"""Integrators: instrument compatibility, method matrix, fail-closed, order of accuracy."""
from __future__ import annotations

import math

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

import nexus_dynamics as nd
from nexus_dynamics import NexusDynamicsError, NexusState
from nexus_dynamics.integrators import advance, rk4_substep, step_with_events
from nexus_dynamics.programs import duffing, harmonic, lotka

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


def _trajectory(program, method, h, horizon, chaos, drive, every=0.05):
    state = nd.seed(program, 0.3)
    per = round(every / h)
    points = []
    for _ in range(round(horizon / every)):
        state = advance(program, state, h, per, chaos, drive, method)
        points.append(state)
    return points


def _sup_error(a, b) -> float:
    return max(max(abs(p.x - q.x), abs(p.y - q.y), abs(p.z - q.z)) for p, q in zip(a, b))


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
    ratios = [errors[i] / errors[i + 1] for i in range(len(errors) - 1)]
    assert abs(ratios[-1] - 16) <= 1.5, (errors, ratios)


@pytest.mark.parametrize(("program", "method", "order"), [
    ("harmonic", "euler4", 1), ("vanderpol", "euler4", 1), ("duffing", "euler4", 1), ("lotka", "euler4", 1),
    ("harmonic", "symplectic", 2), ("duffing", "symplectic", 2),
])
def test_other_methods_have_their_expected_order(program, method, order) -> None:
    horizon, hs = 4.0, (0.02, 0.01, 0.005)
    reference = _trajectory(program, "rk4", hs[-1] / 64, horizon, 0.5, 0.7)
    errors = [_sup_error(_trajectory(program, method, h, horizon, 0.5, 0.7), reference) for h in hs]
    ratio = errors[-2] / errors[-1]
    assert abs(ratio - 2**order) <= 0.3 * order, (errors, ratio)


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
