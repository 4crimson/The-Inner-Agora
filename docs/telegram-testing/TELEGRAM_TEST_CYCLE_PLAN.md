# Telegram Test Cycle Plan

Date: 2026-07-03

## Goal

Build a repeatable live Telegram QA loop where Codex can act as a real Telegram user, run natural-language test suites against Hermes/Paperclip, collect evidence, file bugs, hand batches to development, retest fixes, and clean up all test artifacts after each cycle.

The target is not a minimal smoke script. The target is a full acceptance harness for the product idea: Telegram should feel like a human interface to Hermes and Paperclip, powered by local models, with visible progress, useful buttons, reliable synthesis, readable errors, and no hidden stale-state surprises.

The implementation should be split into two layers:

1. `paperclip-qa-tool`: a universal runtime tool that knows how to run Telegram/Paperclip QA cycles from config.
2. `telegram-paperclip-qa`: a Codex skill/plugin that defines tester, developer, retest, and release-review behavior for Codex.

The Inner Agora should be one project configuration for the universal tool, not the tool's hard-coded domain.

## Product Principle

Live tests are allowed, but every test run must be accountable and reversible.

Every run gets a unique `runId`, every Telegram message and Paperclip issue created by the run is captured in a manifest, and cleanup only touches artifacts in that manifest. Time windows may help detect artifacts, but time alone is never enough to delete anything.

## Layer Boundaries

### Universal Runtime Tool

Planned location:

```text
paperclip-qa-tool/
```

Responsibilities:

- validate QA config;
- run health checks;
- send/capture/delete Telegram messages;
- snapshot and track Paperclip issues;
- evaluate suite expectations;
- write manifest, reports, and bug JSONL;
- clean up Telegram and Paperclip artifacts.

The universal tool must not contain Inner Agora-specific philosopher, chamber, or synthesis literals. Those belong in project config and suite definitions.

### Inner Agora Project Config

Planned location:

```text
telegram-testing.config.json
```

Responsibilities:

- bind the generic tool to `@crimson_philosophs_bot`;
- name the `The Inner Agora` Paperclip company;
- define suites, phrases, and expected results;
- list known guard warnings in `guards.allowWarnings[]`, each with a `name` and `reason`;
- define cleanup policy.

`guards.allowWarnings` is an operator-facing policy list for pre-run review. It does not make live guard failures pass by itself; live acceptance still needs either a resolved guard or an explicit operator override note.

### Codex QA Skill/Plugin

Planned location:

```text
codex-plugins/telegram-paperclip-qa/
```

Responsibilities:

- tell Codex which mode it is in;
- forbid code changes in tester mode;
- require bug grouping before developer mode;
- require retest after fixes;
- require release-review report before claiming acceptance.

## Roles

### Tester Mode

Tester mode talks to `@crimson_philosophs_bot` through the Telegram userbot as a normal human would. It does not patch code. It records:

- input phrase;
- Telegram message ids;
- bot replies;
- Paperclip roots and children;
- synthesis/progress/button behavior;
- logs relevant to failures;
- bug candidates with evidence.

### Developer Mode

Developer mode consumes a batch of accepted bugs. It does not run open-ended live experiments unless the bug requires a live reproduction step. It fixes one bounded area at a time: router, Telegram UI, Paperclip recovery, cleanup, or local-model routing.

### Retest Mode

Retest mode reruns the failing tests from a previous run, using the same suite and expected results. It marks bugs fixed, still failing, or changed.

### Release Review Mode

Release review mode runs the full acceptance suite and produces a final report. It does not fix code. It decides whether the current system is acceptable for normal use.

## Run Identity

Each cycle creates:

```text
artifacts/telegram-test-runs/<runId>/
  manifest.json
  REPORT.md
  ACCEPTANCE.md
  bugs.jsonl
  transcripts/
  paperclip-before.json
  paperclip-after.json
  cleanup-report.json
```

`runId` format:

```text
QA-YYYYMMDD-HHMM-<suite>-<short-random>
```

Example:

```text
QA-20260703-1420-smoke-a7f2
```

## Test Marker

Each destructive or Paperclip-creating test message includes a visible marker:

```text
[qa:<runId>]
```

Example:

```text
глубокое исследование: как заботу не превратить в контроль [qa:QA-20260703-1420-council-a7f2]
```

This is less natural than a pure user phrase, but it is required for safe cleanup. Pure unmarked tests are allowed only for non-creating flows such as help, ping, or button rendering checks, and they still record Telegram message ids in the manifest.

## Manifest Contract

`manifest.json` is the source of truth for cleanup.

Required fields:

```json
{
  "runId": "QA-20260703-1420-smoke-a7f2",
  "suite": "smoke",
  "startedAt": "2026-07-03T14:20:00.000Z",
  "finishedAt": null,
  "telegram": {
    "target": "@crimson_philosophs_bot",
    "userId": "6865326524",
    "chatId": "6865326524",
    "messages": []
  },
  "paperclip": {
    "companyId": "20a10ec7-7ddc-42ac-a474-beebb574b028",
    "roots": [],
    "issues": []
  },
  "tests": [],
  "bugs": [],
  "cleanup": {
    "mode": "hard",
    "attemptedAt": null,
    "telegram": [],
    "paperclip": [],
    "residuals": []
  }
}
```

Telegram message entries include `messageId`, `direction`, `date`, `text`, and `testId`.

Paperclip issue entries include `id`, `identifier`, `parentId`, `title`, `status`, `createdAt`, `hiddenAt`, `deletedAt`, `testId`, and `matchedBy` (`runId`, `manifest`, or `manual`).

## Cleanup Policy

Cleanup is always idempotent. Running it twice must be safe.

### Telegram Cleanup

Use the userbot session to delete recorded message ids with revoke enabled.

Rules:

- delete only message ids in the manifest;
- include both outgoing userbot messages and bot replies;
- do not delete user-owned production chats;
- if Telegram refuses deletion, record a residual.

### Paperclip Cleanup

Preferred mode is hard delete:

```http
DELETE /api/issues/:id
```

Delete child issues before parents. If a root has children, cleanup walks the tree bottom-up.

If hard delete fails, fallback is soft cleanup:

```http
PATCH /api/issues/:id
{
  "hiddenAt": "<now>",
  "status": "cancelled"
}
```

Known live finding on 2026-07-03: `DELETE /api/issues/:id` exists in the Paperclip CLI, but current live calls returned `500 Internal server error`. The cleanup runner must therefore implement hard-delete-first with soft-hide fallback and report the hard-delete failure as a product/runtime bug.

Paperclip cleanup may only touch issues that satisfy at least one of:

- issue id is already in the manifest;
- root/description/comment contains exact `[qa:<runId>]`;
- operator explicitly added the issue to the manifest with `matchedBy: "manual"`.

## Suites

### 1. Health Suite

Purpose: prove live infrastructure is ready before destructive tests.

Tests:

- `guard`: run `node scripts/inner-agora-guard.mjs --json`.
- `gateway`: verify Hermes gateway is supervised and connected.
- `telegram-getme`: verify the token resolves to `crimson_philosophs_bot`.
- `userbot-auth`: verify the userbot can resolve and message the bot.
- `paperclip-health`: verify Paperclip API health and company lookup.
- `profile-sync`: detect stale installed plugin vs repo plugin.

Expected result:

- critical checks pass;
- non-critical warnings are listed before the run starts;
- if guard is red due to known unrelated issues, the run requires an explicit override note.

### 2. Help And Menu Suite

Purpose: service/help intents must not create Paperclip work.

Test phrases:

- `агора помощь`
- `помощь агора`
- `что ты умеешь в агоре?`
- `/start`

Expected result:

- bot returns local help/menu text;
- no new Paperclip root is created;
- no philosopher voices are selected;
- no provider raw channel tokens appear;
- buttons are present where supported.

### 3. Natural Dialogue Suite

Purpose: Hermes should feel like a human assistant, not a command shell.

Test phrases:

- `хочу разобраться с вопросом свободы взрослого ребенка`
- `а можешь спросить пару философов, но не слишком глубоко`
- `давай глубже`
- `что там по последней сессии?`
- `покажи только Платона`

Expected result:

- assistant asks one useful clarification when needed;
- assistant does not invent completed work;
- follow-ups attach to the latest relevant session;
- role-specific detail is readable and has navigation back to synthesis.

### 4. Council Creation Suite

Purpose: ordinary language creates the right Paperclip task tree through local model routing.

Test phrases:

- `быстрый совет: что такое свобода ребенка когда ему 18-20 лет [qa:<runId>]`
- `глубокое исследование: как заботу не превратить в контроль [qa:<runId>]`
- `совет философов: в чем разница между заботой и властью [qa:<runId>]`

Expected result:

- root issue is created;
- selected voices are reasonable and explained or inspectable;
- route is local (`hermes_local`, expected model);
- no shell `/agora: command not found` behavior;
- task tree is linked under the active Agora manager/root;
- test marker is preserved somewhere discoverable for cleanup.

### 5. Progress Suite

Purpose: long-running work should not leave the user in silence.

Expected result:

- progress message appears after configured delay;
- progress updates are idempotent;
- message shows done/waiting voices;
- progress does not spam;
- completion replaces or is clearly separate from progress.

### 6. Synthesis And Result Suite

Purpose: final answer should be readable, useful, and navigable.

Expected result:

- final synthesis arrives after voices complete;
- formatting is compact and readable in Telegram;
- inline buttons include synthesis, individual voices, all voices, clarify/follow-up, and useful presets;
- no duplicated final answer body;
- no raw provider/control tokens such as `<|channel>` leak.

### 7. Button And Callback Suite

Purpose: result buttons should work from synthesis and voice views.

Actions:

- tap synthesis;
- tap a philosopher;
- tap all voices;
- tap clarify;
- tap quick/deep/go-no-go preset if present.

Expected result:

- callback is authorized;
- callback produces a visible answer or action;
- unauthorized callback is rejected politely;
- callback output has the same navigation surface as normal output.

### 8. Error Recovery Suite

Purpose: runtime failures should become human recovery messages.

Cases:

- Paperclip terminated ancestor / invalid hierarchy;
- provider timeout;
- local model unavailable;
- command/action missing;
- Telegram flood control;
- stale Hermes session;
- monitor not running;
- hard-delete cleanup failure.

Expected result:

- user sees short Russian recovery message;
- raw stack trace/stderr is not sent to Telegram;
- logs/report keep technical details;
- guard suggests the next recovery command when possible.

### 9. Per-Chat State Suite

Purpose: two Telegram chats must not share state.

Expected result:

- each chat has independent mode, latest session, wizard state, and chamber;
- callbacks use the originating chat state;
- cleanup for one run does not touch another chat.

### 10. Cleanup Suite

Purpose: each test cycle leaves no test artifacts behind.

Expected result:

- Telegram test messages are deleted;
- Paperclip test roots and children are hard-deleted when possible;
- if hard delete fails, issues are hidden and cancelled;
- residuals are explicit;
- repeat cleanup is safe;
- production issues are untouched.

## Bug Pipeline

The runner writes `bugs.jsonl`. Each bug has:

```json
{
  "id": "TQA-001",
  "severity": "P0|P1|P2|P3",
  "area": "router|telegram-ui|paperclip-recovery|cleanup|local-model|state|docs",
  "testId": "help.basic",
  "symptom": "",
  "expected": "",
  "actual": "",
  "evidence": {
    "telegramMessageIds": [],
    "paperclipIssueRefs": [],
    "logSnippets": [],
    "transcript": ""
  },
  "rootCauseHypothesis": "",
  "acceptanceCriteria": []
}
```

Batching rules:

- P0/P1 bugs block full acceptance.
- `bug-batch --run QA-...` groups bugs by area and severity before development.
- `bug-batch --run QA-... --area AREA` creates a one-area developer handoff.
- One development batch fixes one area only.
- Retest uses the original failing test ids.

## Commands

Implemented local-safe interface:

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs config-check --config telegram-testing.config.json --json
node paperclip-qa-tool/bin/paperclip-qa.mjs live-plan --config telegram-testing.config.json --suite help --cleanup hard --json
node paperclip-qa-tool/bin/paperclip-qa.mjs health --config telegram-testing.config.json --json
node paperclip-qa-tool/bin/paperclip-qa.mjs telegram-check --config telegram-testing.config.json --json
node paperclip-qa-tool/bin/paperclip-qa.mjs run --config telegram-testing.config.json --suite help --dry-run --json
node paperclip-qa-tool/bin/paperclip-qa.mjs report --config telegram-testing.config.json --run QA-...
node paperclip-qa-tool/bin/paperclip-qa.mjs acceptance --config telegram-testing.config.json --run QA-...
node paperclip-qa-tool/bin/paperclip-qa.mjs bugs --config telegram-testing.config.json --run QA-... --append-doc docs/roadmap/BUGS.md --dry-run
node paperclip-qa-tool/bin/paperclip-qa.mjs bug-batch --config telegram-testing.config.json --run QA-... --json
node paperclip-qa-tool/bin/paperclip-qa.mjs bug-batch --config telegram-testing.config.json --run QA-... --area telegram-ui --json
node paperclip-qa-tool/bin/paperclip-qa.mjs retest --config telegram-testing.config.json --run QA-... --dry-run --json
node paperclip-qa-tool/bin/paperclip-qa.mjs retest --config telegram-testing.config.json --run QA-... --cleanup hard --live-ok --json
node paperclip-qa-tool/bin/paperclip-qa.mjs cleanup --config telegram-testing.config.json --run QA-... --mode hard --json
```

When `run` or `retest` is invoked with `--cleanup hard|soft`, cleanup runs automatically after suite execution and the cleanup result is written into `manifest.json`. Completed non-dry runs also write `REPORT.md`, `ACCEPTANCE.md`, and `bugs.jsonl` in the run directory.

Live suites require explicit operator confirmation immediately before the run:

```text
This will send Telegram messages and may create Paperclip issues. Cleanup will run with hard-delete-first and soft fallback. Proceed?
```

After confirmation, the live command must include `--live-ok`.

Planned live interface:

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs health --config telegram-testing.config.json
node paperclip-qa-tool/bin/paperclip-qa.mjs live-plan --config telegram-testing.config.json --suite full --cleanup hard --json
node paperclip-qa-tool/bin/paperclip-qa.mjs run --config telegram-testing.config.json --suite smoke --cleanup hard --live-ok
node paperclip-qa-tool/bin/paperclip-qa.mjs run --config telegram-testing.config.json --suite full --cleanup hard --live-ok
node paperclip-qa-tool/bin/paperclip-qa.mjs retest --config telegram-testing.config.json --run QA-... --cleanup hard --live-ok
node paperclip-qa-tool/bin/paperclip-qa.mjs cleanup --config telegram-testing.config.json --run QA-... --mode hard
node paperclip-qa-tool/bin/paperclip-qa.mjs report --config telegram-testing.config.json --run QA-...
node paperclip-qa-tool/bin/paperclip-qa.mjs acceptance --config telegram-testing.config.json --run QA-...
node paperclip-qa-tool/bin/paperclip-qa.mjs bugs --config telegram-testing.config.json --run QA-... --append-doc docs/roadmap/BUGS.md
```

Useful safety flags:

```bash
--dry-run
--no-cleanup
--cleanup hard|soft|none
--allow-known-guard-error <name>
--max-paperclip-roots <n>
--timeout <seconds>
--json
```

## Acceptance Gates

The full Telegram QA harness is acceptable when:

1. A full run creates a manifest with every Telegram and Paperclip artifact it created.
2. Cleanup removes or hides every artifact in the manifest.
3. Cleanup never touches an issue without the exact run marker or manifest entry.
4. The report separates product failures from infrastructure failures.
5. Bugs are reproducible through test ids.
6. Developer mode can consume a bug batch without reading raw transcripts first.
7. Retest mode can prove a bug fixed or still failing.
8. Running the full suite twice leaves no extra visible Paperclip roots.
9. The process stays local-model-first.
10. The runtime tool stays project-neutral; Inner Agora behavior lives in `telegram-testing.config.json`.
11. The Codex QA skill/plugin can be used independently to govern tester/developer/retest/release modes.

See [TELEGRAM_QA_READINESS_AUDIT.md](TELEGRAM_QA_READINESS_AUDIT.md) for the current requirement-by-requirement evidence audit before live acceptance.

## Known Constraints

- Telegram has no invisible metadata for normal messages, so Paperclip-creating QA phrases need a visible `[qa:<runId>]` marker.
- Telegram deletion can fail for old or inaccessible messages; residuals must be reported.
- Paperclip hard delete currently returns 500 in live testing; soft hide/cancel is required as fallback.
- Some test flows intentionally create real Paperclip work before cleanup.
- Cleanup is not a substitute for a QA chamber; it is a safety rail for live acceptance.

## Next Implementation Plan

The implementation should be built in phases, but the target remains the full system:

1. Add universal tool skeleton and config schema under `paperclip-qa-tool/`.
2. Add manifest and run directory primitives.
3. Add Telegram userbot adapter for send/capture/delete.
4. Add Paperclip scanner and tree cleanup with hard-delete-first fallback.
5. Add suite registry and expected-result evaluators.
6. Add report and bug JSONL generator.
7. Add Inner Agora `telegram-testing.config.json`.
8. Add retest and bug-batch modes.
9. Add Codex QA skill/plugin under `codex-plugins/telegram-paperclip-qa/`.
10. Run a controlled live acceptance cycle and clean it up.
