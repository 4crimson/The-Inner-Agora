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
node paperclip-qa-tool/bin/paperclip-qa.mjs release-live-gate --config telegram-testing.config.json --suite help --run QA-... --backup-id BACKUP_ID --profile-plugin-sync ok --commit COMMIT --json
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
node paperclip-qa-tool/bin/paperclip-qa.mjs guard-repeat --config telegram-testing.config.json --run QA-... --backup-id BACKUP_ID --repair-command "node scripts/agora.mjs prepare local" --json
```

Use `release-live-gate` after a suite run has produced run evidence, or with
`--live-ok` to execute one suite end-to-end. Without `--live-ok`, it writes
`release-live-gate.json` / `RELEASE_LIVE_GATE.md`, runs profile/plugin sync
preflight, delegates to `release-gate` and `evidence-checklist`, and returns
`accepted`, `accepted_with_repair`, or `blocked` without live side effects. With
`--live-ok`, it first creates a read-only Paperclip backup from the configured
company, runs the suite, cleanup, configured guards, acceptance artifacts,
`release-gate`, and `evidence-checklist`.

Use `guard-repeat` only after a red post-suite guard has been repaired manually
and a repair backup id exists. It records `repairBackup`, `repairCommand`, and
`guardRepeat` in the manifest so acceptance and release-gate can report
`accept-with-repair` / `accepted_with_repair` instead of a clean pass.

Live runs, standalone cleanup, and retained Telegram notifications require explicit operator confirmation and the exact live command must include `--live-ok`.
