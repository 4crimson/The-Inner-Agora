import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHAMBER_UTILS = ROOT / "scripts" / "agora" / "chamber-utils.mjs"


class AgoraChamberUtilsTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_chamber_utils_preserve_active_chamber_source_and_company_contracts(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{
              activeChamberCompanyConfigFromChamber,
              activeChamberIdFromState,
              chamberRelativePath,
              resolveMvpPresetPath,
              resolveRoleSourcePath,
            }} from {json.dumps(CHAMBER_UTILS.as_uri())};

            const env = {{}};
            const chamber = {{
              id: "board-directors",
              name: "Board",
              roles: ["roles.json"],
              presets: ["presets/mvp.json"],
              company: {{
                companyId: null,
                name: "Board Company",
                projectName: "Board Project",
                goalTitle: "Board Goal",
              }},
            }};

            assert.equal(
              activeChamberIdFromState({{
                env,
                state: {{ activeChamberId: "state-chamber" }},
                profile: {{ preferredChamberId: "profile-chamber" }},
                defaultChamberId: "philosophy",
              }}),
              "state-chamber",
            );
            assert.equal(
              activeChamberIdFromState({{
                env: {{ INNER_AGORA_ACTIVE_CHAMBER: "env-chamber" }},
                state: {{ activeChamberId: "state-chamber" }},
                profile: {{ preferredChamberId: "profile-chamber" }},
                defaultChamberId: "philosophy",
              }}),
              "env-chamber",
            );

            assert.equal(
              chamberRelativePath("/repo/chambers", chamber, "roles.json"),
              "/repo/chambers/board-directors/roles.json",
            );
            assert.equal(chamberRelativePath("/repo/chambers", chamber, "/tmp/roles.json"), "/tmp/roles.json");

            assert.equal(
              resolveRoleSourcePath({{
                env,
                activeChamberId: "philosophy",
                defaultChamberId: "philosophy",
                chambersDir: "/repo/chambers",
                chamber,
              }}),
              "/repo/chambers/board-directors/roles.json",
            );
            assert.equal(
              resolveMvpPresetPath({{
                env,
                activeChamberId: "philosophy",
                defaultChamberId: "philosophy",
                chambersDir: "/repo/chambers",
                chamber,
              }}),
              "/repo/chambers/board-directors/presets/mvp.json",
            );
            assert.equal(
              resolveMvpPresetPath({{
                env: {{ INNER_AGORA_MVP_PRESET_PATH: "/tmp/custom.json" }},
                activeChamberId: "philosophy",
                defaultChamberId: "philosophy",
                chambersDir: "/repo/chambers",
                chamber,
              }}),
              "/tmp/custom.json",
            );

            assert.deepEqual(
              activeChamberCompanyConfigFromChamber(chamber, {{
                INNER_AGORA_COMPANY_ID: "company-env",
                INNER_AGORA_COMPANY_NAME: "Name Env",
                INNER_AGORA_PROJECT_NAME: "Project Env",
                INNER_AGORA_GOAL_TITLE: "Goal Env",
              }}),
              {{
                chamber,
                companyId: "company-env",
                companyName: "Name Env",
                projectName: "Project Env",
                goalTitle: "Goal Env",
              }},
            );
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
