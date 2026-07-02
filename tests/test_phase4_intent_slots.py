import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INTENT_SCHEMA = ROOT / "data" / "schema" / "intent-slots.schema.json"
INTENT_SCRIPT = ROOT / "scripts" / "intent-slots.mjs"


class Phase4IntentSlotTests(unittest.TestCase):
    def run_node(self, *args, input_text=None, env=None):
        return subprocess.run(
            ["node", *map(str, args)],
            cwd=ROOT,
            input=input_text,
            env=env,
            text=True,
            capture_output=True,
        )

    def test_intent_slot_schema_contract(self):
        schema = json.loads(INTENT_SCHEMA.read_text(encoding="utf-8"))
        self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertEqual(
            schema["required"],
            ["intent", "chamber", "mode", "topic", "roles", "taskRef", "missingSlots", "confidence"],
        )
        self.assertIn("new_session", schema["properties"]["intent"]["enum"])
        self.assertIn("role_detail", schema["properties"]["intent"]["enum"])

    def test_parse_json_object_strips_markdown_and_extra_text(self):
        raw = (
            "before\n```json\n"
            '{"intent":"help","chamber":null,"mode":null,"topic":null,'
            '"roles":[],"taskRef":null,"missingSlots":[],"confidence":0.9}'
            "\n```\nafter"
        )
        result = self.run_node(INTENT_SCRIPT, "parse-json", input_text=raw)
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["intent"], "help")

    def test_normalize_drops_unknown_roles_and_defaults_mode(self):
        payload = {
            "intent": "new_session",
            "chamber": "philosophy",
            "mode": None,
            "topic": "свобода ребенка и власть родителей",
            "roles": ["агора", "Платон"],
            "taskRef": None,
            "missingSlots": [],
            "confidence": 0.91,
        }
        result = self.run_node(INTENT_SCRIPT, "normalize", "--json", input_text=json.dumps(payload, ensure_ascii=False))
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["mode"], "balanced")
        self.assertEqual(data["roles"], ["plato"])


if __name__ == "__main__":
    unittest.main()
