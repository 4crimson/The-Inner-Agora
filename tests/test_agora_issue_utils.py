import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ISSUE_UTILS = ROOT / "scripts" / "agora" / "issue-utils.mjs"


class AgoraIssueUtilsTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_issue_utils_preserve_agora_issue_contracts(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{
              allowedMoveStatuses,
              bareIssueRef,
              byIssueNumber,
              childrenOf,
              compactIssueLine,
              displayStatus,
              displayTitle,
              isSynthesisIssue,
              issueByIdMap,
              issueKind,
              issueNumber,
              latestIssueRef,
              latestSynthesisChild,
              rootFromMap,
              terminalStatuses,
              voiceChildren,
              withoutIssueRef,
            }} from {json.dumps(ISSUE_UTILS.as_uri())};

            const root = {{
              id: "root",
              identifier: "THE-100",
              issueNumber: 100,
              title: "Root: what is freedom?",
              status: "in_progress",
              createdAt: "2026-07-05T10:00:00.000Z",
            }};
            const voice = {{
              id: "voice",
              parentId: "root",
              identifier: "THE-101",
              issueNumber: 101,
              title: "Платон: вопрос о свободе",
              status: "todo",
              assigneeAgentId: "plato",
              createdAt: "2026-07-05T10:01:00.000Z",
            }};
            const synthesis = {{
              id: "synthesis",
              parentId: "root",
              identifier: "THE-102",
              issueNumber: 102,
              title: "Синтез: Root",
              status: "done",
              assigneeAgentId: "assistant",
              createdAt: "2026-07-05T10:02:00.000Z",
            }};
            const hidden = {{
              id: "hidden",
              parentId: "root",
              identifier: "THE-103",
              issueNumber: 103,
              title: "Hidden child",
              status: "todo",
              hiddenAt: "2026-07-05T10:03:00.000Z",
            }};
            const nested = {{
              id: "nested",
              parentId: "voice",
              identifier: "THE-104",
              issueNumber: 104,
              title: "Nested",
              status: "blocked",
            }};
            const issues = [synthesis, hidden, nested, voice, root];
            const agentById = new Map([
              ["assistant", {{ name: "Agora Assistant" }}],
              ["plato", {{ name: "Платон" }}],
            ]);
            const agora = {{ assistant: {{ id: "assistant" }} }};

            assert.equal(terminalStatuses.has("done"), true);
            assert.equal(terminalStatuses.has("in_progress"), false);
            assert.equal(allowedMoveStatuses.has("cancelled"), true);

            assert.equal(issueNumber({{ issueNumber: 7 }}), 7);
            assert.equal(issueNumber({{ identifier: "THE-42" }}), 42);
            assert.equal(issueNumber({{ identifier: "missing" }}), 0);
            assert.deepEqual([synthesis, voice].sort(byIssueNumber).map((issue) => issue.id), ["voice", "synthesis"]);

            assert.equal(bareIssueRef("show 42"), "THE-42");
            assert.equal(latestIssueRef(["voice", "the-42", "100"]), "THE-42");
            assert.equal(latestIssueRef(["voice", "100"]), "THE-100");
            assert.equal(withoutIssueRef("voice Платон THE-42 100"), "voice Платон");

            assert.deepEqual(childrenOf(root, issues).map((issue) => issue.id), ["voice", "synthesis"]);
            assert.equal(isSynthesisIssue(synthesis, "assistant"), true);
            assert.equal(isSynthesisIssue(voice, "assistant"), false);
            assert.equal(latestSynthesisChild(root, issues, agora).id, "synthesis");
            assert.deepEqual(voiceChildren(root, issues, agora).map((issue) => issue.id), ["voice"]);

            assert.equal(displayStatus("in_progress"), "в работе (in_progress)");
            assert.equal(displayStatus("custom"), "custom");
            assert.equal(displayTitle({{ title: "Синтез: Синтез: большой итог" }}), "Синтез: большой итог");
            assert.equal(issueKind(root, "assistant"), "пакет");
            assert.equal(issueKind(voice, "assistant"), "подзадача");
            assert.equal(issueKind(synthesis, "assistant"), "синтез");

            const byId = issueByIdMap(issues);
            assert.equal(rootFromMap(nested, byId).id, "root");
            assert.equal(
              compactIssueLine(voice, agentById),
              "- todo        THE-101 child assignee=Платон Платон: вопрос о свободе",
            );
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
