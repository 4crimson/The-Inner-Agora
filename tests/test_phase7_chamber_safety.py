import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHAMBER_SCHEMA = ROOT / "data" / "schema" / "chamber.schema.json"
BOARD_CHAMBER = ROOT / "chambers" / "board-directors" / "chamber.json"
SKILL_LOADER = ROOT / "scripts" / "skill-loader.mjs"
POLICY_LOADER = ROOT / "scripts" / "policy-loader.mjs"


def write_high_stakes_chamber(chambers_dir):
    chamber_dir = Path(chambers_dir) / "clinic"
    chamber_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "id": "clinic",
        "name": "Clinic Review",
        "description": "Temporary high-stakes chamber for safety tests.",
        "status": "research-only",
        "riskTier": "high-stakes",
        "labels": {
            "company": "clinic",
            "companies": "clinics",
            "agent": "reviewer",
            "agents": "reviewers",
            "task": "case",
            "tasks": "cases",
        },
        "roles": ["roles.json"],
        "presets": ["presets/mvp.json"],
        "synthesisRole": "reviewer",
        "transparencyPolicy": "source-citation",
        "allowedSkills": ["source-citation", "high-stakes-disclaimer"],
        "company": {
            "name": "Clinic Review",
            "projectName": "Clinic Review Sessions",
            "goalTitle": "Run high-stakes safety reviews",
            "companyId": None,
        },
    }
    (chamber_dir / "chamber.json").write_text(json.dumps(manifest), encoding="utf-8")
    return manifest


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

    def test_board_policy_command_outputs_business_language(self):
        result = self.run_node(POLICY_LOADER, "compose", "board-directors")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Протокол прозрачности для advisory-мемо", result.stdout)
        self.assertIn("условия решения", result.stdout)
        self.assertNotIn("Имитация голоса", result.stdout)

    def test_high_stakes_policy_appends_mandatory_disclaimer(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            write_high_stakes_chamber(temp_dir)
            result = self.run_node(POLICY_LOADER, "compose", "clinic", "--chambers-dir", temp_dir)

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Обязательный high-stakes дисклеймер", result.stdout)
        self.assertIn("не является медицинской, юридической или финансовой рекомендацией", result.stdout)


if __name__ == "__main__":
    unittest.main()
