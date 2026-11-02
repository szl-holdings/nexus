# SPDX-License-Identifier: Apache-2.0
"""Verify local static bytes without inferring browser or audio acceptance."""
from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import re
import stat
import threading
import time

MANIFEST = "nexus-static-manifest.json"
SCHEMA = "szl.nexus-static-manifest/v1"
MAX_FILES = 4096
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_TOTAL_BYTES = 256 * 1024 * 1024
MAX_MANIFEST_BYTES = 2 * 1024 * 1024
REFRESH_SECONDS = 30
MAX_VERIFICATION_AGE_SECONDS = 90


class BundleError(ValueError):
    pass


def _pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise BundleError("DUPLICATE_MANIFEST_KEY")
        result[key] = value
    return result


def _path(value):
    if (not isinstance(value, str) or not value or "\\" in value or "\0" in value
            or value == MANIFEST or any(part in ("", ".", "..") for part in value.split("/"))):
        raise BundleError("INVALID_MANIFEST_PATH")
    return value


def _files(root):
    found = set()
    pending = [root]
    directories = 0
    entries_seen = 0
    while pending:
        directory = pending.pop()
        directories += 1
        if directories > MAX_FILES:
            raise BundleError("BUNDLE_LIMIT_EXCEEDED")
        with os.scandir(directory) as entries:
            for entry in entries:
                entries_seen += 1
                if entries_seen > 2 * MAX_FILES + 1:
                    raise BundleError("BUNDLE_LIMIT_EXCEEDED")
                if entry.is_symlink():
                    raise BundleError("SYMLINK_IN_STATIC_BUNDLE")
                if entry.is_dir(follow_symlinks=False):
                    pending.append(Path(entry.path))
                elif entry.is_file(follow_symlinks=False):
                    name = Path(entry.path).relative_to(root).as_posix()
                    if name != MANIFEST:
                        found.add(name)
                    if len(found) > MAX_FILES:
                        raise BundleError("BUNDLE_LIMIT_EXCEEDED")
                else:
                    raise BundleError("NONREGULAR_STATIC_FILE")
    return found


def _read(path, limit, digest=False):
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    with os.fdopen(descriptor, "rb") as handle:
        before = os.fstat(handle.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            raise BundleError("BUNDLE_LIMIT_EXCEEDED")
        hasher, chunks, length = hashlib.sha256(), [], 0
        while chunk := handle.read(min(64 * 1024, limit + 1 - length)):
            length += len(chunk)
            if length > limit:
                raise BundleError("BUNDLE_LIMIT_EXCEEDED")
            if digest:
                hasher.update(chunk)
            else:
                chunks.append(chunk)
        after = os.fstat(handle.fileno())
        if (length != before.st_size or before.st_size != after.st_size
                or before.st_mtime_ns != after.st_mtime_ns):
            raise BundleError("STATIC_FILE_CHANGED_DURING_READ")
    return (length, hasher.hexdigest()) if digest else b"".join(chunks)


def inspect_static_bundle(root: Path) -> dict:
    """Recheck the served file set and bytes; an HTTP process alone is not ready."""
    result = {"ready": False, "state": "UNAVAILABLE", "scope": "LOCAL_STATIC_BYTES",
              "browser_execution": "NOT_EVALUATED", "files_checked": 0}
    try:
        root = Path(root).resolve()
        manifest_path = root / MANIFEST
        if manifest_path.is_symlink():
            raise BundleError("SYMLINK_IN_STATIC_BUNDLE")
        manifest_bytes = _read(manifest_path, MAX_MANIFEST_BYTES)
        manifest = json.loads(manifest_bytes, object_pairs_hook=_pairs)
        if (not isinstance(manifest, dict) or set(manifest) != {"schema", "files"}
                or manifest["schema"] != SCHEMA or not isinstance(manifest["files"], list)
                or not 1 <= len(manifest["files"]) <= MAX_FILES):
            raise BundleError("INVALID_MANIFEST")
        expected, total = {}, 0
        for item in manifest["files"]:
            if not isinstance(item, dict) or set(item) != {"path", "size", "sha256"}:
                raise BundleError("INVALID_MANIFEST_ENTRY")
            name = _path(item["path"])
            size = item["size"]
            if (name in expected or type(size) is not int or not 0 <= size <= MAX_FILE_BYTES
                    or not isinstance(item["sha256"], str)
                    or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"])):
                raise BundleError("INVALID_MANIFEST_ENTRY")
            total += size
            if total > MAX_TOTAL_BYTES:
                raise BundleError("BUNDLE_LIMIT_EXCEEDED")
            expected[name] = item
        if (not expected.get("index.html", {}).get("size")
                or not any(name.startswith("assets/") and name.endswith(".js") and row["size"]
                           for name, row in expected.items())):
            raise BundleError("WORKSTATION_ASSETS_MISSING")
        if _files(root) != set(expected):
            raise BundleError("STATIC_FILE_SET_MISMATCH")
        for name, item in expected.items():
            path = root / name
            if not path.resolve().is_relative_to(root):
                raise BundleError("STATIC_PATH_ESCAPE")
            size, digest = _read(path, MAX_FILE_BYTES, digest=True)
            if (size, digest) != (item["size"], item["sha256"]):
                raise BundleError("STATIC_FILE_DIGEST_MISMATCH")
            result["files_checked"] += 1
        result.update(ready=True, state="VERIFIED", manifest_sha256=hashlib.sha256(manifest_bytes).hexdigest())
    except BundleError as exc:
        result["reason"] = str(exc)
    except (OSError, ValueError, UnicodeError, RecursionError):
        result["reason"] = "STATIC_MANIFEST_OR_FILE_UNREADABLE"
    return result


class StaticBundleVerifier:
    """One periodic verifier; request handlers only read a bounded cached result."""

    def __init__(self, root: Path, *, clock=time.monotonic):
        self.root = Path(root)
        self._clock = clock
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = None
        self.refresh()

    def refresh(self):
        result = inspect_static_bundle(self.root)
        result["checked_at"] = datetime.now(timezone.utc).isoformat()
        with self._lock:
            self._result = result
            self._checked_at = self._clock()

    def _run(self):
        while not self._stop.wait(REFRESH_SECONDS):
            self.refresh()

    def start(self):
        if self._thread is None:
            self._thread = threading.Thread(target=self._run, daemon=True,
                                            name="nexus-static-verifier")
            self._thread.start()

    def stop(self):
        self._stop.set()

    def snapshot(self):
        with self._lock:
            result = dict(self._result)
            age = max(0.0, self._clock() - self._checked_at)
        result["verification_age_seconds"] = round(age, 3)
        result["max_verification_age_seconds"] = MAX_VERIFICATION_AGE_SECONDS
        if age > MAX_VERIFICATION_AGE_SECONDS:
            result.update(ready=False, state="STALE", reason="STATIC_VERIFICATION_EXPIRED")
        return result
