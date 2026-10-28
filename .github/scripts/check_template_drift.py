#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""check_template_drift.py: fail closed when shared template files drift.

Reads template.lock.json at the repository root. Every `files` entry must exist
as a regular file whose sha256 equals the canonical template's bytes. Every
`local_extensions` entry is a declared fork, pinned to this repository's own
bytes, so changing it also requires a reviewed lock update. Standard library
only. Exit 0 when clean, 1 on drift, 2 on a malformed lock.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path, PurePosixPath

SCHEMA = "szl.template-lock/v1"
_SHA256 = re.compile(r"[0-9a-f]{64}")
_COMMIT = re.compile(r"[0-9a-f]{40}")


class LockError(ValueError):
    """The lock itself is unusable; treated as a failure, never a pass."""


def _no_duplicates(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise LockError(f"duplicate key in lock: {key!r}")
        out[key] = value
    return out


def _safe_rel(path):
    if not isinstance(path, str) or not path or "\\" in path:
        raise LockError(f"invalid path in lock: {path!r}")
    p = PurePosixPath(path)
    if p.is_absolute() or any(part in ("", ".", "..") for part in path.split("/")):
        raise LockError(f"path escapes the repository: {path!r}")
    return p


def load_lock(text):
    try:
        lock = json.loads(text, object_pairs_hook=_no_duplicates)
    except json.JSONDecodeError as exc:
        raise LockError(f"lock is not valid JSON: {exc}") from None
    if not isinstance(lock, dict) or lock.get("schema") != SCHEMA:
        raise LockError(f"lock schema must be {SCHEMA}")
    canonical = lock.get("canonical")
    if not isinstance(canonical, dict) or not isinstance(canonical.get("repo"), str) or not _COMMIT.fullmatch(str(canonical.get("commit"))):
        raise LockError("lock canonical must name a repo and a 40-hex commit")
    files, ext = lock.get("files"), lock.get("local_extensions", {})
    if not isinstance(files, dict) or not files or not isinstance(ext, dict):
        raise LockError("lock needs a non-empty files map and a local_extensions map")
    if set(files) & set(ext):
        raise LockError(f"paths both locked and declared local: {sorted(set(files) & set(ext))}")
    for section in (files, ext):
        for path, entry in section.items():
            _safe_rel(path)
            if not isinstance(entry, dict) or not _SHA256.fullmatch(str(entry.get("sha256"))):
                raise LockError(f"entry for {path} needs a lowercase sha256")
    for path, entry in ext.items():
        if not isinstance(entry.get("reason"), str) or not entry["reason"].strip():
            raise LockError(f"local extension {path} needs a reason")
    return lock


def check(root, lock):
    """Return a list of drift findings (empty when clean)."""
    root = Path(root).resolve()
    findings = []
    for section, label in ((lock["files"], "canonical"), (lock.get("local_extensions", {}), "declared local")):
        for path, entry in sorted(section.items()):
            target = root.joinpath(*_safe_rel(path).parts)
            if target.is_symlink() or not target.is_file():
                findings.append(f"MISSING {path} ({label} file is absent or not a regular file)")
                continue
            if target.resolve().parent != root.joinpath(*_safe_rel(path).parts[:-1]).resolve() or root not in target.resolve().parents:
                findings.append(f"ESCAPE {path} resolves outside the repository")
                continue
            try:
                got = hashlib.sha256(target.read_bytes()).hexdigest()
            except OSError as exc:
                findings.append(f"UNREADABLE {path} ({label}): {exc}")
                continue
            if got != entry["sha256"]:
                findings.append(f"DRIFT {path} ({label}) sha256 {got} != lock {entry['sha256']}")
    return findings


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    root = Path(argv[0]) if argv else Path.cwd()
    try:
        lock = load_lock((root / "template.lock.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, LockError) as exc:
        print(f"LOCK-ERROR {exc}", file=sys.stderr)
        return 2
    findings = check(root, lock)
    for line in findings:
        print(line)
    canon = lock["canonical"]
    n = len(lock["files"])
    m = len(lock.get("local_extensions", {}))
    if findings:
        print(f"TEMPLATE DRIFT: {len(findings)} finding(s) against {canon['repo']}@{canon['commit'][:12]}")
        return 1
    print(f"OK {n} canonical + {m} declared-local template files match {canon['repo']}@{canon['commit'][:12]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
