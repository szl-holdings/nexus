# SPDX-License-Identifier: Apache-2.0
"""Integrator structure: reversibility, symplectic Jacobians, rescaling, Liouville.

These are software checks of the numerical maps in ``nexus_dynamics``. They are
not physical measurements: ``physicalHardware=false``, Energy UNAVAILABLE and
Lambda / Conjecture 1 OPEN are unchanged, and nothing here touches the engine.

A. Symmetry and reversibility. One velocity-Verlet substep of ``-h`` undoes
   one substep of ``+h``; for the conservative Verlet maps, flipping the
   momentum, integrating forward and flipping again returns the start
   (R o Phi^N o R o Phi^N = id). The Duffing Strang substep is a symmetric
   composition: its ``-h`` substep started at ``t + h`` inverts it. With
   damping on it is not momentum-flip reversible (det J = exp(-delta h) < 1,
   see part B), so only its symmetry is checked. RK4 and forward Euler are not
   symmetric and serve as negative controls, so the checks can fail.
B. Jacobians (central differences). The conservative Verlet maps satisfy
   J^T Omega J = Omega with det J = 1. The damped Duffing Strang substep is
   conformally symplectic: det J = exp(-delta h), because its exact damping
   flow contracts area at rate delta. Forward Euler is the negative control.
C. Nondimensional equivalence, computed inside this file only (see its note).
D. Contrast for a non-Hamiltonian flow: the RK4 substep of van der Pol follows
   Liouville's formula det J = exp(integral of div f) to local order h^5.

Each upper bound on an engine map keeps at least a 10x margin over the value
measured on the author's machine (Windows, CPython 3.11 and 3.12 gave identical
values); the measured value is noted next to each bound so a reviewer can see
the margin. The helper sanity checks in test_helpers_reproduce_known_matrices
are the exception: their bounds sit at the rounding scale of the helper
arithmetic, with less than a 10x margin, and their measured values are noted
there. The negative controls use lower bounds on truncation errors instead;
their measured minima are listed in those tests. The van der Pol order check
in part D uses a ratio window [24, 40] around the theoretical 32 (measured
30.9 and 31.5) rather than a 10x-margin bound.
"""
from __future__ import annotations

import math

import pytest

import nexus_dynamics as nd
from nexus_dynamics.integrators import advance, rk4_substep
from nexus_dynamics.programs import duffing, harmonic, vanderpol
from nexus_dynamics.schema import DT_MAX, DT_MIN

CHAOS_GRID = (0.0, 0.5, 1.0)
H_GRID = (DT_MIN / 4, 0.0025, DT_MAX / 4)  # smallest, typical and largest instrument substep
STATES = ((1.0, 0.35), (-0.6, -0.8), (0.0, 0.7), (1.3, 0.0))
DUFFING_STATES = STATES + ((1.6, -0.9), (2.4, 3.1))

# Central-difference step for the Jacobians. At d = 1e-6 the measured error
# reached 6.2e-10, too close to the 1e-9 bounds; d = 1e-5 keeps errors <= 5e-11.
FD_STEP = 1e-5
JACOBIAN_TOL = 1e-9

OMEGA = ((0.0, 1.0), (-1.0, 0.0))


# ---------------------------------------------------------------- helpers


def _matmul(a, b):
    return tuple(tuple(sum(a[i][k] * b[k][j] for k in range(2)) for j in range(2)) for i in range(2))


def _transpose(a):
    return ((a[0][0], a[1][0]), (a[0][1], a[1][1]))


def _det(j) -> float:
    return j[0][0] * j[1][1] - j[0][1] * j[1][0]


def _jacobian_fd(f, x: float, y: float, d: float = FD_STEP):
    """Central-difference Jacobian of a planar map ``f(x, y) -> (x', y')``."""
    xp, yp = f(x + d, y)
    xm, ym = f(x - d, y)
    xq, yq = f(x, y + d)
    xr, yr = f(x, y - d)
    return (
        ((xp - xm) / (2 * d), (xq - xr) / (2 * d)),
        ((yp - ym) / (2 * d), (yq - yr) / (2 * d)),
    )


def _symplectic_defect(j, factor: float = 1.0) -> float:
    """``max |J^T Omega J - factor * Omega|`` with ``Omega = [[0, 1], [-1, 0]]``.

    For any 2x2 matrix, J^T Omega J = det(J) Omega, so in the plane this check
    and the determinant check are equivalent. Both are asserted so the intent
    (preservation of the symplectic form, scaled by ``factor``) stays visible.
    """
    m = _matmul(_transpose(j), _matmul(OMEGA, j))
    return max(abs(m[r][c] - factor * OMEGA[r][c]) for r in range(2) for c in range(2))


def _harmonic_substep(chaos: float, h: float):
    k = nd.coefficients("harmonic", chaos)
    return lambda x, y: harmonic.symplectic_substep(x, y, 0.0, h, k, 0.0)


def _duffing_strang_substep(chaos: float, drive: float, h: float, t: float):
    k = nd.coefficients("duffing", chaos)
    return lambda x, y: duffing.symplectic_substep(x, y, t, h, k, drive)


def _gap(a: nd.NexusState, b: nd.NexusState) -> float:
    return max(abs(a.x - b.x), abs(a.y - b.y))


def test_helpers_reproduce_known_matrices() -> None:
    # Rounding-scale bounds, not 10x-margin bounds (module docstring). Measured
    # 0.0 for both; a 1-ulp change in cos(0.3) or sin(0.3) gives at most 3.3e-16.
    rotation = ((math.cos(0.3), math.sin(0.3)), (-math.sin(0.3), math.cos(0.3)))
    assert _symplectic_defect(rotation) < 1e-15 and abs(_det(rotation) - 1) < 1e-15
    shear = ((2.0, 0.0), (0.0, 0.25))  # area contraction by 1/2
    assert _det(shear) == 0.5
    assert _symplectic_defect(shear) == 0.5 and _symplectic_defect(shear, 0.5) == 0.0
    # The FD Jacobian is exact (up to rounding) for a linear map. Measured max
    # 1.6e-11, about 6x under the bound; the rounding scale eps * |f| / (2 d) is
    # about 2e-11 here, so this checks the helper, not a 10x margin.
    j = _jacobian_fd(lambda x, y: (3 * x - y, 0.5 * y), 0.4, -0.7)
    assert max(abs(j[0][0] - 3), abs(j[0][1] + 1), abs(j[1][0]), abs(j[1][1] - 0.5)) < 1e-10


# ---------------------------------------------------------------- A. reversibility


@pytest.mark.parametrize("chaos", CHAOS_GRID)
@pytest.mark.parametrize("h", H_GRID)
def test_harmonic_verlet_substep_roundtrip(chaos, h) -> None:
    k = nd.coefficients("harmonic", chaos)
    for x0, y0 in STATES:
        x1, y1 = harmonic.symplectic_substep(x0, y0, 0.0, h, k, 0.0)
        x2, y2 = harmonic.symplectic_substep(x1, y1, h, -h, k, 0.0)
        # measured max 1.1e-16
        assert max(abs(x2 - x0), abs(y2 - y0)) < 1e-14, (x0, y0)


@pytest.mark.parametrize("h", H_GRID)
def test_duffing_conservative_verlet_substep_roundtrip(h) -> None:
    for x0, y0 in DUFFING_STATES:
        x1, y1 = duffing.verlet_conservative(x0, y0, h)
        x2, y2 = duffing.verlet_conservative(x1, y1, -h)
        # measured max 1.1e-16
        assert max(abs(x2 - x0), abs(y2 - y0)) < 1e-14, (x0, y0)


@pytest.mark.parametrize("chaos", CHAOS_GRID)
@pytest.mark.parametrize("drive", (0.0, 0.8))
@pytest.mark.parametrize("h", H_GRID)
def test_duffing_strang_substep_roundtrip(chaos, drive, h) -> None:
    """B(h/2) A(h) B(h/2) is symmetric: the substep of -h starting at t + h undoes it.

    B is the exact damped/forced flow, so B(-s) inverts B(s) even with damping on;
    the composition is invertible by its -h substep, but it is neither
    area-preserving nor momentum-flip reversible while damping is on (see part B).
    """
    t = 1.7
    k = nd.coefficients("duffing", chaos)
    for x0, y0 in DUFFING_STATES:
        x1, y1 = duffing.symplectic_substep(x0, y0, t, h, k, drive)
        x2, y2 = duffing.symplectic_substep(x1, y1, t + h, -h, k, drive)
        # measured max 8.9e-16
        assert max(abs(x2 - x0), abs(y2 - y0)) < 1e-14, (x0, y0)


@pytest.mark.parametrize(
    "substep",
    [
        pytest.param(_harmonic_substep(1.0, 0.005), id="harmonic-omega4"),
        pytest.param(lambda x, y: duffing.verlet_conservative(x, y, 0.005), id="duffing-conservative"),
    ],
)
def test_verlet_momentum_flip_reversibility(substep) -> None:
    """R o Phi_h^N o R o Phi_h^N = id with R(x, y) = (x, -y), N = 10000."""
    for x0, y0 in STATES:
        x, y = x0, y0
        for _ in range(10_000):
            x, y = substep(x, y)
        y = -y
        for _ in range(10_000):
            x, y = substep(x, y)
        y = -y
        # measured max 2.9e-14 (harmonic) and 4.8e-13 (double well)
        assert max(abs(x - x0), abs(y - y0)) < 1e-10, (x0, y0)


# The advance()-level checks below integrate with a negative h. advance() does
# not validate h today; whether backward integration is a supported API is owner
# decision D3. The substep-level checks above stay valid whatever D3 decides.
ADVANCE_STATES = tuple(
    nd.NexusState(x, y, 0.5, t)
    for x, y, t in (
        (0.9, -0.3, 0.25), (1.0, 0.35, 0.0), (-0.6, -0.8, 2.0), (0.0, 0.7, 0.0), (1.3, 0.0, 0.0), (0.69, 0.8, 0.0),
    )
)
ROUNDTRIP_CASES = [
    ("harmonic", 0.5, 0.7),
    ("harmonic", 1.0, 0.7),
    ("duffing", 0.0, 0.0),
    ("duffing", 0.69, 0.8),
    ("duffing", 1.0, 1.0),
]
# Long horizons at h = 0.02. The harmonic map is linear, so rounding is not
# amplified: T = 20 is used (measured max 1.3e-14). For Duffing the backward
# pass re-expands the phase volume the damping contracted (a factor of about
# e^(delta T)) and the forced flow is sensitive to its initial state, so
# rounding from the forward pass grows with T: measured max 6.6e-12 at T = 10
# but 1.5e-10 at T = 20 over the same states. T = 10 keeps a 15x margin.
LONG_HORIZON = {"harmonic": (1000, 1e-12), "duffing": (500, 1e-10)}


def _roundtrip(program, state, h, substeps, chaos, drive, method) -> nd.NexusState:
    forward = advance(program, state, h, substeps, chaos, drive, method)
    return advance(program, forward, -h, substeps, chaos, drive, method)


@pytest.mark.parametrize(("program", "chaos", "drive"), ROUNDTRIP_CASES)
@pytest.mark.parametrize("substeps", (1, 4))
def test_symplectic_method_is_symmetric(program, chaos, drive, substeps) -> None:
    for state in (nd.seed(program, 0.3), *ADVANCE_STATES):
        back = _roundtrip(program, state, 0.0025, substeps, chaos, drive, "symplectic")
        assert _gap(back, state) < 1e-14, state  # measured max 6.7e-16
        assert abs(back.t - state.t) < 1e-14, state  # measured max 8.7e-19
        assert back.z == state.z


@pytest.mark.parametrize(("program", "chaos", "drive"), ROUNDTRIP_CASES)
def test_symplectic_method_is_symmetric_over_a_long_horizon(program, chaos, drive) -> None:
    substeps, tolerance = LONG_HORIZON[program]
    for state in (nd.seed(program, 0.3), *ADVANCE_STATES):
        back = _roundtrip(program, state, 0.02, substeps, chaos, drive, "symplectic")
        assert _gap(back, state) < tolerance, state
        assert abs(back.t - state.t) < 1e-12, state  # measured max 1.8e-15


@pytest.mark.parametrize(("program", "chaos", "drive"), ROUNDTRIP_CASES)
@pytest.mark.parametrize(("method", "floor"), [("rk4", 1e-10), ("euler4", 1e-3)])
def test_non_symmetric_methods_fail_the_same_roundtrip(program, chaos, drive, method, floor) -> None:
    """Negative control: the identical long roundtrip with RK4 or Euler does not return.

    The RK4 floor equals the bound the symplectic method meets for Duffing (1e-10)
    and is 100x the harmonic bound. Measured minima over all states: RK4 1.5e-7
    (harmonic) and 7.6e-10 (Duffing); Euler 7.8 (harmonic) and 0.12 (Duffing).
    These are truncation errors rather than rounding, so platform rounding
    differences cannot plausibly close the gap to the floors.
    """
    substeps, _ = LONG_HORIZON[program]
    for state in (nd.seed(program, 0.3), *ADVANCE_STATES):
        back = _roundtrip(program, state, 0.02, substeps, chaos, drive, method)
        assert _gap(back, state) > floor, state


# ---------------------------------------------------------------- B. Jacobians


@pytest.mark.parametrize("chaos", CHAOS_GRID)
@pytest.mark.parametrize("h", H_GRID)
def test_harmonic_verlet_substep_is_symplectic(chaos, h) -> None:
    omega = nd.coefficients("harmonic", chaos).omega
    wh2 = (omega * h) ** 2
    closed_form = ((1 - wh2 / 2, h), (-omega * omega * h * (1 - wh2 / 4), 1 - wh2 / 2))
    for x0, y0 in STATES:
        j = _jacobian_fd(_harmonic_substep(chaos, h), x0, y0)
        # measured max 1.3e-11 for both
        assert _symplectic_defect(j) < JACOBIAN_TOL, (x0, y0)
        assert abs(_det(j) - 1) < JACOBIAN_TOL, (x0, y0)
        # measured max 1.4e-11
        assert max(abs(j[r][c] - closed_form[r][c]) for r in range(2) for c in range(2)) < JACOBIAN_TOL, (x0, y0)


@pytest.mark.parametrize("h", H_GRID)
def test_duffing_conservative_verlet_is_symplectic(h) -> None:
    for x0, y0 in DUFFING_STATES:
        j = _jacobian_fd(lambda x, y: duffing.verlet_conservative(x, y, h), x0, y0)
        # measured max 2.8e-11 for both
        assert _symplectic_defect(j) < JACOBIAN_TOL, (x0, y0)
        assert abs(_det(j) - 1) < JACOBIAN_TOL, (x0, y0)


@pytest.mark.parametrize("chaos", CHAOS_GRID)
@pytest.mark.parametrize("drive", (0.0, 0.8))
@pytest.mark.parametrize("h", H_GRID)
def test_duffing_strang_substep_is_conformally_symplectic(chaos, drive, h) -> None:
    t = 1.7
    k = nd.coefficients("duffing", chaos)
    contraction = math.exp(-k.delta * h)
    for x0, y0 in DUFFING_STATES:
        j = _jacobian_fd(_duffing_strang_substep(chaos, drive, h, t), x0, y0)
        # measured max 4.9e-11 for both
        assert abs(_det(j) - contraction) < JACOBIAN_TOL, (x0, y0)
        assert _symplectic_defect(j, contraction) < JACOBIAN_TOL, (x0, y0)
        # Damping is always on (delta >= 0.08), so the map is not area-preserving:
        # the smallest 1 - exp(-delta h) on this grid is about 8e-6.
        assert abs(_det(j) - 1) > 1e-6, (x0, y0)
        # Without damping the same split is area-preserving, forcing included.
        force = duffing.forcing_amplitude(k, drive)
        undamped = _jacobian_fd(lambda x, y: duffing.split_substep(x, y, t, h, 0.0, force, k.omega), x0, y0)
        assert abs(_det(undamped) - 1) < JACOBIAN_TOL, (x0, y0)  # measured max 3.8e-11
        assert _symplectic_defect(undamped) < JACOBIAN_TOL, (x0, y0)


@pytest.mark.parametrize("dt", (DT_MIN, 0.01, DT_MAX))
@pytest.mark.parametrize("chaos", CHAOS_GRID)
@pytest.mark.parametrize("drive", (0.0, 0.8))
@pytest.mark.parametrize("program", ("harmonic", "duffing"))
def test_instrument_tick_jacobian(program, dt, chaos, drive) -> None:
    """One public step() tick (4 substeps): det 1 for harmonic, exp(-delta dt) for Duffing."""
    expected = 1.0 if program == "harmonic" else math.exp(-nd.coefficients("duffing", chaos).delta * dt)

    def tick(x, y):
        out = nd.step(program, nd.NexusState(x, y, 0.5, 1.7), dt, chaos, drive, "symplectic")
        return out.x, out.y

    for x0, y0 in STATES:
        j = _jacobian_fd(tick, x0, y0)
        # measured max 2.4e-11
        assert abs(_det(j) - expected) < JACOBIAN_TOL, (x0, y0)
        assert _symplectic_defect(j, expected) < JACOBIAN_TOL, (x0, y0)


def test_euler_substep_is_not_symplectic() -> None:
    """Negative control: forward Euler on the oscillator has det J = 1 + (omega h)^2."""
    h = DT_MAX / 4
    omega = nd.coefficients("harmonic", 1.0).omega
    assert omega == 4.0

    def euler(x, y):
        out = advance("harmonic", nd.NexusState(x, y, 0.5, 0.0), h, 1, 1.0, 0.5, "euler4")
        return out.x, out.y

    for x0, y0 in STATES:
        j = _jacobian_fd(euler, x0, y0)
        # measured max 9.0e-12
        assert abs(_det(j) - (1 + (omega * h) ** 2)) < JACOBIAN_TOL, (x0, y0)
        assert abs(_det(j) - 1) > 1e-3, (x0, y0)  # 6.4e-3 analytically
        assert _symplectic_defect(j) > 1e-3, (x0, y0)


# ---------------------------------------------------------------- C. nondimensional equivalence
#
# NOT a unit or quantity contract. The contract has no units: the vendored
# contracts/immune-nexus.v1.json gives dt no unit (NEMO's instrument code reads
# dt * 1000 as milliseconds), and omega lies in [1, 4] per instrument time unit.
# The helpers below assume, inside this file only, that one instrument time
# unit is one second. They check that two consistent unit systems (SI and CGS)
# describing the same spring-mass set-up reduce to the same dimensionless engine
# inputs (a check of the helper alone), and that the engine trajectory, once
# re-dimensionalized, follows the analytic solution of m x'' = -k x in each unit
# system's own units (a check of the engine). This is test-local
# nondimensionalization; whether a formal unit contract is wanted is owner
# decision D4 and would originate in szl-holdings/immune.

SECONDS_PER_INSTRUMENT_TIME_UNIT = 1.0  # test-local assumption, not a contract

# Each set-up written in SI (kg, N/m, m, m/s) and CGS (g, dyn/cm, cm, cm/s).
# 1 N/m = 1000 dyn/cm. ``length_per_metre`` is used only to compare results;
# the nondimensionalization never sees which unit system it was given.
PHYSICAL_SETUPS = {
    "omega-4": {
        "SI": {"mass": 0.5, "stiffness": 8.0, "x0": 0.03, "v0": 0.12, "length_per_metre": 1.0},
        "CGS": {"mass": 500.0, "stiffness": 8000.0, "x0": 3.0, "v0": 12.0, "length_per_metre": 100.0},
    },
    "omega-2.5": {
        "SI": {"mass": 0.4, "stiffness": 2.5, "x0": -0.05, "v0": 0.2, "length_per_metre": 1.0},
        "CGS": {"mass": 400.0, "stiffness": 2500.0, "x0": -5.0, "v0": 20.0, "length_per_metre": 100.0},
    },
}


def _nondimensionalize(mass: float, stiffness: float, x0: float, v0: float):
    """Spring-mass m x'' = -k x in any consistent unit system -> engine inputs.

    Time is scaled by one instrument time unit (assumed 1 s here) and length by
    the oscillation amplitude L = hypot(x0, v0 / omega), so the dimensionless
    state is (x0 / L, v0 T / L) and the engine frequency is omega T = 1 + 3 chaos.
    Returns ``(chaos, xi0, eta0, L)`` with ``L`` in the caller's length unit.
    """
    seconds = SECONDS_PER_INSTRUMENT_TIME_UNIT
    omega = math.sqrt(stiffness / mass)  # rad/s in both SI and CGS
    chaos = (omega * seconds - 1) / 3
    assert 0.0 <= chaos <= 1.0, "set-up outside the harmonic program's frequency range"
    length = math.hypot(x0, v0 / omega)
    return chaos, x0 / length, v0 * seconds / length, length


def _redimensionalized_trajectory(setup: dict, ticks: int, dt: float):
    """Run the engine on the dimensionless inputs; return (seconds, x, v) in the set-up's units."""
    chaos, xi, eta, length = _nondimensionalize(setup["mass"], setup["stiffness"], setup["x0"], setup["v0"])
    seconds = SECONDS_PER_INSTRUMENT_TIME_UNIT
    state = nd.NexusState(xi, eta, 0.0, 0.0)
    out = []
    for _ in range(ticks):
        state = nd.step("harmonic", state, dt, chaos, 0.5, "symplectic")
        out.append((state.t * seconds, state.x * length, state.y * length / seconds))
    return out


def _analytic_spring_mass(setup: dict, seconds: float) -> tuple[float, float]:
    """Exact (x, v) of m x'' = -k x at ``seconds``, in the set-up's own units."""
    omega = math.sqrt(setup["stiffness"] / setup["mass"])
    x0, v0 = setup["x0"], setup["v0"]
    c, s = math.cos(omega * seconds), math.sin(omega * seconds)
    return x0 * c + (v0 / omega) * s, -x0 * omega * s + v0 * c


@pytest.mark.parametrize("name", sorted(PHYSICAL_SETUPS))
def test_si_and_cgs_reduce_to_the_same_engine_inputs(name) -> None:
    """Both unit systems give the same dimensionless engine inputs.

    This checks the test-local nondimensionalization helper only, not the
    engine: the inputs are identical, so the engine cannot tell the two unit
    systems apart. The engine is checked against the analytic solution below.
    """
    si, cgs = PHYSICAL_SETUPS[name]["SI"], PHYSICAL_SETUPS[name]["CGS"]
    ratio = cgs["length_per_metre"] / si["length_per_metre"]
    a = _nondimensionalize(si["mass"], si["stiffness"], si["x0"], si["v0"])
    b = _nondimensionalize(cgs["mass"], cgs["stiffness"], cgs["x0"], cgs["v0"])
    # measured: chaos, xi0 and eta0 are bit-identical in SI and CGS
    for p, q in zip(a[:3], b[:3]):
        assert math.isclose(p, q, rel_tol=1e-15, abs_tol=0), (a, b)
    # measured relative difference 1.9e-16 (omega-2.5) and 0.0 (omega-4)
    assert math.isclose(b[3], ratio * a[3], rel_tol=1e-14, abs_tol=0), (a, b)


@pytest.mark.parametrize("unit_system", ("SI", "CGS"))
@pytest.mark.parametrize("name", sorted(PHYSICAL_SETUPS))
def test_redimensionalized_trajectory_follows_the_analytic_spring_mass_solution(name, unit_system) -> None:
    """600 symplectic ticks, re-dimensionalized, track x0 cos(wt) + (v0/w) sin(wt).

    The comparison is made in the set-up's own units (m and m/s, or cm and
    cm/s), relative to the amplitude L for x and omega L for v, so zero
    crossings do not inflate it. The error left is velocity Verlet's truncation
    error, dominated by the phase drift omega T (omega h)^2 / 24, which predicts
    4.6e-4 (omega 4) and 1.1e-4 (omega 2.5) over T = 10 s with h = dt / 4.
    """
    setup = PHYSICAL_SETUPS[name][unit_system]
    omega = math.sqrt(setup["stiffness"] / setup["mass"])
    length = _nondimensionalize(setup["mass"], setup["stiffness"], setup["x0"], setup["v0"])[3]
    ticks, dt = 600, 1 / 60  # 10 instrument time units at 60 ticks per unit
    worst_x = worst_v = 0.0
    for seconds, x, v in _redimensionalized_trajectory(setup, ticks, dt):
        x_exact, v_exact = _analytic_spring_mass(setup, seconds)
        worst_x = max(worst_x, abs(x - x_exact) / length)
        worst_v = max(worst_v, abs(v - v_exact) / (omega * length))
    # measured x 4.4e-4, v 4.3e-4 (omega-4) and x 1.1e-4, v 1.2e-4 (omega-2.5),
    # the same in SI and CGS; the bound keeps an 11x margin.
    assert worst_x < 5e-3 and worst_v < 5e-3, (worst_x, worst_v)


@pytest.mark.parametrize("method", ("euler4", "rk4", "symplectic"))
def test_time_rescaling_equivalence(method) -> None:
    """Only omega*h matters: (omega 2, dt 0.04) and (omega 4, dt 0.02) agree in (x, y/omega)."""
    slow_chaos, fast_chaos = 1 / 3, 1.0
    slow_omega = nd.coefficients("harmonic", slow_chaos).omega
    fast_omega = nd.coefficients("harmonic", fast_chaos).omega
    assert (slow_omega, fast_omega) == (2.0, 4.0)
    x0, u0 = 0.8, -0.45  # u = y / omega
    slow = nd.NexusState(x0, u0 * slow_omega, 0.5, 0.0)
    fast = nd.NexusState(x0, u0 * fast_omega, 0.5, 0.0)
    worst = 0.0
    for _ in range(500):
        slow = nd.step("harmonic", slow, 0.04, slow_chaos, 0.5, method)
        fast = nd.step("harmonic", fast, 0.02, fast_chaos, 0.5, method)
        worst = max(worst, abs(slow.x - fast.x), abs(slow.y / slow_omega - fast.y / fast_omega))
        assert math.isclose(slow.t, 2 * fast.t, rel_tol=1e-15, abs_tol=0)  # measured 0.0
    assert worst < 1e-12, worst  # measured 0.0; not asserted bitwise on purpose


@pytest.mark.parametrize("method", ("euler4", "rk4", "symplectic"))
@pytest.mark.parametrize("chaos", (0.0, 0.37, 1.0))
def test_power_of_two_amplitude_scaling_is_bit_exact(method, chaos) -> None:
    """The oscillator maps are linear, and scaling by 2**10 is exact in binary floating point."""
    scale = 1024.0
    base = nd.NexusState(0.7, -0.25, 0.5, 0.0)
    scaled = nd.NexusState(base.x * scale, base.y * scale, base.z, base.t)
    for _ in range(300):
        base = nd.step("harmonic", base, 0.02, chaos, 0.5, method)
        scaled = nd.step("harmonic", scaled, 0.02, chaos, 0.5, method)
        assert (scaled.x, scaled.y, scaled.t) == (base.x * scale, base.y * scale, base.t)


# ---------------------------------------------------------------- D. non-Hamiltonian contrast


def test_vanderpol_rk4_phase_volume_matches_liouville() -> None:
    """van der Pol is not Hamiltonian and has no symplectic method (UNSUPPORTED_METHOD).

    The exact flow's Jacobian has det = exp(integral over [0, h] of div f) with
    div f = mu (1 - x^2) (Liouville's formula). The RK4 substep matches it to
    local order h^5, so the error ratio per halving of h is near 2^5 = 32.
    The reference integral uses a fine RK4 trajectory (2000 substeps) and the
    trapezoid rule; its error, estimated against Simpson's rule, is below 5e-12,
    far under the measured errors.
    """
    chaos, x0, y0 = 1.0, 2.0, -0.5
    k = nd.coefficients("vanderpol", chaos)

    def rk4_map(h):
        def f(x, y):
            nx, ny, _ = rk4_substep(vanderpol.field, x, y, 0.0, 0.0, h, k, 0.5)
            return nx, ny

        return f

    errors = []
    for h in (0.02, 0.01, 0.005):
        reference_map = rk4_map(h / 2000)
        x, y = x0, y0
        div = [k.mu * (1 - x * x)]
        for _ in range(2000):
            x, y = reference_map(x, y)
            div.append(k.mu * (1 - x * x))
        integral = (h / 2000) * (sum(div) - 0.5 * (div[0] + div[-1]))
        errors.append(abs(_det(_jacobian_fd(rk4_map(h), x0, y0)) - math.exp(integral)))
    # measured 1.9e-6, 6.0e-8, 1.9e-9: every error sits well above the FD and
    # reference noise (about 1e-11), so the ratios measure the method.
    assert min(errors) > 1e-10, errors
    ratios = [coarse / fine for coarse, fine in zip(errors, errors[1:])]
    assert all(24 <= ratio <= 40 for ratio in ratios), (errors, ratios)  # measured 30.9, 31.5
