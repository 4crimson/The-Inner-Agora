# Telegram Test Cycle Design

## Objective

Create a full live QA process for Telegram-based Agora testing. Codex should be able to act as a real Telegram user, run natural-language suites against Hermes and Paperclip, collect evidence, file bugs, pass bounded batches to development, retest fixes, and clean up all test artifacts.

This is intentionally larger than a smoke MVP. The design targets the end-state testing workflow needed to make Telegram feel like a reliable human interface to The Inner Agora.

## Context

The project already has:

- `scripts/telegram-userbot-driver.py` for userbot login, send, wait, and transcript capture.
- `scripts/inner-agora-guard.mjs` for live health checks.
- `scripts/agora-telegram-live-check.mjs` for detecting Paperclip roots after live Telegram messages.
- `scripts/paperclip-cockpit-telegram.mjs` for Bot API result/progress payloads.
- Paperclip issue update support for `hiddenAt`.
- Paperclip CLI support for `issue delete`, though live `DELETE /api/issues/:id` returned `500` on 2026-07-03.

The missing piece is a run-level orchestrator that owns identity, evidence, cleanup, and bug handoff.

## Architecture

Add a future `scripts/telegram-test-cycle.mjs` runner with these internal modules:

- `RunManifest`: creates `runId`, run directory, manifest, and append-only updates.
- `TelegramClient`: wraps the existing userbot driver or Telethon session for send, capture, and delete.
- `PaperclipTracker`: snapshots company issues, detects new marked roots, walks child trees, and records created issues.
- `SuiteRegistry`: defines test suites and expected results.
- `Evaluator`: compares Telegram/Paperclip observations with expected outcomes.
- `BugWriter`: emits `bugs.jsonl` and Markdown report sections.
- `CleanupEngine`: deletes Telegram messages and hard-deletes or soft-hides Paperclip issues from the manifest.

All live side effects must flow through the manifest.

## Data Flow

1. Health preflight runs guard, gateway, Telegram token, userbot auth, Paperclip health, and profile sync checks.
2. Runner creates `runId` and baseline Paperclip snapshot.
3. Runner sends Telegram test messages. Paperclip-creating phrases include `[qa:<runId>]`.
4. Runner captures replies and stores Telegram message ids.
5. Runner watches Paperclip for roots and child issues related to the run marker.
6. Evaluator checks expected outcomes and writes test results.
7. BugWriter creates structured bug entries for failures.
8. CleanupEngine runs according to `--cleanup hard|soft|none`.
9. Report records pass/fail, bugs, cleanup actions, and residuals.

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

## Open Decisions

- Whether to keep QA transcripts after cleanup or delete them by default.
- Whether reports should append automatically to `docs/roadmap/BUGS.md` or stay run-local until reviewed.
- Whether `THE-82`/`THE-74` style meaningful live checks should be classified as QA artifacts or retained as useful Agora sessions.

## User Review Gate

Before implementation, review:

- whether visible `[qa:<runId>]` markers are acceptable in test prompts;
- whether hard-delete-first plus soft fallback is acceptable;
- whether run-local bug reports should auto-append to roadmap bugs or require approval.
