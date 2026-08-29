#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""NEXUS hologram — stdlib analog computer. No npm. No Gradio. Port 7860.

Six integrator programs (Lorenz, harmonic, van der Pol, Duffing,
Lotka–Volterra, NEMO analog neuromorphic) plus a two-beam optical analog.
Energy UNAVAILABLE. Λ uniqueness is Conjecture 1. Not a physical chip.
The full Web Audio instrument stays on github.com/szl-holdings/nexus.
"""
from __future__ import annotations

import json
import math
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

HTML = Path(__file__).with_name("index.html")
SIGMA, RHO, BETA = 10.0, 28.0, 8.0 / 3.0
DT = 0.01
YUYAY_FLOORS = (0.95, 0.95) + (0.90,) * 11
ORGANS = ("YACHAY", "YUYAY", "YAWAR", "NERVOUS", "KHIPU")
PROGRAMS = ("lorenz", "harmonic", "vanderpol", "duffing", "lotka", "nemo")
PROGRAM_LABELS = {
    "lorenz": "LRNZ",
    "harmonic": "HARM",
    "vanderpol": "VDP",
    "duffing": "DFFG",
    "lotka": "LTKA",
    "nemo": "NEMO",
}


def clamp01(c: float) -> float:
    return min(1.0, max(0.0, float(c)))


def lambda_aggregate(axes: list[float]) -> float:
    if not axes:
        raise ValueError("axes empty")
    if any(x < 0 for x in axes):
        raise ValueError("axes must be >= 0")
    if any(x == 0 for x in axes):
        return 0.0
    w = 1.0 / len(axes)
    return math.exp(sum(w * math.log(x) for x in axes))


def lorenz_rk4(x: float, y: float, z: float, steps: int, dt: float = DT) -> list[list[float]]:
    """Compat trail. New work uses analog_step (Euler, matches the instrument)."""
    steps = max(1, min(int(steps), 2400))
    trail: list[list[float]] = []

    def f(px: float, py: float, pz: float) -> tuple[float, float, float]:
        return (SIGMA * (py - px), px * (RHO - pz) - py, px * py - BETA * pz)

    for _ in range(steps):
        k1 = f(x, y, z)
        k2 = f(x + 0.5 * dt * k1[0], y + 0.5 * dt * k1[1], z + 0.5 * dt * k1[2])
        k3 = f(x + 0.5 * dt * k2[0], y + 0.5 * dt * k2[1], z + 0.5 * dt * k2[2])
        k4 = f(x + dt * k3[0], y + dt * k3[1], z + dt * k3[2])
        x += dt * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) / 6
        y += dt * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) / 6
        z += dt * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]) / 6
        trail.append([x, y, z])
    return trail


def seed_lorenz(nudge: float = 0.0) -> dict[str, Any]:
    return {
        "x": 0.12 + nudge * 0.31,
        "y": -0.08 + nudge * 0.17,
        "z": 22 + (nudge % 1) * 6,
        "t": 0.0,
    }


def seed_nemo_bank(nudge: float = 0.0) -> list[float]:
    n = nudge % 1
    v = [-65 + n * 6, -62 - n * 4, -70 + n * 5, -58 - n * 3, -67 + n * 8]
    u = [0.2 * m for m in v]
    return [*v, *u, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0]


def pad_nemo_bank(raw: Any) -> list[float]:
    if isinstance(raw, list) and len(raw) >= 20 and all(math.isfinite(float(n)) for n in raw[:20]):
        return [float(n) for n in raw[:20]]
    if isinstance(raw, list) and len(raw) == 15 and all(math.isfinite(float(n)) for n in raw):
        return [float(n) for n in raw] + [1.0] * 5
    return seed_nemo_bank()


def seed_analog(program: str, nudge: float = 0.0) -> dict[str, Any]:
    n = nudge % 1
    if program == "harmonic":
        return {"x": 1.0, "y": 0.02 + n * 0.08, "z": 0.5, "t": 0.0}
    if program == "vanderpol":
        return {"x": 0.12 + n * 0.2, "y": 0.04, "z": 0.4, "t": 0.0}
    if program == "duffing":
        return {"x": 0.18 + n * 0.12, "y": 0.0, "z": 0.5, "t": 0.0}
    if program == "lotka":
        return {"x": 1.15 + n * 0.25, "y": 0.82 + n * 0.12, "z": 0.5, "t": 0.0}
    if program == "nemo":
        bank = seed_nemo_bank(nudge)
        return {"x": bank[0], "y": bank[2], "z": 0.06, "t": 0.0, "bank": bank}
    L = seed_lorenz(nudge)
    return L


def analog_coefficients(chaos: float, program: str = "lorenz") -> dict[str, Any]:
    c = clamp01(chaos)
    if program == "harmonic":
        omega = 1 + c * 3
        return {
            "sigma": 10, "rho": 18 + c * 22, "beta": 8 / 3, "omega": omega,
            "mu": 0, "delta": 0, "gamma": 0, "alpha": 0,
            "label": f"ω {omega:.2f}",
        }
    if program == "vanderpol":
        mu = 0.25 + c * 2.7
        return {
            "sigma": 10, "rho": 18 + c * 22, "beta": 8 / 3, "omega": 1,
            "mu": mu, "delta": 0, "gamma": 0, "alpha": 0,
            "label": f"μ {mu:.2f}",
        }
    if program == "duffing":
        delta = 0.08 + c * 0.32
        gamma = 0.18 + c * 0.55
        return {
            "sigma": 10, "rho": 18 + c * 22, "beta": 8 / 3, "omega": 1.2,
            "mu": 0, "delta": delta, "gamma": gamma, "alpha": 0,
            "label": f"δ {delta:.2f} · γ {gamma:.2f}",
        }
    if program == "lotka":
        alpha = 0.85 + c * 0.55
        beta = 0.42 + c * 0.7
        return {
            "sigma": 10, "rho": 18 + c * 22, "beta": 8 / 3, "omega": 1,
            "mu": 0, "delta": 0.4 + c * 0.35, "gamma": 0.62, "alpha": alpha,
            "label": f"α {alpha:.2f} · β {beta:.2f}",
        }
    if program == "nemo":
        a = 0.02 + c * 0.08
        w = 3.5 + c * 14
        tau = 3 + (1 - c) * 9
        return {
            "sigma": 10, "rho": 18 + c * 22, "beta": 8 / 3, "omega": 1,
            "mu": a, "delta": w, "gamma": tau, "alpha": 0.2,
            "label": "AdEx · 5ORG · 2BRN",
        }
    rho = 18 + c * 22
    return {
        "sigma": 10, "rho": rho, "beta": 8 / 3, "omega": 1,
        "mu": 0, "delta": 0, "gamma": 0, "alpha": 0,
        "label": f"σ 10 · ρ {rho:.1f} · β {(8 / 3):.2f}",
    }


def optical_interfere(obj_amp: float, obj_phase: float, ref_amp: float, ref_phase: float) -> float:
    """Two-beam analog optical inner product. Not a digital FFT. Energy UNAVAILABLE."""
    ao = max(0.0, float(obj_amp))
    ar = max(0.0, float(ref_amp))
    intensity = ao * ao + ar * ar + 2 * ao * ar * math.cos(obj_phase - ref_phase)
    if not math.isfinite(intensity):
        return 0.0
    return max(0.0, intensity)


def optical_reconstruct(intensity: float, dphi: float) -> float:
    v = intensity * math.cos(dphi)
    if not math.isfinite(v):
        return 0.0
    return max(-1.0, min(1.0, v / 2.0))


def analog_circuit(x: float, y: float, z: float, corr: float = 0.0) -> dict[str, float]:
    """THAT analog-element *jobs* as live voltages. Not the circuit."""
    def u(n: float) -> float:
        v = float(n) if math.isfinite(float(n)) else 0.0
        return max(-1.0, min(1.0, v))

    xi, yi, zi = u(x), u(y), u(z)
    return {
        "intg": xi,
        "sum": u((xi + yi + zi) / 3.0),
        "mul": u(xi * yi),
        "inv": u(-xi),
        "cmp": 1.0 if xi >= 0 else -1.0,
        "corr": u(corr),
    }


def analog_correlate(pre: float, post: float, corr: float, dt: float, tau: float = 0.18) -> float:
    """Leaky analog correlator — BrainScaleS analog-correlator *job*, not the chip."""
    def u(n: float) -> float:
        v = float(n) if math.isfinite(float(n)) else 0.0
        return max(-1.0, min(1.0, v))

    product = u(pre) * u(post)
    t = max(1e-4, float(tau))
    a = 1.0 - math.exp(-max(0.0, float(dt)) / t)
    prev = u(corr)
    return u(prev + (product - prev) * a)


def analog_schmitt(x: float, last: float, hyst: float = 0.08) -> float:
    """Analog Schmitt trigger. Holds last polarity through the hysteresis band."""
    h = max(0.01, min(0.45, float(hyst)))
    xi = float(x) if math.isfinite(float(x)) else 0.0
    xi = max(-1.0, min(1.0, xi))
    if last >= 0:
        return 1.0 if xi > -h else -1.0
    return -1.0 if xi < h else 1.0


def analog_jack(ckt: dict[str, float], recon: float, drive: float) -> float:
    d = clamp01(drive)
    r = max(-1.0, min(1.0, float(recon) if math.isfinite(float(recon)) else 0.0))
    corr = max(-1.0, min(1.0, float(ckt.get("corr", 0.0) or 0.0)))
    v = ckt["intg"] * 0.55 + ckt["mul"] * 0.22 * d + corr * 0.12 * d + r * 0.22 * d
    return max(-1.0, min(1.0, v))


def analog_nemo_step(s: dict[str, Any], dt: float, chaos: float, drive: float) -> dict[str, Any]:
    """AdEx five-organ anatomy + WILLAY optical second brain.

    Brette & Gerstner 2005 membranes (BrainScaleS-2 *job*). Organ jobs:
    YACHAY cognition, YUYAY pacemaker If, YAWAR traveling wave (Miller 2026
    analog-wave *job*), OTel optical write, KHIPU bound. WILLAY is the
    optical ring — second brain, not a sixth organ. Drive is analog
    neuromodulator, not dopamine. Not a physical chip. Energy UNAVAILABLE.
    """
    c = clamp01(chaos)
    pots = analog_coefficients(c, "nemo")
    a_adapt = float(pots["mu"])
    chem_w = float(pots["delta"])
    tau = max(1.4, float(pots["gamma"]))
    i0 = 2.2 + drive * 10.5
    el, d_t, g_l = -65.0, 2.0, 0.12
    vt = -52 + c * 6
    tau_w = max(8.0, 42 - c * 28)
    vr = -58 + c * 8
    b_jump = 4 + c * 10
    v_peak = 20.0
    mod = clamp01(drive)
    bank = pad_nemo_bank(s.get("bank"))
    rate = float(s["z"]) if math.isfinite(float(s.get("z", 0))) else 0.0
    rate = max(0.0, min(1.0, rate))
    t = float(s["t"]) if math.isfinite(float(s.get("t", 0))) else 0.0
    total_ms = max(0.25, min(80.0, float(dt) * 1000.0))
    n = max(4, min(48, math.ceil(total_ms / 0.5)))
    h = total_ms / n

    for _ in range(n):
        I = [0.0] * 5
        iopts = [0.0] * 5
        t_ms = t * 1000.0
        pace_t = 170.0 + (1.0 - mod) * 260.0
        i_pace = mod * (1.6 + 3.8 * (0.5 + 0.5 * math.sin((t_ms * math.pi * 2) / pace_t)))
        willay_field = 0.0
        for i in range(5):
            opp = (i + 2) % 5
            prev = (i + 4) % 5
            ao = max(0.0, (bank[i] + 70) / 110)
            ar = max(0.0, (bank[opp] + 70) / 110)
            iopts[i] = optical_interfere(ao, bank[i] * 0.035, ar, bank[opp] * 0.035)
            willay_field += optical_reconstruct(iopts[i], (bank[i] - bank[opp]) * 0.035)
            i_wave = 0.72 * max(0.0, (bank[prev] - el) / 40.0)
            wi = max(0.05, min(4.0, bank[15 + i]))
            inj = bank[10 + i] + iopts[i] * (1.1 + drive * 0.9) * wi + i_wave
            if i == 0:
                inj += i0
            elif i == 1:
                inj += 0.8 + drive * 2.4 + i_pace
            else:
                inj += 0.8 + drive * 2.4
            if i == 3:
                inj += 0.45 * iopts[i]
            I[i] = inj
        willay_field /= 5.0
        gate = 0.35 + 0.65 * (0.5 + 0.5 * willay_field)
        fired: list[int] = []
        for i in range(5):
            vi = bank[i]
            ui = bank[5 + i]
            si = bank[10 + i]
            arg = max(-20.0, min(8.0, (vi - vt) / d_t))
            dv = -g_l * (vi - el) + g_l * d_t * math.exp(arg) - ui + I[i]
            du = (a_adapt * (vi - el) - ui) / tau_w
            vi += dv * h
            ui += du * h
            if i == 4:
                vi += (el - vi) * (h / 420.0)
            si += (-si / tau) * h
            if vi >= v_peak:
                vi = vr
                ui += b_jump
                fired.append(i)
            bank[i] = max(-90.0, min(40.0, vi))
            bank[5 + i] = max(-40.0, min(80.0, ui))
            bank[10 + i] = max(0.0, min(48.0, si))
        for i in fired:
            post = (i + 1) % 5
            opp = (i + 2) % 5
            avail = 1.0 - min(1.0, bank[10 + post] / 48.0)
            jump = chem_w * avail * (0.55 + 0.45 * gate)
            bank[10 + post] = min(48.0, bank[10 + post] + jump)
            nervous = 1.35 if i == 3 else 1.0
            bank[15 + i] = bank[15 + i] + 0.018 * (bank[10 + opp] / 48.0) * iopts[i] * mod * gate * nervous
            bank[15 + opp] = bank[15 + opp] - 0.006
        for i in range(5):
            leaked = bank[15 + i] + (1.0 - bank[15 + i]) * (h / 180.0)
            bank[15 + i] = max(0.05, min(4.0, leaked))
        decay = math.exp(-h / 38.0)
        rate = rate * decay + (len(fired) / 5.0) * (1 - decay) * 10
        if rate > 1:
            rate = 1.0
        t += h * 0.001
        if not math.isfinite(bank[0]) or not math.isfinite(rate) or not math.isfinite(t):
            return seed_analog("nemo")

    return {"x": bank[0], "y": bank[2], "z": rate, "t": t, "bank": bank}



def analog_step(program: str, s: dict[str, Any], dt: float, chaos: float, drive: float = 0.5) -> dict[str, Any]:
    if program == "nemo":
        return analog_nemo_step(s, dt, chaos, drive)
    pots = analog_coefficients(chaos, program)
    n = 4
    h = max(0.0004, min(0.08, float(dt))) / n
    x = float(s.get("x", 0.0))
    y = float(s.get("y", 0.0))
    z = float(s.get("z", 0.0))
    t = float(s.get("t", 0.0))
    for _ in range(n):
        if program == "harmonic":
            w2 = pots["omega"] * pots["omega"]
            dx, dy, dz = y, -w2 * x, 0.0
        elif program == "vanderpol":
            dx = y
            dy = pots["mu"] * (1 - x * x) * y - x
            dz = 0.0
        elif program == "duffing":
            force = pots["gamma"] * (0.45 + drive * 0.7) * math.cos(pots["omega"] * t)
            dx = y
            dy = x - x * x * x - pots["delta"] * y + force
            dz = 0.0
        elif program == "lotka":
            prey = max(0.02, x)
            pred = max(0.02, y)
            dx = pots["alpha"] * prey - pots["beta"] * prey * pred
            dy = pots["delta"] * prey * pred - pots["gamma"] * pred
            dz = 0.0
        else:
            dx = pots["sigma"] * (y - x)
            dy = x * (pots["rho"] - z) - y
            dz = x * y - pots["beta"] * z
        x += dx * h
        y += dy * h
        z += dz * h
        t += h
    if program == "lotka":
        x = max(0.02, x)
        y = max(0.02, y)
    if not all(math.isfinite(v) for v in (x, y, z, t)):
        return seed_analog(program)
    return {"x": x, "y": y, "z": z, "t": t}


def scale_analog(program: str, s: dict[str, Any]) -> dict[str, float]:
    x, y, z = float(s["x"]), float(s["y"]), float(s["z"])
    if program == "harmonic":
        e = 0.5 * (y * y + x * x)
        return {"x": max(-1, min(1, x)), "y": max(-1, min(1, y / 3)), "z": max(0, min(1, e * 0.5))}
    if program == "vanderpol":
        return {
            "x": max(-1, min(1, x / 2.4)),
            "y": max(-1, min(1, y / 3.2)),
            "z": max(0, min(1, (x * x + y * y) / 10)),
        }
    if program == "duffing":
        return {
            "x": max(-1, min(1, x / 2)),
            "y": max(-1, min(1, y / 2.4)),
            "z": max(0, min(1, 0.5 + 0.5 * math.sin(float(s["t"])))),
        }
    if program == "lotka":
        return {
            "x": max(-1, min(1, (x - 1.4) / 1.8)),
            "y": max(-1, min(1, (y - 1.1) / 1.6)),
            "z": max(0, min(1, (x + y) / 6)),
        }
    if program == "nemo":
        return {
            "x": max(-1, min(1, (x + 45) / 40)),
            "y": max(-1, min(1, (y + 45) / 40)),
            "z": max(0, min(1, z)),
        }
    return {
        "x": max(-1, min(1, x / 24)),
        "y": max(-1, min(1, y / 24)),
        "z": max(0, min(1, z / 48)),
    }


def analog_trail(
    program: str,
    s: dict[str, Any],
    steps: int,
    chaos: float,
    drive: float,
    dt: float,
) -> tuple[list[list[float]], dict[str, Any]]:
    cap = 400 if program == "nemo" else 2400
    steps = max(1, min(int(steps), cap))
    trail: list[list[float]] = []
    state = dict(s)
    for _ in range(steps):
        state = analog_step(program, state, dt, chaos, drive)
        trail.append([state["x"], state["y"], state["z"]])
    return trail, state


def optical_field(program: str, s: dict[str, Any], cols: int = 24, rows: int = 14) -> list[list[float]]:
    sc = scale_analog(program, s)
    field: list[list[float]] = []
    for r in range(rows):
        row: list[float] = []
        for c in range(cols):
            ao = 0.35 + 0.45 * (sc["z"])
            ar = 0.40 + 0.35 * abs(sc["x"])
            obj_p = (c / cols) * math.tau + sc["y"] * 1.4 + float(s.get("t", 0)) * 0.7
            ref_p = (r / rows) * math.tau + sc["z"] * 2.2
            row.append(optical_interfere(ao, obj_p, ar, ref_p))
        field.append(row)
    return field


def ouroboros_tax(amplitude: float, bars: int = 8) -> float:
    bars = max(1, min(int(bars), 64))
    return max(0.0, float(amplitude) * math.exp(-bars / 8.0))


def organs_eval(payload: dict) -> dict:
    # Hologram does not run the SZL kernel. Fail-closed — never fabricate LIVE.
    flags = {name: False for name in ORGANS}
    reason = "UNAVAILABLE — hologram has no kernel organs"
    if payload.get("fabricate_joule"):
        reason = "HARD_DENY — fabricated joule downs NERVOUS"
    return {
        "organs": flags,
        "live_count": 0,
        "blocked": True,
        "reason": reason,
        "energy": "UNAVAILABLE",
        "proven_trust": False,
        "uniqueness": "Conjecture 1",
    }


def analog_payload(data: dict) -> dict:
    program = str(data.get("program") or "lorenz")
    if program not in PROGRAMS:
        program = "lorenz"
    chaos = clamp01(float(data.get("chaos") if data.get("chaos") is not None else 0.45))
    drive = clamp01(float(data.get("drive") if data.get("drive") is not None else 0.55))
    dt = float(data.get("dt") or 0.016)
    steps = int(data.get("steps") or (180 if program == "nemo" else 480))
    seed = seed_analog(program)
    state = {
        "x": float(data["x"]) if data.get("x") is not None else seed["x"],
        "y": float(data["y"]) if data.get("y") is not None else seed["y"],
        "z": float(data["z"]) if data.get("z") is not None else seed["z"],
        "t": float(data["t"]) if data.get("t") is not None else 0.0,
    }
    if program == "nemo":
        bank = data.get("bank")
        state["bank"] = pad_nemo_bank(bank)
    trail, last = analog_trail(program, state, steps, chaos, drive, dt)
    sc = scale_analog(program, last)
    ao = max(0.0, 0.5 + 0.5 * math.hypot(sc["x"], sc["y"]))
    ar = max(0.0, 0.35 + 0.55 * sc["z"])
    dphi = math.atan2(sc["y"], sc["x"] + 1e-9)
    intensity = optical_interfere(ao, dphi, ar, 0.0)
    recon = optical_reconstruct(intensity, dphi)
    pots = analog_coefficients(chaos, program)
    corr = 0.0
    schmitt = 1.0
    for xyz in trail:
        tmp = {"x": float(xyz[0]), "y": float(xyz[1]), "z": float(xyz[2]), "t": 0.0}
        sci = scale_analog(program, tmp)
        corr = analog_correlate(sci["x"], sci["y"], corr, dt)
        schmitt = analog_schmitt(sci["x"], schmitt)
    ckt = analog_circuit(sc["x"], sc["y"], sc["z"], corr)
    ckt["cmp"] = schmitt
    out: dict[str, Any] = {
        "program": program,
        "label": PROGRAM_LABELS[program],
        "trail": trail[-180:],
        "last": [last["x"], last["y"], last["z"]],
        "t": last["t"],
        "scale": sc,
        "pots": pots,
        "holo": intensity,
        "recon": recon,
        "circuit": ckt,
        "jack": analog_jack(ckt, recon, drive),
        "field": optical_field(program, last),
        "honesty": "MEASURED",
        "energy": "UNAVAILABLE",
        "uniqueness": "Conjecture 1",
        "proven_trust": False,
    }
    if "bank" in last:
        out["bank"] = last["bank"]
    return out


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        return

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, payload: dict) -> None:
        self._send(code, json.dumps(payload).encode(), "application/json")

    def _read(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            data = json.loads(raw.decode())
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            body = HTML.read_bytes() if HTML.is_file() else b"<h1>NEXUS</h1>"
            self._send(200, body, "text/html; charset=utf-8")
            return
        if path in ("/health", "/healthz"):
            self._json(
                200,
                {
                    "ok": True,
                    "space": "nexus",
                    "kernel": "hologram",
                    "analog": "AdEx 5-organ anatomy + WILLAY second brain + analog correlator + hybrid IC + analog circuits + 3F STDP",
                    "programs": list(PROGRAMS),
                    "uniqueness": "Conjecture 1",
                    "energy": "UNAVAILABLE",
                    "proven_trust": False,
                    "github": "szl-holdings/nexus",
                },
            )
            return
        self._send(404, b"not found", "text/plain")

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        data = self._read()
        if path == "/api/lambda":
            axes = [float(x) for x in (data.get("axes") or list(YUYAY_FLOORS))]
            try:
                value = lambda_aggregate(axes)
                sacred = len(axes) >= 2 and (axes[0] < 0.95 or axes[1] < 0.95)
                blocked = sacred or value == 0.0
                self._json(
                    200,
                    {
                        "lambda": value,
                        "blocked": blocked,
                        "decision": "BLOCKED" if blocked else "ADMITTED",
                        "uniqueness": "Conjecture 1",
                        "honesty": "MEASURED",
                        "proven_trust": False,
                        "energy": "UNAVAILABLE",
                    },
                )
            except Exception as exc:
                self._json(400, {"error": str(exc), "honesty": "MEASURED"})
            return
        if path == "/api/analog":
            try:
                self._json(200, analog_payload(data))
            except Exception as exc:
                self._json(400, {"error": str(exc), "honesty": "MEASURED", "energy": "UNAVAILABLE"})
            return
        if path == "/api/lorenz":
            x = float(data.get("x") or 0.1)
            y = float(data.get("y") or 0.0)
            z = float(data.get("z") or 0.0)
            steps = int(data.get("steps") or 400)
            trail = lorenz_rk4(x, y, z, steps)
            self._json(
                200,
                {
                    "trail": trail[-180:],
                    "last": trail[-1],
                    "sigma": SIGMA,
                    "rho": RHO,
                    "beta": BETA,
                    "honesty": "MEASURED",
                    "energy": "UNAVAILABLE",
                },
            )
            return
        if path == "/api/organs":
            self._json(200, organs_eval(data))
            return
        if path == "/api/ouroboros":
            tax = ouroboros_tax(float(data.get("amplitude") or 1.0), int(data.get("bars") or 8))
            self._json(
                200,
                {
                    "tax": tax,
                    "bars": int(data.get("bars") or 8),
                    "energy": "UNAVAILABLE",
                    "uniqueness": "Conjecture 1",
                },
            )
            return
        self._send(404, b"not found", "text/plain")


def selftest() -> None:
    # Harmonic oscillator changes sign.
    s = seed_analog("harmonic")
    saw_neg = False
    for _ in range(400):
        s = analog_step("harmonic", s, 0.02, 0.0, 0.5)
        if s["x"] < 0:
            saw_neg = True
            break
    assert saw_neg, "harmonic never crossed zero"

    # Lotka stays positive.
    s = seed_analog("lotka")
    for _ in range(240):
        s = analog_step("lotka", s, 0.02, 0.4, 0.5)
        assert s["x"] > 0 and s["y"] > 0, "lotka left the first quadrant"

    # NEMO spikes under drive.
    s = seed_analog("nemo")
    spiked = False
    for _ in range(80):
        s = analog_step("nemo", s, 0.016, 0.45, 1.0)
        if s["z"] > 0.12:
            spiked = True
            break
        if any(v > 20 for v in (s.get("bank") or [])[:5]):
            spiked = True
            break
    assert spiked, "NEMO did not spike under drive"

    # Synaptic leak: a loaded trace decays with no spikes if drive is off and v held subthreshold.
    s = seed_analog("nemo")
    s["bank"][10] = 12.0
    s["bank"][0] = -80.0
    before = s["bank"][10]
    for _ in range(40):
        s = analog_step("nemo", s, 0.016, 0.0, 0.0)
    assert s["bank"][10] < before, "NEMO synapse did not leak"

    # Optical constructive / destructive.
    plus = optical_interfere(1, 0, 1, 0)
    minus = optical_interfere(1, 0, 1, math.pi)
    assert abs(plus - 4.0) < 1e-9, plus
    assert abs(minus - 0.0) < 1e-9, minus

    # Programs enumerate.
    assert len(PROGRAMS) == 6

    # 15-cell persist pads; optical STDP leaks toward 1 without spikes.
    s = seed_analog("nemo")
    s["bank"] = s["bank"][:15]
    s = analog_step("nemo", s, 0.016, 0.0, 0.0)
    assert len(s["bank"]) == 20, len(s["bank"])
    s["bank"][15:20] = [2.4] * 5
    s["bank"][0] = -80.0
    for _ in range(40):
        s = analog_step("nemo", s, 0.016, 0.0, 0.0)
    assert all(0.05 < w < 2.4 for w in s["bank"][15:20]), s["bank"][15:20]

    # Organs fail-closed on the hologram.
    org = organs_eval({})
    assert org["live_count"] == 0 and org["blocked"] is True

    ckt = analog_circuit(0.5, -0.4, 0.2)
    assert abs(ckt["mul"] - -0.2) < 1e-9
    assert analog_circuit(-0.2, 0, 0)["cmp"] == -1.0
    assert ckt["corr"] == 0.0
    c = 0.0
    for _ in range(80):
        c = analog_correlate(0.8, 0.5, c, 0.02, 0.12)
    assert c > 0.3
    assert analog_schmitt(-0.04, 1.0) == 1.0
    assert analog_schmitt(-0.2, 1.0) == -1.0
    driven = analog_jack(analog_circuit(0.5, 0, 0, 0.8), 0, 1)
    quiet = analog_jack(analog_circuit(0.5, 0, 0, 0.8), 0, 0)
    assert driven > quiet

    print("analog selftest ok — AdEx 5ORG, WILLAY 2BRN, analog correlator, hybrid IC, analog circuits, 3F STDP, optical (Ao+Ar)²", flush=True)


def main() -> None:
    if "--selftest" in sys.argv:
        selftest()
        return
    port = int(os.environ.get("PORT", "7860"))
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"nexus hologram listening 0.0.0.0:{port}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
