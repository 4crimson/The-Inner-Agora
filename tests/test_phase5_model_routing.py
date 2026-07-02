import json
import os
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODEL_ROUTING = ROOT / "scripts" / "model-routing.mjs"


class Phase5ModelRoutingTests(unittest.TestCase):
    def run_node(self, *args, env=None):
        return subprocess.run(
            ["node", *map(str, args)],
            cwd=ROOT,
            env={**os.environ, **(env or {})},
            text=True,
            capture_output=True,
        )

    def test_models_config_cli_loads_schema_version(self):
        result = self.run_node(MODEL_ROUTING, "config", "--json")

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["schemaVersion"], 1)
        self.assertIn("hermes_local", payload["adapters"])
        self.assertIn("codex_local", payload["adapters"])

    def test_route_cli_uses_local_and_high_stakes_rules(self):
        local = self.run_node(MODEL_ROUTING, "route", "--json", "--mode", "local")
        self.assertEqual(local.returncode, 0, local.stderr)
        local_payload = json.loads(local.stdout)
        self.assertEqual(local_payload["name"], "hermes_local")
        self.assertEqual(local_payload["reason"], "localMode")

        high = self.run_node(MODEL_ROUTING, "route", "--json", "--mode", "all", "--risk-tier", "high-stakes")
        self.assertEqual(high.returncode, 0, high.stderr)
        high_payload = json.loads(high.stdout)
        self.assertEqual(high_payload["name"], "codex_local")
        self.assertEqual(high_payload["reason"], "fullCouncilHighStakes")

    def test_env_overrides_adapter_models(self):
        result = self.run_node(
            MODEL_ROUTING,
            "route",
            "--json",
            "--mode",
            "local",
            env={"INNER_AGORA_HERMES_MODEL": "test/hermes-override"},
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["adapter"]["model"], "test/hermes-override")

    def test_slot_extractor_config_supports_env_override(self):
        default = self.run_node(MODEL_ROUTING, "slot-extractor", "--json")
        self.assertEqual(default.returncode, 0, default.stderr)
        default_payload = json.loads(default.stdout)
        self.assertEqual(default_payload["baseUrl"], "http://127.0.0.1:1234/v1")
        self.assertTrue(default_payload["model"])

        overridden = self.run_node(
            MODEL_ROUTING,
            "slot-extractor",
            "--json",
            env={"INNER_AGORA_LLM_MODEL": "test/slot-model"},
        )
        self.assertEqual(overridden.returncode, 0, overridden.stderr)
        overridden_payload = json.loads(overridden.stdout)
        self.assertEqual(overridden_payload["model"], "test/slot-model")


if __name__ == "__main__":
    unittest.main()
