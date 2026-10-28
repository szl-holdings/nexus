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
    {"id": "hatun", "label": "Hatun MCP", "url": "https://szlholdings-hatun-mcp.hf.space/healthz"},
    {"id": "anatomy", "label": "Anatomy", "url": "https://szlholdings-anatomy.hf.space/version"},
    {"id": "nexus-space", "label": "NEXUS hologram", "url": "https://szlholdings-nexus.hf.space/api/build-info"},
]

FETCH_REDIRECT_LIMIT = 20
# undici, behind Node's fetch, allows this much silence between body chunks.
BODY_IDLE_TIMEOUT_S = 300.0


class _FetchRedirects(urllib.request.HTTPRedirectHandler):
    """Follow redirects like fetch: 20 at most, then a network error, not a status."""

    max_repeats = max_redirections = FETCH_REDIRECT_LIMIT + 1  # the count below fails first

    def redirect_request(self, req, fp, code, msg, headers, newurl):
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


def _open_head(url: str, timeout_s: float):
    """Return the response once its head arrives within timeout_s of wall-clock time.

    This is the TS abort timer: it covers DNS, connect, TLS, redirects and the head
    together. The socket timeout is undici's body idle limit, which applies once the
    head is in. A late attempt is abandoned and its response closed unread when it
    arrives.
    """
    done = threading.Event()
    lock = threading.Lock()
    outcome: dict = {}

    def attempt() -> None:
        try:
            result = (_OPENER.open(url, timeout=BODY_IDLE_TIMEOUT_S), None)
        except Exception as exc:  # noqa: BLE001 - re-raised in the caller
            result = (None, exc)
        with lock:
            abandoned = "abandoned" in outcome
            outcome["result"] = result
        if abandoned:
            late = result[0] if result[0] is not None else result[1]
            getattr(late, "close", lambda: None)()  # an HTTPError holds a response too
        done.set()

    threading.Thread(target=attempt, daemon=True).start()
    done.wait(timeout_s)
    with lock:
        if "result" not in outcome:
            outcome["abandoned"] = True
            raise TimeoutError("response head missed the deadline")
    response, error = outcome["result"]
    if error is not None:
        raise error
    return response


def _probe_one(endpoint: dict, timeout_s: float, now_ms: Callable[[], int]) -> dict:
    """Mirror probeOne(): the deadline covers the response head only, like the TS abort."""
    at = now_ms()
    head = {"id": endpoint["id"], "label": endpoint["label"]}
    try:
        response = _open_head(endpoint["url"], timeout_s)
    except urllib.error.HTTPError as exc:
        exc.close()
        return {**head, "status": "UNAVAILABLE", "detail": f"HTTP {exc.code}", "at": at}
    except Exception as exc:  # noqa: BLE001 - every other failure is unreachable
        detail = "timeout" if _is_timeout(exc) else "cors or unreachable"
        return {**head, "status": "UNAVAILABLE", "detail": detail, "at": at}
    with response:
        status = response.status
        detail = f"HTTP {status}"
        live = True
        try:
            body = json.loads(response.read(), parse_constant=_reject_constant)
            if body is None:
                raise _NotJson("null")  # TS reads a property of null and lands in its catch
            fields = body if isinstance(body, dict) else {}
            if endpoint["id"] == "nexus-space":
                role = fields.get("role") if isinstance(fields.get("role"), str) else ""
                energy = fields.get("energy") if isinstance(fields.get("energy"), str) else ""
                live = role == "hologram-not-instrument" and energy == "UNAVAILABLE"
                detail = "hologram-not-instrument" if live else "instrument not bound · hologram only"
            elif isinstance(fields.get("status"), str):
                detail = fields["status"]
            elif isinstance(fields.get("evidenceState"), str):
                detail = fields["evidenceState"]
            elif isinstance(fields.get("sdk"), str):
                detail = fields["sdk"]
        except Exception:  # noqa: BLE001 - mirrors the TS catch: keep LIVE, report the status
            detail = f"HTTP {status}"
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
