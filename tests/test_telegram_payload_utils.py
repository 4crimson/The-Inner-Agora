import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAYLOAD_UTILS = ROOT / "scripts" / "telegram" / "payload-utils.mjs"


class TelegramPayloadUtilsTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_payload_utils_preserve_keyboard_and_issue_contracts(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{
              byIssueNumber,
              byRecentIssue,
              buttonRows,
              callbackData,
              childrenOf,
              isSynthesisIssue,
              isTerminalIssue,
              issueNumber,
              issueRef,
              terminalStatusSet,
              voiceLabel,
            }} from {json.dumps(PAYLOAD_UTILS.as_uri())};

            const root = {{
              id: "root",
              identifier: "THE-10",
              issueNumber: 10,
              createdAt: "2026-07-05T10:00:00.000Z",
              updatedAt: "2026-07-05T10:05:00.000Z",
              title: "Agora balanced: freedom",
              status: "in_progress",
            }};
            const voiceA = {{
              id: "voice-a",
              parentId: "root",
              identifier: "THE-11",
              issueNumber: 11,
              createdAt: "2026-07-05T10:01:00.000Z",
              updatedAt: "2026-07-05T10:02:00.000Z",
              title: "Аристотель / ethics: freedom",
              status: "done",
            }};
            const voiceB = {{
              id: "voice-b",
              parentId: "root",
              identifier: "THE-12",
              issueNumber: 12,
              createdAt: "2026-07-05T10:02:00.000Z",
              updatedAt: "2026-07-05T10:01:00.000Z",
              title: "Фуко: freedom",
              status: "todo",
            }};
            const hidden = {{
              id: "hidden",
              parentId: "root",
              identifier: "THE-13",
              issueNumber: 13,
              title: "Hidden",
              hiddenAt: "2026-07-05T10:03:00.000Z",
            }};
            const synthesis = {{
              id: "synthesis",
              parentId: "root",
              identifier: "THE-14",
              issueNumber: 14,
              title: "Синтез: freedom",
              status: "done",
            }};

            assert.equal(issueRef(root), "THE-10");
            assert.equal(issueRef({{ id: "raw-id" }}), "raw-id");
            assert.equal(issueNumber({{ identifier: "THE-42" }}), 42);
            assert.equal(issueNumber({{ identifier: "missing" }}), 0);
            assert.deepEqual([voiceB, voiceA].sort(byIssueNumber).map(issueRef), ["THE-11", "THE-12"]);
            assert.deepEqual([voiceB, root, voiceA].sort(byRecentIssue).map(issueRef), ["THE-10", "THE-11", "THE-12"]);

            assert.deepEqual(childrenOf(root, [synthesis, hidden, voiceB, voiceA]).map(issueRef), [
              "THE-11",
              "THE-12",
              "THE-14",
            ]);
            assert.equal(voiceLabel(voiceA), "Аристотель");
            assert.equal(voiceLabel(synthesis), "THE-14");
            assert.equal(isSynthesisIssue(synthesis), true);
            assert.equal(isSynthesisIssue({{ title: "Executive summary: pricing" }}, "^Executive summary:"), true);

            const terminal = terminalStatusSet(["DONE", "blocked", "", "cancelled"]);
            assert.equal(terminal.has("done"), true);
            assert.equal(isTerminalIssue({{ status: "DONE" }}, terminal), true);
            assert.equal(isTerminalIssue({{ status: "todo" }}, terminal), false);

            assert.equal(callbackData("result", "THE-10", "pc"), "pc:result:THE-10");
            assert.deepEqual(
              buttonRows(
                [
                  {{ label: "Показать готовые", callback: "philosophers_ready", arg: "THE-10" }},
                  {{ text: "Философы", name: "philosophers", arg: "THE-10" }},
                  {{ label: "Назад", callback: "back_home" }},
                  {{ label: "", callback: "skip" }},
                ],
                {{ prefix: "pc", fallbackArg: "help" }},
              ),
              {{
                inline_keyboard: [
                  [
                    {{ text: "Показать готовые", callback_data: "pc:philosophers_ready:THE-10" }},
                    {{ text: "Философы", callback_data: "pc:philosophers:THE-10" }},
                  ],
                  [{{ text: "Назад", callback_data: "pc:back_home:help" }}],
                ],
              }},
            );
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
