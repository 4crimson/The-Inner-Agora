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
PHILOSOPHY_CHAMBER = ROOT / "chambers" / "philosophy" / "chamber.json"
CHAMBER_LOADER = ROOT / "scripts" / "chamber-loader.mjs"
COCKPIT_CONFIG = ROOT / "paperclip-cockpit.json"
BOARD_CHAMBER = ROOT / "chambers" / "board-directors" / "chamber.json"
BOARD_ROLES = ROOT / "chambers" / "board-directors" / "roles.json"


def write_test_chamber(chambers_dir, chamber_id="strategy"):
    chamber_dir = Path(chambers_dir) / chamber_id
    chamber_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "id": chamber_id,
        "name": "Strategy Room",
        "description": "Temporary strategy chamber for tests.",
        "status": "active",
        "labels": {
            "company": "room",
            "companies": "rooms",
            "agent": "advisor",
            "agents": "advisors",
            "task": "decision",
            "tasks": "decisions",
        },
        "roles": ["roles.json"],
        "presets": ["presets/mvp.json"],
        "synthesisRole": "strategy-assistant",
        "transparencyPolicy": "test-policy",
        "allowedSkills": [],
        "company": {
            "name": "Strategy Room Company",
            "projectName": "Strategy Room Sessions",
            "goalTitle": "Run strategy room decisions",
            "companyId": None,
        },
    }
    (chamber_dir / "chamber.json").write_text(json.dumps(manifest), encoding="utf-8")
    (chamber_dir / "roles.json").write_text(
        json.dumps(
            [
                {
                    "key": "advisor",
                    "name": "Strategy Advisor",
                    "englishName": "Strategy Advisor",
                    "era": "Test",
                    "title": "test advisor",
                    "aliases": ["advisor"],
                    "tags": ["strategy"],
                    "centralIntuition": "Test intuition.",
                    "voice": "Test voice.",
                    "tension": "Test tension.",
                    "chamberId": chamber_id,
                    "riskTier": "advisory",
                }
            ]
        ),
        encoding="utf-8",
    )
    (chamber_dir / "presets").mkdir()
    (chamber_dir / "presets" / "mvp.json").write_text(
        json.dumps({"id": "mvp", "name": "Test MVP", "roleKeys": ["advisor"]}),
        encoding="utf-8",
    )
    return manifest


def start_json_api(routes):
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_args):
            return

        def do_GET(self):
            if self.path not in routes:
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b'{"error":"not found"}')
                return
            payload = json.dumps(routes[self.path]).encode("utf-8")
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread, f"http://127.0.0.1:{server.server_port}/api"


class Phase2ChamberTests(unittest.TestCase):
    def run_node(self, *args, env=None):
        return subprocess.run(
            ["node", *map(str, args)],
            cwd=ROOT,
            env={**os.environ, **(env or {})},
            text=True,
            capture_output=True,
        )

    def test_chamber_schema_contract(self):
        schema = json.loads(CHAMBER_SCHEMA.read_text(encoding="utf-8"))

        self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertEqual(schema["title"], "Inner Agora Chamber Manifest")
        self.assertEqual(schema["type"], "object")
        self.assertFalse(schema["additionalProperties"])

        required = set(schema["required"])
        for field in [
            "id",
            "name",
            "description",
            "status",
            "labels",
            "roles",
            "presets",
            "synthesisRole",
            "transparencyPolicy",
            "allowedSkills",
            "company",
        ]:
            self.assertIn(field, required)

        self.assertIn("agent", schema["properties"]["labels"]["required"])
        self.assertIn("agents", schema["properties"]["labels"]["required"])
        self.assertIn("companyId", schema["properties"]["company"]["required"])

    def test_philosophy_chamber_manifest_points_at_phase1_roles(self):
        chamber = json.loads(PHILOSOPHY_CHAMBER.read_text(encoding="utf-8"))

        self.assertEqual(chamber["id"], "philosophy")
        self.assertEqual(chamber["status"], "active")
        self.assertEqual(chamber["roles"], ["roles.json"])
        self.assertEqual(chamber["presets"], ["presets/mvp.json"])
        self.assertEqual(chamber["synthesisRole"], "agora-assistant")
        self.assertEqual(chamber["labels"]["agent"], "philosopher")
        self.assertEqual(chamber["labels"]["agents"], "philosophers")

    def test_chamber_loader_lists_philosophy(self):
        result = self.run_node(CHAMBER_LOADER, "list", "--json")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        self.assertIn("philosophy", [item["id"] for item in payload["chambers"]])

    def test_chamber_loader_rejects_manifest_missing_required_field(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            chamber_dir = Path(temp_dir) / "broken"
            chamber_dir.mkdir()
            (chamber_dir / "chamber.json").write_text(json.dumps({"id": "broken"}), encoding="utf-8")

            result = self.run_node(CHAMBER_LOADER, "validate", "--chambers-dir", temp_dir)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing required field", result.stderr)
        self.assertIn("name", result.stderr)

    def test_chamber_loader_deep_merge_replaces_arrays(self):
        result = self.run_node(CHAMBER_LOADER, "merge-fixture", "--json")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["allowedSkills"], ["source-citation"])
        self.assertEqual(payload["labels"]["agent"], "director")
        self.assertEqual(payload["labels"]["tasks"], "sessions")

    def test_merged_philosophy_cockpit_matches_current_config(self):
        result = self.run_node(CHAMBER_LOADER, "cockpit", "philosophy", "--json")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        merged = json.loads(result.stdout)
        current = json.loads(COCKPIT_CONFIG.read_text(encoding="utf-8"))
        self.assertEqual(merged, current)

    def test_agora_chamber_list_shows_philosophy(self):
        result = self.run_node(ROOT / "scripts" / "agora.mjs", "chamber", "list")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("philosophy", result.stdout)
        self.assertIn("The Inner Agora", result.stdout)

    def test_agora_chamber_use_persists_active_chamber(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "state.json"
            result = self.run_node(
                ROOT / "scripts" / "agora.mjs",
                "chamber",
                "use",
                "philosophy",
                env={"INNER_AGORA_STATE_PATH": str(state_path)},
            )

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            payload = json.loads(state_path.read_text(encoding="utf-8"))

        self.assertEqual(payload["activeChamberId"], "philosophy")
        self.assertIn("Активная палата: philosophy", result.stdout)

    def test_agora_chamber_current_prefers_environment(self):
        result = self.run_node(
            ROOT / "scripts" / "agora.mjs",
            "chamber",
            "current",
            env={"INNER_AGORA_ACTIVE_CHAMBER": "philosophy"},
        )

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("activeChamberId=philosophy", result.stdout)

    def test_status_prints_active_chamber_before_paperclip_api(self):
        result = self.run_node(
            ROOT / "scripts" / "agora.mjs",
            "status",
            env={
                "INNER_AGORA_ACTIVE_CHAMBER": "philosophy",
                "PAPERCLIP_API_BASE": "http://127.0.0.1:9/api",
                "INNER_AGORA_AUTO_RESTART_PAPERCLIP": "0",
            },
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("activeChamberId=philosophy", result.stdout)

    def test_status_uses_active_chamber_company_config(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            write_test_chamber(temp_dir)
            server, thread, api_base = start_json_api({"/api/companies": []})
            try:
                result = self.run_node(
                    ROOT / "scripts" / "agora.mjs",
                    "status",
                    env={
                        "INNER_AGORA_CHAMBERS_DIR": temp_dir,
                        "INNER_AGORA_ACTIVE_CHAMBER": "strategy",
                        "PAPERCLIP_API_BASE": api_base,
                        "INNER_AGORA_AUTO_RESTART_PAPERCLIP": "0",
                    },
                )
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=1)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("activeChamberId=strategy", result.stdout)
        self.assertIn("Company not found: Strategy Room Company", result.stderr)

    def test_importer_prints_active_chamber_company_config(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            write_test_chamber(temp_dir)
            result = self.run_node(
                ROOT / "scripts" / "import-inner-agora.mjs",
                "--print-chamber-config",
                env={
                    "INNER_AGORA_CHAMBERS_DIR": temp_dir,
                    "INNER_AGORA_ACTIVE_CHAMBER": "strategy",
                },
            )

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("activeChamberId=strategy", result.stdout)
        self.assertIn("companyName=Strategy Room Company", result.stdout)
        self.assertIn("projectName=Strategy Room Sessions", result.stdout)
        self.assertIn("goalTitle=Run strategy room decisions", result.stdout)

    def test_chamber_loader_lists_board_directors(self):
        result = self.run_node(CHAMBER_LOADER, "list", "--json")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        self.assertIn("board-directors", [item["id"] for item in payload["chambers"]])

    def test_board_directors_roles_are_research_only_but_valid(self):
        chamber = json.loads(BOARD_CHAMBER.read_text(encoding="utf-8"))
        roles = json.loads(BOARD_ROLES.read_text(encoding="utf-8"))

        self.assertEqual(chamber["status"], "research-only")
        self.assertGreaterEqual(len(roles), 3)
        self.assertTrue(all(role["chamberId"] == "board-directors" for role in roles))
        self.assertTrue(all(role["riskTier"] == "advisory" for role in roles))

    def test_board_directors_dry_run_uses_board_roles(self):
        result = self.run_node(
            ROOT / "scripts" / "agora.mjs",
            "ask",
            "--dry-run",
            "go/no-go по найму CTO",
            env={"INNER_AGORA_ACTIVE_CHAMBER": "board-directors"},
        )

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("CEO", result.stdout)
        self.assertIn("CFO", result.stdout)
        self.assertIn("Legal", result.stdout)
        self.assertNotIn("Платон", result.stdout)

    def test_importer_print_roles_uses_active_chamber_roles(self):
        result = self.run_node(
            ROOT / "scripts" / "import-inner-agora.mjs",
            "--print-roles",
            env={"INNER_AGORA_ACTIVE_CHAMBER": "board-directors"},
        )

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("source=chambers/board-directors/roles.json", result.stdout)
        self.assertIn("role=ceo chamberId=board-directors riskTier=advisory", result.stdout)
        self.assertNotIn("role=socrates", result.stdout)


if __name__ == "__main__":
    unittest.main()
