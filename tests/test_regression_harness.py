import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REGRESSION_SCRIPT = ROOT / "scripts" / "regression.mjs"


class RegressionHarnessTests(unittest.TestCase):
    def run_regression(self, *args):
        return subprocess.run(
            ["node", str(REGRESSION_SCRIPT), *map(str, args)],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def write_commands(self, path, commands):
        path.write_text(json.dumps(commands), encoding="utf-8")

    def test_record_then_check_normalizes_dynamic_fields(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            fixtures = base / "fixtures"
            record_commands = base / "record.json"
            check_commands = base / "check.json"
            self.write_commands(
                record_commands,
                [
                    {
                        "name": "dynamic",
                        "args": [
                            "node",
                            "-e",
                            "console.log('THE-42 2026-07-02T09:53:00.123Z http://127.0.0.1:3100/issues/2264cb84-3019-4cd0-a44d-c44f809d8f13 run=run-a updated=2026-07-02T09:53:00.123Z')",
                        ],
                    }
                ],
            )
            self.write_commands(
                check_commands,
                [
                    {
                        "name": "dynamic",
                        "args": [
                            "node",
                            "-e",
                            "console.log('THE-99 2026-07-02T10:10:10.999Z http://127.0.0.1:3100/issues/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee run=run-b updated=2026-07-02T10:10:10.999Z')",
                        ],
                    }
                ],
            )

            record = self.run_regression("record", "--fixtures-dir", fixtures, "--commands-file", record_commands)
            self.assertEqual(record.returncode, 0, record.stderr)

            check = self.run_regression("check", "--fixtures-dir", fixtures, "--commands-file", check_commands)
            self.assertEqual(check.returncode, 0, check.stdout + check.stderr)

    def test_check_fails_when_normalized_output_changes(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            fixtures = base / "fixtures"
            record_commands = base / "record.json"
            check_commands = base / "check.json"
            self.write_commands(record_commands, [{"name": "stable", "args": ["node", "-e", "console.log('alpha')"]}])
            self.write_commands(check_commands, [{"name": "stable", "args": ["node", "-e", "console.log('beta')"]}])

            record = self.run_regression("record", "--fixtures-dir", fixtures, "--commands-file", record_commands)
            self.assertEqual(record.returncode, 0, record.stderr)

            check = self.run_regression("check", "--fixtures-dir", fixtures, "--commands-file", check_commands)
            self.assertNotEqual(check.returncode, 0)
            self.assertIn("stable", check.stdout + check.stderr)


if __name__ == "__main__":
    unittest.main()
