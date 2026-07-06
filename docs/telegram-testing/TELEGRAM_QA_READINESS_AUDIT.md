# Telegram QA Readiness Audit

Date: 2026-07-06

This audit checks the current Telegram/Paperclip QA harness against the product goal:

- universal `paperclip-cockpit/qa-tool` runtime, with `paperclip-qa-tool/bin/paperclip-qa.mjs` kept as a compatibility wrapper;
- Inner Agora binding through config only;
- Codex QA skill/plugin for tester, developer, retest, and release-review modes;
- no live side effects without explicit acknowledgement.

This file started as the pre-live readiness checkpoint. As of 2026-07-06 it also records the current completion-check decision after focused live release gates were run for all release suites.

Machine-readable release status lives in [TELEGRAM_QA_COMPLETION_CHECKLIST.json](TELEGRAM_QA_COMPLETION_CHECKLIST.json).

## Current Decision

Status: **release-focused live accepted**, not fully complete yet.

Reason: focused `release-live-gate` evidence now exists for `help`, `service-commands`, `mode-routing`, `natural-dialogue`, `interface-contract-topics`, and `council-create`. The remaining blockers are not first-run live approval blockers: they are stricter workflow evidence gaps for a real failing-live developer handoff, a real failed-then-fixed retest cycle, and a literal full-suite repeat in one release-plan sequence.

## Non-Live Evidence

Use these commands before asking to touch the live system:

```bash
[ -f .env ] && set -a && source .env && set +a
python3 -m unittest tests.test_telegram_userbot_driver tests.test_telegram_qa_tool -v
node --check paperclip-qa-tool/bin/paperclip-qa.mjs
node --check hermes-plugins/paperclip-cockpit/qa-tool/bin/paperclip-qa.mjs
node --check hermes-plugins/paperclip-cockpit/qa-tool/src/report-writer.mjs
node --check hermes-plugins/paperclip-cockpit/qa-tool/src/config.mjs
node -e "JSON.parse(require('fs').readFileSync('hermes-plugins/paperclip-cockpit/codex-plugin/telegram-paperclip-qa/.codex-plugin/plugin.json','utf8')); JSON.parse(require('fs').readFileSync('telegram-testing.config.json','utf8')); console.log('json ok')"
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
- `completion-check` returns `complete: false`, `missingLiveEvidence: 0`, and partial workflow blockers until the stricter handoff/retest/full-repeat evidence is closed;
- `readiness` returns `readyForLive: true` when config, health, suite preview, and acknowledgement gates pass;
- if `readiness` reports missing `TELEGRAM_API_ID` or `TELEGRAM_API_HASH`, load local `.env` into the shell before retrying;
- if the userbot virtualenv is used, set `TELEGRAM_USERBOT_PYTHON=.venv-telegram-userbot/bin/python` so the QA runner uses the Python where Telethon is installed;
- `live-plan` prints the exact acknowledgement and does not create run artifacts;
- dry-run creates only local ignored artifacts;
- secret scan returns no matches.

## Acceptance Gate Audit

| Gate | Current evidence | Status |
| --- | --- | --- |
| Full run creates a manifest with every Telegram and Paperclip artifact it created. | Manifest creation, fake Telegram, fake Paperclip, cleanup, report tests, and focused live suite manifests cover the contract. Literal monolithic full-suite repeat remains stricter evidence. | Partially proven |
| Cleanup removes or hides every artifact in the manifest. | Unit tests cover Telegram delete by manifest ids, Paperclip hard-delete-first, soft fallback, and active-run-safe cleanup. Focused live release gates reported cleanup residuals `0`. | Proven for focused release suites |
| Cleanup never touches an issue without exact run marker or manifest entry. | Cleanup tests cover manifest-scoped deletion and issue-tree handling. | Locally proven |
| Report separates product failures from infrastructure failures. | Report writer tests cover summaries, failures, cleanup, bugs, and redaction. | Locally proven |
| Bugs are reproducible through test ids. | Bug output and bug-batch tests cover test id grouping and selection. | Locally proven |
| Developer mode can consume a bug batch without reading raw transcripts first. | Codex skill references and bug-batch command are present and tested for workflow references. A real developer handoff still needs a failing live manifest. | Partially proven |
| Retest mode can prove a bug fixed or still failing. | Retest dry-run and fake-live tests cover rerunning failed test ids. Real proof needs a live failed-then-fixed cycle. | Partially proven |
| Running the full suite twice leaves no extra visible Paperclip roots. | Every release suite has focused live evidence with cleanup residuals `0`; the literal full-suite repeat in one release-plan sequence was not run. | Partially proven |
| The process stays local-model-first. | Profile/plugin sync and `inner-agora-guard` verify the live profile, adapter, model, and plugin state before/after release gates. | Proven for current profile |
| Runtime tool stays project-neutral; Inner Agora behavior lives in config. | Tests assert universal metadata is project-neutral; Inner Agora binding lives in `telegram-testing.config.json`. | Locally proven |
| Codex QA skill/plugin can independently govern tester/developer/retest/release modes. | Plugin manifest, SKILL.md, and mode reference files exist and are packaging-tested. | Locally proven |

## Live Acceptance Plan

Use this only when a stricter live lane still needs fresh evidence. Operator approval for live side effects was granted on 2026-07-05, but each new live run should still be intentional and scoped.

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

3. If fresh evidence is required, run the scoped suite:

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs release-live-gate --config telegram-testing.config.json --suite help --cleanup hard --live-ok --json
```

4. Inspect the resulting manifest and report:

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs report --config telegram-testing.config.json --run QA-... --json
node paperclip-qa-tool/bin/paperclip-qa.mjs summary --config telegram-testing.config.json --run QA-... --json
node paperclip-qa-tool/bin/paperclip-qa.mjs acceptance --config telegram-testing.config.json --run QA-... --json
node paperclip-qa-tool/bin/paperclip-qa.mjs bug-batch --config telegram-testing.config.json --run QA-... --json
```

5. If a real live failure appears, use tester mode to file bugs, developer mode to fix one area, and retest mode to rerun only failed test ids. That real failing-live loop is now the main remaining QA workflow evidence gap.

## Do Not Claim Complete Until

- live help run passes or produces accepted bug output;
- cleanup result reports no unreported residual Telegram/Paperclip artifacts;
- `ACCEPTANCE.md` exists for the live run;
- a real failing-live handoff/retest cycle is proven or explicitly deferred with known risks;
- literal full-suite repeat execution is accepted or explicitly deferred with known risks;
- no secrets or raw transcripts are committed.
