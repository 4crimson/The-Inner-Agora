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


class JsonHandler(BaseHTTPRequestHandler):
    routes = {}
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        self.close_connection = True
        payload = self.routes.get(self.path)
        if payload is None:
            self.send_response(404)
            self.send_header("connection", "close")
            self.end_headers()
            self.wfile.write(b'{"error":"not found"}')
            return
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.send_header("connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        return


class TestHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False


class PaperclipCockpitTelegramHelperTests(unittest.TestCase):
    def run_helper(self, config, routes, args):
        handler = type("Handler", (JsonHandler,), {"routes": routes})
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
                return json.loads(result.stdout)
        finally:
            server.shutdown()
            server.server_close()

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

        self.assertIn("Совет работает: 1/3", payload["text"])
        self.assertIn("Готово: Voice Alpha", payload["text"])
        self.assertIn("Ждем: Voice Beta, Voice Gamma", payload["text"])
        rows = payload["reply_markup"]["inline_keyboard"]
        self.assertEqual(rows[-1][0], {"text": "Inputs", "callback_data": "wk:latest:WK-30"})


if __name__ == "__main__":
    unittest.main()
