# Phase 8 Telegram UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Telegram conversations around Paperclip/Aгора feel continuous, local-model-first, and navigable with progress updates, result buttons, presets, and health checks.

**Architecture:** Keep Hermes `pre_gateway_dispatch` as a text router because its contract does not support `reply_markup`. Use the existing Telegram Bot API side channel for final/progress/result payloads, and use numbered wizard text for ambiguity where hook-level buttons are unavailable. Keep project-specific behavior in JSON actions and chamber config.

**Tech Stack:** Python Hermes plugin, Node.js CLI helpers, Paperclip HTTP API, Telegram Bot API JSON payloads, Python `unittest`.

---

## File Structure

- Modify `docs/roadmap/ROADMAP.md` and `docs/roadmap/TASKS.md`: record Phase 8 completion evidence.
- Modify `hermes-plugins/paperclip-cockpit/__init__.py`: add per-action env overrides and keep callback payloads generic.
- Modify `scripts/paperclip-cockpit-telegram.mjs`: add progress payload rendering and configurable quick-action rows.
- Modify `scripts/paperclip-cockpit-monitor.mjs`: send idempotent progress notifications.
- Modify `scripts/inner-agora-guard.mjs`: validate chamber-loader health.
- Modify `paperclip-cockpit.json` and `chambers/philosophy/cockpit.overrides.json`: configure progress notify, quick actions, presets, and callbacks.
- Modify tests:
  - `tests/test_paperclip_cockpit_telegram_callbacks.py`
  - `tests/test_paperclip_cockpit_telegram_helper.py`
  - `tests/test_paperclip_cockpit_monitor.py`
  - `tests/test_paperclip_cockpit_rewrites.py`
  - add `tests/test_inner_agora_guard.py`

## Task 1: Generic Action Env And Preset Routing

**Files:**
- Modify: `hermes-plugins/paperclip-cockpit/__init__.py`
- Modify: `paperclip-cockpit.json`
- Modify: `chambers/philosophy/cockpit.overrides.json`
- Test: `tests/test_paperclip_cockpit_telegram_callbacks.py`
- Test: `tests/test_paperclip_cockpit_rewrites.py`

- [ ] **Step 1: Write failing tests**

Add a callback/action test proving action `env` merges into subprocess env:

```python
def test_action_env_overrides_are_passed_to_subprocess(self):
    config = {
        "actions": {
            "board_go_no_go": {
                "exec": ["node", "-e", "console.log(process.env.INNER_AGORA_ACTIVE_CHAMBER + ':' + process.env.INNER_AGORA_MODE)"],
                "env": {"INNER_AGORA_ACTIVE_CHAMBER": "board-directors", "INNER_AGORA_MODE": "local"},
            }
        }
    }
    ...
```

Add a rewrite test proving natural aliases map presets:

```python
self.assertEqual(self.plugin._rewrite_text("быстрый совет: стоит ли ждать"), "/agora quick стоит ли ждать")
self.assertEqual(self.plugin._rewrite_text("глубокое исследование: свобода и долг"), "/agora deep свобода и долг")
self.assertEqual(self.plugin._rewrite_text("go/no-go: нанимать CTO"), "/agora go-no-go нанимать CTO")
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
python3 -m unittest tests.test_paperclip_cockpit_telegram_callbacks tests.test_paperclip_cockpit_rewrites -v
```

Expected: env override assertion fails because `_run_action` only uses `_subprocess_env(chat_id)`, and preset aliases are absent.

- [ ] **Step 3: Implement minimal code/config**

Change `_subprocess_env` to accept `extra_env` and merge string values. In `_run_action`, pass `action.get("env")` into `_subprocess_env`.

Add config actions:

```json
"quick": {"exec": ["node", "scripts/agora.mjs", "ask", "--min"], "natural_aliases": ["быстрый совет"], "timeout": 900},
"deep": {"exec": ["node", "scripts/agora.mjs", "ask", "--max"], "natural_aliases": ["глубокое исследование"], "timeout": 900},
"go-no-go": {
  "exec": ["node", "scripts/agora.mjs", "ask", "--min"],
  "natural_aliases": ["go/no-go", "совет директоров go/no-go"],
  "env": {"INNER_AGORA_ACTIVE_CHAMBER": "board-directors", "INNER_AGORA_MODE": "local"},
  "timeout": 900
}
```

- [ ] **Step 4: Verify GREEN**

Run the same unittest command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hermes-plugins/paperclip-cockpit/__init__.py paperclip-cockpit.json chambers/philosophy/cockpit.overrides.json tests/test_paperclip_cockpit_telegram_callbacks.py tests/test_paperclip_cockpit_rewrites.py
git commit -m "Add Phase 8 Telegram presets"
```

## Task 2: Telegram Progress Payload And Quick Actions

**Files:**
- Modify: `scripts/paperclip-cockpit-telegram.mjs`
- Modify: `paperclip-cockpit.json`
- Modify: `chambers/philosophy/cockpit.overrides.json`
- Test: `tests/test_paperclip_cockpit_telegram_helper.py`

- [ ] **Step 1: Write failing tests**

Add a helper test for `payload-progress ROOT`:

```python
payload = self.run_helper(config, routes, ["payload-progress", "WK-30"])
self.assertIn("Совет работает: 1/3", payload["text"])
self.assertIn("Готово: Voice Alpha", payload["text"])
self.assertIn("Ждем: Voice Beta, Voice Gamma", payload["text"])
self.assertEqual(payload["reply_markup"]["inline_keyboard"][-1][0]["callback_data"], "wk:latest:WK-30")
```

Extend the existing keyboard test to assert a configured quick-action row:

```python
self.assertIn({"text": "Disagreements", "callback_data": "wk:disagreements:WK-10"}, rows[-1])
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
python3 -m unittest tests.test_paperclip_cockpit_telegram_helper -v
```

Expected: unknown command `payload-progress` and missing quick-action row.

- [ ] **Step 3: Implement minimal code/config**

In `scripts/paperclip-cockpit-telegram.mjs`:

- add `progressText(root, issues)`;
- add `quickActionRows(root)` reading `telegram.buttons.quick_actions[]`;
- append quick-action rows in `buildKeyboard`;
- support `payload-progress` and `send-progress`.

Configure quick actions as callback messages or payload callbacks:

```json
"quick_actions": [
  {"label": "Разногласия", "callback": "disagreements"},
  {"label": "Углубить", "callback": "deepen"},
  {"label": "Новый вопрос", "callback": "new_question"}
]
```

- [ ] **Step 4: Verify GREEN**

Run the helper unittest. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/paperclip-cockpit-telegram.mjs paperclip-cockpit.json chambers/philosophy/cockpit.overrides.json tests/test_paperclip_cockpit_telegram_helper.py
git commit -m "Add Phase 8 Telegram progress payloads"
```

## Task 3: Monitor Progress Notifications

**Files:**
- Modify: `scripts/paperclip-cockpit-monitor.mjs`
- Modify: `paperclip-cockpit.json`
- Modify: `chambers/philosophy/cockpit.overrides.json`
- Test: `tests/test_paperclip_cockpit_monitor.py`

- [ ] **Step 1: Write failing tests**

Add a sequence test where one child is done and one is open:

```python
outputs, state = self.run_monitor_sequence([routes, routes], "ROOT-50")
self.assertEqual(outputs[0]["operations"][0]["type"], "progress_notify")
self.assertEqual(outputs[1]["operations"][0]["type"], "wait")
self.assertEqual(state["roots"]["ROOT-50"]["lastProgressFingerprint"], "1/2:ROOT-51:done|ROOT-52:in_progress")
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
python3 -m unittest tests.test_paperclip_cockpit_monitor -v
```

Expected: only `wait` is emitted; no progress state is stored.

- [ ] **Step 3: Implement minimal code/config**

Add helpers:

```js
function progressNotifyCommand(vars) { ... }
function progressFingerprint(voiceChildren) { ... }
```

When `openChildren.length` is non-zero, run the progress command only if the fingerprint changed, then emit `progress_notify` before `wait`.

Default command:

```json
"progress_notify": {
  "exec": ["node", "scripts/paperclip-cockpit-telegram.mjs", "send-progress", "{root}"],
  "append_args": false
}
```

- [ ] **Step 4: Verify GREEN**

Run monitor unittest. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/paperclip-cockpit-monitor.mjs paperclip-cockpit.json chambers/philosophy/cockpit.overrides.json tests/test_paperclip_cockpit_monitor.py
git commit -m "Notify Telegram council progress"
```

## Task 4: Guard Chamber Health

**Files:**
- Modify: `scripts/inner-agora-guard.mjs`
- Test: `tests/test_inner_agora_guard.py`

- [ ] **Step 1: Write failing tests**

Add a test that runs guard with network checks disabled through env and asserts chamber health is reported:

```python
data = json.loads(result.stdout)
self.assertTrue(data["chambers"]["ok"])
self.assertIn("philosophy", data["chambers"]["ids"])
self.assertIn("board-directors", data["chambers"]["ids"])
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
python3 -m unittest tests.test_inner_agora_guard -v
```

Expected: `chambers` key is missing.

- [ ] **Step 3: Implement minimal code**

Add `checkChambers(summary)` that runs:

```bash
node scripts/chamber-loader.mjs list --json
node scripts/chamber-loader.mjs cockpit philosophy --json
```

Record `summary.chambers = {ok, ids, active, count}` and an error event on failure.

- [ ] **Step 4: Verify GREEN**

Run guard unittest. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/inner-agora-guard.mjs tests/test_inner_agora_guard.py
git commit -m "Check chamber health in Agora guard"
```

## Task 5: Integration Verification And Roadmap Evidence

**Files:**
- Modify: `docs/roadmap/ROADMAP.md`
- Modify: `docs/roadmap/TASKS.md`

- [ ] **Step 1: Run focused tests**

```bash
python3 -m unittest \
  tests.test_paperclip_cockpit_telegram_callbacks \
  tests.test_paperclip_cockpit_telegram_helper \
  tests.test_paperclip_cockpit_monitor \
  tests.test_paperclip_cockpit_rewrites \
  tests.test_inner_agora_conversation_cycle \
  tests.test_inner_agora_guard \
  -v
```

- [ ] **Step 2: Run full tests**

```bash
python3 -m unittest discover -s tests -v
```

- [ ] **Step 3: Run regression harness**

```bash
node scripts/regression.mjs check
CHAMBER_MODE=chambers node scripts/regression.mjs check
```

- [ ] **Step 4: Update roadmap evidence**

Mark Phase 8 done with the commands that passed and note the T8.1 spike result:

```markdown
**Done 2026-07-03:** Phase 8 completed. `pre_gateway_dispatch` is text-only; Telegram inline UX is implemented through Bot API payloads and callback hooks. Ambiguity uses deterministic wizard/numbered menus; results and progress use inline keyboards. Verification: ...
```

- [ ] **Step 5: Commit**

```bash
git add docs/roadmap/ROADMAP.md docs/roadmap/TASKS.md
git commit -m "Document completed Phase 8"
```

## Self-Review

- Spec coverage: T8.1 through T8.6 are covered.
- No placeholders remain.
- All behavior changes have tests that must fail before implementation.
- Presets and quick actions are config-driven.
- Local-model-first is preserved; no new cloud credentials or providers are introduced.
