import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GUARD = ROOT / "scripts" / "inner-agora-guard.mjs"


class InnerAgoraGuardTests(unittest.TestCase):
    def test_guard_can_report_chamber_loader_health_without_network_checks(self):
        result = subprocess.run(
            ["node", str(GUARD), "--json", "--chambers-only"],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
            timeout=15,
        )

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        data = json.loads(result.stdout)
        self.assertTrue(data["chambers"]["ok"])
        self.assertEqual(data["chambers"]["active"], "philosophy")
        self.assertIn("philosophy", data["chambers"]["ids"])
        self.assertIn("board-directors", data["chambers"]["ids"])


if __name__ == "__main__":
    unittest.main()
