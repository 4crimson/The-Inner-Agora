# Telegram Mode Routing Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Telegram mode buttons whose selected persistent chat mode controls the next natural Agora question's route, action args/env, and participants.

**Implementation Status:** Done locally on 2026-07-03, pending explicit live Telegram retest. Implemented generic `telegram.mode_selector`, Inner Agora local route modes, short role alias handling, pair-voice parsing, QA docs/config, and regression harness state isolation.

**Verification:** `python3 -m unittest discover -s tests -p 'test*.py' -v` (209 tests), `node scripts/regression.mjs check`, and `CHAMBER_MODE=chambers node scripts/regression.mjs check`.

**Architecture:** The generic Paperclip Cockpit plugin stores small per-chat UI state, renders configured mode buttons, handles built-in `set_mode` callbacks, and applies the selected mode to natural Agora question actions before the Hermes slash router can drop mode env. Inner Agora supplies mode definitions, labels, action mappings, and participant policy in config/scripts. The first implementation is session-level routing only; mixed per-agent adapters remain future-compatible through metadata but are not implemented now.

**Tech Stack:** Python Hermes plugin (`hermes-plugins/paperclip-cockpit/__init__.py`), Node Inner Agora CLI (`scripts/agora.mjs`, `scripts/model-routing.mjs`), JSON project config (`paperclip-cockpit.json`, `cockpit.core.json`), Python unittest suite, Node regression harness.

---

## File Structure

- Modify `hermes-plugins/paperclip-cockpit/__init__.py`
  - Add generic Telegram mode selector config/state helpers.
  - Extend Telegram keyboard rendering with mode buttons.
  - Add built-in callbacks `set_mode`, `reset_mode`, and `show_modes`.
  - Apply selected mode to natural project action execution with merged args/env.

- Modify `paperclip-cockpit.json` and `cockpit.core.json`
  - Add `telegram.mode_selector` modes for `quick_local`, `deep_local`, `codex_deep`, `all_voices`, and `custom_voices`.
  - Keep all Inner Agora words in these configs, not in plugin Python.

- Modify `scripts/agora.mjs`
  - Fix participant token resolution for short aliases such as `Сартр`.
  - Fix requested voice count parsing for `пару философов`, `2 философа`, and `двух философов`.
  - Keep route metadata recording unchanged.

- Modify tests:
  - `tests/test_paperclip_cockpit_telegram_callbacks.py`
  - `tests/test_paperclip_cockpit_rewrites.py`
  - `tests/test_inner_agora_ask_flow.py`

- Modify docs:
  - `docs/roadmap/BUGS.md`
  - `docs/telegram-testing/TELEGRAM_ACCEPTANCE_CHECKLIST.md`

---

### Task 1: Generic Mode Selector Config And State

**Files:**
- Modify: `hermes-plugins/paperclip-cockpit/__init__.py`
- Test: `tests/test_paperclip_cockpit_telegram_callbacks.py`

- [ ] **Step 1: Write failing tests for mode config and state**

Add tests near `PaperclipCockpitTelegramCallbackTests`:

```python
    def test_mode_selector_state_is_per_chat_and_project_neutral(self):
        config = {
            "telegram": {
                "enabled": True,
                "callback_prefix": "pc",
                "mode_selector": {
                    "enabled": True,
                    "state_path": str(Path(tempfile.gettempdir()) / "pc-mode-state-test.json"),
                    "default": "quick_local",
                    "modes": [
                        {"id": "quick_local", "label": "Quick", "action": "quick"},
                        {"id": "codex_deep", "label": "Codex", "action": "ask", "args": ["--max"]},
                    ],
                },
            },
        }

        def assertions():
            state_path = Path(config["telegram"]["mode_selector"]["state_path"])
            if state_path.exists():
                state_path.unlink()
            self.assertEqual(self.plugin._telegram_selected_mode_id("chat-a"), "quick_local")
            self.plugin._telegram_set_selected_mode("chat-a", "codex_deep")
            self.assertEqual(self.plugin._telegram_selected_mode_id("chat-a"), "codex_deep")
            self.assertEqual(self.plugin._telegram_selected_mode_id("chat-b"), "quick_local")
            payload = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertIn("telegram:chat-a", payload["chats"])
            self.assertEqual(payload["chats"]["telegram:chat-a"]["selectedMode"], "codex_deep")
            state_path.unlink()

        self.with_config(config, assertions)
```

Expected failure: `_telegram_selected_mode_id` and `_telegram_set_selected_mode` do not exist.

- [ ] **Step 2: Run the failing test**

Run:

```bash
python3 -m unittest tests.test_paperclip_cockpit_telegram_callbacks.PaperclipCockpitTelegramCallbackTests.test_mode_selector_state_is_per_chat_and_project_neutral -v
```

Expected: FAIL with `AttributeError`.

- [ ] **Step 3: Implement config/state helpers**

Add focused helpers after `_telegram_config()`:

```python
def _telegram_mode_selector_config() -> dict[str, Any]:
    raw = _telegram_config().get("mode_selector", {})
    return raw if isinstance(raw, dict) and _as_bool(raw.get("enabled"), False) else {}


def _telegram_mode_selector_modes() -> list[dict[str, Any]]:
    selector = _telegram_mode_selector_config()
    modes = selector.get("modes", [])
    return [item for item in modes if isinstance(item, dict) and str(item.get("id") or "").strip()]


def _telegram_mode_by_id(mode_id: str) -> dict[str, Any] | None:
    wanted = str(mode_id or "").strip()
    for mode in _telegram_mode_selector_modes():
        if str(mode.get("id") or "").strip() == wanted:
            return mode
    return None


def _telegram_default_mode_id() -> str:
    selector = _telegram_mode_selector_config()
    configured = str(selector.get("default") or "").strip()
    if configured and _telegram_mode_by_id(configured):
        return configured
    modes = _telegram_mode_selector_modes()
    return str(modes[0].get("id") or "").strip() if modes else ""


def _telegram_mode_state_path() -> str:
    selector = _telegram_mode_selector_config()
    explicit = str(selector.get("state_path") or selector.get("state_file") or "").strip()
    if explicit:
        return explicit
    cwd = str(_config().get("cwd") or _terminal_cwd() or os.getcwd())
    return os.path.join(cwd, ".paperclip-cockpit-telegram-state.json")


def _telegram_mode_state_key(chat_id: Any, platform: str = "telegram") -> str:
    chat = str(chat_id or "").strip() or _telegram_home_chat() or "default"
    return f"{platform}:{chat}"


def _telegram_read_mode_state() -> dict[str, Any]:
    path = _telegram_mode_state_path()
    try:
        if not path or not os.path.exists(path):
            return {"chats": {}}
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"chats": {}}
    except Exception as exc:
        logger.warning("Could not read Telegram mode state %s: %s", path, exc)
        return {"chats": {}}


def _telegram_write_mode_state(state: dict[str, Any]) -> None:
    path = _telegram_mode_state_path()
    if not path:
        return
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    temp = f"{path}.tmp-{os.getpid()}"
    Path(temp).write_text(json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temp, path)


def _telegram_selected_mode_id(chat_id: Any, platform: str = "telegram") -> str:
    default = _telegram_default_mode_id()
    state = _telegram_read_mode_state()
    entry = (state.get("chats") or {}).get(_telegram_mode_state_key(chat_id, platform), {})
    selected = str(entry.get("selectedMode") or "").strip()
    return selected if selected and _telegram_mode_by_id(selected) else default


def _telegram_set_selected_mode(chat_id: Any, mode_id: str, platform: str = "telegram") -> dict[str, Any] | None:
    mode = _telegram_mode_by_id(mode_id)
    if not mode:
        return None
    state = _telegram_read_mode_state()
    chats = state.setdefault("chats", {})
    chats[_telegram_mode_state_key(chat_id, platform)] = {
        "selectedMode": str(mode.get("id")),
        "selectedParticipants": [],
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
    _telegram_write_mode_state(state)
    return mode
```

Ensure `Path`, `datetime`, and `timezone` are already imported; if not, import them at the top.

- [ ] **Step 4: Run the test again**

Run:

```bash
python3 -m unittest tests.test_paperclip_cockpit_telegram_callbacks.PaperclipCockpitTelegramCallbackTests.test_mode_selector_state_is_per_chat_and_project_neutral -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hermes-plugins/paperclip-cockpit/__init__.py tests/test_paperclip_cockpit_telegram_callbacks.py
git commit -m "Add Telegram mode selector state"
```

---

### Task 2: Mode Buttons In Telegram Menus

**Files:**
- Modify: `hermes-plugins/paperclip-cockpit/__init__.py`
- Test: `tests/test_paperclip_cockpit_rewrites.py`

- [ ] **Step 1: Write failing tests for mode buttons on `/agora`**

Add a dispatch test that patches `_telegram_api` and sends `/agora` with a fake Telegram source:

```python
    def test_command_boundary_home_menu_includes_configured_mode_buttons(self):
        calls = []

        def fake_api(method, payload, *, timeout=20):
            calls.append((method, payload))
            return {"ok": True}

        class Source:
            chat_id = "chat-mode"
            platform = type("Platform", (), {"value": "telegram"})()

        class Event:
            text = "/agora"
            source = Source()

        with mock.patch.object(self.plugin, "_telegram_api", fake_api):
            with EnvPatch(
                PAPERCLIP_COCKPIT_CONFIG=str(AGORA_CONFIG),
                PAPERCLIP_COCKPIT_NL_REWRITE="1",
                PAPERCLIP_COCKPIT_NL_WRITES="0",
                PAPERCLIP_COCKPIT_ALLOWED_PLATFORMS=None,
                PAPERCLIP_COCKPIT_ALLOWED_CHATS=None,
            ):
                result = self.plugin._pre_gateway_dispatch(Event())

        self.assertEqual(result, {"action": "skip"})
        payload = calls[-1][1]
        self.assertIn("reply_markup", payload)
        buttons = payload["reply_markup"]["inline_keyboard"]
        flat = [button["text"] for row in buttons for button in row]
        self.assertIn("Быстро", flat)
        self.assertIn("Codex", flat)
        self.assertIn("Все голоса", flat)
        self.assertIn("Текущий режим", payload["text"])
```

Expected failure: mode buttons and current mode are absent.

- [ ] **Step 2: Run the failing test**

Run:

```bash
python3 -m unittest tests.test_paperclip_cockpit_rewrites.PaperclipCockpitRewriteTests.test_command_boundary_home_menu_includes_configured_mode_buttons -v
```

Expected: FAIL.

- [ ] **Step 3: Implement mode button rendering**

Add helpers:

```python
def _telegram_mode_label(mode: dict[str, Any] | None) -> str:
    if not mode:
        return ""
    return str(mode.get("label") or mode.get("id") or "").strip()


def _telegram_mode_keyboard_rows(chat_id: Any = None) -> list[list[dict[str, str]]]:
    selector = _telegram_mode_selector_config()
    if not selector:
        return []
    selected = _telegram_selected_mode_id(chat_id)
    rows: list[list[dict[str, str]]] = []
    current: list[dict[str, str]] = []
    for mode in _telegram_mode_selector_modes():
        mode_id = str(mode.get("id") or "").strip()
        label = _telegram_mode_label(mode)
        if not mode_id or not label:
            continue
        prefix = "✓ " if mode_id == selected else ""
        current.append({"text": f"{prefix}{label}"[:32], "callback_data": _telegram_callback_data("set_mode", mode_id)})
        if len(current) == 2:
            rows.append(current)
            current = []
    if current:
        rows.append(current)
    if selected:
        rows.append([{"text": "Сменить режим", "callback_data": _telegram_callback_data("show_modes", "menu")}])
    return rows


def _telegram_mode_status_line(chat_id: Any = None) -> str:
    mode = _telegram_mode_by_id(_telegram_selected_mode_id(chat_id))
    label = _telegram_mode_label(mode)
    description = str((mode or {}).get("description") or "").strip()
    if not label:
        return ""
    return f"Текущий режим: {label}" + (f" — {description}" if description else "")
```

Change `_telegram_menu_keyboard(menu)` to accept `chat_id=None, menu_name=""`, append `_telegram_mode_keyboard_rows(chat_id)` when `menu_name` is listed in `telegram.mode_selector.menus`, and update `_maybe_handle_telegram_command_boundary()` to pass menu name/chat id. Prepend or append `_telegram_mode_status_line(chat_id)` to menu text when `show_current_mode` is true.

- [ ] **Step 4: Run the test again**

Run:

```bash
python3 -m unittest tests.test_paperclip_cockpit_rewrites.PaperclipCockpitRewriteTests.test_command_boundary_home_menu_includes_configured_mode_buttons -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hermes-plugins/paperclip-cockpit/__init__.py tests/test_paperclip_cockpit_rewrites.py
git commit -m "Render Telegram mode buttons"
```

---

### Task 3: Mode Callback Handling

**Files:**
- Modify: `hermes-plugins/paperclip-cockpit/__init__.py`
- Test: `tests/test_paperclip_cockpit_telegram_callbacks.py`

- [ ] **Step 1: Write failing callback tests**

Add:

```python
    def test_set_mode_callback_stores_mode_and_sends_confirmation_without_action(self):
        state_path = Path(tempfile.gettempdir()) / "pc-mode-callback-test.json"
        if state_path.exists():
            state_path.unlink()
        config = {
            "telegram": {
                "enabled": True,
                "callback_prefix": "pc",
                "mode_selector": {
                    "enabled": True,
                    "state_path": str(state_path),
                    "default": "quick_local",
                    "modes": [
                        {"id": "quick_local", "label": "Быстро", "description": "локально", "action": "quick"},
                        {"id": "codex_deep", "label": "Codex", "description": "сильный разбор", "action": "ask", "args": ["--max"]},
                    ],
                },
            },
            "actions": {"ask": {"exec": ["echo", "ask"]}, "quick": {"exec": ["echo", "quick"]}},
        }
        calls = []
        runs = []

        def fake_api(method, payload, *, timeout=20):
            calls.append((method, payload))
            return {"ok": True}

        def fake_run_action(*args, **kwargs):
            runs.append((args, kwargs))
            return "should not run"

        def assertions():
            with MonkeyPatch(self.plugin, _telegram_api=fake_api, _run_action=fake_run_action):
                result = self.plugin._telegram_callback_query(
                    adapter=FakeAdapter(),
                    query=FakeQuery(),
                    data="pc:set_mode:codex_deep",
                    chat_id="chat-mode",
                    user_id="user-1",
                )
            self.assertEqual(result, {"action": "handled"})
            self.assertEqual(runs, [])
            self.assertEqual(self.plugin._telegram_selected_mode_id("chat-mode"), "codex_deep")
            self.assertIn("Режим выбран: Codex", calls[-1][1]["text"])
            state_path.unlink()

        self.with_config(config, assertions)
```

Expected failure: callback is unknown or tries configured action lookup.

- [ ] **Step 2: Run the failing test**

Run:

```bash
python3 -m unittest tests.test_paperclip_cockpit_telegram_callbacks.PaperclipCockpitTelegramCallbackTests.test_set_mode_callback_stores_mode_and_sends_confirmation_without_action -v
```

Expected: FAIL.

- [ ] **Step 3: Implement built-in callbacks**

In `_telegram_callback_query()`, after authorization and before `_telegram_callback_actions()` lookup, handle:

```python
    if callback_name == "set_mode":
        mode = _telegram_set_selected_mode(chat_id, callback_arg)
        if not mode:
            _telegram_answer_callback(callback_id, "Неизвестный режим.")
            _telegram_send_message(str(chat_id or ""), "Неизвестный режим. Выбери режим из меню.", _telegram_mode_keyboard())
            return {"action": "handled"}
        label = _telegram_mode_label(mode)
        _telegram_answer_callback(callback_id, label)
        _telegram_send_message(
            str(chat_id or ""),
            f"Режим выбран: {label}.\nТеперь напиши вопрос обычным языком.",
            {"inline_keyboard": _telegram_mode_keyboard_rows(chat_id)},
        )
        return {"action": "handled"}

    if callback_name == "show_modes":
        _telegram_answer_callback(callback_id, "Режимы")
        _telegram_send_message(
            str(chat_id or ""),
            "Выбери режим для следующих вопросов.\n\n" + _telegram_mode_status_line(chat_id),
            {"inline_keyboard": _telegram_mode_keyboard_rows(chat_id)},
        )
        return {"action": "handled"}

    if callback_name == "reset_mode":
        mode = _telegram_set_selected_mode(chat_id, _telegram_default_mode_id())
        _telegram_answer_callback(callback_id, "Сброшено")
        _telegram_send_message(str(chat_id or ""), f"Режим сброшен: {_telegram_mode_label(mode)}.")
        return {"action": "handled"}
```

Factor `_telegram_mode_keyboard()` if needed:

```python
def _telegram_mode_keyboard(chat_id: Any = None) -> dict[str, Any] | None:
    rows = _telegram_mode_keyboard_rows(chat_id)
    return {"inline_keyboard": rows} if rows else None
```

- [ ] **Step 4: Run callback tests**

Run:

```bash
python3 -m unittest tests.test_paperclip_cockpit_telegram_callbacks -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hermes-plugins/paperclip-cockpit/__init__.py tests/test_paperclip_cockpit_telegram_callbacks.py
git commit -m "Handle Telegram mode callbacks"
```

---

### Task 4: Apply Selected Mode To Natural Questions

**Files:**
- Modify: `hermes-plugins/paperclip-cockpit/__init__.py`
- Test: `tests/test_paperclip_cockpit_rewrites.py`

- [ ] **Step 1: Write failing tests for natural question execution with selected mode**

Add a test that proves mode env/args are applied and the hook returns `skip`:

```python
    def test_selected_mode_executes_natural_question_with_mode_action(self):
        config = {
            "command": {"name": "agora"},
            "telegram": {
                "enabled": True,
                "callback_prefix": "pc",
                "mode_selector": {
                    "enabled": True,
                    "state_path": str(Path(tempfile.gettempdir()) / "pc-mode-natural-test.json"),
                    "default": "quick_local",
                    "modes": [
                        {"id": "quick_local", "label": "Быстро", "action": "quick", "args": [], "env": {"INNER_AGORA_FORCE_LOCAL_ADAPTER": "1"}},
                        {"id": "codex_deep", "label": "Codex", "action": "ask", "args": ["--max"], "env": {"INNER_AGORA_FORCE_LOCAL_ADAPTER": "0"}},
                    ],
                },
            },
            "intents": {
                "create": {
                    "action": "ask",
                    "aliases": ["давай спросим агору"],
                    "match": "contains",
                    "preserve_full_text": True,
                    "require_tail": True,
                    "min_tail_chars": 5,
                }
            },
            "actions": {
                "ask": {"exec": ["echo", "ask"]},
                "quick": {"exec": ["echo", "quick"], "env": {"INNER_AGORA_MODE": "local"}},
            },
        }
        sends = []
        runs = []

        class Source:
            chat_id = "chat-natural"
            platform = type("Platform", (), {"value": "telegram"})()

        class Event:
            text = "давай спросим агору про свободу"
            source = Source()

        def fake_send(chat_id, text, reply_markup=None):
            sends.append((chat_id, text, reply_markup))

        def fake_run_action(name, action, raw_args, **kwargs):
            runs.append((name, action, raw_args, kwargs))
            return f"ran {name}: {raw_args}; force={action.get('env', {}).get('INNER_AGORA_FORCE_LOCAL_ADAPTER')}"

        with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8") as handle:
            json.dump(config, handle)
            handle.flush()
            with EnvPatch(PAPERCLIP_COCKPIT_CONFIG=handle.name, PAPERCLIP_COCKPIT_NL_REWRITE="1"):
                with mock.patch.object(self.plugin, "_telegram_send_message", fake_send):
                    with mock.patch.object(self.plugin, "_run_action", fake_run_action):
                        self.plugin._telegram_set_selected_mode("chat-natural", "codex_deep")
                        result = self.plugin._pre_gateway_dispatch(Event())

        self.assertEqual(result, {"action": "skip"})
        self.assertEqual(runs[0][0], "ask")
        self.assertEqual(runs[0][2], "--max давай спросим агору про свободу")
        self.assertEqual(runs[0][1]["env"]["INNER_AGORA_FORCE_LOCAL_ADAPTER"], "0")
        self.assertIn("ran ask", sends[0][1])
```

Expected failure: the hook returns a rewrite instead of executing with selected mode.

- [ ] **Step 2: Run the failing test**

Run:

```bash
python3 -m unittest tests.test_paperclip_cockpit_rewrites.PaperclipCockpitRewriteTests.test_selected_mode_executes_natural_question_with_mode_action -v
```

Expected: FAIL.

- [ ] **Step 3: Implement selected-mode direct execution**

Add helpers:

```python
def _command_action_name_from_rewrite(rewritten: str) -> tuple[str, str]:
    slash = _slash()
    text = str(rewritten or "").strip()
    if not text.startswith(slash):
        return "", ""
    tail = text[len(slash):].strip()
    words = _parse_words(tail)
    if not words:
        return "", ""
    return words[0].casefold(), " ".join(words[1:]).strip()


def _merge_mode_action(action: dict[str, Any], mode: dict[str, Any]) -> dict[str, Any]:
    merged = dict(action)
    env = dict(action.get("env") or {})
    env.update({str(k): str(v) for k, v in (mode.get("env") or {}).items()})
    if env:
        merged["env"] = env
    return merged


def _mode_raw_args(mode: dict[str, Any], raw_args: str) -> str:
    args = [str(item).strip() for item in _listify(mode.get("args")) if str(item).strip()]
    if raw_args:
        args.append(raw_args)
    return " ".join(args).strip()


def _maybe_execute_selected_mode_rewrite(original_text: str, rewritten: str, chat_id: Any) -> dict[str, str] | None:
    if not _telegram_mode_selector_config() or not chat_id:
        return None
    if str(original_text or "").strip().startswith("/"):
        return None
    head, raw_args = _command_action_name_from_rewrite(rewritten)
    if not head:
        return None
    actions = _actions()
    if head not in actions:
        return None
    selector = _telegram_mode_selector_config()
    apply_to = {str(item).casefold() for item in _listify(selector.get("apply_to_actions") or ["ask"])}
    if head not in apply_to:
        return None
    mode = _telegram_mode_by_id(_telegram_selected_mode_id(chat_id))
    if not mode:
        return None
    action_name = str(mode.get("action") or head).strip()
    action = actions.get(action_name)
    if not action:
        _telegram_send_message(str(chat_id or ""), f"Режим настроен неверно: action `{action_name}` не найден.")
        return {"action": "skip"}
    output = _run_action(action_name, _merge_mode_action(action, mode), _mode_raw_args(mode, raw_args), chat_id=chat_id)
    try:
        message_text, reply_markup = _telegram_payload_from_output(output)
        _telegram_send_message(str(chat_id or ""), message_text, reply_markup)
    except Exception:
        _telegram_send_message(str(chat_id or ""), output)
    return {"action": "skip"}
```

In `_pre_gateway_dispatch()`, after `rewritten = _rewrite_text(...)` and before returning `{"action": "rewrite"}`, call:

```python
    if isinstance(rewritten, str):
        selected_mode_result = _maybe_execute_selected_mode_rewrite(getattr(event, "text", "") or "", rewritten, chat_id)
        if selected_mode_result:
            return selected_mode_result
```

- [ ] **Step 4: Run rewrite tests**

Run:

```bash
python3 -m unittest tests.test_paperclip_cockpit_rewrites -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hermes-plugins/paperclip-cockpit/__init__.py tests/test_paperclip_cockpit_rewrites.py
git commit -m "Apply selected Telegram mode to natural questions"
```

---

### Task 5: Inner Agora Mode Config

**Files:**
- Modify: `paperclip-cockpit.json`
- Modify: `cockpit.core.json`
- Test: `tests/test_paperclip_cockpit_rewrites.py`

- [ ] **Step 1: Write failing config tests**

Add a test near `test_real_quick_and_deep_actions_force_local_adapter`:

```python
    def test_real_mode_selector_defines_route_modes(self):
        config = json.loads(AGORA_CONFIG.read_text(encoding="utf-8"))
        selector = config["telegram"]["mode_selector"]
        self.assertTrue(selector["enabled"])
        by_id = {item["id"]: item for item in selector["modes"]}
        self.assertEqual(by_id["quick_local"]["action"], "quick")
        self.assertEqual(by_id["deep_local"]["action"], "deep")
        self.assertEqual(by_id["codex_deep"]["action"], "ask")
        self.assertEqual(by_id["codex_deep"]["args"], ["--max"])
        self.assertEqual(by_id["codex_deep"]["env"]["INNER_AGORA_FORCE_LOCAL_ADAPTER"], "0")
        self.assertEqual(by_id["all_voices"]["action"], "all")
        self.assertEqual(by_id["custom_voices"]["flow"], "participant_select")
```

Expected failure: `telegram.mode_selector` missing.

- [ ] **Step 2: Add mode selector config to both JSON files**

Add under `telegram` in `paperclip-cockpit.json` and `cockpit.core.json`:

```json
"mode_selector": {
  "enabled": true,
  "state_key": "agora_mode",
  "default": "quick_local",
  "show_current_mode": true,
  "menus": ["home", "agents"],
  "apply_to_actions": ["ask"],
  "modes": [
    {
      "id": "quick_local",
      "label": "Быстро",
      "description": "3-5 голосов, локальная модель",
      "action": "quick"
    },
    {
      "id": "deep_local",
      "label": "Глубоко",
      "description": "широкий совет, локальная модель",
      "action": "deep"
    },
    {
      "id": "codex_deep",
      "label": "Codex",
      "description": "широкий совет через codex_local",
      "action": "ask",
      "args": ["--max"],
      "env": {
        "INNER_AGORA_MODE": "max",
        "INNER_AGORA_FORCE_LOCAL_ADAPTER": "0"
      }
    },
    {
      "id": "all_voices",
      "label": "Все голоса",
      "description": "весь текущий roster",
      "action": "all"
    },
    {
      "id": "custom_voices",
      "label": "Выбрать философов",
      "description": "ручной список голосов",
      "flow": "participant_select"
    }
  ]
}
```

Do not add philosopher names to plugin code.

- [ ] **Step 3: Run config tests**

Run:

```bash
python3 -m unittest tests.test_paperclip_cockpit_rewrites.PaperclipCockpitRewriteTests.test_real_mode_selector_defines_route_modes -v
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add paperclip-cockpit.json cockpit.core.json tests/test_paperclip_cockpit_rewrites.py
git commit -m "Configure Inner Agora Telegram modes"
```

---

### Task 6: Participant Alias And Count Parsing

**Files:**
- Modify: `scripts/agora.mjs`
- Test: `tests/test_inner_agora_ask_flow.py`

- [ ] **Step 1: Write failing participant tests**

Add tests using dry-run subprocesses:

```python
    def run_dry_ask(self, *args):
        result = subprocess.run(
            ["node", str(AGORA_SCRIPT), "ask", "--dry-run", *args],
            cwd=ROOT,
            env={**os.environ, "INNER_AGORA_MODE": "balanced"},
            text=True,
            capture_output=True,
            check=True,
        )
        return result.stdout

    def test_short_philosopher_alias_resolves_sartre(self):
        stdout = self.run_dry_ask("--philosophers", "Платон,Сартр", "тест свободы")
        self.assertIn("voices=Платон, Жан-Поль Сартр", stdout)

    def test_pair_phrase_limits_voice_count_to_two(self):
        stdout = self.run_dry_ask("хочу пару философов про свободу")
        voices_line = next(line for line in stdout.splitlines() if line.startswith("voices="))
        voices = voices_line.removeprefix("voices=").split(", ")
        self.assertEqual(len(voices), 2)

    def test_cyrillic_numeric_voice_count_limits_to_two(self):
        stdout = self.run_dry_ask("хочу 2 философа про свободу")
        voices_line = next(line for line in stdout.splitlines() if line.startswith("voices="))
        voices = voices_line.removeprefix("voices=").split(", ")
        self.assertEqual(len(voices), 2)
```

Expected failures: `Сартр` resolves poorly or only one philosopher; pair/count phrases do not limit to 2.

- [ ] **Step 2: Run the failing tests**

Run:

```bash
python3 -m unittest tests.test_inner_agora_ask_flow.InnerAgoraAskFlowTests.test_short_philosopher_alias_resolves_sartre tests.test_inner_agora_ask_flow.InnerAgoraAskFlowTests.test_pair_phrase_limits_voice_count_to_two tests.test_inner_agora_ask_flow.InnerAgoraAskFlowTests.test_cyrillic_numeric_voice_count_limits_to_two -v
```

Expected: FAIL.

- [ ] **Step 3: Fix `roleByToken()` partial matching**

In `scripts/agora.mjs`, enhance `roleByToken(token)` after exact lookup:

```js
  const normalized = looseText(token);
  if (normalized.length >= 3) {
    const partial = roles.filter((item) => {
      const candidates = [
        item.key,
        item.name,
        item.englishName,
        ...(item.aliases || []),
      ].map(looseText).filter(Boolean);
      return candidates.some((candidate) => candidate === normalized || candidate.endsWith(` ${normalized}`) || candidate.includes(normalized));
    });
    if (partial.length === 1) return partial[0];
  }
```

If multiple roles match a short token, return `null` so the user is asked to be more specific.

- [ ] **Step 4: Fix `requestedVoiceLimit()`**

Replace the regex-boundary logic with Unicode-safe parsing:

```js
function requestedVoiceLimit(request) {
  const text = looseText(request);
  const countContext = /философ|голос|участ|подход|сильн|выбор|voices|thinkers|participants/.test(text);
  if (!countContext) return null;
  if (/(^| )(пар[ауеы]?|двое|двух|два|two|couple)( |$)/.test(text)) return 2;

  const range = text.match(/(?:^| )([2-9]|1[0-9]) *[-–—] *([2-9]|1[0-9])(?: |$)/);
  if (range) return Math.max(Number(range[1]), Number(range[2]));

  const single = text.match(/(?:^| )([2-9]|1[0-9]) *(?:философ|голос|участ|подход|сильн|voices|thinkers|participants)/);
  return single ? Number(single[1]) : null;
}
```

- [ ] **Step 5: Run participant tests**

Run:

```bash
python3 -m unittest tests.test_inner_agora_ask_flow.InnerAgoraAskFlowTests.test_short_philosopher_alias_resolves_sartre tests.test_inner_agora_ask_flow.InnerAgoraAskFlowTests.test_pair_phrase_limits_voice_count_to_two tests.test_inner_agora_ask_flow.InnerAgoraAskFlowTests.test_cyrillic_numeric_voice_count_limits_to_two -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/agora.mjs tests/test_inner_agora_ask_flow.py
git commit -m "Fix Agora participant selection text"
```

---

### Task 7: QA Suites And Docs

**Files:**
- Modify: `telegram-testing.config.json`
- Modify: `docs/telegram-testing/TELEGRAM_ACCEPTANCE_CHECKLIST.md`
- Modify: `docs/roadmap/BUGS.md`

- [ ] **Step 1: Add QA suite definitions**

Add suites:

```json
"mode-buttons": {
  "tests": [
    {
      "id": "mode.menu",
      "message": "/agora",
      "expect": {
        "paperclipRootsCreated": 0,
        "buttonsPresent": true,
        "replyContains": ["Текущий режим", "обычным языком"],
        "replyNotContains": ["Active Agents & Tasks", "Project action exited"],
        "noRawTokens": true
      }
    }
  ]
},
"mode-applied": {
  "tests": [
    {
      "id": "mode.quick-local",
      "message": "быстрый совет: тест режима [qa:<runId>]",
      "expect": {
        "paperclipRootsCreatedAtLeast": 1,
        "replyContains": ["Маршрут:", "hermes_local"],
        "buttonsPresent": true,
        "noRawTokens": true
      }
    }
  ]
}
```

The first live retest can keep `mode-applied` narrow; expanding to click every mode happens after runner supports callback-click steps.

- [ ] **Step 2: Update acceptance checklist**

Add a `Mode Buttons` suite section:

```markdown
### Mode Buttons

Purpose: choosing a Telegram mode must affect the next created Agora session.

Expected:

- `/agora` shows current mode and mode buttons.
- selecting a mode creates no Paperclip issue.
- the next natural question uses the selected mode route and participant policy.
- mode stays active until changed or reset.
```

- [ ] **Step 3: Update BUGS.md**

Add or update known bugs:

```markdown
## Telegram mode routing

- Status: planned
- Evidence: live QA found missing buttons and natural routing selected too many voices for "пару философов".
- Acceptance: mode button selection changes the next question route; "пару философов" and "2 философа" select two voices.
```

- [ ] **Step 4: Commit docs/config**

```bash
git add telegram-testing.config.json docs/telegram-testing/TELEGRAM_ACCEPTANCE_CHECKLIST.md docs/roadmap/BUGS.md
git commit -m "Document Telegram mode QA"
```

---

### Task 8: Full Local Verification

**Files:**
- No code edits unless verification exposes a regression.

- [ ] **Step 1: Run targeted unit tests**

Run:

```bash
python3 -m unittest tests.test_paperclip_cockpit_telegram_callbacks -v
python3 -m unittest tests.test_paperclip_cockpit_rewrites -v
python3 -m unittest tests.test_inner_agora_ask_flow -v
```

Expected: all PASS.

- [ ] **Step 2: Run full Python suite**

Run:

```bash
python3 -m unittest discover -s tests -p 'test*.py' -v
```

Expected: all PASS.

- [ ] **Step 3: Run regression harness**

Run:

```bash
node scripts/regression.mjs check
CHAMBER_MODE=chambers node scripts/regression.mjs check
```

Expected: both PASS.

- [ ] **Step 4: Run non-live QA checks**

Run with env loaded:

```bash
set -a; source .env; set +a
node paperclip-qa-tool/bin/paperclip-qa.mjs config-check --config telegram-testing.config.json --json
node paperclip-qa-tool/bin/paperclip-qa.mjs readiness --config telegram-testing.config.json --suite mode-buttons --cleanup hard --json
```

Expected: `ok: true`, `readyForLive: true`; no live Telegram or Paperclip mutations.

- [ ] **Step 5: Commit any verification-only fixture updates**

Only if regression fixtures intentionally changed:

```bash
git add tests/fixtures/baseline
git commit -m "Update routing button fixtures"
```

---

### Task 9: Live Retest Checkpoint

**Files:**
- No code edits.

- [ ] **Step 1: Sync live Hermes profile**

Run the project profile sync command:

```bash
node scripts/setup-hermes-profile.mjs
```

Then verify the installed profile sees the current plugin/config:

```bash
node scripts/inner-agora-guard.mjs --json
```

- [ ] **Step 2: Restart gateway**

Restart the active `inneragora` Hermes gateway so the live Telegram bot loads the updated plugin/config:

```bash
inneragora gateway restart
inneragora gateway status
```

If `gateway restart` is unavailable in the installed wrapper, use the guard repair path and record it in the final report:

```bash
node scripts/inner-agora-guard.mjs --fix --json
```

- [ ] **Step 3: Run live targeted suite**

Only after explicit live approval:

```bash
set -a; source .env; set +a
node paperclip-qa-tool/bin/paperclip-qa.mjs run --config telegram-testing.config.json --suite mode-buttons --cleanup hard --notify telegram --live-ok --json
```

Expected: PASS, cleanup residuals 0, retained Telegram summary sent.

- [ ] **Step 4: Run one mode-applied live check**

Only if `mode-buttons` passes:

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs run --config telegram-testing.config.json --suite mode-applied --cleanup hard --notify telegram --live-ok --json
```

Expected: PASS, created root shows selected route, cleanup residuals 0.

---

## Self-Review

- Spec coverage: plugin state/buttons/callbacks/mode application are covered by Tasks 1-4; Inner Agora config by Task 5; participant bugs by Task 6; QA/docs by Task 7; verification/live by Tasks 8-9.
- No placeholders: all tasks include exact files, test names, commands, and expected outcomes.
- Type consistency: mode ids are `quick_local`, `deep_local`, `codex_deep`, `all_voices`, `custom_voices`; callback names are `set_mode`, `show_modes`, `reset_mode`.
- Scope: v1 implements persistent session-level routing. Per-agent mixed adapters are explicitly out of scope.
- Live side effects: only Task 9 uses live Telegram/Paperclip, and only after local checks and explicit approval.
