import json
import os
import threading
import subprocess
import tempfile
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "paperclip-qa-tool" / "bin" / "paperclip-qa.mjs"


class FakePaperclipHandler(BaseHTTPRequestHandler):
    routes = {}
    calls = []

    def log_message(self, *_):
        return

    def send_json(self, status, body):
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def read_body(self):
        length = int(self.headers.get("content-length", "0"))
        if not length:
            return None
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_DELETE(self):
        self.__class__.calls.append(("DELETE", self.path, None))
        status, body = self.__class__.routes.get(("DELETE", self.path), (200, {"ok": True}))
        self.send_json(status, body)

    def do_PATCH(self):
        body = self.read_body()
        self.__class__.calls.append(("PATCH", self.path, body))
        status, response = self.__class__.routes.get(("PATCH", self.path), (200, {"ok": True}))
        self.send_json(status, response)


class FakePaperclipServer:
    def __init__(self, routes=None):
        self.routes = routes or {}
        self.server = None
        self.thread = None

    def __enter__(self):
        FakePaperclipHandler.routes = self.routes
        FakePaperclipHandler.calls = []
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), FakePaperclipHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    @property
    def api_base(self):
        return f"http://127.0.0.1:{self.server.server_address[1]}/api"

    @property
    def calls(self):
        return list(FakePaperclipHandler.calls)


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

    def run_cli(self, *args, env=None):
        clean_env = os.environ.copy()
        clean_env.update(env or {})
        return subprocess.run(
            ["node", str(CLI), *map(str, args)],
            cwd=ROOT,
            env=clean_env,
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

    def write_manifest(self, artifacts_dir, run_id, issues):
        run_dir = Path(artifacts_dir) / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = run_dir / "manifest.json"
        manifest = {
            "runId": run_id,
            "suite": "cleanup",
            "startedAt": "2026-07-03T00:00:00.000Z",
            "finishedAt": None,
            "telegram": {"target": "@example_bot", "userId": None, "chatId": None, "messages": []},
            "paperclip": {
                "apiBase": "http://127.0.0.1:3100/api",
                "company": "Example",
                "companyId": "company-1",
                "roots": [],
                "issues": issues,
            },
            "tests": [],
            "bugs": [],
            "cleanup": {"mode": "hard", "attemptedAt": None, "telegram": [], "paperclip": [], "residuals": []},
        }
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        return manifest_path

    def test_cleanup_hard_deletes_manifest_issues_children_before_parent(self):
        with tempfile.TemporaryDirectory() as temp_dir, FakePaperclipServer() as server:
            artifacts_dir = Path(temp_dir) / "runs"
            config = self.config_with_artifacts(artifacts_dir)
            config["paperclip"]["apiBase"] = server.api_base
            config_path = self.write_config(temp_dir, config)
            run_id = "QA-20260703-cleanup-a1b2c3"
            self.write_manifest(
                artifacts_dir,
                run_id,
                [
                    {"id": "root-1", "identifier": "THE-1", "parentId": None, "status": "todo", "matchedBy": "manifest"},
                    {"id": "child-1", "identifier": "THE-2", "parentId": "root-1", "status": "todo", "matchedBy": "manifest"},
                ],
            )

            result = self.run_cli("cleanup", "--config", config_path, "--run", run_id, "--mode", "hard", "--json")

            self.assertEqual(result.returncode, 0, result.stderr)
            payload = json.loads(result.stdout)
            self.assertTrue(payload["ok"])
            delete_paths = [path for method, path, _ in server.calls if method == "DELETE"]
            self.assertEqual(delete_paths, ["/api/issues/child-1", "/api/issues/root-1"])
            manifest = json.loads((artifacts_dir / run_id / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual([item["method"] for item in manifest["cleanup"]["paperclip"]], ["DELETE", "DELETE"])

    def test_cleanup_hard_delete_failure_falls_back_to_hidden_cancelled_patch(self):
        routes = {
            ("DELETE", "/api/issues/root-1"): (500, {"error": "Internal server error"}),
            ("PATCH", "/api/issues/root-1"): (200, {"ok": True}),
        }
        with tempfile.TemporaryDirectory() as temp_dir, FakePaperclipServer(routes) as server:
            artifacts_dir = Path(temp_dir) / "runs"
            config = self.config_with_artifacts(artifacts_dir)
            config["paperclip"]["apiBase"] = server.api_base
            config_path = self.write_config(temp_dir, config)
            run_id = "QA-20260703-cleanup-d4e5f6"
            self.write_manifest(
                artifacts_dir,
                run_id,
                [{"id": "root-1", "identifier": "THE-1", "parentId": None, "status": "todo", "matchedBy": "manifest"}],
            )

            result = self.run_cli("cleanup", "--config", config_path, "--run", run_id, "--mode", "hard", "--json")

            self.assertEqual(result.returncode, 0, result.stderr)
            patch_calls = [call for call in server.calls if call[0] == "PATCH"]
            self.assertEqual(len(patch_calls), 1)
            self.assertEqual(patch_calls[0][1], "/api/issues/root-1")
            self.assertIn("hiddenAt", patch_calls[0][2])
            self.assertEqual(patch_calls[0][2]["status"], "cancelled")
            manifest = json.loads((artifacts_dir / run_id / "manifest.json").read_text(encoding="utf-8"))
            actions = [item["method"] for item in manifest["cleanup"]["paperclip"]]
            self.assertEqual(actions, ["DELETE", "PATCH"])

    def test_telegram_check_uses_configured_target_and_session(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = self.write_config(temp_dir, self.base_config())

            result = self.run_cli(
                "telegram-check",
                "--config",
                config_path,
                "--json",
                env={
                    "TELEGRAM_API_ID": "12345",
                    "TELEGRAM_API_HASH": "abcdef0123456789",
                },
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["userbot"]["config"]["target"], "@crimson_philosophs_bot")
        self.assertEqual(payload["userbot"]["config"]["session"], ".telegram-userbot")

    def test_telegram_history_dry_run_uses_userbot_driver_without_connecting(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = self.write_config(temp_dir, self.base_config())

            result = self.run_cli(
                "telegram-history",
                "--config",
                config_path,
                "--limit",
                "5",
                "--dry-run",
                "--json",
                env={
                    "TELEGRAM_API_ID": "12345",
                    "TELEGRAM_API_HASH": "abcdef0123456789",
                },
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["history"]["dry_run"])
        self.assertEqual(payload["history"]["target"], "@crimson_philosophs_bot")
        self.assertEqual(payload["history"]["limit"], 5)


if __name__ == "__main__":
    unittest.main()
