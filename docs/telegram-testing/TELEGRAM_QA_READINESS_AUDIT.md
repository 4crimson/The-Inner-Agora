# Telegram QA Readiness Audit

Date: 2026-07-03

This audit checks the current Telegram/Paperclip QA harness against the product goal:

- universal `paperclip-qa-tool` runtime;
- Inner Agora binding through config only;
- Codex QA skill/plugin for tester, developer, retest, and release-review modes;
- no live side effects without explicit acknowledgement.

This file is intentionally not a live acceptance report. It is the pre-live readiness checkpoint that says what is already proven locally and what still needs a controlled Telegram/Paperclip run.

Machine-readable release status lives in [TELEGRAM_QA_COMPLETION_CHECKLIST.json](TELEGRAM_QA_COMPLETION_CHECKLIST.json).

## Current Decision

Status: **ready for explicit live acceptance**, not fully accepted yet.

Reason: the local runtime, config, cleanup logic, reports, bug batching, retest flow, plugin shape, and live preflight are covered by non-live tests. The remaining acceptance evidence requires a controlled live run because only Telegram/Paperclip can prove real message delivery, real Hermes behavior, real issue creation, real cleanup, and no visible residual roots after repeated runs.

## Non-Live Evidence

Use these commands before asking to touch the live system:

```bash
[ -f .env ] && set -a && source .env && set +a
python3 -m unittest tests.test_telegram_userbot_driver tests.test_telegram_qa_tool -v
node --check paperclip-qa-tool/bin/paperclip-qa.mjs
node --check paperclip-qa-tool/src/report-writer.mjs
node --check paperclip-qa-tool/src/config.mjs
node -e "JSON.parse(require('fs').readFileSync('codex-plugins/telegram-paperclip-qa/.codex-plugin/plugin.json','utf8')); JSON.parse(require('fs').readFileSync('telegram-testing.config.json','utf8')); console.log('json ok')"
node paperclip-qa-tool/bin/paperclip-qa.mjs config-check --config telegram-testing.config.json --json
node paperclip-qa-tool/bin/paperclip-qa.mjs completion-check --config telegram-testing.config.json --json
node paperclip-qa-tool/bin/paperclip-qa.mjs readiness --config telegram-testing.config.json --suite help --cleanup hard --json
node paperclip-qa-tool/bin/paperclip-qa.mjs live-plan --config telegram-testing.config.json --suite help --cleanup hard --json
node paperclip-qa-tool/bin/paperclip-qa.mjs run --config telegram-testing.config.json --suite help --dry-run --json
git diff -- . | rg -n "secret-token-or-api-hash-pattern"
```

Expected result:

- unit tests pass;
- syntax checks pass;
- JSON parses;
- `config-check` returns `ok: true`;
- `completion-check` returns `complete: false` until live-only blockers are satisfied;
- `readiness` returns `readyForLive: true` when config, health, suite preview, and acknowledgement gates pass;
- if `readiness` reports missing `TELEGRAM_API_ID` or `TELEGRAM_API_HASH`, load local `.env` into the shell before retrying;
- `live-plan` prints the exact acknowledgement and does not create run artifacts;
- dry-run creates only local ignored artifacts;
- secret scan returns no matches.

## Acceptance Gate Audit

| Gate | Current evidence | Status |
| --- | --- | --- |
| Full run creates a manifest with every Telegram and Paperclip artifact it created. | Manifest creation, fake Telegram, fake Paperclip, cleanup, and report tests cover the contract. Real artifact coverage still requires live run evidence. | Partially proven |
| Cleanup removes or hides every artifact in the manifest. | Unit tests cover Telegram delete by manifest ids, Paperclip hard-delete-first, and soft fallback. Live residual check still required. | Partially proven |
| Cleanup never touches an issue without exact run marker or manifest entry. | Cleanup tests cover manifest-scoped deletion and issue-tree handling. | Locally proven |
| Report separates product failures from infrastructure failures. | Report writer tests cover summaries, failures, cleanup, bugs, and redaction. | Locally proven |
| Bugs are reproducible through test ids. | Bug output and bug-batch tests cover test id grouping and selection. | Locally proven |
| Developer mode can consume a bug batch without reading raw transcripts first. | Codex skill references and bug-batch command are present and tested for workflow references. A real developer handoff still needs a failing live manifest. | Partially proven |
| Retest mode can prove a bug fixed or still failing. | Retest dry-run and fake-live tests cover rerunning failed test ids. Real proof needs a live failed-then-fixed cycle. | Partially proven |
| Running the full suite twice leaves no extra visible Paperclip roots. | Not provable without live Paperclip state. | Live evidence missing |
| The process stays local-model-first. | Config and workflow treat local route as acceptance concern. A live Hermes response must still be inspected for provider/model routing. | Partially proven |
| Runtime tool stays project-neutral; Inner Agora behavior lives in config. | Tests assert universal metadata is project-neutral; Inner Agora binding lives in `telegram-testing.config.json`. | Locally proven |
| Codex QA skill/plugin can independently govern tester/developer/retest/release modes. | Plugin manifest, SKILL.md, and mode reference files exist and are packaging-tested. | Locally proven |

## Live Acceptance Plan

Only run this after explicit operator approval for live side effects.

1. Run preflight:

```bash
[ -f .env ] && set -a && source .env && set +a
node paperclip-qa-tool/bin/paperclip-qa.mjs readiness --config telegram-testing.config.json --suite help --cleanup hard --json
node paperclip-qa-tool/bin/paperclip-qa.mjs live-plan --config telegram-testing.config.json --suite help --cleanup hard --json
node paperclip-qa-tool/bin/paperclip-qa.mjs health --config telegram-testing.config.json --json
node paperclip-qa-tool/bin/paperclip-qa.mjs run --config telegram-testing.config.json --suite help --cleanup hard --dry-run --json
```

2. Ask with the live-plan acknowledgement:

```text
This will send Telegram messages and may create Paperclip issues. Cleanup will run with hard-delete-first and soft fallback. Proceed?
```

3. If approved, run the controlled live help suite:

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs run --config telegram-testing.config.json --suite help --cleanup hard --live-ok --json
```

4. Inspect the resulting manifest and report:

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs report --config telegram-testing.config.json --run QA-... --json
node paperclip-qa-tool/bin/paperclip-qa.mjs acceptance --config telegram-testing.config.json --run QA-... --json
node paperclip-qa-tool/bin/paperclip-qa.mjs bug-batch --config telegram-testing.config.json --run QA-... --json
```

5. If the help suite is clean, repeat the same process for the full suite. If it is not clean, use tester mode to file bugs, developer mode to fix one area, and retest mode to rerun only failed test ids.

## Do Not Claim Complete Until

- live help run passes or produces accepted bug output;
- cleanup result reports no unreported residual Telegram/Paperclip artifacts;
- `ACCEPTANCE.md` exists for the live run;
- full-suite execution is either accepted or explicitly deferred with known risks;
- no secrets or raw transcripts are committed.
