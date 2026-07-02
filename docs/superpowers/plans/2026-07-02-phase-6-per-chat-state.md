# Phase 6 Per-Chat State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement per-chat Agora state and profile memory so two Telegram chats using one Hermes profile do not share session context, mode, chamber, wizard state, or follow-up anchors.

**Architecture:** Add `scripts/state-manager.mjs` as the single owner of state/profile paths, schema migration, and JSON writes. Wire `scripts/agora.mjs` to call that module instead of direct `fs.readFileSync(STATE_PATH)`, then pass `INNER_AGORA_CHAT_ID` from the Hermes Paperclip cockpit plugin to all project action subprocesses and natural-language delegate subprocesses.

**Tech Stack:** Node.js ESM scripts, Python `unittest`, JSON Schema draft 2020-12, existing Hermes plugin Python module tests.

---

## File Map

- Create `data/schema/state.schema.json`: versioned state schema with permissive unknown keys.
- Create `scripts/state-manager.mjs`: state/profile path resolution, chat-id sanitization, migration, read/write helpers, CLI diagnostics.
- Create `scripts/migrate-state.mjs`: explicit migration CLI wrapper around `state-manager.mjs`.
- Create `tests/test_phase6_state_manager.py`: state schema, path resolution, migration, profile preference tests.
- Modify `scripts/agora.mjs`: replace local `STATE_PATH`, `readState`, `writeState` with state-manager helpers; update profile on mode/chamber/ask; show resolved state path.
- Modify `scripts/import-inner-agora.mjs`: read active chamber from state-manager so prepare/import follow the same state mode.
- Modify `hermes-plugins/paperclip-cockpit/__init__.py`: pass chat context to project action and natural delegate subprocess environments.
- Modify `tests/test_paperclip_cockpit_telegram_callbacks.py`: assert callback action env contains `INNER_AGORA_CHAT_ID`.
- Modify `tests/test_inner_agora_conversation_cycle.py`: assert natural rewrite receives chat id and per-chat state isolation works.
- Modify `tests/fixtures/baseline/mode-get.json`: update state path only if output changes.
- Modify roadmap docs after verification.

---

### Task 1: State Schema and Manager

**Files:**
- Create: `data/schema/state.schema.json`
- Create: `scripts/state-manager.mjs`
- Create: `scripts/migrate-state.mjs`
- Create: `tests/test_phase6_state_manager.py`

- [ ] **Step 1: Write failing schema/path tests**

Add `tests/test_phase6_state_manager.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
python3 -m unittest tests.test_phase6_state_manager
```

Expected: FAIL because `state.schema.json`, `state-manager.mjs`, and `migrate-state.mjs` do not exist.

- [ ] **Step 3: Add schema**

Create `data/schema/state.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://inner-agora.local/schema/state.schema.json",
  "title": "Inner Agora state",
  "type": "object",
  "required": ["schemaVersion"],
  "additionalProperties": true,
  "properties": {
    "schemaVersion": { "const": 1 },
    "chatId": { "type": "string", "minLength": 1 },
    "updatedAt": { "type": "string" },
    "activeChamberId": { "type": "string" },
    "mode": { "enum": ["min", "local", "balanced", "max", "all"] },
    "lastIssueRef": { "type": "string" },
    "lastIssueId": { "type": "string" },
    "lastIssueTitle": { "type": "string" },
    "lastIssueStatus": { "type": "string" },
    "lastIssueSeenAt": { "type": "string" },
    "lastRootIssueRef": { "type": "string" },
    "lastRootIssueId": { "type": "string" },
    "lastSynthesisRef": { "type": "string" },
    "lastSynthesisId": { "type": "string" },
    "lastSynthesisSeenAt": { "type": "string" },
    "lastAdapterName": { "type": "string" },
    "lastAdapterModel": { "type": "string" },
    "lastAdapterReason": { "type": "string" },
    "lastAdapterRiskTier": { "type": "string" },
    "wizard": {}
  }
}
```

- [ ] **Step 4: Add `scripts/state-manager.mjs`**

Implement these exported functions:

```js
export const CURRENT_STATE_SCHEMA_VERSION = 1;
export function sanitizeChatId(value = "") {}
export function stateContext(options = {}) {}
export function statePath(options = {}) {}
export function readState(options = {}) {}
export function writeState(patch, options = {}) {}
export function profilePath(options = {}) {}
export function readProfile(options = {}) {}
export function writeProfile(patch, options = {}) {}
export function migrateState(raw, chatId) {}
export function migrateLegacyState(options = {}) {}
```

Rules:

- derive `ROOT` from script directory unless `INNER_AGORA_ROOT` is set;
- explicit `INNER_AGORA_STATE_PATH` returns legacy/single-file path and disables per-chat target selection;
- per-chat target is used when `STATE_MODE=per-chat` or `INNER_AGORA_CHAT_ID` is present;
- legacy source is `INNER_AGORA_LEGACY_STATE_PATH || path.join(root, ".inner-agora-state.json")`;
- `writeState()` creates parent directories and writes stable pretty JSON;
- `readState()` calls migration before returning;
- profile path uses `INNER_AGORA_PROFILE_DIR || path.join(root, "memory", "profiles")`.

The CLI commands must work:

```bash
node scripts/state-manager.mjs path --json
node scripts/state-manager.mjs read --json
node scripts/state-manager.mjs profile --json
```

- [ ] **Step 5: Add `scripts/migrate-state.mjs`**

Implement CLI:

```bash
node scripts/migrate-state.mjs [--chat CHAT] [--json]
```

It should set the target chat for the call, run `migrateLegacyState`, and print `{chatId,statePath,migrated}` as JSON when `--json` is passed.

- [ ] **Step 6: Run tests and syntax checks**

Run:

```bash
python3 -m unittest tests.test_phase6_state_manager
node --check scripts/state-manager.mjs
node --check scripts/migrate-state.mjs
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add data/schema/state.schema.json scripts/state-manager.mjs scripts/migrate-state.mjs tests/test_phase6_state_manager.py
git commit -m "Add per-chat state manager"
```

---

### Task 2: Wire Agora CLI to State Manager and Profiles

**Files:**
- Modify: `scripts/agora.mjs`
- Modify: `scripts/import-inner-agora.mjs`
- Modify: `tests/test_inner_agora_mode.py`
- Modify: `tests/test_inner_agora_ask_flow.py`
- Modify: `tests/test_phase6_state_manager.py`
- Modify: `tests/fixtures/baseline/mode-get.json`

- [ ] **Step 1: Add failing CLI isolation/profile tests**

Extend `tests/test_phase6_state_manager.py`:

```python
    def test_agora_mode_set_isolated_by_chat_id(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            state_dir = Path(temp_dir) / "state"
            config_path = Path(temp_dir) / "paperclip-cockpit.json"
            config_path.write_text(json.dumps({"agora": {"default_mode": "balanced"}}), encoding="utf-8")
            base_env = {
                "STATE_MODE": "per-chat",
                "INNER_AGORA_STATE_DIR": str(state_dir),
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
                    "PAPERCLIP_COCKPIT_CONFIG": str(config_path),
                },
            )
            self.assertEqual(result.stdout.strip(), "local")
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
python3 -m unittest tests.test_phase6_state_manager.Phase6StateManagerTests.test_agora_mode_set_isolated_by_chat_id tests.test_phase6_state_manager.Phase6StateManagerTests.test_profile_preferred_mode_is_used_when_state_has_no_mode
```

Expected: FAIL because `agora.mjs` still uses local single-file state helpers.

- [ ] **Step 3: Replace local state helpers in `scripts/agora.mjs`**

Import:

```js
import {
  readState,
  writeState,
  statePath as resolvedStatePath,
  readProfile,
  writeProfile,
} from "./state-manager.mjs";
```

Remove `STATE_PATH`, local `readState()`, and local `writeState()`.

Update `printMode()`:

```js
console.log(`state=${resolvedStatePath()}`);
```

Update `defaultMode()`:

```js
function defaultMode() {
  const state = readState();
  const profile = readProfile();
  return normalizeMode(process.env.INNER_AGORA_MODE || state.mode || profile.preferredMode || DEFAULT_MODE);
}
```

Update `activeChamberId()`:

```js
function activeChamberId(state = readState()) {
  const profile = readProfile();
  return String(process.env.INNER_AGORA_ACTIVE_CHAMBER || state.activeChamberId || profile.preferredChamberId || DEFAULT_CHAMBER_ID).trim();
}
```

Add helpers:

```js
function rememberModePreference(mode) {
  writeProfile({ preferredMode: mode });
}

function rememberChamberPreference(chamberId) {
  writeProfile({ preferredChamberId: chamberId });
}
```

Call `rememberModePreference(mode)` after `mode set` and after `ask` creates a session. Call `rememberChamberPreference(chamber.id)` after `chamber use` and after `ask`.

- [ ] **Step 4: Wire `scripts/import-inner-agora.mjs` to state manager**

Import `readState` from `./state-manager.mjs`, remove its local `STATE_PATH` and `readState()`, and keep `activeChamberId(state = readState())` behavior.

- [ ] **Step 5: Run focused tests and update baseline if needed**

Run:

```bash
python3 -m unittest tests.test_phase6_state_manager tests.test_inner_agora_mode tests.test_inner_agora_ask_flow
node scripts/regression.mjs check
```

If only `mode-get` baseline changes because `state=` path changes, record:

```bash
node scripts/regression.mjs record
node scripts/regression.mjs check
```

- [ ] **Step 6: Commit**

```bash
git add scripts/agora.mjs scripts/import-inner-agora.mjs tests/test_phase6_state_manager.py tests/test_inner_agora_mode.py tests/test_inner_agora_ask_flow.py tests/fixtures/baseline/mode-get.json
git commit -m "Use per-chat state in Agora CLI"
```

---

### Task 3: Pass Chat ID Through Hermes Plugin

**Files:**
- Modify: `hermes-plugins/paperclip-cockpit/__init__.py`
- Modify: `tests/test_paperclip_cockpit_telegram_callbacks.py`
- Modify: `tests/test_inner_agora_conversation_cycle.py`

- [ ] **Step 1: Add failing callback env test**

Extend `tests/test_paperclip_cockpit_telegram_callbacks.py`:

```python
    def test_callback_action_passes_chat_id_to_subprocess_env(self):
        config = {
            "telegram": {
                "enabled": True,
                "callback_prefix": "pc",
                "callbacks": {"latest": {"action": "latest", "args": "{arg}", "answer": "Opening"}},
            },
            "actions": {"latest": {"exec": ["node", "-e", "console.log(process.env.INNER_AGORA_CHAT_ID || '')"]}},
        }
        runs = []

        def fake_run(args, cwd=None, text=None, capture_output=None, timeout=None, check=None, env=None):
            runs.append(env)
            return type("Result", (), {"stdout": "chat-2\n", "stderr": "", "returncode": 0})()

        def fake_api(method, payload, *, timeout=20):
            return {"ok": True}

        def assertions():
            with MonkeyPatch(self.plugin, _telegram_api=fake_api), MonkeyPatch(subprocess, run=fake_run):
                self.plugin._telegram_callback_query(
                    adapter=FakeAdapter(),
                    query=FakeQuery(),
                    data="pc:latest:THE-900",
                    chat_id="chat-2",
                    user_id="user-2",
                )
            self.assertEqual(runs[0]["INNER_AGORA_CHAT_ID"], "chat-2")

        self.with_config(config, assertions)
```

Import `subprocess` at the top of the test file if not already imported.

- [ ] **Step 2: Add failing natural delegate env test**

Extend `tests/test_paperclip_cockpit_telegram_callbacks.py`. Add `import subprocess` at the top of the file, then add:

```python
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
python3 -m unittest tests.test_paperclip_cockpit_telegram_callbacks tests.test_inner_agora_conversation_cycle
```

Expected: FAIL because subprocess calls do not pass an env override.

- [ ] **Step 4: Add execution env helper**

In `hermes-plugins/paperclip-cockpit/__init__.py`, add:

```python
def _subprocess_env(chat_id: Any = None) -> dict[str, str]:
    env = dict(os.environ)
    chat = str(chat_id or "").strip()
    if chat:
        env["INNER_AGORA_CHAT_ID"] = chat
    return env
```

Change signatures:

```python
def _run_action(name: str, action: dict[str, Any], raw_args: str, *, chat_id: Any = None) -> str:
def _rewrite_delegate(raw: str, *, chat_id: Any = None) -> str | None:
def _rewrite_text(text: str, *, chat_id: Any = None) -> str | None:
```

Pass `env=_subprocess_env(chat_id)` into both `subprocess.run(...)` calls.

In `_telegram_callback_query`, call:

```python
output = _run_action(action_name, action, raw_args, chat_id=chat_id)
```

In `_pre_gateway_dispatch`, derive:

```python
source = getattr(event, "source", None)
chat_id = getattr(source, "chat_id", "") if source is not None else ""
rewritten = _rewrite_text(getattr(event, "text", "") or "", chat_id=chat_id)
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
python3 -m unittest tests.test_paperclip_cockpit_telegram_callbacks tests.test_inner_agora_conversation_cycle
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add hermes-plugins/paperclip-cockpit/__init__.py tests/test_paperclip_cockpit_telegram_callbacks.py tests/test_inner_agora_conversation_cycle.py
git commit -m "Pass chat id to Agora subprocesses"
```

---

### Task 4: End-to-End Per-Chat Conversation Isolation

**Files:**
- Modify: `tests/test_inner_agora_conversation_cycle.py`
- Modify: `scripts/agora.mjs` if test exposes missing state/profile propagation

- [ ] **Step 1: Add failing end-to-end isolation test**

Add to `tests/test_inner_agora_conversation_cycle.py`:

```python
    def test_two_telegram_chats_keep_separate_last_root_state(self):
        FullCycleHandler.reset()
        server = TestHTTPServer(("127.0.0.1", 0), FullCycleHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                config = json.loads(REAL_CONFIG.read_text(encoding="utf-8"))
                config["cwd"] = str(ROOT)
                config.setdefault("agora", {})["default_mode"] = "local"
                config_path = Path(temp_dir) / "paperclip-cockpit.json"
                state_dir = Path(temp_dir) / "state"
                config_path.write_text(json.dumps(config), encoding="utf-8")
                base_env = {
                    **os.environ,
                    "PAPERCLIP_API_BASE": f"http://127.0.0.1:{server.server_port}/api",
                    "PAPERCLIP_COCKPIT_CONFIG": str(config_path),
                    "INNER_AGORA_STATE_DIR": str(state_dir),
                    "STATE_MODE": "per-chat",
                    "INNER_AGORA_AUTO_RESTART_PAPERCLIP": "0",
                    "PAPERCLIP_COCKPIT_NL_REWRITE": "1",
                    "PAPERCLIP_COCKPIT_NL_WRITES": "0",
                }

                def rewrite_for(chat_id, text):
                    class Source:
                        platform = "telegram"
                        chat_id = chat_id

                    class Event:
                        source = Source()
                        text = text

                    with EnvPatch(**base_env, INNER_AGORA_CHAT_ID=chat_id):
                        return self.plugin._pre_gateway_dispatch(Event())

                first = rewrite_for("chat-a", "давай спросим агору про свободу ребенка")
                first_command = shlex.split(first["text"])
                self.run_node([AGORA_SCRIPT, "ask", *first_command[2:]], {**base_env, "INNER_AGORA_CHAT_ID": "chat-a"})

                second = rewrite_for("chat-b", "давай спросим агору про долг родителей")
                second_command = shlex.split(second["text"])
                self.run_node([AGORA_SCRIPT, "ask", *second_command[2:]], {**base_env, "INNER_AGORA_CHAT_ID": "chat-b"})

                chat_a_state = json.loads((state_dir / "chat-a.json").read_text(encoding="utf-8"))
                chat_b_state = json.loads((state_dir / "chat-b.json").read_text(encoding="utf-8"))
                self.assertNotEqual(chat_a_state["lastRootIssueRef"], chat_b_state["lastRootIssueRef"])
                self.assertEqual(chat_a_state["chatId"], "chat-a")
                self.assertEqual(chat_b_state["chatId"], "chat-b")
        finally:
            server.shutdown()
            server.server_close()
```

When adding this test, make the inner `Source` class assign `chat_id` after class creation if Python complains about closure scoping:

```python
class Source:
    platform = "telegram"
Source.chat_id = chat_id
```

- [ ] **Step 2: Run the new test to verify it fails if any wiring is incomplete**

Run:

```bash
python3 -m unittest tests.test_inner_agora_conversation_cycle
```

Expected before final wiring: FAIL if CLI state or plugin env propagation is incomplete.

- [ ] **Step 3: Fix only the missing wiring**

Expected implementation shape if this test still fails:

```js
// scripts/agora.mjs should not calculate state paths directly.
import { readState, writeState } from "./state-manager.mjs";
```

```python
# hermes plugin should use the shared env helper for every subprocess.
result = subprocess.run(args, cwd=cwd, text=True, capture_output=True, timeout=timeout, check=False, env=_subprocess_env(chat_id))
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
python3 -m unittest tests.test_inner_agora_conversation_cycle tests.test_phase6_state_manager
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add tests/test_inner_agora_conversation_cycle.py scripts/agora.mjs hermes-plugins/paperclip-cockpit/__init__.py
git commit -m "Isolate Telegram Agora state per chat"
```

---

### Task 5: Final Phase 6 Verification and Roadmap Evidence

**Files:**
- Modify: `docs/roadmap/TASKS.md`
- Modify: `docs/roadmap/ROADMAP.md`
- Modify: `docs/roadmap/IMPLEMENTATION_PLAN.md`
- Modify: `docs/superpowers/plans/2026-07-02-phase-6-per-chat-state.md`

- [ ] **Step 1: Run full verification**

Run:

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
node scripts/regression.mjs check
CHAMBER_MODE=chambers node scripts/regression.mjs check
STATE_MODE=per-chat INNER_AGORA_CHAT_ID=test-chat node scripts/agora.mjs mode get
```

Expected: all tests and regressions pass; final command prints `state=.../state/test-chat.json`.

- [ ] **Step 2: Update roadmap evidence**

Mark T6.1-T6.5 done in `docs/roadmap/TASKS.md` and add evidence:

- `data/schema/state.schema.json`;
- `scripts/state-manager.mjs`;
- `scripts/migrate-state.mjs`;
- `hermes-plugins/paperclip-cockpit/__init__.py`;
- tests proving per-chat isolation and migration.

Update `docs/roadmap/ROADMAP.md` Phase 6 checkboxes and `docs/roadmap/IMPLEMENTATION_PLAN.md` with observed verification results.

- [ ] **Step 3: Mark this plan complete**

Change Task 5 checkboxes to `[x]` after verification has passed.

- [ ] **Step 4: Commit**

```bash
git add docs/roadmap/TASKS.md docs/roadmap/ROADMAP.md docs/roadmap/IMPLEMENTATION_PLAN.md docs/superpowers/plans/2026-07-02-phase-6-per-chat-state.md
git commit -m "Document completed Phase 6"
```
