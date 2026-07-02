# Phase 2 Chambers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn The Inner Agora from one hardcoded philosophy roster into a chamber-based platform where philosophy and board-directors chambers can run from configuration without duplicating `agora.mjs`.

**Architecture:** Add `chamber.json` manifests under `chambers/<id>/`, load chambers through one `scripts/chamber-loader.mjs`, and gradually route `agora.mjs`/cockpit config through the active chamber. Keep the philosophy chamber behavior identical while adding board-directors as the first second chamber.

**Tech Stack:** Node.js ESM scripts, JSON Schema draft 2020-12 artifacts, Python `unittest`, existing `scripts/regression.mjs`, Paperclip cockpit JSON config.

---

## Scope Boundary

Phase 1 T1.6 is still under soak until `2026-07-09T09:01:09Z`. Phase 2 work may proceed on top of `chambers/philosophy/roles.json`, but must not remove the Phase 1 legacy loader before T1.6 eligibility.

Phase 2.6b content polishing is explicitly non-blocking for the code MVP. The board-directors chamber starts with honest draft roles and must be marked as draft in `chamber.json`.

## Files

- Create: `data/schema/chamber.schema.json`
- Create: `scripts/chamber-loader.mjs`
- Create: `tests/test_phase2_chambers.py`
- Create: `chambers/philosophy/chamber.json`
- Create: `cockpit.core.json`
- Create: `chambers/philosophy/cockpit.overrides.json`
- Create: `chambers/board-directors/chamber.json`
- Create: `chambers/board-directors/roles.json`
- Create: `chambers/board-directors/presets/mvp.json`
- Create: `chambers/board-directors/cockpit.overrides.json`
- Modify: `scripts/agora.mjs`
- Modify: `scripts/import-inner-agora.mjs`
- Modify: `scripts/regression.mjs`
- Modify: `paperclip-cockpit.json`
- Verify: `node scripts/regression.mjs check`

---

### Task 1: Chamber Manifest Schema And Philosophy Manifest

**Files:**
- Create: `data/schema/chamber.schema.json`
- Create: `chambers/philosophy/chamber.json`
- Test: `tests/test_phase2_chambers.py`

- [x] **Step 1: Write failing schema tests**

Add `Phase2ChamberTests.test_chamber_schema_contract`:

```python
def test_chamber_schema_contract(self):
    schema = json.loads(CHAMBER_SCHEMA.read_text(encoding="utf-8"))
    self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
    required = set(schema["required"])
    for field in ["id", "name", "labels", "roles", "presets", "synthesisRole", "transparencyPolicy", "allowedSkills", "company"]:
        self.assertIn(field, required)
    self.assertIn("agent", schema["properties"]["labels"]["required"])
    self.assertIn("agents", schema["properties"]["labels"]["required"])
    self.assertIn("companyId", schema["properties"]["company"]["required"])
```

Run: `python3 -m unittest tests.test_phase2_chambers.Phase2ChamberTests.test_chamber_schema_contract`

Expected before implementation: FAIL because `data/schema/chamber.schema.json` does not exist.

- [x] **Step 2: Create schema**

Create `data/schema/chamber.schema.json` with required manifest fields:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Inner Agora Chamber Manifest",
  "type": "object",
  "additionalProperties": false,
  "required": ["id", "name", "description", "status", "labels", "roles", "presets", "synthesisRole", "transparencyPolicy", "allowedSkills", "company"],
  "properties": {
    "id": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]*$" },
    "name": { "type": "string", "minLength": 1 },
    "description": { "type": "string", "minLength": 1 },
    "status": { "enum": ["active", "draft", "disabled"] },
    "labels": {
      "type": "object",
      "additionalProperties": false,
      "required": ["company", "companies", "agent", "agents", "task", "tasks"],
      "properties": {
        "company": { "type": "string" },
        "companies": { "type": "string" },
        "agent": { "type": "string" },
        "agents": { "type": "string" },
        "task": { "type": "string" },
        "tasks": { "type": "string" }
      }
    },
    "roles": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
    "presets": { "type": "array", "items": { "type": "string" } },
    "synthesisRole": { "type": "string", "minLength": 1 },
    "transparencyPolicy": { "type": "string", "minLength": 1 },
    "allowedSkills": { "type": "array", "items": { "type": "string" } },
    "company": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name", "projectName", "goalTitle", "companyId"],
      "properties": {
        "name": { "type": "string", "minLength": 1 },
        "projectName": { "type": "string", "minLength": 1 },
        "goalTitle": { "type": "string", "minLength": 1 },
        "companyId": { "type": ["string", "null"] }
      }
    }
  }
}
```

- [x] **Step 3: Create philosophy manifest**

Create `chambers/philosophy/chamber.json`:

```json
{
  "id": "philosophy",
  "name": "The Inner Agora",
  "description": "Философская палата для исследования, диалога и спора.",
  "status": "active",
  "labels": {
    "company": "agora",
    "companies": "agoras",
    "agent": "philosopher",
    "agents": "philosophers",
    "task": "session",
    "tasks": "sessions"
  },
  "roles": ["roles.json"],
  "presets": ["presets/mvp.json"],
  "synthesisRole": "agora-assistant",
  "transparencyPolicy": "philosophical-source-reconstruction",
  "allowedSkills": [],
  "company": {
    "name": "The Inner Agora",
    "projectName": "Agora Sessions",
    "goalTitle": "Run philosophical research dialogues with The Inner Agora",
    "companyId": null
  }
}
```

- [x] **Step 4: Verify schema with ajv**

Run:

```bash
npx --yes ajv-cli@5 validate -s data/schema/chamber.schema.json -d chambers/philosophy/chamber.json --spec=draft2020
```

Expected: `chambers/philosophy/chamber.json valid`.

---

### Task 2: Chamber Loader And Deep Merge

**Files:**
- Create: `scripts/chamber-loader.mjs`
- Test: `tests/test_phase2_chambers.py`

- [x] **Step 1: Write failing loader tests**

Add tests:

```python
def test_chamber_loader_lists_philosophy(self):
    result = self.run_node(CHAMBER_LOADER, "list", "--json")
    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
    payload = json.loads(result.stdout)
    self.assertIn("philosophy", [item["id"] for item in payload["chambers"]])

def test_chamber_loader_rejects_manifest_missing_required_field(self):
    with tempfile.TemporaryDirectory() as temp_dir:
        chamber_dir = Path(temp_dir) / "broken"
        chamber_dir.mkdir()
        (chamber_dir / "chamber.json").write_text(json.dumps({"id": "broken"}), encoding="utf-8")
        result = self.run_node(CHAMBER_LOADER, "validate", "--chambers-dir", temp_dir)
    self.assertNotEqual(result.returncode, 0)
    self.assertIn("missing required field", result.stderr)

def test_chamber_loader_deep_merge_replaces_arrays(self):
    result = self.run_node(CHAMBER_LOADER, "merge-fixture", "--json")
    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
    payload = json.loads(result.stdout)
    self.assertEqual(payload["allowedSkills"], ["source-citation"])
    self.assertEqual(payload["labels"]["agent"], "director")
```

Run: `python3 -m unittest tests.test_phase2_chambers`

Expected before implementation: FAIL because `scripts/chamber-loader.mjs` does not exist.

- [x] **Step 2: Implement loader**

Implement commands:

```bash
node scripts/chamber-loader.mjs list [--json]
node scripts/chamber-loader.mjs validate [--chambers-dir DIR]
node scripts/chamber-loader.mjs show philosophy [--json]
node scripts/chamber-loader.mjs merge-fixture --json
```

Exported helpers:

```js
export function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) return structuredClone(override);
  if (isPlainObject(base) && isPlainObject(override)) {
    const next = { ...base };
    for (const [key, value] of Object.entries(override)) {
      next[key] = key in next ? deepMerge(next[key], value) : structuredClone(value);
    }
    return next;
  }
  return structuredClone(override);
}
```

Array policy: overrides replace arrays. This is deliberate because config arrays like `allowedSkills`, aliases, and callback buttons should not silently concatenate.

- [x] **Step 3: Verify loader tests**

Run: `python3 -m unittest tests.test_phase2_chambers`

Expected: OK.

---

### Task 3: Cockpit Core And Philosophy Overrides

**Files:**
- Create: `cockpit.core.json`
- Create: `chambers/philosophy/cockpit.overrides.json`
- Modify: `paperclip-cockpit.json`
- Modify: `scripts/chamber-loader.mjs`
- Test: `tests/test_phase2_chambers.py`

- [ ] **Step 1: Write failing config parity test**

Add:

```python
def test_merged_philosophy_cockpit_matches_current_config(self):
    result = self.run_node(CHAMBER_LOADER, "cockpit", "philosophy", "--json")
    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
    merged = json.loads(result.stdout)
    current = json.loads((ROOT / "paperclip-cockpit.json").read_text(encoding="utf-8"))
    self.assertEqual(merged, current)
```

Expected before split: FAIL because loader has no `cockpit` command.

- [ ] **Step 2: Split config**

Move shared sections to `cockpit.core.json`:
- `command`
- `gateway`
- `hooks`
- `monitor`
- `issue`
- `telegram`
- `notifications`
- generic defaults that are not chamber labels

Move philosophy-specific sections to `chambers/philosophy/cockpit.overrides.json`:
- `agora`
- `language`
- `company_hints`
- `presentation`
- `labels`
- `terms`
- `aliases`
- `markers`
- `intents`

Keep `paperclip-cockpit.json` as the merged effective config for current Hermes compatibility.

- [ ] **Step 3: Add generator/check**

Add loader command:

```bash
node scripts/chamber-loader.mjs cockpit philosophy --json
node scripts/chamber-loader.mjs cockpit philosophy --write paperclip-cockpit.json
```

Run:

```bash
node scripts/chamber-loader.mjs cockpit philosophy --write paperclip-cockpit.json
```

Expected: no semantic diff versus the current config.

---

### Task 4: Chamber Commands In Agora

**Files:**
- Modify: `scripts/agora.mjs`
- Test: `tests/test_phase2_chambers.py`
- Verify: `scripts/regression.mjs`

- [ ] **Step 1: Write failing chamber command tests**

Add:

```python
def test_agora_chamber_list_shows_philosophy(self):
    result = self.run_node(AGORA_SCRIPT, "chamber", "list")
    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
    self.assertIn("philosophy", result.stdout)

def test_agora_chamber_use_persists_active_chamber(self):
    with tempfile.TemporaryDirectory() as temp_dir:
        state = Path(temp_dir) / "state.json"
        result = self.run_node(AGORA_SCRIPT, "chamber", "use", "philosophy", env={"INNER_AGORA_STATE_PATH": str(state)})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(state.read_text(encoding="utf-8"))
        self.assertEqual(payload["activeChamberId"], "philosophy")
```

Expected before implementation: FAIL because `agora.mjs chamber` is unknown.

- [ ] **Step 2: Implement `chamber` command**

Add:

```bash
node scripts/agora.mjs chamber list
node scripts/agora.mjs chamber use <id>
node scripts/agora.mjs chamber current
```

State field: `activeChamberId`.

Default active chamber: `philosophy`.

- [ ] **Step 3: Update status output**

`node scripts/agora.mjs status` should include active chamber in human-readable output when state is available.

---

### Task 5: Deterministic Company Selection From Chamber Manifest

**Files:**
- Modify: `scripts/agora.mjs`
- Modify: `scripts/import-inner-agora.mjs`
- Test: `tests/test_phase2_chambers.py`

- [ ] **Step 1: Write failing tests**

Add tests that prove `getAgora()` and importer can read chamber company settings from `chamber.json` through environment-controlled state.

- [ ] **Step 2: Implement manifest-backed company config**

Use:

```js
const chamber = loadActiveChamber(readState());
const companyName = process.env.INNER_AGORA_COMPANY_NAME || chamber.company.name;
const projectName = process.env.INNER_AGORA_PROJECT_NAME || chamber.company.projectName;
const goalTitle = process.env.INNER_AGORA_GOAL_TITLE || chamber.company.goalTitle;
```

`company.companyId` remains optional until a real Paperclip ID is stored in Phase 2.5.

---

### Task 6: Board Directors Chamber Skeleton

**Files:**
- Create: `chambers/board-directors/chamber.json`
- Create: `chambers/board-directors/roles.json`
- Create: `chambers/board-directors/presets/mvp.json`
- Create: `chambers/board-directors/cockpit.overrides.json`
- Modify: `scripts/agora.mjs`
- Test: `tests/test_phase2_chambers.py`

- [ ] **Step 1: Write failing board chamber tests**

Add:

```python
def test_chamber_loader_lists_board_directors(self):
    result = self.run_node(CHAMBER_LOADER, "list", "--json")
    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
    payload = json.loads(result.stdout)
    self.assertIn("board-directors", [item["id"] for item in payload["chambers"]])

def test_board_directors_roles_are_draft_but_valid(self):
    roles = json.loads((ROOT / "chambers" / "board-directors" / "roles.json").read_text(encoding="utf-8"))
    self.assertGreaterEqual(len(roles), 3)
    self.assertTrue(all(role["chamberId"] == "board-directors" for role in roles))
```

- [ ] **Step 2: Create draft roles**

Initial roles:
- `ceo`
- `cfo`
- `legal`
- `product`
- `people`

Each role must include the Phase 1 role fields and `"riskTier": "advisory"`.

- [ ] **Step 3: Make dry-run ask work in board chamber**

Add enough selection/preset routing that this command works without Paperclip:

```bash
INNER_AGORA_ACTIVE_CHAMBER=board-directors node scripts/agora.mjs ask --dry-run "go/no-go по найму CTO"
```

Expected: selected voices are board roles, not philosophers.

---

### Task 7: Regression For Both Chambers

**Files:**
- Modify: `scripts/regression.mjs`
- Create: `tests/fixtures/baseline/board-directors-ask-dry-run.json`

- [ ] **Step 1: Add regression command**

Add a dry-run command with `INNER_AGORA_ACTIVE_CHAMBER=board-directors`:

```json
{
  "name": "board-directors-ask-dry-run",
  "env": { "INNER_AGORA_ACTIVE_CHAMBER": "board-directors" },
  "args": ["node", "scripts/agora.mjs", "ask", "--dry-run", "go/no-go по найму CTO"]
}
```

- [ ] **Step 2: Record and verify**

Run:

```bash
node scripts/regression.mjs record
node scripts/regression.mjs check
```

Expected: both philosophy and board-directors baselines pass.

---

### Task 8: Phase Verification And Commits

**Files:**
- Verify all changed files

- [ ] **Step 1: Run tests**

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
```

Expected: OK.

- [ ] **Step 2: Run regression**

```bash
node scripts/regression.mjs check
CHAMBER_MODE=chambers node scripts/regression.mjs check
```

Expected: OK.

- [ ] **Step 3: Validate JSON schemas**

```bash
npx --yes ajv-cli@5 validate -s data/schema/chamber.schema.json -d chambers/philosophy/chamber.json --spec=draft2020
npx --yes ajv-cli@5 validate -s data/schema/chamber.schema.json -d chambers/board-directors/chamber.json --spec=draft2020
```

Expected: both valid.

- [ ] **Step 4: Syntax and whitespace checks**

```bash
node --check scripts/agora.mjs
node --check scripts/import-inner-agora.mjs
node --check scripts/chamber-loader.mjs
git diff --check
```

Expected: all clean.

- [ ] **Step 5: Commit in slices**

Commit slices:

```bash
git commit -m "Add chamber manifest schema and loader"
git commit -m "Split cockpit config by chamber"
git commit -m "Add chamber commands and board directors skeleton"
git commit -m "Add multi-chamber regression coverage"
```
