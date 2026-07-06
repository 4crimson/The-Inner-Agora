# Telegram Paperclip QA Plugin

Codex workflow plugin for config-driven Telegram/Paperclip QA cycles.

## Layers

- `hermes-plugins/paperclip-cockpit/qa-tool/`: canonical runtime tool. It executes suites, writes manifests, cleans artifacts, generates reports, and can send retained Telegram result summaries.
- `paperclip-qa-tool/bin/paperclip-qa.mjs`: project compatibility wrapper to the canonical runtime.
- `telegram-testing.config.json`: project binding. It names the target Telegram bot, Paperclip company, suites, expectations, cleanup policy, and guard warning policy.
- `skills/telegram-paperclip-qa/`: Codex workflow discipline. It separates tester, developer, retest, and release-review modes.

## Use From Codex

Use the skill by naming the intended mode in plain language:

- `Use Telegram Paperclip QA tester mode` to gather evidence without patching code.
- `Use Telegram Paperclip QA developer mode` to fix one accepted bug area from `bug-batch`.
- `Use Telegram Paperclip QA retest mode` to rerun failed test ids from a previous manifest.
- `Use Telegram Paperclip QA release-review mode` to run goal-level gates and decide accepted, accepted-with-repair, or blocked.

Start every mode by stating whether live side effects are allowed. In normal review or planning, run only non-live gates first: `completion-check`, `release-plan`, `profile-plugin-sync`, `readiness`, `live-plan`, and dry-run commands. Live Telegram/Paperclip actions require explicit operator confirmation and the exact live command must include `--live-ok`.

## Non-Live Checks

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs config-check --config telegram-testing.config.json --json
node paperclip-qa-tool/bin/paperclip-qa.mjs completion-check --config telegram-testing.config.json --json
node paperclip-qa-tool/bin/paperclip-qa.mjs release-plan --config telegram-testing.config.json --cleanup hard --json
node paperclip-qa-tool/bin/paperclip-qa.mjs profile-plugin-sync --config telegram-testing.config.json --json
node paperclip-qa-tool/bin/paperclip-qa.mjs readiness --config telegram-testing.config.json --suite help --cleanup hard --json
node paperclip-qa-tool/bin/paperclip-qa.mjs live-plan --config telegram-testing.config.json --suite help --cleanup hard --json
node paperclip-qa-tool/bin/paperclip-qa.mjs health --config telegram-testing.config.json --json
node paperclip-qa-tool/bin/paperclip-qa.mjs run --config telegram-testing.config.json --suite help --dry-run --json
node paperclip-qa-tool/bin/paperclip-qa.mjs acceptance --config telegram-testing.config.json --run QA-... --json
node paperclip-qa-tool/bin/paperclip-qa.mjs summary --config telegram-testing.config.json --run QA-... --json
node paperclip-qa-tool/bin/paperclip-qa.mjs bug-batch --config telegram-testing.config.json --run QA-... --json
node paperclip-qa-tool/bin/paperclip-qa.mjs release-gate --config telegram-testing.config.json --run QA-... --backup-id BACKUP_ID --profile-plugin-sync ok --json
node paperclip-qa-tool/bin/paperclip-qa.mjs evidence-checklist --config telegram-testing.config.json --release-gate artifacts/telegram-test-runs/release-gates/RG-.../release-gate.json --commit COMMIT --json
```

Live runs, standalone cleanup, and retained Telegram notifications require explicit operator confirmation and the exact live command must include `--live-ok`.
