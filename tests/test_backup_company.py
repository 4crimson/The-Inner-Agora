import http.server
import json
import os
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKUP_SCRIPT = ROOT / "scripts" / "backup-company.mjs"


class BackupApiHandler(http.server.BaseHTTPRequestHandler):
    calls = []
    routes = {}

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
        self.calls.append(("GET", self.path))
        if self.path not in self.routes:
            self.send_json({"error": "not found"}, 404)
            return
        self.send_json(self.routes[self.path])

    def do_POST(self):
        self.calls.append(("POST", self.path))
        self.send_json({"error": "writes are not allowed in backup tests"}, 405)

    def do_PATCH(self):
        self.calls.append(("PATCH", self.path))
        self.send_json({"error": "writes are not allowed in backup tests"}, 405)


def start_backup_api(routes):
    BackupApiHandler.calls = []
    BackupApiHandler.routes = routes
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), BackupApiHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread, f"http://127.0.0.1:{server.server_port}/api"


class BackupCompanyTests(unittest.TestCase):
    def run_backup(self, api_base, out_dir, *args):
        return subprocess.run(
            [
                "node",
                str(BACKUP_SCRIPT),
                "--api-base",
                api_base,
                "--out",
                str(out_dir),
                "--timestamp",
                "2026-07-05T15:00:00.000Z",
                *args,
            ],
            cwd=ROOT,
            env={**os.environ, "INNER_AGORA_AUTO_RESTART_PAPERCLIP": "0"},
            text=True,
            capture_output=True,
        )

    def test_backup_company_writes_org_agents_issues_and_comments_without_writes(self):
        root = {"id": "root-1", "identifier": "THE-1", "title": "Root", "companyId": "company-1"}
        child = {"id": "child-1", "identifier": "THE-2", "title": "Child", "companyId": "company-1"}
        routes = {
            "/api/companies": [{"id": "company-1", "name": "The Inner Agora", "status": "active"}],
            "/api/companies/company-1/org": {"nodes": [{"id": "assistant-1", "name": "Agora Assistant"}]},
            "/api/companies/company-1/agents": [{"id": "agent-1", "name": "Платон"}],
            "/api/companies/company-1/issues": [root, child],
            "/api/issues/root-1/comments": [{"id": "comment-1", "body": "root note"}],
            "/api/issues/child-1/comments": [{"id": "comment-2", "body": "child note"}],
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            server, thread, api_base = start_backup_api(routes)
            try:
                result = self.run_backup(api_base, Path(temp_dir), "--json")
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=1)

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            payload = json.loads(result.stdout)
            backup_path = Path(payload["backupPath"])
            self.assertTrue(backup_path.exists())
            backup = json.loads(backup_path.read_text(encoding="utf-8"))

        self.assertEqual(backup["manifest"]["companyId"], "company-1")
        self.assertEqual(backup["manifest"]["companyName"], "The Inner Agora")
        self.assertEqual(backup["manifest"]["counts"]["agents"], 1)
        self.assertEqual(backup["manifest"]["counts"]["issues"], 2)
        self.assertEqual(backup["manifest"]["counts"]["comments"], 2)
        self.assertEqual(backup["org"]["nodes"][0]["name"], "Agora Assistant")
        self.assertEqual(backup["agents"][0]["name"], "Платон")
        self.assertEqual(backup["issues"][0]["identifier"], "THE-1")
        self.assertEqual(backup["commentsByIssueId"]["root-1"][0]["body"], "root note")
        self.assertTrue(all(method == "GET" for method, _path in BackupApiHandler.calls))

    def test_backup_company_fails_without_writing_empty_backup_when_company_is_missing(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            out_dir = Path(temp_dir)
            server, thread, api_base = start_backup_api({"/api/companies": []})
            try:
                result = self.run_backup(api_base, out_dir)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=1)

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Company not found: The Inner Agora", result.stderr)
            self.assertEqual(list(out_dir.rglob("backup.json")), [])
            self.assertTrue(all(method == "GET" for method, _path in BackupApiHandler.calls))


if __name__ == "__main__":
    unittest.main()
