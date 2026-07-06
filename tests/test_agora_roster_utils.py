import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ROSTER_UTILS = ROOT / "scripts" / "agora" / "roster-utils.mjs"


class AgoraRosterUtilsTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_roster_utils_preserve_tag_and_cli_arg_contracts(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{
              normalizeTag,
              parsePhilosophersArgs,
              rosterStatusLines,
              tagList,
              tagSummary,
              tagSummaryLines,
            }} from {json.dumps(ROSTER_UTILS.as_uri())};

            const roles = [
              {{ key: "plato", tags: ["classic", "ethics", "metaphysics"] }},
              {{ key: "aristotle", tags: ["classic", "ethics"] }},
              {{ key: "descartes", tags: ["method"] }},
              {{ key: "empty", tags: ["", null, "method"] }},
              {{ key: "missing" }},
            ];

            assert.deepEqual(tagList(roles[0]), ["classic", "ethics", "metaphysics"]);
            assert.deepEqual(tagList(roles[4]), []);
            assert.equal(normalizeTag("  Ethics  "), "ethics");
            assert.deepEqual(tagSummary(roles), [
              ["classic", 2],
              ["ethics", 2],
              ["method", 2],
              ["metaphysics", 1],
            ]);
            assert.deepEqual(tagSummaryLines(roles), [
              "# Теги философов",
              "- classic: 2",
              "- ethics: 2",
              "- method: 2",
              "- metaphysics: 1",
              "",
              "Всего тегов: 4",
              "Философов: 5",
            ]);

            const statusRoles = [
              {{ key: "plato", name: "Платон", tags: ["classic", "ethics"] }},
              {{ key: "aristotle", name: "Аристотель", tags: ["classic"] }},
              {{ key: "descartes", name: "Декарт", tags: ["method"] }},
            ];
            const agents = [
              {{ name: "Платон", status: "idle", metadata: {{ tags: ["classic"] }} }},
              {{ name: "Декарт", status: "done", metadata: {{ tags: ["method"] }} }},
              {{ name: "Agora Assistant / Синтезатор", status: "idle" }},
              {{ name: "Extra Agent", status: "error" }},
            ];
            assert.deepEqual(
              rosterStatusLines({{
                roles: statusRoles,
                agents,
                assistantName: "Agora Assistant / Синтезатор",
                tag: "classic",
              }}),
              [
                "# Философы в Paperclip: tag=classic",
                "- idle     Платон (plato) tags=classic, ethics metadata-tags=stale",
                "- missing  Аристотель (aristotle) tags=classic",
                "",
                "Итого философов: 1/2",
                "Фильтр tag=classic; всего в roster: 3",
                "Agora Assistant: idle",
                "Всего агентов в Paperclip: 4",
                "",
                "Лишние агенты не из активного roster:",
                "- error Extra Agent",
              ],
            );

            assert.deepEqual(parsePhilosophersArgs([]), {{ showTags: false, tag: "", help: false }});
            assert.deepEqual(parsePhilosophersArgs(["--tags"]), {{ showTags: true, tag: "", help: false }});
            assert.deepEqual(parsePhilosophersArgs(["теги"]), {{ showTags: true, tag: "", help: false }});
            assert.deepEqual(parsePhilosophersArgs(["--tag", " Ethics "]), {{
              showTags: false,
              tag: "ethics",
              help: false,
            }});
            assert.deepEqual(parsePhilosophersArgs(["--tag=Method"]), {{
              showTags: false,
              tag: "method",
              help: false,
            }});
            assert.deepEqual(parsePhilosophersArgs(["--help"]), {{ showTags: false, tag: "", help: true }});

            assert.throws(
              () => parsePhilosophersArgs(["--tag"]),
              /Usage: node scripts\\/agora\\.mjs philosophers --tag TAG/,
            );
            assert.throws(
              () => parsePhilosophersArgs(["--unknown"]),
              /Unknown philosophers option: --unknown/,
            );
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
