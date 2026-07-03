# Telegram Paperclip QA Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable Paperclip/Telegram QA runtime tool plus a Codex QA skill/plugin so live Telegram acceptance cycles can be run, cleaned up, bug-triaged, handed to development, and retested without mixing roles.

**Architecture:** Implement a project-neutral `paperclip-qa-tool/` runtime with config-driven suites, manifest tracking, Telegram userbot operations, Paperclip issue tracking/cleanup, evaluators, reports, and bug output. Bind The Inner Agora through `telegram-testing.config.json`. Add a repo-local Codex plugin/skill under `codex-plugins/telegram-paperclip-qa/` to define Tester, Developer, Retest, and Release Review modes.

**Tech Stack:** Node.js ESM CLI, Python Telethon userbot bridge, Paperclip HTTP API, JSON schema-style validation, Python `unittest` or Node built-in tests, Codex skill/plugin manifest files.

---

## File Structure

Create:

- `paperclip-qa-tool/bin/paperclip-qa.mjs`: CLI entrypoint.
- `paperclip-qa-tool/qa-tool.config.schema.json`: config schema.
- `paperclip-qa-tool/src/config.mjs`: config loading and validation.
- `paperclip-qa-tool/src/manifest.mjs`: run id, run directory, manifest read/write/update.
- `paperclip-qa-tool/src/telegram-userbot.mjs`: Node wrapper around the Python userbot driver for send/capture/delete.
- `paperclip-qa-tool/src/paperclip-client.mjs`: Paperclip API client, company lookup, issue snapshots, issue tree walk.
- `paperclip-qa-tool/src/cleanup-engine.mjs`: Telegram and Paperclip cleanup, hard-delete-first with soft fallback.
- `paperclip-qa-tool/src/suite-runner.mjs`: suite execution orchestration.
- `paperclip-qa-tool/src/evaluator.mjs`: generic expectation checks.
- `paperclip-qa-tool/src/report-writer.mjs`: `REPORT.md`, `bugs.jsonl`, and cleanup report output.
- `paperclip-qa-tool/suites/generic-health.json`: reusable health suite.
- `paperclip-qa-tool/suites/generic-telegram-help.json`: reusable help/menu suite.
- `telegram-testing.config.json`: Inner Agora binding/config.
- `tests/test_telegram_qa_tool.py`: focused CLI/unit tests using temp dirs and fake APIs.
- `codex-plugins/telegram-paperclip-qa/.codex-plugin/plugin.json`: Codex plugin manifest.
- `codex-plugins/telegram-paperclip-qa/skills/telegram-paperclip-qa/SKILL.md`: QA workflow skill.
- `codex-plugins/telegram-paperclip-qa/skills/telegram-paperclip-qa/references/tester-mode.md`
- `codex-plugins/telegram-paperclip-qa/skills/telegram-paperclip-qa/references/developer-mode.md`
- `codex-plugins/telegram-paperclip-qa/skills/telegram-paperclip-qa/references/retest-mode.md`
- `codex-plugins/telegram-paperclip-qa/skills/telegram-paperclip-qa/references/release-review-mode.md`
- `codex-plugins/telegram-paperclip-qa/skills/telegram-paperclip-qa/references/bug-template.md`

Modify:

- `docs/telegram-testing/TELEGRAM_TEST_CYCLE_PLAN.md`: keep aligned with implemented CLI commands.
- `docs/superpowers/specs/2026-07-03-telegram-test-cycle-design.md`: update if implementation changes boundaries.
- `.gitignore`: ignore `artifacts/telegram-test-runs/` if not already ignored.

Do not modify live Hermes profile, Paperclip issues, or Telegram chat during unit-test tasks. Live smoke appears only at the end and requires explicit operator confirmation.

## Task 1: Config Schema And Loader

**Files:**

- Create: `paperclip-qa-tool/qa-tool.config.schema.json`
- Create: `paperclip-qa-tool/src/config.mjs`
- Create: `tests/test_telegram_qa_tool.py`

- [ ] **Step 1: Write failing config-loader tests**

Add tests that create a temporary config file and run:

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs config-check --config /tmp/config.json --json
```

Expected first failure: CLI file does not exist.

Test cases:

- valid config returns `ok: true`;
- missing `telegram.target` fails;
- missing `paperclip.company` fails;
- duplicate test ids fail;
- suite references are resolved from inline config and `paperclip-qa-tool/suites/*.json`.

- [ ] **Step 2: Add minimal CLI and config loader**

Implement `paperclip-qa-tool/bin/paperclip-qa.mjs` with commands:

```text
config-check --config FILE [--json]
```

Implement `loadConfig(filePath)` in `src/config.mjs`.

Required config shape:

```json
{
  "name": "inner-agora-telegram-qa",
  "telegram": {
    "target": "@crimson_philosophs_bot",
    "userbot": {
      "session": ".telegram-userbot"
    }
  },
  "paperclip": {
    "apiBase": "http://127.0.0.1:3100/api",
    "company": "The Inner Agora",
    "cleanup": "hard"
  },
  "artifacts": {
    "dir": "artifacts/telegram-test-runs"
  },
  "suites": {
    "help": {
      "tests": []
    }
  }
}
```

- [ ] **Step 3: Run tests**

Run:

```bash
python3 -m unittest tests.test_telegram_qa_tool -v
```

Expected: config-loader tests pass.

- [ ] **Step 4: Commit**

```bash
git add paperclip-qa-tool tests/test_telegram_qa_tool.py
git commit -m "Add Telegram QA tool config loader"
```

## Task 2: Manifest And Run Directory

**Files:**

- Create: `paperclip-qa-tool/src/manifest.mjs`
- Modify: `paperclip-qa-tool/bin/paperclip-qa.mjs`
- Modify: `paperclip-qa-tool/src/report-writer.mjs`
- Test: `tests/test_telegram_qa_tool.py`

- [ ] **Step 1: Write failing manifest tests**

Test command:

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs run-start --config /tmp/config.json --suite help --json
```

Expected behavior:

- creates `artifacts/telegram-test-runs/<runId>/manifest.json`;
- `runId` starts with `QA-`;
- manifest contains `telegram`, `paperclip`, `tests`, `bugs`, and `cleanup`;
- repeated `manifest-update` operations preserve existing entries and append new events.

- [ ] **Step 2: Implement manifest module**

Implement:

```js
export function createRunId({ suite, now = new Date(), random = crypto.randomUUID() }) {}
export function createRunDirectory({ artifactsDir, runId }) {}
export function writeManifest(manifestPath, manifest) {}
export function readManifest(manifestPath) {}
export function updateManifest(manifestPath, updater) {}
```

Use atomic write through a temporary file plus rename.

- [ ] **Step 3: Add CLI commands**

Add:

```text
run-start --config FILE --suite NAME [--json]
manifest-show --run RUN_ID --config FILE [--json]
```

- [ ] **Step 4: Run tests and commit**

```bash
python3 -m unittest tests.test_telegram_qa_tool -v
git add paperclip-qa-tool tests/test_telegram_qa_tool.py
git commit -m "Add Telegram QA run manifests"
```

## Task 3: Paperclip Client And Cleanup

**Files:**

- Create: `paperclip-qa-tool/src/paperclip-client.mjs`
- Create: `paperclip-qa-tool/src/cleanup-engine.mjs`
- Modify: `paperclip-qa-tool/bin/paperclip-qa.mjs`
- Test: `tests/test_telegram_qa_tool.py`

- [ ] **Step 1: Write fake Paperclip API tests**

Use a Python test HTTP server with endpoints:

- `GET /api/companies`
- `GET /api/companies/:id/issues`
- `GET /api/issues/:id`
- `DELETE /api/issues/:id`
- `PATCH /api/issues/:id`

Test cases:

- company lookup by name;
- snapshot visible roots;
- tree walk returns children before parent for cleanup;
- hard delete success removes all manifest issues;
- hard delete 500 falls back to `PATCH hiddenAt/status=cancelled`;
- cleanup refuses issue without manifest entry or exact `[qa:<runId>]`.

- [ ] **Step 2: Implement Paperclip client**

Implement:

```js
export class PaperclipClient {
  constructor({ apiBase, fetchImpl = fetch }) {}
  async getCompanies() {}
  async findCompanyByName(name) {}
  async listIssues(companyId) {}
  async getIssue(issueId) {}
  async deleteIssue(issueId) {}
  async patchIssue(issueId, body) {}
}
```

- [ ] **Step 3: Implement cleanup engine**

Implement:

```js
export async function cleanupPaperclipIssues({ client, manifest, mode, now }) {}
```

Rules:

- bottom-up order;
- hard mode tries delete first;
- fallback patches hiddenAt and cancelled for non-terminal issues;
- records each action in manifest cleanup results;
- reports residuals.

- [ ] **Step 4: Add CLI cleanup command**

```text
cleanup --config FILE --run RUN_ID --mode hard|soft|none [--json] [--dry-run]
```

- [ ] **Step 5: Run tests and commit**

```bash
python3 -m unittest tests.test_telegram_qa_tool -v
git add paperclip-qa-tool tests/test_telegram_qa_tool.py
git commit -m "Add Paperclip cleanup for Telegram QA"
```

## Task 4: Telegram Userbot Adapter

**Files:**

- Create: `paperclip-qa-tool/src/telegram-userbot.mjs`
- Modify: `scripts/telegram-userbot-driver.py`
- Modify: `paperclip-qa-tool/bin/paperclip-qa.mjs`
- Test: `tests/test_telegram_userbot_driver.py`
- Test: `tests/test_telegram_qa_tool.py`

- [x] **Step 1: Extend userbot driver tests**

Add dry-run tests for:

- `history --limit N`;
- `delete --ids 1,2,3 --dry-run`;
- output includes ids and target but no secrets.

- [x] **Step 2: Extend Python userbot driver**

Add commands:

```text
history --limit N [--transcript FILE]
delete --ids CSV [--dry-run]
```

`delete` uses Telethon `delete_messages(entity, ids, revoke=True)`.

- [x] **Step 3: Add Node wrapper**

Implemented a synchronous Node wrapper around `scripts/telegram-userbot-driver.py`.
Current covered methods:

```js
export class TelegramUserbot {
  constructor({ config, python, driverPath, env }) {}
  checkEnv() {}
  history({ limit, dryRun }) {}
}
```

`send` remains runner integration work and must be added with tests before any live suite execution. `deleteMessages` is integrated into manifest-backed cleanup.

- [x] **Step 4: Add CLI smoke commands**

```text
telegram-check --config FILE [--json]
telegram-history --config FILE --limit 10 [--dry-run] [--json]
```

These commands must not send messages.

- [x] **Step 5: Run tests**

```bash
python3 -m unittest tests.test_telegram_userbot_driver tests.test_telegram_qa_tool -v
```

Evidence:

- `python3 -m unittest tests.test_telegram_userbot_driver tests.test_telegram_qa_tool -v` -> `Ran 16 tests ... OK`
- `node --check paperclip-qa-tool/bin/paperclip-qa.mjs` -> OK
- `node --check paperclip-qa-tool/src/telegram-userbot.mjs` -> OK

## Task 5: Suite Runner And Evaluator

**Files:**

- Create: `paperclip-qa-tool/src/suite-runner.mjs`
- Create: `paperclip-qa-tool/src/evaluator.mjs`
- Create: `paperclip-qa-tool/suites/generic-health.json`
- Create: `paperclip-qa-tool/suites/generic-telegram-help.json`
- Modify: `paperclip-qa-tool/bin/paperclip-qa.mjs`
- Test: `tests/test_telegram_qa_tool.py`

- [x] **Step 1: Write suite/evaluator tests**

Test generic expectations:

- `replyContains`;
- `replyNotContains`;
- `paperclipRootsCreated: 0`;
- `paperclipRootsCreatedAtLeast: 1`;
- `noRawTokens`;
- `localRouteContains`;
- `buttonsPresent`.

- [x] **Step 2: Implement suite runner**

Implemented the safe dry-run lifecycle:

1. create run manifest;
2. list planned tests;
3. record planned tests in manifest;
4. preserve cleanup mode;
5. refuse non-dry-run execution until live lifecycle is implemented.

Live run lifecycle remains pending:

1. baseline Paperclip snapshot;
2. send Telegram message;
3. capture reply/history;
4. detect new Paperclip roots;
5. update manifest;
6. evaluate expectations.

- [x] **Step 3: Add CLI run command**

```text
run --config FILE --suite NAME [--cleanup hard|soft|none] [--json] [--dry-run]
```

Dry run prints planned tests and expected cleanup but sends nothing. Non-dry-run requires `--live-ok` and then executes the suite lifecycle.

- [x] **Step 4: Run tests**

```bash
python3 -m unittest tests.test_telegram_qa_tool -v
```

Evidence:

- `python3 -m unittest tests.test_telegram_qa_tool -v` -> `Ran 14 tests ... OK`
- `node --check paperclip-qa-tool/bin/paperclip-qa.mjs` -> OK
- `node --check paperclip-qa-tool/src/evaluator.mjs` -> OK
- `node --check paperclip-qa-tool/src/suite-runner.mjs` -> OK

## Task 6: Report Writer And Bug Output

**Files:**

- Create: `paperclip-qa-tool/src/report-writer.mjs`
- Modify: `paperclip-qa-tool/bin/paperclip-qa.mjs`
- Test: `tests/test_telegram_qa_tool.py`

- [x] **Step 1: Write report tests**

Given a manifest with one pass, one fail, one cleanup residual, assert:

- `REPORT.md` contains summary, failed tests, evidence, cleanup result;
- `bugs.jsonl` contains structured bug entries;
- secrets are redacted;
- `bugs --append-doc` produces a preview in dry-run mode.

- [x] **Step 2: Implement report writer**

Implement:

```js
export function writeReport({ manifest, outputDir }) {}
export function writeBugsJsonl({ manifest, outputDir }) {}
export function appendBugsToDoc({ bugsPath, docPath, dryRun }) {}
```

- [x] **Step 3: Add CLI commands**

```text
report --config FILE --run RUN_ID [--json]
bugs --config FILE --run RUN_ID [--append-doc FILE] [--dry-run]
```

- [x] **Step 4: Run tests**

```bash
python3 -m unittest tests.test_telegram_qa_tool -v
```

Evidence:

- `python3 -m unittest tests.test_telegram_qa_tool -v` -> `Ran 16 tests ... OK`
- `node --check paperclip-qa-tool/bin/paperclip-qa.mjs` -> OK
- `node --check paperclip-qa-tool/src/report-writer.mjs` -> OK

## Task 7: Inner Agora Project Config

**Files:**

- Create: `telegram-testing.config.json`
- Modify: `docs/telegram-testing/TELEGRAM_TEST_CYCLE_PLAN.md`
- Test: `tests/test_telegram_qa_tool.py`

- [x] **Step 1: Add config validation test for real project config**

Test:

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs config-check --config telegram-testing.config.json --json
```

Expected: `ok: true`.

- [x] **Step 2: Create Inner Agora config**

Include suites:

- `health`;
- `help`;
- `natural-dialogue`;
- `council-create`;
- `cleanup`.

Use `[qa:<runId>]` markers only in Paperclip-creating tests.

- [x] **Step 3: Run config check and tests**

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs config-check --config telegram-testing.config.json --json
python3 -m unittest tests.test_telegram_qa_tool -v
```

Evidence:

- `node paperclip-qa-tool/bin/paperclip-qa.mjs config-check --config telegram-testing.config.json --json` -> `ok: true`
- `node paperclip-qa-tool/bin/paperclip-qa.mjs run --config telegram-testing.config.json --suite help --dry-run --json` -> planned 4 help tests
- `python3 -m unittest tests.test_telegram_qa_tool -v` -> `Ran 17 tests ... OK`

- [x] **Step 4: Commit**

```bash
git add telegram-testing.config.json docs/telegram-testing/TELEGRAM_TEST_CYCLE_PLAN.md tests/test_telegram_qa_tool.py
git commit -m "Add Inner Agora Telegram QA config"
```

## Task 8: Codex QA Skill And Plugin

**Files:**

- Create: `codex-plugins/telegram-paperclip-qa/.codex-plugin/plugin.json`
- Create: `codex-plugins/telegram-paperclip-qa/skills/telegram-paperclip-qa/SKILL.md`
- Create: `codex-plugins/telegram-paperclip-qa/skills/telegram-paperclip-qa/references/tester-mode.md`
- Create: `codex-plugins/telegram-paperclip-qa/skills/telegram-paperclip-qa/references/developer-mode.md`
- Create: `codex-plugins/telegram-paperclip-qa/skills/telegram-paperclip-qa/references/retest-mode.md`
- Create: `codex-plugins/telegram-paperclip-qa/skills/telegram-paperclip-qa/references/release-review-mode.md`
- Create: `codex-plugins/telegram-paperclip-qa/skills/telegram-paperclip-qa/references/bug-template.md`

- [x] **Step 1: Scaffold plugin manifest**

Create a repo-local plugin manifest with name `telegram-paperclip-qa`. Keep it installable later, but do not require marketplace install for this task.

- [x] **Step 2: Write skill**

`SKILL.md` must:

- trigger on Telegram/Paperclip QA, live Telegram test cycle, tester mode, developer handoff, retest mode, release review;
- require explicit live-side-effect acknowledgement before running live suites;
- forbid code edits in tester mode;
- require grouping bugs before developer mode;
- require retest before claiming a bug fixed.

- [x] **Step 3: Write references**

Each reference should be concise and mode-specific:

- tester mode: run suites, gather evidence, no patches;
- developer mode: one area per batch, write tests, patch, verify;
- retest mode: rerun failed test ids, compare to previous run;
- release review mode: full suite and cleanup report;
- bug template: JSON and Markdown fields.

- [x] **Step 4: Validate plugin shape**

If the local plugin validator is available, run it. Otherwise run:

```bash
python3 - <<'PY'
import json, pathlib
root = pathlib.Path('codex-plugins/telegram-paperclip-qa')
json.loads((root/'.codex-plugin/plugin.json').read_text())
assert (root/'skills/telegram-paperclip-qa/SKILL.md').exists()
print('ok')
PY
```

Evidence:

- `python3 /Users/admin/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py codex-plugins/telegram-paperclip-qa` -> blocked by missing `yaml` module in local Python.
- bundled Python validator retry -> same missing `yaml` module.
- fallback structural validation script -> `ok`.
- placeholder scan -> no TODO/placeholders.

- [x] **Step 5: Commit**

```bash
git add codex-plugins/telegram-paperclip-qa
git commit -m "Add Telegram Paperclip QA Codex skill"
```

## Task 9: Retest And Bug Batch Modes

**Files:**

- Modify: `paperclip-qa-tool/src/suite-runner.mjs`
- Modify: `paperclip-qa-tool/src/report-writer.mjs`
- Modify: `paperclip-qa-tool/bin/paperclip-qa.mjs`
- Test: `tests/test_telegram_qa_tool.py`

- [x] **Step 1: Write tests for previous-run retest**

Given a previous manifest with failing `testId`s, assert:

- `retest --run OLD_RUN` selects only failed tests;
- retest report links old and new runs;
- fixed/still-failing/changed statuses are recorded.

- [x] **Step 2: Implement retest command**

```text
retest --config FILE --run OLD_RUN [--cleanup hard|soft|none] [--json]
```

- [x] **Step 3: Implement bug-batch output**

```text
bug-batch --config FILE --run RUN_ID --area telegram-ui [--json]
```

Output should list bug ids, evidence, and acceptance criteria for one development area.

- [x] **Step 4: Run tests**

```bash
python3 -m unittest tests.test_telegram_qa_tool -v
```

Evidence:

- `python3 -m unittest tests.test_telegram_qa_tool -v` -> `Ran 19 tests ... OK`
- `node --check paperclip-qa-tool/bin/paperclip-qa.mjs` -> OK
- `node --check paperclip-qa-tool/src/suite-runner.mjs` -> OK
- `node --check paperclip-qa-tool/src/report-writer.mjs` -> OK

## Task 10: Documentation And Controlled Live Acceptance

**Files:**

- Modify: `docs/telegram-testing/TELEGRAM_TEST_CYCLE_PLAN.md`
- Modify: `README.md`

- [x] **Step 1: Document operator workflow**

Add concise commands:

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs health --config telegram-testing.config.json
node paperclip-qa-tool/bin/paperclip-qa.mjs run --config telegram-testing.config.json --suite help --cleanup hard --live-ok
node paperclip-qa-tool/bin/paperclip-qa.mjs cleanup --config telegram-testing.config.json --run QA-... --mode hard
node paperclip-qa-tool/bin/paperclip-qa.mjs report --config telegram-testing.config.json --run QA-...
```

- [x] **Step 2: Run non-live verification**

```bash
python3 -m unittest tests.test_telegram_userbot_driver tests.test_telegram_qa_tool -v
node paperclip-qa-tool/bin/paperclip-qa.mjs config-check --config telegram-testing.config.json --json
node paperclip-qa-tool/bin/paperclip-qa.mjs run --config telegram-testing.config.json --suite help --dry-run --json
```

Evidence:

- `python3 -m unittest tests.test_telegram_userbot_driver tests.test_telegram_qa_tool -v` -> `Ran 24 tests ... OK`
- `node paperclip-qa-tool/bin/paperclip-qa.mjs config-check --config telegram-testing.config.json --json` -> `ok: true`
- `node paperclip-qa-tool/bin/paperclip-qa.mjs run --config telegram-testing.config.json --suite help --dry-run --json` -> planned 4 help tests

Live steps remain pending until explicit operator confirmation.

## Task 11: Telegram Manifest Cleanup Hardening

**Files:**

- Modify: `paperclip-qa-tool/src/telegram-userbot.mjs`
- Modify: `paperclip-qa-tool/src/cleanup-engine.mjs`
- Modify: `paperclip-qa-tool/bin/paperclip-qa.mjs`
- Test: `tests/test_telegram_qa_tool.py`

- [x] **Step 1: Add cleanup tests for Telegram manifest messages**

Assert:

- cleanup deduplicates `manifest.telegram.messages[].messageId` / `id`;
- cleanup calls the userbot driver with `delete --ids ...`;
- dry-run records the planned Telegram delete but does not call userbot.

- [x] **Step 2: Implement userbot delete wrapper**

`TelegramUserbot.deleteMessages({ ids, dryRun })` calls the Python driver `delete --ids CSV`.

- [x] **Step 3: Integrate Telegram cleanup into CLI cleanup**

`cleanup --config FILE --run RUN_ID` now writes both `cleanup.telegram` and `cleanup.paperclip` actions, and residuals from either side affect command success.

Evidence:

- `python3 -m unittest tests.test_telegram_qa_tool.TelegramQaToolConfigTests.test_cleanup_deletes_manifest_telegram_messages_with_fake_userbot tests.test_telegram_qa_tool.TelegramQaToolConfigTests.test_cleanup_dry_run_records_telegram_delete_without_calling_userbot -v` -> `Ran 2 tests ... OK`
- `node --check paperclip-qa-tool/bin/paperclip-qa.mjs` -> OK
- `node --check paperclip-qa-tool/src/cleanup-engine.mjs` -> OK
- `node --check paperclip-qa-tool/src/telegram-userbot.mjs` -> OK

## Task 12: Executable Suite Lifecycle

**Files:**

- Modify: `paperclip-qa-tool/src/suite-runner.mjs`
- Modify: `paperclip-qa-tool/src/telegram-userbot.mjs`
- Modify: `paperclip-qa-tool/bin/paperclip-qa.mjs`
- Test: `tests/test_telegram_qa_tool.py`

- [x] **Step 1: Add fake-adapter lifecycle test**

Assert non-dry-run `run` can execute without live side effects when adapters are faked:

- sends configured Telegram message;
- snapshots Paperclip before/after;
- detects new Paperclip root;
- records Telegram messages in manifest;
- evaluates expectations and records pass/fail.

- [x] **Step 2: Implement runner lifecycle**

`executeSuite` now:

1. resolves Paperclip company;
2. snapshots issues before;
3. sends Telegram message through `TelegramUserbot.send`;
4. snapshots issues after;
5. stores new Paperclip issues/roots;
6. evaluates expectations;
7. writes manifest and generated bugs.

Evidence:

- `python3 -m unittest tests.test_telegram_qa_tool.TelegramQaToolConfigTests.test_run_executes_suite_with_fake_telegram_and_paperclip -v` -> `Ran 1 test ... OK`
- `node --check paperclip-qa-tool/bin/paperclip-qa.mjs` -> OK
- `node --check paperclip-qa-tool/src/suite-runner.mjs` -> OK
- `node --check paperclip-qa-tool/src/telegram-userbot.mjs` -> OK

- [ ] **Step 3: Request explicit live confirmation**

Before live run, state:

```text
This will send Telegram messages and may create Paperclip issues. Cleanup will run with hard-delete-first and soft fallback. Proceed?
```

- [ ] **Step 4: Run controlled live help suite**

Only after confirmation:

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs run --config telegram-testing.config.json --suite help --cleanup hard --live-ok --json
```

Expected:

- local help/menu reply;
- no Paperclip roots;
- Telegram messages cleaned up;
- report written.

## Task 13: Health And Live Acknowledgement Gate

**Files:**

- Create: `paperclip-qa-tool/src/health-check.mjs`
- Modify: `paperclip-qa-tool/bin/paperclip-qa.mjs`
- Modify docs and QA skill references.
- Test: `tests/test_telegram_qa_tool.py`

- [x] **Step 1: Add health command**

`health --config FILE [--json]` performs read-only checks:

- config is loaded;
- Telegram userbot env is valid through `check-env`;
- Paperclip company lookup succeeds.

- [x] **Step 2: Require live acknowledgement**

`run` without `--dry-run` now requires `--live-ok`. The gate is checked before Telegram send or Paperclip lookup.

Evidence:

- `python3 -m unittest tests.test_telegram_qa_tool.TelegramQaToolConfigTests.test_health_checks_config_telegram_env_and_paperclip_company tests.test_telegram_qa_tool.TelegramQaToolConfigTests.test_run_without_live_ok_fails_before_telegram_side_effects tests.test_telegram_qa_tool.TelegramQaToolConfigTests.test_run_executes_suite_with_fake_telegram_and_paperclip -v` -> `Ran 3 tests ... OK`
- `node --check paperclip-qa-tool/bin/paperclip-qa.mjs` -> OK
- `node --check paperclip-qa-tool/src/health-check.mjs` -> OK

## Task 14: Run-Integrated Cleanup Result

**Files:**

- Create: `paperclip-qa-tool/src/cleanup-runner.mjs`
- Modify: `paperclip-qa-tool/bin/paperclip-qa.mjs`
- Test: `tests/test_telegram_qa_tool.py`

- [x] **Step 1: Add fake-adapter run cleanup test**

Assert `run --cleanup hard --live-ok`:

- sends Telegram test message;
- records Telegram messages in manifest;
- detects new Paperclip issue;
- calls Telegram delete for manifest message ids;
- calls Paperclip delete for manifest issue ids;
- returns cleanup result in JSON;
- writes cleanup result back to manifest.

- [x] **Step 2: Share cleanup implementation**

`cleanup-runner.mjs` now owns manifest-backed cleanup mutation so `cleanup` command and post-run cleanup use the same path.

Evidence:

- `python3 -m unittest tests.test_telegram_qa_tool.TelegramQaToolConfigTests.test_run_with_cleanup_returns_cleanup_result_and_updates_manifest -v` -> `Ran 1 test ... OK`
- `python3 -m unittest tests.test_telegram_userbot_driver tests.test_telegram_qa_tool -v` -> `Ran 30 tests ... OK`
- `node --check paperclip-qa-tool/bin/paperclip-qa.mjs` -> OK
- `node --check paperclip-qa-tool/src/cleanup-runner.mjs` -> OK

## Task 15: Run-Integrated Report And Bug Artifacts

**Files:**

- Modify: `paperclip-qa-tool/bin/paperclip-qa.mjs`
- Test: `tests/test_telegram_qa_tool.py`

- [x] **Step 1: Add run artifact assertions**

Assert completed `run --cleanup hard --live-ok` returns and writes:

- `manifest.json`;
- `REPORT.md`;
- `bugs.jsonl`;
- cleanup result.

- [x] **Step 2: Wire report writer into run**

After non-dry-run suite execution and cleanup, CLI writes report and bug JSONL through the same writers used by `report` and `bugs`.

- [x] **Step 3: Avoid duplicate bug artifacts**

`bugs.jsonl` deduplicates generated and manifest-provided bug records by stable `id`, so a retest/fix cycle gets one actionable bug per failed expectation.

Evidence:

- `python3 -m unittest tests.test_telegram_qa_tool.TelegramQaToolConfigTests.test_run_with_cleanup_returns_cleanup_result_and_updates_manifest -v` -> `Ran 1 test ... OK`
- `python3 -m unittest tests.test_telegram_userbot_driver tests.test_telegram_qa_tool -v` -> `Ran 31 tests ... OK`
- `node --check paperclip-qa-tool/bin/paperclip-qa.mjs` -> OK
- `node --check paperclip-qa-tool/src/report-writer.mjs` -> OK

## Task 16: Project-Neutral Tool And Plugin Metadata

**Files:**

- Modify: `paperclip-qa-tool/qa-tool.config.schema.json`
- Modify: `codex-plugins/telegram-paperclip-qa/.codex-plugin/plugin.json`
- Test: `tests/test_telegram_qa_tool.py`

- [x] **Step 1: Add neutrality regression test**

Assert universal tool/plugin metadata does not contain `inner-agora` or `The Inner Agora`.

- [x] **Step 2: Remove project identity from universal metadata**

Keep Inner Agora binding in `telegram-testing.config.json`, not in `paperclip-qa-tool` schema identity or Codex plugin author/developer metadata.

Evidence:

- `python3 -m unittest tests.test_telegram_qa_tool.TelegramQaToolConfigTests.test_universal_tool_metadata_is_project_neutral -v` -> OK after metadata fix

## Task 17: Live-Gated Retest Execution

**Files:**

- Modify: `paperclip-qa-tool/src/suite-runner.mjs`
- Modify: `paperclip-qa-tool/bin/paperclip-qa.mjs`
- Modify: `README.md`
- Modify: `docs/telegram-testing/TELEGRAM_TEST_CYCLE_PLAN.md`
- Test: `tests/test_telegram_qa_tool.py`

- [x] **Step 1: Add retest lifecycle tests**

Assert:

- non-dry retest fails before Telegram side effects without `--live-ok`;
- live-gated retest executes only previously failed test ids;
- live-gated retest writes cleanup, report, and bug artifacts.

- [x] **Step 2: Share suite execution path**

`run` and live `retest` now use the same execution path for Telegram send, Paperclip issue snapshotting, evaluation, manifest writing, cleanup, report, and bug artifacts.

Evidence:

- `python3 -m unittest tests.test_telegram_qa_tool.TelegramQaToolConfigTests.test_retest_dry_run_selects_previous_failed_tests_only tests.test_telegram_qa_tool.TelegramQaToolConfigTests.test_retest_without_live_ok_fails_before_telegram_side_effects tests.test_telegram_qa_tool.TelegramQaToolConfigTests.test_retest_live_executes_only_failed_tests_and_writes_artifacts -v` -> `Ran 3 tests ... OK`
- `node --check paperclip-qa-tool/bin/paperclip-qa.mjs` -> OK
- `node --check paperclip-qa-tool/src/suite-runner.mjs` -> OK

- [ ] **Step 5: Commit docs and live evidence**

Do not commit secrets or transcripts if policy says run artifacts stay ignored. Commit only docs/config/test updates:

```bash
git add README.md docs/telegram-testing/TELEGRAM_TEST_CYCLE_PLAN.md
git commit -m "Document Telegram QA tool workflow"
```

## Completion Criteria

The implementation is complete when:

- `paperclip-qa-tool` can run config-check, health, run, cleanup, report, bugs, retest, and bug-batch commands.
- `telegram-testing.config.json` validates and contains Inner Agora suites without hard-coding project details in tool source.
- Telegram cleanup deletes only manifest message ids.
- Paperclip cleanup attempts hard delete and falls back to hidden/cancelled.
- Reports and bugs are written per run.
- Codex QA skill/plugin exists and separates tester/developer/retest/release behavior.
- A controlled live help run passes and cleans itself.
- The full acceptance suite can be run later without changing architecture.
