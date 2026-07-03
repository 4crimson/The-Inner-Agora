import json
import os
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DRIVER = ROOT / "scripts" / "telegram-userbot-driver.py"


class TelegramUserbotDriverTests(unittest.TestCase):
    def run_driver(self, *args, env=None):
        clean_env = {
            key: value
            for key, value in os.environ.items()
            if not key.startswith("TELEGRAM_API_")
            and key not in {"TELEGRAM_USER_PHONE", "TELEGRAM_TEST_TARGET", "TELEGRAM_USERBOT_SESSION"}
        }
        clean_env.update(env or {})
        return subprocess.run(
            ["python3", str(DRIVER), *map(str, args)],
            cwd=ROOT,
            env=clean_env,
            text=True,
            capture_output=True,
        )

    def test_check_env_reports_missing_values_without_telethon(self):
        result = self.run_driver("check-env")

        self.assertEqual(result.returncode, 1)
        payload = json.loads(result.stdout)
        self.assertFalse(payload["ok"])
        self.assertIn("TELEGRAM_API_ID", payload["missing"])
        self.assertIn("TELEGRAM_API_HASH", payload["missing"])

    def test_check_env_redacts_sensitive_values(self):
        result = self.run_driver(
            "check-env",
            env={
                "TELEGRAM_API_ID": "12345",
                "TELEGRAM_API_HASH": "abcdef0123456789",
                "TELEGRAM_TEST_TARGET": "@example_bot",
                "TELEGRAM_USERBOT_SESSION": ".telegram-userbot-test",
            },
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["config"]["api_id"], "12345")
        self.assertEqual(payload["config"]["api_hash"], "abcd************")

    def test_send_dry_run_does_not_import_telethon_or_connect(self):
        result = self.run_driver(
            "send",
            "агора помощь",
            "--dry-run",
            env={
                "TELEGRAM_API_ID": "12345",
                "TELEGRAM_API_HASH": "abcdef0123456789",
                "TELEGRAM_TEST_TARGET": "@example_bot",
                "TELEGRAM_USERBOT_SESSION": ".telegram-userbot-test",
            },
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["dry_run"])
        self.assertEqual(payload["target"], "@example_bot")
        self.assertEqual(payload["text"], "агора помощь")

    def test_history_dry_run_does_not_import_telethon_or_connect(self):
        result = self.run_driver(
            "history",
            "--limit",
            "7",
            "--dry-run",
            env={
                "TELEGRAM_API_ID": "12345",
                "TELEGRAM_API_HASH": "abcdef0123456789",
                "TELEGRAM_TEST_TARGET": "@example_bot",
                "TELEGRAM_USERBOT_SESSION": ".telegram-userbot-test",
            },
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["dry_run"])
        self.assertEqual(payload["target"], "@example_bot")
        self.assertEqual(payload["limit"], 7)

    def test_delete_dry_run_parses_message_ids_without_connecting(self):
        result = self.run_driver(
            "delete",
            "--ids",
            "10,11,12",
            "--dry-run",
            env={
                "TELEGRAM_API_ID": "12345",
                "TELEGRAM_API_HASH": "abcdef0123456789",
                "TELEGRAM_TEST_TARGET": "@example_bot",
                "TELEGRAM_USERBOT_SESSION": ".telegram-userbot-test",
            },
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["dry_run"])
        self.assertEqual(payload["target"], "@example_bot")
        self.assertEqual(payload["message_ids"], [10, 11, 12])


if __name__ == "__main__":
    unittest.main()
