import json
import os
import threading
import subprocess
import tempfile
import textwrap
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "paperclip-qa-tool" / "bin" / "paperclip-qa.mjs"


class FakePaperclipHandler(BaseHTTPRequestHandler):
    routes = {}
    calls = []
    issues_responses = []

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

    def do_GET(self):
        self.__class__.calls.append(("GET", self.path, None))
        if self.path == "/api/companies":
            self.send_json(200, [{"id": "company-1", "name": "Example", "status": "active"}])
            return
        if self.path == "/api/companies/company-1/issues":
            if self.__class__.issues_responses:
                self.send_json(200, self.__class__.issues_responses.pop(0))
            else:
                self.send_json(200, [])
            return
        status, body = self.__class__.routes.get(("GET", self.path), (404, {"error": "not found"}))
        self.send_json(status, body)

    def do_PATCH(self):
        body = self.read_body()
        self.__class__.calls.append(("PATCH", self.path, body))
        status, response = self.__class__.routes.get(("PATCH", self.path), (200, {"ok": True}))
        self.send_json(status, response)


class FakePaperclipServer:
    def __init__(self, routes=None, issues_responses=None):
        self.routes = routes or {}
        self.issues_responses = issues_responses or []
        self.server = None
        self.thread = None

    def __enter__(self):
        FakePaperclipHandler.routes = self.routes
        FakePaperclipHandler.calls = []
        FakePaperclipHandler.issues_responses = list(self.issues_responses)
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

    def test_health_checks_config_telegram_env_and_paperclip_company(self):
        with tempfile.TemporaryDirectory() as temp_dir, FakePaperclipServer() as server:
            calls_path = Path(temp_dir) / "telegram-calls.jsonl"
            fake_driver = self.write_fake_telegram_driver(temp_dir)
            config = self.base_config()
            config["paperclip"]["apiBase"] = server.api_base
            config["paperclip"]["company"] = "Example"
            config_path = self.write_config(temp_dir, config)

            result = self.run_cli(
                "health",
                "--config",
                config_path,
                "--json",
                env={
                    "PAPERCLIP_QA_TELEGRAM_DRIVER": str(fake_driver),
                    "FAKE_TELEGRAM_CALLS": str(calls_path),
                    "TELEGRAM_API_ID": "12345",
                    "TELEGRAM_API_HASH": "abcdef0123456789",
                },
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            payload = json.loads(result.stdout)
            self.assertTrue(payload["ok"])
            self.assertEqual(
                [check["name"] for check in payload["checks"]],
                ["config", "telegram-userbot", "paperclip-company"],
            )
            self.assertTrue(all(check["ok"] for check in payload["checks"]))
            calls = [json.loads(line) for line in calls_path.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(calls, [["check-env"]])

    def test_real_project_config_is_valid(self):
        result = self.run_cli("config-check", "--config", ROOT / "telegram-testing.config.json", "--json")

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["config"]["telegram"]["target"], "@crimson_philosophs_bot")
        self.assertEqual(payload["config"]["paperclip"]["company"], "The Inner Agora")
        self.assertEqual(
            [suite["name"] for suite in payload["suites"]],
            ["health", "help", "natural-dialogue", "council-create", "cleanup"],
        )

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

    def write_cleanup_manifest(self, artifacts_dir, run_id, *, telegram_messages=None, issues=None):
        run_dir = Path(artifacts_dir) / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = run_dir / "manifest.json"
        manifest = {
            "runId": run_id,
            "suite": "cleanup",
            "startedAt": "2026-07-03T00:00:00.000Z",
            "finishedAt": None,
            "telegram": {
                "target": "@example_bot",
                "userId": None,
                "chatId": None,
                "messages": telegram_messages or [],
            },
            "paperclip": {
                "apiBase": "http://127.0.0.1:3100/api",
                "company": "Example",
                "companyId": "company-1",
                "roots": [],
                "issues": issues or [],
            },
            "tests": [],
            "bugs": [],
            "cleanup": {"mode": "hard", "attemptedAt": None, "telegram": [], "paperclip": [], "residuals": []},
        }
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        return manifest_path

    def write_fake_telegram_driver(self, temp_dir, *, ok=True):
        script = Path(temp_dir) / "fake-telegram-driver.py"
        script.write_text(
            textwrap.dedent(
                f"""
                import json
                import os
                import pathlib
                import sys

                calls_path = pathlib.Path(os.environ["FAKE_TELEGRAM_CALLS"])
                calls_path.parent.mkdir(parents=True, exist_ok=True)
                with calls_path.open("a", encoding="utf-8") as handle:
                    handle.write(json.dumps(sys.argv[1:]))
                    handle.write("\\n")
                print(json.dumps({{"ok": {str(ok)}, "args": sys.argv[1:]}}))
                raise SystemExit(0 if {str(ok)} else 1)
                """
            ),
            encoding="utf-8",
        )
        return script

    def write_fake_send_driver(self, temp_dir):
        script = Path(temp_dir) / "fake-telegram-send-driver.py"
        script.write_text(
            textwrap.dedent(
                """
                import json
                import os
                import pathlib
                import sys

                calls_path = pathlib.Path(os.environ["FAKE_TELEGRAM_CALLS"])
                calls_path.parent.mkdir(parents=True, exist_ok=True)
                with calls_path.open("a", encoding="utf-8") as handle:
                    handle.write(json.dumps(sys.argv[1:], ensure_ascii=False))
                    handle.write("\\n")
                if sys.argv[1] == "send":
                    print(json.dumps({
                        "ok": True,
                        "target": os.environ.get("TELEGRAM_TEST_TARGET"),
                        "sent_id": 101,
                        "messages": [
                            {"id": 101, "out": True, "text": sys.argv[2]},
                            {"id": 102, "out": False, "text": "Готово, Синтез", "buttons": [{"text": "Синтез"}]}
                        ]
                    }, ensure_ascii=False))
                else:
                    print(json.dumps({"ok": True, "args": sys.argv[1:]}, ensure_ascii=False))
                """
            ),
            encoding="utf-8",
        )
        return script

    def write_report_manifest(self, artifacts_dir, run_id):
        run_dir = Path(artifacts_dir) / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = run_dir / "manifest.json"
        fake_token = "1234567890:" + ("A" * 24)
        manifest = {
            "runId": run_id,
            "suite": "reporting",
            "startedAt": "2026-07-03T00:00:00.000Z",
            "finishedAt": "2026-07-03T00:01:00.000Z",
            "telegram": {
                "target": "@example_bot",
                "userId": None,
                "chatId": None,
                "messages": [
                    {
                        "id": 10,
                        "text": f"token {fake_token} should be redacted",
                    }
                ],
            },
            "paperclip": {
                "apiBase": "http://127.0.0.1:3100/api",
                "company": "Example",
                "companyId": "company-1",
                "roots": [],
                "issues": [],
            },
            "tests": [
                {
                    "id": "help.ok",
                    "message": "агора помощь",
                    "status": "pass",
                    "checks": [{"name": "replyContains", "ok": True}],
                },
                {
                    "id": "help.raw-token",
                    "message": "агора помощь",
                    "status": "fail",
                    "observed": {"replyText": "<|channel> Project action exited"},
                    "checks": [{"name": "noRawTokens", "ok": False, "actual": "<|channel> Project action exited"}],
                },
            ],
            "bugs": [],
            "cleanup": {
                "mode": "hard",
                "attemptedAt": "2026-07-03T00:02:00.000Z",
                "telegram": [],
                "paperclip": [],
                "residuals": [{"kind": "paperclip", "id": "THE-1", "reason": "delete failed"}],
            },
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

    def test_cleanup_deletes_manifest_telegram_messages_with_fake_userbot(self):
        with tempfile.TemporaryDirectory() as temp_dir, FakePaperclipServer() as server:
            artifacts_dir = Path(temp_dir) / "runs"
            calls_path = Path(temp_dir) / "telegram-calls.jsonl"
            fake_driver = self.write_fake_telegram_driver(temp_dir)
            config = self.config_with_artifacts(artifacts_dir)
            config["paperclip"]["apiBase"] = server.api_base
            config_path = self.write_config(temp_dir, config)
            run_id = "QA-20260703-cleanup-telegram-a1b2c3"
            self.write_cleanup_manifest(
                artifacts_dir,
                run_id,
                telegram_messages=[
                    {"messageId": 10, "direction": "out"},
                    {"id": 11, "direction": "in"},
                    {"messageId": 10, "direction": "duplicate"},
                ],
            )

            result = self.run_cli(
                "cleanup",
                "--config",
                config_path,
                "--run",
                run_id,
                "--mode",
                "hard",
                "--json",
                env={
                    "PAPERCLIP_QA_TELEGRAM_DRIVER": str(fake_driver),
                    "FAKE_TELEGRAM_CALLS": str(calls_path),
                },
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            payload = json.loads(result.stdout)
            self.assertTrue(payload["ok"])
            calls = [json.loads(line) for line in calls_path.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(calls, [["delete", "--ids", "10,11"]])
            manifest = json.loads((artifacts_dir / run_id / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["cleanup"]["telegram"][0]["messageIds"], [10, 11])
            self.assertTrue(manifest["cleanup"]["telegram"][0]["ok"])

    def test_cleanup_dry_run_records_telegram_delete_without_calling_userbot(self):
        with tempfile.TemporaryDirectory() as temp_dir, FakePaperclipServer() as server:
            artifacts_dir = Path(temp_dir) / "runs"
            calls_path = Path(temp_dir) / "telegram-calls.jsonl"
            fake_driver = self.write_fake_telegram_driver(temp_dir)
            config = self.config_with_artifacts(artifacts_dir)
            config["paperclip"]["apiBase"] = server.api_base
            config_path = self.write_config(temp_dir, config)
            run_id = "QA-20260703-cleanup-telegram-dry-d4e5f6"
            self.write_cleanup_manifest(artifacts_dir, run_id, telegram_messages=[{"messageId": 20}, {"messageId": 21}])

            result = self.run_cli(
                "cleanup",
                "--config",
                config_path,
                "--run",
                run_id,
                "--mode",
                "hard",
                "--dry-run",
                "--json",
                env={
                    "PAPERCLIP_QA_TELEGRAM_DRIVER": str(fake_driver),
                    "FAKE_TELEGRAM_CALLS": str(calls_path),
                },
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(calls_path.exists())
            manifest = json.loads((artifacts_dir / run_id / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["cleanup"]["telegram"][0]["messageIds"], [20, 21])
            self.assertTrue(manifest["cleanup"]["telegram"][0]["dryRun"])

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

    def run_node_eval(self, expression):
        script = f"""
import {{ evaluateTest }} from './paperclip-qa-tool/src/evaluator.mjs';
const result = evaluateTest({expression});
console.log(JSON.stringify(result));
"""
        return subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_evaluator_checks_generic_expectations(self):
        expression = json.dumps(
            {
                "test": {
                    "id": "eval.generic",
                    "expect": {
                        "replyContains": ["Готово", "локальная модель"],
                        "replyNotContains": "<|channel>",
                        "paperclipRootsCreated": 1,
                        "paperclipRootsCreatedAtLeast": 1,
                        "noRawTokens": True,
                        "localRouteContains": "local",
                        "buttonsPresent": True,
                    },
                },
                "observed": {
                    "replyText": "Готово через локальная модель",
                    "paperclipRootsCreated": 1,
                    "localRoute": "provider=local",
                    "buttons": [{"text": "Синтез"}],
                },
            },
            ensure_ascii=False,
        )

        result = self.run_node_eval(expression)

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["status"], "pass")
        self.assertEqual(len(payload["checks"]), 7)

    def test_evaluator_reports_failed_expectations(self):
        expression = json.dumps(
            {
                "test": {
                    "id": "eval.fail",
                    "expect": {
                        "replyContains": "Синтез готов",
                        "replyNotContains": "Project action exited",
                        "noRawTokens": True,
                        "buttonsPresent": True,
                    },
                },
                "observed": {
                    "replyText": "Project action exited with 1. <|channel>",
                    "buttons": [],
                },
            },
            ensure_ascii=False,
        )

        result = self.run_node_eval(expression)

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["status"], "fail")
        failed = [check["name"] for check in payload["checks"] if not check["ok"]]
        self.assertEqual(failed, ["replyContains", "replyNotContains", "noRawTokens", "buttonsPresent"])

    def test_run_dry_run_creates_manifest_without_live_side_effects(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            artifacts_dir = Path(temp_dir) / "runs"
            config_path = self.write_config(temp_dir, self.config_with_artifacts(artifacts_dir))

            result = self.run_cli("run", "--config", config_path, "--suite", "help", "--dry-run", "--json")

            self.assertEqual(result.returncode, 0, result.stderr)
            payload = json.loads(result.stdout)
            self.assertTrue(payload["ok"])
            self.assertTrue(payload["dryRun"])
            self.assertEqual(payload["plannedTests"], ["help.basic"])
            manifest_path = Path(payload["manifestPath"])
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["suite"], "help")
            self.assertEqual(manifest["tests"][0]["status"], "planned")
            self.assertTrue(manifest["tests"][0]["dryRun"])
            self.assertEqual(manifest["cleanup"]["mode"], "hard")

    def test_run_executes_suite_with_fake_telegram_and_paperclip(self):
        before_issues = [
            {"id": "old-root", "identifier": "THE-1", "parentId": None, "title": "Old", "status": "todo"}
        ]
        after_issues = [
            *before_issues,
            {"id": "new-root", "identifier": "THE-2", "parentId": None, "title": "New", "status": "todo"},
        ]
        with tempfile.TemporaryDirectory() as temp_dir, FakePaperclipServer(issues_responses=[before_issues, after_issues]) as server:
            artifacts_dir = Path(temp_dir) / "runs"
            calls_path = Path(temp_dir) / "telegram-calls.jsonl"
            fake_driver = self.write_fake_send_driver(temp_dir)
            config = self.config_with_artifacts(artifacts_dir)
            config["paperclip"]["apiBase"] = server.api_base
            config["paperclip"]["company"] = "Example"
            config["suites"] = {
                "liveish": {
                    "tests": [
                        {
                            "id": "liveish.basic",
                            "message": "агора помощь",
                            "expect": {
                                "replyContains": "Готово",
                                "paperclipRootsCreated": 1,
                                "buttonsPresent": True,
                                "noRawTokens": True,
                            },
                        }
                    ]
                }
            }
            config_path = self.write_config(temp_dir, config)

            result = self.run_cli(
                "run",
                "--config",
                config_path,
                "--suite",
                "liveish",
                "--live-ok",
                "--json",
                env={
                    "PAPERCLIP_QA_TELEGRAM_DRIVER": str(fake_driver),
                    "FAKE_TELEGRAM_CALLS": str(calls_path),
                    "TELEGRAM_API_ID": "12345",
                    "TELEGRAM_API_HASH": "abcdef0123456789",
                },
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            payload = json.loads(result.stdout)
            self.assertTrue(payload["ok"])
            self.assertFalse(payload["dryRun"])
            self.assertEqual(payload["tests"], [{"id": "liveish.basic", "status": "pass"}])
            calls = [json.loads(line) for line in calls_path.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(calls[0][:2], ["send", "агора помощь"])
            manifest = json.loads(Path(payload["manifestPath"]).read_text(encoding="utf-8"))
            self.assertEqual(manifest["paperclip"]["companyId"], "company-1")
            self.assertEqual([issue["id"] for issue in manifest["paperclip"]["issues"]], ["new-root"])
            self.assertEqual([message["messageId"] for message in manifest["telegram"]["messages"]], [101, 102])
            self.assertEqual(manifest["tests"][0]["status"], "pass")

    def test_run_without_live_ok_fails_before_telegram_side_effects(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            artifacts_dir = Path(temp_dir) / "runs"
            calls_path = Path(temp_dir) / "telegram-calls.jsonl"
            fake_driver = self.write_fake_send_driver(temp_dir)
            config = self.config_with_artifacts(artifacts_dir)
            config_path = self.write_config(temp_dir, config)

            result = self.run_cli(
                "run",
                "--config",
                config_path,
                "--suite",
                "help",
                "--json",
                env={
                    "PAPERCLIP_QA_TELEGRAM_DRIVER": str(fake_driver),
                    "FAKE_TELEGRAM_CALLS": str(calls_path),
                    "TELEGRAM_API_ID": "12345",
                    "TELEGRAM_API_HASH": "abcdef0123456789",
                },
            )

            self.assertNotEqual(result.returncode, 0)
            payload = json.loads(result.stdout)
            self.assertFalse(payload["ok"])
            self.assertIn("--live-ok is required for non-dry-run suite execution", payload["errors"])
            self.assertFalse(calls_path.exists())

    def test_report_writes_summary_failures_cleanup_and_redacts_secrets(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            artifacts_dir = Path(temp_dir) / "runs"
            config_path = self.write_config(temp_dir, self.config_with_artifacts(artifacts_dir))
            run_id = "QA-20260703-report-a1b2c3"
            self.write_report_manifest(artifacts_dir, run_id)

            result = self.run_cli("report", "--config", config_path, "--run", run_id, "--json")

            self.assertEqual(result.returncode, 0, result.stderr)
            payload = json.loads(result.stdout)
            report_path = Path(payload["reportPath"])
            self.assertTrue(report_path.exists())
            report = report_path.read_text(encoding="utf-8")
            self.assertIn("Pass: 1", report)
            self.assertIn("Fail: 1", report)
            self.assertIn("help.raw-token", report)
            self.assertIn("delete failed", report)
            self.assertNotIn("1234567890:" + ("A" * 24), report)

    def test_bugs_writes_jsonl_and_append_doc_dry_run_preview(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            artifacts_dir = Path(temp_dir) / "runs"
            config_path = self.write_config(temp_dir, self.config_with_artifacts(artifacts_dir))
            run_id = "QA-20260703-bugs-d4e5f6"
            self.write_report_manifest(artifacts_dir, run_id)
            append_doc = Path(temp_dir) / "BUGS.md"

            result = self.run_cli(
                "bugs",
                "--config",
                config_path,
                "--run",
                run_id,
                "--append-doc",
                append_doc,
                "--dry-run",
                "--json",
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            payload = json.loads(result.stdout)
            bugs_path = Path(payload["bugsPath"])
            rows = [json.loads(line) for line in bugs_path.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["testId"], "help.raw-token")
            self.assertIn("preview", payload["appendDoc"])
            self.assertIn("help.raw-token", payload["appendDoc"]["preview"])
            self.assertFalse(append_doc.exists())

    def write_retest_manifest(self, artifacts_dir, run_id):
        run_dir = Path(artifacts_dir) / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = run_dir / "manifest.json"
        manifest = {
            "runId": run_id,
            "suite": "help",
            "startedAt": "2026-07-03T00:00:00.000Z",
            "finishedAt": "2026-07-03T00:01:00.000Z",
            "telegram": {"target": "@example_bot", "userId": None, "chatId": None, "messages": []},
            "paperclip": {"apiBase": "http://127.0.0.1:3100/api", "company": "Example", "companyId": "company-1", "roots": [], "issues": []},
            "tests": [
                {"id": "help.ok", "message": "агора помощь", "status": "pass"},
                {"id": "help.raw-token", "message": "агора помощь", "status": "fail"},
            ],
            "bugs": [
                {
                    "id": "TQA-001",
                    "area": "telegram-ui",
                    "testId": "help.raw-token",
                    "title": "Raw provider token leaks into Telegram",
                    "evidence": "reply contained <|channel>",
                    "acceptanceCriteria": ["help.raw-token passes"],
                },
                {
                    "id": "TQA-002",
                    "area": "cleanup",
                    "testId": "cleanup.paperclip",
                    "title": "Paperclip hard delete leaves residual",
                    "evidence": "delete returned 500",
                    "acceptanceCriteria": ["cleanup reports no residuals"],
                },
            ],
            "cleanup": {"mode": "hard", "attemptedAt": None, "telegram": [], "paperclip": [], "residuals": []},
        }
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        return manifest_path

    def test_retest_dry_run_selects_previous_failed_tests_only(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            artifacts_dir = Path(temp_dir) / "runs"
            config_path = self.write_config(temp_dir, self.config_with_artifacts(artifacts_dir))
            old_run_id = "QA-20260703-old-a1b2c3"
            self.write_retest_manifest(artifacts_dir, old_run_id)

            result = self.run_cli("retest", "--config", config_path, "--run", old_run_id, "--dry-run", "--json")

            self.assertEqual(result.returncode, 0, result.stderr)
            payload = json.loads(result.stdout)
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["previousRunId"], old_run_id)
            self.assertEqual(payload["selectedTests"], ["help.raw-token"])
            manifest = json.loads(Path(payload["manifestPath"]).read_text(encoding="utf-8"))
            self.assertEqual(manifest["previousRunId"], old_run_id)
            self.assertEqual([test["id"] for test in manifest["tests"]], ["help.raw-token"])
            self.assertEqual(manifest["tests"][0]["status"], "planned")

    def test_bug_batch_filters_manifest_bugs_by_area(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            artifacts_dir = Path(temp_dir) / "runs"
            config_path = self.write_config(temp_dir, self.config_with_artifacts(artifacts_dir))
            run_id = "QA-20260703-batch-d4e5f6"
            self.write_retest_manifest(artifacts_dir, run_id)

            result = self.run_cli("bug-batch", "--config", config_path, "--run", run_id, "--area", "telegram-ui", "--json")

            self.assertEqual(result.returncode, 0, result.stderr)
            payload = json.loads(result.stdout)
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["area"], "telegram-ui")
            self.assertEqual([bug["id"] for bug in payload["bugs"]], ["TQA-001"])
            self.assertIn("help.raw-token passes", payload["bugs"][0]["acceptanceCriteria"])


if __name__ == "__main__":
    unittest.main()
