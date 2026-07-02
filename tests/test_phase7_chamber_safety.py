import http.server
import json
import os
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHAMBER_SCHEMA = ROOT / "data" / "schema" / "chamber.schema.json"
BOARD_CHAMBER = ROOT / "chambers" / "board-directors" / "chamber.json"
SKILL_LOADER = ROOT / "scripts" / "skill-loader.mjs"
POLICY_LOADER = ROOT / "scripts" / "policy-loader.mjs"
AGORA_SCRIPT = ROOT / "scripts" / "agora.mjs"
IMPORT_SCRIPT = ROOT / "scripts" / "import-inner-agora.mjs"


def write_high_stakes_chamber(chambers_dir):
    chamber_dir = Path(chambers_dir) / "clinic"
    chamber_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "id": "clinic",
        "name": "Clinic Review",
        "description": "Temporary high-stakes chamber for safety tests.",
        "status": "research-only",
        "riskTier": "high-stakes",
        "labels": {
            "company": "clinic",
            "companies": "clinics",
            "agent": "reviewer",
            "agents": "reviewers",
            "task": "case",
            "tasks": "cases",
        },
        "roles": ["roles.json"],
        "presets": ["presets/mvp.json"],
        "synthesisRole": "reviewer",
        "transparencyPolicy": "source-citation",
        "allowedSkills": ["source-citation", "high-stakes-disclaimer"],
        "company": {
            "name": "Clinic Review",
            "projectName": "Clinic Review Sessions",
            "goalTitle": "Run high-stakes safety reviews",
            "companyId": None,
        },
    }
    (chamber_dir / "chamber.json").write_text(json.dumps(manifest), encoding="utf-8")
    (chamber_dir / "roles.json").write_text(
        json.dumps(
            [
                {
                    "key": "reviewer",
                    "name": "Clinical Reviewer",
                    "englishName": "Clinical Reviewer",
                    "era": "High-Stakes Review",
                    "title": "clinical safety framing and escalation",
                    "aliases": ["reviewer", "clinical reviewer"],
                    "tags": ["health", "safety", "dosage"],
                    "centralIntuition": "High-stakes questions need cautious framing, missing data, and escalation paths.",
                    "voice": "Careful, explicit about uncertainty, avoids instructions that could cause harm.",
                    "tension": "May be too cautious when the user only needs a general information frame.",
                    "chamberId": "clinic",
                    "riskTier": "high-stakes",
                    "skills": ["source-citation"],
                }
            ]
        ),
        encoding="utf-8",
    )
    (chamber_dir / "presets").mkdir()
    (chamber_dir / "presets" / "mvp.json").write_text(
        json.dumps({"id": "mvp", "name": "Clinic MVP", "roleKeys": ["reviewer"]}),
        encoding="utf-8",
    )
    return manifest


class Phase7PaperclipHandler(http.server.BaseHTTPRequestHandler):
    created_issues = []
    comments = []
    wakeups = []

    @classmethod
    def reset(cls):
        cls.created_issues = []
        cls.comments = []
        cls.wakeups = []

    def log_message(self, *_args):
        return

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        routes = {
            "/api/companies": [{"id": "company-1", "name": "Clinic Review", "status": "active"}],
            "/api/companies/company-1/agents": [
                {"id": "assistant-1", "name": "Agora Assistant / Синтезатор", "status": "idle"},
                {"id": "reviewer-1", "name": "Clinical Reviewer", "status": "idle"},
            ],
            "/api/companies/company-1/projects": [{"id": "project-1", "name": "Clinic Review Sessions"}],
            "/api/companies/company-1/goals": [{"id": "goal-1", "title": "Run high-stakes safety reviews"}],
        }
        if self.path not in routes:
            self.send_json({"error": "not found"}, 404)
            return
        self.send_json(routes[self.path])

    def do_POST(self):
        length = int(self.headers.get("content-length", "0"))
        payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        if self.path == "/api/companies/company-1/issues":
            index = len(self.created_issues)
            issue = {
                **payload,
                "id": "root-1" if index == 0 else f"child-{index}",
                "identifier": "CLI-900" if index == 0 else f"CLI-90{index}",
                "companyId": "company-1",
            }
            self.created_issues.append(issue)
            self.send_json(issue, 201)
            return
        if self.path == "/api/agents/reviewer-1/wakeup":
            self.wakeups.append(payload)
            self.send_json({"id": "run-1", "status": "queued"}, 202)
            return
        if self.path == "/api/issues/root-1/comments":
            self.comments.append(payload)
            self.send_json({"id": "comment-1", **payload}, 201)
            return
        self.send_json({"error": "not found"}, 404)


def start_phase7_server():
    Phase7PaperclipHandler.reset()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Phase7PaperclipHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread, f"http://127.0.0.1:{server.server_port}/api"


class Phase7ChamberSafetyTests(unittest.TestCase):
    def run_node(self, *args, env=None):
        return subprocess.run(
            ["node", *map(str, args)],
            cwd=ROOT,
            env={**os.environ, **(env or {})},
            text=True,
            capture_output=True,
        )

    def test_chamber_schema_allows_research_only_and_risk_tier(self):
        schema = json.loads(CHAMBER_SCHEMA.read_text(encoding="utf-8"))

        self.assertIn("research-only", schema["properties"]["status"]["enum"])
        self.assertEqual(schema["properties"]["riskTier"]["enum"], ["reflective", "advisory", "high-stakes"])

    def test_board_chamber_is_research_only_with_business_policy(self):
        chamber = json.loads(BOARD_CHAMBER.read_text(encoding="utf-8"))

        self.assertEqual(chamber["status"], "research-only")
        self.assertEqual(chamber["riskTier"], "advisory")
        self.assertEqual(chamber["transparencyPolicy"], "business-advisory-transparency")
        self.assertIn("business-advisory-transparency", chamber["allowedSkills"])

    def test_policy_skills_are_installed(self):
        result = self.run_node(SKILL_LOADER, "list", "--json")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        ids = sorted(item["id"] for item in payload["skills"])
        self.assertIn("business-advisory-transparency", ids)
        self.assertIn("high-stakes-disclaimer", ids)

    def test_board_policy_command_outputs_business_language(self):
        result = self.run_node(POLICY_LOADER, "compose", "board-directors")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Протокол прозрачности для advisory-мемо", result.stdout)
        self.assertIn("условия решения", result.stdout)
        self.assertNotIn("Имитация голоса", result.stdout)

    def test_high_stakes_policy_appends_mandatory_disclaimer(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            write_high_stakes_chamber(temp_dir)
            result = self.run_node(POLICY_LOADER, "compose", "clinic", "--chambers-dir", temp_dir)

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Обязательный high-stakes дисклеймер", result.stdout)
        self.assertIn("не является медицинской, юридической или финансовой рекомендацией", result.stdout)

    def test_high_stakes_agora_child_prompt_includes_disclaimer(self):
        server, thread, api_base = start_phase7_server()
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                write_high_stakes_chamber(temp_dir)
                result = self.run_node(
                    AGORA_SCRIPT,
                    "ask",
                    "--min",
                    "--philosophers",
                    "reviewer",
                    "Можно ли менять дозировку лекарства?",
                    env={
                        "INNER_AGORA_CHAMBERS_DIR": temp_dir,
                        "INNER_AGORA_ACTIVE_CHAMBER": "clinic",
                        "INNER_AGORA_STATE_PATH": str(Path(temp_dir) / "state.json"),
                        "PAPERCLIP_API_BASE": api_base,
                        "INNER_AGORA_AUTO_RESTART_PAPERCLIP": "0",
                    },
                )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=1)

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        children = [issue for issue in Phase7PaperclipHandler.created_issues if issue.get("parentId") == "root-1"]
        self.assertEqual(len(children), 1)
        description = children[0]["description"]
        self.assertIn("Обязательный high-stakes дисклеймер", description)
        self.assertIn("не является медицинской, юридической или финансовой рекомендацией", description)

    def test_importer_role_instructions_use_composed_policy(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            write_high_stakes_chamber(temp_dir)
            result = self.run_node(
                IMPORT_SCRIPT,
                "--print-role-instructions",
                "reviewer",
                env={
                    "INNER_AGORA_CHAMBERS_DIR": temp_dir,
                    "INNER_AGORA_ACTIVE_CHAMBER": "clinic",
                    "INNER_AGORA_STATE_PATH": str(Path(temp_dir) / "state.json"),
                },
            )

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Протокол прозрачности", result.stdout)
        self.assertIn("Обязательный high-stakes дисклеймер", result.stdout)
        self.assertIn("не является медицинской, юридической или финансовой рекомендацией", result.stdout)
        self.assertIn("палате \"Clinic Review\"", result.stdout)
        self.assertNotIn("философская машина", result.stdout)


if __name__ == "__main__":
    unittest.main()
