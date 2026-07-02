import json
import os
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LIVE_CHECK = ROOT / "scripts" / "agora-telegram-live-check.mjs"


class SequenceHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    request_counts = {}
    baseline_issues = []
    live_issues = []

    def send_json(self, payload, status=200):
        self.close_connection = True
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.send_header("connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/companies":
            self.send_json([{"id": "company-1", "name": "The Inner Agora", "issuePrefix": "THE"}])
            return
        if self.path == "/api/companies/company-1/issues":
            count = self.request_counts.get(self.path, 0)
            self.request_counts[self.path] = count + 1
            self.send_json(self.baseline_issues if count == 0 else self.live_issues)
            return
        self.send_json({"error": "not found", "path": self.path}, 404)

    def log_message(self, *_):
        return


class TestHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False


class InnerAgoraTelegramLiveCheckTests(unittest.TestCase):
    def run_live_check(self, issues):
        SequenceHandler.request_counts = {}
        SequenceHandler.baseline_issues = []
        SequenceHandler.live_issues = issues
        server = TestHTTPServer(("127.0.0.1", 0), SequenceHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                config_path = Path(temp_dir) / "paperclip-cockpit.json"
                config_path.write_text(
                    json.dumps(
                        {
                            "company_hints": ["The Inner Agora"],
                            "monitor": {"synthesis_title_pattern": "^Синтез:"},
                        }
                    ),
                    encoding="utf-8",
                )
                env = {
                    **os.environ,
                    "PAPERCLIP_COCKPIT_CONFIG": str(config_path),
                    "PAPERCLIP_API_BASE": f"http://127.0.0.1:{server.server_port}/api",
                }
                result = subprocess.run(
                    [
                        "node",
                        str(LIVE_CHECK),
                        "wait",
                        "--phrase",
                        "давай спросим агору про свободу ребенка и власть родителей",
                        "--timeout",
                        "2",
                        "--interval",
                        "0.1",
                        "--expect-voices",
                        "2",
                        "--json",
                    ],
                    cwd=ROOT,
                    env=env,
                    text=True,
                    capture_output=True,
                    check=True,
                )
                return json.loads(result.stdout)
        finally:
            server.shutdown()
            server.server_close()

    def test_wait_detects_new_paperclip_root_after_human_telegram_message(self):
        root = {
            "id": "root-1",
            "identifier": "THE-1000",
            "issueNumber": 1000,
            "companyId": "company-1",
            "title": "Agora local: свободу ребенка и власть родителей",
            "status": "todo",
            "createdAt": "2099-01-01T00:00:00.000Z",
            "description": "Исходный вопрос:\nдавай спросим агору про свободу ребенка и власть родителей\n\nКак работать:",
        }
        child_one = {
            "id": "child-1",
            "identifier": "THE-1001",
            "issueNumber": 1001,
            "companyId": "company-1",
            "parentId": "root-1",
            "title": "Платон: свободу ребенка",
            "status": "todo",
        }
        child_two = {
            "id": "child-2",
            "identifier": "THE-1002",
            "issueNumber": 1002,
            "companyId": "company-1",
            "parentId": "root-1",
            "title": "Нагарджуна: свободу ребенка",
            "status": "todo",
        }

        result = self.run_live_check([root, child_one, child_two])

        self.assertTrue(result["ok"])
        self.assertEqual(result["root"]["ref"], "THE-1000")
        self.assertEqual([voice["ref"] for voice in result["voices"]], ["THE-1001", "THE-1002"])
        self.assertIsNone(result["synthesis"])


if __name__ == "__main__":
    unittest.main()
