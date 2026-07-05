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
        session = schema["properties"]["session"]
        self.assertEqual(session["type"], "object")
        self.assertEqual(session["properties"]["costLog"]["type"], "array")
        self.assertIn("totalTokens", session["properties"]["costLog"]["items"]["properties"])

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

    def test_agora_mode_set_isolated_by_chat_id(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            state_dir = Path(temp_dir) / "state"
            config_path = Path(temp_dir) / "paperclip-cockpit.json"
            config_path.write_text(json.dumps({"agora": {"default_mode": "balanced"}}), encoding="utf-8")
            base_env = {
                "STATE_MODE": "per-chat",
                "INNER_AGORA_STATE_DIR": str(state_dir),
                "INNER_AGORA_PROFILE_DIR": str(Path(temp_dir) / "profiles"),
                "INNER_AGORA_LEGACY_STATE_PATH": str(Path(temp_dir) / "missing-legacy.json"),
                "PAPERCLIP_COCKPIT_CONFIG": str(config_path),
            }
            self.run_node(ROOT / "scripts" / "agora.mjs", "mode", "set", "local", env={**base_env, "INNER_AGORA_CHAT_ID": "chat-a"})
            self.run_node(ROOT / "scripts" / "agora.mjs", "mode", "set", "max", env={**base_env, "INNER_AGORA_CHAT_ID": "chat-b"})

            chat_a = self.run_node(ROOT / "scripts" / "agora.mjs", "mode", "get", "--raw", env={**base_env, "INNER_AGORA_CHAT_ID": "chat-a"})
            chat_b = self.run_node(ROOT / "scripts" / "agora.mjs", "mode", "get", "--raw", env={**base_env, "INNER_AGORA_CHAT_ID": "chat-b"})

            self.assertEqual(chat_a.stdout.strip(), "local")
            self.assertEqual(chat_b.stdout.strip(), "max")
            self.assertTrue((state_dir / "chat-a.json").exists())
            self.assertTrue((state_dir / "chat-b.json").exists())

    def test_profile_preferred_mode_is_used_when_state_has_no_mode(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            state_dir = Path(temp_dir) / "state"
            profile_dir = Path(temp_dir) / "profiles"
            config_path = Path(temp_dir) / "paperclip-cockpit.json"
            config_path.write_text(json.dumps({"agora": {"default_mode": "balanced"}}), encoding="utf-8")
            profile_dir.mkdir()
            (profile_dir / "chat-a.json").write_text(
                json.dumps({"schemaVersion": 1, "chatId": "chat-a", "preferredMode": "local"}),
                encoding="utf-8",
            )
            result = self.run_node(
                ROOT / "scripts" / "agora.mjs",
                "mode",
                "get",
                "--raw",
                env={
                    "STATE_MODE": "per-chat",
                    "INNER_AGORA_CHAT_ID": "chat-a",
                    "INNER_AGORA_STATE_DIR": str(state_dir),
                    "INNER_AGORA_PROFILE_DIR": str(profile_dir),
                    "INNER_AGORA_LEGACY_STATE_PATH": str(Path(temp_dir) / "missing-legacy.json"),
                    "PAPERCLIP_COCKPIT_CONFIG": str(config_path),
                },
            )
            self.assertEqual(result.stdout.strip(), "local")


if __name__ == "__main__":
    unittest.main()
