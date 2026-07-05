import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SESSION_BUILDERS = ROOT / "scripts" / "agora" / "session-builders.mjs"


class AgoraSessionBuildersTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_session_builders_preserve_task_description_contracts(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{
              buildDialogueDescription,
              buildDialogueWithContextDescription,
              buildFollowUpDescription,
              buildRootDescription,
              buildRoleDescription,
              buildSynthesisDescription,
              isPhilosophyChamber,
              modePolicy,
              roleLine,
            }} from {json.dumps(SESSION_BUILDERS.as_uri())};

            const philosophy = {{ id: "philosophy", name: "The Inner Agora" }};
            const board = {{
              id: "board-directors",
              name: "Board Directors",
              labels: {{ agent: "директор", agents: "директора", task: "решение" }},
            }};
            const plato = {{
              key: "plato",
              name: "Платон",
              title: "истина, форма и восхождение души",
              era: "Античность",
              centralIntuition: "форма делает опыт мыслимым",
              voice: "диалектическая",
              tension: "может недооценивать тело",
              architect: true,
            }};
            const cfo = {{
              key: "cfo",
              name: "CFO / Финансовый директор",
              title: "экономика решения, runway, стоимость ошибки",
              era: "Операционный менеджмент",
              centralIntuition: "решение должно пережить runway",
              voice: "сдержанная",
              tension: "может переоценить экономию",
            }};
            const rootIssue = {{
              id: "root-1",
              identifier: "THE-900",
              title: "Agora min: свобода",
              description: "Исходный вопрос:\\nЧто такое свобода?\\n\\nКак работать:",
            }};
            const transparencyText = "Пометки: отделяй реконструкцию от проверенного источника.";

            assert.equal(isPhilosophyChamber(philosophy), true);
            assert.equal(isPhilosophyChamber(board), false);
            assert.equal(roleLine(plato), "- Платон architect: истина, форма и восхождение души");
            assert.equal(modePolicy("min", philosophy), "Режим min: 3 голоса, быстрый первый разбор.");
            assert.equal(modePolicy("max", board), "Режим max: широкий совет ролей для выявления конфликтов, рисков и условий решения.");

            const rootDescription = buildRootDescription({{
              request: "Что такое свобода?",
              mode: "min",
              selected: [plato],
              chamber: philosophy,
            }});
            assert.ok(rootDescription.includes("Запрос пользователя для The Inner Agora."));
            assert.ok(rootDescription.includes("Выбранные философские машины:\\n- Платон architect: истина, форма и восхождение души"));
            assert.ok(rootDescription.includes("- Итоговый Agora Assistant memo должен сохранить конфликт, а не сгладить его."));

            const boardRoot = buildRootDescription({{
              request: "go/no-go по найму CTO",
              mode: "local",
              selected: [cfo],
              chamber: board,
            }});
            assert.ok(boardRoot.includes("Запрос пользователя для Board Directors."));
            assert.ok(boardRoot.includes("Выбранные участники (директора):\\n- CFO / Финансовый директор: экономика решения, runway, стоимость ошибки"));
            assert.ok(boardRoot.includes("- Тип корневой задачи: решение."));

            const roleDescription = buildRoleDescription({{
              rootIssue,
              request: "Что такое свобода?",
              mode: "min",
              philosopher: plato,
              chamber: philosophy,
              transparencyText,
            }});
            assert.ok(roleDescription.includes('Ты выступаешь как философская машина "Платон"'));
            assert.ok(roleDescription.includes("Корневая сессия: THE-900 — Agora min: свобода"));
            assert.ok(roleDescription.includes(transparencyText));
            assert.ok(roleDescription.includes("4. С кем из выбранных философов я бы спорил и почему."));

            const boardRole = buildRoleDescription({{
              rootIssue,
              request: "go/no-go по найму CTO",
              mode: "max",
              philosopher: cfo,
              chamber: board,
              transparencyText,
            }});
            assert.ok(boardRole.includes('Ты выступаешь как директор "CFO / Финансовый директор" в палате "Board Directors".'));
            assert.ok(boardRole.includes("Корневое решение: THE-900 — Agora min: свобода"));
            assert.ok(boardRole.includes("4. С кем из выбранных директора я бы спорил и почему."));

            const followUp = buildFollowUpDescription({{
              rootIssue,
              request: "уточни понятие долга",
              philosopher: plato,
              chamber: philosophy,
              transparencyText,
            }});
            assert.ok(followUp.includes("Follow-up к сессии: THE-900"));
            assert.ok(followUp.includes("Корневой вопрос: Что такое свобода?"));
            assert.ok(followUp.includes("Уточнение для роли: Платон"));
            assert.ok(followUp.endsWith(transparencyText));

            const dialogue = buildDialogueDescription({{
              request: "Как мне думать о заботе?",
              philosopher: plato,
              chamber: philosophy,
              transparencyText,
            }});
            assert.ok(dialogue.includes('Диалог пользователя с философской машиной "Платон"'));
            assert.ok(dialogue.includes("Веди живой философский диалог."));

            const contextual = buildDialogueWithContextDescription({{
              rootIssue,
              synthesisIssue: {{ id: "synth-1", identifier: "THE-999", title: "Синтез: свобода" }},
              synthesisText: "Свобода связана с ответственностью.".repeat(400),
              request: "А второе возражение?",
              philosopher: plato,
              chamber: philosophy,
              transparencyText,
            }});
            assert.ok(contextual.includes("Контекстный диалог с философской машиной"));
            assert.ok(contextual.includes("Корневой вопрос: Что такое свобода?"));
            assert.ok(contextual.includes("Синтез: THE-999 — Синтез: свобода"));
            assert.ok(contextual.includes("[... clipped"));
            assert.ok(contextual.includes(transparencyText));

            const synthesis = buildSynthesisDescription({{
              root: rootIssue,
              childBlocks: ["## THE-901: Платон\\n\\n### Comments\\n\\nОтвет Платона."],
            }});
            assert.ok(synthesis.startsWith("Agora Assistant: собери синтез философской сессии."));
            assert.ok(synthesis.includes("# THE-900: Agora min: свобода"));
            assert.ok(synthesis.includes("# Материалы философов"));
            assert.ok(synthesis.includes("Ответ Платона."));
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
