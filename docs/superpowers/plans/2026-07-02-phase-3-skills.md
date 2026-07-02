# Phase 3 Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add skills as a reusable layer between chambers and roles: manifests, starter skill docs, deterministic role/chamber resolution, source-citation reuse, and risk-tier gates.

**Architecture:** Skills live in `skills/<skill-id>/` with `skill.json` metadata and `SKILL.md` prompt text. `scripts/skill-loader.mjs` validates and resolves skills using the two-key rule: a role must request the skill and the active chamber must allow it. `agora.mjs` and `import-inner-agora.mjs` use the loader for prompt text and diagnostics while preserving existing Phase 1/2 behavior.

**Tech Stack:** Node.js ESM scripts, JSON Schema draft 2020-12, Python `unittest`, existing regression harness.

---

## Scope Boundary

Phase 3 does not implement the Phase 4 natural-language assistant or Telegram wizard. It only defines the reusable skill layer and deterministic checks that later phases can call. No skill may silently grant tools because a prompt asks for them.

Risk tiers:
- `L0`: prompt-only guidance, no tool access.
- `L1`: low-risk deterministic or read-only tooling.
- `L2`: stateful or external-impact tooling; requires explicit role and chamber allow-list.
- `L3`: high-stakes or privileged tooling; defined by schema but not enabled by starter skills.

The resolver uses the same two-key rule for every tier. For `L2` and `L3`, missing either key is reported as an error diagnostic instead of a warning diagnostic.

## Files

- Create: `data/schema/skill.schema.json`
- Create: `scripts/skill-loader.mjs`
- Create: `tests/test_phase3_skills.py`
- Create: `skills/web-research/skill.json`
- Create: `skills/web-research/SKILL.md`
- Create: `skills/source-citation/skill.json`
- Create: `skills/source-citation/SKILL.md`
- Create: `skills/memory-export/skill.json`
- Create: `skills/memory-export/SKILL.md`
- Modify: `data/schema/role.schema.json`
- Modify: `data/schema/chamber.schema.json`
- Modify: `chambers/philosophy/chamber.json`
- Modify: `chambers/board-directors/chamber.json`
- Modify: `chambers/board-directors/roles.json`
- Modify: `scripts/agora.mjs`
- Modify: `scripts/import-inner-agora.mjs`
- Modify: `scripts/regression.mjs`
- Verify: `node scripts/regression.mjs check`

---

### Task 1: Skill Schema And Loader

**Files:**
- Create: `data/schema/skill.schema.json`
- Create: `scripts/skill-loader.mjs`
- Create: `tests/test_phase3_skills.py`

- [x] **Step 1: Write failing schema and loader tests**

Add `tests/test_phase3_skills.py` with tests:

```python
def test_skill_schema_contract(self):
    schema = json.loads(SKILL_SCHEMA.read_text(encoding="utf-8"))
    self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
    for field in ["id", "name", "description", "riskTier", "allowedTools"]:
        self.assertIn(field, schema["required"])
    self.assertEqual(schema["properties"]["riskTier"]["enum"], ["L0", "L1", "L2", "L3"])

def test_skill_loader_rejects_manifest_missing_required_field(self):
    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "broken"
        skill_dir.mkdir()
        (skill_dir / "skill.json").write_text(json.dumps({"id": "broken"}), encoding="utf-8")
        result = self.run_node(SKILL_LOADER, "validate", "--skills-dir", temp_dir)
    self.assertNotEqual(result.returncode, 0)
    self.assertIn("missing required field", result.stderr)
    self.assertIn("riskTier", result.stderr)

def test_resolve_skills_filters_disallowed_skill_with_warning(self):
    result = self.run_node(SKILL_LOADER, "resolve-fixture", "--json")
    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
    payload = json.loads(result.stdout)
    self.assertEqual([item["id"] for item in payload["skills"]], ["source-citation"])
    self.assertIn("not allowed by chamber", payload["diagnostics"][0]["message"])
```

Run:

```bash
python3 -m unittest tests.test_phase3_skills
```

Expected before implementation: FAIL because `data/schema/skill.schema.json` and `scripts/skill-loader.mjs` do not exist.

- [x] **Step 2: Create skill schema**

Create `data/schema/skill.schema.json` with:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://inner-agora.local/schema/skill.schema.json",
  "title": "Inner Agora Skill Manifest",
  "type": "object",
  "additionalProperties": false,
  "required": ["id", "name", "description", "riskTier", "allowedTools"],
  "properties": {
    "id": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]*$" },
    "name": { "type": "string", "minLength": 1 },
    "description": { "type": "string", "minLength": 1 },
    "riskTier": { "type": "string", "enum": ["L0", "L1", "L2", "L3"] },
    "allowedTools": {
      "type": "array",
      "items": { "type": "string", "minLength": 1 },
      "uniqueItems": true
    },
    "promptFile": { "type": "string", "minLength": 1 }
  }
}
```

- [x] **Step 3: Implement loader commands and exports**

Implement `scripts/skill-loader.mjs` with commands:

```bash
node scripts/skill-loader.mjs list [--json] [--skills-dir DIR]
node scripts/skill-loader.mjs validate [--skills-dir DIR]
node scripts/skill-loader.mjs show <id> [--json] [--skills-dir DIR]
node scripts/skill-loader.mjs prompt <id> [--json] [--skills-dir DIR]
node scripts/skill-loader.mjs resolve-fixture --json
```

Exports:

```js
export function validateSkillManifest(skill, context = "skill.json") {}
export function loadSkill(skillsDir, id) {}
export function listSkills(skillsDir = DEFAULT_SKILLS_DIR) {}
export function loadSkillPrompt(skillsDir, id) {}
export function resolveSkillsForRole(role, chamber, options = {}) {}
```

`resolveSkillsForRole()` returns:

```js
{
  skills: [{ id, name, riskTier, allowedTools, prompt }],
  diagnostics: [{ level: "warning" | "error", code, message }]
}
```

Resolver rules:
- Missing `role.skills` means no skills.
- Requested skill not listed in `chamber.allowedSkills` is skipped.
- Missing installed skill is skipped.
- `L2`/`L3` missing chamber allow-list is an `error`; `L0`/`L1` missing chamber allow-list is a `warning`.

- [x] **Step 4: Verify Task 1**

Run:

```bash
python3 -m unittest tests.test_phase3_skills
node --check scripts/skill-loader.mjs
```

Expected: OK.

Commit:

```bash
git add data/schema/skill.schema.json scripts/skill-loader.mjs tests/test_phase3_skills.py docs/superpowers/plans/2026-07-02-phase-3-skills.md
git commit -m "Add skill manifest schema and loader"
```

---

### Task 2: Starter Skills And Manifest Validation

**Files:**
- Create: `skills/web-research/skill.json`
- Create: `skills/web-research/SKILL.md`
- Create: `skills/source-citation/skill.json`
- Create: `skills/source-citation/SKILL.md`
- Create: `skills/memory-export/skill.json`
- Create: `skills/memory-export/SKILL.md`
- Test: `tests/test_phase3_skills.py`

- [x] **Step 1: Write failing starter skill tests**

Add tests:

```python
def test_skill_loader_lists_starter_skills(self):
    result = self.run_node(SKILL_LOADER, "list", "--json")
    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
    payload = json.loads(result.stdout)
    self.assertEqual(
        sorted(item["id"] for item in payload["skills"]),
        ["memory-export", "source-citation", "web-research"],
    )

def test_source_citation_prompt_exposes_transparency_policy(self):
    result = self.run_node(SKILL_LOADER, "prompt", "source-citation", "--json")
    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
    payload = json.loads(result.stdout)
    self.assertIn("Протокол прозрачности", payload["prompt"])
    self.assertIn("[источник]", payload["prompt"])
```

Run:

```bash
python3 -m unittest tests.test_phase3_skills
```

Expected before implementation: FAIL because starter skills do not exist.

- [x] **Step 2: Create starter manifests**

Use these risk tiers:
- `web-research`: `L1`, `allowedTools`: `["web-search", "web-open"]`
- `source-citation`: `L0`, `allowedTools`: `[]`
- `memory-export`: `L1`, `allowedTools`: `["paperclip-api", "filesystem-write"]`

- [x] **Step 3: Create starter SKILL.md files**

Each `SKILL.md` must contain a prompt block:

```markdown
<!-- INNER_AGORA_SKILL_PROMPT_START -->
...
<!-- INNER_AGORA_SKILL_PROMPT_END -->
```

`source-citation` prompt block must contain the current transparency protocol text.

- [x] **Step 4: Verify starter skills**

Run:

```bash
python3 -m unittest tests.test_phase3_skills
npx --yes ajv-cli@5 validate -s data/schema/skill.schema.json -d "skills/*/skill.json" --spec=draft2020
```

Expected: OK and all starter manifests valid.

Commit:

```bash
git add skills tests/test_phase3_skills.py
git commit -m "Add starter skill manifests"
```

---

### Task 3: Role Skills And Risk Gates

**Files:**
- Modify: `data/schema/role.schema.json`
- Modify: `chambers/philosophy/chamber.json`
- Modify: `chambers/board-directors/chamber.json`
- Modify: `chambers/board-directors/roles.json`
- Test: `tests/test_phase3_skills.py`

- [x] **Step 1: Write failing role/chamber tests**

Add tests:

```python
def test_role_schema_allows_skills_array(self):
    schema = json.loads(ROLE_SCHEMA.read_text(encoding="utf-8"))
    self.assertIn("skills", schema["properties"])
    self.assertEqual(schema["properties"]["skills"]["items"]["type"], "string")

def test_board_product_role_requests_web_research(self):
    roles = json.loads(BOARD_ROLES.read_text(encoding="utf-8"))
    product = next(role for role in roles if role["key"] == "product")
    self.assertIn("web-research", product["skills"])

def test_l2_skill_missing_chamber_allowlist_is_error(self):
    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "external-write"
        skill_dir.mkdir()
        (skill_dir / "skill.json").write_text(json.dumps({
            "id": "external-write",
            "name": "External Write",
            "description": "Test L2 skill.",
            "riskTier": "L2",
            "allowedTools": ["external-write"]
        }), encoding="utf-8")
        (skill_dir / "SKILL.md").write_text("write", encoding="utf-8")
        result = self.run_node(SKILL_LOADER, "resolve-fixture", "--json", "--skills-dir", temp_dir, "--risk-fixture")
    payload = json.loads(result.stdout)
    self.assertEqual(payload["skills"], [])
    self.assertEqual(payload["diagnostics"][0]["level"], "error")
```

- [x] **Step 2: Extend role schema**

Add optional `skills` property:

```json
"skills": {
  "type": "array",
  "items": {
    "type": "string",
    "pattern": "^[a-z0-9][a-z0-9-]*$"
  },
  "uniqueItems": true
}
```

- [x] **Step 3: Set chamber allow-lists and role skills**

Set:
- `chambers/philosophy/chamber.json.allowedSkills`: `["source-citation", "memory-export"]`
- `chambers/board-directors/chamber.json.allowedSkills`: `["source-citation", "web-research", "memory-export"]`

Add to board roles:
- `ceo.skills`: `["source-citation", "memory-export"]`
- `cfo.skills`: `["source-citation"]`
- `legal.skills`: `["source-citation"]`
- `product.skills`: `["source-citation", "web-research"]`
- `people.skills`: `["source-citation"]`

- [x] **Step 4: Verify role schemas and risk gates**

Run:

```bash
python3 -m unittest tests.test_phase3_skills
python3 -m unittest tests.test_phase1_roles tests.test_phase2_chambers tests.test_phase3_skills
```

Expected: OK and role files valid.

Commit:

```bash
git add data/schema/role.schema.json chambers/philosophy/chamber.json chambers/board-directors/chamber.json chambers/board-directors/roles.json tests/test_phase3_skills.py
git commit -m "Resolve skills through role and chamber allowlists"
```

---

### Task 4: Source Citation Prompt Reuse

**Files:**
- Modify: `scripts/agora.mjs`
- Modify: `scripts/import-inner-agora.mjs`
- Modify: `chambers/philosophy/chamber.json`
- Modify: `chambers/board-directors/chamber.json`
- Test: `tests/test_phase3_skills.py`

- [x] **Step 1: Write failing prompt reuse tests**

Add tests:

```python
def test_agora_policy_command_reads_source_citation_skill(self):
    result = self.run_node(ROOT / "scripts" / "agora.mjs", "policy", "source-citation")
    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
    self.assertIn("Протокол прозрачности", result.stdout)
    self.assertIn("[современный перенос]", result.stdout)

def test_importer_chamber_config_reports_source_citation_policy(self):
    result = self.run_node(ROOT / "scripts" / "import-inner-agora.mjs", "--print-chamber-config")
    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
    self.assertIn("transparencyPolicy=source-citation", result.stdout)
```

Expected before implementation: FAIL because `agora.mjs policy` does not exist and chamber configs still use legacy policy ids.

- [x] **Step 2: Point chambers at source-citation**

Set both active starter chambers:

```json
"transparencyPolicy": "source-citation"
```

- [x] **Step 3: Load transparency policy from skill prompt**

Import `loadSkillPrompt` in both scripts and implement:

```js
function transparencyPolicy(policyId = activeChamber().transparencyPolicy) {
  return loadSkillPrompt(SKILLS_DIR, policyId);
}
```

Keep fallback text only for missing skill files, with a clear warning line in the returned text.

- [x] **Step 4: Add `agora policy <skill-id>` command**

Use:

```bash
node scripts/agora.mjs policy source-citation
```

This prints the loaded prompt block for manual inspection and regression tests.

- [x] **Step 5: Verify prompt reuse**

Run:

```bash
python3 -m unittest tests.test_phase3_skills
python3 -m unittest discover -s tests -p 'test_*.py'
```

Expected: OK.

Commit:

```bash
git add scripts/agora.mjs scripts/import-inner-agora.mjs chambers/philosophy/chamber.json chambers/board-directors/chamber.json tests/test_phase3_skills.py
git commit -m "Load transparency policy from source citation skill"
```

---

### Task 5: Skill Surface In Agora CLI

**Files:**
- Modify: `scripts/agora.mjs`
- Test: `tests/test_phase3_skills.py`

- [x] **Step 1: Write failing CLI tests**

Add tests:

```python
def test_agora_skills_lists_active_chamber_role_skills(self):
    result = self.run_node(
        ROOT / "scripts" / "agora.mjs",
        "skills",
        "product",
        "--json",
        env={"INNER_AGORA_ACTIVE_CHAMBER": "board-directors"},
    )
    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
    payload = json.loads(result.stdout)
    self.assertEqual(payload["roleKey"], "product")
    self.assertIn("web-research", [skill["id"] for skill in payload["skills"]])
    self.assertEqual(payload["diagnostics"], [])

def test_agora_skills_reports_unknown_role_human_readably(self):
    result = self.run_node(ROOT / "scripts" / "agora.mjs", "skills", "unknown-role")
    self.assertNotEqual(result.returncode, 0)
    self.assertIn("Unknown role", result.stderr)
```

- [x] **Step 2: Implement CLI command**

Add usage:

```bash
node scripts/agora.mjs skills [role-key] [--json]
```

Behavior:
- Without role key, list all roles and their resolved skill ids.
- With role key, print resolved skills and diagnostics.
- `--json` returns `{ chamberId, roleKey, skills, diagnostics }`.

- [x] **Step 3: Verify CLI surface**

Run:

```bash
python3 -m unittest tests.test_phase3_skills
node scripts/agora.mjs skills socrates --json
INNER_AGORA_ACTIVE_CHAMBER=board-directors node scripts/agora.mjs skills product --json
```

Expected: OK, and board product includes `web-research`.

Commit:

```bash
git add scripts/agora.mjs tests/test_phase3_skills.py
git commit -m "Expose resolved role skills in Agora CLI"
```

---

### Task 6: Regression And Phase Verification

**Files:**
- Modify: `scripts/regression.mjs`
- Create: `tests/fixtures/baseline/skills-board-product-json.json`
- Verify all changed files

- [x] **Step 1: Add regression command**

Add:

```js
{
  name: "skills-board-product-json",
  env: { INNER_AGORA_ACTIVE_CHAMBER: "board-directors" },
  args: ["node", "scripts/agora.mjs", "skills", "product", "--json"],
}
```

- [x] **Step 2: Record and verify regression**

Run:

```bash
node scripts/regression.mjs record
node scripts/regression.mjs check
CHAMBER_MODE=chambers node scripts/regression.mjs check
```

Expected: both checks include `ok skills-board-product-json`.

- [x] **Step 3: Full verification**

Run:

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
npx --yes ajv-cli@5 validate -s data/schema/chamber.schema.json -d chambers/philosophy/chamber.json -d chambers/board-directors/chamber.json --spec=draft2020
npx --yes ajv-cli@5 validate -s data/schema/skill.schema.json -d "skills/*/skill.json" --spec=draft2020
node --check scripts/agora.mjs
node --check scripts/import-inner-agora.mjs
node --check scripts/chamber-loader.mjs
node --check scripts/skill-loader.mjs
node --check scripts/regression.mjs
git diff --check
```

Expected: all pass.

- [x] **Step 4: Commit verification**

```bash
git add scripts/regression.mjs tests/fixtures/baseline/skills-board-product-json.json docs/superpowers/plans/2026-07-02-phase-3-skills.md
git commit -m "Add skill regression coverage"
```
