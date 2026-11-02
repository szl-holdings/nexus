# SPDX-License-Identifier: Apache-2.0
import hashlib
import json
import threading

import pytest

import static_assets as assets


@pytest.fixture()
def bundle(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text('<script type="module" src="/assets/app.js"></script>')
    (tmp_path / "assets" / "app.js").write_text('import "./chunk.js";')
    (tmp_path / "assets" / "chunk.js").write_text('export const value = 1;')
    rows = [
        {"path": path.relative_to(tmp_path).as_posix(), "size": path.stat().st_size,
         "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        for path in sorted(tmp_path.rglob("*")) if path.is_file()
    ]
    (tmp_path / assets.MANIFEST).write_text(json.dumps({"schema": assets.SCHEMA, "files": rows}))
    return tmp_path


def test_valid_complete_bundle_has_only_local_integrity_claim(bundle):
    report = assets.inspect_static_bundle(bundle)
    assert report["ready"] is True
    assert report["files_checked"] == 3
    assert report["scope"] == "LOCAL_STATIC_BYTES"
    assert report["browser_execution"] == "NOT_EVALUATED"
    assert "source_revision" not in report
    assert "deployment" not in report


@pytest.mark.parametrize("name", ["index.html", "assets/app.js", "assets/chunk.js", assets.MANIFEST])
def test_missing_entry_or_transitive_asset_is_not_ready(bundle, name):
    (bundle / name).unlink()
    assert assets.inspect_static_bundle(bundle)["ready"] is False


def test_changed_same_length_bytes_are_not_ready(bundle):
    path = bundle / "assets/chunk.js"
    path.write_text(path.read_text().replace("= 1", "= 2"))
    report = assets.inspect_static_bundle(bundle)
    assert report["ready"] is False
    assert report["reason"] == "STATIC_FILE_DIGEST_MISMATCH"


def test_unlisted_file_does_not_become_part_of_a_verified_bundle(bundle):
    (bundle / "unexpected.js").write_text("extra")
    assert assets.inspect_static_bundle(bundle)["reason"] == "STATIC_FILE_SET_MISMATCH"


@pytest.mark.parametrize("path", ["../outside", "/outside", "assets/../../outside", "assets\\outside", "assets//chunk.js", "assets/./chunk.js"])
def test_manifest_paths_cannot_escape_or_alias(bundle, path):
    manifest = json.loads((bundle / assets.MANIFEST).read_text())
    manifest["files"][0]["path"] = path
    (bundle / assets.MANIFEST).write_text(json.dumps(manifest))
    report = assets.inspect_static_bundle(bundle)
    assert report["ready"] is False
    assert report["reason"] == "INVALID_MANIFEST_PATH"


@pytest.mark.parametrize("payload", ["null", "[]", "{}", "{", '{"schema":"x","schema":"y","files":[]}'])
def test_malformed_manifest_fails_closed(bundle, payload):
    (bundle / assets.MANIFEST).write_text(payload)
    assert assets.inspect_static_bundle(bundle)["ready"] is False


@pytest.mark.parametrize("change", ["duplicate", "bool-size", "large-size", "bad-hash"])
def test_invalid_entries_fail_closed(bundle, change):
    manifest = json.loads((bundle / assets.MANIFEST).read_text())
    if change == "duplicate":
        manifest["files"].append(dict(manifest["files"][0]))
    else:
        key, value = {"bool-size": ("size", True), "large-size": ("size", assets.MAX_FILE_BYTES + 1),
                      "bad-hash": ("sha256", "a" * 63)}[change]
        manifest["files"][0][key] = value
    (bundle / assets.MANIFEST).write_text(json.dumps(manifest))
    assert assets.inspect_static_bundle(bundle)["ready"] is False


def test_symlink_cannot_substitute_a_manifested_asset(bundle):
    path = bundle / "assets/chunk.js"
    path.unlink()
    path.symlink_to(bundle / "assets/app.js")
    assert assets.inspect_static_bundle(bundle)["reason"] == "SYMLINK_IN_STATIC_BUNDLE"


def test_actual_file_size_is_bounded_before_hashing(bundle):
    with (bundle / "assets/chunk.js").open("wb") as handle:
        handle.truncate(assets.MAX_FILE_BYTES + 1)
    assert assets.inspect_static_bundle(bundle)["reason"] == "BUNDLE_LIMIT_EXCEEDED"


def test_directory_inventory_is_bounded(bundle, monkeypatch):
    monkeypatch.setattr(assets, "MAX_FILES", 3)
    for index in range(10):
        (bundle / f"empty-{index}").mkdir()
    assert assets.inspect_static_bundle(bundle)["reason"] == "BUNDLE_LIMIT_EXCEEDED"


def test_refresh_worker_is_single_and_stops(bundle, monkeypatch):
    monkeypatch.setattr(assets, "REFRESH_SECONDS", 0.01)
    verifier = assets.StaticBundleVerifier(bundle)
    completed = threading.Event()
    original = verifier.refresh

    def refresh():
        original()
        completed.set()

    verifier.refresh = refresh
    verifier.start()
    first = verifier._thread
    verifier.start()
    assert verifier._thread is first
    assert completed.wait(2)
    verifier.stop()
    first.join(timeout=2)
    assert not first.is_alive()


def test_stale_cached_result_never_claims_readiness(bundle):
    now = [100.0]
    verifier = assets.StaticBundleVerifier(bundle, clock=lambda: now[0])
    assert verifier.snapshot()["ready"] is True
    now[0] += assets.MAX_VERIFICATION_AGE_SECONDS + 1
    report = verifier.snapshot()
    assert report["ready"] is False
    assert report["state"] == "STALE"
    assert report["verification_age_seconds"] == 91


@pytest.mark.parametrize("declared_size", [0, 1])
def test_undersized_manifest_entry_is_rejected_before_hashing(bundle, monkeypatch, declared_size):
    manifest = json.loads((bundle / assets.MANIFEST).read_text())
    manifest["files"].sort(key=lambda row: row["path"] == "assets/chunk.js")
    for row in manifest["files"]:
        if row["path"] == "assets/chunk.js":
            row["size"] = declared_size
    budget = sum(row["size"] for row in manifest["files"])
    monkeypatch.setattr(assets, "MAX_TOTAL_BYTES", budget)
    (bundle / assets.MANIFEST).write_text(json.dumps(manifest))
    original_sha256 = hashlib.sha256
    hashed_bytes = []

    class CountingHash:
        def __init__(self, *args, **kwargs):
            self.inner = original_sha256(*args, **kwargs)

        def update(self, chunk):
            hashed_bytes.append(len(chunk))
            self.inner.update(chunk)

        def hexdigest(self):
            return self.inner.hexdigest()

    monkeypatch.setattr(assets.hashlib, "sha256", CountingHash)
    report = assets.inspect_static_bundle(bundle)
    assert report["ready"] is False
    assert sum(hashed_bytes) <= budget
    assert report["reason"] == "BUNDLE_LIMIT_EXCEEDED"
