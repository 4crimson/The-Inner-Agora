# Phase 5 Model Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement configurable model/adapter routing for The Inner Agora so model names and route decisions live in `models.config.json`, not scattered `.mjs` literals.

**Architecture:** Add a focused `scripts/model-routing.mjs` module that loads `models.config.json`, applies environment overrides, and exposes routing helpers. Existing scripts call that module: `setup-hermes-profile.mjs` for Hermes config, `intent-slots.mjs` for slot extraction, `import-inner-agora.mjs` for Paperclip agent adapters, and `agora.mjs` for request routing plus user-visible adapter metadata. Keep adapter implementations unchanged; Phase 5 only chooses among existing adapters.

**Tech Stack:** Node.js ESM, Python `unittest`, JSON config, existing Paperclip mock HTTP tests, existing regression harness.

---

## Files

- Create: `models.config.json`
- Create: `scripts/model-routing.mjs`
- Create: `tests/test_phase5_model_routing.py`
- Modify: `scripts/agora.mjs`
- Modify: `scripts/setup-hermes-profile.mjs`
- Modify: `scripts/import-inner-agora.mjs`
- Modify: `scripts/intent-slots.mjs`
- Modify: `scripts/inner-agora-guard.mjs`
- Modify: `tests/test_inner_agora_mode.py`
- Modify: `tests/test_inner_agora_ask_flow.py`
- Modify: `tests/fixtures/baseline/mode-get.json`
- Modify: `docs/roadmap/TASKS.md`
- Modify: `docs/roadmap/IMPLEMENTATION_PLAN.md`

---

### Task 1: Config And Routing Module

**Files:**
- Create: `models.config.json`
- Create: `scripts/model-routing.mjs`
- Create: `tests/test_phase5_model_routing.py`

- [ ] **Step 1: Write failing config and route tests**

Create `tests/test_phase5_model_routing.py` with tests that run:

```python
node scripts/model-routing.mjs config --json
node scripts/model-routing.mjs route --json --mode local
node scripts/model-routing.mjs route --json --mode all --risk-tier high-stakes
node scripts/model-routing.mjs slot-extractor --json
```

Expected assertions:
- config has `schemaVersion == 1`;
- `mode local` routes to `hermes_local`;
- `mode all + high-stakes` routes to `codex_local` with reason `fullCouncilHighStakes`;
- `INNER_AGORA_HERMES_MODEL=override` changes the `hermes_local` model in JSON output;
- slot extractor config reads the default model from JSON and supports `INNER_AGORA_LLM_MODEL`.

Run:

```bash
python3 -m unittest tests.test_phase5_model_routing
```

Expected before implementation: FAIL because `scripts/model-routing.mjs` and `models.config.json` do not exist.

- [ ] **Step 2: Implement `models.config.json`**

Add root config:

```json
{
  "schemaVersion": 1,
  "slotExtractor": {
    "adapter": "lmstudio_slots",
    "model": "gemma-4-26b-a4b-it-mlx",
    "baseUrl": "http://127.0.0.1:1234/v1"
  },
  "adapters": {
    "hermes_local": {
      "type": "hermes_local",
      "model": "google/gemma-4-26b-a4b-qat",
      "baseUrl": "http://192.168.1.229:1234/v1",
      "reasoningEffort": "none"
    },
    "codex_local": {
      "type": "codex_local",
      "model": "gpt-5.4",
      "reasoningEffort": "medium"
    }
  },
  "routingRule": {
    "default": "codex_local",
    "localMode": "hermes_local",
    "shortDialogueSingleRole": "hermes_local",
    "fullCouncilHighStakes": "codex_local"
  }
}
```

- [ ] **Step 3: Implement `scripts/model-routing.mjs`**

Exports:

```js
export function loadModelsConfig(options = {}) {}
export function adapterForRequest(request = {}, options = {}) {}
export function adapterEnv(route) {}
export function slotExtractorConfig(options = {}) {}
export function hermesProfileConfig(options = {}) {}
export function codexAdapterConfig(options = {}) {}
export function hermesAdapterConfig(options = {}) {}
```

CLI commands:

```bash
node scripts/model-routing.mjs config --json
node scripts/model-routing.mjs route --json --mode all --risk-tier high-stakes
node scripts/model-routing.mjs slot-extractor --json
node scripts/model-routing.mjs hermes-profile --json
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
python3 -m unittest tests.test_phase5_model_routing
node --check scripts/model-routing.mjs
git add models.config.json scripts/model-routing.mjs tests/test_phase5_model_routing.py
git commit -m "Add configurable model routing"
```

---

### Task 2: Replace Hard-Coded Model Literals

**Files:**
- Modify: `scripts/setup-hermes-profile.mjs`
- Modify: `scripts/import-inner-agora.mjs`
- Modify: `scripts/intent-slots.mjs`
- Modify: `scripts/inner-agora-guard.mjs`
- Modify: `tests/test_phase5_model_routing.py`

- [ ] **Step 1: Write failing integration tests**

Extend `tests/test_phase5_model_routing.py`:

```python
def test_setup_profile_uses_models_config(self):
    # Run setup with HERMES_HOME in a temp dir and INNER_AGORA_MODELS_CONFIG
    # pointing to a temp config whose hermes_local.model is "test/local-model".
    # Assert generated config.yaml contains "test/local-model".

def test_no_gemma_literal_remains_in_mjs_files(self):
    result = subprocess.run(
        ["git", "grep", "gemma-4-26b", "--", "*.mjs"],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    self.assertNotEqual(result.returncode, 0, result.stdout)
```

Run:

```bash
python3 -m unittest tests.test_phase5_model_routing
```

Expected before implementation: FAIL because model literals remain in `.mjs` files.

- [ ] **Step 2: Wire scripts to `model-routing.mjs`**

Changes:
- `setup-hermes-profile.mjs` imports `hermesProfileConfig()` and uses its model/base URL.
- `import-inner-agora.mjs` imports `codexAdapterConfig()` and `hermesAdapterConfig()`.
- `intent-slots.mjs` imports `slotExtractorConfig()` and uses it in `callLocalModel()`.
- `inner-agora-guard.mjs` imports `hermesProfileConfig()` for expected model.

Keep all existing env overrides working.

- [ ] **Step 3: Verify and commit**

Run:

```bash
python3 -m unittest tests.test_phase5_model_routing tests.test_phase4_intent_slots
git grep "gemma-4-26b" -- "*.mjs"; test $? -eq 1
node --check scripts/setup-hermes-profile.mjs scripts/import-inner-agora.mjs scripts/intent-slots.mjs scripts/inner-agora-guard.mjs
git add scripts/setup-hermes-profile.mjs scripts/import-inner-agora.mjs scripts/intent-slots.mjs scripts/inner-agora-guard.mjs tests/test_phase5_model_routing.py
git commit -m "Read model defaults from config"
```

---

### Task 3: Agora Request Routing

**Files:**
- Modify: `scripts/agora.mjs`
- Modify: `tests/test_inner_agora_mode.py`
- Modify: `tests/fixtures/baseline/mode-get.json`
- Modify: `tests/test_phase5_model_routing.py`

- [ ] **Step 1: Write failing Agora routing tests**

Add tests:

```python
def test_mode_get_prints_configured_adapter_and_model(self):
    # temp models config: codex_local.model = "test/codex"
    # node scripts/agora.mjs mode get
    # assert adapter=codex_local and model=test/codex

def test_high_stakes_all_route_prefers_safe_default(self):
    # node scripts/model-routing.mjs route --mode all --risk-tier high-stakes
    # assert name codex_local, reason fullCouncilHighStakes
```

Run:

```bash
python3 -m unittest tests.test_inner_agora_mode tests.test_phase5_model_routing
```

Expected before implementation: FAIL because `agora.mjs` still uses `adapterForMode()`.

- [ ] **Step 2: Replace `adapterForMode()`**

In `agora.mjs`:
- import `adapterForRequest`, `adapterEnv`, and risk helpers;
- replace `adapterForMode(mode)` with `routeForMode(mode, options)`;
- `printMode()` prints `adapter=<name>`, `model=<model>`, and `reason=<routing reason>`;
- `prepare()` passes `adapterEnv(route)`;
- `ask()` computes selected-role risk and stores route metadata.

- [ ] **Step 3: Update regression baseline**

Run:

```bash
node scripts/regression.mjs record --name mode-get
```

If the harness does not support single-name recording, update `tests/fixtures/baseline/mode-get.json` manually after inspecting `node scripts/agora.mjs mode get`.

- [ ] **Step 4: Verify and commit**

Run:

```bash
python3 -m unittest tests.test_inner_agora_mode tests.test_phase5_model_routing
node scripts/regression.mjs check
git add scripts/agora.mjs tests/test_inner_agora_mode.py tests/test_phase5_model_routing.py tests/fixtures/baseline/mode-get.json
git commit -m "Route Agora requests through model config"
```

---

### Task 4: Adapter Metadata In State, Comments, Status, Latest

**Files:**
- Modify: `scripts/agora.mjs`
- Modify: `tests/test_inner_agora_ask_flow.py`

- [ ] **Step 1: Write failing metadata tests**

Extend `tests/test_inner_agora_ask_flow.py`:

```python
def test_ask_records_adapter_metadata_in_state_and_comment(self):
    # Run ask against mock Paperclip.
    # Assert state has lastAdapterName/model/reason.
    # Assert root comment contains "Adapter:".

def test_latest_prints_adapter_metadata_from_root(self):
    # Mock root metadata or comment with adapter metadata.
    # Assert latest output includes adapter line.
```

Run:

```bash
python3 -m unittest tests.test_inner_agora_ask_flow
```

Expected before implementation: FAIL because comments/status/latest do not show adapter metadata.

- [ ] **Step 2: Implement metadata helpers**

In `agora.mjs` add helpers:

```js
function adapterStatePatch(route) {}
function adapterCommentLine(route) {}
function printAdapterState(state) {}
function rootAdapterMetadata(issue) {}
```

`ask()`, `followUp()`, `dialogue()`, and `dialogueWithContext()` call these helpers when they create durable work.

- [ ] **Step 3: Verify and commit**

Run:

```bash
python3 -m unittest tests.test_inner_agora_ask_flow tests.test_inner_agora_mode
git add scripts/agora.mjs tests/test_inner_agora_ask_flow.py
git commit -m "Expose Agora adapter metadata"
```

---

### Task 5: Final Phase 5 Verification

**Files:**
- Modify: `docs/roadmap/TASKS.md`
- Modify: `docs/roadmap/IMPLEMENTATION_PLAN.md`

- [x] **Step 1: Update roadmap evidence**

Document:
- `models.config.json` as source of truth;
- no model literals in `.mjs`;
- request routing and high-stakes full council rule;
- state/comment/status/latest adapter metadata;
- verification commands.

- [x] **Step 2: Run full verification**

Run:

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
node scripts/regression.mjs check
CHAMBER_MODE=chambers node scripts/regression.mjs check
ROUTING_MODE=llm INNER_AGORA_LLM_MODEL=gemma-4-26b-a4b-it-mlx node scripts/intent-slots.mjs fixture-20 --json
git grep "gemma-4-26b" -- "*.mjs"; test $? -eq 1
```

Expected: all tests and regressions pass; live local slot fixture remains semantically correct; grep finds no `.mjs` model literals.

- [x] **Step 3: Commit and close goal only after evidence passes**

Run:

```bash
git add docs/roadmap/TASKS.md docs/roadmap/IMPLEMENTATION_PLAN.md
git commit -m "Document completed Phase 5"
```
