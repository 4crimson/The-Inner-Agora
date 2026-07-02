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

    def test_skill_loader_lists_starter_skills(self):
        result = self.run_node(SKILL_LOADER, "list", "--json")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(
            sorted(item["id"] for item in payload["skills"]),
            ["memory-export", "source-citation", "web-research"],
        )

    def test_source_citation_prompt_exposes_transparency_policy(self):
        result = self.run_node(SKILL_LOADER, "prompt", "source-citation", "--json")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        self.assertIn("Протокол прозрачности", payload["prompt"])
        self.assertIn("[источник]", payload["prompt"])

    def test_role_schema_allows_skills_array(self):
        schema = json.loads(ROLE_SCHEMA.read_text(encoding="utf-8"))

        self.assertIn("skills", schema["properties"])
        self.assertEqual(schema["properties"]["skills"]["items"]["type"], "string")

    def test_board_product_role_requests_web_research(self):
        roles = json.loads(BOARD_ROLES.read_text(encoding="utf-8"))
        product = next(role for role in roles if role["key"] == "product")

        self.assertIn("web-research", product["skills"])

    def test_l2_skill_missing_chamber_allowlist_is_error(self):
        result = self.run_node(SKILL_LOADER, "resolve-fixture", "--json", "--risk-fixture")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["skills"], [])
        self.assertEqual(payload["diagnostics"][0]["level"], "error")

    def test_agora_policy_command_reads_source_citation_skill(self):
        result = self.run_node(ROOT / "scripts" / "agora.mjs", "policy", "source-citation")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Протокол прозрачности", result.stdout)
        self.assertIn("[современный перенос]", result.stdout)

    def test_importer_chamber_config_reports_source_citation_policy(self):
        result = self.run_node(ROOT / "scripts" / "import-inner-agora.mjs", "--print-chamber-config")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("transparencyPolicy=source-citation", result.stdout)

    def test_agora_skills_lists_active_chamber_role_skills(self):
        result = self.run_node(
            ROOT / "scripts" / "agora.mjs",
            "skills",
            "product",
            "--json",
            env={"INNER_AGORA_ACTIVE_CHAMBER": "board-directors"},
        )

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["roleKey"], "product")
        self.assertIn("web-research", [skill["id"] for skill in payload["skills"]])
        self.assertEqual(payload["diagnostics"], [])

    def test_agora_skills_reports_unknown_role_human_readably(self):
        result = self.run_node(ROOT / "scripts" / "agora.mjs", "skills", "unknown-role")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unknown role", result.stderr)


if __name__ == "__main__":
    unittest.main()
