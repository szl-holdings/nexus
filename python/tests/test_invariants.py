# SPDX-License-Identifier: Apache-2.0
"""Per-program invariants (plan Phase 3 acceptance), as Hypothesis properties
over chaos / drive / dt / seed in the contract ranges."""
from __future__ import annotations

import math
import re

from hypothesis import given, settings
from hypothesis import strategies as st

import nexus_dynamics as nd
from nexus_dynamics import NexusRunInput, NexusState
from nexus_dynamics.canonical import canonical_json
from nexus_dynamics.integrators import step_with_events, substep_size
from nexus_dynamics.programs import harmonic, lorenz, lotka, nemo
from nexus_dynamics.run import run
from nexus_dynamics.schema import DT_MAX, DT_MIN, STEPS_MAX

unit = st.floats(min_value=0.0, max_value=1.0)
dts = st.floats(min_value=DT_MIN, max_value=DT_MAX)


def _in_lorenz_envelope(s: NexusState) -> bool:
    return abs(s.x) < lorenz.ABS_XY_BOUND and abs(s.y) < lorenz.ABS_XY_BOUND and lorenz.Z_BOUNDS[0] < s.z < lorenz.Z_BOUNDS[1]


# ---------------------------------------------------------------- Lorenz


@settings(max_examples=40)
@given(chaos=unit, drive=unit, seed=unit, dt=dts)
def test_lorenz_stays_bounded_with_rk4(chaos, drive, seed, dt) -> None:
    """|x|,|y| < 60 and 0 < z < 80 over a full contract run (2400 ticks)."""
    s = nd.seed("lorenz", seed)
    for _ in range(STEPS_MAX):
        s = nd.step("lorenz", s, dt, chaos, drive, "rk4")
        assert _in_lorenz_envelope(s), s


@settings(max_examples=30)
@given(chaos=unit, seed=unit, dt=st.floats(min_value=DT_MIN, max_value=0.04))
def test_lorenz_euler4_bounded_for_dt_up_to_004(chaos, seed, dt) -> None:
    """The instrument scheme is bounded for dt <= 0.04; beyond that forward Euler
    can leave the envelope or diverge (and then raises NON_FINITE_OUTPUT, see
    test_integrators)."""
    s = nd.seed("lorenz", seed)
    for _ in range(STEPS_MAX):
        s = nd.step("lorenz", s, dt, chaos, 0.5, "euler4")
        assert _in_lorenz_envelope(s), s


# ---------------------------------------------------------------- harmonic


def _energy_drift_per_period(chaos: float, seed: float, dt: float, method: str, periods: float = 20.0,
                             max_ticks: int = 30_000) -> tuple[float, float, float, float]:
    """Least-squares secular trend of E/E0 per period, plus band and shadow checks."""
    k = nd.coefficients("harmonic", chaos)
    w = k.omega
    period = 2 * math.pi / w
    h = substep_size(dt)
    s = nd.seed("harmonic", seed)
    e0 = harmonic.energy(s.x, s.y, w)
    shadow0 = harmonic.shadow_energy(s.x, s.y, w, h)
    ticks = min(max_ticks, math.ceil(periods * period / dt))
    ts, es = [], []
    band = shadow = 0.0
    for _ in range(ticks):
        s = nd.step("harmonic", s, dt, chaos, 0.5, method)
        e = harmonic.energy(s.x, s.y, w)
        ts.append(s.t / period)
        es.append(e / e0)
        band = max(band, abs(e - e0) / e0)
        shadow = max(shadow, abs(harmonic.shadow_energy(s.x, s.y, w, h) - shadow0) / shadow0)
    n = len(ts)
    mt, me = sum(ts) / n, sum(es) / n
    slope = sum((a - mt) * (b - me) for a, b in zip(ts, es)) / sum((a - mt) ** 2 for a in ts)
    return abs(slope), band, shadow, ts[-1]


@settings(max_examples=25)
@given(chaos=unit, seed=unit, dt=dts)
def test_harmonic_symplectic_energy_drift_below_1e6_per_period(chaos, seed, dt) -> None:
    drift, band, shadow, periods = _energy_drift_per_period(chaos, seed, dt, "symplectic")
    omega_h = nd.coefficients("harmonic", chaos).omega * substep_size(dt)
    assert periods >= 1.0
    assert drift < 1e-6, drift                      # secular drift per period
    assert band <= (omega_h**2) / 4 * (1 + 1e-6) + 1e-12, (band, omega_h)  # bounded, no growth
    assert shadow < 1e-10, shadow                   # the Verlet invariant itself


def test_harmonic_euler4_is_not_conservative() -> None:
    """Plan F-note: forward Euler inflates the energy 54.6x in 60 s at omega = 4."""
    k = nd.coefficients("harmonic", 1.0)
    assert k.omega == 4.0
    ratios = {}
    for method in ("euler4", "rk4", "symplectic"):
        s = nd.seed("harmonic", 0.0)
        e0 = harmonic.energy(s.x, s.y, k.omega)
        for _ in range(3600):  # 60 s at 60 fps
            s = nd.step("harmonic", s, 1 / 60, 1.0, 0.5, method)
        ratios[method] = harmonic.energy(s.x, s.y, k.omega) / e0
    assert round(ratios["euler4"], 3) == 54.568
    assert abs(ratios["rk4"] - 1) < 1e-6
    assert abs(ratios["symplectic"] - 1) < (k.omega * substep_size(1 / 60)) ** 2 / 4 * 1.001
    drift, _, _, _ = _energy_drift_per_period(1.0, 0.0, 1 / 60, "euler4", periods=20)
    assert drift > 1e-2  # orders of magnitude above the symplectic bound


# ---------------------------------------------------------------- van der Pol


def _vdp_amplitude(chaos: float, seed: float, dt: float, horizon: float = 100.0, window: float = 20.0) -> float:
    s = nd.seed("vanderpol", seed)
    amplitude = 0.0
    for _ in range(math.ceil(horizon / dt)):
        s = nd.step("vanderpol", s, dt, chaos, 0.5, "rk4")
        if s.t > horizon - window:
            amplitude = max(amplitude, abs(s.x))
    return amplitude


@settings(max_examples=25)
@given(chaos=unit, seed=unit, dt=st.floats(min_value=0.01, max_value=DT_MAX))
def test_vanderpol_converges_to_limit_cycle_of_amplitude_2(chaos, seed, dt) -> None:
    amplitude = _vdp_amplitude(chaos, seed, dt)
    assert abs(amplitude - 2.0) < 0.05, amplitude


def test_vanderpol_limit_cycle_at_small_dt() -> None:
    assert abs(_vdp_amplitude(0.6, 0.5, 0.002, horizon=60.0) - 2.0) < 0.05


# ---------------------------------------------------------------- Lotka-Volterra


@settings(max_examples=40)
@given(chaos=unit, drive=unit, seed=unit, dt=dts)
def test_lotka_rk4_first_quadrant_and_conserved_quantity(chaos, drive, seed, dt) -> None:
    k = nd.coefficients("lotka", chaos)
    s = nd.seed("lotka", seed)
    v0 = lotka.conserved(s.x, s.y, k)
    for _ in range(STEPS_MAX):
        s = nd.step("lotka", s, dt, chaos, drive, "rk4")
        assert s.x > 0 and s.y > 0, s
        assert abs(lotka.conserved(s.x, s.y, k) - v0) < 1e-4


@settings(max_examples=30)
@given(chaos=unit, dt=dts, x=st.floats(0.2, 3.0), y=st.floats(0.2, 3.0))
def test_lotka_rk4_conserved_quantity_from_arbitrary_states(chaos, dt, x, y) -> None:
    k = nd.coefficients("lotka", chaos)
    s = NexusState(x, y, 0.5, 0.0)
    v0 = lotka.conserved(x, y, k)
    for _ in range(STEPS_MAX):
        s = nd.step("lotka", s, dt, chaos, 0.5, "rk4")
        assert s.x > 0 and s.y > 0
    assert abs(lotka.conserved(s.x, s.y, k) - v0) < 1e-4


@settings(max_examples=25)
@given(chaos=unit, seed=unit, dt=dts)
def test_lotka_euler4_first_quadrant(chaos, seed, dt) -> None:
    s = nd.seed("lotka", seed)
    for _ in range(STEPS_MAX):
        s = nd.step("lotka", s, dt, chaos, 0.5, "euler4")
        assert s.x >= lotka.EULER4_FLOOR and s.y >= lotka.EULER4_FLOOR


# ---------------------------------------------------------------- Duffing


@settings(max_examples=30)
@given(chaos=unit, drive=unit, seed=unit, dt=dts, method=st.sampled_from(("euler4", "rk4", "symplectic")))
def test_duffing_bounded_under_forcing(chaos, drive, seed, dt, method) -> None:
    from nexus_dynamics.programs import duffing

    s = nd.seed("duffing", seed)
    for _ in range(STEPS_MAX):
        s = nd.step("duffing", s, dt, chaos, drive, method)
        assert abs(s.x) < duffing.ABS_X_BOUND and abs(s.y) < duffing.ABS_Y_BOUND, s


# ---------------------------------------------------------------- NEMO


@settings(max_examples=20)
@given(chaos=unit, drive=st.floats(0.25, 1.0), seed=unit, dt=dts)
def test_nemo_finite_bounded_and_spiking_under_drive(chaos, drive, seed, dt) -> None:
    s = nd.seed("nemo", seed)
    spikes = 0
    for _ in range(400):
        s, fired = step_with_events("nemo", s, dt, chaos, drive)
        spikes += fired
        assert s.is_finite()
        assert nemo.bank_bounded(s.bank or ()), s.bank
        assert 0.0 <= s.z <= 1.0
    assert spikes > 0


@settings(max_examples=20)
@given(chaos=unit, drive=unit, dt=dts, bank=st.lists(st.floats(-1e6, 1e6), min_size=20, max_size=20))
def test_nemo_from_arbitrary_finite_banks_is_clamped_into_bounds(chaos, drive, dt, bank) -> None:
    s = NexusState(bank[0], bank[2], 0.5, 0.0, tuple(bank))
    for _ in range(5):
        s = nd.step("nemo", s, dt, chaos, drive)
    assert s.is_finite() and nemo.bank_bounded(s.bank or ())


# ---------------------------------------------------------------- serialization


@settings(max_examples=40)
@given(data=st.data(), program=st.sampled_from(nd.PROGRAMS), mode=st.sampled_from(nd.MODES),
       chaos=unit, drive=unit, seed=unit, dt=dts)
def test_run_output_never_serializes_nan_or_infinity(data, program, mode, chaos, drive, seed, dt) -> None:
    method = data.draw(st.sampled_from(nd.supported_methods(program)))
    steps = data.draw(st.integers(0, 60 if program == "nemo" else 300))
    payload = {"program": program, "mode": mode, "steps": steps, "dt": dt, "chaos": chaos, "drive": drive,
               "seed": seed, "repeatEvery": data.draw(st.integers(1, 512))}
    try:
        result = run(NexusRunInput.from_dict(payload), method)
    except nd.NexusDynamicsError as error:
        assert error.code == "NON_FINITE_OUTPUT"
        return
    text = canonical_json(result["output"])
    assert re.search(r'"-?(nan|inf|NaN|Infinity)"', text) is None
    assert result["output"]["invariants"]["finiteState"] is True
    assert len(result["outputHash"]) == 64
