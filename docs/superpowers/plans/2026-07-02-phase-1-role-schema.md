# Phase 1 Role Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the philosophy roster from the hardcoded `Philosopher` shape toward a generic `CouncilMember` role contract while preserving the current Agora behavior under a feature flag.

**Architecture:** Keep `data/philosophers.json` as the legacy source of truth and add `chambers/philosophy/roles.json` as the chamber-mode source. `CHAMBER_MODE=legacy|chambers` chooses the loader; legacy remains the default until T1.6 after a stability window.

**Tech Stack:** Node.js ESM scripts, Python `unittest`, JSON Schema draft 2020-12 artifact, existing snapshot regression harness.

---

> Superseded status, 2026-07-05: the elapsed-time requirement was removed by
> operator decision. Current T1.6 gating is migration check plus both regression
> modes, followed by a separate legacy-removal slice.

## Scope Boundary

T1.6 is intentionally out of scope for this historical execution pass. This
phase kept both code paths and verified parity.

The current readiness gate is tracked by `docs/roadmap/PHASE1_SOAK.md` and
verified with:

```bash
node scripts/phase1-soak-check.mjs
```

## Files

- Create: `data/schema/role.schema.json`
- Create: `chambers/philosophy/roles.json`
- Create: `chambers/philosophy/presets/mvp.json`
- Create: `scripts/migrate-roles.mjs`
- Modify: `scripts/agora.mjs`
- Modify: `scripts/import-inner-agora.mjs`
- Test: `tests/test_phase1_roles.py`
- Verify: `scripts/regression.mjs`
- Verify: `scripts/phase1-soak-check.mjs`

---

### Task 1: Role Schema

**Files:**
- Create: `data/schema/role.schema.json`
- Test: `tests/test_phase1_roles.py`

- [x] **Step 1: Write failing tests**

Add tests that assert the schema file exists, declares draft 2020-12, requires the legacy role fields, and includes Phase 1 fields `chamberId` and `riskTier`.

Run: `python3 -m unittest tests.test_phase1_roles.Phase1RoleMigrationTests.test_role_schema_contract`

Expected before implementation: FAIL because `data/schema/role.schema.json` is missing.

- [x] **Step 2: Implement schema**

Create a JSON Schema with required fields: `key`, `name`, `englishName`, `era`, `title`, `aliases`, `tags`, `centralIntuition`, `voice`, `tension`, `chamberId`, `riskTier`. Allow existing optional fields: `architect`, `candidateGenerated`, `candidateScore`, `contemporaryPublicFigure`, `safetyCare`.

- [x] **Step 3: Verify schema test**

Run: `python3 -m unittest tests.test_phase1_roles.Phase1RoleMigrationTests.test_role_schema_contract`

Expected after implementation: OK.

---

### Task 2: Migration Script And Chamber Roles

**Files:**
- Create: `scripts/migrate-roles.mjs`
- Create: `chambers/philosophy/roles.json`
- Test: `tests/test_phase1_roles.py`

- [x] **Step 1: Write failing tests**

Add tests that run `node scripts/migrate-roles.mjs --check`, assert migrated role count equals `data/philosophers.json`, and assert every migrated key is preserved with `chamberId: "philosophy"` and `riskTier: "reflective"`.

Run: `python3 -m unittest tests.test_phase1_roles.Phase1RoleMigrationTests.test_migrated_roles_preserve_legacy_roster`

Expected before implementation: FAIL because the migration script and generated roles file are missing.

- [x] **Step 2: Implement migration script**

Create `scripts/migrate-roles.mjs` with:
- default mode: write `chambers/philosophy/roles.json`
- `--check`: compare generated output with the file on disk and exit nonzero on mismatch
- `--dry-run`: print generated JSON without writing

- [x] **Step 3: Generate roles**

Run: `node scripts/migrate-roles.mjs`

Expected: writes `chambers/philosophy/roles.json` with 84 migrated roles.

- [x] **Step 4: Verify migration test**

Run: `python3 -m unittest tests.test_phase1_roles.Phase1RoleMigrationTests.test_migrated_roles_preserve_legacy_roster`

Expected after implementation: OK.

---

### Task 3: Chamber Mode Loader

**Files:**
- Modify: `scripts/agora.mjs`
- Modify: `scripts/import-inner-agora.mjs`
- Test: `tests/test_phase1_roles.py`

- [x] **Step 1: Write failing tests**

Add tests proving `CHAMBER_MODE=chambers node scripts/agora.mjs council --dry-run "Что такое свобода?"` exits 0 and still prints Plato, Descartes, Heidegger. Add a second test proving `CHAMBER_MODE=chambers node scripts/import-inner-agora.mjs --print-roles` includes `chamberId=philosophy` metadata without touching Paperclip.

Run: `python3 -m unittest tests.test_phase1_roles.Phase1RoleMigrationTests.test_chamber_mode_council_dry_run_matches_legacy tests.test_phase1_roles.Phase1RoleMigrationTests.test_importer_loads_chamber_roles_in_print_mode`

Expected before implementation: FAIL because scripts ignore `CHAMBER_MODE` and importer has no `--print-roles`.

- [x] **Step 2: Implement loader**

Add a shared local loader pattern in both scripts:
- `CHAMBER_MODE=legacy` or unset reads `data/philosophers.json`
- `CHAMBER_MODE=chambers` reads `chambers/philosophy/roles.json`
- unsupported values throw a human-readable error

- [x] **Step 3: Add importer dry inspection**

Add `--print-roles` to `scripts/import-inner-agora.mjs` so tests can inspect role definitions without Paperclip writes.

- [x] **Step 4: Verify loader tests**

Run the two tests from Step 1.

Expected after implementation: OK.

---

### Task 4: Deprecated Aliases

**Files:**
- Modify: `scripts/agora.mjs`
- Modify: `scripts/import-inner-agora.mjs`

- [x] **Step 1: Rename helpers in production code**

In `scripts/agora.mjs`, introduce role-named helpers and keep deprecated aliases:
- `roleByToken`
- `roleAliases`
- `roleScoreInText`
- `roleFromText`
- `uniqueRoles`
- `roleLine`
- `buildRoleDescription`

Keep aliases with `@deprecated` comments for transition:
- `philosopherByToken`
- `philosopherAliases`
- `philosopherScoreInText`
- `philosopherFromText`
- `uniquePhilosophers`
- `philosopherLine`
- `buildPhilosopherDescription`

In `scripts/import-inner-agora.mjs`, introduce `roleInstructions()` and keep `philosopherInstructions()` as a deprecated alias.

- [x] **Step 2: Verify current tests**

Run: `python3 -m unittest discover -s tests -p 'test_*.py'`

Expected: OK.

---

### Task 5: MVP Preset

**Files:**
- Create: `chambers/philosophy/presets/mvp.json`
- Modify: `scripts/agora.mjs`
- Test: `tests/test_phase1_roles.py`

- [x] **Step 1: Write failing test**

Add a test that temporarily renames the preset through `INNER_AGORA_MVP_PRESET_PATH` and asserts `council --dry-run` reads Plato, Descartes, Heidegger from that preset rather than from a hardcoded constant.

Run: `python3 -m unittest tests.test_phase1_roles.Phase1RoleMigrationTests.test_council_reads_mvp_preset_file`

Expected before implementation: FAIL because `MINIMUM_COUNCIL_KEYS` is hardcoded.

- [x] **Step 2: Implement preset loader**

Create `chambers/philosophy/presets/mvp.json`:

```json
{
  "id": "mvp",
  "name": "MVP philosophy council",
  "roleKeys": ["plato", "descartes", "heidegger"]
}
```

Update `minimumCouncil()` to read role keys from `INNER_AGORA_MVP_PRESET_PATH` or the default preset path.

- [x] **Step 3: Verify preset test**

Run the test from Step 1.

Expected after implementation: OK.

---

### Task 6: Phase Verification

**Files:**
- Verify all changed files

- [x] **Step 1: Regenerate migrated roles**

Run: `node scripts/migrate-roles.mjs --check`

Expected: `roles migration check ok`.

- [x] **Step 2: Run regression in both modes**

Run: `node scripts/regression.mjs check`

Expected: all baseline commands OK.

Run: `CHAMBER_MODE=chambers node scripts/regression.mjs check`

Expected: all baseline commands OK.

- [x] **Step 3: Run tests**

Run: `python3 -m unittest discover -s tests -p 'test_*.py'`

Expected: OK.

- [x] **Step 4: Syntax and whitespace checks**

Run: `node --check scripts/agora.mjs && node --check scripts/import-inner-agora.mjs && node --check scripts/migrate-roles.mjs`

Expected: all exit 0.

Run: `git diff --check`

Expected: no output.

- [x] **Step 5: Commit**

Commit message: `Add Phase 1 role schema migration`
