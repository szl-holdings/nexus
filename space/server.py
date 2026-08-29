#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""NEXUS hologram — stdlib analog computer. No npm. No Gradio. Port 7860.

Lorenz RK4, Λ weighted geometric mean, five-organ fail-closed lamps,
ouroboros loop-tax. Energy UNAVAILABLE. Λ uniqueness is Conjecture 1.
The full Web Audio instrument stays on github.com/szl-holdings/nexus.
"""
from __future__ import annotations

import json
import math
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HTML = Path(__file__).with_name("index.html")
SIGMA, RHO, BETA = 10.0, 28.0, 8.0 / 3.0
DT = 0.01
YUYAY_FLOORS = (0.95, 0.95) + (0.90,) * 11
ORGANS = ("YACHAY", "YUYAY", "YAWAR", "NERVOUS", "KHIPU")


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


def ouroboros_tax(amplitude: float, bars: int = 8) -> float:
    bars = max(1, min(int(bars), 64))
    return max(0.0, float(amplitude) * math.exp(-bars / 8.0))


def organs_eval(payload: dict) -> dict:
    flags = {
        "YACHAY": not bool(payload.get("zero_cortex")),
        "YUYAY": not bool(payload.get("zero_heart")),
        "YAWAR": not bool(payload.get("tamper_chain")),
        "NERVOUS": not bool(payload.get("fabricate_joule")),
        "KHIPU": not bool(payload.get("break_skeleton")),
    }
    live = [name for name, ok in flags.items() if ok]
    blocked = len(live) < 5
    reason = "all five organs live" if not blocked else "fail-closed: " + ",".join(
        name for name, ok in flags.items() if not ok
    )
    if payload.get("fabricate_joule"):
        reason = "HARD_DENY — fabricated joule downs NERVOUS"
        blocked = True
    return {
        "organs": flags,
        "live_count": len(live),
        "blocked": blocked,
        "reason": reason,
        "energy": "UNAVAILABLE",
        "proven_trust": False,
        "uniqueness": "Conjecture 1",
    }


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
                    "analog": "Lorenz RK4",
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


def main() -> None:
    port = int(os.environ.get("PORT", "7860"))
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"nexus hologram listening 0.0.0.0:{port}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
