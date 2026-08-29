"""SZL holographic Space — stdlib HTTP. No npm. No Gradio. Port 7860."""
from __future__ import annotations

import json
import math
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HTML = Path(__file__).with_name("index.html")
EPS = 1e-9


def lambda_aggregate(axes: list[float]) -> float:
    if not axes:
        raise ValueError("axes empty")
    if any(x < 0 for x in axes):
        raise ValueError("axes must be >= 0")
    k = len(axes)
    w = 1.0 / k
    if any(x == 0 for x in axes):
        return 0.0
    return math.exp(sum(w * math.log(x) for x in axes))


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

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            self._send(200, HTML.read_bytes() if HTML.exists() else b"<h1>SZL</h1>", "text/html; charset=utf-8")
            return
        if path in ("/health", "/healthz"):
            self._send(200, b'{"ok":true}', "application/json")
            return
        self._send(404, b"not found", "text/plain")

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            data = json.loads(raw.decode())
        except Exception:
            data = {}
        if path == "/api/lambda":
            axes = [float(x) for x in (data.get("axes") or [])]
            try:
                value = lambda_aggregate(axes)
                sacred = len(axes) >= 2 and (axes[0] < 0.95 or axes[1] < 0.95)
                body = {
                    "lambda": value,
                    "decision": "BLOCKED" if sacred else "ADMITTED",
                    "uniqueness": "Conjecture 1",
                    "honesty": "MEASURED",
                }
                self._send(200, json.dumps(body).encode(), "application/json")
            except Exception as exc:
                self._send(400, json.dumps({"error": str(exc), "honesty": "MEASURED"}).encode(), "application/json")
            return
        self._send(404, b"not found", "text/plain")


def main() -> None:
    port = int(os.environ.get("PORT", "7860"))
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"szl-space listening 0.0.0.0:{port}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
