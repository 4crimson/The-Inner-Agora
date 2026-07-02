import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REGRESSION_SCRIPT = ROOT / "scripts" / "regression.mjs"
SOAK_SCRIPT = ROOT / "scripts" / "phase1-soak-check.mjs"


class Phase1SoakGateTests(unittest.TestCase):
    def run_node(self, *args):
        return subprocess.run(
            ["node", *map(str, args)],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def write_json(self, path, payload):
        path.write_text(json.dumps(payload), encoding="utf-8")

    def test_soak_check_reports_week_gate_and_both_regression_modes(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            fixtures = base / "fixtures"
            commands = base / "commands.json"
            self.write_json(commands, [{"name": "stable", "args": ["node", "-e", "console.log('stable')"]}])

            record = self.run_node(REGRESSION_SCRIPT, "record", "--fixtures-dir", fixtures, "--commands-file", commands)
            self.assertEqual(record.returncode, 0, record.stdout + record.stderr)

            result = self.run_node(
                SOAK_SCRIPT,
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
        self.assertFalse(payload["eligible"])
        self.assertEqual(payload["startedAt"], "2026-07-02T00:00:00.000Z")
        self.assertEqual(payload["eligibleAt"], "2026-07-09T00:00:00.000Z")
        self.assertEqual(payload["checks"]["migration"]["status"], 0)
        self.assertEqual(payload["checks"]["regressionLegacy"]["status"], 0)
        self.assertEqual(payload["checks"]["regressionChambers"]["status"], 0)
        self.assertEqual(payload["checks"]["regressionChambers"]["env"]["CHAMBER_MODE"], "chambers")


if __name__ == "__main__":
    unittest.main()
