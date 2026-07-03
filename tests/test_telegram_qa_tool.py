import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "paperclip-qa-tool" / "bin" / "paperclip-qa.mjs"


class TelegramQaToolConfigTests(unittest.TestCase):
    def write_config(self, temp_dir, body):
        path = Path(temp_dir) / "telegram-testing.config.json"
        path.write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")
        return path

    def base_config(self):
        return {
            "name": "inner-agora-telegram-qa",
            "telegram": {
                "target": "@crimson_philosophs_bot",
                "userbot": {"session": ".telegram-userbot"},
            },
            "paperclip": {
                "apiBase": "http://127.0.0.1:3100/api",
                "company": "The Inner Agora",
                "cleanup": "hard",
            },
            "artifacts": {"dir": "artifacts/telegram-test-runs"},
            "suites": {
                "help": {
                    "tests": [
                        {
                            "id": "help.basic",
                            "message": "агора помощь",
                            "expect": {"paperclipRootsCreated": 0},
                        }
                    ]
                }
            },
        }

    def config_with_artifacts(self, artifacts_dir):
        config = self.base_config()
        config["artifacts"] = {"dir": str(artifacts_dir)}
        return config

    def run_cli(self, *args):
        return subprocess.run(
            ["node", str(CLI), *map(str, args)],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_valid_config_check_returns_normalized_summary(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = self.write_config(temp_dir, self.base_config())

            result = self.run_cli("config-check", "--config", config_path, "--json")

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["config"]["name"], "inner-agora-telegram-qa")
        self.assertEqual(payload["config"]["telegram"]["target"], "@crimson_philosophs_bot")
        self.assertEqual(payload["config"]["paperclip"]["company"], "The Inner Agora")
        self.assertEqual(payload["suites"], [{"name": "help", "tests": 1}])

    def test_missing_telegram_target_fails_validation(self):
        config = self.base_config()
        del config["telegram"]["target"]
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = self.write_config(temp_dir, config)

            result = self.run_cli("config-check", "--config", config_path, "--json")

        self.assertNotEqual(result.returncode, 0)
        payload = json.loads(result.stdout)
        self.assertFalse(payload["ok"])
        self.assertIn("telegram.target", payload["errors"])

    def test_missing_paperclip_company_fails_validation(self):
        config = self.base_config()
        del config["paperclip"]["company"]
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = self.write_config(temp_dir, config)

            result = self.run_cli("config-check", "--config", config_path, "--json")

        self.assertNotEqual(result.returncode, 0)
        payload = json.loads(result.stdout)
        self.assertFalse(payload["ok"])
        self.assertIn("paperclip.company", payload["errors"])

    def test_duplicate_test_ids_fail_validation(self):
        config = self.base_config()
        config["suites"]["dialogue"] = {
            "tests": [
                {
                    "id": "help.basic",
                    "message": "помощь агора",
                    "expect": {"paperclipRootsCreated": 0},
                }
            ]
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = self.write_config(temp_dir, config)

            result = self.run_cli("config-check", "--config", config_path, "--json")

        self.assertNotEqual(result.returncode, 0)
        payload = json.loads(result.stdout)
        self.assertFalse(payload["ok"])
        self.assertIn("duplicate test id: help.basic", payload["errors"])

    def test_suite_references_are_resolved_from_tool_suites(self):
        config = self.base_config()
        config["suites"] = {
            "health": {"extends": "generic-health"},
            "help": {
                "extends": "generic-telegram-help",
                "tests": [
                    {
                        "id": "help.project",
                        "message": "агора помощь",
                        "expect": {"paperclipRootsCreated": 0},
                    }
                ],
            },
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = self.write_config(temp_dir, config)

            result = self.run_cli("config-check", "--config", config_path, "--json")

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(
            payload["suites"],
            [
                {"name": "health", "tests": 1},
                {"name": "help", "tests": 3},
            ],
        )

    def test_run_start_creates_manifest_and_manifest_show_reads_it(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            artifacts_dir = Path(temp_dir) / "runs"
            config_path = self.write_config(temp_dir, self.config_with_artifacts(artifacts_dir))

            start = self.run_cli("run-start", "--config", config_path, "--suite", "help", "--json")

            self.assertEqual(start.returncode, 0, start.stderr)
            start_payload = json.loads(start.stdout)
            self.assertTrue(start_payload["ok"])
            run_id = start_payload["runId"]
            self.assertTrue(run_id.startswith("QA-"))
            manifest_path = Path(start_payload["manifestPath"])
            self.assertTrue(manifest_path.exists())
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["runId"], run_id)
            self.assertEqual(manifest["suite"], "help")
            self.assertEqual(manifest["telegram"]["target"], "@crimson_philosophs_bot")
            self.assertEqual(manifest["paperclip"]["company"], "The Inner Agora")
            self.assertEqual(manifest["tests"], [])
            self.assertEqual(manifest["bugs"], [])

            shown = self.run_cli("manifest-show", "--config", config_path, "--run", run_id, "--json")

            self.assertEqual(shown.returncode, 0, shown.stderr)
            shown_payload = json.loads(shown.stdout)
            self.assertEqual(shown_payload["runId"], run_id)
            self.assertEqual(shown_payload["manifestPath"], str(manifest_path))

    def test_run_start_creates_distinct_run_directories(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            artifacts_dir = Path(temp_dir) / "runs"
            config_path = self.write_config(temp_dir, self.config_with_artifacts(artifacts_dir))

            first = json.loads(self.run_cli("run-start", "--config", config_path, "--suite", "help", "--json").stdout)
            second = json.loads(self.run_cli("run-start", "--config", config_path, "--suite", "help", "--json").stdout)

            self.assertNotEqual(first["runId"], second["runId"])
            self.assertTrue(Path(first["manifestPath"]).exists())
            self.assertTrue(Path(second["manifestPath"]).exists())


if __name__ == "__main__":
    unittest.main()
