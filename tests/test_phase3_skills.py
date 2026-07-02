import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL_SCHEMA = ROOT / "data" / "schema" / "skill.schema.json"
SKILL_LOADER = ROOT / "scripts" / "skill-loader.mjs"
ROLE_SCHEMA = ROOT / "data" / "schema" / "role.schema.json"
BOARD_ROLES = ROOT / "chambers" / "board-directors" / "roles.json"


class Phase3SkillTests(unittest.TestCase):
    def run_node(self, *args, env=None):
        return subprocess.run(
            ["node", *map(str, args)],
            cwd=ROOT,
            env={**os.environ, **(env or {})},
            text=True,
            capture_output=True,
        )

    def test_skill_schema_contract(self):
        schema = json.loads(SKILL_SCHEMA.read_text(encoding="utf-8"))

        self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertEqual(schema["title"], "Inner Agora Skill Manifest")
        self.assertEqual(schema["type"], "object")
        self.assertFalse(schema["additionalProperties"])
        for field in ["id", "name", "description", "riskTier", "allowedTools"]:
            self.assertIn(field, schema["required"])
        self.assertEqual(schema["properties"]["riskTier"]["enum"], ["L0", "L1", "L2", "L3"])

    def test_skill_loader_rejects_manifest_missing_required_field(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            skill_dir = Path(temp_dir) / "broken"
            skill_dir.mkdir()
            (skill_dir / "skill.json").write_text(
                json.dumps(
                    {
                        "id": "broken",
                        "name": "Broken Skill",
                        "description": "Missing risk tier.",
                        "allowedTools": [],
                    }
                ),
                encoding="utf-8",
            )

            result = self.run_node(SKILL_LOADER, "validate", "--skills-dir", temp_dir)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing required field", result.stderr)
        self.assertIn("riskTier", result.stderr)

    def test_resolve_skills_filters_disallowed_skill_with_warning(self):
        result = self.run_node(SKILL_LOADER, "resolve-fixture", "--json")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual([item["id"] for item in payload["skills"]], ["source-citation"])
        self.assertIn("not allowed by chamber", payload["diagnostics"][0]["message"])


if __name__ == "__main__":
    unittest.main()
