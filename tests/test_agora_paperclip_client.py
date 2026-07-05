import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAPERCLIP_CLIENT = ROOT / "scripts" / "agora" / "paperclip-client.mjs"


class AgoraPaperclipClientTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_paperclip_client_preserves_http_and_wake_contracts(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{
              createPaperclipClient,
              paperclipFetchError,
              shouldAutoRestartPaperclip,
              wakeSummary,
            }} from {json.dumps(PAPERCLIP_CLIENT.as_uri())};

            const calls = [];
            const responses = [
              {{ ok: true, status: 200, text: async () => '{{"id":"issue-1"}}' }},
              {{ ok: true, status: 200, text: async () => '{{"id":"issue-1","status":"done"}}' }},
              {{ ok: true, status: 200, text: async () => '{{"id":"comment-1"}}' }},
              {{ ok: true, status: 202, text: async () => '{{"id":"run-1","status":"queued"}}' }},
              {{ ok: false, status: 500, text: async () => '{{"error":"boom"}}' }},
            ];
            const client = createPaperclipClient({{
              apiBase: "http://127.0.0.1:3100/api/",
              fetchImpl: async (url, options) => {{
                calls.push({{ url, options }});
                return responses.shift();
              }},
              shouldAutoRestart: () => false,
            }});

            assert.deepEqual(await client.createIssue("company-1", {{ title: "Root" }}), {{ id: "issue-1" }});
            assert.deepEqual(await client.updateIssue("issue-1", {{ status: "done" }}), {{ id: "issue-1", status: "done" }});
            assert.deepEqual(await client.addComment("issue-1", "hello"), {{ id: "comment-1" }});
            assert.deepEqual(await client.wakeAgent("agent-1", "issue-1", "reason"), {{ id: "run-1", status: "queued" }});
            await assert.rejects(() => client.api("/broken"), /GET \\/broken failed: 500/);

            assert.equal(calls[0].url, "http://127.0.0.1:3100/api/companies/company-1/issues");
            assert.equal(calls[0].options.method, "POST");
            assert.equal(calls[0].options.headers["content-type"], "application/json");
            assert.deepEqual(JSON.parse(calls[0].options.body), {{ title: "Root" }});

            assert.equal(calls[1].url, "http://127.0.0.1:3100/api/issues/issue-1");
            assert.equal(calls[1].options.method, "PATCH");
            assert.deepEqual(JSON.parse(calls[1].options.body), {{ status: "done" }});

            assert.equal(calls[2].url, "http://127.0.0.1:3100/api/issues/issue-1/comments");
            assert.deepEqual(JSON.parse(calls[2].options.body), {{ body: "hello" }});

            assert.equal(calls[3].url, "http://127.0.0.1:3100/api/agents/agent-1/wakeup");
            assert.deepEqual(JSON.parse(calls[3].options.body), {{
              source: "assignment",
              triggerDetail: "system",
              reason: "reason",
              payload: {{ issueId: "issue-1", source: "inner-agora" }},
              idempotencyKey: "inner-agora:issue-1:agent-1",
              forceFreshSession: false,
            }});

            const failing = createPaperclipClient({{
              apiBase: "http://localhost:3100/api",
              fetchImpl: async () => {{ throw new Error("socket down"); }},
              shouldAutoRestart: () => false,
            }});
            await assert.rejects(() => failing.api("/health"), /Paperclip API URL: http:\\/\\/localhost:3100\\/api\\/health/);

            const safe = await failing.wakeAgentSafe("agent-1", "issue-1", "reason");
            assert.equal(safe.ok, false);
            assert.match(safe.error, /socket down/);

            assert.equal(wakeSummary(null), "wake=not-requested");
            assert.equal(wakeSummary({{ ok: false, error: "boom" }}), "wake=failed (boom)");
            assert.equal(wakeSummary({{ ok: true, run: {{ id: "run-1", status: "queued" }} }}), "wake=queued:run-1");
            assert.equal(wakeSummary({{ ok: true, run: {{ status: "accepted" }} }}), "wake=accepted");

            assert.equal(
              shouldAutoRestartPaperclip("http://127.0.0.1:3100/api", {{ INNER_AGORA_AUTO_RESTART_PAPERCLIP: "1" }}),
              true,
            );
            assert.equal(
              shouldAutoRestartPaperclip("https://paperclip.example/api", {{ INNER_AGORA_AUTO_RESTART_PAPERCLIP: "1" }}),
              false,
            );
            assert.match(
              paperclipFetchError("/x", {{ method: "POST" }}, "http://local/api/x", new Error("offline"), {{
                status: 1,
                stderr: "denied",
              }}).message,
              /Auto-restart attempted/,
            );
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
