---
name: telegram-paperclip-qa
description: Use for Telegram/Paperclip QA cycles, live Telegram acceptance testing, Paperclip Cockpit cleanup, tester mode, developer handoff, retest mode, release review, bug batching, and working with paperclip-qa-tool manifests/reports. Triggers when Codex must test Hermes/Paperclip through Telegram, separate QA from development, or govern live-side-effect workflows.
---

# Telegram Paperclip QA

Use this skill to keep Telegram/Paperclip QA work separated into explicit modes. Start every task by naming the active mode and the live-side-effect status.

## Core Rules

- Treat `hermes-plugins/paperclip-cockpit/qa-tool` as the runtime source of truth; `paperclip-qa-tool/bin/paperclip-qa.mjs` is a compatibility wrapper.
- Treat `manifest.json` as the cleanup source of truth.
- Do not run live Telegram or Paperclip-creating commands unless the user explicitly confirms that live side effects are allowed for this step.
- Do not edit code in tester mode.
- Do not claim a fix is done until retest mode has rerun the relevant failing test ids.
- Do not mix router, Telegram UI, Paperclip recovery, local-model routing, cleanup, and docs fixes in one developer batch.
- Keep local-model-first behavior as an acceptance concern, not a nice-to-have.

## Mode Selection

- For evidence gathering, use [tester-mode.md](references/tester-mode.md).
- For fixing accepted bug batches, use [developer-mode.md](references/developer-mode.md).
- For verifying a previous failure, use [retest-mode.md](references/retest-mode.md).
- For final acceptance, use [release-review-mode.md](references/release-review-mode.md).
- For bug shape, use [bug-template.md](references/bug-template.md).

## Safe Commands

Prefer non-live commands until an operator confirms live testing:

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs config-check --config telegram-testing.config.json --json
node paperclip-qa-tool/bin/paperclip-qa.mjs completion-check --config telegram-testing.config.json --json
node paperclip-qa-tool/bin/paperclip-qa.mjs release-plan --config telegram-testing.config.json --cleanup hard --json
node paperclip-qa-tool/bin/paperclip-qa.mjs profile-plugin-sync --config telegram-testing.config.json --json
node paperclip-qa-tool/bin/paperclip-qa.mjs readiness --config telegram-testing.config.json --suite help --cleanup hard --json
node paperclip-qa-tool/bin/paperclip-qa.mjs live-plan --config telegram-testing.config.json --suite help --cleanup hard --json
node paperclip-qa-tool/bin/paperclip-qa.mjs health --config telegram-testing.config.json --json
node paperclip-qa-tool/bin/paperclip-qa.mjs telegram-check --config telegram-testing.config.json --json
node paperclip-qa-tool/bin/paperclip-qa.mjs run --config telegram-testing.config.json --suite help --dry-run --json
node paperclip-qa-tool/bin/paperclip-qa.mjs report --config telegram-testing.config.json --run QA-... --json
node paperclip-qa-tool/bin/paperclip-qa.mjs summary --config telegram-testing.config.json --run QA-... --json
node paperclip-qa-tool/bin/paperclip-qa.mjs acceptance --config telegram-testing.config.json --run QA-... --json
node paperclip-qa-tool/bin/paperclip-qa.mjs release-gate --config telegram-testing.config.json --run QA-... --backup-id BACKUP_ID --profile-plugin-sync ok --json
node paperclip-qa-tool/bin/paperclip-qa.mjs evidence-checklist --config telegram-testing.config.json --release-gate artifacts/telegram-test-runs/release-gates/RG-.../release-gate.json --commit COMMIT --json
node paperclip-qa-tool/bin/paperclip-qa.mjs guard-repeat --config telegram-testing.config.json --run QA-... --backup-id BACKUP_ID --repair-command "node scripts/agora.mjs prepare local" --json
node paperclip-qa-tool/bin/paperclip-qa.mjs bugs --config telegram-testing.config.json --run QA-... --dry-run --json
node paperclip-qa-tool/bin/paperclip-qa.mjs bug-batch --config telegram-testing.config.json --run QA-... --json
node paperclip-qa-tool/bin/paperclip-qa.mjs bug-batch --config telegram-testing.config.json --run QA-... --area telegram-ui --json
node paperclip-qa-tool/bin/paperclip-qa.mjs retest --config telegram-testing.config.json --run QA-... --dry-run --json
```

Before a live run, say plainly:

```text
This will send Telegram messages and may create Paperclip issues. Cleanup will run with hard-delete-first and soft fallback. Proceed?
```

Proceed only after an affirmative answer for that specific run, and include `--live-ok` on the exact live command.
