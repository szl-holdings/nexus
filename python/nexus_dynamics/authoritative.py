# SPDX-License-Identifier: Apache-2.0
"""Opt-in client of one admitted loopback Node authority; no local math fallback.

This client is installable with nexus_dynamics and uses only Python's stdlib.
The authority service itself requires the NEXUS source checkout and Node >=22.6.
Delegation is not independent Python/JavaScript numerical parity or attestation.
"""
from __future__ import annotations

import hashlib
import http.client
import json
import math
import re
import socket
import struct
import threading
from typing import Any
from urllib.parse import urlsplit

from .canonical import nexus_hash
from .schema import NexusRunInput

PROFILE_SCHEMA = "szl.nexus-authority-profile/v1"
REQUEST_SCHEMA = "szl.nexus-authoritative-request/v1"
RESULT_SCHEMA = "szl.nexus-authoritative-execution/v1"
ERROR_SCHEMA = "szl.nexus-authority-error/v1"
EXECUTION = "DELEGATED_SINGLE_NODE_PROCESS"
MAX_REQUEST_BYTES = 65_536
MAX_RESPONSE_BYTES = 1_048_576
SOURCE_PATHS = {
    "src/lib/nexus/authoritative-node.ts", "src/lib/nexus/dynamics.ts", "src/lib/nexus/math.ts",
    "contracts/nexus-authoritative-execution-v1.json",
}


class AuthorityError(ValueError):
    """A failed admission, transport or result-integrity check. Never falls back."""
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def exact_authority_json(value: Any) -> str:
    """Exact binary64 structural encoding, with signed zero folded for JSON transport."""
    def project(item: Any) -> Any:
        if item is None:
            return ["null"]
        if isinstance(item, bool):
            return ["bool", item]
        if isinstance(item, str):
            return ["string", item]
        if isinstance(item, (int, float)):
            number = float(item)
            if not math.isfinite(number):
                raise AuthorityError("NON_FINITE_NUMBER", "Authority values must be finite")
            return ["number", struct.pack("!d", 0.0 if number == 0 else number).hex()]
        if isinstance(item, list):
            return ["array", [project(element) for element in item]]
        if isinstance(item, dict) and all(isinstance(key, str) for key in item):
            return ["object", [[key, project(item[key])] for key in sorted(item, key=lambda key: key.encode("utf-8"))]]
        raise AuthorityError("INVALID_VALUE", "Authority values must be JSON values")
    return json.dumps(project(value), ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _exact_hash(value: Any) -> str:
    return hashlib.sha256(exact_authority_json(value).encode("utf-8")).hexdigest()


def _digest(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def validate_authority_profile(value: Any) -> None:
    valid = isinstance(value, dict) and set(value) == {
        "schema", "authorityId", "algorithmContract", "execution", "runtime", "sourceFilesSha256"
    }
    if valid:
        runtime = value["runtime"]
        sources = value["sourceFilesSha256"]
        valid = (
            value["schema"] == PROFILE_SCHEMA and value["algorithmContract"] == RESULT_SCHEMA
            and value["execution"] == EXECUTION and isinstance(value["authorityId"], str)
            and re.fullmatch(r"[0-9a-f-]{36}", value["authorityId"]) is not None
            and isinstance(runtime, dict)
            and set(runtime) == {"node", "v8", "platform", "arch", "execArgv", "executableSha256"}
            and all(isinstance(runtime[key], str) and runtime[key] for key in ("node", "v8", "platform", "arch"))
            and isinstance(runtime["execArgv"], list) and all(isinstance(arg, str) for arg in runtime["execArgv"])
            and _digest(runtime["executableSha256"])
            and isinstance(sources, dict) and set(sources) == SOURCE_PATHS and all(_digest(v) for v in sources.values())
        )
    if not valid:
        raise AuthorityError("INVALID_PROFILE", "A complete admitted authority profile is required")


def _request(profile: dict, payload: Any, contract: str, method: str) -> dict:
    validate_authority_profile(profile)
    if contract not in ("immune-v1", "dynamics-v2"):
        raise AuthorityError("UNKNOWN_CONTRACT", "Unknown output contract")
    if method not in ("euler4", "rk4", "symplectic"):
        raise AuthorityError("UNKNOWN_METHOD", "Unknown integration method")
    if contract == "immune-v1" and method != "euler4":
        raise AuthorityError("UNSUPPORTED_METHOD", "immune-v1 supports only euler4")
    normalized = NexusRunInput.from_dict(payload).to_dict()
    return {"schema": REQUEST_SCHEMA, "expectedProfile": profile, "contract": contract, "method": method, "input": normalized}


def verify_authority_result(value: Any, expected_profile: dict, payload: Any, *,
                            contract: str = "dynamics-v2", method: str = "euler4") -> dict:
    """Verify request binding and existing canonical hashes, without rerunning math."""
    request = _request(expected_profile, payload, contract, method)
    try:
        valid = (
            isinstance(value, dict) and set(value) == {
                "schema", "execution", "profile", "contract", "method", "input", "inputHash", "output", "outputHash", "resultHash"
            }
            and value["schema"] == RESULT_SCHEMA and value["execution"] == EXECUTION
            and value["profile"] == expected_profile and value["contract"] == contract and value["method"] == method
            and NexusRunInput.from_dict(value["input"]).to_dict() == request["input"]
            and value["input"] == request["input"] and value["inputHash"] == _exact_hash(request)
            and isinstance(value["output"], dict)
            and value["output"].get("schema") == ("szl.immune-nexus-parity/v1" if contract == "immune-v1" else "szl.nexus-dynamics-output/v2")
            and value["outputHash"] == nexus_hash(value["output"])
            and value["resultHash"] == _exact_hash({key: item for key, item in value.items() if key != "resultHash"})
        )
    except (ValueError, TypeError, KeyError, OverflowError, RecursionError):
        valid = False
    if not valid:
        raise AuthorityError("INVALID_RESULT", "Authority result does not match the admitted request and payload hashes")
    return value


def _reject_constant(value: str) -> None:
    raise ValueError(f"non-JSON numeric constant: {value}")


def _exchange(endpoint: str, path: str, payload: dict | None, timeout: float) -> Any:
    try:
        url = urlsplit(endpoint)
        port = url.port
        if (url.scheme != "http" or url.hostname != "127.0.0.1" or not port or url.username or url.password
                or url.path not in ("", "/") or url.query or url.fragment):
            raise ValueError("unsupported endpoint")
    except (TypeError, ValueError) as exc:
        raise AuthorityError("INVALID_ENDPOINT", "Use an explicit http://127.0.0.1:port endpoint") from exc
    if isinstance(timeout, bool) or not isinstance(timeout, (float, int)) or not math.isfinite(timeout) or not 0 < timeout <= 120:
        raise AuthorityError("INVALID_TIMEOUT", "Timeout must be between 0 and 120 seconds")
    body = None if payload is None else json.dumps(payload, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if body is not None and len(body) > MAX_REQUEST_BYTES:
        raise AuthorityError("BODY_TOO_LARGE", "Authority request exceeds its size limit")
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    timed_out = threading.Event()
    active_socket: list[socket.socket] = []

    def abort() -> None:
        timed_out.set()
        if active_socket:
            try:
                active_socket[0].shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            active_socket[0].close()

    # A socket timeout alone resets on reads; this timer also bounds drip-fed headers/body.
    timer = threading.Timer(timeout, abort)
    timer.daemon = True
    timer.start()
    try:
        connection.connect()
        assert connection.sock is not None
        active_socket.append(connection.sock)
        if timed_out.is_set():
            raise AuthorityError("TIMEOUT", "Authority request exceeded its total deadline")
        connection.request("GET" if body is None else "POST", path, body=body,
                           headers={} if body is None else {"Content-Type": "application/json"})
        response = connection.getresponse()
        if response.getheader("Content-Type") != "application/json" or response.getheader("Content-Encoding"):
            raise AuthorityError("INVALID_RESPONSE", "Authority must return unencoded JSON")
        raw = response.read(MAX_RESPONSE_BYTES + 1)
        if timed_out.is_set():
            raise AuthorityError("TIMEOUT", "Authority request exceeded its total deadline")
        if len(raw) > MAX_RESPONSE_BYTES:
            raise AuthorityError("BODY_TOO_LARGE", "Authority response exceeds its size limit")
        declared_length = response.getheader("Content-Length")
        if declared_length is not None and int(declared_length) != len(raw):
            raise AuthorityError("INVALID_RESPONSE", "Authority response was truncated")
        value = json.loads(raw, parse_constant=_reject_constant)
        if response.status != 200:
            if (isinstance(value, dict) and value.get("schema") == ERROR_SCHEMA and isinstance(value.get("error"), dict)
                    and isinstance(value["error"].get("code"), str) and isinstance(value["error"].get("message"), str)):
                raise AuthorityError(value["error"]["code"], value["error"]["message"])
            raise AuthorityError("INVALID_RESPONSE", "Authority returned an invalid error response")
        return value
    except AuthorityError:
        raise
    except (OSError, ValueError, http.client.HTTPException, RecursionError) as exc:
        code = "TIMEOUT" if timed_out.is_set() or isinstance(exc, TimeoutError) else "TRANSPORT_ERROR"
        raise AuthorityError(code, "Authority request failed; no native fallback was attempted") from exc
    finally:
        timer.cancel()
        connection.close()


def read_authority_profile(endpoint: str, *, timeout: float = 30) -> dict:
    """Explicit admission/discovery. Execution never calls this automatically."""
    profile = _exchange(endpoint, "/profile", None, timeout)
    validate_authority_profile(profile)
    return profile


def run_authoritative(payload: Any, *, endpoint: str, expected_profile: dict,
                      contract: str = "dynamics-v2", method: str = "euler4", timeout: float = 30) -> dict:
    """Delegate to the specified admitted process, then verify exact canonical hashes."""
    validate_authority_profile(expected_profile)
    profile = json.loads(json.dumps(expected_profile, allow_nan=False))
    request = _request(profile, payload, contract, method)
    result = _exchange(endpoint, "/run", request, timeout)
    return verify_authority_result(result, profile, payload, contract=contract, method=method)


def main(argv: list[str] | None = None) -> int:
    """Run against an explicitly saved startup/admission record; never auto-discover."""
    import argparse
    import sys
    from pathlib import Path

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--authority-file", required=True, help="saved authority startup JSON (endpoint and admitted profile)")
    parser.add_argument("--input", required=True, help="engine input JSON file, or - for stdin")
    parser.add_argument("--contract", choices=("immune-v1", "dynamics-v2"), default="dynamics-v2")
    parser.add_argument("--method", choices=("euler4", "rk4", "symplectic"), default="euler4")
    args = parser.parse_args(argv)
    try:
        admission = json.loads(Path(args.authority_file).read_text(encoding="utf-8"), parse_constant=_reject_constant)
        if not isinstance(admission, dict) or set(admission) != {"endpoint", "profile"}:
            raise AuthorityError("INVALID_PROFILE", "Authority file must contain endpoint and admitted profile")
        raw = sys.stdin.read() if args.input == "-" else Path(args.input).read_text(encoding="utf-8")
        payload = json.loads(raw, parse_constant=_reject_constant)
        result = run_authoritative(payload, endpoint=admission["endpoint"], expected_profile=admission["profile"],
                                   contract=args.contract, method=args.method)
        print(json.dumps(result, allow_nan=False, separators=(",", ":")))
        return 0
    except Exception as exc:
        print(json.dumps({"schema": ERROR_SCHEMA, "error": {"code": getattr(exc, "code", "CLIENT_ERROR"), "message": str(exc)}}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
