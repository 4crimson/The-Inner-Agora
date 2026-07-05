import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AGORA_SCRIPT = ROOT / "scripts" / "agora.mjs"
IMPORT_SCRIPT = ROOT / "scripts" / "import-inner-agora.mjs"
MIGRATE_SCRIPT = ROOT / "scripts" / "migrate-roles.mjs"
LEGACY_ROLES = ROOT / "data" / "philosophers.json"
CHAMBER_ROLES = ROOT / "chambers" / "philosophy" / "roles.json"
ROLE_SCHEMA = ROOT / "data" / "schema" / "role.schema.json"


class Phase1RoleMigrationTests(unittest.TestCase):
    def run_node(self, *args, env=None, check=False):
        merged_env = {
            **os.environ,
            "INNER_AGORA_AUTO_RESTART_PAPERCLIP": "0",
            **(env or {}),
        }
        return subprocess.run(
            ["node", *map(str, args)],
            cwd=ROOT,
            env=merged_env,
            text=True,
            capture_output=True,
            check=check,
        )

    def test_role_schema_contract(self):
        schema = json.loads(ROLE_SCHEMA.read_text(encoding="utf-8"))

        self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertEqual(schema["title"], "Inner Agora Council Role")
        self.assertEqual(schema["type"], "object")

        required = set(schema["required"])
        for field in [
            "key",
            "name",
            "englishName",
            "era",
            "title",
            "aliases",
            "tags",
            "centralIntuition",
            "voice",
            "tension",
            "chamberId",
            "riskTier",
        ]:
            self.assertIn(field, required)

        properties = schema["properties"]
        self.assertEqual(properties["riskTier"]["enum"], ["reflective", "advisory", "high-stakes"])
        self.assertEqual(properties["chamberId"]["pattern"], "^[a-z0-9][a-z0-9-]*$")
        self.assertFalse(schema["additionalProperties"])

    def test_migrated_roles_preserve_legacy_roster(self):
        check = self.run_node(MIGRATE_SCRIPT, "--check")
        self.assertEqual(check.returncode, 0, check.stdout + check.stderr)
        self.assertIn("roles migration check ok", check.stdout)

        legacy = json.loads(LEGACY_ROLES.read_text(encoding="utf-8"))
        migrated = json.loads(CHAMBER_ROLES.read_text(encoding="utf-8"))

        self.assertEqual(len(migrated), len(legacy))
        self.assertEqual([item["key"] for item in migrated], [item["key"] for item in legacy])

        for legacy_role, migrated_role in zip(legacy, migrated):
            for key, value in legacy_role.items():
                self.assertEqual(migrated_role[key], value)
            self.assertEqual(migrated_role["chamberId"], "philosophy")
            self.assertEqual(migrated_role["riskTier"], "reflective")

    def test_chamber_roles_are_default_and_chamber_mode_no_longer_selects_legacy(self):
        default_result = self.run_node(IMPORT_SCRIPT, "--print-roles")
        legacy_env_result = self.run_node(IMPORT_SCRIPT, "--print-roles", env={"CHAMBER_MODE": "legacy"})

        self.assertEqual(default_result.returncode, 0, default_result.stdout + default_result.stderr)
        self.assertEqual(legacy_env_result.returncode, 0, legacy_env_result.stdout + legacy_env_result.stderr)
        self.assertIn("source=chambers/philosophy/roles.json", default_result.stdout)
        self.assertIn("source=chambers/philosophy/roles.json", legacy_env_result.stdout)
        self.assertNotIn("source=data/philosophers.json", default_result.stdout)
        self.assertNotIn("source=data/philosophers.json", legacy_env_result.stdout)

    def test_importer_loads_chamber_roles_in_print_mode(self):
        result = self.run_node(IMPORT_SCRIPT, "--print-roles")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("source=chambers/philosophy/roles.json", result.stdout)
        self.assertIn("role=socrates chamberId=philosophy riskTier=reflective", result.stdout)
        self.assertIn("role=agora-assistant chamberId=philosophy riskTier=reflective", result.stdout)

    def test_council_reads_mvp_preset_file(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            preset_path = Path(temp_dir) / "mvp.json"
            preset_path.write_text(
                json.dumps(
                    {
                        "id": "mvp-test",
                        "name": "Test MVP council",
                        "roleKeys": ["socrates", "diogenes", "plato"],
                    }
                ),
                encoding="utf-8",
            )

            result = self.run_node(
                AGORA_SCRIPT,
                "council",
                "--dry-run",
                "Что такое свобода?",
                env={"INNER_AGORA_MVP_PRESET_PATH": str(preset_path)},
            )

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("voices=Сократ, Диоген, Платон", result.stdout)
        self.assertNotIn("voices=Платон, Декарт, Хайдеггер", result.stdout)

    def test_philosopher_tags_are_local_and_do_not_require_paperclip(self):
        result = self.run_node(
            AGORA_SCRIPT,
            "philosophers",
            "--tags",
            env={"PAPERCLIP_API_BASE": "http://127.0.0.1:9/api"},
        )

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("# Теги философов", result.stdout)
        self.assertIn("Философов: 84", result.stdout)


if __name__ == "__main__":
    unittest.main()
