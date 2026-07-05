import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STOP_CLEANUP = ROOT / "scripts" / "telegram" / "stop-cleanup.mjs"


class TelegramStopCleanupTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_stop_cleanup_cancels_active_runs_then_hides_non_terminal_tree(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{ isActiveRun, stopCleanup }} from {json.dumps(STOP_CLEANUP.as_uri())};

            assert.equal(isActiveRun({{ status: "queued" }}), true);
            assert.equal(isActiveRun({{ status: "succeeded" }}), false);

            const root = {{ id: "root-stop", identifier: "THE-70", status: "in_progress" }};
            const child = {{ id: "child-stop", identifier: "THE-71", parentId: "root-stop", status: "todo" }};
            const doneChild = {{ id: "child-done", identifier: "THE-72", parentId: "root-stop", status: "done" }};
            const otherRoot = {{ id: "other", identifier: "THE-80", status: "in_progress" }};
            const calls = [];

            async function api(pathname, options = {{}}) {{
              calls.push({{ method: options.method || "GET", pathname, body: options.body ? JSON.parse(options.body) : null }});
              if (pathname === "/issues/root-stop/live-runs") {{
                return [
                  {{ id: "run-active", status: "queued" }},
                  {{ id: "run-done", status: "succeeded" }},
                ];
              }}
              if (pathname === "/issues/child-stop/live-runs") return [];
              if (pathname === "/issues/child-stop" && options.method === "PATCH") throw new Error("hide failed");
              return {{ ok: true }};
            }}

            const result = await stopCleanup(root, [root, child, doneChild, otherRoot], {{
              api,
              hiddenAt: "2026-07-05T12:00:00.000Z",
              isTerminal: (issue) => issue.status === "done",
            }});

            assert.deepEqual(result.targets.map((issue) => issue.id), ["root-stop", "child-stop"]);
            assert.equal(result.failures.length, 1);
            assert.equal(result.failures[0].issue.id, "child-stop");

            const operations = calls.map((call) => `${{call.method}} ${{call.pathname}}`);
            assert.deepEqual(operations, [
              "GET /issues/root-stop/live-runs",
              "POST /heartbeat-runs/run-active/cancel",
              "PATCH /issues/root-stop",
              "GET /issues/child-stop/live-runs",
              "PATCH /issues/child-stop",
            ]);
            assert.equal(calls[2].body.status, "cancelled");
            assert.equal(calls[2].body.hiddenAt, "2026-07-05T12:00:00.000Z");
            assert.equal(operations.includes("POST /heartbeat-runs/run-done/cancel"), false);
            assert.equal(operations.includes("PATCH /issues/child-done"), false);
            assert.equal(operations.includes("PATCH /issues/other"), false);
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
