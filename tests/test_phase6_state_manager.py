import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STATE_MANAGER = ROOT / "scripts" / "state-manager.mjs"
MIGRATE = ROOT / "scripts" / "migrate-state.mjs"
SCHEMA = ROOT / "data" / "schema" / "state.schema.json"


class Phase6StateManagerTests(unittest.TestCase):
    def run_node(self, *args, env=None, check=True):
        result = subprocess.run(
            ["node", *map(str, args)],
            cwd=ROOT,
            env={**os.environ, **(env or {})},
            text=True,
            capture_output=True,
        )
        if check:
            self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def test_state_schema_requires_schema_version(self):
        schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
        self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertIn("schemaVersion", schema["required"])
        self.assertEqual(schema["properties"]["schemaVersion"]["const"], 1)

    def test_per_chat_path_sanitizes_chat_id(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            result = self.run_node(
                STATE_MANAGER,
                "path",
                "--json",
                env={
                    "STATE_MODE": "per-chat",
                    "INNER_AGORA_CHAT_ID": "Chat 42/Unsafe",
                    "INNER_AGORA_STATE_DIR": str(Path(temp_dir) / "state"),
                },
            )
            payload = json.loads(result.stdout)
            self.assertEqual(payload["chatId"], "chat-42-unsafe")
            self.assertTrue(payload["statePath"].endswith("state/chat-42-unsafe.json"))

    def test_legacy_state_migrates_into_per_chat_target(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            legacy = Path(temp_dir) / ".inner-agora-state.json"
            legacy.write_text(json.dumps({"lastIssueRef": "THE-1", "mode": "local"}), encoding="utf-8")
            state_dir = Path(temp_dir) / "state"
            result = self.run_node(
                STATE_MANAGER,
                "read",
                "--json",
                env={
                    "STATE_MODE": "per-chat",
                    "INNER_AGORA_CHAT_ID": "chat-a",
                    "INNER_AGORA_ROOT": temp_dir,
                    "INNER_AGORA_STATE_DIR": str(state_dir),
                    "INNER_AGORA_LEGACY_STATE_PATH": str(legacy),
                },
            )
            payload = json.loads(result.stdout)
            self.assertEqual(payload["schemaVersion"], 1)
            self.assertEqual(payload["chatId"], "chat-a")
            self.assertEqual(payload["lastIssueRef"], "THE-1")
            self.assertTrue((state_dir / "chat-a.json").exists())
            self.assertTrue(legacy.exists())

    def test_migrate_cli_writes_default_profile(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            legacy = Path(temp_dir) / ".inner-agora-state.json"
            legacy.write_text(json.dumps({"lastRootIssueRef": "THE-9"}), encoding="utf-8")
            state_dir = Path(temp_dir) / "state"
            result = self.run_node(
                MIGRATE,
                "--chat",
                "default",
                "--json",
                env={
                    "INNER_AGORA_ROOT": temp_dir,
                    "INNER_AGORA_STATE_DIR": str(state_dir),
                    "INNER_AGORA_LEGACY_STATE_PATH": str(legacy),
                },
            )
            payload = json.loads(result.stdout)
            self.assertEqual(payload["chatId"], "default")
            self.assertEqual(json.loads((state_dir / "default.json").read_text(encoding="utf-8"))["lastRootIssueRef"], "THE-9")


if __name__ == "__main__":
    unittest.main()
