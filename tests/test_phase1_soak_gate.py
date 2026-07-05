import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REGRESSION_SCRIPT = ROOT / "scripts" / "regression.mjs"
READINESS_SCRIPT = ROOT / "scripts" / "phase1-soak-check.mjs"


class Phase1ReadinessGateTests(unittest.TestCase):
    def run_node(self, *args):
        return subprocess.run(
            ["node", *map(str, args)],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def write_json(self, path, payload):
        path.write_text(json.dumps(payload), encoding="utf-8")

    def test_readiness_check_authorizes_when_migration_and_both_regression_modes_pass(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            fixtures = base / "fixtures"
            commands = base / "commands.json"
            self.write_json(commands, [{"name": "stable", "args": ["node", "-e", "console.log('stable')"]}])

            record = self.run_node(REGRESSION_SCRIPT, "record", "--fixtures-dir", fixtures, "--commands-file", commands)
            self.assertEqual(record.returncode, 0, record.stdout + record.stderr)

            result = self.run_node(
                READINESS_SCRIPT,
                "--fixtures-dir",
                fixtures,
                "--commands-file",
                commands,
                "--started-at",
                "2026-07-02T00:00:00.000Z",
                "--now",
                "2026-07-05T00:00:00.000Z",
                "--json",
            )

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["eligible"])
        self.assertEqual(payload["gate"], "migration-and-regression")
        self.assertEqual(payload["startedAt"], "2026-07-02T00:00:00.000Z")
        self.assertNotIn("eligibleAt", payload)
        self.assertNotIn("soakDays", payload)
        self.assertEqual(payload["checks"]["migration"]["status"], 0)
        self.assertEqual(payload["checks"]["regressionLegacy"]["status"], 0)
        self.assertEqual(payload["checks"]["regressionChambers"]["status"], 0)
        self.assertEqual(payload["checks"]["regressionChambers"]["env"]["CHAMBER_MODE"], "chambers")

    def test_readiness_check_no_longer_requires_started_at(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            fixtures = base / "fixtures"
            commands = base / "commands.json"
            self.write_json(commands, [{"name": "stable", "args": ["node", "-e", "console.log('stable')"]}])

            record = self.run_node(REGRESSION_SCRIPT, "record", "--fixtures-dir", fixtures, "--commands-file", commands)
            self.assertEqual(record.returncode, 0, record.stdout + record.stderr)

            result = self.run_node(
                READINESS_SCRIPT,
                "--fixtures-dir",
                fixtures,
                "--commands-file",
                commands,
                "--now",
                "2026-07-05T00:00:00.000Z",
                "--json",
            )

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["eligible"])
        self.assertEqual(payload["startedAt"], "")


if __name__ == "__main__":
    unittest.main()
