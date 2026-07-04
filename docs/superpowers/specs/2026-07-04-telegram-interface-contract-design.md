# Telegram Interface Contract Design

Date: 2026-07-04

## Goal

Make Telegram the primary short operational interface for The Inner Agora. The user should be able to start a philosophical council, follow progress, read the итог, continue the conversation, browse history, and recover from errors without seeing raw Hermes, Paperclip, model, route, run, or stderr details.

This document is a product interface contract. It does not authorize live Telegram/Paperclip changes by itself. Live checks still require an explicit "можно трогать живую систему" step.

## Principles

- Telegram is the user interface; Paperclip is the work backend.
- The first screen is about actions and results, not diagnostics.
- Use short operational Russian by default.
- Use "философы" and "итог" in user-facing Telegram text.
- Keep `синтез`, routes, models, UUIDs, run ids, and Paperclip links in details, diagnostics, QA, or full help.
- No ordinary free-text request creates a Paperclip session silently.
- Fast explicit paths may start immediately after the topic is known.
- Deep or manually curated paths require confirmation before creating Paperclip work.
- Buttons and message labels should be config-driven where possible.

## Main Menu

Title: `The Inner Agora`

Text:

```text
The Inner Agora

Я могу помочь разобрать вопрос через нескольких философов.
Можно писать обычным языком или выбрать действие.
```

Default buttons:

- `Новый вопрос`
- `Последняя сессия`
- `Итог`
- `История`
- `Помощь`

Conditional button:

- `Философы` appears only when there is an active or latest session with selected philosophers.

Do not show on the main screen:

- `Диагностика`
- `Режимы`
- `Каталог`
- `Все голоса`
- Paperclip links
- model or route details

Acceptance criteria:

- The brand `The Inner Agora` is visible immediately.
- The main text says "философы", not agents, voices, roles, or Paperclip.
- A new user can identify the main actions in one screen.
- The main menu does not expose raw Hermes/Paperclip concepts.

## New Question Flow

`Новый вопрос` opens a format selector, not a task creation path.

Buttons:

- `Быстрый совет`
- `Глубокое исследование`
- `Спросить одного`
- `Выбрать философов`
- `Назад`

The hidden/internal balanced route remains available for ambiguous free text, but it is not shown as a user-facing mode.

### Fast Council

`Быстрый совет` means 2-3 philosophers by situation.

Rules:

- If the user asks for "пару философов", choose 2 philosophers.
- Choose 3 only when the topic clearly benefits from a third contrasting perspective.
- Never choose 5-8 philosophers for fast mode.
- After the format and topic are known, fast mode may start immediately.

Copy:

```text
Быстрый совет — 2-3 философа, коротко и по делу.
```

Acceptance criteria:

- "пару философов" does not select 8 philosophers.
- Fast mode shows the selected philosophers in the launch acknowledgement.
- The user can see which philosophers were chosen and why, briefly.

### Deep Research

`Глубокое исследование` proposes 5-6 strong philosophers and requires confirmation.

Before the topic is known, it asks for the question instead of showing a launchable composition:

```text
Глубокое исследование.

Напиши вопрос одним сообщением.
После темы я предложу 5-6 философов и спрошу, запускать ли.
```

Buttons before the topic is known:

- `Назад`

Example:

```text
Вопрос:
как заботу не превратить в контроль

Предлагаю глубокий состав: 6 философов.

Платон — рамка смысла
Сократ — уточняющие вопросы
Ницше — воля и конфликт
Фуко — власть и контроль
Аристотель — практическая мера
Хайдеггер — глубинная рамка

Можно запустить так или поменять состав.
```

Buttons:

- `Запустить`
- `Поменять философов`
- `Сделать быстро`
- `Назад`

Acceptance criteria:

- Deep mode does not show `Запустить` before the topic is known.
- Deep mode does not start without confirmation.
- Default deep composition is 5-6 philosophers, not all philosophers.
- The proposal card includes `Вопрос:` with the parsed user question.
- Each philosopher has a short reason.
- The user can switch to fast mode before launch.

### Ask One

`Спросить одного` uses search as the primary interface and `Аристотель` as the default quick option.

Example:

```text
Кого спросим?

Можно написать имя или выбрать:
Аристотель — практическая мера
Сократ — вопросы и прояснение
Ницше — конфликт и воля
Фуко — власть и контроль
```

Buttons:

- `Аристотель`
- `Сократ`
- `Ницше`
- `Фуко`
- `Поиск`
- `Назад`

Acceptance criteria:

- Search supports Russian names, English names, and close aliases.
- If no philosopher is selected and the user enters a topic, the system may suggest Aristotle but must not silently launch.
- If a name is not found, show up to 3 closest matches.

### Choose Philosophers

`Выбрать философов` starts with the topic, then proposes a composition for editing.

Example:

```text
Вопрос:
свобода взрослого ребенка

По этой теме я бы собрал 4 философов:

Аристотель — мера и практика
Сократ — прояснить вопрос
Фуко — власть и контроль
Бовуар — свобода и взросление

Можно изменить состав.
```

Buttons:

- `Запустить`
- `Добавить`
- `Убрать`
- `Сделать 2-3`
- `Сделать 5-6`
- `Назад`

Acceptance criteria:

- The system does not show the full catalog first.
- The initial prompt does not show `Запустить`, `Добавить`, or `Убрать` until the topic is known.
- The editable proposal card includes `Вопрос:` with the parsed user question.
- The user can add or remove philosophers before launch.
- Final confirmation shows the exact number of philosophers.

## Free Text

Free text without an explicit format uses the internal balanced route, but it does not launch immediately.

Example:

```text
Я понял тему:
"что такое свобода взрослого ребенка"

Предлагаю обычный разбор: 4 философа.
Запустить?
```

Buttons:

- `Запустить`
- `Сделать быстро`
- `Сделать глубоко`
- `Выбрать философов`
- `Изменить тему`
- `Отмена`

If topic extraction looks broken or truncated:

```text
Я понял тему:
"а ть пару , но не слишком"

Похоже, тема распознана неуверенно.
Напиши ее еще раз или нажми "Изменить тему".
```

Acceptance criteria:

- Ambiguous free text does not create Paperclip work silently.
- The parsed topic is visible before launch.
- Bad topic extraction is caught before Paperclip issue creation.
- The user can correct the topic by writing another message or by pressing `Изменить тему`.

## Launch Acknowledgement

After launch, reply with a short human acknowledgement.

Example:

```text
Запустил совет: THE-123

Вопрос:
что такое свобода взрослого ребенка

Философы:
Аристотель, Сократ, Фуко

Статус:
Жду ответы философов. Пришлю итог, когда все будут готовы.
```

Buttons:

- `Последняя сессия`
- `Философы`
- `Итог`
- `Детали`

Do not show:

- URL
- `wake=queued`
- run ids
- route/model
- raw child issue rows

Acceptance criteria:

- The acknowledgement includes `Вопрос:` with the launched question.
- The user understands that the council is running and that the итог will arrive later.
- Technical information is available through `Детали`, not in the primary message.
- The acknowledgement fits on one phone screen.

## Progress Messages

Progress is sent as new Telegram messages. Chat noise is acceptable, but duplicate progress is not.

Example:

```text
Совет работает: 2/6 философов готовы.

Готовы: Аристотель, Фуко.
Ждем: Сократ, Ницше, Бовуар, Хайдеггер.
```

When all philosophers are done:

```text
Все философы ответили. Собираю итог.
```

Buttons:

- `Статус`
- `Показать готовые`
- `Философы`

Rules:

- Send progress only when the ready/waiting set changes.
- Do not repeat identical progress messages.
- Do not include raw Paperclip issue rows or run ids.

Acceptance criteria:

- The user sees live movement during long councils.
- Duplicate progress is deduped.
- Progress copy remains short and user-facing.

## Final Итог

The final Telegram message is a short итог plus navigation to deeper views.

Example:

```text
Итог готов.

Коротко:
<3-6 строк главного вывода>

Главное напряжение:
<1-2 строки, если есть>

Следующий шаг:
<одно действие>
```

Buttons:

- `Полный итог`
- `Философы`
- `Продолжить`
- `Новый вопрос`
- `Детали`

Conditional button:

- `Разногласия` appears only if a real conflict between philosophers was found.

Rules:

- Use "итог" in Telegram, not "синтез".
- Do not send a long full report by default.
- If there is no real disagreement, do not show a `Разногласия` button.
- If there is no conflict, say briefly that the philosophers mostly converged.

Acceptance criteria:

- The final message is short enough for Telegram.
- Full material is reachable by buttons.
- Disagreement is shown only when there are at least two real positions in tension.

## Continue Flow

`Продолжить` accepts free follow-up text.

Example:

```text
Продолжаем по этой сессии.
Напиши уточнение обычным текстом.
```

Buttons:

- `Уточнить`
- `Углубить`
- `Спросить философа`
- `Новый совет по теме`
- `Завершить`

Rules:

- A follow-up keeps the current session context.
- If it is unclear whether the user is continuing or starting a new topic, ask:

```text
Это продолжение текущей сессии или новый вопрос?
```

Acceptance criteria:

- The user can continue naturally without selecting a menu.
- The system does not create a new session silently when intent is ambiguous.
- There is an explicit path out of the current context.

## Last Session

`Последняя сессия` is always visible and has an empty state.

When a session exists:

```text
Последняя сессия: THE-123

Статус: ждем 2 из 5 философов
Тема: свобода взрослого ребенка
Коротко: итог еще не готов
```

Buttons:

- `Открыть сессию`
- `Философы`
- `Итог`
- `Продолжить`
- `Назад`

When no sessions exist:

```text
Сессий пока нет.
Можно начать новый вопрос или посмотреть примеры.
```

Buttons:

- `Новый вопрос`
- `Примеры фраз`
- `История`
- `Назад`

Inside a specific session, show details and history:

```text
Сессия THE-123

Запущено: 12:40
Философы: 3/5 готовы
Итог: еще нет

История:
12:40 — совет запущен
12:43 — Аристотель ответил
12:45 — Фуко ответил
12:47 — ждем Сократа, Бовуар
```

Acceptance criteria:

- The top-level last session card is compact.
- Detailed event history appears only inside a specific session.
- No UUIDs, raw child rows, or run ids appear in the compact view.

## Итог Screen

`Итог` is always visible.

If a ready итог exists:

```text
Последний готовый итог: THE-118

Коротко:
<3-6 строк>
```

If no ready итог exists:

```text
Готового итога пока нет.
```

Buttons:

- `Новый вопрос`
- `Последняя сессия` when a session exists
- `История`
- `Назад`

Acceptance criteria:

- `Итог` is the stable place to find the latest ready meaning.
- If the latest session is still running, the user can still view the last ready итог.
- Empty state is not a technical error.

## History

`История` is a separate screen. It shows root sessions only.

Default limit: 5 sessions, configurable.

Example:

```text
История сессий

THE-123 — свобода взрослого ребенка
итог готов

THE-118 — забота и контроль
итог готов

THE-110 — выбор профессии
остановлено
```

Statuses:

- `в работе`
- `итог готов`
- `остановлено`
- `не получилось`

Buttons:

- open a selected session
- `Показать еще`
- `В работе`
- `С итогом`
- `Остановленные`
- `Назад`

Empty state:

```text
История пока пустая.
```

Acceptance criteria:

- The first page shows 5 sessions by default.
- The limit is project config, not a hardcoded constant.
- Child issues are not listed as sessions.

## Philosophers Screen

Button label: `Философы`.

The button appears only when there is a relevant latest or active session.

Example:

```text
Философы этой сессии

Аристотель — готов
Сократ — готов
Фуко — ждет ответ
```

Buttons:

- `Готовые`
- `Все`
- `Спросить философа`
- `Назад`

Rules:

- This screen is about the philosophers in the current/latest session.
- It is not the full catalog.
- Full catalog access belongs in search, full help, or admin/debug surfaces.

Acceptance criteria:

- The user sees only relevant session philosophers.
- Search remains available through `Новый вопрос -> Спросить одного`.
- The full catalog does not clutter the main flow.

## Details

`Детали` is the second-level technical/admin view.

Allowed details:

- `Открыть в Paperclip`
- `Экспорт`
- `Технические детали`
- route/model
- issue id
- timestamps
- QA/debug details for QA sessions

Rules:

- Paperclip links do not appear in primary messages.
- Export does not appear in first-level final итог actions.
- Technical information is available, but not the default Telegram experience.

Acceptance criteria:

- Primary Telegram screens are not URL lists.
- Power-user information remains reachable.
- Diagnostics do not compete with reading or continuing the council.

## Help

`Помощь` opens sections, not one long command dump.

First screen:

```text
Помощь по The Inner Agora.

Можно писать обычным языком или пользоваться кнопками.
Что открыть?
```

Buttons:

- `Как пользоваться`
- `Примеры фраз`
- `Полная справка`
- `Состояние`
- `Назад`

Section meanings:

- `Как пользоваться`: new question, follow-up, итог, philosophers.
- `Примеры фраз`: common natural-language examples.
- `Полная справка`: grouped technical command reference.
- `Состояние`: soft health card and QA entry.

Acceptance criteria:

- `/help`, `/agora`, and `/agora help` lead to compact user help, not raw Hermes help.
- `/agora help full` remains technical but grouped and readable.
- Help never creates Paperclip issues.

## QA

QA is visible only through:

```text
Помощь -> Состояние -> QA
```

Telegram QA can show:

- `QA статус`
- `Последний QA отчет`
- `Упавшие проверки`
- `Cleanup статус`

Telegram QA must not launch live suites. Live suite execution remains a CLI/live-plan flow with explicit approval.

Example:

```text
Последний QA: service-commands

Статус: FAIL
Проверки: 0/5
Баги: 5
Cleanup: clean

Главное:
сырой Hermes UI все еще виден в /help и /agents.
```

Buttons:

- `Упавшие проверки`
- `Артефакты`
- `Cleanup`
- `Назад`

Acceptance criteria:

- Telegram can show QA state without creating new live side effects.
- Live test execution cannot be triggered accidentally from Telegram.
- Failed test ids are visible without pasting long JSON.

## Errors And Recovery

Errors are short recovery cards, not raw technical output.

Example:

```text
Не получилось запустить совет.
Я могу восстановить состав и повторить запуск.
```

Buttons:

- `Восстановить и повторить`
- `Попробовать без этого философа`
- `Показать детали`
- `Назад`

If a philosopher fails during a council:

```text
Один философ не ответил: Фуко.
Что сделать?
```

Buttons:

- `Повторить`
- `Продолжить без него`
- `Заменить философа`
- `Остановить совет`

Rules:

- Do not show raw `stderr`, HTTP JSON, stack traces, UUIDs, or `Project action exited` in the first user-facing error.
- If recovery has live side effects, it must require an explicit button.
- If the council continues without a philosopher, the итог must mention the missing philosopher.

Acceptance criteria:

- Every error states what can happen next.
- The user controls quality degradation.
- Technical details are preserved in logs/details, not primary Telegram copy.

## Stop And Cleanup

`Остановить совет` cancels and hides or cleans visible Paperclip work for that session.

Success copy:

```text
Остановил совет и убрал его из рабочих сессий.
```

Partial cleanup copy:

```text
Остановил совет, но убрал не все.
Можно дочистить.
```

Button:

- `Дочистить`

Rules:

- Cancel or hide the root session.
- Cancel or hide child philosopher tasks.
- Stop pending or queued runs where possible.
- Do not touch other sessions.
- Keep audit/log evidence without cluttering user-visible work lists.

Acceptance criteria:

- Stopped sessions no longer appear as active/latest work.
- Cleanup is scoped to the session.
- Partial cleanup is visible and recoverable.

## Tone And Presentation

Style: very short and operational.

Rules:

- 2-6 lines for ordinary messages.
- One main idea per message.
- One clear next action.
- Details by button.
- Russian by default.
- Emojis/icons may be enabled by default, but must be optional.
- Do not depend on emojis for meaning or tests.
- No long philosophical prefaces in system/operational messages.

Do not show in ordinary replies:

- `hermes_local`
- `codex_local`
- model ids
- route names
- run ids
- UUIDs
- raw stderr
- Paperclip URLs

These may appear in:

- `Детали`
- `Состояние`
- `Диагностика`
- QA reports
- full help
- Paperclip metadata/logs

Acceptance criteria:

- Ordinary responses fit on one phone screen.
- Copy remains understandable if emojis are disabled.
- Technical terms stay in second-level surfaces.

## Config Surface

Project config should control:

- `telegram.history.defaultLimit = 5`
- emoji/icon presentation on/off
- button labels
- fast council range: 2-3 philosophers
- deep research range: 5-6 philosophers
- whether Paperclip links appear in details
- help buttons
- quick action buttons
- progress dedupe and throttling
- which fields appear in `Детали`

Acceptance criteria:

- Product labels and limits are not hardcoded into flow logic.
- Tests can assert behavior without relying on exact emoji glyphs.
- The same Paperclip Cockpit mechanism can remain project-neutral while The Inner Agora supplies project-specific labels.

## Implementation Boundaries

Keep future implementation in separate packages of work:

1. Service shell: `/help`, `/agora`, `/agora help`, `/agents`, help sections.
2. New question flow: fast/deep/one/choose philosophers and topic confirmation.
3. Session surfaces: last session, итог, history, philosophers, details.
4. Progress messages and dedupe.
5. Error recovery and stop/cleanup.
6. QA status view.
7. Config extraction and tests.

Do not mix Telegram UI fixes with Paperclip hierarchy repair or model routing changes unless a specific package explicitly depends on them.

## Live Verification Gates

Before live side effects:

1. Run non-live unit/regression checks.
2. Run QA readiness.
3. Run live-plan.
4. Ask for explicit approval to touch live Telegram/Paperclip.

Acceptance for live suite:

- No raw Hermes UI in `/help`, `/agora`, `/agents`.
- No raw stderr/JSON in user-visible errors.
- Fast council creates 2-3 philosophers.
- Deep research proposes 5-6 and waits for confirmation.
- Progress messages are sent only on real changes.
- Final итог is short and navigable.
- Stop/cleanup leaves no visible residual session artifacts.
