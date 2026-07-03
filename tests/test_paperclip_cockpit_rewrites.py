import importlib.util
import json
import os
import tempfile
import unittest
from unittest import mock
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLUGIN_PATH = ROOT / "hermes-plugins" / "paperclip-cockpit" / "__init__.py"
AGORA_CONFIG = ROOT / "paperclip-cockpit.json"


def load_plugin():
    spec = importlib.util.spec_from_file_location("paperclip_cockpit_under_test", PLUGIN_PATH)
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


class PaperclipCockpitRewriteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plugin = load_plugin()

    def rewrite(self, text):
        with EnvPatch(
            PAPERCLIP_COCKPIT_CONFIG=str(AGORA_CONFIG),
            PAPERCLIP_COCKPIT_NL_REWRITE="1",
            PAPERCLIP_COCKPIT_NL_WRITES="0",
            PAPERCLIP_COCKPIT_COMMAND=None,
        ):
            return self.plugin._rewrite_text(text)

    def dispatch(self, text):
        class Event:
            pass

        event = Event()
        event.text = text
        with EnvPatch(
            PAPERCLIP_COCKPIT_CONFIG=str(AGORA_CONFIG),
            PAPERCLIP_COCKPIT_NL_REWRITE="1",
            PAPERCLIP_COCKPIT_NL_WRITES="0",
            PAPERCLIP_COCKPIT_COMMAND=None,
            PAPERCLIP_COCKPIT_ALLOWED_PLATFORMS=None,
            PAPERCLIP_COCKPIT_ALLOWED_CHATS=None,
        ):
            return self.plugin._pre_gateway_dispatch(event)

    def test_natural_agora_research_roundtrip_phrases(self):
        cases = {
            "давай спросим агору про отцов и детей": "/agora ask ",
            "мне интересно что сказали философы про родителей и детей, запусти совет": "/agora ask ",
            "поставь задачу: как разные философы понимали конфликт отцов и детей": "/agora ask ",
            "давай исследуем почему дети спорят с родителями у философов": "/agora ask ",
            "собери консилиум по теме вина перед родителями": "/agora ask ",
            "что там по последней сессии?": "/agora latest",
            "готов ли синтез по последней задаче?": "/agora result",
            "собери синтез по последней сессии": "/agora synth",
            "дай выжимку по последней таске": "/agora latest",
            "покажи 55 таску": "/agora session THE-55",
            "Посмотри 55 таску,": "/agora session THE-55",
            "хочу подробнее по Нагарджуне из последней сессии": "/agora voice ",
            "а что сказал Платон?": "/agora voice ",
        }
        for phrase, expected_prefix in cases.items():
            with self.subTest(phrase=phrase):
                rewritten = self.rewrite(phrase)
                self.assertIsNotNone(rewritten)
                self.assertTrue(
                    rewritten.startswith(expected_prefix),
                    f"{phrase!r} rewrote to {rewritten!r}, expected prefix {expected_prefix!r}",
                )

    def test_ten_human_question_prompts_route_to_agora_ask(self):
        prompts = [
            "давай спросим агору, как стоики смотрели бы на тревогу родителей перед будущим детей",
            "хочу спросить агору про вину перед родителями и взросление",
            "собери совет: можно ли любить ребенка, не превращая его в проект",
            "исследуем, почему семья иногда становится оправданием несправедливости",
            "задай агоре вопрос о свободе ребенка и власти родителей",
            "давай исследуем, что значит почитать родителей без рабства",
            "создай консилиум по теме детство, дисциплина и свобода",
            "поставь задачу: как философы различали заботу и контроль в семье",
            "запусти исследование про конфликт личного пути и семейного долга",
            "сделай совет философов о том, когда дети ничего не должны родителям",
        ]
        for prompt in prompts:
            with self.subTest(prompt=prompt):
                rewritten = self.rewrite(prompt)
                self.assertIsNotNone(rewritten)
                self.assertTrue(rewritten.startswith("/agora ask "), rewritten)

    def test_pre_gateway_dispatch_rewrites_human_text_before_llm(self):
        result = self.dispatch("давай спросим агору про отцов и детей")

        self.assertIsNotNone(result)
        self.assertEqual(result["action"], "rewrite")
        self.assertTrue(result["text"].startswith("/agora ask "), result)

    def test_configured_start_rewrite_is_generic(self):
        config = {
            "command": {"name": "agora"},
            "natural_language": {"start": {"action": "start"}},
        }
        with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8") as handle:
            json.dump(config, handle)
            handle.flush()
            with EnvPatch(
                PAPERCLIP_COCKPIT_CONFIG=handle.name,
                PAPERCLIP_COCKPIT_NL_REWRITE="1",
                PAPERCLIP_COCKPIT_NL_WRITES="0",
                PAPERCLIP_COCKPIT_COMMAND=None,
            ):
                self.assertEqual(self.plugin._rewrite_text("/start"), "/agora start")
                self.assertEqual(self.plugin._rewrite_text("/start@InnerAgoraBot"), "/agora start")

    def test_generic_config_drives_command_action_and_issue_prefix(self):
        config = {
            "command": {"name": "work"},
            "issue": {"default_prefix": "WK"},
            "terms": {"task": "ticket"},
            "aliases": {"task": ["ticket", "тикет"]},
            "actions": {
                "research": {
                    "natural_aliases": ["start research"],
                    "exec": ["echo", "ok"],
                }
            },
        }
        with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8") as handle:
            json.dump(config, handle)
            handle.flush()
            with EnvPatch(
                PAPERCLIP_COCKPIT_CONFIG=handle.name,
                PAPERCLIP_COCKPIT_NL_REWRITE="1",
                PAPERCLIP_COCKPIT_NL_WRITES="0",
                PAPERCLIP_COCKPIT_COMMAND=None,
            ):
                self.assertEqual(
                    self.plugin._rewrite_text("start research pricing strategy"),
                    "/work research pricing strategy",
                )
                self.assertEqual(self.plugin._rewrite_text("show ticket 42"), "/work ticket WK-42")

    def test_configured_presets_rewrite_from_human_aliases(self):
        config = {
            "command": {"name": "agora"},
            "actions": {
                "quick": {"natural_aliases": ["быстрый совет"], "exec": ["echo", "quick"]},
                "deep": {"natural_aliases": ["глубокое исследование"], "exec": ["echo", "deep"]},
                "go-no-go": {"natural_aliases": ["go/no-go"], "exec": ["echo", "go"]},
            },
        }
        with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8") as handle:
            json.dump(config, handle)
            handle.flush()
            with EnvPatch(
                PAPERCLIP_COCKPIT_CONFIG=handle.name,
                PAPERCLIP_COCKPIT_NL_REWRITE="1",
                PAPERCLIP_COCKPIT_NL_WRITES="0",
                PAPERCLIP_COCKPIT_COMMAND=None,
            ):
                self.assertEqual(self.plugin._rewrite_text("быстрый совет: стоит ли ждать"), "/agora quick стоит ли ждать")
                self.assertEqual(
                    self.plugin._rewrite_text("глубокое исследование: свобода и долг"),
                    "/agora deep свобода и долг",
                )
                self.assertEqual(self.plugin._rewrite_text("go/no-go: нанимать CTO"), "/agora go-no-go нанимать CTO")

    def test_real_quick_and_deep_actions_force_local_adapter(self):
        config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))
        for name in ("quick", "deep"):
            with self.subTest(action=name):
                self.assertEqual(config["actions"][name]["env"]["INNER_AGORA_FORCE_LOCAL_ADAPTER"], "1")
                self.assertEqual(config["actions"][name]["env"]["INNER_AGORA_MODE"], "local")

    def test_real_mode_selector_defines_local_route_modes(self):
        config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))
        selector = config["telegram"]["mode_selector"]
        self.assertTrue(selector["enabled"])
        self.assertEqual(selector["default_mode"], "balanced_local")
        self.assertEqual(selector["apply_to_actions"], ["ask"])
        self.assertIn("home", selector["menus"])
        modes = {mode["id"]: mode for mode in selector["modes"]}
        for mode_id, args in {
            "quick_local": "--min",
            "balanced_local": "--balanced",
            "deep_local": "--max",
            "all_local": "--all",
        }.items():
            with self.subTest(mode=mode_id):
                self.assertEqual(modes[mode_id]["action"], "ask")
                self.assertEqual(modes[mode_id]["args"], args)
                self.assertEqual(modes[mode_id]["env"]["INNER_AGORA_FORCE_LOCAL_ADAPTER"], "1")
                self.assertEqual(modes[mode_id]["env"]["INNER_AGORA_MODE"], "local")
        self.assertEqual(modes["go_no_go_local"]["action"], "go-no-go")
        self.assertEqual(modes["go_no_go_local"]["env"]["INNER_AGORA_ACTIVE_CHAMBER"], "board-directors")

    def test_natural_rewrite_can_delegate_to_configured_understander(self):
        config = {
            "command": {"name": "agora"},
            "natural_language": {
                "delegate": {
                    "exec": [
                        "node",
                        "scripts/agora.mjs",
                        "natural",
                        "--routing-mode",
                        "regex",
                        "--dry-run",
                        "--json",
                        "{text}",
                    ]
                }
            },
        }
        with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8") as handle:
            json.dump(config, handle)
            handle.flush()
            with EnvPatch(
                PAPERCLIP_COCKPIT_CONFIG=handle.name,
                PAPERCLIP_COCKPIT_CWD=str(ROOT),
                PAPERCLIP_COCKPIT_NL_REWRITE="1",
                PAPERCLIP_COCKPIT_NL_WRITES="0",
                PAPERCLIP_COCKPIT_COMMAND=None,
            ):
                self.assertEqual(self.plugin._rewrite_text("дай выжимку по последней таске"), "/agora latest")

    def test_natural_delegate_message_is_sent_and_skips_gateway(self):
        config = {
            "command": {"name": "agora"},
            "telegram": {
                "enabled": True,
                "callback_prefix": "pc",
                "help_buttons": [
                    {"label": "Новый вопрос", "callback": "new_question"},
                    {"label": "Последний итог", "callback": "latest"},
                ],
            },
            "natural_language": {
                "delegate": {
                    "exec": [
                        "node",
                        "scripts/agora.mjs",
                        "natural",
                        "--routing-mode",
                        "regex",
                        "--dry-run",
                        "--json",
                        "{text}",
                    ]
                }
            },
        }
        calls = []

        def fake_telegram_api(method, payload, *, timeout=20):
            calls.append((method, payload, timeout))
            return {"ok": True}

        class Source:
            platform = "telegram"
            chat_id = "chat-help"

        class Event:
            source = Source()
            text = "агора помощь"

        with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8") as handle:
            json.dump(config, handle)
            handle.flush()
            with EnvPatch(
                PAPERCLIP_COCKPIT_CONFIG=handle.name,
                PAPERCLIP_COCKPIT_CWD=str(ROOT),
                PAPERCLIP_COCKPIT_NL_REWRITE="1",
                PAPERCLIP_COCKPIT_NL_WRITES="0",
                PAPERCLIP_COCKPIT_COMMAND=None,
            ), mock.patch.object(self.plugin, "_telegram_api", fake_telegram_api):
                result = self.plugin._pre_gateway_dispatch(Event())

        self.assertEqual(result, {"action": "skip"})
        self.assertEqual([call[0] for call in calls], ["sendMessage"])
        self.assertEqual(calls[0][1]["chat_id"], "chat-help")
        self.assertIn("быстрый совет", calls[0][1]["text"])
        self.assertNotIn("Project action", calls[0][1]["text"])
        self.assertEqual(
            calls[0][1]["reply_markup"]["inline_keyboard"],
            [
                [
                    {"text": "Новый вопрос", "callback_data": "pc:new_question:help"},
                    {"text": "Последний итог", "callback_data": "pc:latest:help"},
                ]
            ],
        )

    def test_telegram_command_boundary_intercepts_service_commands_with_buttons(self):
        config = {
            "command": {"name": "agora"},
            "presentation": {"mode": "human", "language": "ru", "show_technical_by_default": False},
            "telegram": {
                "enabled": True,
                "callback_prefix": "pc",
                "command_boundary": {
                    "enabled": True,
                    "commands": {
                        "home": ["/help", "/agora", "/agora help"],
                        "agents": ["/agents"],
                        "allow_full": ["/agora help full"],
                    },
                    "menus": {
                        "home": {
                            "text": "Агора помогает обычным языком.",
                            "buttons": [
                                {"label": "Быстрый совет", "callback": "new_question"},
                                {"label": "Глубокое исследование", "callback": "deepen"},
                            ],
                        },
                        "agents": {
                            "text": "В Агоре агенты - это голоса и текущие сессии.",
                            "buttons": [
                                {"label": "Философы", "callback": "noop"},
                                {"label": "Прогресс", "callback": "latest"},
                            ],
                        },
                    },
                },
            },
        }

        class Source:
            platform = "telegram"
            chat_id = "chat-command"

        class Event:
            source = Source()
            text = ""

        def run_case(text):
            calls = []

            def fake_telegram_api(method, payload, *, timeout=20):
                calls.append((method, payload, timeout))
                return {"ok": True}

            event = Event()
            event.text = text
            with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8") as handle:
                json.dump(config, handle)
                handle.flush()
                with EnvPatch(
                    PAPERCLIP_COCKPIT_CONFIG=handle.name,
                    PAPERCLIP_COCKPIT_NL_REWRITE="1",
                    PAPERCLIP_COCKPIT_NL_WRITES="0",
                    PAPERCLIP_COCKPIT_COMMAND=None,
                    PAPERCLIP_COCKPIT_ALLOWED_PLATFORMS=None,
                    PAPERCLIP_COCKPIT_ALLOWED_CHATS=None,
                ), mock.patch.object(self.plugin, "_telegram_api", fake_telegram_api):
                    result = self.plugin._pre_gateway_dispatch(event)
            return result, calls

        for command_text in ("/help", "/help@InnerAgoraBot", "/agora", "/agora help"):
            with self.subTest(command=command_text):
                result, calls = run_case(command_text)
                self.assertEqual(result, {"action": "skip"})
                self.assertEqual([call[0] for call in calls], ["sendMessage"])
                payload = calls[0][1]
                self.assertEqual(payload["chat_id"], "chat-command")
                self.assertIn("Агора помогает", payload["text"])
                self.assertNotIn("Active Agents & Tasks", payload["text"])
                self.assertEqual(
                    payload["reply_markup"]["inline_keyboard"][0],
                    [
                        {"text": "Быстрый совет", "callback_data": "pc:new_question:help"},
                        {"text": "Глубокое исследование", "callback_data": "pc:deepen:help"},
                    ],
                )

        for command_text in ("/agents", "/agents@InnerAgoraBot"):
            with self.subTest(command=command_text):
                result, calls = run_case(command_text)
                self.assertEqual(result, {"action": "skip"})
                payload = calls[0][1]
                self.assertIn("голоса и текущие сессии", payload["text"])
                self.assertNotIn("Active Agents & Tasks", payload["text"])
                self.assertEqual(
                    payload["reply_markup"]["inline_keyboard"][0],
                    [
                        {"text": "Философы", "callback_data": "pc:noop:help"},
                        {"text": "Прогресс", "callback_data": "pc:latest:help"},
                    ],
                )

    def test_command_boundary_home_menu_includes_configured_mode_buttons(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = {
                "command": {"name": "agora"},
                "telegram": {
                    "enabled": True,
                    "callback_prefix": "pc",
                    "command_boundary": {
                        "enabled": True,
                        "commands": {"home": ["/help"]},
                        "menus": {
                            "home": {
                                "text": "Меню Agora.",
                                "buttons": [{"label": "Итог", "callback": "latest"}],
                            }
                        },
                    },
                    "mode_selector": {
                        "enabled": True,
                        "state_path": str(Path(tmp) / "telegram-state.json"),
                        "default_mode": "quick_local",
                        "menus": ["home"],
                        "show_current_mode": True,
                        "modes": [
                            {"id": "quick_local", "label": "Быстро", "description": "короткий локальный ответ", "action": "quick"},
                            {"id": "deep_local", "label": "Глубоко", "description": "полный локальный совет", "action": "deep"},
                        ],
                    },
                },
                "callbacks": {"noop": {"answer": "OK"}},
            }
            calls = []

            def fake_telegram_api(method, payload, *, timeout=20):
                calls.append((method, payload, timeout))
                return {"ok": True}

            class Source:
                platform = "telegram"
                chat_id = "chat-mode-menu"

            class Event:
                source = Source()
                text = "/help"

            with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8") as handle:
                json.dump(config, handle)
                handle.flush()
                with EnvPatch(PAPERCLIP_COCKPIT_CONFIG=handle.name), mock.patch.object(
                    self.plugin, "_telegram_api", fake_telegram_api
                ):
                    result = self.plugin._pre_gateway_dispatch(Event())

            self.assertEqual(result, {"action": "skip"})
            payload = calls[0][1]
            self.assertIn("Текущий режим: Быстро", payload["text"])
            flat_buttons = [button for row in payload["reply_markup"]["inline_keyboard"] for button in row]
            self.assertIn({"text": "✓ Быстро", "callback_data": "pc:set_mode:quick_local"}, flat_buttons)
            self.assertIn({"text": "Глубоко", "callback_data": "pc:set_mode:deep_local"}, flat_buttons)

    def test_selected_mode_executes_natural_question_with_mode_action(self):
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
                        "default_mode": "quick_local",
                        "apply_to_actions": ["ask"],
                        "modes": [
                            {
                                "id": "quick_local",
                                "label": "Быстро",
                                "action": "quick",
                                "args": "--min",
                                "env": {"INNER_AGORA_FORCE_LOCAL_ADAPTER": "1"},
                            },
                            {
                                "id": "deep_local",
                                "label": "Глубоко",
                                "action": "deep",
                                "args": "--max",
                                "env": {"INNER_AGORA_FORCE_LOCAL_ADAPTER": "1"},
                            },
                        ],
                    },
                },
                "actions": {
                    "ask": {"natural_aliases": ["собери совет"], "exec": ["echo", "ask"]},
                    "quick": {"exec": ["echo", "quick"]},
                    "deep": {"exec": ["echo", "deep"]},
                },
            }
            calls = []
            runs = []

            def fake_send(chat_id, text, reply_markup=None):
                calls.append((chat_id, text, reply_markup))

            def fake_run_action(name, action, raw_args, **kwargs):
                runs.append((name, action, raw_args, kwargs))
                return json.dumps({"text": f"ran {name}: {raw_args}", "reply_markup": {"inline_keyboard": []}})

            class Source:
                platform = "telegram"
                chat_id = "chat-route"

            class Event:
                source = Source()
                text = "собери совет про свободу ребенка"

            with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8") as handle:
                json.dump(config, handle)
                handle.flush()
                with EnvPatch(
                    PAPERCLIP_COCKPIT_CONFIG=handle.name,
                    PAPERCLIP_COCKPIT_NL_REWRITE="1",
                    PAPERCLIP_COCKPIT_NL_WRITES="0",
                    PAPERCLIP_COCKPIT_COMMAND=None,
                    TELEGRAM_BOT_TOKEN="test-token",
                ), mock.patch.object(self.plugin, "_telegram_send_message", fake_send), mock.patch.object(
                    self.plugin, "_run_action", fake_run_action
                ):
                    self.plugin._telegram_set_selected_mode("chat-route", "deep_local")
                    result = self.plugin._pre_gateway_dispatch(Event())

            self.assertEqual(result, {"action": "skip"})
            self.assertEqual(runs[0][0], "deep")
            self.assertEqual(runs[0][2], "--max про свободу ребенка")
            self.assertEqual(runs[0][1]["env"]["INNER_AGORA_FORCE_LOCAL_ADAPTER"], "1")
            self.assertEqual(runs[0][3]["chat_id"], "chat-route")
            self.assertEqual(calls[0][0], "chat-route")
            self.assertIn("ran deep", calls[0][1])

    def test_telegram_command_boundary_allows_full_help_path(self):
        config = {
            "command": {"name": "agora"},
            "telegram": {
                "enabled": True,
                "command_boundary": {
                    "enabled": True,
                    "commands": {
                        "home": ["/help", "/agora", "/agora help"],
                        "agents": ["/agents"],
                        "allow_full": ["/agora help full"],
                    },
                    "menus": {
                        "home": {"text": "Home", "buttons": [{"label": "Help", "callback": "noop"}]},
                        "agents": {"text": "Agents", "buttons": [{"label": "Help", "callback": "noop"}]},
                    },
                },
            },
        }
        calls = []

        def fake_telegram_api(method, payload, *, timeout=20):
            calls.append((method, payload, timeout))
            return {"ok": True}

        class Source:
            platform = "telegram"
            chat_id = "chat-command"

        class Event:
            source = Source()
            text = "/agora help full"

        with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8") as handle:
            json.dump(config, handle)
            handle.flush()
            with EnvPatch(
                PAPERCLIP_COCKPIT_CONFIG=handle.name,
                PAPERCLIP_COCKPIT_NL_REWRITE="1",
                PAPERCLIP_COCKPIT_NL_WRITES="0",
                PAPERCLIP_COCKPIT_COMMAND=None,
            ), mock.patch.object(self.plugin, "_telegram_api", fake_telegram_api):
                result = self.plugin._pre_gateway_dispatch(Event())

        self.assertIsNone(result)
        self.assertEqual(calls, [])

    def test_telegram_command_boundary_supports_arbitrary_menu_names(self):
        config = {
            "telegram": {
                "enabled": True,
                "callback_prefix": "wk",
                "command_boundary": {
                    "enabled": True,
                    "commands": {
                        "support": ["/support", "/helpdesk"],
                        "billing": ["/billing"],
                    },
                    "menus": {
                        "support": {
                            "text": "Support menu",
                            "buttons": [{"label": "Open ticket", "callback": "open_ticket"}],
                        },
                        "billing": {
                            "text": "Billing menu",
                            "buttons": [{"label": "Invoice", "callback": "invoice"}],
                        },
                    },
                },
                "callbacks": {
                    "open_ticket": {"message": "Write your support question."},
                    "invoice": {"message": "Write invoice number."},
                },
            },
        }
        calls = []

        def fake_telegram_api(method, payload, *, timeout=20):
            calls.append((method, payload, timeout))
            return {"ok": True}

        class Source:
            platform = "telegram"
            chat_id = "chat-generic"

        class Event:
            source = Source()
            text = "/support"

        with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8") as handle:
            json.dump(config, handle)
            handle.flush()
            with EnvPatch(PAPERCLIP_COCKPIT_CONFIG=handle.name), mock.patch.object(
                self.plugin, "_telegram_api", fake_telegram_api
            ):
                result = self.plugin._pre_gateway_dispatch(Event())

        self.assertEqual(result, {"action": "skip"})
        self.assertEqual(calls[0][1]["text"], "Support menu")
        self.assertEqual(
            calls[0][1]["reply_markup"]["inline_keyboard"][0][0],
            {"text": "Open ticket", "callback_data": "wk:open_ticket:help"},
        )

    def test_telegram_command_boundary_validation_reports_bad_config(self):
        config = {
            "telegram": {
                "enabled": True,
                "command_boundary": {
                    "enabled": True,
                    "commands": {
                        "support": ["/support"],
                        "missing": ["/missing"],
                    },
                    "menus": {
                        "support": {
                            "text": "Support menu",
                            "buttons": [
                                {"label": "Open ticket", "callback": "open_ticket"},
                                {"label": "Broken", "callback": "not_configured"},
                            ],
                        },
                        "empty": {"buttons": [{"label": "Help", "callback": "open_ticket"}]},
                    },
                },
                "callbacks": {
                    "open_ticket": {"message": "Write your support question."},
                },
            },
        }
        with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8") as handle:
            json.dump(config, handle)
            handle.flush()
            with EnvPatch(PAPERCLIP_COCKPIT_CONFIG=handle.name):
                errors = self.plugin._telegram_command_boundary_errors()

        self.assertIn("telegram.command_boundary.commands.missing references missing menu missing", errors)
        self.assertIn("telegram.command_boundary.menus.empty.text is required", errors)
        self.assertIn(
            "telegram.command_boundary.menus.support.buttons[1].callback references missing callback not_configured",
            errors,
        )

    def test_telegram_command_boundary_skips_raw_route_when_bot_api_fails(self):
        config = {
            "telegram": {
                "enabled": True,
                "command_boundary": {
                    "enabled": True,
                    "commands": {"help": ["/help"]},
                    "menus": {
                        "help": {
                            "text": "Help menu",
                            "buttons": [{"label": "Help", "callback": "noop"}],
                        },
                    },
                },
                "callbacks": {"noop": {"answer": "OK"}},
            },
        }

        def fake_telegram_api(method, payload, *, timeout=20):
            raise self.plugin.PaperclipError("Telegram sendMessage failed")

        class Source:
            platform = "telegram"
            chat_id = "chat-fallback"

        class Event:
            source = Source()
            text = "/help"

        with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8") as handle:
            json.dump(config, handle)
            handle.flush()
            with EnvPatch(PAPERCLIP_COCKPIT_CONFIG=handle.name), mock.patch.object(
                self.plugin, "_telegram_api", fake_telegram_api
            ):
                result = self.plugin._pre_gateway_dispatch(Event())

        self.assertEqual(result, {"action": "skip"})

    def test_full_help_is_grouped_and_readable_in_human_mode(self):
        config = {
            "command": {"name": "agora"},
            "presentation": {
                "mode": "human",
                "language": "ru",
                "show_technical_by_default": False,
                "help": {
                    "full_headings": {
                        "agent_commands_heading": "Философы/голоса:",
                    },
                },
            },
            "actions": {
                "quick": {
                    "usage": "quick TEXT",
                    "presentation": {"description": "быстрый совет"},
                    "exec": ["echo", "quick"],
                },
                "deep": {
                    "usage": "deep TEXT",
                    "presentation": {"description": "глубокое исследование"},
                    "exec": ["echo", "deep"],
                },
            },
        }
        with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8") as handle:
            json.dump(config, handle)
            handle.flush()
            with EnvPatch(
                PAPERCLIP_COCKPIT_CONFIG=handle.name,
                PAPERCLIP_COCKPIT_NL_REWRITE="1",
                PAPERCLIP_COCKPIT_NL_WRITES="0",
                PAPERCLIP_COCKPIT_COMMAND=None,
            ):
                help_text = self.plugin._help("full")

        self.assertIn("Обычный вход", help_text)
        self.assertIn("пиши обычным языком", help_text)
        self.assertIn("Обычные команды", help_text)
        self.assertIn("Работа с сессиями", help_text)
        self.assertIn("Философы/голоса", help_text)
        self.assertIn("Админ/диагностика", help_text)
        self.assertIn("Безопасность", help_text)
        self.assertIn("/agora quick TEXT", help_text)
        self.assertIn("/agora deep TEXT", help_text)
        self.assertLess(help_text.index("Обычные команды"), help_text.index("Админ/диагностика"))

    def test_run_action_can_take_cwd_from_environment(self):
        config = {"actions": {"where": {"exec": ["pwd"], "append_args": False}}}
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "paperclip-cockpit.json"
            config_path.write_text(json.dumps(config), encoding="utf-8")
            action_cwd = Path(temp_dir) / "action-cwd"
            action_cwd.mkdir()
            with EnvPatch(
                PAPERCLIP_COCKPIT_CONFIG=str(config_path),
                PAPERCLIP_COCKPIT_CWD=str(action_cwd),
            ):
                self.assertEqual(
                    self.plugin._run_action("where", config["actions"]["where"], ""),
                    str(action_cwd.resolve()),
                )


if __name__ == "__main__":
    unittest.main()
