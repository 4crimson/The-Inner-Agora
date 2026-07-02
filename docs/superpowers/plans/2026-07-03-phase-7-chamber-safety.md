# Phase 7 Chamber Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make per-chamber transparency and high-stakes safety policies real prompt inputs for local-model Hermes/Paperclip runs.

**Architecture:** Chamber manifests declare `status`, `riskTier`, and `transparencyPolicy`. A focused `scripts/policy-loader.mjs` composes skill prompt text with mandatory high-stakes disclaimer text, then `scripts/agora.mjs` and `scripts/import-inner-agora.mjs` reuse that same composed policy path.

**Tech Stack:** Node.js ESM scripts, JSON chamber/skill manifests, Python `unittest`, local Paperclip API fakes.

---

## File Structure

- Create `scripts/policy-loader.mjs`: loads chamber policies, validates risk tier defaults, appends high-stakes disclaimer, exposes a small CLI for testability.
- Create `skills/business-advisory-transparency/skill.json` and `skills/business-advisory-transparency/SKILL.md`: board-specific transparency policy.
- Create `skills/high-stakes-disclaimer/skill.json` and `skills/high-stakes-disclaimer/SKILL.md`: mandatory disclaimer text used by policy composition.
- Modify `data/schema/chamber.schema.json`: allow `research-only` status and optional chamber-level `riskTier`.
- Modify `scripts/chamber-loader.mjs`: validate `research-only` and optional `riskTier`.
- Modify `chambers/philosophy/chamber.json`: declare `riskTier: reflective`.
- Modify `chambers/board-directors/chamber.json`: declare `status: research-only`, `riskTier: advisory`, `transparencyPolicy: business-advisory-transparency`.
- Modify `scripts/agora.mjs`: replace local policy composition with `composeChamberPolicy`, pass chamber into child/follow-up/context prompt builders.
- Modify `scripts/import-inner-agora.mjs`: replace local policy composition with `composeChamberPolicy`.
- Create `tests/test_phase7_chamber_safety.py`: focused red/green tests for manifest contract, policy composition, and generated child prompts.
- Modify existing Phase 2/3 tests and regression baselines only when their expected contract intentionally changed.

---

### Task 1: Chamber Manifest And Skill Contract

**Files:**
- Create: `tests/test_phase7_chamber_safety.py`
- Create: `skills/business-advisory-transparency/skill.json`
- Create: `skills/business-advisory-transparency/SKILL.md`
- Create: `skills/high-stakes-disclaimer/skill.json`
- Create: `skills/high-stakes-disclaimer/SKILL.md`
- Modify: `data/schema/chamber.schema.json`
- Modify: `scripts/chamber-loader.mjs`
- Modify: `chambers/philosophy/chamber.json`
- Modify: `chambers/board-directors/chamber.json`
- Modify: `tests/test_phase2_chambers.py`
- Modify: `tests/test_phase3_skills.py`

- [ ] **Step 1: Write failing manifest/skill tests**

Add tests that assert:

```python
def test_chamber_schema_allows_research_only_and_risk_tier(self):
    schema = json.loads(CHAMBER_SCHEMA.read_text(encoding="utf-8"))
    self.assertIn("research-only", schema["properties"]["status"]["enum"])
    self.assertEqual(schema["properties"]["riskTier"]["enum"], ["reflective", "advisory", "high-stakes"])

def test_board_chamber_is_research_only_with_business_policy(self):
    chamber = json.loads(BOARD_CHAMBER.read_text(encoding="utf-8"))
    self.assertEqual(chamber["status"], "research-only")
    self.assertEqual(chamber["riskTier"], "advisory")
    self.assertEqual(chamber["transparencyPolicy"], "business-advisory-transparency")
    self.assertIn("business-advisory-transparency", chamber["allowedSkills"])

def test_policy_skills_are_installed(self):
    result = self.run_node(SKILL_LOADER, "list", "--json")
    payload = json.loads(result.stdout)
    ids = sorted(item["id"] for item in payload["skills"])
    self.assertIn("business-advisory-transparency", ids)
    self.assertIn("high-stakes-disclaimer", ids)
```

- [ ] **Step 2: Run red tests**

Run: `python3 -m unittest tests.test_phase7_chamber_safety -v`

Expected: FAIL because `research-only`, `riskTier`, and the new skills are not implemented.

- [ ] **Step 3: Implement manifest and skills**

Add `research-only` to schema/loader status enum, add optional `riskTier` enum, create both skill directories, and update chamber manifests.

- [ ] **Step 4: Run green tests**

Run: `python3 -m unittest tests.test_phase7_chamber_safety -v`

Expected: PASS for the manifest/skill tests.

- [ ] **Step 5: Commit**

```bash
git add data/schema/chamber.schema.json scripts/chamber-loader.mjs chambers/philosophy/chamber.json chambers/board-directors/chamber.json skills/business-advisory-transparency skills/high-stakes-disclaimer tests/test_phase7_chamber_safety.py tests/test_phase2_chambers.py tests/test_phase3_skills.py
git commit -m "Add Phase 7 chamber safety contracts"
```

---

### Task 2: Composed Policy Loader

**Files:**
- Create: `scripts/policy-loader.mjs`
- Modify: `tests/test_phase7_chamber_safety.py`

- [ ] **Step 1: Write failing policy composition tests**

Add tests that call the new CLI:

```python
def test_board_policy_command_outputs_business_language(self):
    result = self.run_node(POLICY_LOADER, "compose", "board-directors")
    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
    self.assertIn("Протокол прозрачности для advisory-мемо", result.stdout)
    self.assertIn("условия решения", result.stdout)
    self.assertNotIn("Имитация голоса", result.stdout)

def test_high_stakes_policy_appends_mandatory_disclaimer(self):
    with tempfile.TemporaryDirectory() as temp_dir:
        write_high_stakes_chamber(temp_dir)
        result = self.run_node(
            POLICY_LOADER,
            "compose",
            "clinic",
            "--chambers-dir",
            temp_dir,
        )
    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
    self.assertIn("Обязательный high-stakes дисклеймер", result.stdout)
    self.assertIn("не является медицинской, юридической или финансовой рекомендацией", result.stdout)
```

- [ ] **Step 2: Run red tests**

Run: `python3 -m unittest tests.test_phase7_chamber_safety.Phase7ChamberSafetyTests.test_board_policy_command_outputs_business_language tests.test_phase7_chamber_safety.Phase7ChamberSafetyTests.test_high_stakes_policy_appends_mandatory_disclaimer -v`

Expected: FAIL because `scripts/policy-loader.mjs` does not exist.

- [ ] **Step 3: Implement `policy-loader.mjs`**

Implement `composeChamberPolicy(chamber, options)`:

```javascript
export function chamberRiskTier(chamber) {
  return String(chamber?.riskTier || "reflective").trim() || "reflective";
}

export function composeChamberPolicy(chamber, options = {}) {
  const skillsDir = options.skillsDir || DEFAULT_SKILLS_DIR;
  const policyId = chamber?.transparencyPolicy || "source-citation";
  const parts = [loadSkillPrompt(skillsDir, policyId)];
  if (chamberRiskTier(chamber) === "high-stakes") {
    parts.push(loadSkillPrompt(skillsDir, "high-stakes-disclaimer"));
  }
  return parts.join("\n\n");
}
```

The CLI must support:

```bash
node scripts/policy-loader.mjs compose <chamber-id> [--json] [--chambers-dir DIR] [--skills-dir DIR]
```

- [ ] **Step 4: Run green tests**

Run the two policy composition tests again.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/policy-loader.mjs tests/test_phase7_chamber_safety.py
git commit -m "Compose chamber transparency policies"
```

---

### Task 3: Agora Child Prompts Use Composed Chamber Policy

**Files:**
- Modify: `scripts/agora.mjs`
- Modify: `tests/test_phase7_chamber_safety.py`

- [ ] **Step 1: Write failing generated-child-prompt test**

Add a local fake Paperclip API test that runs:

```python
result = subprocess.run(
    ["node", str(AGORA_SCRIPT), "ask", "--min", "--philosophers", "reviewer", "Можно ли менять дозировку лекарства?"],
    cwd=ROOT,
    env={
        **os.environ,
        "INNER_AGORA_CHAMBERS_DIR": temp_dir,
        "INNER_AGORA_ACTIVE_CHAMBER": "clinic",
        "PAPERCLIP_API_BASE": api_base,
        "INNER_AGORA_AUTO_RESTART_PAPERCLIP": "0",
    },
    text=True,
    capture_output=True,
)
```

Assert that the child issue description contains `Обязательный high-stakes дисклеймер` and the high-stakes advisory sentence.

- [ ] **Step 2: Run red test**

Run: `python3 -m unittest tests.test_phase7_chamber_safety.Phase7ChamberSafetyTests.test_high_stakes_agora_child_prompt_includes_disclaimer -v`

Expected: FAIL because `agora.mjs` only loads `transparencyPolicy()` and does not append high-stakes disclaimer.

- [ ] **Step 3: Wire composed policy into Agora prompt builders**

Import `composeChamberPolicy` from `scripts/policy-loader.mjs`, change `transparencyPolicy(chamberOrPolicyId)` to use the active chamber when no string id is passed, and pass `chamber` into:

- `buildRoleDescription({ rootIssue, request, mode, philosopher, chamber })`
- `buildFollowUpDescription({ rootIssue, request, philosopher, chamber })`
- `buildDialogueDescription({ request, philosopher, chamber })`
- `buildDialogueWithContextDescription({ rootIssue, synthesisIssue, synthesisText, request, philosopher, chamber })`

Keep philosophy wording stable, but use neutral "роль/палата" wording for non-philosophy child prompts.

- [ ] **Step 4: Run green test**

Run the generated-child-prompt test again.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/agora.mjs tests/test_phase7_chamber_safety.py
git commit -m "Apply chamber policy to Agora prompts"
```

---

### Task 4: Importer Uses Same Policy Composition

**Files:**
- Modify: `scripts/import-inner-agora.mjs`
- Modify: `tests/test_phase7_chamber_safety.py`

- [ ] **Step 1: Write failing importer policy test**

Add a test that runs:

```python
result = self.run_node(
    IMPORT_SCRIPT,
    "--print-role-instructions",
    "reviewer",
    env={
        "INNER_AGORA_CHAMBERS_DIR": temp_dir,
        "INNER_AGORA_ACTIVE_CHAMBER": "clinic",
    },
)
```

Assert that output contains the high-stakes disclaimer and the chamber policy text.

- [ ] **Step 2: Run red test**

Run: `python3 -m unittest tests.test_phase7_chamber_safety.Phase7ChamberSafetyTests.test_importer_role_instructions_use_composed_policy -v`

Expected: FAIL because importer lacks `--print-role-instructions` and does not compose high-stakes policy.

- [ ] **Step 3: Implement importer policy wiring**

Import `composeChamberPolicy`, use it in `transparencyPolicy(chamber = activeChamber())`, pass `chamber` into role and assistant instruction builders, and add:

```bash
node scripts/import-inner-agora.mjs --print-role-instructions <role-key>
```

This command prints the generated managed `AGENTS.md` text for the selected role without touching Paperclip.

- [ ] **Step 4: Run green test**

Run the importer policy test again.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/import-inner-agora.mjs tests/test_phase7_chamber_safety.py
git commit -m "Use chamber policy composition in importer"
```

---

### Task 5: Roadmap Evidence And Verification

**Files:**
- Modify: `docs/roadmap/TASKS.md`
- Modify: `docs/roadmap/ROADMAP.md`
- Modify: `docs/roadmap/IMPLEMENTATION_PLAN.md`

- [ ] **Step 1: Run full verification gates**

Run:

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
node scripts/regression.mjs check
CHAMBER_MODE=chambers node scripts/regression.mjs check
STATE_MODE=per-chat INNER_AGORA_CHAT_ID=test-chat node scripts/agora.mjs mode get
```

Expected: all commands exit 0.

- [ ] **Step 2: Update roadmap evidence**

Mark Phase 7 tasks complete and add observed verification output with the date `2026-07-03`.

- [ ] **Step 3: Run targeted doc sanity check**

Run: `rg -n "Фаза 7|research-only|high-stakes|business-advisory-transparency" docs/roadmap docs/superpowers`

Expected: updated Phase 7 evidence and policy names are discoverable.

- [ ] **Step 4: Commit**

```bash
git add docs/roadmap/TASKS.md docs/roadmap/ROADMAP.md docs/roadmap/IMPLEMENTATION_PLAN.md
git commit -m "Document completed Phase 7"
```

---

## Self-Review

- Spec coverage: T7.1 is covered by Tasks 1-3, T7.2 by Tasks 2-4, T7.3 by Tasks 1 and 5.
- Local model constraint: no task adds a cloud provider or remote policy call.
- Telegram UX separation: Phase 8 remains the place for inline buttons and visual formatting.
- Test proof: every production change has a named red test before implementation.
