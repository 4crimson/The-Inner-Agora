import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AGORA_SCRIPT = ROOT / "scripts" / "agora.mjs"


class AgoraCostsCommandTests(unittest.TestCase):
    def run_costs(self, *args, state=None, pricing=None):
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "state.json"
            config_path = Path(temp_dir) / "paperclip-cockpit.json"
            pricing_path = Path(temp_dir) / "costs.config.json"
            config_path.write_text(json.dumps({"agora": {"default_mode": "balanced"}}), encoding="utf-8")
            if state is not None:
                state_path.write_text(json.dumps(state), encoding="utf-8")
            if pricing is not None:
                pricing_path.write_text(json.dumps(pricing), encoding="utf-8")
            env = {
                **os.environ,
                "INNER_AGORA_STATE_PATH": str(state_path),
                "PAPERCLIP_COCKPIT_CONFIG": str(config_path),
                "INNER_AGORA_AUTO_RESTART_PAPERCLIP": "0",
            }
            if pricing is not None:
                env["INNER_AGORA_COST_PRICING_CONFIG"] = str(pricing_path)
            return subprocess.run(
                ["node", str(AGORA_SCRIPT), "costs", *args],
                cwd=ROOT,
                env=env,
                text=True,
                capture_output=True,
            )

    def test_costs_command_prints_read_only_dashboard_from_state(self):
        state = {
            "session": {
                "costLog": [
                    {
                        "kind": "intent-extractor",
                        "source": "llm",
                        "model": "slots",
                        "promptTokens": 10,
                        "completionTokens": 5,
                        "totalTokens": 15,
                        "createdAt": "2026-07-05T10:00:00.000Z",
                    },
                    {
                        "kind": "voice",
                        "source": "paperclip",
                        "model": "hermes",
                        "promptTokens": 20,
                        "completionTokens": 10,
                        "totalTokens": 30,
                        "createdAt": "2026-07-05T12:00:00.000Z",
                    },
                ]
            }
        }

        result = self.run_costs("--limit", "1", state=state)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("# Стоимость и токены", result.stdout)
        self.assertIn("Токены LLM: 30 total", result.stdout)
        self.assertIn("voice source=paperclip model=hermes total=30", result.stdout)
        self.assertNotIn("intent-extractor source=llm", result.stdout)

    def test_costs_command_can_return_json_and_filter_by_hours(self):
        state = {
            "session": {
                "costLog": [
                    {
                        "kind": "old",
                        "source": "llm",
                        "model": "slots",
                        "promptTokens": 10,
                        "completionTokens": 5,
                        "totalTokens": 15,
                        "createdAt": "2026-07-05T10:00:00.000Z",
                    },
                    {
                        "kind": "recent",
                        "source": "llm",
                        "model": "slots",
                        "promptTokens": 20,
                        "completionTokens": 10,
                        "totalTokens": 30,
                        "createdAt": "2026-07-05T12:00:00.000Z",
                    },
                ]
            }
        }

        result = self.run_costs("--json", "--since", "2026-07-05T11:00:00.000Z", state=state)

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["summary"]["totalTokens"], 30)
        self.assertEqual([entry["kind"] for entry in payload["entries"]], ["recent"])

    def test_costs_command_can_price_entries_from_explicit_config(self):
        state = {
            "session": {
                "costLog": [
                    {
                        "kind": "known",
                        "source": "llm",
                        "model": "slots",
                        "promptTokens": 1000000,
                        "completionTokens": 500000,
                        "totalTokens": 1500000,
                        "createdAt": "2026-07-05T12:00:00.000Z",
                    },
                    {
                        "kind": "unknown",
                        "source": "paperclip",
                        "model": "paperclip-agent",
                        "promptTokens": 7,
                        "completionTokens": 3,
                        "totalTokens": 10,
                        "createdAt": "2026-07-05T12:01:00.000Z",
                    },
                ]
            }
        }
        pricing = {
            "currency": "USD",
            "rates": {
                "slots": {
                    "inputPer1MTokens": 1,
                    "outputPer1MTokens": 2,
                }
            },
        }

        text = self.run_costs("--pricing", "env", state=state, pricing=pricing)
        self.assertEqual(text.returncode, 0, text.stderr)
        self.assertIn("Стоимость: $2.000000 USD", text.stdout)
        self.assertIn("unknown: 1 calls / 10 tokens", text.stdout)

        json_result = self.run_costs("--json", "--pricing", "env", state=state, pricing=pricing)
        self.assertEqual(json_result.returncode, 0, json_result.stderr)
        payload = json.loads(json_result.stdout)
        self.assertEqual(payload["pricing"]["knownCost"], 2)
        self.assertEqual(payload["pricing"]["unknownCalls"], 1)

    def test_costs_command_handles_empty_state(self):
        result = self.run_costs(state={})

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Токенов пока нет", result.stdout)


if __name__ == "__main__":
    unittest.main()
