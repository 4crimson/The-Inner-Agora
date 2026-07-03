import json
import os
import subprocess
import tempfile
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

    def test_guard_reports_invalid_telegram_command_boundary_config(self):
        config = {
            "telegram": {
                "enabled": True,
                "command_boundary": {
                    "enabled": True,
                    "commands": {
                        "support": ["/support"],
                        "missing": ["/missing"],
                    },
                    "menus": {
                        "support": {
                            "text": "Support menu",
                            "buttons": [{"label": "Broken", "callback": "not_configured"}],
                        }
                    },
                },
                "callbacks": {},
            }
        }
        with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8") as handle:
            json.dump(config, handle)
            handle.flush()
            result = subprocess.run(
                ["node", str(GUARD), "--json", "--cockpit-only"],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
                timeout=15,
                env={
                    **os.environ,
                    "INNER_AGORA_COCKPIT_CONFIG_PATH": handle.name,
                },
            )

        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        data = json.loads(result.stdout)
        self.assertFalse(data["cockpit"]["ok"])
        messages = [event["message"] for event in data["events"]]
        self.assertIn("Paperclip cockpit Telegram command boundary config is invalid", messages)


if __name__ == "__main__":
    unittest.main()
