#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Runtime payloads for the Python-served NEXUS Space.

Byte-for-byte port of ``src/lib/nexus/source-identity.ts``. The parity test
``scripts/space-runtime-parity.test.mjs`` runs both implementations on the same
inputs, so any change here must be made in the TypeScript source as well.
"""
from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

SOURCE_REPOSITORY = "szl-holdings/nexus"
HF_REPOSITORY = "SZLHOLDINGS/nexus"
DEPLOYMENT_AUTHORITY = "szl-holdings/.github/.github/workflows/publish-nexus-space.yml"
UNAVAILABLE = "UNAVAILABLE"
RUNTIME = "PYTHON_STDLIB_STATIC_WEB_AUDIO"

_EXACT_GIT_REVISION = re.compile(r"[0-9a-f]{40}")
_ZERO_REVISION = "0" * 40
# String.prototype.trim(): ECMAScript WhiteSpace plus LineTerminator. Differs from
# str.strip(), which keeps U+FEFF and also removes U+001C..U+001F and U+0085.
_JS_TRIM = (
    "\t\n\v\f\r          "
    "        　﻿"
)


def normalize_source_revision(raw: object) -> str:
    value = ("" if raw is None else str(raw)).strip(_JS_TRIM).lower()
    if not _EXACT_GIT_REVISION.fullmatch(value) or value == _ZERO_REVISION:
        return UNAVAILABLE
    return value


def read_source_revision(path: str | os.PathLike[str]) -> str:
    try:
        # Like Node readFileSync(path, "utf8"): bad bytes become U+FFFD, newlines stay.
        with open(path, encoding="utf-8", errors="replace", newline="") as handle:
            return handle.read()
    except OSError:
        return UNAVAILABLE


def build_info(raw_revision: object) -> dict:
    source_revision = normalize_source_revision(raw_revision)
    return {
        "schema": "szl.nexus-source-binding/v2",
        "source_repository": SOURCE_REPOSITORY,
        "source_revision": source_revision,
        "hf_repository": HF_REPOSITORY,
        "deployment_authority": DEPLOYMENT_AUTHORITY,
        "source_bound": source_revision != UNAVAILABLE,
        "runtime": RUNTIME,
        "frontend": "REACT_TANSTACK_WEB_AUDIO",
        "audio_execution": "BROWSER_LOCAL_USER_GESTURE",
        "deterministic_python_reference": "SOURCE_ONLY",
        "energy": UNAVAILABLE,
        "uniqueness": "Conjecture 1",
    }


def runtime_health(raw_revision: object) -> dict:
    info = build_info(raw_revision)
    return {
        "schema": "szl.nexus-runtime-health/v1",
        "ok": True,
        "status": "ok" if info["source_bound"] else "degraded",
        "ready": info["source_bound"],
        "service": "nexus",
        "source_repository": info["source_repository"],
        "source_revision": info["source_revision"],
        "source_bound": info["source_bound"],
        "runtime": info["runtime"],
        "frontend": info["frontend"],
        "audio": "USER_GESTURE_REQUIRED",
        "state_storage": "BROWSER_INDEXEDDB",
        "accounts_required": False,
        "external_effectors": False,
        "energy": info["energy"],
        "uniqueness": info["uniqueness"],
    }


ENDPOINTS = [
    # A11oy's /wires + /hatun-mcp surfaces declare this product MCP transport.
    # Distinct from the retired standalone Python Hatun deployment.
    {"id": "hatun", "label": "Hatun product gateway", "url": "https://szlholdings-a11oy.hf.space/mcp/"},
    {"id": "anatomy", "label": "Anatomy", "url": "https://betterwithage-anatomy.hf.space/healthz"},
    {"id": "nexus-space", "label": "NEXUS runtime", "url": "https://szlholdings-nexus.hf.space/api/build-info"},
]

FETCH_REDIRECT_LIMIT = 20
MAX_PROBE_BYTES = 64 * 1024
HATUN_INITIALIZE = {
    "jsonrpc": "2.0", "id": "nexus-probe", "method": "initialize",
    "params": {"protocolVersion": "2024-11-05", "capabilities": {},
               "clientInfo": {"name": "nexus-probe", "version": "1"}},
}


class _FetchRedirects(urllib.request.HTTPRedirectHandler):
    """Follow GET redirects like fetch; reject redirects of the exact MCP POST."""

    max_repeats = max_redirections = FETCH_REDIRECT_LIMIT + 1  # the count below fails first

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if req.get_method() == "POST":
            fp.close()
            raise urllib.error.URLError("MCP redirect rejected")
        followed = getattr(req, "fetch_redirects", 0)
        if followed == FETCH_REDIRECT_LIMIT:
            fp.close()
            raise urllib.error.URLError("redirect count exceeded")
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None:
            new.fetch_redirects = followed + 1
        return new


# Node's fetch ignores proxy environment variables; so does this opener.
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), _FetchRedirects())


class _NotJson(ValueError):
    pass


def _reject_constant(name: str) -> object:
    raise _NotJson(name)


def _is_timeout(exc: BaseException) -> bool:
    reason = getattr(exc, "reason", None)
    return isinstance(exc, TimeoutError) or isinstance(reason, TimeoutError)


class _ProbeTooLarge(ValueError):
    pass


def _read_response(url: str | urllib.request.Request, timeout_s: float):
    """Bound the entire response by wall-clock time and actual body bytes.

    The daemon also covers DNS and header stalls outside socket timeouts. Its
    response is always closed, including after the caller's deadline expires.
    """
    deadline = time.monotonic() + timeout_s
    done = threading.Event()
    outcome: dict = {}

    def attempt() -> None:
        try:
            with _OPENER.open(url, timeout=timeout_s) as response:
                body = bytearray()
                while True:
                    if time.monotonic() >= deadline:
                        raise TimeoutError("response missed the deadline")
                    chunk = response.read1(min(4096, MAX_PROBE_BYTES + 1 - len(body)))
                    if not chunk:
                        # read1(), unlike read(), permits premature EOF. A valid
                        # JSON prefix must not qualify an incomplete response.
                        if response.length is not None and response.length > 0:
                            raise ConnectionError("incomplete response body")
                        break
                    body.extend(chunk)
                    if len(body) > MAX_PROBE_BYTES:
                        raise _ProbeTooLarge()
                outcome["result"] = (response.status, bytes(body))
        except Exception as exc:  # noqa: BLE001 - re-raised in the caller
            if isinstance(exc, urllib.error.HTTPError):
                exc.close()
            outcome["error"] = exc
        finally:
            done.set()

    threading.Thread(target=attempt, daemon=True).start()
    if not done.wait(max(0.0, deadline - time.monotonic())):
        raise TimeoutError("response missed the deadline")
    if "error" in outcome:
        raise outcome["error"]
    return outcome["result"]


def _probe_one(endpoint: dict, timeout_s: float, now_ms: Callable[[], int]) -> dict:
    """Mirror probeOne(): bound headers and body by one deadline and byte limit."""
    at = now_ms()
    head = {"id": endpoint["id"], "label": endpoint["label"]}
    if "unavailable" in endpoint:
        return {**head, "status": "UNAVAILABLE", "detail": endpoint["unavailable"], "at": at}
    hatun = endpoint["id"] == "hatun"
    try:
        request = urllib.request.Request(
            endpoint["url"], data=dumps(HATUN_INITIALIZE), method="POST",
            headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"},
        ) if hatun else endpoint["url"]
        status, raw_body = _read_response(request, timeout_s)
    except urllib.error.HTTPError as exc:
        exc.close()
        return {**head, "status": "UNAVAILABLE", "detail": f"HTTP {exc.code}", "at": at}
    except Exception as exc:  # noqa: BLE001 - every other failure is unreachable
        detail = ("response too large" if isinstance(exc, _ProbeTooLarge) else
                  "timeout" if _is_timeout(exc) else "cors or unreachable")
        return {**head, "status": "UNAVAILABLE", "detail": detail, "at": at}
    nexus = endpoint["id"] == "nexus-space"
    anatomy = endpoint["id"] == "anatomy"
    unavailable = (
        "runtime source identity unavailable" if nexus else
        "anatomy transport contract unavailable" if anatomy else
        "A11oy MCP handshake unavailable" if hatun else f"HTTP {status}"
    )
    detail = unavailable
    live = not nexus and not anatomy and not hatun
    try:
        body = json.loads(raw_body, parse_constant=_reject_constant)
        if body is None:
            raise _NotJson("null")  # TS reads a property of null and lands in its catch
        fields = body if isinstance(body, dict) else {}
        if nexus:
            revision = fields.get("source_revision")
            live = (
                fields.get("schema") == "szl.nexus-source-binding/v2"
                and fields.get("source_repository") == SOURCE_REPOSITORY
                and fields.get("hf_repository") == HF_REPOSITORY
                and fields.get("deployment_authority") == DEPLOYMENT_AUTHORITY
                and fields.get("source_bound") is True
                and isinstance(revision, str)
                and revision != UNAVAILABLE
                and normalize_source_revision(revision) == revision
                and fields.get("runtime") == RUNTIME
                and fields.get("energy") == UNAVAILABLE
                and fields.get("uniqueness") == "Conjecture 1"
            )
            detail = "source-bound Python runtime" if live else "runtime source identity unavailable"
        elif anatomy:
            # Transport for a read-only snapshot, not scientific/model qualification.
            live = (
                fields.get("service") == "anatomy-space"
                and fields.get("organ") == "anatomy"
                and fields.get("status") == "ok"
                and fields.get("transport_state") == "REACHABLE"
                and fields.get("authority_state") == "READ_ONLY"
                and fields.get("evidence_state") == "SNAPSHOT"
                and fields.get("verification_state") == "STRUCTURAL_ONLY"
            )
            detail = "read-only transport; snapshot evidence" if live else unavailable
        elif hatun:
            result = fields.get("result")
            result = result if isinstance(result, dict) else {}
            server = result.get("serverInfo")
            server = server if isinstance(server, dict) else {}
            capabilities = result.get("capabilities")
            capabilities = capabilities if isinstance(capabilities, dict) else {}
            tools = capabilities.get("tools")
            tools = tools if isinstance(tools, dict) else {}
            live = (
                fields.get("jsonrpc") == "2.0" and fields.get("id") == HATUN_INITIALIZE["id"]
                and "error" not in fields and result.get("protocolVersion") == "2024-11-05"
                and server.get("name") == "szl-a11oy-mcp" and server.get("version") == "1.1.0"
                and tools.get("listChanged") is False
            )
            detail = "A11oy MCP transport; signing unverified" if live else unavailable
        elif isinstance(fields.get("status"), str):
            detail = fields["status"]
        elif isinstance(fields.get("evidenceState"), str):
            detail = fields["evidenceState"]
        elif isinstance(fields.get("sdk"), str):
            detail = fields["sdk"]
    except Exception:  # noqa: BLE001 - invalid service contracts must remain unavailable
        detail = unavailable
    return {**head, "status": "LIVE" if live else "UNAVAILABLE", "detail": detail, "at": at}


def probe_estate(
    timeout_s: float = 2.8,
    endpoints: list[dict] | None = None,
    now_ms: Callable[[], int] = lambda: int(time.time() * 1000),
) -> list[dict]:
    targets = ENDPOINTS if endpoints is None else endpoints
    with ThreadPoolExecutor(max_workers=max(1, len(targets))) as pool:
        return list(pool.map(lambda endpoint: _probe_one(endpoint, timeout_s, now_ms), targets))


def dumps(payload: object) -> bytes:
    """Serialize like JavaScript ``JSON.stringify`` for these payloads."""
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def main(argv: list[str]) -> int:
    commands = {"build-info": build_info, "health": runtime_health}
    if len(argv) == 2 and argv[0] in commands:
        sys.stdout.buffer.write(dumps(commands[argv[0]](argv[1])))
        return 0
    if len(argv) == 3 and argv[0] == "probes":
        sys.stdout.buffer.write(dumps(probe_estate(float(argv[2]), json.loads(argv[1]))))
        return 0
    print("usage: nexus_runtime.py build-info|health <revision> | probes <endpoints-json> <timeout-s>", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
