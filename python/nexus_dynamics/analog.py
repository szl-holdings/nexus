# SPDX-License-Identifier: Apache-2.0
"""Analog read-out elements: scope scaling, two-beam optics and circuit jobs.

Ported from ``src/lib/nexus/math.ts`` (``scaleAnalog``, ``opticalInterfere``,
``opticalReconstruct``, ``analogCircuit``, ``analogCorrelate``,
``analogSchmitt``, ``analogJack``). These are the *jobs* of analog computing
elements as software, not the circuits and not a physical chip. Two-beam
optics is an analog inner product, not a digital FFT. Energy UNAVAILABLE.
"""
from __future__ import annotations

import math

from ._num import clamp01, jclamp, jmax, jmin
from .schema import NexusState


def clamp_unit(value: float) -> float:
    v = value if math.isfinite(value) else 0.0
    return jclamp(v, -1.0, 1.0)


def scale(program: str, state: NexusState) -> dict[str, float]:
    """Scope-space projection of a state (``scaleAnalog``)."""
    x, y, z = state.x, state.y, state.z
    if program == "harmonic":
        e = 0.5 * (y * y + x * x)
        return {"x": jclamp(x, -1.0, 1.0), "y": jclamp(y / 3, -1.0, 1.0), "z": jclamp(e * 0.5, 0.0, 1.0)}
    if program == "vanderpol":
        return {
            "x": jclamp(x / 2.4, -1.0, 1.0),
            "y": jclamp(y / 3.2, -1.0, 1.0),
            "z": jclamp((x * x + y * y) / 10, 0.0, 1.0),
        }
    if program == "duffing":
        return {
            "x": jclamp(x / 2, -1.0, 1.0),
            "y": jclamp(y / 2.4, -1.0, 1.0),
            "z": jclamp(0.5 + 0.5 * math.sin(state.t), 0.0, 1.0),
        }
    if program == "lotka":
        return {
            "x": jclamp((x - 1.4) / 1.8, -1.0, 1.0),
            "y": jclamp((y - 1.1) / 1.6, -1.0, 1.0),
            "z": jclamp((x + y) / 6, 0.0, 1.0),
        }
    if program == "nemo":
        return {
            "x": jclamp((x + 45) / 40, -1.0, 1.0),
            "y": jclamp((y + 45) / 40, -1.0, 1.0),
            "z": jclamp(z, 0.0, 1.0),
        }
    return {"x": jclamp(x / 24, -1.0, 1.0), "y": jclamp(y / 24, -1.0, 1.0), "z": jclamp(z / 48, 0.0, 1.0)}


def optical_interfere(obj_amp: float, obj_phase: float, ref_amp: float, ref_phase: float) -> float:
    """Two-beam intensity (Ao + Ar e^{i dphi})^2 as an analog inner product."""
    ao = jmax(0.0, obj_amp)
    ar = jmax(0.0, ref_amp)
    intensity = ao * ao + ar * ar + 2 * ao * ar * math.cos(obj_phase - ref_phase)
    return jmax(0.0, intensity) if math.isfinite(intensity) else 0.0


def optical_reconstruct(intensity: float, dphi: float) -> float:
    """First-order diffraction as a signed analog voltage."""
    v = intensity * math.cos(dphi)
    if not math.isfinite(v):
        return 0.0
    return jmax(-1.0, jmin(1.0, v / 2))


def analog_circuit(x: float, y: float, z: float, corr: float = 0.0) -> dict[str, float]:
    xi, yi, zi = clamp_unit(x), clamp_unit(y), clamp_unit(z)
    return {
        "intg": xi,
        "sum": clamp_unit((xi + yi + zi) / 3),
        "mul": clamp_unit(xi * yi),
        "inv": clamp_unit(-xi),
        "cmp": 1.0 if xi >= 0 else -1.0,
        "corr": clamp_unit(corr),
    }


def analog_correlate(pre: float, post: float, corr: float, dt: float, tau: float = 0.18) -> float:
    """Leaky correlator: corr <- corr + (pre*post - corr)(1 - e^{-dt/tau})."""
    product = clamp_unit(pre) * clamp_unit(post)
    t = jmax(1e-4, tau)
    a = 1 - math.exp(-jmax(0.0, dt) / t)
    prev = clamp_unit(corr)
    return clamp_unit(prev + (product - prev) * a)


def analog_schmitt(x: float, last: float, hyst: float = 0.08) -> float:
    h = jmax(0.01, jmin(0.45, hyst))
    xi = clamp_unit(x)
    if last >= 0:
        return 1.0 if xi > -h else -1.0
    return -1.0 if xi < h else 1.0


def analog_jack(circuit: dict[str, float], recon: float, drive: float) -> float:
    d = clamp01(drive)
    r = clamp_unit(recon)
    corr = clamp_unit(circuit.get("corr", 0.0))
    return clamp_unit(circuit["intg"] * 0.55 + circuit["mul"] * 0.22 * d + corr * 0.12 * d + r * 0.22 * d)
