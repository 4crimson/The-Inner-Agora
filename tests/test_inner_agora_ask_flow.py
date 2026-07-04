import json
import os
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AGORA_SCRIPT = ROOT / "scripts" / "agora.mjs"


class AskFlowHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    companies = [{"id": "company-1", "name": "The Inner Agora", "status": "active", "issuePrefix": "THE"}]
    agents = [
        {"id": "assistant-1", "name": "Agora Assistant / Синтезатор", "status": "idle"},
        {"id": "plato-1", "name": "Платон", "status": "idle"},
        {"id": "descartes-1", "name": "Декарт", "status": "idle"},
        {"id": "heidegger-1", "name": "Хайдеггер", "status": "idle"},
        {"id": "socrates-1", "name": "Сократ", "status": "idle"},
        {"id": "sartre-1", "name": "Жан-Поль Сартр", "status": "idle"},
    ]
    projects = [{"id": "project-1", "name": "Agora Sessions"}]
    goals = [{"id": "goal-1", "title": "Run philosophical research dialogues with The Inner Agora"}]
    created_issues = []
    comments = []
    issue_comments = {}
    heartbeat_runs = []
    wakeups = []

    @classmethod
    def reset(cls):
        cls.created_issues = []
        cls.comments = []
        cls.issue_comments = {}
        cls.heartbeat_runs = []
        cls.wakeups = []

    @classmethod
    def issue_by_ref(cls, ref):
        return next(
            (
                issue
                for issue in cls.created_issues
                if issue.get("id") == ref or issue.get("identifier") == ref
            ),
            None,
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
            "/api/companies/company-1/issues": self.created_issues,
            "/api/companies/company-1/heartbeat-runs": self.heartbeat_runs,
        }
        if self.path in routes:
            self.send_json(routes[self.path])
            return
        if self.path.startswith("/api/issues/") and self.path.endswith("/comments"):
            ref = self.path.removeprefix("/api/issues/").removesuffix("/comments").strip("/")
            issue = self.issue_by_ref(ref)
            if not issue:
                self.send_json({"error": "not found", "path": self.path}, 404)
                return
            self.send_json(self.issue_comments.get(issue["id"], []))
            return
        if self.path.startswith("/api/issues/"):
            ref = self.path.removeprefix("/api/issues/")
            issue = self.issue_by_ref(ref)
            self.send_json(issue if issue else {"error": "not found", "path": self.path}, 200 if issue else 404)
            return
        self.send_json({"error": "not found", "path": self.path}, 404)

    def do_POST(self):
        payload = self.read_json_body()
        if self.path == "/api/companies/company-1/issues":
            index = len(self.created_issues)
            issue = {
                **payload,
                "id": "root-1" if index == 0 else f"child-{index}",
                "identifier": "THE-900" if index == 0 else f"THE-{900 + index}",
                "companyId": "company-1",
                "createdAt": "2026-07-01T20:00:00.000Z",
                "updatedAt": "2026-07-01T20:00:00.000Z",
            }
            self.created_issues.append(issue)
            self.send_json(issue, 201)
            return

        if self.path.startswith("/api/agents/") and self.path.endswith("/wakeup"):
            agent_id = self.path.split("/")[3]
            self.wakeups.append({"agentId": agent_id, "payload": payload})
            self.send_json({"id": f"run-{len(self.wakeups)}", "status": "queued"}, 202)
            return

        if self.path.startswith("/api/issues/") and self.path.endswith("/comments"):
            ref = self.path.removeprefix("/api/issues/").removesuffix("/comments").strip("/")
            issue = self.issue_by_ref(ref)
            if not issue:
                self.send_json({"error": "not found", "path": self.path}, 404)
                return
            self.comments.append(payload)
            self.issue_comments.setdefault(issue["id"], []).append({"id": f"comment-{len(self.comments)}", **payload})
            self.send_json({"id": f"comment-{len(self.comments)}", **payload}, 201)
            return

        self.send_json({"error": "not found", "path": self.path}, 404)

    def log_message(self, *_):
        return


class TestHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False


class InnerAgoraAskFlowTests(unittest.TestCase):
    def custom_models_config(self):
        payload = json.loads((ROOT / "models.config.json").read_text(encoding="utf-8"))
        payload["adapters"]["hermes_local"]["model"] = "test/hermes-local"
        payload["adapters"]["codex_local"]["model"] = "test/codex-local"
        return payload

    def run_ask(self, question, models_config=None):
        AskFlowHandler.reset()
        server = TestHTTPServer(("127.0.0.1", 0), AskFlowHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                config_path = Path(temp_dir) / "paperclip-cockpit.json"
                state_path = Path(temp_dir) / "state.json"
                config_path.write_text(
                    json.dumps({"agora": {"default_mode": "local"}, "cwd": temp_dir}),
                    encoding="utf-8",
                )
                models_config_path = None
                if models_config is not None:
                    models_config_path = Path(temp_dir) / "models.config.json"
                    models_config_path.write_text(json.dumps(models_config), encoding="utf-8")
                env = {
                    **os.environ,
                    "PAPERCLIP_API_BASE": f"http://127.0.0.1:{server.server_port}/api",
                    "PAPERCLIP_COCKPIT_CONFIG": str(config_path),
                    "INNER_AGORA_STATE_PATH": str(state_path),
                    "INNER_AGORA_AUTO_RESTART_PAPERCLIP": "0",
                }
                if models_config_path:
                    env["INNER_AGORA_MODELS_CONFIG"] = str(models_config_path)
                env.pop("INNER_AGORA_MODE", None)
                result = subprocess.run(
                    ["node", str(AGORA_SCRIPT), "ask", question],
                    cwd=ROOT,
                    env=env,
                    text=True,
                    capture_output=True,
                    check=True,
                )
                state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {}
                return {
                    "stdout": result.stdout,
                    "issues": list(AskFlowHandler.created_issues),
                    "comments": list(AskFlowHandler.comments),
                    "wakeups": list(AskFlowHandler.wakeups),
                    "state": state,
                }
        finally:
            server.shutdown()
            server.server_close()

    def run_dry_ask(self, *args):
        env = {
            **os.environ,
            "INNER_AGORA_AUTO_RESTART_PAPERCLIP": "0",
        }
        env.pop("INNER_AGORA_MODE", None)
        return subprocess.run(
            ["node", str(AGORA_SCRIPT), "ask", "--dry-run", *args],
            cwd=ROOT,
            env=env,
            text=True,
            capture_output=True,
            check=True,
        )

    def run_philosopher_search(self, query):
        result = subprocess.run(
            ["node", str(AGORA_SCRIPT), "philosopher-search", "--json", query],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=True,
        )
        return json.loads(result.stdout)

    def run_role_proposal(self, query):
        result = subprocess.run(
            ["node", str(AGORA_SCRIPT), "role-proposal", "--json", "--limit", "4", "--no-architects", query],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=True,
        )
        return json.loads(result.stdout)

    def run_follow_up(self, root_ref, question):
        AskFlowHandler.reset()
        AskFlowHandler.created_issues.append(
            {
                "id": "root-1",
                "identifier": root_ref,
                "companyId": "company-1",
                "title": "Agora local: original question",
                "description": "Исходный вопрос:\noriginal question",
                "status": "todo",
            }
        )
        server = TestHTTPServer(("127.0.0.1", 0), AskFlowHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                config_path = Path(temp_dir) / "paperclip-cockpit.json"
                state_path = Path(temp_dir) / "state.json"
                config_path.write_text(
                    json.dumps({"agora": {"default_mode": "local"}, "cwd": temp_dir}),
                    encoding="utf-8",
                )
                env = {
                    **os.environ,
                    "PAPERCLIP_API_BASE": f"http://127.0.0.1:{server.server_port}/api",
                    "PAPERCLIP_COCKPIT_CONFIG": str(config_path),
                    "INNER_AGORA_STATE_PATH": str(state_path),
                    "INNER_AGORA_AUTO_RESTART_PAPERCLIP": "0",
                }
                result = subprocess.run(
                    ["node", str(AGORA_SCRIPT), "follow-up", root_ref, "--voices", "plato", question],
                    cwd=ROOT,
                    env=env,
                    text=True,
                    capture_output=True,
                    check=True,
                )
                return {
                    "stdout": result.stdout,
                    "issues": list(AskFlowHandler.created_issues),
                    "comments": list(AskFlowHandler.comments),
                    "wakeups": list(AskFlowHandler.wakeups),
                }
        finally:
            server.shutdown()
            server.server_close()

    def run_wizard_sequence(self):
        AskFlowHandler.reset()
        server = TestHTTPServer(("127.0.0.1", 0), AskFlowHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                config_path = Path(temp_dir) / "paperclip-cockpit.json"
                state_path = Path(temp_dir) / "state.json"
                config_path.write_text(
                    json.dumps({"agora": {"default_mode": "local"}, "cwd": temp_dir}),
                    encoding="utf-8",
                )
                env = {
                    **os.environ,
                    "PAPERCLIP_API_BASE": f"http://127.0.0.1:{server.server_port}/api",
                    "PAPERCLIP_COCKPIT_CONFIG": str(config_path),
                    "INNER_AGORA_STATE_PATH": str(state_path),
                    "INNER_AGORA_AUTO_RESTART_PAPERCLIP": "0",
                }
                outputs = []
                for command in [
                    ["wizard"],
                    ["wizard-answer", "что значит свобода у Сартра"],
                    ["wizard-answer", "philosophy"],
                    ["wizard-answer", "min"],
                    ["wizard-answer", "да"],
                ]:
                    result = subprocess.run(
                        ["node", str(AGORA_SCRIPT), *command],
                        cwd=ROOT,
                        env=env,
                        text=True,
                        capture_output=True,
                        check=True,
                    )
                    outputs.append(result.stdout)
                return {
                    "stdout": "\n".join(outputs),
                    "issues": list(AskFlowHandler.created_issues),
                    "comments": list(AskFlowHandler.comments),
                    "wakeups": list(AskFlowHandler.wakeups),
                }
        finally:
            server.shutdown()
            server.server_close()

    def run_dialogue_context(self):
        AskFlowHandler.reset()
        AskFlowHandler.created_issues.extend(
            [
                {
                    "id": "root-1",
                    "identifier": "THE-900",
                    "companyId": "company-1",
                    "title": "Agora min: freedom",
                    "description": "Исходный вопрос:\nчто значит свобода у Сартра",
                    "status": "done",
                },
                {
                    "id": "synthesis-1",
                    "identifier": "THE-999",
                    "companyId": "company-1",
                    "title": "Синтез: Agora min: freedom",
                    "description": "Synthesis task",
                    "parentId": "root-1",
                    "assigneeAgentId": "assistant-1",
                    "status": "done",
                },
            ]
        )
        AskFlowHandler.issue_comments["synthesis-1"] = [
            {
                "id": "comment-synth",
                "authorType": "agent",
                "createdAt": "2026-07-02T09:30:00.000Z",
                "body": "\n".join(
                    [
                        "1. Реальный вопрос сессии.",
                        "",
                        "Свобода у Сартра после возражений.",
                        "",
                        "2. Участники и их позиции.",
                        "",
                        "- Сартр: свобода как ответственность.",
                        "- Хайдеггер: вопрос свободы связан с бытием-в-мире.",
                        "",
                        "3. Главные линии конфликта.",
                        "",
                        "- Свобода как выбор против свободы как раскрытие.",
                    ]
                ),
            }
        ]
        server = TestHTTPServer(("127.0.0.1", 0), AskFlowHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                config_path = Path(temp_dir) / "paperclip-cockpit.json"
                state_path = Path(temp_dir) / "state.json"
                config_path.write_text(
                    json.dumps({"agora": {"default_mode": "local"}, "cwd": temp_dir}),
                    encoding="utf-8",
                )
                env = {
                    **os.environ,
                    "PAPERCLIP_API_BASE": f"http://127.0.0.1:{server.server_port}/api",
                    "PAPERCLIP_COCKPIT_CONFIG": str(config_path),
                    "INNER_AGORA_STATE_PATH": str(state_path),
                    "INNER_AGORA_AUTO_RESTART_PAPERCLIP": "0",
                }
                result = subprocess.run(
                    [
                        "node",
                        str(AGORA_SCRIPT),
                        "dialogue-context",
                        "THE-900",
                        "heidegger",
                        "А что бы Хайдеггер ответил на второе возражение?",
                    ],
                    cwd=ROOT,
                    env=env,
                    text=True,
                    capture_output=True,
                )
                return {
                    "returncode": result.returncode,
                    "stderr": result.stderr,
                    "stdout": result.stdout,
                    "issues": list(AskFlowHandler.created_issues),
                    "comments": list(AskFlowHandler.comments),
                    "wakeups": list(AskFlowHandler.wakeups),
                }
        finally:
            server.shutdown()
            server.server_close()

    def run_latest_with_adapter_metadata(self):
        AskFlowHandler.reset()
        AskFlowHandler.created_issues.append(
            {
                "id": "root-1",
                "identifier": "THE-900",
                "companyId": "company-1",
                "title": "Agora local: freedom",
                "description": "Исходный вопрос:\nчто значит свобода",
                "status": "todo",
                "createdAt": "2026-07-02T09:00:00.000Z",
                "updatedAt": "2026-07-02T09:10:00.000Z",
                "metadata": {
                    "innerAgora": {
                        "adapter": {
                            "name": "hermes_local",
                            "model": "test/hermes-local",
                            "reason": "localMode",
                            "riskTier": "reflective",
                        }
                    }
                },
            }
        )
        server = TestHTTPServer(("127.0.0.1", 0), AskFlowHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                config_path = Path(temp_dir) / "paperclip-cockpit.json"
                state_path = Path(temp_dir) / "state.json"
                config_path.write_text(
                    json.dumps({"agora": {"default_mode": "local"}, "cwd": temp_dir}),
                    encoding="utf-8",
                )
                env = {
                    **os.environ,
                    "PAPERCLIP_API_BASE": f"http://127.0.0.1:{server.server_port}/api",
                    "PAPERCLIP_COCKPIT_CONFIG": str(config_path),
                    "INNER_AGORA_STATE_PATH": str(state_path),
                    "INNER_AGORA_AUTO_RESTART_PAPERCLIP": "0",
                }
                result = subprocess.run(
                    ["node", str(AGORA_SCRIPT), "latest", "THE-900"],
                    cwd=ROOT,
                    env=env,
                    text=True,
                    capture_output=True,
                    check=True,
                )
                state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {}
                return {"stdout": result.stdout, "state": state}
        finally:
            server.shutdown()
            server.server_close()

    def run_status_with_adapter_state(self):
        AskFlowHandler.reset()
        server = TestHTTPServer(("127.0.0.1", 0), AskFlowHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                config_path = Path(temp_dir) / "paperclip-cockpit.json"
                state_path = Path(temp_dir) / "state.json"
                config_path.write_text(
                    json.dumps({"agora": {"default_mode": "local"}, "cwd": temp_dir}),
                    encoding="utf-8",
                )
                state_path.write_text(
                    json.dumps(
                        {
                            "lastAdapterName": "hermes_local",
                            "lastAdapterModel": "test/hermes-local",
                            "lastAdapterReason": "localMode",
                            "lastAdapterRiskTier": "reflective",
                        }
                    ),
                    encoding="utf-8",
                )
                env = {
                    **os.environ,
                    "PAPERCLIP_API_BASE": f"http://127.0.0.1:{server.server_port}/api",
                    "PAPERCLIP_COCKPIT_CONFIG": str(config_path),
                    "INNER_AGORA_STATE_PATH": str(state_path),
                    "INNER_AGORA_AUTO_RESTART_PAPERCLIP": "0",
                }
                result = subprocess.run(
                    ["node", str(AGORA_SCRIPT), "status"],
                    cwd=ROOT,
                    env=env,
                    text=True,
                    capture_output=True,
                    check=True,
                )
                return result.stdout
        finally:
            server.shutdown()
            server.server_close()

    def test_ask_creates_durable_work_and_returns_immediate_monitor_ack(self):
        result = self.run_ask("давай спросим агору про свободу ребенка и власть родителей")
        stdout = result["stdout"]

        self.assertIn("# Поставил вопрос в Агору: THE-900", stdout)
        self.assertIn("Выбрал 5 голосов:", stdout)
        self.assertIn("Напишу сюда, когда будет готов синтез.", stdout)
        self.assertIn("Дальше автоматически: monitor запустит синтез", stdout)
        self.assertNotIn("Next: node scripts/agora.mjs synthesize", stdout)

        self.assertEqual(len(result["issues"]), 6)
        root, *children = result["issues"]
        self.assertEqual(root["title"].split(":", 1)[0], "Agora local")
        self.assertTrue(all(child["parentId"] == "root-1" for child in children))
        self.assertEqual(len(result["wakeups"]), 5)

        self.assertEqual(len(result["comments"]), 1)
        comment = result["comments"][0]["body"]
        self.assertIn("Paperclip cockpit monitor запустит синтез", comment)
        self.assertIn("Telegram получит итог с кнопками", comment)
        self.assertNotIn("Когда ответы будут готовы:", comment)

    def test_ask_records_adapter_route_on_root_comment_stdout_and_state(self):
        result = self.run_ask(
            "давай спросим агору про свободу ребенка и власть родителей",
            models_config=self.custom_models_config(),
        )
        root = result["issues"][0]
        comment = result["comments"][0]["body"]
        state = result["state"]

        self.assertIn("Маршрут: hermes_local", result["stdout"])
        self.assertIn("model=test/hermes-local", result["stdout"])
        self.assertEqual(root["metadata"]["innerAgora"]["adapter"]["name"], "hermes_local")
        self.assertEqual(root["metadata"]["innerAgora"]["adapter"]["model"], "test/hermes-local")
        self.assertEqual(root["metadata"]["innerAgora"]["adapter"]["reason"], "localMode")
        self.assertIn("Маршрут модели:", comment)
        self.assertIn("adapter=hermes_local", comment)
        self.assertIn("reason=localMode", comment)
        self.assertEqual(state["lastAdapterName"], "hermes_local")
        self.assertEqual(state["lastAdapterModel"], "test/hermes-local")
        self.assertEqual(state["lastAdapterReason"], "localMode")

    def test_follow_up_creates_child_task_against_existing_root(self):
        result = self.run_follow_up("THE-900", "уточни у Платона понятие долга")

        self.assertIn("Продолжаю в контексте THE-900", result["stdout"])
        self.assertEqual(len(result["issues"]), 2)
        child = result["issues"][1]
        self.assertEqual(child["parentId"], "root-1")
        self.assertEqual(child["assigneeAgentId"], "plato-1")
        self.assertIn("уточни у Платона понятие долга", child["description"])
        self.assertEqual(result["wakeups"][0]["agentId"], "plato-1")

    def test_dry_ask_resolves_short_sartre_token(self):
        result = self.run_dry_ask("--philosophers", "Сартр", "что такое свобода")

        self.assertIn("voices=Жан-Поль Сартр", result.stdout)

    def test_dry_ask_honors_pair_voice_limit(self):
        result = self.run_dry_ask("--max", "разбери у пары философов как заботу не превратить в контроль")
        voices_line = next(line for line in result.stdout.splitlines() if line.startswith("voices="))
        voices = [item.strip() for item in voices_line.removeprefix("voices=").split(",") if item.strip()]

        self.assertEqual(len(voices), 2)

    def test_dry_fast_ask_stays_within_two_or_three_philosophers(self):
        pair = self.run_dry_ask("--min", "пару философов про свободу")
        pair_line = next(line for line in pair.stdout.splitlines() if line.startswith("voices="))
        pair_voices = [item.strip() for item in pair_line.removeprefix("voices=").split(",") if item.strip()]
        self.assertEqual(len(pair_voices), 2)

        fast = self.run_dry_ask("--min", "быстрый совет про заботу и контроль")
        fast_line = next(line for line in fast.stdout.splitlines() if line.startswith("voices="))
        fast_voices = [item.strip() for item in fast_line.removeprefix("voices=").split(",") if item.strip()]
        self.assertLessEqual(len(fast_voices), 3)

    def test_philosopher_search_supports_russian_english_and_close_aliases(self):
        english = self.run_philosopher_search("Aristotle")
        self.assertEqual(english["selected"]["key"], "aristotle")
        self.assertEqual(english["selected"]["name"], "Аристотель")

        russian_case = self.run_philosopher_search("Аристотеля")
        self.assertEqual(russian_case["selected"]["key"], "aristotle")

    def test_philosopher_search_returns_up_to_three_closest_matches(self):
        payload = self.run_philosopher_search("Аристотелл")
        self.assertIsNone(payload["selected"])
        self.assertLessEqual(len(payload["matches"]), 3)
        self.assertEqual(payload["matches"][0]["key"], "aristotle")

    def test_role_proposal_returns_four_structured_candidates(self):
        payload = self.run_role_proposal("свобода взрослого ребенка")

        self.assertEqual(payload["topic"], "свобода взрослого ребенка")
        self.assertEqual(len(payload["roles"]), 4)
        for role in payload["roles"]:
            self.assertIn("key", role)
            self.assertIn("name", role)
            self.assertIn("reason", role)
            self.assertTrue(role["reason"])

    def test_wizard_confirmation_creates_same_session_as_direct_ask(self):
        result = self.run_wizard_sequence()

        self.assertIn("Какой вопрос", result["stdout"])
        self.assertIn("Запускать?", result["stdout"])
        self.assertIn("Поставил вопрос в Агору: THE-900", result["stdout"])
        self.assertEqual(len(result["issues"]), 4)
        root, *children = result["issues"]
        self.assertEqual(root["title"].split(":", 1)[0], "Agora min")
        self.assertIn("что значит свобода у Сартра", root["description"])
        self.assertTrue(all(child["parentId"] == "root-1" for child in children))
        self.assertEqual(len(result["wakeups"]), 3)

    def test_dialogue_context_creates_role_child_with_synthesis_digest(self):
        result = self.run_dialogue_context()

        self.assertEqual(result["returncode"], 0, result["stderr"])
        self.assertIn("Создан контекстный диалог", result["stdout"])
        self.assertEqual(len(result["issues"]), 3)
        child = result["issues"][2]
        self.assertEqual(child["parentId"], "root-1")
        self.assertEqual(child["assigneeAgentId"], "heidegger-1")
        self.assertIn("А что бы Хайдеггер ответил", child["description"])
        self.assertIn("Выжимка синтеза", child["description"])
        self.assertIn("Сартр: свобода как ответственность", child["description"])
        self.assertEqual(result["wakeups"][0]["agentId"], "heidegger-1")

    def test_latest_prints_adapter_metadata_from_root_issue(self):
        result = self.run_latest_with_adapter_metadata()

        self.assertIn("## Маршрут модели", result["stdout"])
        self.assertIn("adapter=hermes_local", result["stdout"])
        self.assertIn("model=test/hermes-local", result["stdout"])
        self.assertEqual(result["state"]["lastAdapterName"], "hermes_local")
        self.assertEqual(result["state"]["lastAdapterModel"], "test/hermes-local")

    def test_status_prints_last_adapter_route_from_state(self):
        stdout = self.run_status_with_adapter_state()

        self.assertIn("Последний маршрут модели:", stdout)
        self.assertIn("adapter=hermes_local", stdout)
        self.assertIn("model=test/hermes-local", stdout)


if __name__ == "__main__":
    unittest.main()
