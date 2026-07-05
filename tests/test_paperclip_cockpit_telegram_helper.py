import json
import os
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TELEGRAM_HELPER = ROOT / "scripts" / "paperclip-cockpit-telegram.mjs"
AGORA_CONFIG = ROOT / "paperclip-cockpit.json"


class JsonHandler(BaseHTTPRequestHandler):
    routes = {}
    calls = []
    protocol_version = "HTTP/1.1"

    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.send_header("connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.close_connection = True
        payload = self.routes.get(self.path)
        if payload is None:
            self.send_json(404, {"error": "not found"})
            return
        self.send_json(200, payload)

    def do_PATCH(self):
        self.close_connection = True
        length = int(self.headers.get("content-length") or "0")
        raw_body = self.rfile.read(length).decode("utf-8") if length else "{}"
        body = json.loads(raw_body or "{}")
        self.__class__.calls.append(("PATCH", self.path, body))
        status, payload = self.routes.get(("PATCH", self.path), (200, {"ok": True}))
        self.send_json(status, payload)

    def do_POST(self):
        self.close_connection = True
        length = int(self.headers.get("content-length") or "0")
        raw_body = self.rfile.read(length).decode("utf-8") if length else "{}"
        body = json.loads(raw_body or "{}")
        self.__class__.calls.append(("POST", self.path, body))
        status, payload = self.routes.get(("POST", self.path), (200, {"ok": True}))
        self.send_json(status, payload)

    def log_message(self, *_):
        return


class TestHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False


class PaperclipCockpitTelegramHelperTests(unittest.TestCase):
    def run_helper(self, config, routes, args):
        payload, _ = self.run_helper_with_calls(config, routes, args)
        return payload

    def run_helper_with_calls(self, config, routes, args):
        handler = type("Handler", (JsonHandler,), {"routes": routes, "calls": []})
        server = TestHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                config = {**config, "cwd": temp_dir}
                config_path = Path(temp_dir) / "paperclip-cockpit.json"
                config_path.write_text(json.dumps(config), encoding="utf-8")
                env = {
                    **os.environ,
                    "PAPERCLIP_COCKPIT_CONFIG": str(config_path),
                    "PAPERCLIP_API_BASE": f"http://127.0.0.1:{server.server_port}/api",
                }
                result = subprocess.run(
                    ["node", str(TELEGRAM_HELPER), *args],
                    cwd=ROOT,
                    env=env,
                    text=True,
                    capture_output=True,
                    check=True,
                )
                return json.loads(result.stdout), list(handler.calls)
        finally:
            server.shutdown()
            server.server_close()

    def write_qa_artifact(self, root, run_id="QA-test-run", *, tests=None, bugs=None, cleanup=None):
        run_dir = Path(root) / run_id
        run_dir.mkdir(parents=True)
        manifest = {
            "runId": run_id,
            "suite": "service-commands",
            "startedAt": "2026-07-04T10:00:00.000Z",
            "finishedAt": "2026-07-04T10:01:00.000Z",
            "tests": tests
            if tests is not None
            else [
                {"id": "service.help", "status": "passed"},
                {"id": "service.agora", "status": "failed", "error": "raw Hermes UI"},
            ],
            "bugs": bugs if bugs is not None else [{"id": "BUG-1", "title": "raw Hermes UI still visible"}],
            "cleanup": cleanup if cleanup is not None else {"mode": "hard", "residuals": []},
        }
        (run_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        (run_dir / "REPORT.md").write_text(
            "# QA Report\n\n## Summary\n\nTotal: 2\nPass: 1\nFail: 1\n\n## Failed Tests\n\n- service.agora\n",
            encoding="utf-8",
        )
        (run_dir / "bugs.jsonl").write_text(
            "\n".join(json.dumps(item, ensure_ascii=False) for item in manifest["bugs"]),
            encoding="utf-8",
        )
        return run_dir

    def test_keyboard_is_config_driven_without_agora_issue_prefix_or_labels(self):
        root = {
            "id": "root-1",
            "identifier": "WK-10",
            "issueNumber": 10,
            "companyId": "company-1",
            "title": "Research: pricing",
        }
        child_one = {
            "id": "child-1",
            "identifier": "WK-11",
            "issueNumber": 11,
            "companyId": "company-1",
            "parentId": "root-1",
            "title": "Analyst Alpha: pricing",
        }
        child_two = {
            "id": "child-2",
            "identifier": "WK-12",
            "issueNumber": 12,
            "companyId": "company-1",
            "parentId": "root-1",
            "title": "Analyst Beta / reviewer: pricing",
        }
        synthesis = {
            "id": "synthesis-1",
            "identifier": "WK-13",
            "issueNumber": 13,
            "companyId": "company-1",
            "parentId": "root-1",
            "title": "Executive summary: pricing",
        }
        config = {
            "command": {"name": "work"},
            "telegram": {
                "callback_prefix": "wk",
                "synthesis_title_pattern": "^Executive summary:",
                "buttons": {
                    "voice_limit": 2,
                    "quick_actions": [
                        {"label": "Disagreements", "callback": "disagreements"},
                        {"label": "Deeper", "callback": "deepen"},
                    ],
                    "labels": {
                        "synthesis": "Brief",
                        "all_voices": "Inputs",
                        "export": "Archive",
                        "clarify": "Follow up",
                    },
                },
            },
            "actions": {
                "memory": {"exec": ["echo", "archive"]},
            },
        }

        keyboard = self.run_helper(
            config,
            {
                "/api/issues/WK-10": root,
                "/api/companies/company-1/issues": [root, child_one, child_two, synthesis],
            },
            ["keyboard", "WK-10"],
        )

        rows = keyboard["inline_keyboard"]
        self.assertEqual(rows[0], [{"text": "Brief", "callback_data": "wk:result:WK-13"}])
        self.assertEqual(
            rows[1],
            [
                {"text": "Analyst Alpha", "callback_data": "wk:voice:WK-11"},
                {"text": "Analyst Beta", "callback_data": "wk:voice:WK-12"},
            ],
        )
        self.assertEqual(
            rows[2],
            [
                {"text": "Inputs", "callback_data": "wk:latest:WK-10"},
                {"text": "Archive", "callback_data": "wk:export:WK-10"},
                {"text": "Follow up", "callback_data": "wk:clarify:WK-10"},
            ],
        )
        self.assertEqual(
            rows[3],
            [
                {"text": "Disagreements", "callback_data": "wk:disagreements:WK-10"},
                {"text": "Deeper", "callback_data": "wk:deepen:WK-10"},
            ],
        )

    def test_real_agora_keyboard_uses_contract_labels_without_primary_export(self):
        root = {
            "id": "root-1",
            "identifier": "THE-100",
            "issueNumber": 100,
            "companyId": "company-1",
            "title": "Agora balanced: freedom",
        }
        child_one = {
            "id": "child-1",
            "identifier": "THE-101",
            "issueNumber": 101,
            "companyId": "company-1",
            "parentId": "root-1",
            "title": "Аристотель: freedom",
        }
        child_two = {
            "id": "child-2",
            "identifier": "THE-102",
            "issueNumber": 102,
            "companyId": "company-1",
            "parentId": "root-1",
            "title": "Фуко: freedom",
        }
        synthesis = {
            "id": "synthesis-1",
            "identifier": "THE-103",
            "issueNumber": 103,
            "companyId": "company-1",
            "parentId": "root-1",
            "title": "Синтез: freedom",
        }
        config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))

        keyboard = self.run_helper(
            config,
            {
                "/api/issues/THE-100": root,
                "/api/companies/company-1/issues": [root, child_one, child_two, synthesis],
            },
            ["keyboard", "THE-100"],
        )

        rows = keyboard["inline_keyboard"]
        flat_labels = [button["text"] for row in rows for button in row]
        self.assertEqual(rows[0], [{"text": "Полный итог", "callback_data": "pc:result:THE-103"}])
        self.assertIn({"text": "Философы", "callback_data": "pc:philosophers:THE-100"}, rows[-2])
        self.assertIn("Продолжить", flat_labels)
        self.assertIn("Новый вопрос", flat_labels)
        self.assertIn("Детали", flat_labels)
        for forbidden in ("Синтез", "Все голоса", "Экспорт"):
            self.assertNotIn(forbidden, flat_labels)

    def test_payload_voice_includes_text_and_inline_keyboard(self):
        root = {
            "id": "root-voice",
            "identifier": "WK-20",
            "issueNumber": 20,
            "companyId": "company-1",
            "title": "Research: freedom",
        }
        child = {
            "id": "child-voice",
            "identifier": "WK-21",
            "issueNumber": 21,
            "companyId": "company-1",
            "parentId": "root-voice",
            "title": "Voice Alpha: freedom",
        }
        peer = {
            "id": "child-peer",
            "identifier": "WK-23",
            "issueNumber": 23,
            "companyId": "company-1",
            "parentId": "root-voice",
            "title": "Voice Beta: freedom",
        }
        synthesis = {
            "id": "synthesis-voice",
            "identifier": "WK-22",
            "issueNumber": 22,
            "companyId": "company-1",
            "parentId": "root-voice",
            "title": "Executive summary: freedom",
        }
        config = {
            "command": {"name": "work"},
            "telegram": {
                "callback_prefix": "wk",
                "synthesis_title_pattern": "^Executive summary:",
                "buttons": {
                    "labels": {
                        "synthesis": "Brief",
                        "all_voices": "Inputs",
                        "clarify": "Follow up",
                    },
                },
            },
            "actions": {
                "result": {"exec": ["node", "-e", "process.stdout.write('voice text')"]},
            },
        }

        payload = self.run_helper(
            config,
            {
                "/api/issues/WK-21": child,
                "/api/issues/root-voice": root,
                "/api/companies/company-1/issues": [root, child, synthesis, peer],
            },
            ["payload-voice", "WK-21"],
        )

        self.assertEqual(payload["text"], "voice text")
        rows = payload["reply_markup"]["inline_keyboard"]
        self.assertEqual(rows[0], [{"text": "Brief", "callback_data": "wk:result:WK-22"}])
        self.assertEqual(
            rows[1],
            [
                {"text": "Voice Alpha", "callback_data": "wk:voice:WK-21"},
                {"text": "Voice Beta", "callback_data": "wk:voice:WK-23"},
            ],
        )
        self.assertEqual(
            rows[2],
            [
                {"text": "Inputs", "callback_data": "wk:latest:WK-20"},
                {"text": "Follow up", "callback_data": "wk:clarify:WK-20"},
            ],
        )

    def test_payload_progress_summarizes_done_and_waiting_voices(self):
        root = {
            "id": "root-progress",
            "identifier": "WK-30",
            "issueNumber": 30,
            "companyId": "company-1",
            "title": "Research: progress",
        }
        done = {
            "id": "child-done",
            "identifier": "WK-31",
            "issueNumber": 31,
            "companyId": "company-1",
            "parentId": "root-progress",
            "status": "done",
            "title": "Voice Alpha: progress",
        }
        waiting_one = {
            "id": "child-waiting-one",
            "identifier": "WK-32",
            "issueNumber": 32,
            "companyId": "company-1",
            "parentId": "root-progress",
            "status": "in_progress",
            "title": "Voice Beta: progress",
        }
        waiting_two = {
            "id": "child-waiting-two",
            "identifier": "WK-33",
            "issueNumber": 33,
            "companyId": "company-1",
            "parentId": "root-progress",
            "status": "todo",
            "title": "Voice Gamma: progress",
        }
        config = {
            "command": {"name": "work"},
            "telegram": {
                "callback_prefix": "wk",
                "buttons": {
                    "labels": {
                        "synthesis": "Brief",
                        "all_voices": "Inputs",
                        "clarify": "Follow up",
                    },
                },
            },
        }

        payload = self.run_helper(
            config,
            {
                "/api/issues/WK-30": root,
                "/api/companies/company-1/issues": [root, done, waiting_one, waiting_two],
            },
            ["payload-progress", "WK-30"],
        )

        self.assertIn("Совет работает: 1/3 философов готовы.", payload["text"])
        self.assertIn("Готовы: Voice Alpha.", payload["text"])
        self.assertIn("Ждем: Voice Beta, Voice Gamma.", payload["text"])
        self.assertNotIn("WK-30", payload["text"])
        rows = payload["reply_markup"]["inline_keyboard"]
        self.assertEqual(rows[-1][0], {"text": "Inputs", "callback_data": "wk:latest:WK-30"})

    def test_real_agora_progress_uses_contract_buttons(self):
        root = {
            "id": "root-progress-agora",
            "identifier": "THE-130",
            "issueNumber": 130,
            "companyId": "company-1",
            "title": "Agora balanced: progress",
        }
        done = {
            "id": "child-done-agora",
            "identifier": "THE-131",
            "issueNumber": 131,
            "companyId": "company-1",
            "parentId": "root-progress-agora",
            "status": "done",
            "title": "Аристотель: progress",
        }
        waiting = {
            "id": "child-waiting-agora",
            "identifier": "THE-132",
            "issueNumber": 132,
            "companyId": "company-1",
            "parentId": "root-progress-agora",
            "status": "todo",
            "title": "Фуко: progress",
        }
        config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))

        payload = self.run_helper(
            config,
            {
                "/api/issues/THE-130": root,
                "/api/companies/company-1/issues": [root, done, waiting],
            },
            ["payload-progress", "THE-130"],
        )

        self.assertIn("Совет работает: 1/2 философов готовы.", payload["text"])
        self.assertEqual(
            payload["reply_markup"]["inline_keyboard"],
            [
                [
                    {"text": "Статус", "callback_data": "pc:last_session:help"},
                    {"text": "Показать готовые", "callback_data": "pc:philosophers_ready:THE-130"},
                ],
                [
                    {"text": "Философы", "callback_data": "pc:philosophers:THE-130"},
                ],
            ],
        )

    def test_payload_last_session_selects_latest_root_without_raw_details(self):
        older_root = {
            "id": "root-old",
            "identifier": "THE-10",
            "issueNumber": 10,
            "companyId": "company-1",
            "status": "done",
            "title": "Agora balanced: старая тема",
        }
        latest_root = {
            "id": "root-latest",
            "identifier": "THE-20",
            "issueNumber": 20,
            "companyId": "company-1",
            "status": "in_progress",
            "title": "Agora balanced: свобода взрослого ребенка",
        }
        done_child = {
            "id": "child-done",
            "identifier": "THE-21",
            "issueNumber": 21,
            "companyId": "company-1",
            "parentId": "root-latest",
            "status": "done",
            "title": "Аристотель: свобода взрослого ребенка",
        }
        waiting_child = {
            "id": "child-waiting",
            "identifier": "THE-22",
            "issueNumber": 22,
            "companyId": "company-1",
            "parentId": "root-latest",
            "status": "todo",
            "title": "Фуко: свобода взрослого ребенка",
        }
        config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))

        payload = self.run_helper(
            config,
            {
                "/api/companies": [{"id": "company-1", "name": "The Inner Agora", "issuePrefix": "THE"}],
                "/api/companies/company-1/issues": [older_root, latest_root, done_child, waiting_child],
            },
            ["payload-last-session", "help"],
        )

        self.assertIn("Последняя сессия: THE-20", payload["text"])
        self.assertIn("Статус: ждем 1 из 2 философов", payload["text"])
        self.assertIn("Тема: свобода взрослого ребенка", payload["text"])
        self.assertIn("Коротко: итог еще не готов", payload["text"])
        self.assertNotIn("root-latest", payload["text"])
        self.assertNotIn("http://", payload["text"])
        self.assertEqual(
            payload["reply_markup"]["inline_keyboard"],
            [
                [
                    {"text": "Открыть сессию", "callback_data": "pc:latest:THE-20"},
                    {"text": "Философы", "callback_data": "pc:philosophers:THE-20"},
                ],
                [
                    {"text": "Итог", "callback_data": "pc:result:THE-20"},
                    {"text": "Продолжить", "callback_data": "pc:clarify:THE-20"},
                ],
                [
                    {"text": "Остановить", "callback_data": "pc:stop_confirm:THE-20"},
                    {"text": "Назад", "callback_data": "pc:back_home:help"},
                ],
            ],
        )

    def test_payload_stop_confirm_does_not_write_before_confirmation(self):
        root = {
            "id": "root-stop",
            "identifier": "THE-70",
            "issueNumber": 70,
            "companyId": "company-1",
            "status": "in_progress",
            "title": "Agora balanced: остановить",
        }
        child = {
            "id": "child-stop",
            "identifier": "THE-71",
            "issueNumber": 71,
            "companyId": "company-1",
            "parentId": "root-stop",
            "status": "todo",
            "title": "Фуко: остановить",
        }
        config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))

        payload, calls = self.run_helper_with_calls(
            config,
            {
                "/api/issues/THE-70": root,
                "/api/companies/company-1/issues": [root, child],
            },
            ["payload-stop-confirm", "THE-70"],
        )

        self.assertEqual(calls, [])
        self.assertIn("Остановить совет THE-70?", payload["text"])
        self.assertIn("Это уберет сессию из рабочих списков.", payload["text"])
        self.assertEqual(
            payload["reply_markup"]["inline_keyboard"],
            [
                [
                    {"text": "Остановить совет", "callback_data": "pc:stop_cleanup:THE-70"},
                    {"text": "Назад", "callback_data": "pc:last_session:help"},
                ],
                [
                    {"text": "Показать детали", "callback_data": "pc:details:THE-70"},
                ],
            ],
        )

    def test_payload_stop_cleanup_hides_only_selected_root_and_children(self):
        root = {
            "id": "root-stop",
            "identifier": "THE-70",
            "issueNumber": 70,
            "companyId": "company-1",
            "status": "in_progress",
            "title": "Agora balanced: остановить",
        }
        child = {
            "id": "child-stop",
            "identifier": "THE-71",
            "issueNumber": 71,
            "companyId": "company-1",
            "parentId": "root-stop",
            "status": "todo",
            "title": "Фуко: остановить",
        }
        other_root = {
            "id": "root-other",
            "identifier": "THE-80",
            "issueNumber": 80,
            "companyId": "company-1",
            "status": "in_progress",
            "title": "Agora balanced: другая сессия",
        }
        config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))

        payload, calls = self.run_helper_with_calls(
            config,
            {
                "/api/issues/THE-70": root,
                "/api/companies/company-1/issues": [root, child, other_root],
            },
            ["payload-stop-cleanup", "THE-70"],
        )

        self.assertEqual(payload["text"], "Остановил совет и убрал его из рабочих сессий.")
        patch_paths = [path for method, path, _ in calls if method == "PATCH"]
        self.assertEqual(patch_paths, ["/api/issues/root-stop", "/api/issues/child-stop"])
        for _, _, body in calls:
            self.assertEqual(body["status"], "cancelled")
            self.assertIn("hiddenAt", body)
        self.assertNotIn("/api/issues/root-other", patch_paths)
        self.assertEqual(
            payload["reply_markup"]["inline_keyboard"],
            [
                [
                    {"text": "История", "callback_data": "pc:history:help"},
                    {"text": "Новый вопрос", "callback_data": "pc:new_question:help"},
                ],
                [
                    {"text": "Детали", "callback_data": "pc:details:THE-70"},
                ],
            ],
        )

    def test_payload_stop_cleanup_cancels_active_runs_before_hiding_issues(self):
        root = {
            "id": "root-stop",
            "identifier": "THE-70",
            "issueNumber": 70,
            "companyId": "company-1",
            "status": "in_progress",
            "title": "Agora balanced: остановить",
        }
        config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))

        payload, calls = self.run_helper_with_calls(
            config,
            {
                "/api/issues/THE-70": root,
                "/api/companies/company-1/issues": [root],
                "/api/issues/root-stop/live-runs": [
                    {"id": "run-active", "status": "queued"},
                    {"id": "run-done", "status": "succeeded"},
                ],
            },
            ["payload-stop-cleanup", "THE-70"],
        )

        self.assertEqual(payload["text"], "Остановил совет и убрал его из рабочих сессий.")
        self.assertIn(("POST", "/api/heartbeat-runs/run-active/cancel", {}), calls)
        self.assertNotIn(("POST", "/api/heartbeat-runs/run-done/cancel", {}), calls)
        methods = [method for method, _, _ in calls]
        self.assertLess(methods.index("POST"), methods.index("PATCH"))

    def test_payload_stop_cleanup_partial_failure_offers_retry(self):
        root = {
            "id": "root-stop",
            "identifier": "THE-70",
            "issueNumber": 70,
            "companyId": "company-1",
            "status": "in_progress",
            "title": "Agora balanced: остановить",
        }
        child = {
            "id": "child-stop",
            "identifier": "THE-71",
            "issueNumber": 71,
            "companyId": "company-1",
            "parentId": "root-stop",
            "status": "todo",
            "title": "Фуко: остановить",
        }
        config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))

        payload, calls = self.run_helper_with_calls(
            config,
            {
                "/api/issues/THE-70": root,
                "/api/companies/company-1/issues": [root, child],
                ("PATCH", "/api/issues/child-stop"): (500, {"error": "failed"}),
            },
            ["payload-stop-cleanup", "THE-70"],
        )

        self.assertEqual(payload["text"], "Остановил совет, но убрал не все.\nМожно дочистить.")
        patch_paths = [path for method, path, _ in calls if method == "PATCH"]
        self.assertEqual(patch_paths, ["/api/issues/root-stop", "/api/issues/child-stop"])
        self.assertEqual(
            payload["reply_markup"]["inline_keyboard"][0],
            [
                {"text": "Дочистить", "callback_data": "pc:stop_cleanup:THE-70"},
                {"text": "Детали", "callback_data": "pc:details:THE-70"},
            ],
        )

    def test_payload_philosophers_lists_session_voices_without_catalog_or_synthesis(self):
        root = {
            "id": "root-philosophers",
            "identifier": "THE-50",
            "issueNumber": 50,
            "companyId": "company-1",
            "status": "in_progress",
            "title": "Agora balanced: свобода",
        }
        ready = {
            "id": "child-ready",
            "identifier": "THE-51",
            "issueNumber": 51,
            "companyId": "company-1",
            "parentId": "root-philosophers",
            "status": "done",
            "title": "Аристотель: свобода",
        }
        waiting = {
            "id": "child-waiting",
            "identifier": "THE-52",
            "issueNumber": 52,
            "companyId": "company-1",
            "parentId": "root-philosophers",
            "status": "in_progress",
            "title": "Фуко: свобода",
        }
        synthesis = {
            "id": "child-synthesis",
            "identifier": "THE-53",
            "issueNumber": 53,
            "companyId": "company-1",
            "parentId": "root-philosophers",
            "status": "done",
            "title": "Синтез: свобода",
        }
        config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))

        payload = self.run_helper(
            config,
            {
                "/api/issues/THE-50": root,
                "/api/companies/company-1/issues": [root, ready, waiting, synthesis],
            },
            ["payload-philosophers", "THE-50"],
        )

        self.assertIn("Философы этой сессии", payload["text"])
        self.assertIn("Аристотель — готов", payload["text"])
        self.assertIn("Фуко — ждет ответ", payload["text"])
        self.assertNotIn("Синтез", payload["text"])
        self.assertNotIn("Каталог", payload["text"])
        self.assertNotIn("http://", payload["text"])
        self.assertEqual(
            payload["reply_markup"]["inline_keyboard"],
            [
                [
                    {"text": "Готовые", "callback_data": "pc:philosophers_ready:THE-50"},
                    {"text": "Все", "callback_data": "pc:philosophers:THE-50"},
                ],
                [
                    {"text": "Спросить философа", "callback_data": "pc:ask_one_prompt:THE-50"},
                    {"text": "Назад", "callback_data": "pc:last_session:help"},
                ],
            ],
        )

    def test_payload_philosopher_search_returns_candidates_without_api_calls(self):
        config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))

        payload, calls = self.run_helper_with_calls(
            config,
            {},
            ["payload-philosopher-search", "Аристотелл"],
        )

        self.assertEqual(calls, [])
        self.assertIn("Я нашел похожих философов", payload["text"])
        self.assertIn("Аристотель", payload["text"])
        rows = payload["reply_markup"]["inline_keyboard"]
        self.assertLessEqual(sum(len(row) for row in rows), 4)
        self.assertEqual(rows[0][0], {"text": "Аристотель", "callback_data": "pc:choose_philosopher:aristotle"})
        self.assertIn({"text": "Назад", "callback_data": "pc:ask_one_prompt:help"}, rows[-1])

    def test_payload_custom_proposal_returns_four_philosophers_and_pending_launch(self):
        config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))

        payload, calls = self.run_helper_with_calls(
            config,
            {},
            ["payload-custom-proposal", "свобода", "взрослого", "ребенка"],
        )

        self.assertEqual(calls, [])
        self.assertIn("По этой теме я бы собрал 4 философов", payload["text"])
        self.assertIn("Вопрос:\nсвобода взрослого ребенка", payload["text"])
        self.assertIn("Можно изменить состав.", payload["text"])
        self.assertEqual(payload["pending_question"]["type"], "launch")
        self.assertEqual(payload["pending_question"]["action"], "ask")
        self.assertIn("--philosophers", payload["pending_question"]["args"])
        self.assertIn("свобода взрослого ребенка", payload["pending_question"]["args"])
        self.assertEqual(
            payload["reply_markup"]["inline_keyboard"],
            [
                [
                    {"text": "Запустить", "callback_data": "pc:launch_custom:pending"},
                    {"text": "Добавить", "callback_data": "pc:add_philosopher:pending"},
                ],
                [
                    {"text": "Убрать", "callback_data": "pc:remove_philosopher:pending"},
                    {"text": "Сделать 2-3", "callback_data": "pc:fast_prompt:pending"},
                ],
                [
                    {"text": "Сделать 5-6", "callback_data": "pc:deep_prompt:pending"},
                    {"text": "Назад", "callback_data": "pc:back_home:help"},
                ],
            ],
        )

    def test_payload_custom_edit_prompt_preserves_current_composition(self):
        config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))

        payload, calls = self.run_helper_with_calls(
            config,
            {},
            [
                "payload-custom-edit-prompt",
                "add",
                "--philosophers",
                "socrates,aristotle",
                "--topic",
                "свобода взрослого ребенка",
            ],
        )

        self.assertEqual(calls, [])
        self.assertIn("Кого добавить?", payload["text"])
        self.assertEqual(payload["pending_question"]["type"], "custom_edit")
        self.assertEqual(payload["pending_question"]["operation"], "add")
        self.assertEqual(payload["pending_question"]["roles"], "socrates,aristotle")
        self.assertEqual(payload["pending_question"]["topic"], "свобода взрослого ребенка")

    def test_payload_custom_edit_adds_and_removes_before_launch(self):
        config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))

        add_payload, add_calls = self.run_helper_with_calls(
            config,
            {},
            [
                "payload-custom-edit",
                "add",
                "--philosophers",
                "socrates,aristotle",
                "--topic",
                "свобода взрослого ребенка",
                "--query",
                "Фуко",
            ],
        )
        remove_payload, remove_calls = self.run_helper_with_calls(
            config,
            {},
            [
                "payload-custom-edit",
                "remove",
                "--philosophers",
                "socrates,aristotle,foucault",
                "--topic",
                "свобода взрослого ребенка",
                "--query",
                "Сократ",
            ],
        )

        self.assertEqual(add_calls, [])
        self.assertEqual(remove_calls, [])
        self.assertIn("Обновил состав: 3 философа", add_payload["text"])
        self.assertIn("Фуко", add_payload["text"])
        self.assertIn("--philosophers socrates,aristotle,foucault свобода взрослого ребенка", add_payload["pending_question"]["args"])
        self.assertIn("Обновил состав: 2 философа", remove_payload["text"])
        self.assertNotIn("socrates", remove_payload["pending_question"]["args"])
        self.assertIn("--philosophers aristotle,foucault свобода взрослого ребенка", remove_payload["pending_question"]["args"])

    def test_payload_qa_status_reads_latest_artifact_without_api_calls(self):
        with tempfile.TemporaryDirectory() as tmp:
            artifacts = Path(tmp) / "qa"
            self.write_qa_artifact(artifacts)
            config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))
            config["telegram"]["qa"] = {"artifacts_dir": str(artifacts)}

            payload, calls = self.run_helper_with_calls(config, {}, ["payload-qa-status"])

        self.assertEqual(calls, [])
        self.assertIn("Последний QA: service-commands", payload["text"])
        self.assertIn("Статус: FAIL", payload["text"])
        self.assertIn("Проверки: 1/2", payload["text"])
        self.assertIn("Баги: 1", payload["text"])
        self.assertIn("Cleanup: clean", payload["text"])

    def test_payload_qa_failures_lists_failed_tests_and_bugs(self):
        with tempfile.TemporaryDirectory() as tmp:
            artifacts = Path(tmp) / "qa"
            self.write_qa_artifact(artifacts)
            config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))
            config["telegram"]["qa"] = {"artifacts_dir": str(artifacts)}

            payload, calls = self.run_helper_with_calls(config, {}, ["payload-qa-failures"])

        self.assertEqual(calls, [])
        self.assertIn("Упавшие проверки", payload["text"])
        self.assertIn("service.agora", payload["text"])
        self.assertIn("raw Hermes UI still visible", payload["text"])

    def test_payload_details_is_second_level_and_contains_technical_links(self):
        root = {
            "id": "root-details",
            "identifier": "THE-60",
            "issueNumber": 60,
            "companyId": "company-1",
            "status": "in_progress",
            "createdAt": "2026-07-04T10:00:00.000Z",
            "updatedAt": "2026-07-04T10:05:00.000Z",
            "title": "Agora balanced: забота и контроль",
            "metadata": {"adapter": "hermes_local", "model": "google/gemma"},
        }
        child = {
            "id": "child-details",
            "identifier": "THE-61",
            "issueNumber": 61,
            "companyId": "company-1",
            "parentId": "root-details",
            "status": "done",
            "title": "Аристотель: забота и контроль",
        }
        config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))

        payload = self.run_helper(
            config,
            {
                "/api/issues/THE-60": root,
                "/api/companies/company-1/issues": [root, child],
            },
            ["payload-details", "THE-60"],
        )

        self.assertIn("Детали сессии THE-60", payload["text"])
        self.assertIn("Открыть в Paperclip: http://127.0.0.1:", payload["text"])
        self.assertIn("/issues/root-details", payload["text"])
        self.assertIn("Технические детали", payload["text"])
        self.assertIn("route/model: hermes_local / google/gemma", payload["text"])
        self.assertIn("created: 2026-07-04T10:00:00.000Z", payload["text"])
        self.assertNotIn("Коротко:", payload["text"])
        self.assertEqual(
            payload["reply_markup"]["inline_keyboard"],
            [
                [
                    {"text": "Открыть в Paperclip", "callback_data": "pc:open_paperclip:THE-60"},
                    {"text": "Экспорт", "callback_data": "pc:export:THE-60"},
                ],
                [
                    {"text": "Назад", "callback_data": "pc:last_session:help"},
                ],
            ],
        )

    def test_payload_history_lists_five_root_sessions_only(self):
        roots = [
            {
                "id": f"root-{index}",
                "identifier": f"THE-{index}",
                "issueNumber": index,
                "companyId": "company-1",
                "status": "done" if index % 2 else "in_progress",
                "title": f"Agora balanced: тема {index}",
            }
            for index in range(1, 8)
        ]
        child = {
            "id": "child-8",
            "identifier": "THE-8",
            "issueNumber": 8,
            "companyId": "company-1",
            "parentId": "root-7",
            "status": "done",
            "title": "Аристотель: child row should be hidden",
        }
        config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))

        payload = self.run_helper(
            config,
            {
                "/api/companies": [{"id": "company-1", "name": "The Inner Agora", "issuePrefix": "THE"}],
                "/api/companies/company-1/issues": [*roots, child],
            },
            ["payload-history", "help"],
        )

        self.assertIn("История сессий", payload["text"])
        self.assertIn("1. THE-7 — тема 7", payload["text"])
        for index in range(7, 2, -1):
            self.assertIn(f"THE-{index} — тема {index}", payload["text"])
        self.assertNotIn("THE-2 — тема 2", payload["text"])
        self.assertNotIn("child row should be hidden", payload["text"])
        self.assertEqual(
            payload["reply_markup"]["inline_keyboard"][:3],
            [
                [
                    {"text": "1 THE-7", "callback_data": "pc:session:THE-7"},
                    {"text": "2 THE-6", "callback_data": "pc:session:THE-6"},
                ],
                [
                    {"text": "3 THE-5", "callback_data": "pc:session:THE-5"},
                    {"text": "4 THE-4", "callback_data": "pc:session:THE-4"},
                ],
                [
                    {"text": "5 THE-3", "callback_data": "pc:session:THE-3"},
                ],
            ],
        )
        labels = [button["text"] for row in payload["reply_markup"]["inline_keyboard"] for button in row]
        self.assertIn("Показать еще", labels)
        self.assertIn("В работе", labels)
        self.assertIn("С итогом", labels)
        self.assertIn("Остановленные", labels)
        self.assertIn("Назад", labels)

    def test_payload_history_filters_active_root_sessions(self):
        roots = [
            {
                "id": "root-active",
                "identifier": "THE-91",
                "issueNumber": 91,
                "companyId": "company-1",
                "status": "in_progress",
                "title": "Agora balanced: активная",
            },
            {
                "id": "root-done",
                "identifier": "THE-90",
                "issueNumber": 90,
                "companyId": "company-1",
                "status": "done",
                "title": "Agora balanced: готовая",
            },
            {
                "id": "root-stopped",
                "identifier": "THE-89",
                "issueNumber": 89,
                "companyId": "company-1",
                "status": "cancelled",
                "title": "Agora balanced: остановленная",
            },
        ]
        config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))

        payload = self.run_helper(
            config,
            {
                "/api/companies": [{"id": "company-1", "name": "The Inner Agora", "issuePrefix": "THE"}],
                "/api/companies/company-1/issues": roots,
            },
            ["payload-history", "--filter", "active"],
        )

        self.assertIn("История сессий", payload["text"])
        self.assertIn("THE-91 — активная", payload["text"])
        self.assertIn("в работе", payload["text"])
        self.assertNotIn("THE-90 — готовая", payload["text"])
        self.assertNotIn("THE-89 — остановленная", payload["text"])
        self.assertIn(
            {"text": "С итогом", "callback_data": "pc:history_done:help"},
            [button for row in payload["reply_markup"]["inline_keyboard"] for button in row],
        )

    def test_payload_history_offset_shows_next_page_and_preserves_more_arg(self):
        roots = [
            {
                "id": f"root-{index}",
                "identifier": f"THE-{index}",
                "issueNumber": index,
                "companyId": "company-1",
                "status": "done",
                "title": f"Agora balanced: тема {index}",
            }
            for index in range(1, 12)
        ]
        config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))

        payload = self.run_helper(
            config,
            {
                "/api/companies": [{"id": "company-1", "name": "The Inner Agora", "issuePrefix": "THE"}],
                "/api/companies/company-1/issues": roots,
            },
            ["payload-history", "--offset", "5"],
        )

        for index in range(6, 1, -1):
            self.assertIn(f"THE-{index} — тема {index}", payload["text"])
        self.assertNotIn("THE-11 — тема 11", payload["text"])
        self.assertNotIn("THE-1 — тема 1", payload["text"])
        self.assertIn(
            {"text": "Показать еще", "callback_data": "pc:history_more:10"},
            [button for row in payload["reply_markup"]["inline_keyboard"] for button in row],
        )

    def test_payload_final_result_has_empty_state_without_ready_synthesis(self):
        root = {
            "id": "root-no-result",
            "identifier": "THE-40",
            "issueNumber": 40,
            "companyId": "company-1",
            "status": "in_progress",
            "title": "Agora balanced: нет итога",
        }
        config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))

        payload = self.run_helper(
            config,
            {
                "/api/companies": [{"id": "company-1", "name": "The Inner Agora", "issuePrefix": "THE"}],
                "/api/companies/company-1/issues": [root],
            },
            ["payload-final-result", "help"],
        )

        self.assertEqual(payload["text"], "Готового итога пока нет.")
        self.assertEqual(
            payload["reply_markup"]["inline_keyboard"],
            [
                [
                    {"text": "Новый вопрос", "callback_data": "pc:new_question:help"},
                    {"text": "Последняя сессия", "callback_data": "pc:last_session:help"},
                ],
                [
                    {"text": "История", "callback_data": "pc:history:help"},
                    {"text": "Назад", "callback_data": "pc:back_home:help"},
                ],
            ],
        )

    def test_send_result_uses_short_final_itog_by_default(self):
        root = {
            "id": "root-final",
            "identifier": "THE-80",
            "issueNumber": 80,
            "companyId": "company-1",
            "status": "done",
            "title": "Agora balanced: короткий итог",
        }
        synthesis = {
            "id": "synthesis-final",
            "identifier": "THE-81",
            "issueNumber": 81,
            "companyId": "company-1",
            "parentId": "root-final",
            "status": "done",
            "title": "Синтез: короткий итог",
        }
        config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))
        raw_result = [
            "# Full report",
            "Главный вывод 1",
            "Главный вывод 2",
            "Главный вывод 3",
            "Главный вывод 4",
            "Главный вывод 5",
            "Главный вывод 6",
            "Главный вывод 7",
            "https://paperclip.local/issues/THE-81",
        ]
        config["actions"]["result"] = {
            "exec": ["node", "-e", f"process.stdout.write({json.dumps(chr(10).join(raw_result))})"],
        }

        payload = self.run_helper(
            config,
            {
                "/api/issues/THE-80": root,
                "/api/issues/root-final": root,
                "/api/companies/company-1/issues": [root, synthesis],
            },
            ["send-result", "THE-80", "--dry-run"],
        )

        self.assertIn("Итог готов.", payload["text"])
        self.assertIn("Коротко:", payload["text"])
        self.assertIn("Главный вывод 1", payload["text"])
        self.assertIn("Главный вывод 6", payload["text"])
        self.assertNotIn("Full report", payload["text"])
        self.assertNotIn("Главный вывод 7", payload["text"])
        self.assertNotIn("https://", payload["text"])
        self.assertEqual(
            payload["reply_markup"]["inline_keyboard"][0],
            [{"text": "Полный итог", "callback_data": "pc:result:THE-81"}],
        )
        flat = [button for row in payload["reply_markup"]["inline_keyboard"] for button in row]
        self.assertNotIn({"text": "Разногласия", "callback_data": "pc:disagreements:THE-80"}, flat)

    def test_payload_result_formats_full_itog_without_service_metadata(self):
        root = {
            "id": "root-full",
            "identifier": "THE-187",
            "issueNumber": 187,
            "companyId": "company-1",
            "status": "done",
            "title": "Agora local: свобода или безопасность",
        }
        synthesis = {
            "id": "synthesis-full",
            "identifier": "THE-192",
            "issueNumber": 192,
            "companyId": "company-1",
            "parentId": "root-full",
            "status": "done",
            "title": "Синтез: Agora local: свобода или безопасность",
        }
        config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))
        raw_result = "\n".join(
            [
                "# Результат: THE-192",
                "Синтез: Agora local: свобода или безопасность",
                "- status: done",
                "- пакет: THE-187",
                "- url: http://127.0.0.1:3100/issues/synthesis-full",
                "- источник: comment agent 2026-07-04T18:18:08.350Z",
                "",
                "Главный вывод:",
                "Свобода важнее там, где есть ответственность за выбор.",
                "",
                "Риски:",
                "- Без безопасности свобода легко превращается в хаос.",
                "",
                "Дальше:",
                "- Синтез: /agora result THE-192",
                "- Сократ: /agora voice Сократ THE-187",
            ]
        )
        config["actions"]["result"] = {
            "exec": ["node", "-e", f"process.stdout.write({json.dumps(raw_result)})"],
        }

        payload = self.run_helper(
            config,
            {
                "/api/issues/THE-192": synthesis,
                "/api/issues/root-full": root,
                "/api/companies/company-1/issues": [root, synthesis],
            },
            ["payload-result", "THE-192"],
        )

        self.assertIn("Полный итог: THE-192", payload["text"])
        self.assertIn("Главный вывод:", payload["text"])
        self.assertIn("Свобода важнее", payload["text"])
        self.assertIn("Риски:", payload["text"])
        self.assertNotIn("# Результат", payload["text"])
        self.assertNotIn("- status:", payload["text"])
        self.assertNotIn("- пакет:", payload["text"])
        self.assertNotIn("http://127.0.0.1", payload["text"])
        self.assertNotIn("источник:", payload["text"])
        self.assertNotIn("Дальше:", payload["text"])
        self.assertNotIn("/agora", payload["text"])
        self.assertEqual(
            payload["reply_markup"]["inline_keyboard"][0],
            [{"text": "Полный итог", "callback_data": "pc:result:THE-192"}],
        )

    def test_payload_result_extracts_memo_from_synthesis_json_diff(self):
        root = {
            "id": "root-diff",
            "identifier": "THE-187",
            "issueNumber": 187,
            "companyId": "company-1",
            "status": "done",
            "title": "Agora local: свобода или безопасность",
        }
        synthesis = {
            "id": "synthesis-diff",
            "identifier": "THE-192",
            "issueNumber": 192,
            "companyId": "company-1",
            "parentId": "root-diff",
            "status": "done",
            "title": "Синтез: Agora local: свобода или безопасность",
        }
        config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))
        raw_result = "\n".join(
            [
                "# Результат: THE-192",
                "Синтез: Agora local: свобода или безопасность",
                "",
                "┊ review diff",
                "a//tmp/synthesis_final.json → b//tmp/synthesis_final.json",
                "@@ -0,0 +1,8 @@",
                "+{",
                '+  "status": "done",',
                '+  "comment": "Синтез философской сессии по вопросу: \\"свобода или безопасность?\\"',
                "+",
                "+1. **Реальный вопрос исследования**",
                "+Выбираю ли я между свободой и безопасностью, или между ответственностью и страхом?",
                "+",
                "+2. **Практический вывод**",
                "+Не выбирать абстрактно. Сначала назвать цену ошибки и цену несвободы.",
            ]
        )
        config["actions"]["result"] = {
            "exec": ["node", "-e", f"process.stdout.write({json.dumps(raw_result)})"],
        }

        payload = self.run_helper(
            config,
            {
                "/api/issues/THE-192": synthesis,
                "/api/issues/root-diff": root,
                "/api/companies/company-1/issues": [root, synthesis],
            },
            ["payload-result", "THE-192"],
        )

        self.assertIn("Полный итог: THE-192", payload["text"])
        self.assertIn("Реальный вопрос исследования", payload["text"])
        self.assertIn("Практический вывод", payload["text"])
        self.assertNotIn("review diff", payload["text"])
        self.assertNotIn("synthesis_final.json", payload["text"])
        self.assertNotIn("@@ -0,0", payload["text"])
        self.assertNotIn('+"comment"', payload["text"])
        self.assertNotIn("+1.", payload["text"])

    def test_send_result_shows_disagreements_button_only_when_conflict_is_marked(self):
        root = {
            "id": "root-conflict",
            "identifier": "THE-90",
            "issueNumber": 90,
            "companyId": "company-1",
            "status": "done",
            "title": "Agora balanced: конфликт",
        }
        synthesis = {
            "id": "synthesis-conflict",
            "identifier": "THE-91",
            "issueNumber": 91,
            "companyId": "company-1",
            "parentId": "root-conflict",
            "status": "done",
            "title": "Синтез: конфликт",
        }
        config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))
        raw_result = "Короткий итог\n\nРазногласия:\nАристотель и Ницше расходятся о мере риска."
        config["actions"]["result"] = {
            "exec": ["node", "-e", f"process.stdout.write({json.dumps(raw_result)})"],
        }

        payload = self.run_helper(
            config,
            {
                "/api/issues/THE-90": root,
                "/api/issues/root-conflict": root,
                "/api/companies/company-1/issues": [root, synthesis],
            },
            ["send-result", "THE-90", "--dry-run"],
        )

        flat = [button for row in payload["reply_markup"]["inline_keyboard"] for button in row]
        self.assertIn({"text": "Разногласия", "callback_data": "pc:disagreements:THE-90"}, flat)


if __name__ == "__main__":
    unittest.main()
