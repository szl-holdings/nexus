# SPDX-License-Identifier: Apache-2.0
"""Python port of src/lib/nexus/source-identity.ts (build-info and health)."""
import nexus_runtime as rt

SHA = "0123456789abcdef0123456789abcdef01234567"

BUILD_INFO_KEYS = [
    "schema", "source_repository", "source_revision", "hf_repository",
    "deployment_authority", "source_bound", "runtime", "frontend",
    "audio_execution", "deterministic_python_reference", "energy", "uniqueness",
]
HEALTH_KEYS = [
    "schema", "ok", "status", "ready", "service", "source_repository",
    "source_revision", "source_bound", "runtime", "frontend", "audio",
    "state_storage", "accounts_required", "external_effectors", "energy", "uniqueness",
]


def test_valid_revision_is_bound():
    health = rt.runtime_health(SHA)
    assert health["source_revision"] == SHA
    assert health["source_bound"] is True
    assert health["status"] == "ok"
    assert health["ready"] is True


def test_placeholders_are_unavailable():
    for raw in ("", None, "0" * 40, "abc", SHA + "0", "g" * 40):
        assert rt.normalize_source_revision(raw) == "UNAVAILABLE", raw
        health = rt.runtime_health(raw)
        assert (health["status"], health["ready"], health["source_bound"]) == ("degraded", False, False)


def test_revision_is_trimmed_and_lowercased():
    assert rt.normalize_source_revision(" " + SHA.upper() + " \r\n") == SHA


def test_key_order():
    assert list(rt.build_info(SHA)) == BUILD_INFO_KEYS
    assert list(rt.runtime_health(SHA)) == HEALTH_KEYS


def test_runtime_label():
    assert rt.RUNTIME == "PYTHON_STDLIB_STATIC_WEB_AUDIO"
    assert rt.build_info(SHA)["runtime"] == "PYTHON_STDLIB_STATIC_WEB_AUDIO"
    assert rt.runtime_health(SHA)["runtime"] == "PYTHON_STDLIB_STATIC_WEB_AUDIO"


def test_missing_file_reads_unavailable(tmp_path):
    assert rt.read_source_revision(tmp_path / "absent") == "UNAVAILABLE"
    path = tmp_path / "SOURCE_GITHUB_SHA"
    path.write_text(SHA + "\n", encoding="utf-8")
    assert rt.read_source_revision(path) == SHA + "\n"


def test_dumps_is_compact_utf8():
    assert rt.dumps({"a": "·", "b": [1, True, None]}) == '{"a":"·","b":[1,true,null]}'.encode()
