# SPDX-License-Identifier: Apache-2.0
"""NEMO: five AdEx membranes on a ring plus the WILLAY optical second brain.

Ported operation for operation from ``analogNemoStep`` in
``src/lib/nexus/math.ts`` (Brette & Gerstner 2005 AdEx membranes, Tsodyks-
Markram style synaptic traces, three-factor optical STDP). This is executable
software simulation of the *jobs*, not a physical analog or neuromorphic chip.
Energy is UNAVAILABLE.

NEMO is a hybrid system (threshold/reset events), so only the instrument's own
scheme is offered (``euler4`` here means "instrument-compatible": 0.5 ms
substeps, 4..48 per tick). Where the TypeScript instrument silently reseeds on a
non-finite value, this binding raises ``NON_FINITE_OUTPUT``. Max/min use the
NaN-propagating ``jmax``/``jmin`` so a NaN can never be clamped into a
plausible-looking finite value.

Bank layout (20 cells): 0-4 membranes (mV), 5-9 recovery, 10-14 synaptic
traces, 15-19 optical STDP weights.
"""
from __future__ import annotations

import math

from ..analog import optical_interfere, optical_reconstruct
from ..errors import INVALID_NEMO_BANK, NON_FINITE_NUMBER, NexusDynamicsError, non_finite_output
from ..schema import NexusState
from ._common import Coefficients, clamp01, jclamp, jmax, jmin, lorenz_rho

NAME = "nemo"
LABEL = "NEMO"
MODEL = "nemo/1"
METHODS = ("euler4",)

MEMBRANE_BOUNDS = (-90.0, 40.0)
RECOVERY_BOUNDS = (-40.0, 80.0)
SYNAPSE_BOUNDS = (0.0, 48.0)
WEIGHT_BOUNDS = (0.05, 4.0)
RATE_BOUNDS = (0.0, 1.0)


def coefficients(chaos: float) -> Coefficients:
    c = clamp01(chaos)
    a = 0.02 + c * 0.08
    w = 3.5 + c * 14
    tau = 3 + (1 - c) * 9
    return Coefficients(
        sigma=10.0,
        rho=lorenz_rho(c),
        beta=8 / 3,
        omega=1.0,
        mu=a,
        delta=w,
        gamma=tau,
        alpha=0.2,
        label="AdEx · 5ORG · 2BRN",
    )


def seed_bank(nudge: float = 0.0) -> list[float]:
    n = nudge % 1
    v = [-65 + n * 6, -62 - n * 4, -70 + n * 5, -58 - n * 3, -67 + n * 8]
    u = [0.2 * m for m in v]
    return [*v, *u, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0]


def seed(nudge: float = 0.0) -> NexusState:
    bank = seed_bank(nudge)
    return NexusState(x=bank[0], y=bank[2], z=0.06, t=0.0, bank=tuple(bank))


def pad_bank(raw: tuple[float, ...] | list[float] | None) -> list[float]:
    """No bank -> seed bank; 15 cells (pre-STDP persist) -> weights padded to 1."""
    if raw is None:
        return seed_bank()
    if len(raw) not in (15, 20):
        raise NexusDynamicsError(INVALID_NEMO_BANK, "NEMO bank must contain exactly 15 or 20 values")
    values = [float(value) for value in raw]
    if not all(math.isfinite(value) for value in values):
        raise NexusDynamicsError(NON_FINITE_NUMBER, "NEMO bank values must be finite")
    return values + [1.0] * 5 if len(values) == 15 else values


def step(state: NexusState, dt: float, chaos: float, drive: float) -> tuple[NexusState, int]:
    """Advance one instrument tick; returns the new state and the spike count."""
    c = clamp01(chaos)
    pots = coefficients(c)
    a_adapt = pots.mu
    chem_w = pots.delta
    tau = jmax(1.4, pots.gamma)
    i0 = 2.2 + drive * 10.5
    el = -65.0
    vt = -52 + c * 6
    d_t = 2.0
    g_l = 0.12
    tau_w = jmax(8.0, 42 - c * 28)
    vr = -58 + c * 8
    b_jump = 4 + c * 10
    v_peak = 20.0
    mod = clamp01(drive)
    bank = pad_bank(state.bank)
    rate = jmax(0.0, jmin(1.0, state.z)) if math.isfinite(state.z) else 0.0
    t = state.t if math.isfinite(state.t) else 0.0
    total_ms = jmax(0.25, jmin(80.0, dt * 1000))
    n = int(jmax(4.0, jmin(48.0, float(math.ceil(total_ms / 0.5)))))
    h = total_ms / n
    spikes = 0

    for _ in range(n):
        currents = [0.0] * 5
        iopt = [0.0] * 5
        t_ms = t * 1000
        pace_t = 170 + (1 - mod) * 260
        i_pace = mod * (1.6 + 3.8 * (0.5 + 0.5 * math.sin((t_ms * math.pi * 2) / pace_t)))
        willay_field = 0.0
        for i in range(5):
            opp = (i + 2) % 5
            prev = (i + 4) % 5
            ao = jmax(0.0, (bank[i] + 70) / 110)
            ar = jmax(0.0, (bank[opp] + 70) / 110)
            iopt[i] = optical_interfere(ao, bank[i] * 0.035, ar, bank[opp] * 0.035)
            willay_field += optical_reconstruct(iopt[i], (bank[i] - bank[opp]) * 0.035)
            i_wave = 0.72 * jmax(0.0, (bank[prev] - el) / 40)
            wi = jmax(0.05, jmin(4.0, bank[15 + i]))
            inj = bank[10 + i] + iopt[i] * (1.1 + drive * 0.9) * wi + i_wave
            if i == 0:
                inj += i0
            elif i == 1:
                inj += 0.8 + drive * 2.4 + i_pace
            else:
                inj += 0.8 + drive * 2.4
            if i == 3:
                inj += 0.45 * iopt[i]
            currents[i] = inj
        willay_field /= 5
        gate = 0.35 + 0.65 * (0.5 + 0.5 * willay_field)
        fired: list[int] = []
        for i in range(5):
            vi = bank[i]
            ui = bank[5 + i]
            si = bank[10 + i]
            arg = jmax(-20.0, jmin(8.0, (vi - vt) / d_t))
            dv = -g_l * (vi - el) + g_l * d_t * math.exp(arg) - ui + currents[i]
            du = (a_adapt * (vi - el) - ui) / tau_w
            vi += dv * h
            ui += du * h
            if i == 4:
                vi += (el - vi) * (h / 420)
            si += (-si / tau) * h
            if vi >= v_peak:
                vi = vr
                ui += b_jump
                fired.append(i)
            bank[i] = jclamp(vi, -90.0, 40.0)
            bank[5 + i] = jclamp(ui, -40.0, 80.0)
            bank[10 + i] = jclamp(si, 0.0, 48.0)
        for i in fired:
            post = (i + 1) % 5
            opp = (i + 2) % 5
            avail = 1 - jmin(1.0, bank[10 + post] / 48)
            jump = chem_w * avail * (0.55 + 0.45 * gate)
            bank[10 + post] = jmin(48.0, bank[10 + post] + jump)
            nervous = 1.35 if i == 3 else 1.0
            bank[15 + i] = bank[15 + i] + 0.018 * (bank[10 + opp] / 48) * iopt[i] * mod * gate * nervous
            bank[15 + opp] = bank[15 + opp] - 0.006
        for i in range(5):
            leaked = bank[15 + i] + (1 - bank[15 + i]) * (h / 180)
            bank[15 + i] = jclamp(leaked, 0.05, 4.0)
        decay = math.exp(-h / 38)
        rate = rate * decay + (len(fired) / 5) * (1 - decay) * 10
        if rate > 1:
            rate = 1.0
        t += h * 0.001
        spikes += len(fired)
        if not math.isfinite(bank[0]) or not math.isfinite(rate) or not math.isfinite(t):
            raise non_finite_output("NEMO")

    if not all(math.isfinite(value) for value in bank):
        raise non_finite_output("NEMO")
    return NexusState(x=bank[0], y=bank[2], z=rate, t=t, bank=tuple(bank)), spikes


def bank_bounded(bank: tuple[float, ...] | list[float]) -> bool:
    return (
        len(bank) == 20
        and all(MEMBRANE_BOUNDS[0] <= value <= MEMBRANE_BOUNDS[1] for value in bank[0:5])
        and all(RECOVERY_BOUNDS[0] <= value <= RECOVERY_BOUNDS[1] for value in bank[5:10])
        and all(SYNAPSE_BOUNDS[0] <= value <= SYNAPSE_BOUNDS[1] for value in bank[10:15])
        and all(WEIGHT_BOUNDS[0] <= value <= WEIGHT_BOUNDS[1] for value in bank[15:20])
    )
