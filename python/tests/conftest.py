# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest
from hypothesis import HealthCheck, settings

PYTHON_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = PYTHON_DIR.parent
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

# Deterministic, artifact-free Hypothesis runs (no .hypothesis/ database, no
# wall-clock deadline: some examples integrate tens of thousands of ticks).
settings.register_profile(
    "nexus",
    derandomize=True,
    database=None,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow],
)
settings.load_profile("nexus")


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="session")
def repo_root() -> Path:
    return REPO_ROOT


@pytest.fixture(scope="session")
def parity_doc() -> dict:
    return json.loads((REPO_ROOT / "contracts" / "nexus-parity-v2.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def contract() -> dict:
    return json.loads((REPO_ROOT / "contracts" / "immune-nexus.v1.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def hologram_server():
    """The stdlib hologram (root server.py), imported without starting a server."""
    return load_module("nexus_hologram_server", REPO_ROOT / "server.py")
