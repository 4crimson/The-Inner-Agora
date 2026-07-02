import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AGORA_SCRIPT = ROOT / "scripts" / "agora.mjs"


class InnerAgoraModeTests(unittest.TestCase):
    def run_mode(self, config, extra_env=None):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "paperclip-cockpit.json"
            state_path = Path(temp_dir) / "state.json"
            config_path.write_text(json.dumps(config), encoding="utf-8")
            env = {
                **os.environ,
                "PAPERCLIP_COCKPIT_CONFIG": str(config_path),
                "INNER_AGORA_STATE_PATH": str(state_path),
            }
            env.pop("INNER_AGORA_MODE", None)
            env.pop("INNER_AGORA_DEFAULT_MODE", None)
            if extra_env:
                env.update(extra_env)
            result = subprocess.run(
                ["node", str(AGORA_SCRIPT), "mode", "get", "--raw"],
                cwd=ROOT,
                env=env,
                text=True,
                capture_output=True,
                check=True,
            )
            return result.stdout.strip()

    def test_config_default_mode_can_force_local_tests(self):
        self.assertEqual(self.run_mode({"agora": {"default_mode": "local"}}), "local")

    def test_env_mode_overrides_config_default(self):
        self.assertEqual(
            self.run_mode({"agora": {"default_mode": "local"}}, {"INNER_AGORA_MODE": "balanced"}),
            "balanced",
        )


if __name__ == "__main__":
    unittest.main()
