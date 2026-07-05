import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILD_SCRIPT = ROOT / "scripts" / "build-cockpit-config.mjs"
RUNTIME_CONFIG = ROOT / "paperclip-cockpit.json"


class CockpitConfigBuildTests(unittest.TestCase):
    def run_build(self, *args):
        return subprocess.run(
            ["node", str(BUILD_SCRIPT), *map(str, args)],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_generated_config_matches_runtime_config(self):
        result = self.run_build("--check", "--json")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["runtimeConfig"], "paperclip-cockpit.json")
        self.assertEqual(payload["fragmentsDir"], "config/cockpit")
        self.assertGreaterEqual(len(payload["fragments"]), 8)
        self.assertEqual(payload["generatedSha256"], payload["runtimeSha256"])

    def test_print_outputs_same_json_object_as_runtime_config(self):
        result = self.run_build("--print")

        self.assertEqual(result.returncode, 0, result.stderr)
        generated = json.loads(result.stdout)
        runtime = json.loads(RUNTIME_CONFIG.read_text(encoding="utf-8"))
        self.assertEqual(generated, runtime)


if __name__ == "__main__":
    unittest.main()
