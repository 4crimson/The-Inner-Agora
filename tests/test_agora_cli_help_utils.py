import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CLI_HELP_UTILS = ROOT / "scripts" / "agora" / "cli-help-utils.mjs"


class AgoraCliHelpUtilsTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_usage_text_preserves_top_level_cli_contract(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{ usageText }} from {json.dumps(CLI_HELP_UTILS.as_uri())};

            const text = usageText();
            assert.ok(text.startsWith("Usage:\\n  node scripts/agora.mjs prepare [local|balanced|max]"));
            assert.ok(text.includes('node scripts/agora.mjs ask --dry-run --philosophers socrates,kant "question"'));
            assert.ok(text.includes("node scripts/agora.mjs chamber [list|current|use <id>]"));
            assert.ok(text.includes("node scripts/agora.mjs costs [--json] [--limit N] [--since ISO|--hours N] [--pricing env|default|off|FILE]"));
            assert.ok(text.includes("Modes:\\n  council   fixed MVP council: Plato, Descartes, Heidegger"));
            assert.ok(text.endsWith("  all       every role in the current roster\\n"));
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
