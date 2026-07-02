import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHAMBER_SCHEMA = ROOT / "data" / "schema" / "chamber.schema.json"
PHILOSOPHY_CHAMBER = ROOT / "chambers" / "philosophy" / "chamber.json"
CHAMBER_LOADER = ROOT / "scripts" / "chamber-loader.mjs"
COCKPIT_CONFIG = ROOT / "paperclip-cockpit.json"


class Phase2ChamberTests(unittest.TestCase):
    def run_node(self, *args):
        return subprocess.run(
            ["node", *map(str, args)],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_chamber_schema_contract(self):
        schema = json.loads(CHAMBER_SCHEMA.read_text(encoding="utf-8"))

        self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertEqual(schema["title"], "Inner Agora Chamber Manifest")
        self.assertEqual(schema["type"], "object")
        self.assertFalse(schema["additionalProperties"])

        required = set(schema["required"])
        for field in [
            "id",
            "name",
            "description",
            "status",
            "labels",
            "roles",
            "presets",
            "synthesisRole",
            "transparencyPolicy",
            "allowedSkills",
            "company",
        ]:
            self.assertIn(field, required)

        self.assertIn("agent", schema["properties"]["labels"]["required"])
        self.assertIn("agents", schema["properties"]["labels"]["required"])
        self.assertIn("companyId", schema["properties"]["company"]["required"])

    def test_philosophy_chamber_manifest_points_at_phase1_roles(self):
        chamber = json.loads(PHILOSOPHY_CHAMBER.read_text(encoding="utf-8"))

        self.assertEqual(chamber["id"], "philosophy")
        self.assertEqual(chamber["status"], "active")
        self.assertEqual(chamber["roles"], ["roles.json"])
        self.assertEqual(chamber["presets"], ["presets/mvp.json"])
        self.assertEqual(chamber["synthesisRole"], "agora-assistant")
        self.assertEqual(chamber["labels"]["agent"], "philosopher")
        self.assertEqual(chamber["labels"]["agents"], "philosophers")

    def test_chamber_loader_lists_philosophy(self):
        result = self.run_node(CHAMBER_LOADER, "list", "--json")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        self.assertIn("philosophy", [item["id"] for item in payload["chambers"]])

    def test_chamber_loader_rejects_manifest_missing_required_field(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            chamber_dir = Path(temp_dir) / "broken"
            chamber_dir.mkdir()
            (chamber_dir / "chamber.json").write_text(json.dumps({"id": "broken"}), encoding="utf-8")

            result = self.run_node(CHAMBER_LOADER, "validate", "--chambers-dir", temp_dir)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing required field", result.stderr)
        self.assertIn("name", result.stderr)

    def test_chamber_loader_deep_merge_replaces_arrays(self):
        result = self.run_node(CHAMBER_LOADER, "merge-fixture", "--json")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["allowedSkills"], ["source-citation"])
        self.assertEqual(payload["labels"]["agent"], "director")
        self.assertEqual(payload["labels"]["tasks"], "sessions")

    def test_merged_philosophy_cockpit_matches_current_config(self):
        result = self.run_node(CHAMBER_LOADER, "cockpit", "philosophy", "--json")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        merged = json.loads(result.stdout)
        current = json.loads(COCKPIT_CONFIG.read_text(encoding="utf-8"))
        self.assertEqual(merged, current)


if __name__ == "__main__":
    unittest.main()
