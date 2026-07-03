# Telegram Acceptance Checklist

Date: 2026-07-03

## Purpose

This checklist turns product expectations into a repeatable Telegram QA ritual. It is the human-readable layer above `telegram-testing.config.json`: the config defines exact test ids and machine checks, while this document explains what we expect the user to experience and how results should be reported back in Telegram.

The generic runner now lives in `hermes-plugins/paperclip-cockpit/qa-tool/`. The legacy `paperclip-qa-tool/bin/paperclip-qa.mjs` command remains as a compatibility wrapper for this project.

The goal is simple: after each fix cycle, a tester can run one suite, clean up after it, and send a compact Telegram summary that says what passed, what failed, what was cleaned, and what should happen next.

## Reporting Contract

Every live QA run should produce two Telegram-facing messages.

### Start Message

Send before the live run:

```text
Начинаю QA-прогон: <suite>
Run: <runId or pending>
Проверяю: <1-line purpose>
Cleanup: hard-delete-first, soft fallback

Живые побочные эффекты: отправлю тестовые сообщения в Telegram и, если suite создает сессии, создам QA-задачи в Paperclip.
```

### Result Message

Send after cleanup:

```text
QA <suite>: <PASS|FAIL|BLOCKED>
Run: <runId>

Проверки: <pass>/<total> passed, <fail> failed
Баги: <count> (<area/severity summary>)
Cleanup: <clean|residuals N>

Главное:
- <one high-signal finding or "критичных проблем не найдено">

Артефакты:
- REPORT.md: <path>
- ACCEPTANCE.md: <path>
- bugs.jsonl: <path>

Следующий шаг: <retest failed ids | developer batch area | release review | live suite complete>
```

The Telegram result must stay short. Detailed failures live in `REPORT.md`, `ACCEPTANCE.md`, and `bugs.jsonl`.

## Suite Checklist

### 0. Readiness

Purpose: prove the live run is safe to start.

Command:

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs readiness --config telegram-testing.config.json --suite <suite> --cleanup hard --json
```

Expected:

- Telegram userbot credentials are present.
- Paperclip company `The Inner Agora` is reachable.
- Guard warnings are either resolved or explicitly known.
- No Telegram messages or Paperclip issues are created.

Telegram result if blocked:

```text
QA <suite>: BLOCKED
Причина: preflight не прошел (<short reason>)
Live-сообщения не отправлял.
```

### 1. Service Commands

Suite: `service-commands`

Purpose: basic Telegram commands must feel like Agora UX, not raw Hermes UI.

Expected:

- `/help`, `/agora`, `/agora help` show a compact Agora home menu.
- `/agents` explains voices/sessions/progress/diagnostics, not generic Hermes agents.
- The menu shows the current routing mode and mode buttons.
- `/agora help full` is technical but readable and grouped.
- Buttons are present where expected.
- No command creates a Paperclip issue.
- No reply contains `<|channel>`, `Project action exited`, raw stderr, or `Active Agents & Tasks`.

Pass Telegram summary:

```text
QA service-commands: PASS
Проверил /help, /agora, /agora help, /agents, /agora help full.
Сырой Hermes UI не протек, кнопки есть, Paperclip-задачи не создавались.
```

### 2. Mode Routing

Suite: `mode-routing`

Purpose: Telegram buttons should make routing visible and controllable before the next normal human question.

Expected:

- `/help` shows `Текущий режим` and mode buttons.
- Default mode is local and visible to the user.
- A normal council request creates a Paperclip session through the selected local route.
- A request asking for a pair of philosophers stays local and should be limited by the route/wording.
- No mode/help command creates Paperclip issues by itself.

Manual checkpoint until the QA runner grows callback-click support:

- Press a mode button, for example `Глубоко 10`.
- Confirm Telegram replies with the new current mode.
- Send a normal question without slash commands.
- Confirm the created session uses the selected route.

### 3. Help / Capabilities

Suite: `help`

Purpose: natural help phrases should return local menu/help UX.

Expected:

- `агора помощь` returns a local help/menu answer.
- `что ты умеешь в агоре?` returns capabilities/help, not a council.
- Buttons are present.
- No Paperclip roots are created.
- No raw tokens or project action errors are visible.

### 4. Natural Dialogue

Suite: `natural-dialogue`

Purpose: ordinary human phrasing should be understood without slash commands.

Expected:

- Broad/introspective wording should not accidentally create a Paperclip session before enough intent is clear.
- A phrase asking for a couple of philosophers should route toward a useful Agora flow with buttons.
- A latest-session phrase should use Paperclip state/result UX and show buttons.
- No raw provider/channel tokens are visible.

### 5. Council Creation

Suite: `council-create`

Purpose: real work-creating requests should create visible Paperclip sessions through the local route.

Expected:

- `быстрый совет: ... [qa:<runId>]` creates at least one Paperclip root.
- `глубокое исследование: ... [qa:<runId>]` creates at least one Paperclip root.
- Route metadata contains `local`.
- Telegram reply is a short operational acknowledgement, not internal reasoning.
- Buttons are present.
- No `command not found`, terminated-ancestor raw error, `<|channel>`, or `Project action exited`.

Cleanup requirement:

- Created roots and children are deleted or hidden/cancelled by manifest-scoped cleanup.
- Any residual becomes a cleanup bug.

### 6. Cleanup

Suite: `cleanup`

Purpose: prove QA artifacts can be removed without touching real work.

Expected:

- Telegram cleanup deletes only message ids from the manifest.
- Paperclip cleanup deletes children before parents.
- If hard delete fails, soft cleanup hides/cancels the issue.
- Cleanup is idempotent.
- Residuals are explicitly reported.

## Acceptance Gates

A run is `PASS` when:

- all tests in the suite pass;
- cleanup has no residuals;
- no P0/P1 bugs are generated;
- the Telegram result summary can be sent without extra explanation.

A run is `FAIL` when:

- any test fails;
- any P0/P1 bug exists;
- cleanup leaves residuals.

A run is `BLOCKED` when:

- readiness fails before live side effects;
- Telegram/Paperclip/Hermes is unavailable;
- credentials/session are missing;
- guard reports a live-safety error.

## Commands

Preflight:

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs readiness --config telegram-testing.config.json --suite <suite> --cleanup hard --json
node paperclip-qa-tool/bin/paperclip-qa.mjs live-plan --config telegram-testing.config.json --suite <suite> --cleanup hard --json
```

Live run:

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs run --config telegram-testing.config.json --suite <suite> --cleanup hard --live-ok --json
```

To retain a compact Telegram result summary after cleanup:

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs run --config telegram-testing.config.json --suite <suite> --cleanup hard --notify telegram --live-ok --json
```

Post-run:

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs report --config telegram-testing.config.json --run <runId> --json
node paperclip-qa-tool/bin/paperclip-qa.mjs summary --config telegram-testing.config.json --run <runId> --json
node paperclip-qa-tool/bin/paperclip-qa.mjs acceptance --config telegram-testing.config.json --run <runId> --json
node paperclip-qa-tool/bin/paperclip-qa.mjs bug-batch --config telegram-testing.config.json --run <runId> --json
```

Release review:

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs release-plan --config telegram-testing.config.json --cleanup hard --json
```

## Result Translation Rules

When reporting to Telegram:

- Say `PASS`, `FAIL`, or `BLOCKED` in the first line.
- Include `runId`, suite, pass/fail counts, bug count, cleanup residual count.
- Mention only the top 1-3 findings.
- Do not paste full stack traces, raw JSON, secrets, tokens, or long transcripts.
- If a suite failed, name the next developer batch by area: `telegram-ui`, `paperclip-recovery`, `local-model`, `cleanup`, or `unknown`.
- If cleanup failed, cleanup is the next batch before any broader release review.

## First Recommended Order

1. `service-commands`
2. `help`
3. `natural-dialogue`
4. `council-create`
5. `cleanup`
6. full release review

This order checks the safest, non-creating UX first, then moves toward Paperclip-creating flows.
