import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ROLE_SELECTION = ROOT / "scripts" / "agora" / "role-selection.mjs"


class AgoraRoleSelectionTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_role_selection_preserves_philosophy_and_chamber_policy(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{
              selectChamberRoles,
              selectPhilosophyRoles,
              selectRoles,
            }} from {json.dumps(ROLE_SELECTION.as_uri())};

            const philosophyRoles = [
              ["plato", "Платон", "forms"],
              ["descartes", "Декарт", "method"],
              ["heidegger", "Хайдеггер", "being"],
              ["socrates", "Сократ", "questions"],
              ["sartre", "Жан-Поль Сартр", "freedom"],
              ["beauvoir", "Симона де Бовуар", "freedom"],
              ["camus", "Альбер Камю", "absurd"],
              ["berdyaev", "Николай Бердяев", "freedom"],
              ["diogenes", "Диоген", "cynic"],
              ["epictetus", "Эпиктет", "stoic"],
              ["epicurus", "Эпикур", "pleasure"],
              ["nietzsche", "Ницше", "values"],
              ["rousseau", "Руссо", "society"],
              ["aristotle", "Аристотель", "measure"],
              ["foucault", "Фуко", "power"],
              ["kant", "Кант", "duty"],
            ].map(([key, name, title]) => ({{
              key,
              name,
              englishName: key,
              aliases: [key, name],
              title,
              centralIntuition: title,
              tags: [title],
              architect: ["plato", "descartes", "heidegger"].includes(key),
            }}));

            const explicit = selectRoles({{
              roles: philosophyRoles,
              request: "что такое долг",
              mode: "balanced",
              roleList: "socrates,kant,socrates",
            }});
            assert.deepEqual(explicit.map((role) => role.key), ["socrates", "kant"]);

            assert.throws(
              () => selectRoles({{ roles: philosophyRoles, request: "x", mode: "min", roleList: "unknown" }}),
              /No known philosophers in --philosophers unknown/,
            );

            assert.deepEqual(
              selectRoles({{ roles: philosophyRoles, request: "x", mode: "all" }}).map((role) => role.key),
              philosophyRoles.map((role) => role.key),
            );

            assert.deepEqual(
              selectPhilosophyRoles({{
                roles: philosophyRoles,
                request: "что такое свобода",
                mode: "min",
              }}).map((role) => role.key),
              ["plato", "descartes", "heidegger"],
            );

            assert.deepEqual(
              selectPhilosophyRoles({{
                roles: philosophyRoles,
                request: "пару философов про свободу",
                mode: "balanced",
              }}).map((role) => role.key),
              ["plato", "descartes"],
            );

            assert.deepEqual(
              selectPhilosophyRoles({{
                roles: philosophyRoles,
                request: "свобода и долг",
                mode: "min",
                options: {{ noArchitects: true }},
              }}).map((role) => role.key),
              ["socrates", "aristotle", "diogenes"],
            );

            const boardRoles = [
              {{
                key: "ceo",
                name: "CEO / Исполнительный директор",
                englishName: "Chief Executive Officer",
                aliases: ["ceo", "cto"],
                title: "strategy and accountability",
                centralIntuition: "decision",
                tags: ["strategy", "cto"],
              }},
              {{
                key: "cfo",
                name: "CFO / Финансовый директор",
                englishName: "Chief Financial Officer",
                aliases: ["cfo", "runway"],
                title: "runway and cost",
                centralIntuition: "finance",
                tags: ["finance", "runway"],
              }},
              {{
                key: "legal",
                name: "Legal / Юридический советник",
                englishName: "Legal Counsel",
                aliases: ["legal"],
                title: "contracts and liability",
                centralIntuition: "law",
                tags: ["legal"],
              }},
            ];

            assert.deepEqual(
              selectChamberRoles({{
                roles: boardRoles,
                request: "runway",
                mode: "min",
                mvpRoleKeys: ["ceo", "legal"],
              }}).map((role) => role.key),
              ["cfo", "ceo", "legal"],
            );

            assert.deepEqual(
              selectRoles({{
                roles: boardRoles,
                request: "runway",
                mode: "local",
                activeChamberId: "board-directors",
                mvpRoleKeys: ["ceo"],
              }}).map((role) => role.key),
              ["cfo", "ceo", "legal"],
            );
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
