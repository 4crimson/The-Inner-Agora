import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
START_UTILS = ROOT / "scripts" / "agora" / "start-utils.mjs"


class AgoraStartUtilsTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_start_utils_preserve_examples_and_onboarding_lines(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{
              buildStartExamples,
              startExampleForChamber,
              startOnboardingLines,
            }} from {json.dumps(START_UTILS.as_uri())};

            const chambers = [
              {{ id: "philosophy", name: "Философская палата", status: "active" }},
              {{ id: "board-directors", name: "Совет директоров", status: "research-only" }},
            ];
            assert.deepEqual(startExampleForChamber(chambers[0]), {{
              chamber: "philosophy",
              text: "давай спросим агору про свободу ребенка и власть родителей",
            }});
            assert.deepEqual(startExampleForChamber(chambers[1]), {{
              chamber: "board-directors",
              text: "совет директоров, нужен go/no-go по найму CTO",
            }});
            assert.deepEqual(buildStartExamples(chambers).map((item) => item.chamber), [
              "philosophy",
              "board-directors",
            ]);

            assert.deepEqual(
              startOnboardingLines({{
                title: "The Inner Agora",
                activeChamberId: "board-directors",
                routingMode: "llm",
                chambers,
                examples: buildStartExamples(chambers),
              }}),
              [
                "The Inner Agora",
                "",
                "Пиши обычным языком: я пойму вопрос, выберу палату и создам задачи в Paperclip.",
                "Понимание текста: локальная модель.",
                "",
                "Палаты:",
                "- philosophy: Философская палата",
                "* board-directors: Совет директоров",
                "",
                "Можно начать так:",
                "- давай спросим агору про свободу ребенка и власть родителей",
                "- совет директоров, нужен go/no-go по найму CTO",
              ],
            );
            assert.equal(
              startOnboardingLines({{
                title: "The Inner Agora",
                activeChamberId: "philosophy",
                routingMode: "regex",
                chambers: [chambers[0]],
                examples: [startExampleForChamber(chambers[0])],
              }})[3],
              "Понимание текста: детерминированный fallback.",
            );
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
