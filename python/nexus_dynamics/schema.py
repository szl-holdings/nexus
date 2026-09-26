# SPDX-License-Identifier: Apache-2.0
"""Dataclasses mirroring ``contracts/immune-nexus.v1.json``.

The contract is vendored byte-identical from ``szl-holdings/immune``
(``contracts/immune-nexus.v1.json``, sha256
``1959e535f48165870dd9d3eb25c3e77f80531214c1cb5d16accda181a652ee6a``). The
constants below restate its bounds; ``tests/test_schema.py`` fails if they drift
from the JSON.

``NexusRunRequest`` is the full contract object (caller envelope ``actor`` and
``requestId`` plus the engine input). ``NexusRunInput`` is the engine subset
that the simulation and ``inputHash`` depend on. Runtime-only rules that the
JSON Schema cannot express are enforced exactly as IMMUNE's runtime does:
NEMO is capped at 400 steps, ``state.bank`` is accepted only for NEMO and must
hold exactly 15 or 20 finite values, and NEMO state must carry a bank.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any, Mapping

from .errors import (
    INVALID_ACTOR,
    INVALID_AXES,
    INVALID_NEMO_BANK,
    INVALID_REQUEST,
    INVALID_REQUEST_ID,
    INVALID_STATE,
    MISSING_FIELD,
    NON_FINITE_NUMBER,
    OUT_OF_RANGE,
    UNKNOWN_MODE,
    UNKNOWN_PROGRAM,
    UNSUPPORTED_FIELD,
    UNSUPPORTED_STATE_FIELD,
    NexusDynamicsError,
)

CONTRACT_ID = "https://a-11-oy.com/contracts/immune-nexus.v1.json"
CONTRACT_SHA256 = "1959e535f48165870dd9d3eb25c3e77f80531214c1cb5d16accda181a652ee6a"

PROGRAMS: tuple[str, ...] = ("lorenz", "harmonic", "vanderpol", "duffing", "lotka", "nemo")
MODES: tuple[str, ...] = ("IC", "OP", "HALT", "REP")

STEPS_MIN = 0
STEPS_MAX = 2_400
NEMO_STEPS_MAX = 400
DT_MIN = 0.0004
DT_MAX = 0.08
UNIT_MIN = 0.0
UNIT_MAX = 1.0
REPEAT_EVERY_MIN = 1
REPEAT_EVERY_MAX = 512
STATE_T_MIN = 0.0
STATE_T_MAX = 1_000_000.0
BANK_MIN_ITEMS = 15
BANK_MAX_ITEMS = 20
BANK_RUNTIME_LENGTHS = (15, 20)
AXES_MIN_ITEMS = 1
AXES_MAX_ITEMS = 64
ACTOR_MIN_LENGTH = 1
ACTOR_MAX_LENGTH = 256
REQUEST_ID_MIN_LENGTH = 8
REQUEST_ID_MAX_LENGTH = 128
REQUEST_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._:-]*$"

REQUIRED_FIELDS: tuple[str, ...] = (
    "actor",
    "requestId",
    "program",
    "mode",
    "steps",
    "dt",
    "chaos",
    "drive",
    "seed",
    "repeatEvery",
)
INPUT_FIELDS: tuple[str, ...] = (
    "program",
    "mode",
    "steps",
    "dt",
    "chaos",
    "drive",
    "seed",
    "repeatEvery",
    "state",
    "axes",
)
STATE_FIELDS: tuple[str, ...] = ("x", "y", "z", "t", "bank")
STATE_REQUIRED: tuple[str, ...] = ("x", "y", "z", "t")

_REQUEST_ID_RE = re.compile(REQUEST_ID_PATTERN)


def finite_number(name: str, value: Any) -> float:
    """A JSON number (never a bool or a numeric string) that is finite."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise NexusDynamicsError(NON_FINITE_NUMBER, f"{name} must be a JSON number")
    number = float(value)
    if not math.isfinite(number):
        raise NexusDynamicsError(NON_FINITE_NUMBER, f"{name} must be finite")
    return number


def number_in_range(name: str, value: Any, minimum: float, maximum: float) -> float:
    number = finite_number(name, value)
    if number < minimum or number > maximum:
        raise NexusDynamicsError(OUT_OF_RANGE, f"{name} must be between {minimum} and {maximum}")
    return number


def integer_in_range(name: str, value: Any, minimum: int, maximum: int) -> int:
    message = f"{name} must be an integer between {minimum} and {maximum}"
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise NexusDynamicsError(OUT_OF_RANGE, message)
    if isinstance(value, float) and (not math.isfinite(value) or not value.is_integer()):
        raise NexusDynamicsError(OUT_OF_RANGE, message)
    number = int(value)
    if number < minimum or number > maximum:
        raise NexusDynamicsError(OUT_OF_RANGE, message)
    return number


@dataclass(frozen=True)
class NexusState:
    """Contract ``state``: x, y, z, t and (NEMO only) the 20-cell bank."""

    x: float
    y: float
    z: float
    t: float
    bank: tuple[float, ...] | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"x": self.x, "y": self.y, "z": self.z, "t": self.t}
        if self.bank is not None:
            out["bank"] = list(self.bank)
        return out

    def values(self) -> tuple[float, ...]:
        return (self.x, self.y, self.z, self.t, *(self.bank or ()))

    def is_finite(self) -> bool:
        return all(math.isfinite(value) for value in self.values())

    @classmethod
    def from_dict(cls, program: str, payload: Any) -> "NexusState":
        if not isinstance(payload, Mapping):
            raise NexusDynamicsError(INVALID_STATE, "state must be an object")
        extras = sorted(set(payload) - set(STATE_FIELDS))
        if extras:
            raise NexusDynamicsError(UNSUPPORTED_STATE_FIELD, f"unsupported state fields: {extras}")
        missing = [key for key in STATE_REQUIRED if key not in payload]
        if missing:
            raise NexusDynamicsError(INVALID_STATE, f"state missing required fields: {missing}")
        x = finite_number("state.x", payload["x"])
        y = finite_number("state.y", payload["y"])
        z = finite_number("state.z", payload["z"])
        t = number_in_range("state.t", payload["t"], STATE_T_MIN, STATE_T_MAX)
        bank: tuple[float, ...] | None = None
        if program == "nemo":
            raw = payload.get("bank")
            if not isinstance(raw, (list, tuple)) or len(raw) not in BANK_RUNTIME_LENGTHS:
                raise NexusDynamicsError(
                    INVALID_NEMO_BANK, "NEMO state.bank must contain exactly 15 or 20 finite values"
                )
            values = [finite_number(f"state.bank[{index}]", value) for index, value in enumerate(raw)]
            if len(values) == 15:
                values.extend([1.0] * 5)
            bank = tuple(values)
        elif "bank" in payload:
            raise NexusDynamicsError(
                UNSUPPORTED_STATE_FIELD, "state.bank is accepted only for the NEMO program"
            )
        return cls(x=x, y=y, z=z, t=t, bank=bank)


@dataclass(frozen=True)
class NexusRunInput:
    """Engine input: every contract field except the caller envelope."""

    program: str
    mode: str
    steps: int
    dt: float
    chaos: float
    drive: float
    seed: float
    repeat_every: int
    state: NexusState | None = None
    axes: tuple[float, ...] | None = None

    def __post_init__(self) -> None:
        # Re-validate so a directly constructed input obeys the same contract.
        validated = NexusRunInput._validate(self.to_dict(), allow_envelope=False)
        if validated != self.to_dict():
            raise NexusDynamicsError(INVALID_REQUEST, "input is not in canonical contract form")

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "program": self.program,
            "mode": self.mode,
            "steps": self.steps,
            "dt": self.dt,
            "chaos": self.chaos,
            "drive": self.drive,
            "seed": self.seed,
            "repeatEvery": self.repeat_every,
        }
        if self.state is not None:
            out["state"] = self.state.to_dict()
        if self.axes is not None:
            out["axes"] = list(self.axes)
        return out

    @staticmethod
    def _validate(payload: Any, *, allow_envelope: bool) -> dict[str, Any]:
        if not isinstance(payload, Mapping):
            raise NexusDynamicsError(INVALID_REQUEST, "NEXUS input must be an object")
        allowed = set(INPUT_FIELDS) | ({"actor", "requestId"} if allow_envelope else set())
        extras = sorted(set(payload) - allowed)
        if extras:
            raise NexusDynamicsError(UNSUPPORTED_FIELD, f"unsupported fields: {extras}")
        required = [field for field in REQUIRED_FIELDS if field not in ("actor", "requestId")]
        missing = [field for field in required if field not in payload]
        if missing:
            raise NexusDynamicsError(MISSING_FIELD, f"missing required fields: {missing}")
        program = payload["program"]
        if not isinstance(program, str) or program not in PROGRAMS:
            raise NexusDynamicsError(UNKNOWN_PROGRAM, f"unknown program: {program!r}")
        mode = payload["mode"]
        if not isinstance(mode, str) or mode not in MODES:
            raise NexusDynamicsError(UNKNOWN_MODE, f"unknown mode: {mode!r}")
        max_steps = NEMO_STEPS_MAX if program == "nemo" else STEPS_MAX
        out: dict[str, Any] = {
            "program": program,
            "mode": mode,
            "steps": integer_in_range("steps", payload["steps"], STEPS_MIN, max_steps),
            "dt": number_in_range("dt", payload["dt"], DT_MIN, DT_MAX),
            "chaos": number_in_range("chaos", payload["chaos"], UNIT_MIN, UNIT_MAX),
            "drive": number_in_range("drive", payload["drive"], UNIT_MIN, UNIT_MAX),
            "seed": number_in_range("seed", payload["seed"], UNIT_MIN, UNIT_MAX),
            "repeatEvery": integer_in_range(
                "repeatEvery", payload["repeatEvery"], REPEAT_EVERY_MIN, REPEAT_EVERY_MAX
            ),
        }
        if "state" in payload:
            out["state"] = NexusState.from_dict(program, payload["state"]).to_dict()
        if "axes" in payload:
            axes = payload["axes"]
            if not isinstance(axes, (list, tuple)) or not AXES_MIN_ITEMS <= len(axes) <= AXES_MAX_ITEMS:
                raise NexusDynamicsError(
                    INVALID_AXES, f"axes must contain between {AXES_MIN_ITEMS} and {AXES_MAX_ITEMS} values"
                )
            out["axes"] = [
                number_in_range(f"axes[{index}]", value, UNIT_MIN, UNIT_MAX)
                for index, value in enumerate(axes)
            ]
        return out

    @classmethod
    def from_dict(cls, payload: Any) -> "NexusRunInput":
        data = cls._validate(payload, allow_envelope=False)
        return cls._from_validated(data)

    @classmethod
    def _from_validated(cls, data: dict[str, Any]) -> "NexusRunInput":
        state = None
        if "state" in data:
            raw = data["state"]
            bank = tuple(raw["bank"]) if "bank" in raw else None
            state = NexusState(x=raw["x"], y=raw["y"], z=raw["z"], t=raw["t"], bank=bank)
        return cls(
            program=data["program"],
            mode=data["mode"],
            steps=data["steps"],
            dt=data["dt"],
            chaos=data["chaos"],
            drive=data["drive"],
            seed=data["seed"],
            repeat_every=data["repeatEvery"],
            state=state,
            axes=tuple(data["axes"]) if "axes" in data else None,
        )


@dataclass(frozen=True)
class NexusRunRequest:
    """The complete ``immune-nexus.v1`` request object."""

    actor: str
    request_id: str
    input: NexusRunInput

    def to_dict(self) -> dict[str, Any]:
        return {"actor": self.actor, "requestId": self.request_id, **self.input.to_dict()}

    @classmethod
    def from_dict(cls, payload: Any) -> "NexusRunRequest":
        if not isinstance(payload, Mapping):
            raise NexusDynamicsError(INVALID_REQUEST, "NEXUS request must be an object")
        for field in ("actor", "requestId"):
            if field not in payload:
                raise NexusDynamicsError(MISSING_FIELD, f"missing required fields: [{field!r}]")
        actor = payload["actor"]
        if not isinstance(actor, str) or not ACTOR_MIN_LENGTH <= len(actor) <= ACTOR_MAX_LENGTH:
            raise NexusDynamicsError(
                INVALID_ACTOR, f"actor must be a string of {ACTOR_MIN_LENGTH}..{ACTOR_MAX_LENGTH} characters"
            )
        request_id = payload["requestId"]
        if (
            not isinstance(request_id, str)
            or not REQUEST_ID_MIN_LENGTH <= len(request_id) <= REQUEST_ID_MAX_LENGTH
            or _REQUEST_ID_RE.fullmatch(request_id) is None
        ):
            raise NexusDynamicsError(
                INVALID_REQUEST_ID,
                f"requestId must match {REQUEST_ID_PATTERN} with "
                f"{REQUEST_ID_MIN_LENGTH}..{REQUEST_ID_MAX_LENGTH} characters",
            )
        data = NexusRunInput._validate(payload, allow_envelope=True)
        return cls(actor=actor, request_id=request_id, input=NexusRunInput._from_validated(data))
