import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STATE_OUTPUT_UTILS = ROOT / "scripts" / "agora" / "state-output-utils.mjs"


class AgoraStateOutputUtilsTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_state_output_utils_preserve_patches_and_cli_lines(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{
              activeChamberOutputLines,
              costSummaryOutputLines,
              decoratedCostLogEntries,
              issueStatePatch,
              modeOutputLines,
            }} from {json.dumps(STATE_OUTPUT_UTILS.as_uri())};

            assert.deepEqual(
              issueStatePatch(
                {{ id: "issue-id", identifier: "THE-7", title: "Root title", status: "done" }},
                {{ lastRootIssueRef: "THE-7" }},
                {{ now: "2026-07-05T12:00:00.000Z" }},
              ),
              {{
                lastRootIssueRef: "THE-7",
                lastIssueRef: "THE-7",
                lastIssueId: "issue-id",
                lastIssueTitle: "Root title",
                lastIssueStatus: "done",
                lastIssueSeenAt: "2026-07-05T12:00:00.000Z",
              }},
            );
            assert.deepEqual(issueStatePatch(null), null);

            assert.deepEqual(
              decoratedCostLogEntries(
                {{ costLog: [{{ kind: "llm", totalTokens: 12 }}] }},
                {{ lastRootIssueRef: "THE-1" }},
                {{ lastRootIssueRef: "STATE-ROOT", lastSynthesisRef: "THE-2" }},
                "natural",
              ),
              [{{ kind: "llm", totalTokens: 12, command: "natural", rootIssueRef: "THE-1", synthesisRef: "THE-2" }}],
            );
            assert.deepEqual(decoratedCostLogEntries({{ costLog: [] }}, {{}}, {{}}, "natural"), []);

            assert.deepEqual(
              costSummaryOutputLines({{
                session: {{
                  costLog: [
                    {{ promptTokens: 3, completionTokens: 4, totalTokens: 7 }},
                    {{ promptTokens: 5, completionTokens: 6, totalTokens: 11 }},
                  ],
                }},
              }}),
              [
                "Стоимость и токены:",
                "- Токены LLM: 18 total (prompt 8, completion 10, calls 2)",
                "",
              ],
            );
            assert.deepEqual(
              costSummaryOutputLines({{
                session: {{ costLog: [{{ promptTokens: 1, completionTokens: 2, totalTokens: 3 }}] }},
              }}, {{ markdown: true }}),
              [
                "## Стоимость и токены",
                "- Токены LLM: 3 total (prompt 1, completion 2, calls 1)",
                "",
              ],
            );
            assert.deepEqual(costSummaryOutputLines({{ session: {{ costLog: [] }} }}), []);

            assert.deepEqual(activeChamberOutputLines({{ id: "philosophy", name: "The Inner Agora" }}), [
              "activeChamberId=philosophy",
              "activeChamberName=The Inner Agora",
            ]);

            assert.deepEqual(
              modeOutputLines({{
                mode: "balanced",
                adapter: {{ name: "hermes_local", model: "model-a", reason: "default" }},
                statePath: "/tmp/state.json",
                state: {{ updatedAt: "2026-07-05T12:00:00.000Z" }},
              }}),
              [
                "mode=balanced",
                "adapter=hermes_local",
                "model=model-a",
                "reason=default",
                "state=/tmp/state.json",
                "updatedAt=2026-07-05T12:00:00.000Z",
              ],
            );
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
