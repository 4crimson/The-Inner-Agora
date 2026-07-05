import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ROLE_OUTPUT_UTILS = ROOT / "scripts" / "agora" / "role-output-utils.mjs"


class AgoraRoleOutputUtilsTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_role_output_utils_preserve_search_proposal_and_skill_lines(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{
              allRoleSkillsPayload,
              allRoleSkillsLines,
              publicSkill,
              roleProposalLines,
              roleProposalPayload,
              roleSearchLines,
              resolvedRoleSkillsPayload,
              singleRoleSkillsLines,
            }} from {json.dumps(ROLE_OUTPUT_UTILS.as_uri())};

            assert.deepEqual(
              roleSearchLines({{
                selected: {{ name: "Платон", key: "plato" }},
                matches: [],
              }}),
              ["Платон (plato)"],
            );
            assert.deepEqual(
              roleSearchLines({{
                selected: null,
                matches: [
                  {{ name: "Платон", key: "plato" }},
                  {{ name: "Декарт", key: "descartes" }},
                ],
              }}),
              ["Платон (plato)", "Декарт (descartes)"],
            );
            assert.deepEqual(roleSearchLines({{ selected: null, matches: [] }}), ["No matching philosophers found."]);

            const proposal = roleProposalPayload({{
              topic: "свобода",
              mode: "balanced",
              roles: [
                {{ key: "plato", name: "Платон", englishName: "Plato", title: "форма" }},
                {{ key: "aristotle", name: "Аристотель", englishName: "Aristotle", centralIntuition: "практика" }},
              ],
            }});
            assert.deepEqual(proposal, {{
              topic: "свобода",
              mode: "balanced",
              roles: [
                {{ key: "plato", name: "Платон", englishName: "Plato", reason: "форма" }},
                {{ key: "aristotle", name: "Аристотель", englishName: "Aristotle", reason: "практика" }},
              ],
            }});
            assert.deepEqual(roleProposalLines(proposal), [
              "По этой теме я бы собрал 2 философов:",
              "",
              "Платон — форма",
              "Аристотель — практика",
            ]);

            assert.deepEqual(publicSkill({{
              id: "web-research",
              name: "Web research",
              description: "Search",
              riskTier: "L1",
              allowedTools: ["web"],
              internalOnly: true,
            }}), {{
              id: "web-research",
              name: "Web research",
              description: "Search",
              riskTier: "L1",
              allowedTools: ["web"],
            }});

            const resolved = resolvedRoleSkillsPayload({{
              chamber: {{ id: "philosophy" }},
              role: {{ key: "plato", name: "Платон" }},
              resolved: {{
                skills: [
                  {{ id: "source-citation", name: "Sources", description: "Cite", riskTier: "L1", allowedTools: [] }},
                  {{ id: "web-research", name: "Web", description: "Search", riskTier: "L1", allowedTools: ["web"] }},
                ],
                diagnostics: [{{ level: "warn", message: "optional skill skipped" }}],
              }},
            }});
            assert.deepEqual(resolved, {{
              chamberId: "philosophy",
              roleKey: "plato",
              roleName: "Платон",
              skills: [
                {{ id: "source-citation", name: "Sources", description: "Cite", riskTier: "L1", allowedTools: [] }},
                {{ id: "web-research", name: "Web", description: "Search", riskTier: "L1", allowedTools: ["web"] }},
              ],
              diagnostics: [{{ level: "warn", message: "optional skill skipped" }}],
            }});
            assert.deepEqual(singleRoleSkillsLines(resolved), [
              "Платон (plato)",
              "- source-citation L1",
              "- web-research L1 tools=web",
              "! warn: optional skill skipped",
            ]);
            assert.deepEqual(
              singleRoleSkillsLines({{ ...resolved, skills: [], diagnostics: [] }}),
              ["Платон (plato)", "- no resolved skills"],
            );

            const allPayload = allRoleSkillsPayload({{
              chamber: {{ id: "philosophy", name: "The Inner Agora" }},
              roles: [resolved, {{ ...resolved, roleKey: "aristotle", skills: [] }}],
            }});
            assert.deepEqual(allRoleSkillsLines(allPayload), [
              "Skills: The Inner Agora",
              "- plato: source-citation, web-research",
              "- aristotle: -",
            ]);
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
