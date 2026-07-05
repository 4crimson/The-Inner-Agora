import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SESSION_OUTPUT = ROOT / "scripts" / "agora" / "session-output.mjs"


class AgoraSessionOutputTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_session_output_preserves_cli_readout_contracts(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{
              availableVoiceLines,
              commandVoiceName,
              sessionActionLines,
              voiceChildScore,
            }} from {json.dumps(SESSION_OUTPUT.as_uri())};

            const agentById = new Map([
              ["assistant", {{ name: "Agora Assistant / Синтезатор" }}],
              ["plato-agent", {{ name: "Платон / Plato" }}],
              ["descartes-agent", {{ name: "Декарт / Descartes" }}],
            ]);
            const root = {{ id: "root-id", identifier: "THE-100" }};
            const synthesis = {{ id: "synth-id", identifier: "THE-105" }};
            const platoVoice = {{
              id: "voice-1",
              identifier: "THE-101",
              title: "Платон: свобода и форма",
              assigneeAgentId: "plato-agent",
            }};
            const assistantChild = {{
              id: "assistant-child",
              identifier: "THE-102",
              title: "Синтез: пакет",
              assigneeAgentId: "assistant",
            }};
            const fallbackChild = {{
              id: "voice-2",
              identifier: "THE-103",
              title: "Заметка без назначенного агента",
            }};

            assert.equal(commandVoiceName(platoVoice, agentById), "Платон");
            assert.equal(commandVoiceName(assistantChild, agentById), "");
            assert.equal(
              commandVoiceName({{ title: "Без двоеточия", assigneeAgentId: "descartes-agent" }}, agentById),
              "Без двоеточия",
            );

            assert.deepEqual(
              sessionActionLines(root, [platoVoice, fallbackChild], synthesis, agentById),
              [
                "",
                "Дальше:",
                "- Синтез: /agora result THE-105",
                "- Платон: /agora voice Платон THE-100",
                "- Заметка без назначенного агента: /agora voice Заметка без назначенного агента THE-100",
              ],
            );
            assert.deepEqual(
              sessionActionLines(root, [], null, agentById),
              ["", "Дальше:", "- Собрать синтез: /agora synth THE-100"],
            );
            assert.deepEqual(sessionActionLines({{}}, [], null, agentById), []);

            assert.deepEqual(availableVoiceLines([], agentById), [
              "- В этой сессии пока нет отдельных философских задач.",
            ]);
            assert.deepEqual(availableVoiceLines([platoVoice, fallbackChild], agentById), [
              "- Платон / Plato: THE-101",
              "- Заметка без назначенного агента: THE-103",
            ]);

            const philosopher = {{
              key: "plato",
              name: "Платон",
              englishName: "Plato",
              aliases: ["платоновский"],
            }};
            assert.ok(voiceChildScore(platoVoice, philosopher, agentById) > 0);
            assert.equal(voiceChildScore(fallbackChild, philosopher, agentById), 0);
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
