import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODE_UTILS = ROOT / "scripts" / "agora" / "mode-utils.mjs"


class AgoraModeUtilsTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_mode_utils_preserve_cli_mode_and_voice_limit_rules(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{
              detectMode,
              normalizeMode,
              requestedVoiceLimit,
              selectedRoleLimit,
            }} from {json.dumps(MODE_UTILS.as_uri())};

            assert.equal(normalizeMode("минимум"), "min");
            assert.equal(normalizeMode("локально"), "local");
            assert.equal(normalizeMode("balance"), "balanced");
            assert.equal(normalizeMode("макс"), "max");
            assert.equal(normalizeMode("всё"), "all");
            assert.throws(() => normalizeMode("turbo"), /Unknown mode: turbo/);

            assert.equal(detectMode("позови всех философов", "balanced"), "all");
            assert.equal(detectMode("нужен глубокий разбор", "local"), "max");
            assert.equal(detectMode("быстро про свободу", "balanced"), "min");
            assert.equal(detectMode("обычный вопрос", "local"), "local");

            assert.equal(requestedVoiceLimit("пару философов про власть"), 2);
            assert.equal(requestedVoiceLimit("2-4 голоса про долг"), 4);
            assert.equal(requestedVoiceLimit("5 голосов про выбор"), null);
            assert.equal(requestedVoiceLimit("пять мыслей без слова философ"), null);

            assert.equal(selectedRoleLimit("пару философов про власть", "balanced"), 2);
            assert.equal(selectedRoleLimit("9 голосов про власть", "balanced"), 7);
            assert.equal(selectedRoleLimit("обычный вопрос", "local"), 5);
            assert.equal(selectedRoleLimit("обычный вопрос", "unknown"), 7);
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
