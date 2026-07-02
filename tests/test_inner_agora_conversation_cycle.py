import importlib.util
import json
import os
import shlex
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLUGIN_PATH = ROOT / "hermes-plugins" / "paperclip-cockpit" / "__init__.py"
AGORA_SCRIPT = ROOT / "scripts" / "agora.mjs"
MONITOR_SCRIPT = ROOT / "scripts" / "paperclip-cockpit-monitor.mjs"
REAL_CONFIG = ROOT / "paperclip-cockpit.json"


def load_plugin():
    spec = importlib.util.spec_from_file_location("paperclip_cockpit_full_cycle_under_test", PLUGIN_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class EnvPatch:
    def __init__(self, **values):
        self.values = values
        self.previous = {}

    def __enter__(self):
        for key, value in self.values.items():
            self.previous[key] = os.environ.get(key)
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def __exit__(self, *_):
        for key, value in self.previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


class MonkeyPatch:
    def __init__(self, obj, **values):
        self.obj = obj
        self.values = values
        self.previous = {}

    def __enter__(self):
        for key, value in self.values.items():
            self.previous[key] = getattr(self.obj, key)
            setattr(self.obj, key, value)

    def __exit__(self, *_):
        for key, value in self.previous.items():
            setattr(self.obj, key, value)


class FullCycleHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    companies = [{"id": "company-1", "name": "The Inner Agora", "status": "active", "issuePrefix": "THE"}]
    agents = [
        {"id": "assistant-1", "name": "Agora Assistant / Синтезатор", "status": "idle"},
        {"id": "plato-1", "name": "Платон", "status": "idle"},
        {"id": "descartes-1", "name": "Декарт", "status": "idle"},
        {"id": "heidegger-1", "name": "Хайдеггер", "status": "idle"},
        {"id": "socrates-1", "name": "Сократ", "status": "idle"},
        {"id": "sartre-1", "name": "Жан-Поль Сартр", "status": "idle"},
        {"id": "aristotle-1", "name": "Аристотель", "status": "idle"},
    ]
    projects = [{"id": "project-1", "name": "Agora Sessions"}]
    goals = [{"id": "goal-1", "title": "Run philosophical research dialogues with The Inner Agora"}]
    issues = []
    comments = {}
    wakeups = []

    @classmethod
    def reset(cls):
        cls.issues = []
        cls.comments = {}
        cls.wakeups = []

    @classmethod
    def issue_by_ref(cls, ref):
        text = str(ref)
        return next((issue for issue in cls.issues if issue["id"] == text or issue["identifier"] == text), None)

    @classmethod
    def add_comment(cls, issue_id, body, author_type="agent"):
        cls.comments.setdefault(issue_id, []).append(
            {
                "id": f"comment-{issue_id}-{len(cls.comments.get(issue_id, [])) + 1}",
                "body": body,
                "authorType": author_type,
                "createdAt": "2026-07-01T20:30:00.000Z",
            }
        )

    def send_json(self, payload, status=200):
        self.close_connection = True
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.send_header("connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self):
        length = int(self.headers.get("content-length") or "0")
        body = self.rfile.read(length).decode("utf-8") if length else "{}"
        return json.loads(body or "{}")

    def do_GET(self):
        routes = {
            "/api/companies": self.companies,
            "/api/companies/company-1/agents": self.agents,
            "/api/companies/company-1/projects": self.projects,
            "/api/companies/company-1/goals": self.goals,
            "/api/companies/company-1/issues": self.issues,
            "/api/companies/company-1/heartbeat-runs": [],
        }
        if self.path in routes:
            self.send_json(routes[self.path])
            return

        if self.path.startswith("/api/issues/") and self.path.endswith("/comments"):
            issue_ref = self.path.removeprefix("/api/issues/").removesuffix("/comments")
            issue = self.issue_by_ref(issue_ref)
            self.send_json(list(self.comments.get(issue["id"], [])) if issue else [], 200 if issue else 404)
            return

        if self.path.startswith("/api/issues/"):
            issue_ref = self.path.removeprefix("/api/issues/")
            issue = self.issue_by_ref(issue_ref)
            self.send_json(issue if issue else {"error": "not found", "path": self.path}, 200 if issue else 404)
            return

        self.send_json({"error": "not found", "path": self.path}, 404)

    def do_POST(self):
        payload = self.read_json_body()
        if self.path == "/api/companies/company-1/issues":
            number = 900 + len(self.issues)
            issue = {
                **payload,
                "id": "root-1" if not self.issues else f"issue-{number}",
                "identifier": f"THE-{number}",
                "issueNumber": number,
                "companyId": "company-1",
                "createdAt": "2026-07-01T20:00:00.000Z",
                "updatedAt": "2026-07-01T20:00:00.000Z",
            }
            self.issues.append(issue)
            self.comments.setdefault(issue["id"], [])
            self.send_json(issue, 201)
            return

        if self.path.startswith("/api/issues/") and self.path.endswith("/comments"):
            issue_ref = self.path.removeprefix("/api/issues/").removesuffix("/comments")
            issue = self.issue_by_ref(issue_ref)
            if not issue:
                self.send_json({"error": "not found", "path": self.path}, 404)
                return
            self.add_comment(issue["id"], payload.get("body", ""), payload.get("authorType", "system"))
            self.send_json(self.comments[issue["id"]][-1], 201)
            return

        if self.path.startswith("/api/agents/") and self.path.endswith("/wakeup"):
            agent_id = self.path.split("/")[3]
            self.wakeups.append({"agentId": agent_id, "payload": payload})
            self.send_json({"id": f"run-{len(self.wakeups)}", "status": "queued"}, 202)
            return

        self.send_json({"error": "not found", "path": self.path}, 404)

    def do_PATCH(self):
        payload = self.read_json_body()
        if self.path.startswith("/api/issues/"):
            issue_ref = self.path.removeprefix("/api/issues/")
            issue = self.issue_by_ref(issue_ref)
            if not issue:
                self.send_json({"error": "not found", "path": self.path}, 404)
                return
            issue.update(payload)
            issue["updatedAt"] = "2026-07-01T20:35:00.000Z"
            self.send_json(issue)
            return
        self.send_json({"error": "not found", "path": self.path}, 404)

    def log_message(self, *_):
        return


class TestHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False


class InnerAgoraConversationCycleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plugin = load_plugin()

    def run_node(self, args, env, timeout=90):
        result = subprocess.run(
            ["node", *map(str, args)],
            cwd=ROOT,
            env=env,
            text=True,
            capture_output=True,
            timeout=timeout,
        )
        if result.returncode != 0:
            self.fail(
                "\n".join(
                    [
                        f"node {' '.join(map(str, args))} exited {result.returncode}",
                        "stdout:",
                        result.stdout,
                        "stderr:",
                        result.stderr,
                    ]
                )
            )
        return result

    def test_two_telegram_chats_keep_separate_last_root_state(self):
        FullCycleHandler.reset()
        server = TestHTTPServer(("127.0.0.1", 0), FullCycleHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                config = json.loads(REAL_CONFIG.read_text(encoding="utf-8"))
                config["cwd"] = str(ROOT)
                config.setdefault("agora", {})["default_mode"] = "local"
                config_path = Path(temp_dir) / "paperclip-cockpit.json"
                state_dir = Path(temp_dir) / "state"
                profile_dir = Path(temp_dir) / "profiles"
                config_path.write_text(json.dumps(config), encoding="utf-8")
                base_env = {
                    **os.environ,
                    "PAPERCLIP_API_BASE": f"http://127.0.0.1:{server.server_port}/api",
                    "PAPERCLIP_COCKPIT_CONFIG": str(config_path),
                    "INNER_AGORA_STATE_DIR": str(state_dir),
                    "INNER_AGORA_PROFILE_DIR": str(profile_dir),
                    "INNER_AGORA_LEGACY_STATE_PATH": str(Path(temp_dir) / "missing-legacy.json"),
                    "STATE_MODE": "per-chat",
                    "INNER_AGORA_AUTO_RESTART_PAPERCLIP": "0",
                    "PAPERCLIP_COCKPIT_NL_REWRITE": "1",
                    "PAPERCLIP_COCKPIT_NL_WRITES": "0",
                }

                def rewrite_for(chat_id, text):
                    class Source:
                        platform = "telegram"

                    Source.chat_id = chat_id

                    class Event:
                        source = Source()

                    Event.text = text

                    with EnvPatch(**base_env, INNER_AGORA_CHAT_ID=chat_id):
                        return self.plugin._pre_gateway_dispatch(Event())

                first = rewrite_for("chat-a", "давай спросим агору про свободу ребенка")
                first_command = shlex.split(first["text"])
                self.run_node([AGORA_SCRIPT, "ask", *first_command[2:]], {**base_env, "INNER_AGORA_CHAT_ID": "chat-a"})

                second = rewrite_for("chat-b", "давай спросим агору про свободу родителей")
                second_command = shlex.split(second["text"])
                self.run_node([AGORA_SCRIPT, "ask", *second_command[2:]], {**base_env, "INNER_AGORA_CHAT_ID": "chat-b"})

                chat_a_state = json.loads((state_dir / "chat-a.json").read_text(encoding="utf-8"))
                chat_b_state = json.loads((state_dir / "chat-b.json").read_text(encoding="utf-8"))
                self.assertNotEqual(chat_a_state["lastRootIssueRef"], chat_b_state["lastRootIssueRef"])
                self.assertEqual(chat_a_state["chatId"], "chat-a")
                self.assertEqual(chat_b_state["chatId"], "chat-b")
        finally:
            server.shutdown()
            server.server_close()

    def test_natural_telegram_like_round_trip_without_live_bot_side_effects(self):
        FullCycleHandler.reset()
        server = TestHTTPServer(("127.0.0.1", 0), FullCycleHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                config = json.loads(REAL_CONFIG.read_text(encoding="utf-8"))
                config["cwd"] = str(ROOT)
                config.setdefault("agora", {})["default_mode"] = "local"
                config.setdefault("monitor", {})["state_file"] = str(Path(temp_dir) / "monitor-state.json")
                config["monitor"]["notify"] = {
                    "exec": ["node", "scripts/paperclip-cockpit-telegram.mjs", "send-result", "{issue}", "--dry-run"]
                }
                config.setdefault("telegram", {})["home_chat_id"] = "test-chat"
                config_path = Path(temp_dir) / "paperclip-cockpit.json"
                state_path = Path(temp_dir) / "inner-agora-state.json"
                config_path.write_text(json.dumps(config), encoding="utf-8")

                env = {
                    **os.environ,
                    "PAPERCLIP_API_BASE": f"http://127.0.0.1:{server.server_port}/api",
                    "PAPERCLIP_COCKPIT_CONFIG": str(config_path),
                    "INNER_AGORA_STATE_PATH": str(state_path),
                    "INNER_AGORA_AUTO_RESTART_PAPERCLIP": "0",
                    "PAPERCLIP_COCKPIT_NL_REWRITE": "1",
                    "PAPERCLIP_COCKPIT_NL_WRITES": "0",
                }
                env.pop("INNER_AGORA_MODE", None)

                class Source:
                    platform = "telegram"
                    chat_id = "test-chat"

                class Event:
                    source = Source()
                    text = "давай спросим агору про свободу ребенка и власть родителей"

                with EnvPatch(**env):
                    rewritten = self.plugin._pre_gateway_dispatch(Event())

                self.assertEqual(rewritten["action"], "rewrite")
                command = shlex.split(rewritten["text"])
                self.assertEqual(command[:2], ["/agora", "ask"])

                ask_result = self.run_node([AGORA_SCRIPT, "ask", *command[2:]], env)
                self.assertIn("Поставил вопрос в Агору: THE-900", ask_result.stdout)
                self.assertIn("Напишу сюда, когда будет готов синтез.", ask_result.stdout)

                root = FullCycleHandler.issue_by_ref("THE-900")
                self.assertIsNotNone(root)
                voice_children = [issue for issue in FullCycleHandler.issues if issue.get("parentId") == root["id"]]
                self.assertEqual(len(voice_children), 5)
                self.assertEqual(len(FullCycleHandler.wakeups), 5)

                for child in voice_children:
                    child["status"] = "done"
                    child["updatedAt"] = "2026-07-01T20:20:00.000Z"
                    FullCycleHandler.add_comment(
                        child["id"],
                        f"{child['title']}\n\n1. Позиция.\n\n- Короткий философский ответ для синтеза.",
                    )

                first_monitor = self.run_node([MONITOR_SCRIPT, "once", "--root", "THE-900", "--json"], env)
                first_data = json.loads(first_monitor.stdout)
                self.assertEqual(first_data["operations"][0]["type"], "synthesize")

                synthesis = next(issue for issue in FullCycleHandler.issues if issue["title"].startswith("Синтез:"))
                self.assertEqual(synthesis["status"], "todo")
                self.assertEqual(FullCycleHandler.wakeups[-1]["agentId"], "assistant-1")

                synthesis["status"] = "done"
                synthesis["updatedAt"] = "2026-07-01T20:40:00.000Z"
                FullCycleHandler.add_comment(
                    synthesis["id"],
                    "\n\n".join(
                        [
                            "1. Реальный вопрос сессии.",
                            "Как удержать свободу ребенка без отказа от заботы.",
                            "2. Участники и их позиции.",
                            "- Платон: забота нуждается в форме.",
                            "- Сартр: свобода не делегируется семье.",
                            "3. Главные линии конфликта.",
                            "- Забота против контроля.",
                            "- Долг против самостоятельности.",
                            "4. Скрытые предпосылки вопроса.",
                            "Семья не является автоматическим источником правоты.",
                            "5. Сильнейшие аргументы.",
                            "- Контроль часто маскируется любовью.",
                            "6. Нерешенные вопросы.",
                            "- Где граница ответственности родителя.",
                            "7. Следующий исследовательский или практический шаг.",
                            "Попросить один голос уточнить понятие долга.",
                            "8. Как использованы пометки.",
                            "Пометки:\n- [реконструкция] без выдуманных цитат.",
                        ]
                    ),
                )

                second_monitor = self.run_node([MONITOR_SCRIPT, "once", "--root", "THE-900", "--json"], env)
                second_data = json.loads(second_monitor.stdout)
                operation = second_data["operations"][0]
                self.assertEqual(operation["type"], "notify")
                self.assertEqual(operation["synthesis"], synthesis["identifier"])
                notification_output = operation["run"]["output"]
                self.assertIn('"text": "Синтез"', notification_output)
                self.assertIn(f'"callback_data": "pc:result:{synthesis["identifier"]}"', notification_output)
                self.assertIn('"text": "Все голоса"', notification_output)
                self.assertIn('"text": "Уточнить"', notification_output)
                self.assertIn('"callback_data": "pc:voice:THE-901"', notification_output)

                telegram_calls = []

                def fake_telegram_api(method, payload, *, timeout=20):
                    telegram_calls.append((method, payload, timeout))
                    return {"ok": True}

                with EnvPatch(**env), MonkeyPatch(self.plugin, _telegram_api=fake_telegram_api):
                    callback_result = self.plugin._telegram_callback_query(
                        query=type("Query", (), {"id": "callback-1"})(),
                        data="pc:voice:THE-901",
                        chat_id="test-chat",
                        user_id="user-1",
                    )

                self.assertEqual(callback_result, {"action": "handled"})
                self.assertEqual([call[0] for call in telegram_calls[:2]], ["answerCallbackQuery", "sendMessage"])
                self.assertIn("# Результат: THE-901", telegram_calls[1][1]["text"])
                self.assertIn("Платон", telegram_calls[1][1]["text"])
                self.assertEqual(
                    telegram_calls[1][1]["reply_markup"]["inline_keyboard"][0][0],
                    {"text": "Синтез", "callback_data": f"pc:result:{synthesis['identifier']}"},
                )
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
