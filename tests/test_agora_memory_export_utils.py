import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MEMORY_EXPORT_UTILS = ROOT / "scripts" / "agora" / "memory-export-utils.mjs"


class AgoraMemoryExportUtilsTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_memory_export_utils_preserve_markdown_and_path_contract(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{
              memoryExportFileName,
              memoryExportMarkdown,
              memoryExportPath,
            }} from {json.dumps(MEMORY_EXPORT_UTILS.as_uri())};

            const issue = {{
              id: "issue-1",
              identifier: "THE-42",
              title: "Freedom / Power #1",
              status: "done",
              createdAt: "2026-07-05T10:00:00.000Z",
              updatedAt: "2026-07-05T11:00:00.000Z",
              description: "Root description",
            }};
            const comments = [
              {{
                authorType: "agent",
                createdAt: "2026-07-05T10:10:00.000Z",
                body: "First comment",
              }},
              {{
                body: "Second comment",
              }},
            ];

            assert.equal(memoryExportFileName(issue), "THE-42-Freedom-Power-1.md");
            assert.equal(memoryExportPath("/tmp/memory", issue), "/tmp/memory/THE-42-Freedom-Power-1.md");

            assert.equal(
              memoryExportMarkdown(issue, comments),
              [
                "---",
                "paperclip_id: \\"issue-1\\"",
                "identifier: \\"THE-42\\"",
                "status: \\"done\\"",
                "created: \\"2026-07-05T10:00:00.000Z\\"",
                "updated: \\"2026-07-05T11:00:00.000Z\\"",
                "source: paperclip",
                "---",
                "",
                "# THE-42: Freedom / Power #1",
                "",
                "Paperclip: http://127.0.0.1:3100/issues/issue-1",
                "",
                "## Description",
                "",
                "Root description",
                "",
                "## Comments",
                "",
                "### agent 2026-07-05T10:10:00.000Z\\n\\nFirst comment\\n\\n### unknown \\n\\nSecond comment",
                "",
              ].join("\\n"),
            );
            assert.ok(memoryExportMarkdown(issue, comments).endsWith("\\n"));
            assert.equal(memoryExportMarkdown({{ id: "id-2", title: "" }}, []), [
              "---",
              "paperclip_id: \\"id-2\\"",
              "identifier: \\"\\"",
              "status: \\"\\"",
              "created: \\"\\"",
              "updated: \\"\\"",
              "source: paperclip",
              "---",
              "",
              "# id-2: ",
              "",
              "Paperclip: http://127.0.0.1:3100/issues/id-2",
              "",
              "## Description",
              "",
              "",
              "",
              "## Comments",
              "",
              "No comments.",
              "",
            ].join("\\n"));
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
