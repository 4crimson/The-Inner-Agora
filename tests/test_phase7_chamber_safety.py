import json
import os
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHAMBER_SCHEMA = ROOT / "data" / "schema" / "chamber.schema.json"
BOARD_CHAMBER = ROOT / "chambers" / "board-directors" / "chamber.json"
SKILL_LOADER = ROOT / "scripts" / "skill-loader.mjs"


class Phase7ChamberSafetyTests(unittest.TestCase):
    def run_node(self, *args, env=None):
        return subprocess.run(
            ["node", *map(str, args)],
            cwd=ROOT,
            env={**os.environ, **(env or {})},
            text=True,
            capture_output=True,
        )

    def test_chamber_schema_allows_research_only_and_risk_tier(self):
        schema = json.loads(CHAMBER_SCHEMA.read_text(encoding="utf-8"))

        self.assertIn("research-only", schema["properties"]["status"]["enum"])
        self.assertEqual(schema["properties"]["riskTier"]["enum"], ["reflective", "advisory", "high-stakes"])

    def test_board_chamber_is_research_only_with_business_policy(self):
        chamber = json.loads(BOARD_CHAMBER.read_text(encoding="utf-8"))

        self.assertEqual(chamber["status"], "research-only")
        self.assertEqual(chamber["riskTier"], "advisory")
        self.assertEqual(chamber["transparencyPolicy"], "business-advisory-transparency")
        self.assertIn("business-advisory-transparency", chamber["allowedSkills"])

    def test_policy_skills_are_installed(self):
        result = self.run_node(SKILL_LOADER, "list", "--json")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        ids = sorted(item["id"] for item in payload["skills"])
        self.assertIn("business-advisory-transparency", ids)
        self.assertIn("high-stakes-disclaimer", ids)


if __name__ == "__main__":
    unittest.main()
