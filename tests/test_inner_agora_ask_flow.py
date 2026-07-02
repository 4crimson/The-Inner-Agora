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
    wakeups = []

    @classmethod
    def reset(cls):
        cls.created_issues = []
        cls.comments = []
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
        }
        if self.path in routes:
            self.send_json(routes[self.path])
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

        if self.path == "/api/issues/root-1/comments":
            self.comments.append(payload)
            self.send_json({"id": f"comment-{len(self.comments)}", **payload}, 201)
            return

        self.send_json({"error": "not found", "path": self.path}, 404)

    def log_message(self, *_):
        return


class TestHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False


class InnerAgoraAskFlowTests(unittest.TestCase):
    def run_ask(self, question):
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
                env.pop("INNER_AGORA_MODE", None)
                result = subprocess.run(
                    ["node", str(AGORA_SCRIPT), "ask", question],
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

    def test_follow_up_creates_child_task_against_existing_root(self):
        result = self.run_follow_up("THE-900", "уточни у Платона понятие долга")

        self.assertIn("Продолжаю в контексте THE-900", result["stdout"])
        self.assertEqual(len(result["issues"]), 2)
        child = result["issues"][1]
        self.assertEqual(child["parentId"], "root-1")
        self.assertEqual(child["assigneeAgentId"], "plato-1")
        self.assertIn("уточни у Платона понятие долга", child["description"])
        self.assertEqual(result["wakeups"][0]["agentId"], "plato-1")

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


if __name__ == "__main__":
    unittest.main()
