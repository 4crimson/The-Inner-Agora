# Telegram Paperclip QA Tool And Codex Skill Design

## Objective

Create a two-layer live QA system for Telegram/Paperclip projects. The runtime layer is a universal Paperclip QA tool that can act as a real Telegram user, run configured suites, collect evidence, and clean up artifacts. The Codex layer is a QA skill/plugin that tells Codex how to behave in tester, developer handoff, retest, and release-review modes.

This is intentionally larger than a smoke MVP. The design targets the end-state testing workflow needed to make Telegram feel like a reliable human interface to The Inner Agora while keeping the runtime tool reusable for future Paperclip Cockpit projects.

## Context

The project already has:

- `scripts/telegram-userbot-driver.py` for userbot login, send, wait, and transcript capture.
- `scripts/inner-agora-guard.mjs` for live health checks.
- `scripts/agora-telegram-live-check.mjs` for detecting Paperclip roots after live Telegram messages.
- `scripts/paperclip-cockpit-telegram.mjs` for Bot API result/progress payloads.
- Paperclip issue update support for `hiddenAt`.
- Paperclip CLI support for `issue delete`, though live `DELETE /api/issues/:id` returned `500` on 2026-07-03.

The missing pieces are:

- a reusable run-level QA tool that owns identity, evidence, cleanup, and bug output;
- an Inner Agora project config that describes this project's bot, company, suites, and expectations;
- a Codex QA skill/plugin that enforces the working modes and prevents mixing testing with development.

## Architecture

Use three explicit boundaries:

```text
paperclip-qa-tool/                  # universal runtime tool
telegram-testing.config.json        # Inner Agora project config
codex-plugins/telegram-paperclip-qa # Codex workflow plugin/skill
```

The universal tool receives config and environment credentials, runs suites, writes manifests/reports/bugs, and cleans up artifacts. It must not know Agora-specific concepts such as philosophers, Plato, Heidegger, chambers, or synthesis semantics beyond what the config expresses as expectations.

The Inner Agora config binds the generic tool to `@crimson_philosophs_bot`, the `The Inner Agora` Paperclip company, local-model expectations, and the project's suite matrix.

The Codex plugin/skill tells the agent how to operate:

1. Tester mode: run suites and collect evidence, do not patch code.
2. Bug triage mode: group failures by area and severity.
3. Developer mode: fix one bounded area at a time.
4. Retest mode: rerun previous failing test ids.
5. Release review mode: run the full suite, clean up, and report acceptance.

The runtime tool modules are:

- `RunManifest`: creates `runId`, run directory, manifest, and append-only updates.
- `TelegramClient`: wraps the existing userbot driver or Telethon session for send, capture, and delete.
- `PaperclipTracker`: snapshots company issues, detects new marked roots, walks child trees, and records created issues.
- `SuiteRegistry`: defines test suites and expected results.
- `Evaluator`: compares Telegram/Paperclip observations with expected outcomes.
- `BugWriter`: emits `bugs.jsonl` and Markdown report sections.
- `CleanupEngine`: deletes Telegram messages and hard-deletes or soft-hides Paperclip issues from the manifest.

All live side effects must flow through the manifest.

## Data Flow

1. Codex QA skill selects a mode and refuses to mix roles.
2. Runtime tool loads `telegram-testing.config.json` and validates it against `paperclip-qa-tool/qa-tool.config.schema.json`.
3. Health preflight runs guard, gateway, Telegram token, userbot auth, Paperclip health, and profile sync checks.
4. Runner creates `runId` and baseline Paperclip snapshot.
5. Runner sends Telegram test messages. Paperclip-creating phrases include `[qa:<runId>]`.
6. Runner captures replies and stores Telegram message ids.
7. Runner watches Paperclip for roots and child issues related to the run marker.
8. Evaluator checks expected outcomes and writes test results.
9. BugWriter creates structured bug entries for failures.
10. CleanupEngine runs according to `--cleanup hard|soft|none`.
11. Report records pass/fail, bugs, cleanup actions, and residuals.

## Cleanup Semantics

Hard cleanup is preferred, but must be guarded.

Telegram:

- delete only message ids recorded in the manifest;
- use revoke/delete-for-everyone where available;
- report residuals.

Paperclip:

- delete child issues before parent issues;
- only delete issues in the manifest or issues with exact `[qa:<runId>]`;
- try `DELETE /api/issues/:id`;
- if hard delete fails, patch `hiddenAt` and `status=cancelled` where appropriate;
- report hard-delete failures as cleanup bugs.

## Universal Tool File Shape

Planned runtime files:

```text
paperclip-qa-tool/
  README.md
  qa-tool.config.schema.json
  bin/
    paperclip-qa.mjs
  src/
    cleanup-engine.mjs
    evaluator.mjs
    manifest.mjs
    paperclip-client.mjs
    report-writer.mjs
    suite-runner.mjs
    telegram-userbot.mjs
  suites/
    generic-health.json
    generic-telegram-help.json
```

Project config:

```text
telegram-testing.config.json
```

Codex workflow plugin:

```text
codex-plugins/telegram-paperclip-qa/
  .codex-plugin/plugin.json
  skills/
    telegram-paperclip-qa/
      SKILL.md
      references/
        bug-template.md
        developer-mode.md
        release-review-mode.md
        retest-mode.md
        tester-mode.md
```

## Test Coverage

The target suite set is:

- health;
- help/menu;
- natural dialogue;
- council creation;
- progress;
- synthesis/result formatting;
- inline buttons/callbacks;
- error recovery;
- per-chat state;
- cleanup.

The detailed test matrix lives in `docs/telegram-testing/TELEGRAM_TEST_CYCLE_PLAN.md`.

## Error Handling

The runner separates failures into:

- `product`: user-visible behavior is wrong;
- `infrastructure`: Telegram/Paperclip/Hermes is unavailable;
- `cleanup`: artifacts could not be deleted/hidden;
- `test-harness`: the runner could not observe or classify the outcome.

Each failure includes evidence and acceptance criteria. No raw secrets are written to reports.

## Acceptance Criteria

- Full runs create a complete manifest.
- Paperclip-creating tests carry exact run markers.
- Cleanup is idempotent.
- Hard delete is attempted when requested.
- Soft cleanup hides/cancels issues when hard delete fails.
- Telegram test messages are removed by message id.
- Bug reports are grouped by area for developer batches.
- Retests can reference previous failing test ids.
- No production Paperclip issues are touched without explicit manual inclusion.
- The universal tool has no Inner Agora philosopher/chamber literals outside test config fixtures.
- The Codex skill/plugin can be read independently and tells the agent not to patch code while in tester mode.

## Open Decisions

- Whether to keep QA transcripts after cleanup or delete them by default.
- Whether reports should append automatically to `docs/roadmap/BUGS.md` or stay run-local until reviewed.
- Whether `THE-82`/`THE-74` style meaningful live checks should be classified as QA artifacts or retained as useful Agora sessions.
- Whether the Codex plugin should live in this repository first (`codex-plugins/telegram-paperclip-qa`) or be promoted immediately to a personal marketplace plugin under `~/plugins`.

## User Review Gate

Before implementation, review:

- whether visible `[qa:<runId>]` markers are acceptable in test prompts;
- whether hard-delete-first plus soft fallback is acceptable;
- whether run-local bug reports should auto-append to roadmap bugs or require approval.
- whether the repo-local Codex plugin path is acceptable for the first implementation pass.
