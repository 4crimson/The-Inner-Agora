import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ISSUE_QUERY_UTILS = ROOT / "scripts" / "agora" / "issue-query-utils.mjs"


class AgoraIssueQueryUtilsTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_issue_query_utils_preserve_paperclip_read_contracts(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{
              latestSynthesisForRoot,
              resolveRootIssue,
              resolveTopRootIssue,
            }} from {json.dumps(ISSUE_QUERY_UTILS.as_uri())};

            const root = {{ id: "root", identifier: "THE-10", issueNumber: 10, title: "Root" }};
            const olderRoot = {{ id: "older", identifier: "THE-2", issueNumber: 2, title: "Older" }};
            const child = {{ id: "child", identifier: "THE-11", issueNumber: 11, parentId: "root", title: "Child" }};
            const hiddenRoot = {{ id: "hidden", identifier: "THE-20", issueNumber: 20, hiddenAt: "2026-07-05", title: "Hidden" }};
            const synthesis = {{
              id: "synthesis",
              identifier: "THE-12",
              issueNumber: 12,
              parentId: "root",
              assigneeAgentId: "assistant",
              title: "Синтез: Root",
            }};
            const issues = [olderRoot, child, hiddenRoot, root, synthesis];
            const comments = [
              {{
                body: [
                  "# Итог",
                  "Главное: держать границы.",
                  "",
                  "## Metadata",
                  "service text",
                ].join("\\n"),
              }},
            ];
            const calls = [];
            const api = async (path) => {{
              calls.push(path);
              if (path === "/issues/THE-11") return child;
              if (path === "/issues/root") return root;
              if (path === "/issues/child") return child;
              if (path === "/companies/company/issues") return issues;
              if (path === "/issues/synthesis/comments") return comments;
              throw new Error(`unexpected api path: ${{path}}`);
            }};

            assert.equal(await resolveRootIssue(["THE-11"], issues, api), root);
            assert.deepEqual(calls.splice(0), ["/issues/THE-11", "/issues/root"]);

            assert.equal(await resolveRootIssue([], issues, api), root);
            assert.deepEqual(calls.splice(0), []);

            assert.equal(await resolveTopRootIssue(child, api), root);
            assert.deepEqual(calls.splice(0), ["/issues/root"]);

            const synthesisPayload = await latestSynthesisForRoot(root, {{ company: {{ id: "company" }}, assistant: {{ id: "assistant" }} }}, api);
            assert.equal(synthesisPayload.synthesisIssue, synthesis);
            assert.equal(synthesisPayload.synthesisText, "Итог\\nГлавное: держать границы.\\n\\nMetadata\\nservice text");
            assert.deepEqual(calls.splice(0), ["/companies/company/issues", "/issues/synthesis/comments"]);

            const noSynthesisPayload = await latestSynthesisForRoot(olderRoot, {{ company: {{ id: "company" }}, assistant: {{ id: "assistant" }} }}, api);
            assert.deepEqual(noSynthesisPayload, {{ synthesisIssue: null, synthesisText: "" }});
            assert.deepEqual(calls.splice(0), ["/companies/company/issues"]);

            await assert.rejects(
              () => resolveRootIssue([], [hiddenRoot, child], api),
              /No root Agora sessions found in Paperclip/,
            );
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
