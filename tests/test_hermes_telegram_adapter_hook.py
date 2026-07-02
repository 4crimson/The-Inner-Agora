import ast
import asyncio
import sys
import types
import unittest
from pathlib import Path


ADAPTER_PATH = Path("/Users/admin/.hermes/hermes-agent/plugins/platforms/telegram/adapter.py")


def load_callback_handler_class():
    source = ADAPTER_PATH.read_text(encoding="utf-8")
    module = ast.parse(source, filename=str(ADAPTER_PATH))
    handler = None
    for node in ast.walk(module):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "_handle_callback_query":
            handler = node
            break
    assert handler is not None, "_handle_callback_query not found"

    class_node = ast.ClassDef(
        name="AdapterCallbackUnderTest",
        bases=[],
        keywords=[],
        body=[handler],
        decorator_list=[],
    )
    test_module = ast.Module(body=[class_node], type_ignores=[])
    ast.fix_missing_locations(test_module)

    namespace = {
        "logger": types.SimpleNamespace(warning=lambda *args, **kwargs: None),
    }
    exec(compile(test_module, str(ADAPTER_PATH), "exec"), namespace)
    return namespace["AdapterCallbackUnderTest"]


class FakeTelegramUpdate:
    def __init__(self, data):
        self.callback_query = types.SimpleNamespace(
            data=data,
            message=types.SimpleNamespace(
                chat_id="chat-1",
                chat=types.SimpleNamespace(type="private"),
                message_thread_id=None,
            ),
            from_user=types.SimpleNamespace(id="user-1", first_name="Alice"),
        )


class HermesTelegramAdapterHookTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.CallbackClass = load_callback_handler_class()

    def with_fake_hook(self, hook_result, callback):
        calls = []

        def invoke_hook(name, **kwargs):
            calls.append((name, kwargs))
            return hook_result

        parent = types.ModuleType("hermes_cli")
        plugins = types.ModuleType("hermes_cli.plugins")
        plugins.invoke_hook = invoke_hook
        parent.plugins = plugins

        old_parent = sys.modules.get("hermes_cli")
        old_plugins = sys.modules.get("hermes_cli.plugins")
        sys.modules["hermes_cli"] = parent
        sys.modules["hermes_cli.plugins"] = plugins
        try:
            return callback(calls)
        finally:
            if old_parent is None:
                sys.modules.pop("hermes_cli", None)
            else:
                sys.modules["hermes_cli"] = old_parent
            if old_plugins is None:
                sys.modules.pop("hermes_cli.plugins", None)
            else:
                sys.modules["hermes_cli.plugins"] = old_plugins

    def test_project_callback_hook_short_circuits_before_builtin_prefixes(self):
        class Adapter(self.CallbackClass):
            name = "telegram-test"

            def __init__(self):
                self.model_picker_calls = []

            async def _handle_model_picker_callback(self, *args):
                self.model_picker_calls.append(args)

        adapter = Adapter()
        update = FakeTelegramUpdate("mp:would-normally-be-model-picker")

        def assertions(calls):
            asyncio.run(adapter._handle_callback_query(update, None))
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0][0], "telegram_callback_query")
            self.assertEqual(calls[0][1]["data"], "mp:would-normally-be-model-picker")
            self.assertEqual(calls[0][1]["chat_id"], "chat-1")
            self.assertEqual(calls[0][1]["user_id"], "user-1")
            self.assertEqual(adapter.model_picker_calls, [])

        self.with_fake_hook([{"action": "handled"}], assertions)

    def test_builtin_callback_still_runs_when_project_hook_does_not_handle(self):
        class Adapter(self.CallbackClass):
            name = "telegram-test"

            def __init__(self):
                self.model_picker_calls = []

            async def _handle_model_picker_callback(self, query, data, chat_id):
                self.model_picker_calls.append((query, data, chat_id))

        adapter = Adapter()
        update = FakeTelegramUpdate("mp:model-picker")

        def assertions(calls):
            asyncio.run(adapter._handle_callback_query(update, None))
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0][0], "telegram_callback_query")
            self.assertEqual(len(adapter.model_picker_calls), 1)
            self.assertEqual(adapter.model_picker_calls[0][1:], ("mp:model-picker", "chat-1"))

        self.with_fake_hook([], assertions)


if __name__ == "__main__":
    unittest.main()
