import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PREFLIGHT_UTILS = ROOT / "scripts" / "agora" / "preflight-utils.mjs"


class AgoraPreflightUtilsTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_all_mode_preflight_requires_explicit_confirmation_for_large_runs(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{
              allModePreflight,
              allModePreflightLines,
            }} from {json.dumps(PREFLIGHT_UTILS.as_uri())};

            const selected = Array.from({{ length: 84 }}, (_, index) => ({{
              key: `role-${{index + 1}}`,
              name: `Role ${{index + 1}}`,
            }}));

            const blocked = allModePreflight({{
              mode: "all",
              selected,
              request: "разбери всеми философами тему власти",
            }});
            assert.equal(blocked.ok, false);
            assert.equal(blocked.requiresConfirmation, true);
            assert.equal(blocked.roleCount, 84);
            assert.match(blocked.message, /84 голос/);
            assert.match(blocked.message, /84 child-задач/);
            assert.match(blocked.message, /--confirm-all/);
            assert.equal(allModePreflightLines(blocked)[0], "# Нужна проверка");

            assert.equal(allModePreflight({{ mode: "all", selected, confirmAll: true }}).ok, true);
            assert.equal(allModePreflight({{ mode: "all", selected, dryRun: true }}).ok, true);
            assert.equal(allModePreflight({{ mode: "max", selected }}).ok, true);
            assert.equal(allModePreflight({{ mode: "all", selected: selected.slice(0, 3) }}).ok, true);
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
