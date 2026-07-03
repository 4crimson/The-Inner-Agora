import json
import os
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INTENT_SCHEMA = ROOT / "data" / "schema" / "intent-slots.schema.json"
INTENT_SCRIPT = ROOT / "scripts" / "intent-slots.mjs"
AGORA_SCRIPT = ROOT / "scripts" / "agora.mjs"


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
        self.assertIn("dialogue_with_role", schema["properties"]["intent"]["enum"])

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
        self.assertIn("dialogue_with_role только", result.stdout)
        self.assertIn("спроси агору", result.stdout)
        self.assertIn("дай выжимку", result.stdout)
        self.assertIn("готов ли синтез", result.stdout)

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

    def test_llm_dialogue_intent_requires_contextual_dialogue_cue(self):
        fake = json.dumps(
            {
                "intent": "dialogue_with_role",
                "chamber": "philosophy",
                "mode": None,
                "topic": "отцы и дети",
                "roles": ["plato"],
                "taskRef": None,
                "missingSlots": [],
                "confidence": 0.9,
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
            "давай спросим агору про отцов и детей",
            env=env,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["source"], "regex")
        self.assertEqual(payload["slots"]["intent"], "new_session")

    def test_llm_extractor_keeps_capabilities_question_as_help_service_intent(self):
        fake = json.dumps(
            {
                "intent": "new_session",
                "chamber": "philosophy",
                "mode": "balanced",
                "topic": "что ты умеешь в агоре?",
                "roles": [],
                "taskRef": None,
                "missingSlots": [],
                "confidence": 0.95,
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
            "что ты умеешь в агоре?",
            env=env,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["source"], "regex")
        self.assertEqual(payload["slots"]["intent"], "help")
        self.assertEqual(payload["fallbackReason"], "deterministic_service_intent")

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

    def test_regex_extractor_keeps_multiple_requested_roles_for_new_session(self):
        result = self.run_node(
            AGORA_SCRIPT,
            "natural",
            "--routing-mode",
            "regex",
            "--dry-run",
            "--json",
            "собери совет с Платоном и Сартром: что такое свобода",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["action"], "rewrite")
        self.assertIn("--voices plato,sartre", payload["text"])

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

    def test_plan_help_returns_local_message_not_command(self):
        slots = {
            "intent": "help",
            "chamber": "philosophy",
            "mode": None,
            "topic": None,
            "roles": [],
            "taskRef": None,
            "missingSlots": [],
            "confidence": 0.9,
        }
        result = self.run_node(INTENT_SCRIPT, "plan", "--json", input_text=json.dumps(slots, ensure_ascii=False))
        self.assertEqual(result.returncode, 0, result.stderr)
        plan = json.loads(result.stdout)
        self.assertEqual(plan["action"], "message")
        self.assertIn("быстрый совет", plan["text"])
        self.assertNotIn("command", plan)

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

    def test_dialogue_with_role_plans_context_command(self):
        slots = {
            "intent": "dialogue_with_role",
            "chamber": "philosophy",
            "mode": None,
            "topic": "А что бы Хайдеггер ответил на второе возражение?",
            "roles": ["heidegger"],
            "taskRef": None,
            "missingSlots": [],
            "confidence": 0.88,
        }
        context = {"lastRootIssueRef": "THE-900"}
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
        self.assertEqual(plan["command"][:4], ["/agora", "dialogue-context", "THE-900", "heidegger"])

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

    def test_start_onboarding_lists_chambers_dynamically(self):
        result = self.run_node(ROOT / "scripts" / "agora.mjs", "start", "--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        chamber_ids = [item["id"] for item in payload["chambers"]]
        self.assertIn("philosophy", chamber_ids)
        self.assertIn("board-directors", chamber_ids)
        self.assertTrue(payload["examples"])
        self.assertIn("routingMode", payload)

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

    def test_natural_missing_topic_rewrites_to_wizard_start(self):
        result = self.run_node(
            ROOT / "scripts" / "agora.mjs",
            "natural",
            "--routing-mode",
            "regex",
            "--dry-run",
            "--json",
            "хочу запустить агору",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["action"], "rewrite")
        self.assertEqual(payload["text"], "/agora wizard")

    def test_wizard_pending_reply_rewrites_to_wizard_answer(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "state.json"
            state_path.write_text(json.dumps({"wizard": {"step": "topic", "slots": {}}}), encoding="utf-8")
            env = {**os.environ, "INNER_AGORA_STATE_PATH": str(state_path)}
            result = self.run_node(
                ROOT / "scripts" / "agora.mjs",
                "natural",
                "--routing-mode",
                "regex",
                "--dry-run",
                "--json",
                "что значит свобода у Сартра",
                env=env,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["action"], "rewrite")
        self.assertEqual(payload["text"], "/agora wizard-answer что значит свобода у Сартра")

    def test_wizard_start_initializes_state_and_prompts_topic(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "state.json"
            env = {**os.environ, "INNER_AGORA_STATE_PATH": str(state_path)}
            result = self.run_node(ROOT / "scripts" / "agora.mjs", "wizard", env=env)
            self.assertEqual(result.returncode, 0, result.stderr)
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertIn("Какой вопрос", result.stdout)
            self.assertEqual(state["wizard"]["step"], "topic")

    def test_wizard_topic_answer_prompts_chamber_and_updates_state(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "state.json"
            state_path.write_text(
                json.dumps(
                    {
                        "wizard": {
                            "step": "topic",
                            "slots": {
                                "intent": "new_session",
                                "chamber": None,
                                "mode": "balanced",
                                "topic": None,
                                "roles": [],
                                "taskRef": None,
                                "missingSlots": ["topic"],
                                "confidence": 0.8,
                            },
                        }
                    }
                ),
                encoding="utf-8",
            )
            env = {**os.environ, "INNER_AGORA_STATE_PATH": str(state_path)}
            result = self.run_node(
                ROOT / "scripts" / "agora.mjs",
                "wizard-answer",
                "что значит свобода у Сартра",
                env=env,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            state = json.loads(state_path.read_text(encoding="utf-8"))
        self.assertIn("палату", result.stdout.lower())
        self.assertEqual(state["wizard"]["step"], "chamber")
        self.assertEqual(state["wizard"]["slots"]["topic"], "что значит свобода у Сартра")

    def test_wizard_chamber_answer_prompts_depth_and_updates_state(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "state.json"
            state_path.write_text(
                json.dumps(
                    {
                        "wizard": {
                            "step": "chamber",
                            "slots": {
                                "intent": "new_session",
                                "chamber": None,
                                "mode": "balanced",
                                "topic": "что значит свобода у Сартра",
                                "roles": [],
                                "taskRef": None,
                                "missingSlots": [],
                                "confidence": 0.8,
                            },
                        }
                    }
                ),
                encoding="utf-8",
            )
            env = {**os.environ, "INNER_AGORA_STATE_PATH": str(state_path)}
            result = self.run_node(ROOT / "scripts" / "agora.mjs", "wizard-answer", "философия", env=env)
            self.assertEqual(result.returncode, 0, result.stderr)
            state = json.loads(state_path.read_text(encoding="utf-8"))
        self.assertIn("глуб", result.stdout.lower())
        self.assertEqual(state["wizard"]["step"], "mode")
        self.assertEqual(state["wizard"]["slots"]["chamber"], "philosophy")

    def test_wizard_mode_answer_prompts_confirmation_and_reuses_planner(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "state.json"
            state_path.write_text(
                json.dumps(
                    {
                        "wizard": {
                            "step": "mode",
                            "slots": {
                                "intent": "new_session",
                                "chamber": "philosophy",
                                "mode": "balanced",
                                "topic": "что значит свобода у Сартра",
                                "roles": [],
                                "taskRef": None,
                                "missingSlots": [],
                                "confidence": 0.8,
                            },
                        }
                    }
                ),
                encoding="utf-8",
            )
            env = {**os.environ, "INNER_AGORA_STATE_PATH": str(state_path)}
            result = self.run_node(ROOT / "scripts" / "agora.mjs", "wizard-answer", "коротко", env=env)
            self.assertEqual(result.returncode, 0, result.stderr)
            state = json.loads(state_path.read_text(encoding="utf-8"))
        self.assertIn("Запускать", result.stdout)
        self.assertIn("/agora ask --mode min", result.stdout)
        self.assertEqual(state["wizard"]["step"], "confirm")
        self.assertEqual(state["wizard"]["slots"]["mode"], "min")

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

    def test_agora_natural_preserves_pair_philosopher_limit_words(self):
        result = self.run_node(
            ROOT / "scripts" / "agora.mjs",
            "natural",
            "--routing-mode",
            "regex",
            "--dry-run",
            "--json",
            "собери совет у пары философов: как поддерживать взрослого ребенка",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["action"], "rewrite")
        self.assertIn("пары философов", payload["text"])

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

    def test_agora_natural_capabilities_question_is_help_not_follow_up(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "state.json"
            state_path.write_text(
                json.dumps(
                    {
                        "lastRootIssueRef": "THE-900",
                        "lastSynthesisRef": "THE-901",
                        "lastSynthesisSeenAt": "2099-01-01T00:00:00.000Z",
                    }
                ),
                encoding="utf-8",
            )
            env = {**os.environ, "INNER_AGORA_STATE_PATH": str(state_path)}
            result = self.run_node(
                ROOT / "scripts" / "agora.mjs",
                "natural",
                "--routing-mode",
                "regex",
                "--dry-run",
                "--json",
                "что ты умеешь в агоре?",
                env=env,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["action"], "message")
        self.assertEqual(payload["slots"]["intent"], "help")
        self.assertIn("быстрый совет", payload["text"])

    def test_agora_natural_dialogue_with_role_uses_last_root_state(self):
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
                "А что бы Хайдеггер ответил на второе возражение?",
                env=env,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["action"], "rewrite")
        self.assertTrue(
            payload["text"].startswith("/agora dialogue-context THE-900 heidegger "),
            payload,
        )

    def test_implicit_follow_up_uses_fresh_last_synthesis_state(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "state.json"
            state_path.write_text(
                json.dumps(
                    {
                        "lastRootIssueRef": "THE-900",
                        "lastSynthesisRef": "THE-999",
                        "lastIssueSeenAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                    }
                ),
                encoding="utf-8",
            )
            env = {**os.environ, "INNER_AGORA_STATE_PATH": str(state_path)}
            result = self.run_node(
                ROOT / "scripts" / "agora.mjs",
                "natural",
                "--routing-mode",
                "regex",
                "--dry-run",
                "--json",
                "а если долг сильнее свободы?",
                env=env,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["action"], "rewrite")
        self.assertTrue(payload["text"].startswith("/agora follow-up THE-900 "), payload)
        self.assertIn("новый вопрос", payload["plan"]["ack"].lower())

    def test_new_topic_marker_does_not_bind_to_last_session(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "state.json"
            state_path.write_text(
                json.dumps({"lastRootIssueRef": "THE-900", "lastSynthesisRef": "THE-999"}),
                encoding="utf-8",
            )
            env = {**os.environ, "INNER_AGORA_STATE_PATH": str(state_path)}
            result = self.run_node(
                ROOT / "scripts" / "agora.mjs",
                "natural",
                "--routing-mode",
                "regex",
                "--dry-run",
                "--json",
                "новый вопрос: что такое дружба у Аристотеля",
                env=env,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["action"], "rewrite")
        self.assertTrue(payload["text"].startswith("/agora ask "), payload)
        self.assertNotIn("/agora follow-up THE-900", payload["text"])


if __name__ == "__main__":
    unittest.main()
