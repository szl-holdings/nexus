# SPDX-License-Identifier: Apache-2.0
"""Tests for check_template_drift.py (stdlib unittest)."""
import hashlib
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_template_drift as ctd  # noqa: E402

COMMIT = "b" * 40


def sha(b):
    return hashlib.sha256(b).hexdigest()


class DriftTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "scripts").mkdir()
        self.files = {"scripts/a.mjs": b"export const a = 1;\n", "scripts/b.test.mjs": b"test();\n"}
        for p, b in self.files.items():
            (self.root / p).write_bytes(b)
        (self.root / "scripts/local.mjs").write_bytes(b"local\n")
        self.lock = {
            "schema": ctd.SCHEMA,
            "canonical": {"repo": "szl-holdings/a11oy-factory", "commit": COMMIT},
            "files": {p: {"sha256": sha(b)} for p, b in self.files.items()},
            "local_extensions": {"scripts/local.mjs": {"sha256": sha(b"local\n"), "reason": "declared fork"}},
        }
        self.write_lock()

    def tearDown(self):
        self.tmp.cleanup()

    def write_lock(self, text=None):
        (self.root / "template.lock.json").write_text(text if text is not None else json.dumps(self.lock), encoding="utf-8")

    def run_main(self):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = ctd.main([str(self.root)])
        return code, out.getvalue() + err.getvalue()

    def test_clean_tree_passes(self):
        code, out = self.run_main()
        self.assertEqual(code, 0, out)
        self.assertIn("OK 2 canonical + 1 declared-local", out)

    def test_one_byte_edit_is_drift(self):
        (self.root / "scripts/a.mjs").write_bytes(b"export const a = 2;\n")
        code, out = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("DRIFT scripts/a.mjs", out)

    def test_crlf_conversion_is_drift(self):
        (self.root / "scripts/a.mjs").write_bytes(b"export const a = 1;\r\n")
        self.assertEqual(self.run_main()[0], 1)

    def test_deleted_file_is_missing(self):
        (self.root / "scripts/b.test.mjs").unlink()
        code, out = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("MISSING scripts/b.test.mjs", out)

    def test_declared_local_file_change_needs_lock_update(self):
        (self.root / "scripts/local.mjs").write_bytes(b"changed\n")
        code, out = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("declared local", out)

    def test_directory_in_place_of_file_is_missing(self):
        (self.root / "scripts/a.mjs").unlink()
        (self.root / "scripts/a.mjs").mkdir()
        code, out = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("MISSING scripts/a.mjs", out)

    @unittest.skipIf(os.name == "nt", "symlink creation needs privilege on Windows")
    def test_symlink_is_refused(self):
        (self.root / "scripts/a.mjs").unlink()
        (self.root / "real.mjs").write_bytes(self.files["scripts/a.mjs"])
        os.symlink(self.root / "real.mjs", self.root / "scripts/a.mjs")
        self.assertEqual(self.run_main()[0], 1)

    def test_malformed_locks_exit_2(self):
        bad = [
            "not json",
            json.dumps(dict(self.lock, schema="v0")),
            json.dumps(dict(self.lock, canonical={"repo": "x", "commit": "abc"})),
            json.dumps(dict(self.lock, files={})),
            json.dumps(dict(self.lock, files={"../escape.mjs": {"sha256": "0" * 64}})),
            json.dumps(dict(self.lock, files={"/abs.mjs": {"sha256": "0" * 64}})),
            json.dumps(dict(self.lock, files={"scripts\\\\a.mjs": {"sha256": "0" * 64}})),
            json.dumps(dict(self.lock, files={"scripts/a.mjs": {"sha256": "A" * 64}})),
            json.dumps(dict(self.lock, local_extensions={"scripts/a.mjs": {"sha256": "0" * 64, "reason": "x"}})),
            json.dumps(dict(self.lock, local_extensions={"scripts/local.mjs": {"sha256": sha(b"local\n"), "reason": " "}})),
        ]
        for i, text in enumerate(bad):
            self.write_lock(text)
            self.assertEqual(self.run_main()[0], 2, i)

    def test_duplicate_keys_in_an_otherwise_valid_lock_exit_2(self):
        text = json.dumps(self.lock)
        self.write_lock(text[:-1] + ', "schema": "szl.template-lock/v1"}')
        self.assertEqual(self.run_main()[0], 2)
        path = next(iter(self.lock["files"]))
        dup = '"files": {' + json.dumps(path) + ': {"sha256": "' + "0" * 64 + '"}, '
        self.write_lock(text.replace('"files": {', dup, 1))
        self.assertEqual(self.run_main()[0], 2)

    def test_missing_lock_exits_2(self):
        (self.root / "template.lock.json").unlink()
        self.assertEqual(self.run_main()[0], 2)


if __name__ == "__main__":
    unittest.main()
