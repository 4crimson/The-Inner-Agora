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
