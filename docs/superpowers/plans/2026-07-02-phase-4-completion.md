# Phase 4 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining Phase 4 human-assistant scope: smart onboarding, a text wizard, context-aware role follow-ups, and explicit last-session binding through the local-model natural-language route.

**Architecture:** Keep the local LLM as a slot extractor only. `scripts/intent-slots.mjs` understands extra intents and context hints; `scripts/agora.mjs` owns stateful wizard/onboarding/context commands; the Paperclip cockpit plugin stays generic and only rewrites Telegram text to configured slash commands. Native Telegram inline buttons remain Phase 8 because the Hermes `pre_gateway_dispatch` contract currently documents `skip`, `rewrite`, and `allow`, not `reply_markup`.

**Tech Stack:** Node.js ESM, Python `unittest`, existing Paperclip mock HTTP handlers, LM Studio OpenAI-compatible local endpoint at `http://127.0.0.1:1234/v1`, generic Hermes Paperclip cockpit plugin.

---

## Scope Boundary

Use `ROUTING_MODE=llm` for live Telegram/Paperclip natural-language routing. Regex stays as a deterministic fallback and test mode.

Do not add cloud model calls. Do not couple the cockpit plugin to The Inner Agora names; all project-specific behavior must be configured in `paperclip-cockpit.json` and implemented in `scripts/agora.mjs`.

## Files

- Modify: `scripts/intent-slots.mjs`
- Modify: `scripts/agora.mjs`
- Modify: `hermes-plugins/paperclip-cockpit/__init__.py`
- Modify: `paperclip-cockpit.json`
- Modify: `chambers/philosophy/cockpit.overrides.json`
- Modify: `tests/test_phase4_intent_slots.py`
- Modify: `tests/test_inner_agora_ask_flow.py`
- Modify: `tests/test_paperclip_cockpit_rewrites.py`
- Modify: `docs/roadmap/TASKS.md`
- Modify: `docs/roadmap/IMPLEMENTATION_PLAN.md`
- Verify: `python3 -m unittest discover -s tests -p 'test_*.py'`
- Verify: `node scripts/regression.mjs check`
- Verify: `CHAMBER_MODE=chambers node scripts/regression.mjs check`
- Verify local model: `ROUTING_MODE=llm INNER_AGORA_LLM_MODEL=gemma-4-26b-a4b-it-mlx node scripts/intent-slots.mjs fixture-20 --json`

---

### Task 1: Smart `/start` Onboarding

**Files:**
- Modify: `scripts/agora.mjs`
- Modify: `hermes-plugins/paperclip-cockpit/__init__.py`
- Modify: `paperclip-cockpit.json`
- Modify: `chambers/philosophy/cockpit.overrides.json`
- Modify: `tests/test_phase4_intent_slots.py`
- Modify: `tests/test_paperclip_cockpit_rewrites.py`

- [ ] **Step 1: Write failing onboarding tests**

Add tests:

```python
def test_start_onboarding_lists_chambers_dynamically(self):
    result = self.run_node(ROOT / "scripts" / "agora.mjs", "start", "--json")
    self.assertEqual(result.returncode, 0, result.stderr)
    payload = json.loads(result.stdout)
    chamber_ids = [item["id"] for item in payload["chambers"]]
    self.assertIn("philosophy", chamber_ids)
    self.assertIn("board-directors", chamber_ids)
    self.assertTrue(payload["examples"])
```

```python
def test_configured_start_rewrite_is_generic(self):
    config = {
        "command": {"name": "agora"},
        "natural_language": {"start": {"action": "start"}},
    }
    with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8") as handle:
        json.dump(config, handle)
        handle.flush()
        with EnvPatch(PAPERCLIP_COCKPIT_CONFIG=handle.name, PAPERCLIP_COCKPIT_NL_REWRITE="1"):
            self.assertEqual(self.plugin._rewrite_text("/start"), "/agora start")
```

Run:

```bash
python3 -m unittest tests.test_phase4_intent_slots.Phase4IntentSlotTests.test_start_onboarding_lists_chambers_dynamically tests.test_paperclip_cockpit_rewrites.PaperclipCockpitRewriteTests.test_configured_start_rewrite_is_generic
```

Expected before implementation: FAIL because `agora.mjs start` is unknown and `/start` is ignored.

- [ ] **Step 2: Implement dynamic start output**

Add `start` command to `scripts/agora.mjs`:

```js
async function start(args = []) {
  const json = args.includes("--json");
  const chambers = listChambers(CHAMBERS_DIR).map((chamber) => ({
    id: chamber.id,
    name: chamber.name,
    status: chamber.status,
  }));
  const examples = buildStartExamples(chambers);
  const payload = { title: "The Inner Agora", routingMode: process.env.ROUTING_MODE || "regex", chambers, examples };
  if (json) process.stdout.write(stableJson(payload));
  else printStartOnboarding(payload);
  return payload;
}
```

Add `if (command === "start") return start(args);` to `main()`.

- [ ] **Step 3: Implement generic `/start` rewrite**

In `hermes-plugins/paperclip-cockpit/__init__.py`, before the generic `raw.startswith("/")` guard, check `natural_language.start`:

```python
def _rewrite_start_command(raw: str) -> str | None:
    start = _natural_language_config().get("start")
    if not isinstance(start, dict) or _as_bool(start.get("disabled"), False):
        return None
    if not re.match(r"^/start(?:@\w+)?(?:\s|$)", raw, re.I):
        return None
    return _slash(str(start.get("action") or "start"))
```

Configure:

```json
"natural_language": {
  "start": { "action": "start" },
  "delegate": { "...": "existing delegate" }
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
python3 -m unittest tests.test_phase4_intent_slots tests.test_paperclip_cockpit_rewrites
git add scripts/agora.mjs hermes-plugins/paperclip-cockpit/__init__.py paperclip-cockpit.json chambers/philosophy/cockpit.overrides.json tests/test_phase4_intent_slots.py tests/test_paperclip_cockpit_rewrites.py
git commit -m "Add smart Agora onboarding"
```

---

### Task 2: Text Wizard Through Natural Telegram

**Files:**
- Modify: `scripts/agora.mjs`
- Modify: `tests/test_phase4_intent_slots.py`
- Modify: `tests/test_inner_agora_ask_flow.py`

- [ ] **Step 1: Write failing wizard route tests**

Add tests:

```python
def test_natural_missing_topic_rewrites_to_wizard_start(self):
    result = self.run_node(
        ROOT / "scripts" / "agora.mjs",
        "natural", "--routing-mode", "regex", "--dry-run", "--json",
        "хочу запустить агору",
    )
    self.assertEqual(result.returncode, 0, result.stderr)
    payload = json.loads(result.stdout)
    self.assertEqual(payload["action"], "rewrite")
    self.assertEqual(payload["text"], "/agora wizard")
```

```python
def test_wizard_pending_reply_rewrites_to_wizard_answer(self):
    with tempfile.TemporaryDirectory() as temp_dir:
        state_path = Path(temp_dir) / "state.json"
        state_path.write_text(json.dumps({"wizard": {"step": "topic", "slots": {}}}), encoding="utf-8")
        env = {**os.environ, "INNER_AGORA_STATE_PATH": str(state_path)}
        result = self.run_node(
            ROOT / "scripts" / "agora.mjs",
            "natural", "--routing-mode", "regex", "--dry-run", "--json",
            "что значит свобода у Сартра",
            env=env,
        )
    self.assertEqual(result.returncode, 0, result.stderr)
    payload = json.loads(result.stdout)
    self.assertEqual(payload["text"], "/agora wizard-answer что значит свобода у Сартра")
```

Run:

```bash
python3 -m unittest tests.test_phase4_intent_slots.Phase4IntentSlotTests.test_natural_missing_topic_rewrites_to_wizard_start tests.test_phase4_intent_slots.Phase4IntentSlotTests.test_wizard_pending_reply_rewrites_to_wizard_answer
```

Expected before implementation: FAIL.

- [ ] **Step 2: Implement wizard state machine**

Add commands:

```js
function startWizard() {
  writeState({ wizard: { step: "topic", slots: { intent: "new_session", chamber: null, mode: "balanced", topic: null, roles: [], taskRef: null, missingSlots: ["topic"], confidence: 0.8 } } });
  console.log("Какой вопрос поставить в Агору?");
}

async function wizardAnswer(args = []) {
  const answer = args.join(" ").trim();
  const state = readState();
  const wizard = state.wizard || {};
  // topic -> chamber -> mode -> confirm; on confirm yes call decideNextStep(slots) and runPlannedCommand(plan.command)
}
```

Use deterministic parsing for the constrained wizard answers:
- `philosophy`, `философ`, `1` -> `philosophy`
- `board-directors`, `директор`, `бизнес`, `2` -> `board-directors`
- `min`, `корот`, `1` -> `min`
- `balanced`, `обыч`, `2` -> `balanced`
- `max`, `глуб`, `3` -> `max`
- `да`, `yes`, `go`, `запускай` -> confirm
- `нет`, `cancel`, `отмена` -> clear wizard

- [ ] **Step 3: Route natural text to wizard**

In `natural()`, before extraction:

```js
const wizard = readState().wizard;
if (wizard?.step) return naturalPayloadForCommand(["/agora", "wizard-answer", options.text], options);
```

After `decideNextStep`, if `plan.action === "clarify"` and `plan.missingSlots` contains `topic`, return rewrite `/agora wizard`.

- [ ] **Step 4: Prove wizard creates the same session path**

Add an HTTP mock test that runs:

```bash
node scripts/agora.mjs wizard
node scripts/agora.mjs wizard-answer "что значит свобода у Сартра"
node scripts/agora.mjs wizard-answer "philosophy"
node scripts/agora.mjs wizard-answer "min"
node scripts/agora.mjs wizard-answer "да"
```

Expected: the final command creates one root and voice children through the same `ask()` codepath; stdout contains `Поставил вопрос в Агору`.

- [ ] **Step 5: Verify and commit**

Run:

```bash
python3 -m unittest tests.test_phase4_intent_slots tests.test_inner_agora_ask_flow
git add scripts/agora.mjs tests/test_phase4_intent_slots.py tests/test_inner_agora_ask_flow.py
git commit -m "Add natural Agora wizard"
```

---

### Task 3: Context-Aware Role Dialogue

**Files:**
- Modify: `data/schema/intent-slots.schema.json`
- Modify: `scripts/intent-slots.mjs`
- Modify: `scripts/agora.mjs`
- Modify: `tests/test_phase4_intent_slots.py`
- Modify: `tests/test_inner_agora_ask_flow.py`

- [ ] **Step 1: Write failing intent and planner tests**

Add `dialogue_with_role` to tests:

```python
def test_dialogue_with_role_plans_context_command(self):
    slots = {
        "intent": "dialogue_with_role",
        "chamber": "philosophy",
        "mode": None,
        "topic": "А что бы Хайдеггер ответил на второе возражение?",
        "roles": ["heidegger"],
        "taskRef": None,
        "missingSlots": [],
        "confidence": 0.88,
    }
    context = {"lastRootIssueRef": "THE-900"}
    result = self.run_node(INTENT_SCRIPT, "plan", "--json", "--context", json.dumps(context), input_text=json.dumps(slots, ensure_ascii=False))
    self.assertEqual(result.returncode, 0, result.stderr)
    plan = json.loads(result.stdout)
    self.assertEqual(plan["command"][:4], ["/agora", "dialogue-context", "THE-900", "heidegger"])
```

Expected before implementation: FAIL because `dialogue_with_role` is not in the schema/intent set.

- [ ] **Step 2: Implement intent extraction and planning**

Add `dialogue_with_role` to:
- JSON schema enum
- `INTENTS`
- prompt schema text
- regex fallback branch when a role is mentioned with `что бы`, `ответил`, `ответила`, or `возражение`
- `decideNextStep()` branch that requires `context.lastRootIssueRef` and returns `/agora dialogue-context <root> <role> <question>`

- [ ] **Step 3: Implement `dialogue-context` command**

Add command:

```js
async function dialogueWithContext(args = []) {
  const [rootRef, roleToken, ...questionParts] = args;
  const request = questionParts.join(" ").trim();
  const rootIssue = await api(`/issues/${rootRef}`);
  const synthesis = await latestSynthesisForRoot(rootIssue);
  const description = buildDialogueWithContextDescription({ rootIssue, synthesis, request, philosopher });
  // Create a child issue under root, assign it to the selected role, wake that agent.
}
```

The description must include:
- root session identifier
- root question
- synthesis digest when available
- user follow-up question
- transparency policy

- [ ] **Step 4: Verify and commit**

Run:

```bash
python3 -m unittest tests.test_phase4_intent_slots tests.test_inner_agora_ask_flow
git add data/schema/intent-slots.schema.json scripts/intent-slots.mjs scripts/agora.mjs tests/test_phase4_intent_slots.py tests/test_inner_agora_ask_flow.py
git commit -m "Add context-aware Agora dialogue"
```

---

### Task 4: Explicit Last-Session Follow-Up Heuristic

**Files:**
- Modify: `scripts/intent-slots.mjs`
- Modify: `scripts/agora.mjs`
- Modify: `tests/test_phase4_intent_slots.py`

- [ ] **Step 1: Write failing heuristic tests**

Add tests:

```python
def test_implicit_follow_up_uses_fresh_last_synthesis_state(self):
    with tempfile.TemporaryDirectory() as temp_dir:
        state_path = Path(temp_dir) / "state.json"
        state_path.write_text(json.dumps({"lastRootIssueRef": "THE-900", "lastSynthesisRef": "THE-999", "lastIssueSeenAt": "2026-07-02T09:00:00.000Z"}), encoding="utf-8")
        env = {**os.environ, "INNER_AGORA_STATE_PATH": str(state_path)}
        result = self.run_node(
            ROOT / "scripts" / "agora.mjs",
            "natural", "--routing-mode", "regex", "--dry-run", "--json",
            "а если долг сильнее свободы?",
            env=env,
        )
    self.assertEqual(result.returncode, 0, result.stderr)
    payload = json.loads(result.stdout)
    self.assertEqual(payload["action"], "rewrite")
    self.assertTrue(payload["text"].startswith("/agora follow-up THE-900 "), payload)
    self.assertIn("новый вопрос", payload["plan"]["ack"].lower())
```

```python
def test_new_topic_marker_does_not_bind_to_last_session(self):
    with tempfile.TemporaryDirectory() as temp_dir:
        state_path = Path(temp_dir) / "state.json"
        state_path.write_text(json.dumps({"lastRootIssueRef": "THE-900", "lastSynthesisRef": "THE-999"}), encoding="utf-8")
        env = {**os.environ, "INNER_AGORA_STATE_PATH": str(state_path)}
        result = self.run_node(
            ROOT / "scripts" / "agora.mjs",
            "natural", "--routing-mode", "regex", "--dry-run", "--json",
            "новый вопрос: что такое дружба у Аристотеля",
            env=env,
        )
    payload = json.loads(result.stdout)
    self.assertTrue(payload["text"].startswith("/agora ask "), payload)
```

Expected before implementation: FAIL because only explicit follow-up markers bind to the last root.

- [ ] **Step 2: Implement freshness and ambiguity checks**

Add helpers:

```js
function naturalNewTopicRequested(text) {}
function lastSynthesisIsFresh(state, now = new Date()) {}
function naturalImplicitFollowUpRequested(text, state) {}
```

Rules:
- `lastRootIssueRef` and `lastSynthesisRef` must both exist.
- State must be fresh enough; default window is 24 hours, overridable with `INNER_AGORA_FOLLOWUP_WINDOW_HOURS`.
- Status/result/help/task lookup/new-topic markers never bind implicitly.
- `context.implicitFollowUp` changes `ack` to say it is continuing the previous session and the user can write "новый вопрос: ..." to start fresh.

- [ ] **Step 3: Verify and commit**

Run:

```bash
python3 -m unittest tests.test_phase4_intent_slots
git add scripts/intent-slots.mjs scripts/agora.mjs tests/test_phase4_intent_slots.py
git commit -m "Add explicit last-session follow-up heuristic"
```

---

### Task 5: Final Phase 4 Audit

**Files:**
- Modify: `docs/roadmap/TASKS.md`
- Modify: `docs/roadmap/IMPLEMENTATION_PLAN.md`

- [ ] **Step 1: Update roadmap evidence**

Update Phase 4 status to list:
- `T4.7` smart `/start`: dynamic chambers, config-driven rewrite.
- `T4.8` text wizard: topic -> chamber -> depth -> confirmation through natural Telegram rewrites.
- `T4.12` `dialogueWithContext()`: role-specific child with synthesis digest.
- `T4.13` explicit last-session binding: fresh synthesis, visible ack, "новый вопрос" escape hatch.
- Verification commands and local-model fixture score.

- [ ] **Step 2: Run full verification**

Run:

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
node scripts/regression.mjs check
CHAMBER_MODE=chambers node scripts/regression.mjs check
ROUTING_MODE=llm INNER_AGORA_LLM_MODEL=gemma-4-26b-a4b-it-mlx node scripts/intent-slots.mjs fixture-20 --json
```

Expected:
- Python tests pass.
- Both regression modes pass.
- Local model fixture has at least `semanticCorrectRate >= 0.8`; current target model should remain 20/20 with guardrail fallback allowed.

- [ ] **Step 3: Commit**

Run:

```bash
git add docs/roadmap/TASKS.md docs/roadmap/IMPLEMENTATION_PLAN.md
git commit -m "Document completed Phase 4"
```

Only after this task is green should the active Codex goal be marked complete.
