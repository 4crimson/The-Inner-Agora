import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AGORA_SCRIPT = ROOT / "scripts" / "agora.mjs"


class InnerAgoraModeTests(unittest.TestCase):
    def run_mode_command(self, args, config, extra_env=None, models_config=None):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "paperclip-cockpit.json"
            state_path = Path(temp_dir) / "state.json"
            config_path.write_text(json.dumps(config), encoding="utf-8")
            models_config_path = None
            if models_config is not None:
                models_config_path = Path(temp_dir) / "models.config.json"
                models_config_path.write_text(json.dumps(models_config), encoding="utf-8")
            env = {
                **os.environ,
                "PAPERCLIP_COCKPIT_CONFIG": str(config_path),
                "INNER_AGORA_STATE_PATH": str(state_path),
            }
            if models_config_path:
                env["INNER_AGORA_MODELS_CONFIG"] = str(models_config_path)
            env.pop("INNER_AGORA_MODE", None)
            env.pop("INNER_AGORA_DEFAULT_MODE", None)
            if extra_env:
                env.update(extra_env)
            result = subprocess.run(
                ["node", str(AGORA_SCRIPT), *args],
                cwd=ROOT,
                env=env,
                text=True,
                capture_output=True,
                check=True,
            )
            return result.stdout.strip()

    def run_mode(self, config, extra_env=None):
        return self.run_mode_command(["mode", "get", "--raw"], config, extra_env=extra_env)

    def custom_models_config(self):
        payload = json.loads((ROOT / "models.config.json").read_text(encoding="utf-8"))
        payload["adapters"]["hermes_local"]["model"] = "test/hermes-local"
        payload["adapters"]["codex_local"]["model"] = "test/codex-local"
        return payload

    def test_config_default_mode_can_force_local_tests(self):
        self.assertEqual(self.run_mode({"agora": {"default_mode": "local"}}), "local")

    def test_env_mode_overrides_config_default(self):
        self.assertEqual(
            self.run_mode({"agora": {"default_mode": "local"}}, {"INNER_AGORA_MODE": "balanced"}),
            "balanced",
        )

    def test_mode_get_prints_routed_model_and_reason(self):
        stdout = self.run_mode_command(
            ["mode", "get"],
            {"agora": {"default_mode": "local"}},
            models_config=self.custom_models_config(),
        )

        self.assertIn("mode=local", stdout)
        self.assertIn("adapter=hermes_local", stdout)
        self.assertIn("model=test/hermes-local", stdout)
        self.assertIn("reason=localMode", stdout)

    def test_mode_set_prints_configured_codex_route(self):
        stdout = self.run_mode_command(
            ["mode", "set", "balanced"],
            {"agora": {"default_mode": "local"}},
            models_config=self.custom_models_config(),
        )

        self.assertIn("Режим Агоры сохранен: balanced", stdout)
        self.assertIn("adapter=codex_local", stdout)
        self.assertIn("model=test/codex-local", stdout)
        self.assertIn("reason=default", stdout)


if __name__ == "__main__":
    unittest.main()
