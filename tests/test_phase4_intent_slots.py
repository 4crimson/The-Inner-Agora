import json
import os
import subprocess
import tempfile
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

    def test_prompt_names_chambers_and_forbids_direct_writes(self):
        result = self.run_node(INTENT_SCRIPT, "prompt", "совет директоров, нужен go/no-go по найму CTO")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("board-directors", result.stdout)
        self.assertIn("philosophy", result.stdout)
        self.assertIn("не создает Paperclip", result.stdout)

    def test_regex_fallback_extracts_status_result_role_and_board_session(self):
        cases = {
            "дай выжимку по последней таске": "result",
            "готов ли синтез по последней задаче?": "status",
            "а что сказал Платон?": "role_detail",
            "совет директоров, нужен go/no-go по найму CTO": "new_session",
        }
        for text, intent in cases.items():
            with self.subTest(text=text):
                result = self.run_node(INTENT_SCRIPT, "extract", "--routing-mode", "regex", "--json", text)
                self.assertEqual(result.returncode, 0, result.stderr)
                payload = json.loads(result.stdout)
                self.assertEqual(payload["slots"]["intent"], intent)

    def test_llm_extractor_uses_injected_response_without_network(self):
        fake = json.dumps(
            {
                "intent": "new_session",
                "chamber": "philosophy",
                "mode": "min",
                "topic": "что такое свобода у Сартра и Камю",
                "roles": ["Сартр", "Камю"],
                "taskRef": None,
                "missingSlots": [],
                "confidence": 0.93,
            },
            ensure_ascii=False,
        )
        env = {**os.environ, "INNER_AGORA_FAKE_LLM_RESPONSE": fake}
        result = self.run_node(
            INTENT_SCRIPT,
            "extract",
            "--routing-mode",
            "llm",
            "--json",
            "коротко спроси агору: что такое свобода у Сартра и Камю",
            env=env,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["source"], "llm")
        self.assertEqual(payload["slots"]["mode"], "min")
        self.assertEqual(payload["slots"]["roles"], ["sartre", "camus"])

    def test_llm_extractor_falls_back_when_critical_slot_is_missing(self):
        fake = json.dumps(
            {
                "intent": "task_lookup",
                "chamber": "philosophy",
                "mode": None,
                "topic": None,
                "roles": [],
                "taskRef": None,
                "missingSlots": ["taskRef"],
                "confidence": 0.5,
            },
            ensure_ascii=False,
        )
        env = {**os.environ, "INNER_AGORA_FAKE_LLM_RESPONSE": fake}
        result = self.run_node(
            INTENT_SCRIPT,
            "extract",
            "--routing-mode",
            "llm",
            "--json",
            "дай выжимку по последней таске",
            env=env,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["source"], "regex")
        self.assertEqual(payload["slots"]["intent"], "result")

    def test_plan_new_session_builds_agora_ask_command(self):
        slots = {
            "intent": "new_session",
            "chamber": "philosophy",
            "mode": "min",
            "topic": "что такое свобода у Сартра и Камю",
            "roles": ["sartre", "camus"],
            "taskRef": None,
            "missingSlots": [],
            "confidence": 0.93,
        }
        result = self.run_node(INTENT_SCRIPT, "plan", "--json", input_text=json.dumps(slots, ensure_ascii=False))
        self.assertEqual(result.returncode, 0, result.stderr)
        plan = json.loads(result.stdout)
        self.assertEqual(plan["action"], "command")
        self.assertEqual(plan["command"][:4], ["/agora", "ask", "--mode", "min"])
        self.assertIn("--voices", plan["command"])

    def test_plan_missing_topic_asks_one_question(self):
        slots = {
            "intent": "new_session",
            "chamber": "philosophy",
            "mode": "balanced",
            "topic": None,
            "roles": [],
            "taskRef": None,
            "missingSlots": ["topic"],
            "confidence": 0.8,
        }
        result = self.run_node(INTENT_SCRIPT, "plan", "--json", input_text=json.dumps(slots, ensure_ascii=False))
        self.assertEqual(result.returncode, 0, result.stderr)
        plan = json.loads(result.stdout)
        self.assertEqual(plan["action"], "clarify")
        self.assertIn("какой вопрос", plan["question"].lower())

    def test_plan_role_detail_routes_to_voice(self):
        slots = {
            "intent": "role_detail",
            "chamber": "philosophy",
            "mode": None,
            "topic": None,
            "roles": ["plato"],
            "taskRef": None,
            "missingSlots": [],
            "confidence": 0.95,
        }
        result = self.run_node(INTENT_SCRIPT, "plan", "--json", input_text=json.dumps(slots, ensure_ascii=False))
        self.assertEqual(result.returncode, 0, result.stderr)
        plan = json.loads(result.stdout)
        self.assertEqual(plan["command"], ["/agora", "voice", "plato"])

    def test_agora_understand_returns_slots_and_plan(self):
        result = self.run_node(
            ROOT / "scripts" / "agora.mjs",
            "understand",
            "--routing-mode",
            "regex",
            "--json",
            "дай выжимку по последней таске",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["slots"]["intent"], "result")
        self.assertEqual(payload["plan"]["command"], ["/agora", "latest"])

    def test_agora_natural_dry_run_returns_rewrite_text(self):
        result = self.run_node(
            ROOT / "scripts" / "agora.mjs",
            "natural",
            "--routing-mode",
            "regex",
            "--dry-run",
            "--json",
            "а что сказал Платон?",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["action"], "rewrite")
        self.assertEqual(payload["text"], "/agora voice plato")

    def test_follow_up_phrase_plans_child_request_against_last_root(self):
        slots = {
            "intent": "new_session",
            "chamber": "philosophy",
            "mode": "balanced",
            "topic": "уточни у Платона понятие долга",
            "roles": ["plato"],
            "taskRef": None,
            "missingSlots": [],
            "confidence": 0.88,
        }
        context = {"lastRootIssueRef": "THE-900", "isFollowUp": True}
        result = self.run_node(
            INTENT_SCRIPT,
            "plan",
            "--json",
            "--context",
            json.dumps(context),
            input_text=json.dumps(slots, ensure_ascii=False),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        plan = json.loads(result.stdout)
        self.assertEqual(plan["action"], "command")
        self.assertEqual(plan["command"][:3], ["/agora", "follow-up", "THE-900"])

    def test_fixture_20_regex_reports_deterministic_counts(self):
        result = self.run_node(INTENT_SCRIPT, "fixture-20", "--routing-mode", "regex", "--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["routingMode"], "regex")
        self.assertEqual(payload["total"], 20)
        self.assertGreaterEqual(payload["semanticCorrect"], 16)
        self.assertEqual(len(payload["results"]), 20)

    def test_agora_natural_follow_up_uses_last_root_state(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "state.json"
            state_path.write_text(json.dumps({"lastRootIssueRef": "THE-900"}), encoding="utf-8")
            env = {**os.environ, "INNER_AGORA_STATE_PATH": str(state_path)}
            result = self.run_node(
                ROOT / "scripts" / "agora.mjs",
                "natural",
                "--routing-mode",
                "regex",
                "--dry-run",
                "--json",
                "уточни у Платона понятие долга",
                env=env,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["action"], "rewrite")
        self.assertEqual(payload["text"], "/agora follow-up THE-900 --voices plato уточни у Платона понятие долга")


if __name__ == "__main__":
    unittest.main()
