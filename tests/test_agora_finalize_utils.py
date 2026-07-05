import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FINALIZE_UTILS = ROOT / "scripts" / "agora" / "finalize-utils.mjs"


class AgoraFinalizeUtilsTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_finalize_utils_collect_visible_issue_tree(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{
              collectSubtree,
              visibleChildren,
            }} from {json.dumps(FINALIZE_UTILS.as_uri())};

            const root = {{
              id: "root",
              identifier: "THE-1",
              issueNumber: 1,
              title: "Root",
            }};
            const childTen = {{
              id: "child-10",
              parentId: "root",
              identifier: "THE-10",
              issueNumber: 10,
              title: "Child 10",
            }};
            const childTwo = {{
              id: "child-2",
              parentId: "root",
              identifier: "THE-2",
              issueNumber: 2,
              title: "Child 2",
            }};
            const hidden = {{
              id: "hidden",
              parentId: "root",
              identifier: "THE-3",
              issueNumber: 3,
              hiddenAt: "2026-07-05T10:00:00.000Z",
              title: "Hidden",
            }};
            const grandchild = {{
              id: "grandchild",
              parentId: "child-2",
              identifier: "THE-4",
              issueNumber: 4,
              title: "Grandchild",
            }};
            const hiddenGrandchild = {{
              id: "hidden-grandchild",
              parentId: "child-2",
              identifier: "THE-5",
              issueNumber: 5,
              hiddenAt: "2026-07-05T10:01:00.000Z",
              title: "Hidden grandchild",
            }};

            const result = collectSubtree(root, [
              childTen,
              hidden,
              grandchild,
              root,
              childTwo,
              hiddenGrandchild,
            ]);

            assert.deepEqual(
              result.items.map((item) => [item.issue.id, item.depth]),
              [
                ["child-2", 1],
                ["grandchild", 2],
                ["child-10", 1],
              ],
            );
            assert.deepEqual([...result.byParent.keys()].sort(), ["child-2", "root"]);
            assert.deepEqual(visibleChildren(root, result.byParent).map((issue) => issue.id), ["child-2", "child-10"]);
            assert.deepEqual(visibleChildren(childTwo, result.byParent).map((issue) => issue.id), ["grandchild"]);
            assert.deepEqual(visibleChildren(hidden, result.byParent), []);
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
