import json
import os
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
IMPORT_SCRIPT = ROOT / "scripts" / "import-inner-agora.mjs"


class ImportHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    patches = []

    company = {"id": "company-1", "name": "The Inner Agora", "status": "active", "issuePrefix": "THE"}
    assistant = {
        "id": "assistant-1",
        "companyId": "company-1",
        "name": "Agora Assistant / Синтезатор",
        "status": "idle",
        "reportsTo": None,
        "adapterType": "codex_local",
        "adapterConfig": {"model": "gpt-5.4"},
        "metadata": {"source": "inner-agora-import", "roleKey": "agora-assistant"},
    }
    heidegger = {
        "id": "heidegger-1",
        "companyId": "company-1",
        "name": "Хайдеггер",
        "status": "error",
        "reportsTo": "missing-manager",
        "adapterType": "codex_local",
        "adapterConfig": {"model": "gpt-5.4"},
        "metadata": {"source": "inner-agora-import", "roleKey": "heidegger"},
    }

    @classmethod
    def reset(cls):
        cls.patches = []
        cls.assistant = {**cls.assistant, "reportsTo": None, "status": "idle"}
        cls.heidegger = {**cls.heidegger, "reportsTo": "missing-manager", "status": "error"}

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
            "/api/health": {"ok": True},
            "/api/companies": [self.company],
            "/api/companies/company-1/agents": [self.assistant, self.heidegger],
            "/api/companies/company-1/goals": [
                {"id": "goal-1", "title": "Run philosophical research dialogues with The Inner Agora"}
            ],
            "/api/companies/company-1/projects": [{"id": "project-1", "name": "Agora Sessions"}],
            "/api/projects/project-1/workspaces": [
                {
                    "id": "workspace-1",
                    "name": "Inner Agora Agent Workspace",
                    "sourceType": "local_path",
                    "cwd": os.environ.get("TEST_AGENT_WORKSPACE", ""),
                    "visibility": "default",
                    "isPrimary": True,
                }
            ],
            "/api/companies/company-1/org": {"nodes": []},
        }
        self.send_json(routes.get(self.path, {"error": "not found", "path": self.path}), 200 if self.path in routes else 404)

    def do_PATCH(self):
        payload = self.read_json_body()
        self.patches.append({"path": self.path, "payload": payload})
        if self.path == "/api/agents/assistant-1":
            self.assistant.update(payload)
            self.send_json(self.assistant)
            return
        if self.path == "/api/agents/heidegger-1":
            self.heidegger.update(payload)
            self.send_json(self.heidegger)
            return
        if self.path.endswith("/instructions-bundle"):
            self.send_json({"ok": True})
            return
        self.send_json({"ok": True})

    def do_PUT(self):
        self.patches.append({"path": self.path, "payload": self.read_json_body()})
        self.send_json({"ok": True})

    def log_message(self, *_):
        return


class TestHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False


class ImportInnerAgoraSyncTests(unittest.TestCase):
    def test_existing_agent_sync_reassigns_reports_to_active_assistant(self):
        ImportHandler.reset()
        server = TestHTTPServer(("127.0.0.1", 0), ImportHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                temp = Path(temp_dir)
                chambers = temp / "chambers"
                philosophy = chambers / "philosophy"
                philosophy.mkdir(parents=True)
                (philosophy / "chamber.json").write_text(
                    json.dumps(
                        {
                            "id": "philosophy",
                            "name": "The Inner Agora",
                            "description": "Test chamber",
                            "status": "active",
                            "riskTier": "reflective",
                            "labels": {
                                "company": "agora",
                                "companies": "agoras",
                                "agent": "philosopher",
                                "agents": "philosophers",
                                "task": "session",
                                "tasks": "sessions",
                            },
                            "roles": ["roles.json"],
                            "presets": [],
                            "synthesisRole": "agora-assistant",
                            "transparencyPolicy": "source-citation",
                            "allowedSkills": ["source-citation"],
                            "company": {
                                "name": "The Inner Agora",
                                "projectName": "Agora Sessions",
                                "goalTitle": "Run philosophical research dialogues with The Inner Agora",
                                "companyId": None,
                            },
                        }
                    ),
                    encoding="utf-8",
                )
                (philosophy / "roles.json").write_text(
                    json.dumps(
                        [
                            {
                                "key": "heidegger",
                                "name": "Хайдеггер",
                                "era": "XX век",
                                "title": "бытие, язык и техника",
                                "aliases": ["heidegger", "хайдеггер"],
                                "tags": ["being"],
                                "centralIntuition": "Вопрос о бытии первичен.",
                                "voice": "Плотный и этимологический.",
                                "tension": "Риск тумана.",
                                "chamberId": "philosophy",
                                "riskTier": "reflective",
                            }
                        ],
                        ensure_ascii=False,
                    ),
                    encoding="utf-8",
                )

                env = {
                    **os.environ,
                    "PAPERCLIP_API_BASE": f"http://127.0.0.1:{server.server_port}/api",
                    "INNER_AGORA_CHAMBERS_DIR": str(chambers),
                    "INNER_AGORA_AGENT_ADAPTER": "hermes_local",
                    "INNER_AGORA_PAPERCLIP_AGENT_WORKSPACE": str(temp / "workspace"),
                    "TEST_AGENT_WORKSPACE": str(temp / "workspace"),
                }
                result = subprocess.run(
                    ["node", str(IMPORT_SCRIPT)],
                    cwd=ROOT,
                    env=env,
                    text=True,
                    capture_output=True,
                    timeout=60,
                )

        finally:
            server.shutdown()
            server.server_close()

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        agent_patch = next(item for item in ImportHandler.patches if item["path"] == "/api/agents/heidegger-1")
        self.assertEqual(agent_patch["payload"]["reportsTo"], "assistant-1")
        self.assertEqual(agent_patch["payload"]["adapterType"], "hermes_local")
        self.assertEqual(agent_patch["payload"]["status"], "idle")


if __name__ == "__main__":
    unittest.main()
