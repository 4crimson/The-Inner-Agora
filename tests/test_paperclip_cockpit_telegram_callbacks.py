import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLUGIN_PATH = ROOT / "hermes-plugins" / "paperclip-cockpit" / "__init__.py"
AGORA_CONFIG = ROOT / "paperclip-cockpit.json"


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

    def test_callback_error_recovery_adds_next_action_buttons(self):
        config = {
            "telegram": {
                "enabled": True,
                "callback_prefix": "pc",
                "error_recovery": {
                    "enabled": True,
                    "buttons": [
                        {"label": "Восстановить и повторить", "callback": "recover_retry", "arg": "{arg}"},
                        {"label": "Попробовать без него", "callback": "recover_without_philosopher", "arg": "{arg}"},
                        {"label": "Показать детали", "callback": "show_error_details", "arg": "{arg}"},
                        {"label": "Назад", "callback": "back_home", "arg": "help"},
                    ],
                },
                "callbacks": {"go": {"action": "deep", "args": "{arg}", "answer": "Пробую"}},
            },
            "actions": {"deep": {"exec": ["echo", "unused"]}},
        }
        calls = []

        def fake_api(method, payload, *, timeout=20):
            calls.append((method, payload, timeout))
            return {"ok": True}

        def fake_run_action(name, action, raw_args, **_):
            return "Не получилось запустить совет.\nЯ могу восстановить состав и повторить запуск."

        def assertions():
            with MonkeyPatch(self.plugin, _telegram_api=fake_api), MonkeyPatch(self.plugin, _run_action=fake_run_action):
                result = self.plugin._telegram_callback_query(
                    adapter=FakeAdapter(),
                    query=FakeQuery(),
                    data="pc:go:THE-404",
                    chat_id="chat-error",
                    user_id="user-error",
                )

            self.assertEqual(result, {"action": "handled"})
            payload = calls[1][1]
            self.assertNotIn("stderr", payload["text"])
            self.assertEqual(
                payload["reply_markup"]["inline_keyboard"],
                [
                    [
                        {"text": "Восстановить и повторить", "callback_data": "pc:recover_retry:THE-404"},
                        {"text": "Попробовать без него", "callback_data": "pc:recover_without_philosopher:THE-404"},
                    ],
                    [
                        {"text": "Показать детали", "callback_data": "pc:show_error_details:THE-404"},
                        {"text": "Назад", "callback_data": "pc:back_home:help"},
                    ],
                ],
            )

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

    def test_run_action_humanizes_missing_command_error(self):
        config = {
            "presentation": {"language": "ru"},
            "actions": {
                "broken": {
                    "exec": ["__inner_agora_missing_command__"],
                    "append_args": False,
                }
            },
        }

        def assertions():
            output = self.plugin._run_action("broken", config["actions"]["broken"], "")

            self.assertIn("Не смог выполнить действие проекта `broken`", output)
            self.assertIn("Команда не найдена", output)
            self.assertIn("Технические детали сохранены в логах", output)
            self.assertNotIn("Project action failed before execution", output)
            self.assertNotIn("__inner_agora_missing_command__", output)
            self.assertNotIn("No such file", output)

        self.with_config(config, assertions)

    def test_run_action_humanizes_project_action_timeout(self):
        config = {
            "presentation": {"language": "ru"},
            "actions": {
                "slow": {
                    "exec": ["node", "-e", "setTimeout(() => {}, 10000)"],
                    "append_args": False,
                    "timeout": 7,
                }
            },
        }

        def fake_run(args, cwd=None, text=None, capture_output=None, timeout=None, check=None, env=None):
            raise subprocess.TimeoutExpired(cmd=args, timeout=timeout)

        def assertions():
            with MonkeyPatch(subprocess, run=fake_run):
                output = self.plugin._run_action("slow", config["actions"]["slow"], "")

            self.assertIn("Не смог выполнить действие проекта `slow`", output)
            self.assertIn("Таймаут", output)
            self.assertIn("Технические детали сохранены в логах", output)
            self.assertNotIn("Project action timed out", output)
            self.assertNotIn("node -e", output)
            self.assertNotIn("setTimeout", output)

        self.with_config(config, assertions)

    def test_run_action_humanizes_provider_timeout_error(self):
        config = {
            "presentation": {"language": "ru"},
            "actions": {"provider": {"exec": ["node", "scripts/agora.mjs", "ask"]}},
        }
        stderr = 'Provider timeout after 60000ms\n{"error":"upstream provider timeout","route":"local"}'

        def fake_run(args, cwd=None, text=None, capture_output=None, timeout=None, check=None, env=None):
            return type("Result", (), {"stdout": "", "stderr": stderr, "returncode": 1})()

        def assertions():
            with MonkeyPatch(subprocess, run=fake_run):
                output = self.plugin._run_action("provider", config["actions"]["provider"], "коротко проверь")

            self.assertIn("Не смог выполнить действие проекта `provider`", output)
            self.assertIn("Таймаут", output)
            self.assertIn("Технические детали сохранены в логах", output)
            self.assertNotIn("Project action exited", output)
            self.assertNotIn("stderr:", output)
            self.assertNotIn("Provider timeout after", output)
            self.assertNotIn('{"error"', output)
            self.assertNotIn("route", output)

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

    def test_callback_empty_args_template_does_not_forward_placeholder_arg(self):
        config = {
            "telegram": {
                "enabled": True,
                "callback_prefix": "pc",
                "callbacks": {
                    "latest": {
                        "action": "latest",
                        "args": "",
                        "answer": "Opening",
                    },
                },
            },
            "actions": {"latest": {"exec": ["echo", "placeholder"]}},
        }
        calls = []
        runs = []

        def fake_api(method, payload, *, timeout=20):
            calls.append((method, payload, timeout))
            return {"ok": True}

        def fake_run_action(name, action, raw_args, **_):
            runs.append((name, raw_args))
            return "ok"

        def assertions():
            with MonkeyPatch(self.plugin, _telegram_api=fake_api, _run_action=fake_run_action):
                result = self.plugin._telegram_callback_query(
                    adapter=FakeAdapter(),
                    query=FakeQuery(),
                    data="pc:latest:help",
                    chat_id="chat-latest",
                    user_id="user-latest",
                )

            self.assertEqual(result, {"action": "handled"})
            self.assertEqual(runs, [("latest", "")])
            self.assertEqual(calls[1][1]["text"], "ok")

        self.with_config(config, assertions)

    def test_real_new_question_callback_opens_format_selector_with_buttons(self):
        calls = []

        def fake_api(method, payload, *, timeout=20):
            calls.append((method, payload, timeout))
            return {"ok": True}

        with EnvPatch(PAPERCLIP_COCKPIT_CONFIG=str(AGORA_CONFIG)):
            with MonkeyPatch(self.plugin, _telegram_api=fake_api):
                result = self.plugin._telegram_callback_query(
                    adapter=FakeAdapter(),
                    query=FakeQuery(),
                    data="pc:new_question:help",
                    chat_id="chat-format",
                    user_id="user-format",
                )

        self.assertEqual(result, {"action": "handled"})
        self.assertEqual([call[0] for call in calls], ["answerCallbackQuery", "sendMessage"])
        payload = calls[1][1]
        self.assertIn("Как разберем вопрос?", payload["text"])
        self.assertIn("После этого я попрошу сам вопрос", payload["text"])
        self.assertEqual(
            payload["reply_markup"]["inline_keyboard"],
            [
                [
                    {"text": "Быстрый совет", "callback_data": "pc:fast_prompt:help"},
                    {"text": "Глубокое исследование", "callback_data": "pc:deep_prompt:help"},
                ],
                [
                    {"text": "Спросить одного", "callback_data": "pc:ask_one_prompt:help"},
                    {"text": "Выбрать философов", "callback_data": "pc:choose_philosophers_prompt:help"},
                ],
                [
                    {"text": "Назад", "callback_data": "pc:back_home:help"},
                ],
            ],
        )

    def test_real_back_home_callback_sends_home_keyboard_at_bottom(self):
        calls = []

        def fake_api(method, payload, *, timeout=20):
            calls.append((method, payload, timeout))
            return {"ok": True}

        with EnvPatch(PAPERCLIP_COCKPIT_CONFIG=str(AGORA_CONFIG)):
            with MonkeyPatch(self.plugin, _telegram_api=fake_api):
                result = self.plugin._telegram_callback_query(
                    adapter=FakeAdapter(),
                    query=FakeQuery(),
                    data="pc:back_home:help",
                    chat_id="chat-back-home",
                    user_id="user-back-home",
                )

        self.assertEqual(result, {"action": "handled"})
        self.assertEqual([call[0] for call in calls], ["answerCallbackQuery", "sendMessage"])
        payload = calls[1][1]
        self.assertIn("The Inner Agora", payload["text"])
        self.assertIn("reply_markup", payload)
        self.assertEqual(
            payload["reply_markup"]["inline_keyboard"],
            [
                [
                    {"text": "Новый вопрос", "callback_data": "pc:new_question:help"},
                    {"text": "Последняя сессия", "callback_data": "pc:last_session:help"},
                ],
                [
                    {"text": "Итог", "callback_data": "pc:final_result:help"},
                    {"text": "История", "callback_data": "pc:history:help"},
                ],
                [
                    {"text": "Помощь", "callback_data": "pc:help_sections:help"},
                ],
            ],
        )

    def test_real_deep_prompt_proposes_five_or_six_and_waits_for_confirmation(self):
        calls = []

        def fake_api(method, payload, *, timeout=20):
            calls.append((method, payload, timeout))
            return {"ok": True}

        with EnvPatch(PAPERCLIP_COCKPIT_CONFIG=str(AGORA_CONFIG)):
            with MonkeyPatch(self.plugin, _telegram_api=fake_api):
                result = self.plugin._telegram_callback_query(
                    adapter=FakeAdapter(),
                    query=FakeQuery(),
                    data="pc:deep_prompt:help",
                    chat_id="chat-deep",
                    user_id="user-deep",
                )

        self.assertEqual(result, {"action": "handled"})
        self.assertEqual([call[0] for call in calls], ["answerCallbackQuery", "sendMessage"])
        payload = calls[1][1]
        self.assertIn("Глубокое исследование", payload["text"])
        self.assertIn("Напиши вопрос", payload["text"])
        self.assertNotIn("Предлагаю глубокий состав", payload["text"])
        self.assertEqual(
            payload["reply_markup"]["inline_keyboard"],
            [
                [
                    {"text": "Назад", "callback_data": "pc:back_home:help"},
                ],
            ],
        )

    def test_real_top_level_session_callbacks_use_dynamic_payload_actions(self):
        calls = []
        runs = []

        def fake_api(method, payload, *, timeout=20):
            calls.append((method, payload, timeout))
            return {"ok": True}

        def fake_run_action(name, action, raw_args, **_):
            runs.append((name, raw_args))
            return json.dumps({"text": f"payload from {name}", "reply_markup": {"inline_keyboard": []}})

        with EnvPatch(PAPERCLIP_COCKPIT_CONFIG=str(AGORA_CONFIG)):
            with MonkeyPatch(self.plugin, _telegram_api=fake_api, _run_action=fake_run_action):
                for callback in ("last_session", "final_result", "history"):
                    result = self.plugin._telegram_callback_query(
                        adapter=FakeAdapter(),
                        query=FakeQuery(),
                        data=f"pc:{callback}:help",
                        chat_id="chat-session",
                        user_id="user-session",
                    )
                    self.assertEqual(result, {"action": "handled"})

        self.assertEqual(
            runs,
            [
                ("telegram_last_session", ""),
                ("telegram_final_result", ""),
                ("telegram_history", ""),
            ],
        )
        sent_texts = [payload["text"] for method, payload, _ in calls if method == "sendMessage"]
        self.assertEqual(
            sent_texts,
            [
                "payload from telegram_last_session",
                "payload from telegram_final_result",
                "payload from telegram_history",
            ],
        )

    def test_history_session_callback_opens_selected_session_payload(self):
        calls = []
        runs = []

        def fake_api(method, payload, *, timeout=20):
            calls.append((method, payload, timeout))
            return {"ok": True}

        def fake_run_action(name, action, raw_args, **_):
            runs.append((name, raw_args))
            return json.dumps(
                {
                    "text": f"Сессия {raw_args}",
                    "reply_markup": {
                        "inline_keyboard": [[{"text": "Итог", "callback_data": f"pc:result:{raw_args}"}]]
                    },
                }
            )

        with EnvPatch(PAPERCLIP_COCKPIT_CONFIG=str(AGORA_CONFIG)):
            with MonkeyPatch(self.plugin, _telegram_api=fake_api, _run_action=fake_run_action):
                result = self.plugin._telegram_callback_query(
                    adapter=FakeAdapter(),
                    query=FakeQuery(),
                    data="pc:session:THE-74",
                    chat_id="chat-history",
                    user_id="user-history",
                )

        self.assertEqual(result, {"action": "handled"})
        self.assertEqual(runs, [("telegram_last_session", "THE-74")])
        self.assertEqual(calls[1][1]["text"], "Сессия THE-74")
        self.assertEqual(calls[1][1]["reply_markup"]["inline_keyboard"][0][0]["callback_data"], "pc:result:THE-74")

    def test_real_continue_callback_opens_follow_up_menu_without_launch(self):
        calls = []
        runs = []

        def fake_api(method, payload, *, timeout=20):
            calls.append((method, payload, timeout))
            return {"ok": True}

        def fake_run_action(name, action, raw_args, **_):
            runs.append((name, raw_args))
            return "should not run"

        with EnvPatch(PAPERCLIP_COCKPIT_CONFIG=str(AGORA_CONFIG)):
            with MonkeyPatch(self.plugin, _telegram_api=fake_api, _run_action=fake_run_action):
                result = self.plugin._telegram_callback_query(
                    adapter=FakeAdapter(),
                    query=FakeQuery(),
                    data="pc:clarify:THE-20",
                    chat_id="chat-continue",
                    user_id="user-continue",
                )

        self.assertEqual(result, {"action": "handled"})
        self.assertEqual(runs, [])
        payload = calls[1][1]
        self.assertIn("Продолжаем по этой сессии.", payload["text"])
        self.assertIn("Напиши уточнение обычным текстом.", payload["text"])
        self.assertEqual(
            payload["reply_markup"]["inline_keyboard"],
            [
                [
                    {"text": "Уточнить", "callback_data": "pc:clarify_text:THE-20"},
                    {"text": "Углубить", "callback_data": "pc:deepen:THE-20"},
                ],
                [
                    {"text": "Спросить философа", "callback_data": "pc:ask_one_prompt:THE-20"},
                    {"text": "Новый совет по теме", "callback_data": "pc:new_question:THE-20"},
                ],
                [
                    {"text": "Завершить", "callback_data": "pc:finish_session:THE-20"},
                    {"text": "Назад", "callback_data": "pc:last_session:help"},
                ],
            ],
        )

    def test_real_pending_topic_callbacks_are_safe_messages(self):
        calls = []
        runs = []

        def fake_api(method, payload, *, timeout=20):
            calls.append((method, payload, timeout))
            return {"ok": True}

        def fake_run_action(name, action, raw_args, **_):
            runs.append((name, raw_args))
            return "should not run"

        with EnvPatch(PAPERCLIP_COCKPIT_CONFIG=str(AGORA_CONFIG)):
            with MonkeyPatch(self.plugin, _telegram_api=fake_api, _run_action=fake_run_action):
                for callback in ("launch_balanced", "edit_topic", "cancel_pending"):
                    result = self.plugin._telegram_callback_query(
                        adapter=FakeAdapter(),
                        query=FakeQuery(),
                        data=f"pc:{callback}:pending",
                        chat_id="chat-pending",
                        user_id="user-pending",
                    )
                    self.assertEqual(result, {"action": "handled"})

        self.assertEqual(runs, [])
        sent = [payload["text"] for method, payload, _ in calls if method == "sendMessage"]
        self.assertEqual(len(sent), 3)
        self.assertIn("Напиши тему еще раз", sent[1])
        self.assertIn("Отменил черновик", sent[2])

    def test_real_free_text_confirmation_launches_saved_topic_on_confirm(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))
            config["telegram"]["mode_selector"]["state_path"] = str(Path(tmp) / "telegram-state.json")
            config["cwd"] = str(ROOT)
            config_path = Path(tmp) / "paperclip-cockpit.json"
            config_path.write_text(json.dumps(config), encoding="utf-8")
            calls = []
            runs = []

            def fake_api(method, payload, *, timeout=20):
                calls.append((method, payload, timeout))
                return {"ok": True}

            def fake_run_action(name, action, raw_args, **_):
                runs.append((name, raw_args))
                return "\n".join(
                    [
                        "# Поставил вопрос в Агору: TEST-1",
                        "Выбрал 4 голосов: Сократ, Жан-Поль Сартр, Симона де Бовуар, Альбер Камю.",
                        "Маршрут: hermes_local model=google/gemma-4-26b-a4b-qat reason=localMode",
                        "Напишу сюда, когда будет готов синтез.",
                        "",
                        "Сессия: TEST-1",
                        "Открыть: http://127.0.0.1:3100/issues/root-1",
                        "Голоса:",
                        "- Сократ: TEST-2 (wake=queued:abc)",
                        "- Жан-Поль Сартр: TEST-3 (wake=queued:def)",
                    ]
                )

            class Source:
                platform = "telegram"
                chat_id = "chat-confirm-topic"

            class Event:
                source = Source()
                text = "что такое свобода взрослого ребенка"

            with EnvPatch(PAPERCLIP_COCKPIT_CONFIG=str(config_path), PAPERCLIP_COCKPIT_NL_REWRITE="1"):
                with MonkeyPatch(self.plugin, _telegram_api=fake_api, _run_action=fake_run_action):
                    first = self.plugin._pre_gateway_dispatch(Event())
                    result = self.plugin._telegram_callback_query(
                        adapter=FakeAdapter(),
                        query=FakeQuery(),
                        data="pc:launch_balanced:pending",
                        chat_id="chat-confirm-topic",
                        user_id="user-confirm-topic",
                    )

            self.assertEqual(first, {"action": "skip"})
            self.assertEqual(result, {"action": "handled"})
            self.assertEqual(runs, [("ask", "что такое свобода взрослого ребенка")])
            sent = [payload["text"] for method, payload, _ in calls if method == "sendMessage"]
            self.assertIn("Предлагаю обычный разбор: 4 философа.", sent[0])
            self.assertIn("Запустил совет: TEST-1", sent[1])
            self.assertIn("Вопрос:\nчто такое свобода взрослого ребенка", sent[1])
            self.assertIn("Философы:\nСократ, Жан-Поль Сартр, Симона де Бовуар, Альбер Камю", sent[1])
            self.assertNotIn("wake=", sent[1])
            self.assertNotIn("Маршрут:", sent[1])
            self.assertNotIn("127.0.0.1", sent[1])
            launch_payload = [payload for method, payload, _ in calls if method == "sendMessage"][-1]
            self.assertEqual(
                launch_payload["reply_markup"]["inline_keyboard"],
                [
                    [
                        {"text": "Последняя сессия", "callback_data": "pc:session:TEST-1"},
                        {"text": "Философы", "callback_data": "pc:philosophers:TEST-1"},
                    ],
                    [
                        {"text": "Итог", "callback_data": "pc:result:TEST-1"},
                        {"text": "Детали", "callback_data": "pc:details:TEST-1"},
                    ],
                ],
            )

    def test_real_free_text_confirmation_fast_uses_saved_topic(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))
            config["telegram"]["mode_selector"]["state_path"] = str(Path(tmp) / "telegram-state.json")
            config["cwd"] = str(ROOT)
            config_path = Path(tmp) / "paperclip-cockpit.json"
            config_path.write_text(json.dumps(config), encoding="utf-8")
            calls = []
            runs = []

            def fake_api(method, payload, *, timeout=20):
                calls.append((method, payload, timeout))
                return {"ok": True}

            def fake_run_action(name, action, raw_args, **_):
                runs.append((name, raw_args))
                return "Запустил совет.\nВыбрал 2 философа.\nПришлю итог, когда ответы будут готовы.\n\nСессия: TEST-2"

            class Source:
                platform = "telegram"
                chat_id = "chat-confirm-fast"

            class Event:
                source = Source()
                text = "пару философов про личную свободу"

            with EnvPatch(PAPERCLIP_COCKPIT_CONFIG=str(config_path), PAPERCLIP_COCKPIT_NL_REWRITE="1"):
                with MonkeyPatch(self.plugin, _telegram_api=fake_api, _run_action=fake_run_action):
                    first = self.plugin._pre_gateway_dispatch(Event())
                    result = self.plugin._telegram_callback_query(
                        adapter=FakeAdapter(),
                        query=FakeQuery(),
                        data="pc:fast_prompt:pending",
                        chat_id="chat-confirm-fast",
                        user_id="user-confirm-fast",
                    )

            self.assertEqual(first, {"action": "skip"})
            self.assertEqual(result, {"action": "handled"})
            self.assertEqual(runs, [("min", "пару философов про личную свободу")])

    def test_real_free_text_confirmation_deep_proposes_then_launches_saved_topic(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))
            config["telegram"]["mode_selector"]["state_path"] = str(Path(tmp) / "telegram-state.json")
            config["cwd"] = str(ROOT)
            config_path = Path(tmp) / "paperclip-cockpit.json"
            config_path.write_text(json.dumps(config), encoding="utf-8")
            calls = []
            runs = []

            def fake_api(method, payload, *, timeout=20):
                calls.append((method, payload, timeout))
                return {"ok": True}

            def fake_run_action(name, action, raw_args, **_):
                runs.append((name, raw_args))
                if name == "telegram_deep_proposal":
                    return json.dumps(
                        {
                            "text": "Вопрос:\nзабота и контроль\n\nПредлагаю глубокий состав: 6 философов.\n\nПлатон — рамка смысла",
                            "reply_markup": {"inline_keyboard": [[{"text": "Запустить", "callback_data": "pc:launch_deep:pending"}]]},
                            "pending_question": {
                                "type": "launch",
                                "action": "ask",
                                "args": "забота и контроль",
                                "topic": "забота и контроль",
                            },
                        },
                        ensure_ascii=False,
                    )
                return "Запустил совет.\nВыбрал 6 философов.\nПришлю итог, когда ответы будут готовы.\n\nСессия: TEST-3"

            class Source:
                platform = "telegram"
                chat_id = "chat-confirm-deep"

            class Event:
                source = Source()
                text = "забота и контроль"

            with EnvPatch(PAPERCLIP_COCKPIT_CONFIG=str(config_path), PAPERCLIP_COCKPIT_NL_REWRITE="1"):
                with MonkeyPatch(self.plugin, _telegram_api=fake_api, _run_action=fake_run_action):
                    first = self.plugin._pre_gateway_dispatch(Event())
                    prompt = self.plugin._telegram_callback_query(
                        adapter=FakeAdapter(),
                        query=FakeQuery(),
                        data="pc:deep_prompt:pending",
                        chat_id="chat-confirm-deep",
                        user_id="user-confirm-deep",
                    )
                    launch = self.plugin._telegram_callback_query(
                        adapter=FakeAdapter(),
                        query=FakeQuery(),
                        data="pc:launch_deep:pending",
                        chat_id="chat-confirm-deep",
                        user_id="user-confirm-deep",
                    )

            self.assertEqual(first, {"action": "skip"})
            self.assertEqual(prompt, {"action": "handled"})
            self.assertEqual(launch, {"action": "handled"})
            sent = [payload["text"] for method, payload, _ in calls if method == "sendMessage"]
            self.assertIn("Предлагаю глубокий состав: 6 философов.", sent[1])
            self.assertEqual(runs, [("telegram_deep_proposal", "забота и контроль"), ("max", "забота и контроль")])

    def test_real_choose_philosophers_uses_saved_topic_and_launches_custom_roles(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))
            config["telegram"]["mode_selector"]["state_path"] = str(Path(tmp) / "telegram-state.json")
            config["cwd"] = str(ROOT)
            config_path = Path(tmp) / "paperclip-cockpit.json"
            config_path.write_text(json.dumps(config), encoding="utf-8")
            calls = []
            runs = []

            def fake_api(method, payload, *, timeout=20):
                calls.append((method, payload, timeout))
                return {"ok": True}

            def fake_run_action(name, action, raw_args, **_):
                runs.append((name, raw_args))
                if name == "telegram_custom_proposal":
                    return json.dumps(
                        {
                            "text": "По этой теме я бы собрал 4 философов:\n\nСократ — вопросы\nАристотель — мера\nФуко — власть\nБовуар — свобода\n\nМожно изменить состав.",
                            "reply_markup": {"inline_keyboard": [[{"text": "Запустить", "callback_data": "pc:launch_custom:pending"}]]},
                            "pending_question": {
                                "type": "launch",
                                "action": "ask",
                                "args": "--philosophers socrates,aristotle,foucault,beauvoir свобода взрослого ребенка",
                            },
                        }
                    )
                return "Запустил совет.\nВыбрал 4 философа.\nПришлю итог, когда ответы будут готовы.\n\nСессия: TEST-4"

            class Source:
                platform = "telegram"
                chat_id = "chat-custom-topic"

            class Event:
                source = Source()
                text = "свобода взрослого ребенка"

            with EnvPatch(PAPERCLIP_COCKPIT_CONFIG=str(config_path), PAPERCLIP_COCKPIT_NL_REWRITE="1"):
                with MonkeyPatch(self.plugin, _telegram_api=fake_api, _run_action=fake_run_action):
                    first = self.plugin._pre_gateway_dispatch(Event())
                    proposal = self.plugin._telegram_callback_query(
                        adapter=FakeAdapter(),
                        query=FakeQuery(),
                        data="pc:choose_philosophers_prompt:pending",
                        chat_id="chat-custom-topic",
                        user_id="user-custom-topic",
                    )
                    launch = self.plugin._telegram_callback_query(
                        adapter=FakeAdapter(),
                        query=FakeQuery(),
                        data="pc:launch_custom:pending",
                        chat_id="chat-custom-topic",
                        user_id="user-custom-topic",
                    )

            self.assertEqual(first, {"action": "skip"})
            self.assertEqual(proposal, {"action": "handled"})
            self.assertEqual(launch, {"action": "handled"})
            self.assertEqual(
                runs,
                [
                    ("telegram_custom_proposal", "свобода взрослого ребенка"),
                    ("ask", "--philosophers socrates,aristotle,foucault,beauvoir свобода взрослого ребенка"),
                ],
            )
            sent = [payload["text"] for method, payload, _ in calls if method == "sendMessage"]
            self.assertIn("По этой теме я бы собрал 4 философов", sent[1])
            self.assertIn("Запустил совет: TEST-4", sent[2])
            self.assertIn("Вопрос:\nсвобода взрослого ребенка", sent[2])

    def test_custom_composition_can_add_philosopher_before_launch(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))
            config["telegram"]["mode_selector"]["state_path"] = str(Path(tmp) / "telegram-state.json")
            config["cwd"] = str(ROOT)
            config_path = Path(tmp) / "paperclip-cockpit.json"
            config_path.write_text(json.dumps(config), encoding="utf-8")
            calls = []
            runs = []

            def fake_api(method, payload, *, timeout=20):
                calls.append((method, payload, timeout))
                return {"ok": True}

            def fake_run_action(name, action, raw_args, **_):
                runs.append((name, raw_args))
                if name == "telegram_custom_proposal":
                    return json.dumps(
                        {
                            "text": "По этой теме я бы собрал 2 философов:\n\nСократ — вопросы\nАристотель — мера\n\nМожно изменить состав.",
                            "reply_markup": {"inline_keyboard": [[{"text": "Добавить", "callback_data": "pc:add_philosopher:pending"}]]},
                            "pending_question": {
                                "type": "launch",
                                "action": "ask",
                                "args": "--philosophers socrates,aristotle свобода взрослого ребенка",
                            },
                        }
                    )
                if name == "telegram_custom_add_prompt":
                    return json.dumps(
                        {
                            "text": "Кого добавить?\nНапиши имя философа.",
                            "pending_question": {
                                "type": "custom_edit",
                                "operation": "add",
                                "roles": "socrates,aristotle",
                                "topic": "свобода взрослого ребенка",
                            },
                        }
                    )
                if name == "telegram_custom_edit":
                    return json.dumps(
                        {
                            "text": "Обновил состав: 3 философа\n\nСократ\nАристотель\nФуко",
                            "reply_markup": {"inline_keyboard": [[{"text": "Запустить", "callback_data": "pc:launch_custom:pending"}]]},
                            "pending_question": {
                                "type": "launch",
                                "action": "ask",
                                "args": "--philosophers socrates,aristotle,foucault свобода взрослого ребенка",
                            },
                        }
                    )
                return "Запустил совет.\nВыбрал 3 философа.\nПришлю итог, когда ответы будут готовы.\n\nСессия: TEST-5"

            class Source:
                platform = "telegram"
                chat_id = "chat-custom-edit"

            class TopicEvent:
                source = Source()
                text = "свобода взрослого ребенка"

            class AddEvent:
                source = Source()
                text = "Фуко"

            with EnvPatch(PAPERCLIP_COCKPIT_CONFIG=str(config_path), PAPERCLIP_COCKPIT_NL_REWRITE="1"):
                with MonkeyPatch(self.plugin, _telegram_api=fake_api, _run_action=fake_run_action):
                    first = self.plugin._pre_gateway_dispatch(TopicEvent())
                    proposal = self.plugin._telegram_callback_query(
                        adapter=FakeAdapter(),
                        query=FakeQuery(),
                        data="pc:choose_philosophers_prompt:pending",
                        chat_id="chat-custom-edit",
                        user_id="user-custom-edit",
                    )
                    add_prompt = self.plugin._telegram_callback_query(
                        adapter=FakeAdapter(),
                        query=FakeQuery(),
                        data="pc:add_philosopher:pending",
                        chat_id="chat-custom-edit",
                        user_id="user-custom-edit",
                    )
                    edited = self.plugin._pre_gateway_dispatch(AddEvent())
                    launch = self.plugin._telegram_callback_query(
                        adapter=FakeAdapter(),
                        query=FakeQuery(),
                        data="pc:launch_custom:pending",
                        chat_id="chat-custom-edit",
                        user_id="user-custom-edit",
                    )

            self.assertEqual(first, {"action": "skip"})
            self.assertEqual(proposal, {"action": "handled"})
            self.assertEqual(add_prompt, {"action": "handled"})
            self.assertEqual(edited, {"action": "skip"})
            self.assertEqual(launch, {"action": "handled"})
            self.assertEqual(
                runs,
                [
                    ("telegram_custom_proposal", "свобода взрослого ребенка"),
                    ("telegram_custom_add_prompt", "--philosophers socrates,aristotle свобода взрослого ребенка"),
                    ("telegram_custom_edit", "add --philosophers socrates,aristotle --topic 'свобода взрослого ребенка' --query 'Фуко'"),
                    ("ask", "--philosophers socrates,aristotle,foucault свобода взрослого ребенка"),
                ],
            )
            sent = [payload["text"] for method, payload, _ in calls if method == "sendMessage"]
            self.assertIn("Кого добавить?", sent[2])
            self.assertIn("Обновил состав: 3 философа", sent[3])
            self.assertIn("Запустил совет: TEST-5", sent[4])
            self.assertIn("Вопрос:\nсвобода взрослого ребенка", sent[4])

    def test_real_ask_one_prompt_uses_search_first_buttons(self):
        calls = []

        def fake_api(method, payload, *, timeout=20):
            calls.append((method, payload, timeout))
            return {"ok": True}

        with EnvPatch(PAPERCLIP_COCKPIT_CONFIG=str(AGORA_CONFIG)):
            with MonkeyPatch(self.plugin, _telegram_api=fake_api):
                result = self.plugin._telegram_callback_query(
                    adapter=FakeAdapter(),
                    query=FakeQuery(),
                    data="pc:ask_one_prompt:help",
                    chat_id="chat-one",
                    user_id="user-one",
                )

        self.assertEqual(result, {"action": "handled"})
        payload = calls[1][1]
        self.assertIn("Кого спросим?", payload["text"])
        self.assertIn("Аристотель — практическая мера", payload["text"])
        self.assertEqual(
            payload["reply_markup"]["inline_keyboard"],
            [
                [
                    {"text": "Аристотель", "callback_data": "pc:choose_aristotle:help"},
                    {"text": "Сократ", "callback_data": "pc:choose_socrates:help"},
                ],
                [
                    {"text": "Ницше", "callback_data": "pc:choose_nietzsche:help"},
                    {"text": "Фуко", "callback_data": "pc:choose_foucault:help"},
                ],
                [
                    {"text": "Поиск", "callback_data": "pc:search_philosopher:help"},
                    {"text": "Назад", "callback_data": "pc:back_home:help"},
                ],
            ],
        )

    def test_real_philosopher_search_callback_returns_candidate_buttons(self):
        calls = []

        def fake_api(method, payload, *, timeout=20):
            calls.append((method, payload, timeout))
            return {"ok": True}

        with EnvPatch(PAPERCLIP_COCKPIT_CONFIG=str(AGORA_CONFIG)):
            with MonkeyPatch(self.plugin, _telegram_api=fake_api):
                result = self.plugin._telegram_callback_query(
                    adapter=FakeAdapter(),
                    query=FakeQuery(),
                    data="pc:philosopher_search:Аристотелл",
                    chat_id="chat-search",
                    user_id="user-search",
                )

        self.assertEqual(result, {"action": "handled"})
        payload = calls[1][1]
        self.assertIn("Я нашел похожих философов", payload["text"])
        self.assertEqual(
            payload["reply_markup"]["inline_keyboard"][0][0],
            {"text": "Аристотель", "callback_data": "pc:choose_philosopher:aristotle"},
        )

    def test_real_choose_philosopher_callback_is_safe_payload(self):
        calls = []

        def fake_api(method, payload, *, timeout=20):
            calls.append((method, payload, timeout))
            return {"ok": True}

        with EnvPatch(PAPERCLIP_COCKPIT_CONFIG=str(AGORA_CONFIG)):
            with MonkeyPatch(self.plugin, _telegram_api=fake_api):
                result = self.plugin._telegram_callback_query(
                    adapter=FakeAdapter(),
                    query=FakeQuery(),
                    data="pc:choose_philosopher:aristotle",
                    chat_id="chat-choice",
                    user_id="user-choice",
                )

        self.assertEqual(result, {"action": "handled"})
        payload = calls[1][1]
        self.assertIn("Аристотель выбран", payload["text"])
        self.assertIn("Теперь напиши тему", payload["text"])
        self.assertEqual(
            payload["reply_markup"]["inline_keyboard"][-1],
            [
                {"text": "Поиск", "callback_data": "pc:search_philosopher:help"},
                {"text": "Назад", "callback_data": "pc:ask_one_prompt:help"},
            ],
        )

    def test_choose_philosopher_persists_pending_question_for_next_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            state_path = str(Path(tmp) / "telegram-state.json")
            config = {
                "command": {"name": "agora"},
                "telegram": {
                    "enabled": True,
                    "callback_prefix": "pc",
                    "mode_selector": {
                        "enabled": True,
                        "state_path": state_path,
                        "default_mode": "plain",
                        "modes": [{"id": "plain", "label": "Plain", "action": "ask"}],
                    },
                    "callbacks": {
                        "choose_philosopher": {
                            "answer": "Ок",
                            "message": "Философ выбран.\nТеперь напиши тему.",
                            "pending_question": {"type": "ask_one", "role": "{arg}"},
                        }
                    },
                    "launch_summary": {
                        "role_list_flag": "--philosophers",
                    },
                },
            }
            calls = []

            def fake_api(method, payload, *, timeout=20):
                calls.append((method, payload, timeout))
                return {"ok": True}

            class Source:
                platform = "telegram"
                chat_id = "chat-pending-one"

            class Event:
                source = Source()
                text = "что такое мера в поступках"

            def assertions():
                with MonkeyPatch(self.plugin, _telegram_api=fake_api):
                    result = self.plugin._telegram_callback_query(
                        adapter=FakeAdapter(),
                        query=FakeQuery(),
                        data="pc:choose_philosopher:aristotle",
                        chat_id="chat-pending-one",
                        user_id="user-pending-one",
                    )
                    rewrite = self.plugin._pre_gateway_dispatch(Event())
                    second = self.plugin._pre_gateway_dispatch(Event())

                self.assertEqual(result, {"action": "handled"})
                self.assertEqual(
                    rewrite,
                    {
                        "action": "rewrite",
                        "text": "/agora ask --philosophers aristotle что такое мера в поступках",
                    },
                )
                self.assertIsNone(second)
                data = json.loads(Path(state_path).read_text(encoding="utf-8"))
                self.assertNotIn("pendingQuestion", data["chats"]["telegram:chat-pending-one"])

            self.with_config(config, assertions)

    def test_clarify_persists_follow_up_context_for_next_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            state_path = str(Path(tmp) / "telegram-state.json")
            config = {
                "command": {"name": "agora"},
                "telegram": {
                    "enabled": True,
                    "callback_prefix": "pc",
                    "mode_selector": {
                        "enabled": True,
                        "state_path": state_path,
                        "default_mode": "plain",
                        "modes": [{"id": "plain", "label": "Plain", "action": "ask"}],
                    },
                    "callbacks": {
                        "clarify": {
                            "answer": "Ок",
                            "message": "Продолжаем по этой сессии.\nНапиши уточнение обычным текстом.",
                            "pending_question": {"type": "follow_up", "root": "{arg}"},
                        }
                    },
                },
            }
            calls = []

            def fake_api(method, payload, *, timeout=20):
                calls.append((method, payload, timeout))
                return {"ok": True}

            class Source:
                platform = "telegram"
                chat_id = "chat-follow-up"

            class Event:
                source = Source()
                text = "уточни, где здесь главный риск"

            def assertions():
                with MonkeyPatch(self.plugin, _telegram_api=fake_api):
                    result = self.plugin._telegram_callback_query(
                        adapter=FakeAdapter(),
                        query=FakeQuery(),
                        data="pc:clarify:THE-20",
                        chat_id="chat-follow-up",
                        user_id="user-follow-up",
                    )
                    rewrite = self.plugin._pre_gateway_dispatch(Event())
                    second = self.plugin._pre_gateway_dispatch(Event())

                self.assertEqual(result, {"action": "handled"})
                self.assertEqual(
                    rewrite,
                    {
                        "action": "rewrite",
                        "text": "/agora follow-up THE-20 уточни, где здесь главный риск",
                    },
                )
                self.assertIsNone(second)

            self.with_config(config, assertions)

    def test_real_config_error_recovery_buttons_are_safe_callbacks(self):
        calls = []

        def fake_api(method, payload, *, timeout=20):
            calls.append((method, payload, timeout))
            return {"ok": True}

        def fake_run_action(name, action, raw_args, **_):
            return "Не смог выполнить действие проекта `result`.\nТехнические детали сохранены в логах."

        with EnvPatch(PAPERCLIP_COCKPIT_CONFIG=str(AGORA_CONFIG)):
            with MonkeyPatch(self.plugin, _telegram_api=fake_api), MonkeyPatch(self.plugin, _run_action=fake_run_action):
                result = self.plugin._telegram_callback_query(
                    adapter=FakeAdapter(),
                    query=FakeQuery(),
                    data="pc:result:THE-404",
                    chat_id="chat-error-real",
                    user_id="user-error-real",
                )

        self.assertEqual(result, {"action": "handled"})
        payload = calls[1][1]
        self.assertNotIn("stderr", payload["text"])
        flat = [button for row in payload["reply_markup"]["inline_keyboard"] for button in row]
        self.assertIn({"text": "Восстановить и повторить", "callback_data": "pc:recover_retry:THE-404"}, flat)
        self.assertIn({"text": "Показать детали", "callback_data": "pc:show_error_details:THE-404"}, flat)
        self.assertIn({"text": "Назад", "callback_data": "pc:back_home:help"}, flat)

    def test_real_choose_philosophers_prompt_offers_editing_buttons_before_launch(self):
        calls = []

        def fake_api(method, payload, *, timeout=20):
            calls.append((method, payload, timeout))
            return {"ok": True}

        with EnvPatch(PAPERCLIP_COCKPIT_CONFIG=str(AGORA_CONFIG)):
            with MonkeyPatch(self.plugin, _telegram_api=fake_api):
                result = self.plugin._telegram_callback_query(
                    adapter=FakeAdapter(),
                    query=FakeQuery(),
                    data="pc:choose_philosophers_prompt:help",
                    chat_id="chat-choose",
                    user_id="user-choose",
                )

        self.assertEqual(result, {"action": "handled"})
        payload = calls[1][1]
        self.assertIn("Напиши тему", payload["text"])
        self.assertIn("изменить состав", payload["text"])
        self.assertEqual(
            payload["reply_markup"]["inline_keyboard"],
            [
                [
                    {"text": "Назад", "callback_data": "pc:back_home:help"},
                ],
            ],
        )

    def test_real_help_sections_callback_opens_compact_section_menu(self):
        calls = []

        def fake_api(method, payload, *, timeout=20):
            calls.append((method, payload, timeout))
            return {"ok": True}

        with EnvPatch(PAPERCLIP_COCKPIT_CONFIG=str(AGORA_CONFIG)):
            with MonkeyPatch(self.plugin, _telegram_api=fake_api):
                result = self.plugin._telegram_callback_query(
                    adapter=FakeAdapter(),
                    query=FakeQuery(),
                    data="pc:help_sections:help",
                    chat_id="chat-help",
                    user_id="user-help",
                )

        self.assertEqual(result, {"action": "handled"})
        payload = calls[1][1]
        self.assertIn("Помощь по The Inner Agora.", payload["text"])
        self.assertIn("Что открыть?", payload["text"])
        self.assertEqual(
            payload["reply_markup"]["inline_keyboard"],
            [
                [
                    {"text": "Как пользоваться", "callback_data": "pc:how_to:help"},
                    {"text": "Примеры фраз", "callback_data": "pc:examples:help"},
                ],
                [
                    {"text": "Полная справка", "callback_data": "pc:full_help:help"},
                    {"text": "Состояние", "callback_data": "pc:status_help:help"},
                ],
                [
                    {"text": "Назад", "callback_data": "pc:back_home:help"},
                ],
            ],
        )

    def test_real_status_help_opens_qa_menu_without_launching_live_suite(self):
        calls = []
        runs = []

        def fake_api(method, payload, *, timeout=20):
            calls.append((method, payload, timeout))
            return {"ok": True}

        def fake_run_action(name, action, raw_args, **_):
            runs.append((name, raw_args))
            return "should not run"

        with EnvPatch(PAPERCLIP_COCKPIT_CONFIG=str(AGORA_CONFIG)):
            with MonkeyPatch(self.plugin, _telegram_api=fake_api, _run_action=fake_run_action):
                result = self.plugin._telegram_callback_query(
                    adapter=FakeAdapter(),
                    query=FakeQuery(),
                    data="pc:status_help:help",
                    chat_id="chat-status",
                    user_id="user-status",
                )

        self.assertEqual(result, {"action": "handled"})
        self.assertEqual(runs, [])
        payload = calls[1][1]
        self.assertIn("Состояние The Inner Agora", payload["text"])
        self.assertIn("Live QA отсюда не запускается.", payload["text"])
        self.assertEqual(
            payload["reply_markup"]["inline_keyboard"],
            [
                [
                    {"text": "QA статус", "callback_data": "pc:qa_status:help"},
                    {"text": "Последний QA отчет", "callback_data": "pc:qa_report:help"},
                ],
                [
                    {"text": "Упавшие проверки", "callback_data": "pc:qa_failures:help"},
                    {"text": "Cleanup статус", "callback_data": "pc:qa_cleanup:help"},
                ],
                [
                    {"text": "Назад", "callback_data": "pc:help_sections:help"},
                ],
            ],
        )

    def test_qa_status_callback_sends_payload_from_real_config(self):
        calls = []
        runs = []

        def fake_api(method, payload, *, timeout=20):
            calls.append((method, payload, timeout))
            return {"ok": True}

        def fake_run_action(name, action, raw_args, **_):
            runs.append((name, raw_args, action.get("append_args")))
            return json.dumps(
                {
                    "text": "Последний QA: service-commands\nСтатус: PASS",
                    "reply_markup": {
                        "inline_keyboard": [[{"text": "Назад", "callback_data": "pc:status_help:help"}]]
                    },
                }
            )

        with EnvPatch(PAPERCLIP_COCKPIT_CONFIG=str(AGORA_CONFIG)):
            with MonkeyPatch(self.plugin, _telegram_api=fake_api, _run_action=fake_run_action):
                result = self.plugin._telegram_callback_query(
                    adapter=FakeAdapter(),
                    query=FakeQuery(),
                    data="pc:qa_status:help",
                    chat_id="chat-status",
                    user_id="user-status",
                )

        self.assertEqual(result, {"action": "handled"})
        self.assertEqual(runs, [("telegram_qa_status", "help", False)])
        self.assertEqual([call[0] for call in calls], ["answerCallbackQuery", "sendMessage"])
        self.assertEqual(calls[1][1]["text"], "Последний QA: service-commands\nСтатус: PASS")
        self.assertEqual(calls[1][1]["reply_markup"]["inline_keyboard"][0][0]["callback_data"], "pc:status_help:help")

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

    def test_mode_selector_state_is_per_chat_and_project_neutral(self):
        with tempfile.TemporaryDirectory() as tmp:
            state_path = str(Path(tmp) / "telegram-state.json")
            config = {
                "telegram": {
                    "enabled": True,
                    "callback_prefix": "pc",
                    "mode_selector": {
                        "enabled": True,
                        "state_path": state_path,
                        "default_mode": "fast",
                        "modes": [
                            {"id": "fast", "label": "Fast", "action": "quick"},
                            {"id": "deep", "label": "Deep", "action": "deep"},
                        ],
                    },
                },
            }

            def assertions():
                self.assertEqual(self.plugin._telegram_selected_mode_id("chat-a"), "fast")
                mode = self.plugin._telegram_set_selected_mode("chat-a", "deep")
                self.assertEqual(mode["id"], "deep")
                self.assertEqual(self.plugin._telegram_selected_mode_id("chat-a"), "deep")
                self.assertEqual(self.plugin._telegram_selected_mode_id("chat-b"), "fast")
                data = json.loads(Path(state_path).read_text(encoding="utf-8"))
                self.assertEqual(data["chats"]["telegram:chat-a"]["selectedMode"], "deep")
                self.assertEqual(data["chats"]["telegram:chat-a"]["selectedParticipants"], [])

            self.with_config(config, assertions)

    def test_set_mode_callback_stores_mode_and_sends_confirmation_without_action(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = {
                "telegram": {
                    "enabled": True,
                    "callback_prefix": "pc",
                    "mode_selector": {
                        "enabled": True,
                        "state_path": str(Path(tmp) / "telegram-state.json"),
                        "default_mode": "quick_local",
                        "modes": [
                            {"id": "quick_local", "label": "Быстро локально", "action": "quick"},
                            {"id": "deep_local", "label": "Глубоко локально", "action": "deep"},
                        ],
                    },
                },
                "actions": {
                    "quick": {"exec": ["echo", "quick"]},
                    "deep": {"exec": ["echo", "deep"]},
                },
            }
            calls = []
            runs = []

            def fake_api(method, payload, *, timeout=20):
                calls.append((method, payload, timeout))
                return {"ok": True}

            def fake_run_action(name, action, raw_args, **_):
                runs.append((name, raw_args))
                return "should not run"

            def assertions():
                with MonkeyPatch(self.plugin, _telegram_api=fake_api, _run_action=fake_run_action):
                    result = self.plugin._telegram_callback_query(
                        adapter=FakeAdapter(),
                        query=FakeQuery(),
                        data="pc:set_mode:deep_local",
                        chat_id="chat-mode",
                        user_id="user-mode",
                    )

                self.assertEqual(result, {"action": "handled"})
                self.assertEqual(runs, [])
                self.assertEqual([call[0] for call in calls], ["answerCallbackQuery", "sendMessage"])
                self.assertEqual(calls[0][1]["text"], "Режим выбран.")
                payload = calls[1][1]
                self.assertIn("Глубоко локально", payload["text"])
                keyboard = payload["reply_markup"]["inline_keyboard"]
                flat_buttons = [button for row in keyboard for button in row]
                self.assertIn({"text": "✓ Глубоко локально", "callback_data": "pc:set_mode:deep_local"}, flat_buttons)
                self.assertEqual(self.plugin._telegram_selected_mode_id("chat-mode"), "deep_local")

            self.with_config(config, assertions)

    def test_ask_with_mode_callback_stores_mode_and_prompts_for_plain_question(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = {
                "telegram": {
                    "enabled": True,
                    "callback_prefix": "pc",
                    "mode_selector": {
                        "enabled": True,
                        "state_path": str(Path(tmp) / "telegram-state.json"),
                        "default_mode": "quick_local",
                        "prompt_after_select": "Теперь напиши вопрос обычным языком.",
                        "modes": [
                            {"id": "quick_local", "label": "Быстро", "action": "ask"},
                            {"id": "codex_deep", "label": "Codex", "description": "сильный разбор", "action": "ask"},
                        ],
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
                        data="pc:ask_with_mode:codex_deep",
                        chat_id="chat-mode",
                        user_id="user-mode",
                    )

                self.assertEqual(result, {"action": "handled"})
                self.assertEqual(self.plugin._telegram_selected_mode_id("chat-mode"), "codex_deep")
                payload = calls[1][1]
                self.assertIn("Текущий режим: Codex", payload["text"])
                self.assertIn("Теперь напиши вопрос обычным языком.", payload["text"])
                flat_buttons = [button for row in payload["reply_markup"]["inline_keyboard"] for button in row]
                self.assertIn({"text": "✓ Codex", "callback_data": "pc:set_mode:codex_deep"}, flat_buttons)

            self.with_config(config, assertions)

    def test_choose_participants_callback_can_select_custom_mode_and_prompt(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = {
                "telegram": {
                    "enabled": True,
                    "callback_prefix": "pc",
                    "mode_selector": {
                        "enabled": True,
                        "state_path": str(Path(tmp) / "telegram-state.json"),
                        "default_mode": "balanced",
                        "choose_participants": {
                            "mode": "custom_voices",
                            "prompt": "Напиши имена участников и вопрос одним сообщением.",
                        },
                        "modes": [
                            {"id": "balanced", "label": "Balanced", "action": "ask"},
                            {"id": "custom_voices", "label": "Choose", "action": "ask"},
                        ],
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
                        data="pc:choose_participants:help",
                        chat_id="chat-custom",
                        user_id="user-custom",
                    )

                self.assertEqual(result, {"action": "handled"})
                self.assertEqual(self.plugin._telegram_selected_mode_id("chat-custom"), "custom_voices")
                payload = calls[1][1]
                self.assertIn("Напиши имена участников", payload["text"])
                flat_buttons = [button for row in payload["reply_markup"]["inline_keyboard"] for button in row]
                self.assertIn({"text": "✓ Choose", "callback_data": "pc:set_mode:custom_voices"}, flat_buttons)

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
