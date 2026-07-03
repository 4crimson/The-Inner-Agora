import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLUGIN_PATH = ROOT / "hermes-plugins" / "paperclip-cockpit" / "__init__.py"


def load_plugin():
    spec = importlib.util.spec_from_file_location("paperclip_cockpit_callbacks_under_test", PLUGIN_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class EnvPatch:
    def __init__(self, **values):
        self.values = values
        self.previous = {}

    def __enter__(self):
        for key, value in self.values.items():
            self.previous[key] = os.environ.get(key)
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def __exit__(self, *_):
        for key, value in self.previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


class FakeAdapter:
    def __init__(self, allowed=True):
        self.allowed = allowed
        self.auth_calls = []

    def _is_callback_user_authorized(self, user_id, **kwargs):
        self.auth_calls.append((user_id, kwargs))
        return self.allowed


class FakeQuery:
    id = "callback-1"


class MonkeyPatch:
    def __init__(self, obj, **values):
        self.obj = obj
        self.values = values
        self.previous = {}

    def __enter__(self):
        for key, value in self.values.items():
            self.previous[key] = getattr(self.obj, key)
            setattr(self.obj, key, value)

    def __exit__(self, *_):
        for key, value in self.previous.items():
            setattr(self.obj, key, value)


class PaperclipCockpitTelegramCallbackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plugin = load_plugin()

    def with_config(self, config, callback):
        with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8") as handle:
            json.dump(config, handle)
            handle.flush()
            with EnvPatch(PAPERCLIP_COCKPIT_CONFIG=handle.name):
                callback()

    def test_callback_runs_configured_action_and_sends_message(self):
        config = {
            "telegram": {
                "enabled": True,
                "callback_prefix": "zz",
                "callbacks": {
                    "open": {"action": "detail", "args": "ticket={arg}", "answer": "Opening"},
                },
            },
            "actions": {
                "detail": {"exec": ["echo", "placeholder"]},
            },
        }
        calls = []
        runs = []

        def fake_api(method, payload, *, timeout=20):
            calls.append((method, payload, timeout))
            return {"ok": True}

        def fake_run_action(name, action, raw_args, **_):
            runs.append((name, action, raw_args))
            return f"output for {raw_args}"

        def assertions():
            adapter = FakeAdapter(allowed=True)
            with MonkeyPatch(self.plugin, _telegram_api=fake_api, _run_action=fake_run_action):
                result = self.plugin._telegram_callback_query(
                    adapter=adapter,
                    query=FakeQuery(),
                    data="zz:open:WK-7",
                    chat_id="chat-1",
                    chat_type="private",
                    thread_id=None,
                    user_id="user-1",
                    user_name="alice",
                )

            self.assertEqual(result, {"action": "handled"})
            self.assertEqual(runs[0][0], "detail")
            self.assertEqual(runs[0][2], "ticket=WK-7")
            self.assertEqual(calls[0][0], "answerCallbackQuery")
            self.assertEqual(calls[0][1]["text"], "Opening")
            self.assertEqual(calls[1][0], "sendMessage")
            self.assertEqual(calls[1][1]["chat_id"], "chat-1")
            self.assertEqual(calls[1][1]["text"], "output for ticket=WK-7")
            self.assertEqual(adapter.auth_calls[0][0], "user-1")

        self.with_config(config, assertions)

    def test_callback_action_passes_chat_id_to_subprocess_env(self):
        config = {
            "telegram": {
                "enabled": True,
                "callback_prefix": "pc",
                "callbacks": {"latest": {"action": "latest", "args": "{arg}", "answer": "Opening"}},
            },
            "actions": {"latest": {"exec": ["node", "-e", "console.log(process.env.INNER_AGORA_CHAT_ID || '')"]}},
        }
        calls = []
        runs = []

        def fake_api(method, payload, *, timeout=20):
            calls.append((method, payload, timeout))
            return {"ok": True}

        def fake_run(args, cwd=None, text=None, capture_output=None, timeout=None, check=None, env=None):
            runs.append(env)
            return type("Result", (), {"stdout": "chat-2\n", "stderr": "", "returncode": 0})()

        def assertions():
            with MonkeyPatch(self.plugin, _telegram_api=fake_api), MonkeyPatch(subprocess, run=fake_run):
                result = self.plugin._telegram_callback_query(
                    adapter=FakeAdapter(),
                    query=FakeQuery(),
                    data="pc:latest:THE-900",
                    chat_id="chat-2",
                    user_id="user-2",
                )

            self.assertEqual(result, {"action": "handled"})
            self.assertEqual(runs[0]["INNER_AGORA_CHAT_ID"], "chat-2")
            self.assertEqual(calls[1][1]["text"], "chat-2")

        self.with_config(config, assertions)

    def test_run_action_passes_configured_env_overrides_to_subprocess(self):
        script = (
            "process.stdout.write(["
            "process.env.INNER_AGORA_ACTIVE_CHAMBER || '',"
            "process.env.INNER_AGORA_MODE || '',"
            "process.env.INNER_AGORA_CHAT_ID || ''"
            "].join(':'))"
        )
        config = {
            "actions": {
                "board_go_no_go": {
                    "exec": ["node", "-e", script],
                    "append_args": False,
                    "env": {
                        "INNER_AGORA_ACTIVE_CHAMBER": "board-directors",
                        "INNER_AGORA_MODE": "local",
                    },
                }
            }
        }

        def assertions():
            output = self.plugin._run_action(
                "board_go_no_go",
                config["actions"]["board_go_no_go"],
                "",
                chat_id="chat-env",
            )

            self.assertEqual(output, "board-directors:local:chat-env")

        self.with_config(config, assertions)

    def test_run_action_humanizes_paperclip_terminated_ancestor_error(self):
        config = {
            "presentation": {"language": "ru"},
            "actions": {"deep": {"exec": ["node", "scripts/agora.mjs", "ask", "--max"]}},
        }
        stderr = (
            'POST /companies/company-1/issues failed: 409 {"error":"Хайдеггер reports through '
            "terminated ancestor Agora Assistant / Синтезатор. Reassign Хайдеггер or the nearest "
            'affected ancestor under an active manager/root."}'
        )

        def fake_run(args, cwd=None, text=None, capture_output=None, timeout=None, check=None, env=None):
            return type("Result", (), {"stdout": "", "stderr": stderr, "returncode": 1})()

        def assertions():
            with MonkeyPatch(subprocess, run=fake_run):
                output = self.plugin._run_action("deep", config["actions"]["deep"], "как заботу не превратить в контроль")

            self.assertIn("Paperclip-иерархия", output)
            self.assertIn("Хайдеггер", output)
            self.assertIn("repair/prepare", output)
            self.assertNotIn("stderr:", output)
            self.assertNotIn('{"error"', output)
            self.assertNotIn("Project action exited", output)

        self.with_config(config, assertions)

    def test_pre_gateway_dispatch_passes_chat_id_to_natural_delegate(self):
        config = {
            "command": {"name": "agora"},
            "natural_language": {
                "delegate": {"exec": ["node", "scripts/agora.mjs", "natural", "--dry-run", "--json", "{text}"]}
            },
        }
        runs = []

        def fake_run(args, cwd=None, text=None, capture_output=None, timeout=None, check=None, env=None):
            runs.append(env)
            return type(
                "Result",
                (),
                {"stdout": json.dumps({"action": "rewrite", "text": "/agora status"}), "stderr": "", "returncode": 0},
            )()

        def assertions():
            with MonkeyPatch(subprocess, run=fake_run):
                class Source:
                    platform = "telegram"
                    chat_id = "chat-a"

                class Event:
                    source = Source()
                    text = "агора статус"

                result = self.plugin._pre_gateway_dispatch(Event())

            self.assertEqual(result, {"action": "rewrite", "text": "/agora status"})
            self.assertEqual(runs[0]["INNER_AGORA_CHAT_ID"], "chat-a")

        self.with_config(config, assertions)

    def test_message_only_callback_formats_argument(self):
        config = {
            "telegram": {
                "enabled": True,
                "callback_prefix": "pc",
                "callbacks": {
                    "clarify": {"answer": "OK", "message": "Уточнение по {arg}"},
                },
            },
        }
        calls = []

        def fake_api(method, payload, *, timeout=20):
            calls.append((method, payload, timeout))
            return {"ok": True}

        def assertions():
            with MonkeyPatch(self.plugin, _telegram_api=fake_api):
                result = self.plugin._telegram_callback_query(
                    adapter=FakeAdapter(),
                    query=FakeQuery(),
                    data="pc:clarify:THE-58",
                    chat_id="chat-2",
                    user_id="user-2",
                )

            self.assertEqual(result, {"action": "handled"})
            self.assertEqual([call[0] for call in calls], ["answerCallbackQuery", "sendMessage"])
            self.assertEqual(calls[1][1]["text"], "Уточнение по THE-58")

        self.with_config(config, assertions)

    def test_callback_can_send_telegram_payload_with_buttons(self):
        config = {
            "telegram": {
                "enabled": True,
                "callback_prefix": "pc",
                "callbacks": {
                    "voice": {
                        "action": "telegram_voice",
                        "args": "{arg}",
                        "answer": "Opening",
                        "telegram_payload": True,
                    },
                },
            },
            "actions": {
                "telegram_voice": {"exec": ["echo", "placeholder"], "presentation": {"mode": "raw"}},
            },
        }
        calls = []
        runs = []

        def fake_api(method, payload, *, timeout=20):
            calls.append((method, payload, timeout))
            return {"ok": True}

        def fake_run_action(name, action, raw_args, **_):
            runs.append((name, action, raw_args))
            return json.dumps(
                {
                    "text": f"voice for {raw_args}",
                    "reply_markup": {
                        "inline_keyboard": [[{"text": "Синтез", "callback_data": "pc:result:THE-65"}]]
                    },
                }
            )

        def assertions():
            with MonkeyPatch(self.plugin, _telegram_api=fake_api, _run_action=fake_run_action):
                result = self.plugin._telegram_callback_query(
                    adapter=FakeAdapter(),
                    query=FakeQuery(),
                    data="pc:voice:THE-62",
                    chat_id="chat-2",
                    user_id="user-2",
                )

            self.assertEqual(result, {"action": "handled"})
            self.assertEqual(runs[0][0], "telegram_voice")
            self.assertEqual(runs[0][2], "THE-62")
            self.assertEqual([call[0] for call in calls], ["answerCallbackQuery", "sendMessage"])
            self.assertEqual(calls[1][1]["text"], "voice for THE-62")
            self.assertEqual(calls[1][1]["reply_markup"]["inline_keyboard"][0][0]["callback_data"], "pc:result:THE-65")

        self.with_config(config, assertions)

    def test_default_clarify_callback_is_project_neutral(self):
        config = {
            "telegram": {
                "enabled": True,
                "callback_prefix": "pc",
            },
        }
        calls = []

        def fake_api(method, payload, *, timeout=20):
            calls.append((method, payload, timeout))
            return {"ok": True}

        def assertions():
            with MonkeyPatch(self.plugin, _telegram_api=fake_api):
                result = self.plugin._telegram_callback_query(
                    adapter=FakeAdapter(),
                    query=FakeQuery(),
                    data="pc:clarify:WK-7",
                    chat_id="chat-2",
                    user_id="user-2",
                )

            self.assertEqual(result, {"action": "handled"})
            self.assertEqual([call[0] for call in calls], ["answerCallbackQuery", "sendMessage"])
            self.assertEqual(calls[1][1]["text"], "Write a follow-up as a normal message for WK-7.")

        self.with_config(config, assertions)

    def test_ignores_other_callback_prefixes(self):
        config = {"telegram": {"enabled": True, "callback_prefix": "pc"}}
        calls = []

        def fake_api(method, payload, *, timeout=20):
            calls.append((method, payload, timeout))
            return {"ok": True}

        def assertions():
            with MonkeyPatch(self.plugin, _telegram_api=fake_api):
                result = self.plugin._telegram_callback_query(
                    query=FakeQuery(),
                    data="other:open:THE-58",
                    chat_id="chat-3",
                )

            self.assertIsNone(result)
            self.assertEqual(calls, [])

        self.with_config(config, assertions)

    def test_unauthorized_callback_is_answered_without_running_action(self):
        config = {
            "telegram": {
                "enabled": True,
                "callback_prefix": "pc",
                "callbacks": {
                    "result": {"action": "result", "args": "{arg}"},
                },
            },
            "actions": {
                "result": {"exec": ["echo", "placeholder"]},
            },
        }
        calls = []
        runs = []

        def fake_api(method, payload, *, timeout=20):
            calls.append((method, payload, timeout))
            return {"ok": True}

        def fake_run_action(name, action, raw_args, **_):
            runs.append((name, action, raw_args))
            return "should not happen"

        def assertions():
            with MonkeyPatch(self.plugin, _telegram_api=fake_api, _run_action=fake_run_action):
                result = self.plugin._telegram_callback_query(
                    adapter=FakeAdapter(allowed=False),
                    query=FakeQuery(),
                    data="pc:result:THE-58",
                    chat_id="chat-4",
                    user_id="user-4",
                )

            self.assertEqual(result, {"action": "handled"})
            self.assertEqual(runs, [])
            self.assertEqual([call[0] for call in calls], ["answerCallbackQuery"])
            self.assertEqual(calls[0][1]["text"], "Нет доступа.")

        self.with_config(config, assertions)


if __name__ == "__main__":
    unittest.main()
