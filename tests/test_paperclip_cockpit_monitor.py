import json
import os
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MONITOR = ROOT / "scripts" / "paperclip-cockpit-monitor.mjs"


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


class PaperclipCockpitMonitorTests(unittest.TestCase):
    def run_monitor_cli(self, config, args, extra_env=None):
        with tempfile.TemporaryDirectory() as temp_dir:
            config = {**config, "cwd": temp_dir}
            config_path = Path(temp_dir) / "paperclip-cockpit.json"
            config_path.write_text(json.dumps(config), encoding="utf-8")
            env = {
                **os.environ,
                "PAPERCLIP_COCKPIT_CONFIG": str(config_path),
                "PAPERCLIP_API_BASE": "http://127.0.0.1:9/api",
            }
            if extra_env:
                env.update(extra_env)
            result = subprocess.run(
                ["node", str(MONITOR), *args],
                cwd=ROOT,
                env=env,
                text=True,
                capture_output=True,
                check=True,
            )
            return json.loads(result.stdout)

    def run_monitor(self, routes, root_ref=None):
        handler = type("Handler", (JsonHandler,), {"routes": routes})
        server = TestHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                config = {
                    "cwd": temp_dir,
                    "company_hints": ["Demo"],
                    "monitor": {
                        "terminal_statuses": ["done", "blocked", "cancelled"],
                        "synthesis_title_pattern": "^Synthesis:",
                        "synthesis_action": "synth",
                        "notify": {"exec": ["echo", "notify", "{issue}"]},
                    },
                    "actions": {
                        "synth": {"exec": ["echo", "synth"]},
                    },
                }
                config_path = Path(temp_dir) / "paperclip-cockpit.json"
                config_path.write_text(json.dumps(config), encoding="utf-8")
                env = {
                    **os.environ,
                    "PAPERCLIP_COCKPIT_CONFIG": str(config_path),
                    "PAPERCLIP_API_BASE": f"http://127.0.0.1:{server.server_port}/api",
                }
                command = ["node", str(MONITOR), "once"]
                if root_ref:
                    command.extend(["--root", root_ref])
                command.extend(["--dry-run", "--json"])
                result = subprocess.run(
                    command,
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

    def run_monitor_sequence(self, route_sets, root_ref):
        class SequenceHandler(JsonHandler):
            def do_GET(self):
                self.close_connection = True
                count = self.request_counts.get(self.path, 0)
                self.request_counts[self.path] = count + 1
                route_index = min(count, len(self.route_sets) - 1)
                payload = self.route_sets[route_index].get(self.path)
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

        SequenceHandler.route_sets = route_sets
        SequenceHandler.request_counts = {}

        server = TestHTTPServer(("127.0.0.1", 0), SequenceHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                config = {
                    "cwd": temp_dir,
                    "monitor": {
                        "terminal_statuses": ["done", "blocked", "cancelled"],
                        "synthesis_title_pattern": "^Synthesis:",
                        "synthesis_action": "synth",
                        "notify": {"exec": ["echo", "notify", "{issue}"]},
                    },
                    "actions": {
                        "synth": {"exec": ["echo", "synth"]},
                    },
                }
                config_path = Path(temp_dir) / "paperclip-cockpit.json"
                config_path.write_text(json.dumps(config), encoding="utf-8")
                env = {
                    **os.environ,
                    "PAPERCLIP_COCKPIT_CONFIG": str(config_path),
                    "PAPERCLIP_API_BASE": f"http://127.0.0.1:{server.server_port}/api",
                }
                outputs = []
                for _ in route_sets:
                    result = subprocess.run(
                        [
                            "node",
                            str(MONITOR),
                            "once",
                            "--root",
                            root_ref,
                            "--json",
                        ],
                        cwd=ROOT,
                        env=env,
                        text=True,
                        capture_output=True,
                        check=True,
                    )
                    outputs.append(json.loads(result.stdout))
                state_path = Path(temp_dir) / ".paperclip-cockpit-monitor-state.json"
                return outputs, json.loads(state_path.read_text(encoding="utf-8"))
        finally:
            server.shutdown()
            server.server_close()

    def test_install_dry_run_renders_launchd_watch_service(self):
        data = self.run_monitor_cli(
            {
                "command": {"name": "demo"},
                "telegram": {"profile": "demo-profile"},
                "monitor": {
                    "interval_seconds": 45,
                    "launchd": {"label": "local.paperclip-cockpit.demo"},
                },
            },
            ["install", "--dry-run", "--json"],
        )

        self.assertEqual(data["action"], "install")
        self.assertTrue(data["dryRun"])
        self.assertEqual(data["label"], "local.paperclip-cockpit.demo")
        self.assertEqual(data["programArguments"][-3:], ["watch", "--interval", "45"])
        self.assertIn("PAPERCLIP_COCKPIT_CONFIG", data["plist"])

    def test_scan_skips_existing_roots_created_before_monitor_activation(self):
        root = {
            "id": "root-old",
            "identifier": "ROOT-30",
            "companyId": "company-1",
            "status": "in_progress",
            "createdAt": "2020-01-01T00:00:00.000Z",
        }
        child = {
            "id": "child-old",
            "identifier": "ROOT-31",
            "companyId": "company-1",
            "parentId": "root-old",
            "status": "done",
            "title": "Voice: Plato",
            "createdAt": "2020-01-01T00:01:00.000Z",
        }
        data = self.run_monitor(
            {
                "/api/companies": [{"id": "company-1", "name": "Demo", "issuePrefix": "ROOT"}],
                "/api/companies/company-1/issues": [root, child],
            },
        )

        self.assertEqual(data["operations"][0]["type"], "skip")
        self.assertEqual(data["operations"][0]["reason"], "root-before-monitor-activation")

    def test_explicit_root_bypasses_existing_root_backfill_guard(self):
        root = {
            "id": "root-old-explicit",
            "identifier": "ROOT-40",
            "companyId": "company-1",
            "status": "in_progress",
            "createdAt": "2020-01-01T00:00:00.000Z",
        }
        child = {
            "id": "child-old-explicit",
            "identifier": "ROOT-41",
            "companyId": "company-1",
            "parentId": "root-old-explicit",
            "status": "done",
            "title": "Voice: Plato",
            "createdAt": "2020-01-01T00:01:00.000Z",
        }
        data = self.run_monitor(
            {
                "/api/issues/ROOT-40": root,
                "/api/companies/company-1/issues": [root, child],
            },
            "ROOT-40",
        )

        self.assertEqual(data["operations"][0]["type"], "synthesize")

    def test_monitor_synthesizes_when_children_are_terminal(self):
        root = {"id": "root-1", "identifier": "ROOT-1", "companyId": "company-1", "status": "in_progress"}
        child = {
            "id": "child-1",
            "identifier": "ROOT-2",
            "companyId": "company-1",
            "parentId": "root-1",
            "status": "done",
            "title": "Voice: Plato",
        }
        data = self.run_monitor(
            {
                "/api/issues/ROOT-1": root,
                "/api/companies/company-1/issues": [root, child],
            },
            "ROOT-1",
        )

        self.assertEqual(data["operations"][0]["type"], "synthesize")
        self.assertEqual(data["operations"][0]["root"], "ROOT-1")
        self.assertEqual(data["operations"][0]["command"], ["echo", "synth", "ROOT-1"])

    def test_monitor_notifies_when_synthesis_is_terminal(self):
        root = {"id": "root-2", "identifier": "ROOT-10", "companyId": "company-1", "status": "in_progress"}
        child = {
            "id": "child-2",
            "identifier": "ROOT-11",
            "companyId": "company-1",
            "parentId": "root-2",
            "status": "done",
            "title": "Voice: Descartes",
        }
        synthesis = {
            "id": "synthesis-2",
            "identifier": "ROOT-12",
            "companyId": "company-1",
            "parentId": "root-2",
            "status": "done",
            "title": "Synthesis: result",
        }
        data = self.run_monitor(
            {
                "/api/issues/ROOT-10": root,
                "/api/companies/company-1/issues": [root, child, synthesis],
            },
            "ROOT-10",
        )

        self.assertEqual(data["operations"][0]["type"], "notify")
        self.assertEqual(data["operations"][0]["root"], "ROOT-10")
        self.assertEqual(data["operations"][0]["synthesis"], "ROOT-12")
        self.assertEqual(data["operations"][0]["command"], ["echo", "notify", "ROOT-12"])

    def test_monitor_auto_finalizes_disposition_wait_before_synthesis(self):
        class DispositionHandler(JsonHandler):
            issues = []
            comments = {}
            patches = []
            posts = []

            def do_GET(self):
                self.close_connection = True
                if self.path == "/api/issues/ROOT-70":
                    payload = self.issues[0]
                elif self.path == "/api/issues/ROOT-71":
                    payload = self.issues[1]
                elif self.path == "/api/companies/company-1/issues":
                    payload = self.issues
                elif self.path == "/api/issues/child-disposition/comments":
                    payload = self.comments["child-disposition"]
                else:
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

            def do_PATCH(self):
                self.close_connection = True
                length = int(self.headers.get("content-length") or "0")
                payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
                if self.path != "/api/issues/child-disposition":
                    self.send_response(404)
                    self.send_header("connection", "close")
                    self.end_headers()
                    return
                self.patches.append(payload)
                self.issues[1] = {**self.issues[1], **payload, "updatedAt": "2026-07-01T20:10:00.000Z"}
                body = json.dumps(self.issues[1]).encode("utf-8")
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.send_header("connection", "close")
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                self.close_connection = True
                length = int(self.headers.get("content-length") or "0")
                payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
                if self.path != "/api/issues/child-disposition/comments":
                    self.send_response(404)
                    self.send_header("connection", "close")
                    self.end_headers()
                    return
                self.posts.append(payload)
                body = json.dumps({"id": "comment-auto", **payload}).encode("utf-8")
                self.send_response(201)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.send_header("connection", "close")
                self.end_headers()
                self.wfile.write(body)

        root = {"id": "root-disposition", "identifier": "ROOT-70", "companyId": "company-1", "status": "in_progress"}
        child = {
            "id": "child-disposition",
            "identifier": "ROOT-71",
            "companyId": "company-1",
            "parentId": "root-disposition",
            "status": "in_progress",
            "title": "Voice: Plato",
            "successfulRunHandoff": {"required": True},
        }
        DispositionHandler.issues = [root, child]
        DispositionHandler.comments = {
            "child-disposition": [
                {"authorType": "agent", "body": "A substantial answer has already been produced by the role." * 3},
                {"authorType": "system", "body": "Paperclip needs a disposition before this issue can continue."},
            ]
        }
        DispositionHandler.patches = []
        DispositionHandler.posts = []

        server = TestHTTPServer(("127.0.0.1", 0), DispositionHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                config = {
                    "cwd": temp_dir,
                    "monitor": {
                        "terminal_statuses": ["done", "blocked", "cancelled"],
                        "synthesis_title_pattern": "^Synthesis:",
                        "synthesis_action": "synth",
                        "auto_finalize_disposition_waits": {"enabled": True, "min_agent_comment_chars": 40},
                    },
                    "actions": {
                        "synth": {"exec": ["echo", "synth"]},
                    },
                }
                config_path = Path(temp_dir) / "paperclip-cockpit.json"
                config_path.write_text(json.dumps(config), encoding="utf-8")
                env = {
                    **os.environ,
                    "PAPERCLIP_COCKPIT_CONFIG": str(config_path),
                    "PAPERCLIP_API_BASE": f"http://127.0.0.1:{server.server_port}/api",
                }
                result = subprocess.run(
                    ["node", str(MONITOR), "once", "--root", "ROOT-70", "--json"],
                    cwd=ROOT,
                    env=env,
                    text=True,
                    capture_output=True,
                    check=True,
                )
                data = json.loads(result.stdout)
        finally:
            server.shutdown()
            server.server_close()

        self.assertEqual([operation["type"] for operation in data["operations"]], ["auto_finalize_disposition_wait", "synthesize"])
        self.assertEqual(DispositionHandler.patches[0]["status"], "done")
        self.assertIsNone(DispositionHandler.patches[0]["executionRunId"])
        self.assertIsNone(DispositionHandler.patches[0]["executionLockedAt"])
        self.assertIn("completedAt", DispositionHandler.patches[0])
        self.assertEqual(DispositionHandler.posts[0]["body"].split(":", 1)[0], "Auto-finalized by Paperclip cockpit monitor")

    def test_monitor_cancels_live_run_before_auto_finalize(self):
        class LiveRunDispositionHandler(JsonHandler):
            issues = []
            comments = {}
            patches = []
            posts = []
            cancels = []
            force_releases = []
            releases = []

            def do_GET(self):
                self.close_connection = True
                if self.path == "/api/issues/ROOT-75":
                    payload = self.issues[0]
                elif self.path == "/api/issues/ROOT-76":
                    payload = self.issues[1]
                elif self.path == "/api/companies/company-1/issues":
                    payload = self.issues
                elif self.path == "/api/issues/child-live-disposition/comments":
                    payload = self.comments["child-live-disposition"]
                elif self.path == "/api/issues/child-live-disposition/live-runs":
                    payload = [{"id": "run-live-1", "status": "running"}]
                else:
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

            def do_PATCH(self):
                self.close_connection = True
                length = int(self.headers.get("content-length") or "0")
                payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
                if self.path != "/api/issues/child-live-disposition":
                    self.send_response(404)
                    self.send_header("connection", "close")
                    self.end_headers()
                    return
                self.patches.append(payload)
                self.issues[1] = {**self.issues[1], **payload, "updatedAt": "2026-07-01T20:10:00.000Z"}
                body = json.dumps(self.issues[1]).encode("utf-8")
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.send_header("connection", "close")
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                self.close_connection = True
                length = int(self.headers.get("content-length") or "0")
                payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
                if self.path == "/api/heartbeat-runs/run-live-1/cancel":
                    self.cancels.append(payload)
                    body = b'{"id":"run-live-1","status":"cancelled"}'
                elif self.path == "/api/issues/child-live-disposition/admin/force-release":
                    self.force_releases.append(payload)
                    body = b'{"ok":true}'
                elif self.path == "/api/issues/child-live-disposition/release":
                    self.releases.append(payload)
                    body = b'{"ok":true}'
                elif self.path == "/api/issues/child-live-disposition/comments":
                    self.posts.append(payload)
                    body = json.dumps({"id": "comment-auto", **payload}).encode("utf-8")
                else:
                    self.send_response(404)
                    self.send_header("connection", "close")
                    self.end_headers()
                    return
                self.send_response(201)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.send_header("connection", "close")
                self.end_headers()
                self.wfile.write(body)

        root = {"id": "root-live-disposition", "identifier": "ROOT-75", "companyId": "company-1", "status": "in_progress"}
        child = {
            "id": "child-live-disposition",
            "identifier": "ROOT-76",
            "companyId": "company-1",
            "parentId": "root-live-disposition",
            "status": "in_progress",
            "title": "Voice: Plato",
            "successfulRunHandoff": {"required": True},
            "executionRunId": "run-live-1",
            "executionLockedAt": "2026-07-01T20:00:00.000Z",
        }
        LiveRunDispositionHandler.issues = [root, child]
        LiveRunDispositionHandler.comments = {
            "child-live-disposition": [
                {"authorType": "agent", "body": "A substantial answer has already been produced by the role." * 3},
                {"authorType": "system", "body": "Paperclip needs a disposition before this issue can continue."},
            ]
        }
        LiveRunDispositionHandler.patches = []
        LiveRunDispositionHandler.posts = []
        LiveRunDispositionHandler.cancels = []
        LiveRunDispositionHandler.force_releases = []
        LiveRunDispositionHandler.releases = []

        server = TestHTTPServer(("127.0.0.1", 0), LiveRunDispositionHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                config = {
                    "cwd": temp_dir,
                    "monitor": {
                        "terminal_statuses": ["done", "blocked", "cancelled"],
                        "synthesis_title_pattern": "^Synthesis:",
                        "synthesis_action": "synth",
                        "auto_finalize_disposition_waits": {"enabled": True, "min_agent_comment_chars": 40},
                    },
                    "actions": {
                        "synth": {"exec": ["echo", "synth"]},
                    },
                }
                config_path = Path(temp_dir) / "paperclip-cockpit.json"
                config_path.write_text(json.dumps(config), encoding="utf-8")
                env = {
                    **os.environ,
                    "PAPERCLIP_COCKPIT_CONFIG": str(config_path),
                    "PAPERCLIP_API_BASE": f"http://127.0.0.1:{server.server_port}/api",
                }
                result = subprocess.run(
                    ["node", str(MONITOR), "once", "--root", "ROOT-75", "--json"],
                    cwd=ROOT,
                    env=env,
                    text=True,
                    capture_output=True,
                    check=True,
                )
                data = json.loads(result.stdout)
        finally:
            server.shutdown()
            server.server_close()

        self.assertEqual(
            [operation["type"] for operation in data["operations"]],
            [
                "cancel_live_run",
                "force_release_issue",
                "release_issue_assignee",
                "auto_finalize_disposition_wait",
                "synthesize",
            ],
        )
        self.assertEqual(LiveRunDispositionHandler.cancels, [{}])
        self.assertEqual(LiveRunDispositionHandler.force_releases, [{}])
        self.assertEqual(LiveRunDispositionHandler.releases, [{}])
        self.assertEqual(LiveRunDispositionHandler.patches[0]["status"], "done")
        self.assertIsNone(LiveRunDispositionHandler.patches[0]["executionRunId"])
        self.assertIsNone(LiveRunDispositionHandler.patches[0]["assigneeAgentId"])

    def test_monitor_cancels_terminal_live_run_with_disposition_marker(self):
        class TerminalLiveRunHandler(JsonHandler):
            issues = []
            comments = {}
            cancels = []

            def do_GET(self):
                self.close_connection = True
                if self.path == "/api/issues/ROOT-77":
                    payload = self.issues[0]
                elif self.path == "/api/companies/company-1/issues":
                    payload = self.issues
                elif self.path == "/api/issues/terminal-live/comments":
                    payload = self.comments["terminal-live"]
                elif self.path == "/api/issues/terminal-live/live-runs":
                    payload = [{"id": "run-terminal-1", "status": "queued"}]
                else:
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

            def do_POST(self):
                self.close_connection = True
                length = int(self.headers.get("content-length") or "0")
                payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
                if self.path != "/api/heartbeat-runs/run-terminal-1/cancel":
                    self.send_response(404)
                    self.send_header("connection", "close")
                    self.end_headers()
                    return
                self.cancels.append(payload)
                body = b'{"id":"run-terminal-1","status":"cancelled"}'
                self.send_response(201)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.send_header("connection", "close")
                self.end_headers()
                self.wfile.write(body)

        root = {"id": "root-terminal-live", "identifier": "ROOT-77", "companyId": "company-1", "status": "in_progress"}
        child = {
            "id": "terminal-live",
            "identifier": "ROOT-78",
            "companyId": "company-1",
            "parentId": "root-terminal-live",
            "status": "done",
            "title": "Voice: Plato",
        }
        TerminalLiveRunHandler.issues = [root, child]
        TerminalLiveRunHandler.comments = {
            "terminal-live": [
                {"authorType": "system", "body": "Paperclip needs a disposition before this issue can continue."},
            ]
        }
        TerminalLiveRunHandler.cancels = []

        server = TestHTTPServer(("127.0.0.1", 0), TerminalLiveRunHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                config = {
                    "cwd": temp_dir,
                    "monitor": {
                        "terminal_statuses": ["done", "blocked", "cancelled"],
                        "synthesis_title_pattern": "^Synthesis:",
                        "synthesis_action": "synth",
                        "cancel_terminal_live_runs": {"enabled": True},
                    },
                    "actions": {
                        "synth": {"exec": ["echo", "synth"]},
                    },
                }
                config_path = Path(temp_dir) / "paperclip-cockpit.json"
                config_path.write_text(json.dumps(config), encoding="utf-8")
                env = {
                    **os.environ,
                    "PAPERCLIP_COCKPIT_CONFIG": str(config_path),
                    "PAPERCLIP_API_BASE": f"http://127.0.0.1:{server.server_port}/api",
                }
                result = subprocess.run(
                    ["node", str(MONITOR), "once", "--root", "ROOT-77", "--json"],
                    cwd=ROOT,
                    env=env,
                    text=True,
                    capture_output=True,
                    check=True,
                )
                data = json.loads(result.stdout)
        finally:
            server.shutdown()
            server.server_close()

        self.assertEqual([operation["type"] for operation in data["operations"]], ["cancel_terminal_live_run", "synthesize"])
        self.assertEqual(TerminalLiveRunHandler.cancels, [{}])

    def test_monitor_auto_finalizes_synthesis_disposition_wait_before_notify(self):
        class SynthesisDispositionHandler(JsonHandler):
            issues = []
            comments = {}
            patches = []

            def do_GET(self):
                self.close_connection = True
                if self.path == "/api/issues/ROOT-80":
                    payload = self.issues[0]
                elif self.path == "/api/issues/ROOT-82":
                    payload = self.issues[2]
                elif self.path == "/api/companies/company-1/issues":
                    payload = self.issues
                elif self.path == "/api/issues/synthesis-disposition/comments":
                    payload = self.comments["synthesis-disposition"]
                else:
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

            def do_PATCH(self):
                self.close_connection = True
                length = int(self.headers.get("content-length") or "0")
                payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
                if self.path != "/api/issues/synthesis-disposition":
                    self.send_response(404)
                    self.send_header("connection", "close")
                    self.end_headers()
                    return
                self.patches.append(payload)
                self.issues[2] = {**self.issues[2], **payload, "updatedAt": "2026-07-01T20:10:00.000Z"}
                body = json.dumps(self.issues[2]).encode("utf-8")
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.send_header("connection", "close")
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                self.close_connection = True
                body = b'{"id":"ok"}'
                self.send_response(201)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.send_header("connection", "close")
                self.end_headers()
                self.wfile.write(body)

        root = {"id": "root-synthesis-disposition", "identifier": "ROOT-80", "companyId": "company-1", "status": "in_progress"}
        child = {
            "id": "child-done",
            "identifier": "ROOT-81",
            "companyId": "company-1",
            "parentId": "root-synthesis-disposition",
            "status": "done",
            "title": "Voice: Plato",
        }
        synthesis = {
            "id": "synthesis-disposition",
            "identifier": "ROOT-82",
            "companyId": "company-1",
            "parentId": "root-synthesis-disposition",
            "status": "in_progress",
            "title": "Synthesis: result",
            "successfulRunHandoff": {"required": True},
        }
        SynthesisDispositionHandler.issues = [root, child, synthesis]
        SynthesisDispositionHandler.comments = {
            "synthesis-disposition": [
                {"authorType": "agent", "body": "A substantial synthesis has already been produced." * 3},
                {"authorType": "system", "body": "Paperclip needs a disposition before this issue can continue."},
            ]
        }
        SynthesisDispositionHandler.patches = []

        server = TestHTTPServer(("127.0.0.1", 0), SynthesisDispositionHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                config = {
                    "cwd": temp_dir,
                    "monitor": {
                        "terminal_statuses": ["done", "blocked", "cancelled"],
                        "synthesis_title_pattern": "^Synthesis:",
                        "notify": {"exec": ["echo", "notify", "{issue}"]},
                        "auto_finalize_disposition_waits": {"enabled": True, "min_agent_comment_chars": 40},
                    },
                }
                config_path = Path(temp_dir) / "paperclip-cockpit.json"
                config_path.write_text(json.dumps(config), encoding="utf-8")
                env = {
                    **os.environ,
                    "PAPERCLIP_COCKPIT_CONFIG": str(config_path),
                    "PAPERCLIP_API_BASE": f"http://127.0.0.1:{server.server_port}/api",
                }
                result = subprocess.run(
                    ["node", str(MONITOR), "once", "--root", "ROOT-80", "--json"],
                    cwd=ROOT,
                    env=env,
                    text=True,
                    capture_output=True,
                    check=True,
                )
                data = json.loads(result.stdout)
        finally:
            server.shutdown()
            server.server_close()

        self.assertEqual([operation["type"] for operation in data["operations"]], ["auto_finalize_disposition_wait", "notify"])
        self.assertEqual(SynthesisDispositionHandler.patches[0]["status"], "done")
        self.assertEqual(data["operations"][1]["synthesis"], "ROOT-82")

    def test_monitor_cycle_is_idempotent_across_synth_and_notify(self):
        root = {
            "id": "root-cycle",
            "identifier": "ROOT-50",
            "companyId": "company-1",
            "status": "in_progress",
            "createdAt": "2026-07-01T20:00:00.000Z",
        }
        child = {
            "id": "child-cycle",
            "identifier": "ROOT-51",
            "companyId": "company-1",
            "parentId": "root-cycle",
            "status": "done",
            "title": "Voice: Plato",
            "updatedAt": "2026-07-01T20:01:00.000Z",
        }
        synthesis_open = {
            "id": "synthesis-cycle",
            "identifier": "ROOT-52",
            "companyId": "company-1",
            "parentId": "root-cycle",
            "status": "in_progress",
            "title": "Synthesis: result",
            "updatedAt": "2026-07-01T20:02:00.000Z",
        }
        synthesis_done = {**synthesis_open, "status": "done", "updatedAt": "2026-07-01T20:03:00.000Z"}

        route_sets = [
            {
                "/api/issues/ROOT-50": root,
                "/api/companies/company-1/issues": [root, child],
            },
            {
                "/api/issues/ROOT-50": root,
                "/api/companies/company-1/issues": [root, child],
            },
            {
                "/api/issues/ROOT-50": root,
                "/api/companies/company-1/issues": [root, child, synthesis_open],
            },
            {
                "/api/issues/ROOT-50": root,
                "/api/companies/company-1/issues": [root, child, synthesis_done],
            },
            {
                "/api/issues/ROOT-50": root,
                "/api/companies/company-1/issues": [root, child, synthesis_done],
            },
        ]
        outputs, state = self.run_monitor_sequence(route_sets, "ROOT-50")
        operations = [item["operations"][0] for item in outputs]

        self.assertEqual([operation["type"] for operation in operations], ["synthesize", "skip", "wait", "notify", "skip"])
        self.assertEqual(operations[1]["reason"], "synthesis-already-requested")
        self.assertEqual(operations[2]["synthesis"], "ROOT-52")
        self.assertEqual(operations[2]["status"], "in_progress")
        self.assertEqual(operations[4]["reason"], "already-notified")
        self.assertEqual(state["roots"]["ROOT-50"]["lastNotifiedSynthesisId"], "synthesis-cycle")


if __name__ == "__main__":
    unittest.main()
