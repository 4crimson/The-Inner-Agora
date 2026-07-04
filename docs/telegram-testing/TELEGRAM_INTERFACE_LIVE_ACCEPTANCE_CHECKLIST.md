# Telegram Interface Live Acceptance Checklist

Date: 2026-07-04

This checklist is for the 2026-07-04 Telegram interface contract.
It is an operator handoff, not live approval by itself.

## Hard Gate

Live side effects are forbidden until the operator explicitly approves touching the live system in the current thread.
The preferred approval phrase is:

```text
можно трогать живую систему
```

Equivalent direct approval such as "давай трогай живую систему" is acceptable only when the next command and side effects have already been explained in the same thread.
Anything else, including "давай сделаем", means docs, planning, readiness, and dry-run only.

Live side effects include:

- sending messages to the real Telegram bot or test chat;
- creating Paperclip issues;
- changing or hiding Paperclip issues;
- deleting Telegram messages;
- running a non-dry QA suite with `--live-ok`;
- running cleanup against live manifest artifacts.

## Checklist 0: Scope

- [ ] Confirm the target is `The Inner Agora` Telegram interface contract dated `2026-07-04`.
- [ ] Confirm the target bot in `telegram-testing.config.json` is correct.
- [ ] Confirm Paperclip company is `The Inner Agora`.
- [ ] Confirm no unrelated router, model, roster, or Paperclip recovery work is included in this live run.
- [ ] Confirm the current worktree changes are intentional and no runtime state file is staged.
- [ ] Confirm the live Hermes profile plugin matches `hermes-plugins/paperclip-cockpit/__init__.py`, then restart/verify the gateway if plugin code changed.
- [ ] Confirm live Telegram QA does not use `--notify telegram` when the notification target is the same bot under test.

## Checklist 1: Non-Live Local Proof

Run these before asking for live approval:

```bash
python3 -m unittest tests.test_paperclip_cockpit_rewrites tests.test_paperclip_cockpit_telegram_callbacks tests.test_paperclip_cockpit_telegram_helper tests.test_phase4_intent_slots tests.test_inner_agora_ask_flow tests.test_paperclip_cockpit_monitor.PaperclipCockpitMonitorTests.test_monitor_notifies_progress_once_per_changed_voice_fingerprint
node --check scripts/agora.mjs
node --check scripts/intent-slots.mjs
node --check scripts/paperclip-cockpit-telegram.mjs
python3 -m py_compile hermes-plugins/paperclip-cockpit/__init__.py
node -e "JSON.parse(require('fs').readFileSync('paperclip-cockpit.json','utf8')); JSON.parse(require('fs').readFileSync('telegram-testing.config.json','utf8')); console.log('json ok')"
```

Pass criteria:

- [ ] Unit/regression tests pass.
- [ ] Node syntax checks pass.
- [ ] Python compile check passes.
- [ ] JSON parse check passes.
- [ ] No live Telegram messages were sent.
- [ ] No Paperclip issues were created or changed.

## Checklist 2: QA Config Freshness

Before live, compare `telegram-testing.config.json` with the current interface contract.

- [ ] `/help`, `/agora`, and `/agora help` expectations match the current first screen: `The Inner Agora`, `Новый вопрос`, `Последняя сессия`, `Итог`, `История`, `Помощь`.
- [ ] The suite does not still expect removed first-level items such as `Текущий режим`, raw mode buttons, `Синтез`, `Все голоса`, or `Active Agents & Tasks`.
- [ ] History acceptance checks include numbered open buttons such as `1 THE-*`.
- [ ] QA status/report/failures/cleanup checks are read-only and do not launch live suites from Telegram.
- [ ] Any allowed guard warning has a written reason and is not treated as automatic approval.
- [ ] Interface tests use a Telegram wait window large enough for batching; current live acceptance uses `waitSeconds: 35` for interface-contract topics.
- [ ] Launch smoke topics use explicit available philosophers. Do not use vague "пара философов" in launch suites; that belongs in confirmation/interface suites.

If this checklist fails, update the QA config or run only a manual live checklist after explicit approval.

## Checklist 3: Readiness And Live Plan

These commands are non-live preflight gates:

```bash
[ -f .env ] && set -a && source .env && set +a
node paperclip-qa-tool/bin/paperclip-qa.mjs config-check --config telegram-testing.config.json --json
node paperclip-qa-tool/bin/paperclip-qa.mjs completion-check --config telegram-testing.config.json --json
node paperclip-qa-tool/bin/paperclip-qa.mjs readiness --config telegram-testing.config.json --suite service-commands --cleanup hard --json
node paperclip-qa-tool/bin/paperclip-qa.mjs live-plan --config telegram-testing.config.json --suite service-commands --cleanup hard --json
node paperclip-qa-tool/bin/paperclip-qa.mjs run --config telegram-testing.config.json --suite service-commands --cleanup hard --dry-run --json
```

Pass criteria:

- [ ] `config-check` reports config is usable.
- [ ] `readiness` explains whether live is safe.
- [ ] If `readyForLive` is false, stop and report the reason.
- [ ] If `node scripts/agora.mjs philosophers` reports missing default roster members, do not claim default/quick launch acceptance; either fix Paperclip roster in a separate recovery task or run only explicit-voice launch smoke and record the roster risk.
- [ ] `live-plan` prints the target, suite, cleanup mode, expected side effects, and exact live command.
- [ ] Dry-run does not send Telegram messages or create Paperclip issues.

## Checklist 4: Approval Prompt

Before live execution, show the operator:

```text
This will send Telegram messages and may create Paperclip issues. Cleanup will run with hard-delete-first and soft fallback. Proceed?

Чтобы разрешить live acceptance, напиши отдельно:
можно трогать живую систему
```

Proceed only if:

- [ ] The operator answers with `можно трогать живую систему`.
- [ ] The intended exact live command is visible in the chat.
- [ ] The current mode is tester/release-review, not development.

## Checklist 5: First Live Suite

Start with the safest contract suite:

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs run --config telegram-testing.config.json --suite service-commands --cleanup hard --live-ok --json
```

Acceptance points:

- [ ] `/help` is compact and Agora-facing.
- [ ] `/agora` is compact and Agora-facing.
- [ ] `/agora help` is compact and Agora-facing.
- [ ] `/agents` does not leak raw Hermes UI.
- [ ] First-level screens do not show Paperclip links, model ids, routes, UUIDs, or raw stderr.
- [ ] No service command creates Paperclip work.
- [ ] Cleanup reports no residual live artifacts.
- [ ] `REPORT.md`, `ACCEPTANCE.md`, and `bugs.jsonl` are written for the run.
- [ ] QA results are reported in Codex chat/artifacts, not posted back into the bot being tested.

## Checklist 5b: Interface And Topic Suites

Run these after `service-commands` is clean:

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs run --config telegram-testing.config.json --suite interface-contract-topics --cleanup hard --live-ok --json
node paperclip-qa-tool/bin/paperclip-qa.mjs run --config telegram-testing.config.json --suite council-create --cleanup hard --live-ok --json
```

Acceptance points:

- [ ] Ordinary new-topic text returns `Я понял тему` and creates no Paperclip root.
- [ ] Vague "пару философов" without names confirms before launch.
- [ ] Read-only "что там по последней сессии?" opens compact Telegram payload with buttons, not raw `/agora latest` CLI output.
- [ ] Launch smoke creates and cleans Paperclip roots only for explicit available voices.
- [ ] Cleanup residuals are empty. If hard DELETE fails but fallback PATCH hides/cancels all run issues, record the Paperclip cleanup risk.
- [ ] After launch-suite cleanup, verify no active heartbeat-runs remain for the QA issue refs or `[qa:<runId>]` marker.

## Checklist 6: Manual Interface Walkthrough

Use this only after the same live approval gate.

- [ ] Open `История`.
- [ ] Confirm visible sessions are numbered.
- [ ] Tap `1 THE-*`.
- [ ] Confirm the selected compact session card opens.
- [ ] Confirm opened card has compact buttons such as `Открыть сессию`, `Философы`, `Итог`, `Продолжить`, `Назад`.
- [ ] Tap `Итог` from a ready session.
- [ ] Confirm short итог opens, not raw synthesis/log output.
- [ ] Tap `Философы`.
- [ ] Confirm it shows only philosophers from that session, not the full catalog.
- [ ] Tap `Продолжить`.
- [ ] Confirm it asks for follow-up text and does not create a new session silently.
- [ ] Open `Помощь -> Состояние -> QA статус`.
- [ ] Confirm it reads existing QA artifacts and does not launch a live suite.

## Checklist 7: Post-Run Decision

Replace `QA-...` with the real run id:

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs report --config telegram-testing.config.json --run QA-... --json
node paperclip-qa-tool/bin/paperclip-qa.mjs summary --config telegram-testing.config.json --run QA-... --json
node paperclip-qa-tool/bin/paperclip-qa.mjs acceptance --config telegram-testing.config.json --run QA-... --json
node paperclip-qa-tool/bin/paperclip-qa.mjs bugs --config telegram-testing.config.json --run QA-... --dry-run --json
node paperclip-qa-tool/bin/paperclip-qa.mjs bug-batch --config telegram-testing.config.json --run QA-... --json
```

Decision:

- [ ] PASS only if tests pass, cleanup is clean, and there are no P0/P1 bugs.
- [ ] FAIL if any test fails, P0/P1 bugs exist, or cleanup leaves residuals.
- [ ] BLOCKED if Telegram/Paperclip/Hermes readiness fails before live side effects.
- [ ] Do not claim full acceptance without `ACCEPTANCE.md`.
- [ ] Do not claim default roster acceptance while `node scripts/agora.mjs philosophers` reports missing required roles such as `Декарт`.

## Checklist 8: Stop Conditions

Stop the live cycle immediately if any of these happen:

- [ ] The bot replies with raw Hermes/Paperclip/system text on first-level screens.
- [ ] A command creates Paperclip work when it should be read-only.
- [ ] Cleanup touches an issue outside the manifest or exact run marker.
- [ ] Cleanup leaves visible residual active sessions.
- [ ] Telegram credentials or target chat look wrong.
- [ ] `--notify telegram` posts QA summary to the same bot under test.
- [ ] The user asks to pause, stop, or avoid live side effects.

After stopping:

- [ ] Save the run id and artifact paths.
- [ ] Run report/acceptance/bug-batch if a manifest exists.
- [ ] Do not continue to broader suites until the blocker is triaged.

## Checklist 9: Report Back

Final live acceptance report should include:

- [ ] Goal and exact suite.
- [ ] Whether live approval was given.
- [ ] Exact command run.
- [ ] Run id.
- [ ] PASS/FAIL/BLOCKED decision.
- [ ] Test count and failed ids.
- [ ] Cleanup result.
- [ ] Artifact paths.
- [ ] Next action: accept, retest failed ids, fix one bug area, or stop.

## 2026-07-04 Live Evidence

- `QA-20260704-0842-service-commands-7c3204`: `service-commands`, accepted, 5/5 pass, cleanup residuals none.
- `QA-20260704-0916-interface-contract-topics-0475e6`: `interface-contract-topics`, accepted, 4/4 pass, cleanup residuals none.
- `QA-20260704-0922-council-create-47005c`: `council-create`, accepted, 3/3 pass, cleanup residuals none. Some hard DELETE calls returned 500; fallback PATCH hid/cancelled the affected QA issues.
- Post-`council-create` cleanup audit found two active QA heartbeat-runs on deleted/hidden child issues; both were cancelled manually and active heartbeat-run count returned to 0.
- Manual history-open check: `/agora` -> `История` -> `1 THE-74` opened compact session card; chat history cleanup verified `telegram_history_after_cleanup=0`.
- Current live roster risk: `node scripts/agora.mjs philosophers` reports `Декарт` missing, so default architect/minimum-council roster readiness is not accepted in this checklist.
