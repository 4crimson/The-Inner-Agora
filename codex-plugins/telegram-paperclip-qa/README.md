# Telegram Paperclip QA Plugin

Codex workflow plugin for config-driven Telegram/Paperclip QA cycles.

## Layers

- `paperclip-qa-tool/`: runtime tool. It executes suites, writes manifests, cleans artifacts, and generates reports.
- `telegram-testing.config.json`: project binding. It names the target Telegram bot, Paperclip company, suites, expectations, cleanup policy, and guard warning policy.
- `skills/telegram-paperclip-qa/`: Codex workflow discipline. It separates tester, developer, retest, and release-review modes.

## Non-Live Checks

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs config-check --config telegram-testing.config.json --json
node paperclip-qa-tool/bin/paperclip-qa.mjs completion-check --config telegram-testing.config.json --json
node paperclip-qa-tool/bin/paperclip-qa.mjs readiness --config telegram-testing.config.json --suite help --cleanup hard --json
node paperclip-qa-tool/bin/paperclip-qa.mjs live-plan --config telegram-testing.config.json --suite help --cleanup hard --json
node paperclip-qa-tool/bin/paperclip-qa.mjs health --config telegram-testing.config.json --json
node paperclip-qa-tool/bin/paperclip-qa.mjs run --config telegram-testing.config.json --suite help --dry-run --json
node paperclip-qa-tool/bin/paperclip-qa.mjs acceptance --config telegram-testing.config.json --run QA-... --json
node paperclip-qa-tool/bin/paperclip-qa.mjs bug-batch --config telegram-testing.config.json --run QA-... --json
```

Live runs require explicit operator confirmation and the exact live command must include `--live-ok`.
