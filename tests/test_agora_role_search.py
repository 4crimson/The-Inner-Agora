import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ROLE_SEARCH = ROOT / "scripts" / "agora" / "role-search.mjs"


class AgoraRoleSearchTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_role_search_module_is_roster_scoped_and_fuzzy(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{
              genericRoleScore,
              roleAliases,
              roleByToken,
              roleFromText,
              roleScoreInText,
              searchRoles,
              uniqueRoles,
            }} from {json.dumps(ROLE_SEARCH.as_uri())};

            const roles = [
              {{
                key: "plato",
                name: "Платон",
                englishName: "Plato",
                aliases: ["platon"],
                title: "forms and truth",
                centralIntuition: "idea and ascent",
                tags: ["truth"],
              }},
              {{
                key: "foucault",
                name: "Фуко",
                englishName: "Foucault",
                aliases: ["fuko"],
                title: "power and knowledge",
                centralIntuition: "discipline",
                tags: ["power"],
              }},
              {{
                key: "cfo",
                name: "CFO / Финансовый директор",
                englishName: "Chief Financial Officer",
                aliases: ["финансы", "runway"],
                title: "runway and cost of error",
                centralIntuition: "unit economics",
                tags: ["finance"],
              }},
            ];

            assert.deepEqual(roleAliases(roles[0]), ["plato", "Платон", "Plato", "platon"]);
            assert.equal(roleByToken(roles, "платона").key, "plato");
            assert.equal(roleByToken(roles, "FOUCAULT").key, "foucault");

            const search = searchRoles(roles, "платона", 2);
            assert.equal(search.query, "платона");
            assert.equal(search.selected.key, "plato");
            assert.equal(search.matches[0].key, "plato");

            assert.equal(roleFromText(roles, "дай голос Фуко").key, "foucault");
            assert.ok(roleScoreInText(roles[0], "поговори с Платоном") > 0);
            assert.equal(genericRoleScore(roles[2], "runway"), 1);
            assert.deepEqual(uniqueRoles([roles[0], roles[0], null, roles[1]]).map((role) => role.key), ["plato", "foucault"]);
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
