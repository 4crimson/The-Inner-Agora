# Phase 4 Human Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local-model-backed human-language assistant layer for Telegram/Hermes/Paperclip that extracts safe slots, plans deterministic Agora actions, asks one clarification when needed, and keeps synthesis/voice responses navigable with buttons.

**Architecture:** `scripts/intent-slots.mjs` owns prompt building, JSON parsing, schema validation, normalization, local LM Studio calls, regex fallback, and deterministic planning. `scripts/agora.mjs` exposes debug/route commands and keeps all Paperclip writes deterministic. The Paperclip cockpit plugin remains project-neutral by delegating natural Agora text to the generic CLI route instead of hard-coding philosophy logic.

**Tech Stack:** Node.js ESM, JSON Schema draft 2020-12, Python `unittest`, LM Studio OpenAI-compatible local endpoint, existing Paperclip cockpit plugin and Telegram helper.

---

## Scope Boundary

Use local models only. Default extractor model is `gemma-4-26b-a4b-it-mlx` because T4.0 showed 20/20 valid and semantically correct slot outputs with zero reasoning tokens. Do not add cloud extractor code.

The LLM only returns slots. It never creates issues, comments, wakeups, or Paperclip writes. All writes continue through deterministic `agora.mjs` commands.

## Files

- Create: `data/schema/intent-slots.schema.json`
- Create: `scripts/intent-slots.mjs`
- Create: `tests/test_phase4_intent_slots.py`
- Modify: `scripts/agora.mjs`
- Modify: `hermes-plugins/paperclip-cockpit/__init__.py`
- Modify: `paperclip-cockpit.json`
- Modify: `scripts/paperclip-cockpit-telegram.mjs`
- Modify: `tests/test_paperclip_cockpit_rewrites.py`
- Modify: `tests/test_inner_agora_conversation_cycle.py`
- Modify: `tests/test_paperclip_cockpit_telegram_helper.py`
- Verify: `python3 -m unittest discover -s tests -p 'test_*.py'`
- Verify: `node scripts/regression.mjs check`
- Verify: `CHAMBER_MODE=chambers node scripts/regression.mjs check`

---

### Task 1: Intent Slot Schema And Parser

**Files:**
- Create: `data/schema/intent-slots.schema.json`
- Create: `scripts/intent-slots.mjs`
- Create: `tests/test_phase4_intent_slots.py`

- [ ] **Step 1: Write failing schema and parser tests**

Add `tests/test_phase4_intent_slots.py` with:

```python
import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INTENT_SCHEMA = ROOT / "data" / "schema" / "intent-slots.schema.json"
INTENT_SCRIPT = ROOT / "scripts" / "intent-slots.mjs"


class Phase4IntentSlotTests(unittest.TestCase):
    def run_node(self, *args, input_text=None, env=None):
        return subprocess.run(
            ["node", *map(str, args)],
            cwd=ROOT,
            input=input_text,
            env=env,
            text=True,
            capture_output=True,
        )

    def test_intent_slot_schema_contract(self):
        schema = json.loads(INTENT_SCHEMA.read_text(encoding="utf-8"))
        self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertEqual(
            schema["required"],
            ["intent", "chamber", "mode", "topic", "roles", "taskRef", "missingSlots", "confidence"],
        )
        self.assertIn("new_session", schema["properties"]["intent"]["enum"])
        self.assertIn("role_detail", schema["properties"]["intent"]["enum"])

    def test_parse_json_object_strips_markdown_and_extra_text(self):
        raw = "```json\\n{\\\"intent\\\":\\\"help\\\",\\\"chamber\\\":null,\\\"mode\\\":null,\\\"topic\\\":null,\\\"roles\\\":[],\\\"taskRef\\\":null,\\\"missingSlots\\\":[],\\\"confidence\\\":0.9}\\n```"
        result = self.run_node(INTENT_SCRIPT, "parse-json", input_text=raw)
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["intent"], "help")

    def test_normalize_drops_unknown_roles_and_defaults_mode(self):
        payload = {
            "intent": "new_session",
            "chamber": "philosophy",
            "mode": None,
            "topic": "свобода ребенка и власть родителей",
            "roles": ["агора", "Платон"],
            "taskRef": None,
            "missingSlots": [],
            "confidence": 0.91,
        }
        result = self.run_node(INTENT_SCRIPT, "normalize", "--json", input_text=json.dumps(payload, ensure_ascii=False))
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["mode"], "balanced")
        self.assertEqual(data["roles"], ["plato"])
```

Run:

```bash
python3 -m unittest tests.test_phase4_intent_slots.Phase4IntentSlotTests
```

Expected before implementation: FAIL because `intent-slots.schema.json` and `intent-slots.mjs` do not exist.

- [ ] **Step 2: Create schema**

Create `data/schema/intent-slots.schema.json` with required fields:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://inner-agora.local/schema/intent-slots.schema.json",
  "title": "Inner Agora Intent Slots",
  "type": "object",
  "additionalProperties": false,
  "required": ["intent", "chamber", "mode", "topic", "roles", "taskRef", "missingSlots", "confidence"],
  "properties": {
    "intent": {
      "type": "string",
      "enum": ["new_session", "status", "result", "task_lookup", "role_detail", "help", "other"]
    },
    "chamber": { "type": ["string", "null"], "pattern": "^[a-z0-9][a-z0-9-]*$" },
    "mode": { "type": ["string", "null"], "enum": ["min", "balanced", "max", "all", null] },
    "topic": { "type": ["string", "null"] },
    "roles": { "type": "array", "items": { "type": "string", "minLength": 1 } },
    "taskRef": { "type": ["string", "null"] },
    "missingSlots": { "type": "array", "items": { "type": "string", "minLength": 1 } },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
  }
}
```

- [ ] **Step 3: Implement parser and normalizer**

Create `scripts/intent-slots.mjs` with exports:

```js
export function parseJsonObject(raw) {}
export function validateIntentSlots(slots) {}
export function normalizeIntentSlots(slots, options = {}) {}
```

Commands:

```bash
node scripts/intent-slots.mjs parse-json
node scripts/intent-slots.mjs normalize --json
```

Normalization rules:
- `new_session` with missing `mode` becomes `balanced`.
- Non-session intents force `mode` to `null`.
- `roles` are resolved through active chamber role aliases and returned as role keys.
- Unknown role aliases are dropped.
- `missingSlots` is recomputed for critical missing fields.

- [ ] **Step 4: Verify and commit**

Run:

```bash
python3 -m unittest tests.test_phase4_intent_slots.Phase4IntentSlotTests
node --check scripts/intent-slots.mjs
node scripts/intent-slots.mjs fixture-one --json > /tmp/phase4-one-slot.json
npx --yes ajv-cli@5 validate -s data/schema/intent-slots.schema.json -d /tmp/phase4-one-slot.json --spec=draft2020
```

`fixture-one` prints one normalized slot object that matches `intent-slots.schema.json`.

Commit:

```bash
git add data/schema/intent-slots.schema.json scripts/intent-slots.mjs tests/test_phase4_intent_slots.py
git commit -m "Add Phase 4 intent slot schema and parser"
```

---

### Task 2: Prompt, Local Extractor, And Regex Fallback

**Files:**
- Modify: `scripts/intent-slots.mjs`
- Modify: `tests/test_phase4_intent_slots.py`

- [ ] **Step 1: Write failing extraction tests**

Add tests:

```python
def test_prompt_names_chambers_and_forbids_direct_writes(self):
    result = self.run_node(INTENT_SCRIPT, "prompt", "совет директоров, нужен go/no-go по найму CTO")
    self.assertEqual(result.returncode, 0, result.stderr)
    self.assertIn("board-directors", result.stdout)
    self.assertIn("philosophy", result.stdout)
    self.assertIn("не создает Paperclip", result.stdout)

def test_regex_fallback_extracts_status_result_role_and_board_session(self):
    cases = {
        "дай выжимку по последней таске": "result",
        "готов ли синтез по последней задаче?": "status",
        "а что сказал Платон?": "role_detail",
        "совет директоров, нужен go/no-go по найму CTO": "new_session",
    }
    for text, intent in cases.items():
        result = self.run_node(INTENT_SCRIPT, "extract", "--routing-mode", "regex", "--json", text)
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["slots"]["intent"], intent)

def test_llm_extractor_uses_injected_response_without_network(self):
    fake = json.dumps({
        "intent": "new_session",
        "chamber": "philosophy",
        "mode": "min",
        "topic": "что такое свобода у Сартра и Камю",
        "roles": ["Сартр", "Камю"],
        "taskRef": None,
        "missingSlots": [],
        "confidence": 0.93,
    }, ensure_ascii=False)
    env = {**os.environ, "INNER_AGORA_FAKE_LLM_RESPONSE": fake}
    result = self.run_node(INTENT_SCRIPT, "extract", "--routing-mode", "llm", "--json", "коротко спроси агору: что такое свобода у Сартра и Камю", env=env)
    self.assertEqual(result.returncode, 0, result.stderr)
    payload = json.loads(result.stdout)
    self.assertEqual(payload["source"], "llm")
    self.assertEqual(payload["slots"]["mode"], "min")
    self.assertEqual(payload["slots"]["roles"], ["sartre", "camus"])
```

Run:

```bash
python3 -m unittest tests.test_phase4_intent_slots.Phase4IntentSlotTests
```

Expected before implementation: FAIL because prompt/extract commands do not exist.

- [ ] **Step 2: Implement prompt and extraction**

Add exports:

```js
export function buildSlotExtractionPrompt(userText, context = {}) {}
export async function extractIntentSlots(userText, options = {}) {}
export function regexFallbackSlots(userText, context = {}) {}
```

Environment:
- `INNER_AGORA_LLM_BASE_URL`, default `http://127.0.0.1:1234/v1`.
- `INNER_AGORA_LLM_MODEL`, default `gemma-4-26b-a4b-it-mlx`.
- `ROUTING_MODE`, default `regex` until Telegram integration explicitly opts into `llm`.
- `INNER_AGORA_FAKE_LLM_RESPONSE` for tests only.

The extractor retries invalid JSON once with a repair prompt, then falls back to regex.

- [ ] **Step 3: Verify and commit**

Run:

```bash
python3 -m unittest tests.test_phase4_intent_slots.Phase4IntentSlotTests
node --check scripts/intent-slots.mjs
```

Commit:

```bash
git add scripts/intent-slots.mjs tests/test_phase4_intent_slots.py
git commit -m "Add local intent extraction fallback"
```

---

### Task 3: Deterministic Planner And Questions

**Files:**
- Modify: `scripts/intent-slots.mjs`
- Modify: `tests/test_phase4_intent_slots.py`

- [ ] **Step 1: Write failing planner tests**

Add tests:

```python
def test_plan_new_session_builds_agora_ask_command(self):
    slots = {
        "intent": "new_session",
        "chamber": "philosophy",
        "mode": "min",
        "topic": "что такое свобода у Сартра и Камю",
        "roles": ["sartre", "camus"],
        "taskRef": None,
        "missingSlots": [],
        "confidence": 0.93,
    }
    result = self.run_node(INTENT_SCRIPT, "plan", "--json", input_text=json.dumps(slots, ensure_ascii=False))
    self.assertEqual(result.returncode, 0, result.stderr)
    plan = json.loads(result.stdout)
    self.assertEqual(plan["action"], "command")
    self.assertEqual(plan["command"][:4], ["/agora", "ask", "--mode", "min"])
    self.assertIn("--voices", plan["command"])

def test_plan_missing_topic_asks_one_question(self):
    slots = {
        "intent": "new_session",
        "chamber": "philosophy",
        "mode": "balanced",
        "topic": None,
        "roles": [],
        "taskRef": None,
        "missingSlots": ["topic"],
        "confidence": 0.8,
    }
    result = self.run_node(INTENT_SCRIPT, "plan", "--json", input_text=json.dumps(slots, ensure_ascii=False))
    self.assertEqual(result.returncode, 0, result.stderr)
    plan = json.loads(result.stdout)
    self.assertEqual(plan["action"], "clarify")
    self.assertIn("какой вопрос", plan["question"].lower())

def test_plan_role_detail_routes_to_voice(self):
    slots = {
        "intent": "role_detail",
        "chamber": "philosophy",
        "mode": None,
        "topic": None,
        "roles": ["plato"],
        "taskRef": None,
        "missingSlots": [],
        "confidence": 0.95,
    }
    result = self.run_node(INTENT_SCRIPT, "plan", "--json", input_text=json.dumps(slots, ensure_ascii=False))
    self.assertEqual(result.returncode, 0, result.stderr)
    plan = json.loads(result.stdout)
    self.assertEqual(plan["command"], ["/agora", "voice", "plato"])
```

Run:

```bash
python3 -m unittest tests.test_phase4_intent_slots.Phase4IntentSlotTests
```

Expected before implementation: FAIL because `plan` command does not exist.

- [ ] **Step 2: Implement planner**

Add exports:

```js
export function decideNextStep(slots, context = {}) {}
export function questionFor(slotName, slots = {}) {}
```

Planner outputs:

```json
{
  "action": "command",
  "command": ["/agora", "ask", "--mode", "balanced", "topic"],
  "ack": "Понял: запускаю philosophy..."
}
```

or:

```json
{
  "action": "clarify",
  "missingSlots": ["topic"],
  "question": "Какой вопрос поставить в Агору?"
}
```

- [ ] **Step 3: Verify and commit**

Run:

```bash
python3 -m unittest tests.test_phase4_intent_slots.Phase4IntentSlotTests
node --check scripts/intent-slots.mjs
```

Commit:

```bash
git add scripts/intent-slots.mjs tests/test_phase4_intent_slots.py
git commit -m "Add deterministic intent planner"
```

---

### Task 4: Agora CLI Natural Route

**Files:**
- Modify: `scripts/agora.mjs`
- Modify: `tests/test_phase4_intent_slots.py`

- [ ] **Step 1: Write failing CLI tests**

Add tests:

```python
def test_agora_understand_returns_slots_and_plan(self):
    result = self.run_node(ROOT / "scripts" / "agora.mjs", "understand", "--routing-mode", "regex", "--json", "дай выжимку по последней таске")
    self.assertEqual(result.returncode, 0, result.stderr)
    payload = json.loads(result.stdout)
    self.assertEqual(payload["slots"]["intent"], "result")
    self.assertEqual(payload["plan"]["command"], ["/agora", "latest"])

def test_agora_natural_dry_run_returns_rewrite_text(self):
    result = self.run_node(ROOT / "scripts" / "agora.mjs", "natural", "--routing-mode", "regex", "--dry-run", "--json", "а что сказал Платон?")
    self.assertEqual(result.returncode, 0, result.stderr)
    payload = json.loads(result.stdout)
    self.assertEqual(payload["action"], "rewrite")
    self.assertEqual(payload["text"], "/agora voice plato")
```

Run:

```bash
python3 -m unittest tests.test_phase4_intent_slots.Phase4IntentSlotTests
```

Expected before implementation: FAIL because `agora.mjs understand` and `natural` do not exist.

- [ ] **Step 2: Implement CLI commands**

Modify `scripts/agora.mjs`:

- Import `extractIntentSlots` and `decideNextStep`.
- Add `understand` command for debugging slots and plan.
- Add `natural` command for plugin-friendly rewrite output.
- `natural --dry-run --json` prints `{ "action": "rewrite", "text": "/agora ..." }`.
- `natural` without dry-run executes deterministic commands by dispatching to existing command functions.

- [ ] **Step 3: Verify and commit**

Run:

```bash
python3 -m unittest tests.test_phase4_intent_slots.Phase4IntentSlotTests
node --check scripts/agora.mjs
```

Commit:

```bash
git add scripts/agora.mjs tests/test_phase4_intent_slots.py
git commit -m "Expose natural Agora CLI route"
```

---

### Task 5: Paperclip Cockpit Natural Delegation

**Files:**
- Modify: `hermes-plugins/paperclip-cockpit/__init__.py`
- Modify: `paperclip-cockpit.json`
- Modify: `tests/test_paperclip_cockpit_rewrites.py`
- Modify: `tests/test_inner_agora_conversation_cycle.py`

- [ ] **Step 1: Write failing plugin delegation tests**

Update `tests/test_paperclip_cockpit_rewrites.py`:

```python
def test_natural_rewrite_can_delegate_to_configured_understander(self):
    config = {
        "command": {"name": "agora"},
        "natural_language": {
            "delegate": {
                "exec": ["node", "scripts/agora.mjs", "natural", "--routing-mode", "regex", "--dry-run", "--json", "{text}"]
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
```

Update full-cycle test to assert the same natural phrase still goes through the new route and creates the same five voice tasks.

Run:

```bash
python3 -m unittest tests.test_paperclip_cockpit_rewrites tests.test_inner_agora_conversation_cycle
```

Expected before implementation: FAIL because the plugin does not support `natural_language.delegate`.

- [ ] **Step 2: Implement generic delegate**

Modify the Python plugin:

- In `_rewrite_text`, before static natural aliases, check `config["natural_language"]["delegate"]`.
- Run the configured command with `{text}` substituted as one argument.
- Parse JSON output `{ "action": "rewrite", "text": "/agora ..." }`.
- Accept only rewritten text that starts with the configured slash command.
- On command failure, log and fall back to existing regex/config rewrite.

Modify `paperclip-cockpit.json`:

```json
"natural_language": {
  "delegate": {
    "exec": ["node", "scripts/agora.mjs", "natural", "--routing-mode", "llm", "--dry-run", "--json", "{text}"]
  }
}
```

- [ ] **Step 3: Verify and commit**

Run:

```bash
python3 -m unittest tests.test_paperclip_cockpit_rewrites tests.test_inner_agora_conversation_cycle
python3 -m unittest discover -s tests -p 'test_*.py'
```

Commit:

```bash
git add hermes-plugins/paperclip-cockpit/__init__.py paperclip-cockpit.json tests/test_paperclip_cockpit_rewrites.py tests/test_inner_agora_conversation_cycle.py
git commit -m "Delegate natural Telegram text to Agora planner"
```

---

### Task 6: Buttons And Formatted Role Results

**Files:**
- Modify: `scripts/paperclip-cockpit-telegram.mjs`
- Modify: `tests/test_paperclip_cockpit_telegram_helper.py`
- Modify: `tests/test_inner_agora_conversation_cycle.py`

- [ ] **Step 1: Write failing button/format tests**

Add or update tests:

```python
def test_payload_voice_keeps_synthesis_and_peer_voice_buttons(self):
    payload = self.run_helper(routes, ["payload-voice", "WK-21"])
    rows = payload["reply_markup"]["inline_keyboard"]
    self.assertEqual(rows[0][0]["callback_data"], "wk:result:WK-22")
    self.assertTrue(any(button["callback_data"] == "wk:latest:WK-20" for row in rows for button in row))
    self.assertTrue(any(button["callback_data"] == "wk:clarify:WK-20" for row in rows for button in row))
```

Update conversation-cycle assertions so callback voice responses include:

- `Синтез` button.
- `Все голоса` button.
- At least one peer voice button.
- A formatted digest header, not a raw unstructured dump.

Run:

```bash
python3 -m unittest tests.test_paperclip_cockpit_telegram_helper tests.test_inner_agora_conversation_cycle
```

Expected before implementation: FAIL if voice payload lacks bottom navigation buttons or formatting.

- [ ] **Step 2: Improve keyboard and payload formatting**

Modify `scripts/paperclip-cockpit-telegram.mjs`:

- Ensure `buildKeyboard(root, issues)` is used for both synthesis and voice payloads.
- Keep synthesis row first when available.
- Include peer voice buttons for child issues.
- Always include bottom row with all voices/latest and clarify/follow-up.
- Preserve project-neutral labels from config.

- [ ] **Step 3: Verify and commit**

Run:

```bash
python3 -m unittest tests.test_paperclip_cockpit_telegram_helper tests.test_paperclip_cockpit_telegram_callbacks tests.test_inner_agora_conversation_cycle
```

Commit:

```bash
git add scripts/paperclip-cockpit-telegram.mjs tests/test_paperclip_cockpit_telegram_helper.py tests/test_inner_agora_conversation_cycle.py
git commit -m "Keep Telegram result navigation on voice views"
```

---

### Task 7: Follow-Up Binding And Manual 20-Phrase Check

**Files:**
- Modify: `scripts/agora.mjs`
- Modify: `scripts/intent-slots.mjs`
- Modify: `tests/test_phase4_intent_slots.py`

- [ ] **Step 1: Write failing follow-up tests**

Add tests:

```python
def test_follow_up_phrase_plans_child_request_against_last_root(self):
    slots = {
        "intent": "new_session",
        "chamber": "philosophy",
        "mode": "balanced",
        "topic": "уточни у Платона понятие долга",
        "roles": ["plato"],
        "taskRef": None,
        "missingSlots": [],
        "confidence": 0.88,
    }
    context = {"lastRootIssueRef": "THE-900", "isFollowUp": True}
    result = self.run_node(INTENT_SCRIPT, "plan", "--json", "--context", json.dumps(context), input_text=json.dumps(slots, ensure_ascii=False))
    self.assertEqual(result.returncode, 0, result.stderr)
    plan = json.loads(result.stdout)
    self.assertEqual(plan["action"], "command")
    self.assertEqual(plan["command"][:3], ["/agora", "follow-up", "THE-900"])
```

Run:

```bash
python3 -m unittest tests.test_phase4_intent_slots.Phase4IntentSlotTests
```

Expected before implementation: FAIL because follow-up context is not planned.

- [ ] **Step 2: Implement follow-up planning**

Add follow-up detection and planning:

- Phrases with "уточни", "продолжи", "спроси еще", "по этой сессии" and a known `lastRootIssueRef` route to `/agora follow-up <root> ...`.
- If no last root exists, ask one clarification for the session/task reference.
- Keep synthesis digest retrieval deterministic after the follow-up child completes.

- [ ] **Step 3: Add manual local-model comparison command**

Add a command:

```bash
node scripts/intent-slots.mjs fixture-20 --routing-mode regex --json
ROUTING_MODE=llm INNER_AGORA_LLM_MODEL=gemma-4-26b-a4b-it-mlx node scripts/intent-slots.mjs fixture-20 --json
```

The command prints counts for valid JSON, semantic matches, average latency, and source path. The test version uses fake outputs; the local LM Studio version is manual and not required in CI.

- [ ] **Step 4: Verify and commit**

Run:

```bash
python3 -m unittest tests.test_phase4_intent_slots.Phase4IntentSlotTests
node --check scripts/intent-slots.mjs
node --check scripts/agora.mjs
```

Commit:

```bash
git add scripts/agora.mjs scripts/intent-slots.mjs tests/test_phase4_intent_slots.py
git commit -m "Add follow-up planning for natural Agora requests"
```

---

### Task 8: Final Phase 4 Verification

**Files:**
- Modify: `docs/roadmap/TASKS.md`
- Modify: `docs/roadmap/IMPLEMENTATION_PLAN.md`

- [ ] **Step 1: Mark Phase 4 evidence**

Update roadmap docs with:

- T4.0 result path and decision.
- Implemented commands.
- Verification commands and dates.

- [ ] **Step 2: Run full verification**

Run:

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
node scripts/regression.mjs check
CHAMBER_MODE=chambers node scripts/regression.mjs check
npx --yes ajv-cli@5 validate -s data/schema/intent-slots.schema.json -d /tmp/phase4-one-slot.json --spec=draft2020
```

Run the local manual spike if LM Studio is available:

```bash
ROUTING_MODE=llm INNER_AGORA_LLM_MODEL=gemma-4-26b-a4b-it-mlx node scripts/intent-slots.mjs fixture-20 --json
```

Expected:

- Python tests pass.
- Regression harness passes in legacy and chamber modes.
- Intent slot schema validates a single slot fixture.
- Local manual fixture remains at or above 80% valid/correct when LM Studio is running.

- [ ] **Step 3: Commit verification docs**

Commit:

```bash
git add docs/roadmap/TASKS.md docs/roadmap/IMPLEMENTATION_PLAN.md
git commit -m "Document Phase 4 verification"
```
