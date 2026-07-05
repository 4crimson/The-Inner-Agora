import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WIZARD_UTILS = ROOT / "scripts" / "agora" / "wizard-utils.mjs"


class AgoraWizardUtilsTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_wizard_utils_preserve_slot_and_answer_parsing_contracts(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{
              chamberChoiceLines,
              parseWizardChamber,
              parseWizardMode,
              wizardCancelled,
              wizardConfirmed,
              wizardInitialSlots,
            }} from {json.dumps(WIZARD_UTILS.as_uri())};

            const chambers = [
              {{ id: "philosophy", name: "Философская палата" }},
              {{ id: "board-directors", name: "Совет директоров" }},
              {{ id: "research-lab", name: "Исследовательская лаборатория" }},
            ];

            assert.deepEqual(wizardInitialSlots(), {{
              intent: "new_session",
              chamber: null,
              mode: "balanced",
              topic: null,
              roles: [],
              taskRef: null,
              missingSlots: ["topic"],
              confidence: 0.8,
            }});
            assert.deepEqual(chamberChoiceLines(chambers), [
              "1. philosophy — Философская палата",
              "2. board-directors — Совет директоров",
              "3. research-lab — Исследовательская лаборатория",
            ]);

            assert.equal(parseWizardChamber("1", chambers, "philosophy"), "philosophy");
            assert.equal(parseWizardChamber("2", chambers, "philosophy"), "board-directors");
            assert.equal(parseWizardChamber("совет директоров", chambers, "philosophy"), "board-directors");
            assert.equal(parseWizardChamber("философия", chambers, "philosophy"), "philosophy");
            assert.equal(parseWizardChamber("исследовательская лаборатория", chambers, "philosophy"), "research-lab");
            assert.equal(parseWizardChamber("непонятно", chambers, "philosophy"), "");
            assert.equal(parseWizardChamber("1", [], "philosophy"), "philosophy");

            assert.equal(parseWizardMode("1"), "min");
            assert.equal(parseWizardMode("коротко"), "min");
            assert.equal(parseWizardMode("2"), "balanced");
            assert.equal(parseWizardMode("обычно"), "balanced");
            assert.equal(parseWizardMode("3"), "max");
            assert.equal(parseWizardMode("глубоко"), "max");
            assert.equal(parseWizardMode("не знаю"), "");

            assert.equal(wizardConfirmed("да"), true);
            assert.equal(wizardConfirmed("окей"), true);
            assert.equal(wizardConfirmed("пока нет"), false);
            assert.equal(wizardCancelled("нет"), true);
            assert.equal(wizardCancelled("стоп"), true);
            assert.equal(wizardCancelled("да"), false);
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
