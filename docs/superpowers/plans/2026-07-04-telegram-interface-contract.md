# Telegram Interface Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Telegram product interface contract from `docs/superpowers/specs/2026-07-04-telegram-interface-contract-design.md` without live Telegram or Paperclip side effects.

**Architecture:** Keep `paperclip-cockpit` generic and config-driven, while `paperclip-cockpit.json` supplies The Inner Agora labels, menus, callbacks, and limits. Add small reusable helper behavior only where config cannot express the contract: first-level menus, confirmation-only free text, launch/progress/result payload copy, and optional second-level technical details.

**Tech Stack:** Python `unittest` for Hermes plugin behavior, Node.js `.mjs` helpers for Agora/Paperclip payloads, JSON project config. In the current local environment `pytest` is not installed, so focused verification uses `python3 -m unittest`.

---

### Task 1: Main Menu And Help Contract

**Files:**
- Modify: `tests/test_paperclip_cockpit_rewrites.py`
- Modify: `paperclip-cockpit.json`
- Modify: `hermes-plugins/paperclip-cockpit/__init__.py` only if config cannot express the contract

- [x] **Step 1: Write failing tests for first-level menu copy and buttons**

Add assertions in `test_telegram_command_boundary_intercepts_service_commands_with_buttons` that `/help`, `/agora`, and `/agora help` send text containing `The Inner Agora` and `философов`, and do not contain `Paperclip`, `Диагностика`, `Режимы`, `Каталог`, `Все голоса`, or `Синтез`.

Expected button row contract:

```python
[
    {"text": "Новый вопрос", "callback_data": "pc:new_question:help"},
    {"text": "Последняя сессия", "callback_data": "pc:last_session:help"},
]
[
    {"text": "Итог", "callback_data": "pc:final_result:help"},
    {"text": "История", "callback_data": "pc:history:help"},
]
[
    {"text": "Помощь", "callback_data": "pc:help_sections:help"},
]
```

- [x] **Step 2: Run red test**

Run: `python3 -m unittest tests.test_paperclip_cockpit_rewrites.PaperclipCockpitRewriteTests.test_real_agora_main_menu_matches_telegram_interface_contract`

Expected: FAIL because current config/test fixture still exposes old labels such as `Глубокое исследование`, `Прогресс`, or `голоса`.

- [x] **Step 3: Update project config menus and callback messages**

In `paperclip-cockpit.json`, update `telegram.command_boundary.menus.home`, `telegram.help_buttons`, and `telegram.callbacks` so first-level service commands show the contract menu. Keep `/agora help full` technical and grouped.

- [x] **Step 4: Run green test**

Run: `python3 -m unittest tests.test_paperclip_cockpit_rewrites.PaperclipCockpitRewriteTests.test_real_agora_main_menu_matches_telegram_interface_contract`

Expected: PASS.

### Task 2: New Question Flow And No Silent Launch

**Files:**
- Modify: `tests/test_paperclip_cockpit_telegram_callbacks.py`
- Modify: `tests/test_phase4_intent_slots.py`
- Modify: `hermes-plugins/paperclip-cockpit/__init__.py`
- Modify: `scripts/intent-slots.mjs`
- Modify: `paperclip-cockpit.json`

- [x] **Step 1: Write failing tests for `Новый вопрос` selector callbacks**

Add callback tests proving `pc:new_question:help` sends:

```text
Как разберем вопрос?

Быстрый совет — 2-3 философа, коротко и по делу.
```

with buttons `Быстрый совет`, `Глубокое исследование`, `Спросить одного`, `Выбрать философов`, `Назад`.

- [x] **Step 2: Write failing tests for free text confirmation**

Add an `agora.mjs natural --routing-mode regex --dry-run --json` test for `что такое свобода взрослого ребенка` expecting `action == "message"` and text containing `Я понял тему`, `Предлагаю обычный разбор: 4 философа`, and `Запустить?`. It must not return `/agora ask`.

- [x] **Step 3: Run red tests**

Run:

```bash
python3 -m unittest tests.test_paperclip_cockpit_telegram_callbacks tests.test_phase4_intent_slots
```

Expected: FAIL on the new contract tests.

- [x] **Step 4: Implement confirmation-only Telegram entry**

Add config callbacks for `new_question`, `fast_prompt`, `deep_prompt`, `ask_one_prompt`, `choose_philosophers_prompt`, `help_sections`, `back_home`, and confirmation callbacks. Update `decideNextStep()` so ordinary new-session free text returns a message plan in Telegram-safe dry-run mode rather than direct ask creation when there is no explicit launch phrase.

- [x] **Step 5: Run green tests**

Run:

```bash
python3 -m unittest tests.test_paperclip_cockpit_telegram_callbacks tests.test_phase4_intent_slots
```

Expected: PASS.

### Task 3: Fast And Deep Council Counts

**Files:**
- Modify: `tests/test_inner_agora_ask_flow.py`
- Modify: `scripts/agora.mjs`
- Modify: `paperclip-cockpit.json`

- [x] **Step 1: Write failing tests for fast mode count**

Add dry-run tests proving `node scripts/agora.mjs ask --dry-run --min "пару философов про свободу"` prints exactly two selected philosophers and `node scripts/agora.mjs ask --dry-run --min "быстрый совет про заботу и контроль"` prints no more than three.

- [x] **Step 2: Write failing tests for deep mode proposal count**

Add tests proving the Telegram deep prompt proposes 5-6 philosophers and does not run `ask` until the launch callback is pressed.

- [x] **Step 3: Run red tests**

Run: `python3 -m unittest tests.test_inner_agora_ask_flow tests.test_paperclip_cockpit_telegram_callbacks`

Expected: FAIL where current `min` defaults to three and deep maps to old max/all language.

- [x] **Step 4: Implement count limits through config-aware selection**

Adjust `requestedVoiceLimit()`, `selectedRoleLimit()`, or a new Telegram-specific path so `--min` obeys 2 for pair language and 2-3 for fast copy, while `deep` UX proposes 5-6 before confirmation. Do not change `--all`.

- [x] **Step 5: Run green tests**

Run: `python3 -m unittest tests.test_inner_agora_ask_flow tests.test_paperclip_cockpit_telegram_callbacks`

Expected: PASS.

### Task 4: Result, Progress, History, And Details Surfaces

**Files:**
- Modify: `tests/test_paperclip_cockpit_telegram_helper.py`
- Modify: `scripts/paperclip-cockpit-telegram.mjs`
- Modify: `paperclip-cockpit.json`

- [x] **Step 1: Write failing tests for payload labels**

Update helper tests so keyboards use `Итог`, `Философы`, `Продолжить`, `Новый вопрос`, `Детали` and do not include `Синтез`, `Все голоса`, `Export`, raw Paperclip URLs, model ids, UUIDs, route names, or run ids in primary payload text.

- [x] **Step 2: Write failing progress copy test**

Change `test_payload_progress_summarizes_done_and_waiting_voices` to expect:

```text
Совет работает: 1/3 философов готовы.
Готовы: Voice Alpha.
Ждем: Voice Beta, Voice Gamma.
```

and no root issue id in the first line.

- [x] **Step 3: Run red tests**

Run: `python3 -m unittest tests.test_paperclip_cockpit_telegram_helper`

Expected: FAIL on old `Синтез`, `Inputs`, and progress issue id copy.

- [x] **Step 4: Implement payload copy and details separation**

Update `buildKeyboard()` and `progressText()` to use config labels and contract wording. Keep technical callbacks available through `Детали`, not first-level result actions.

- [x] **Step 5: Run green tests**

Run: `python3 -m unittest tests.test_paperclip_cockpit_telegram_helper`

Expected: PASS.

### Task 5: Documentation And Non-Live Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/roadmap/BUGS.md` or `docs/roadmap/TASKS.md` only for a short status note if needed

- [x] **Step 1: Update documentation**

Document that Telegram first-level UI follows the 2026-07-04 contract, live checks still require explicit approval, and safe local verification is:

```bash
python3 -m unittest tests.test_paperclip_cockpit_rewrites tests.test_paperclip_cockpit_telegram_callbacks tests.test_paperclip_cockpit_telegram_helper tests.test_phase4_intent_slots tests.test_inner_agora_ask_flow
node --check scripts/agora.mjs
node --check scripts/paperclip-cockpit-telegram.mjs
python3 -m py_compile hermes-plugins/paperclip-cockpit/__init__.py
```

- [x] **Step 2: Run focused verification**

Run the commands from Step 1.

Expected: all commands exit 0.

- [x] **Step 3: Audit spec coverage**

Re-read `docs/superpowers/specs/2026-07-04-telegram-interface-contract-design.md` and classify any remaining items as implemented, deliberately second-phase, or blocked by live approval. Do not mark the goal complete if a required contract surface is still missing.

## Spec Coverage Audit

Implemented in this local non-live slice:

- Service shell: `/help`, `/agora`, `/agora help`, and `/agents` now show compact Agora-oriented menus without Paperclip, diagnostics, mode selector, catalog, `Синтез`, or `Все голоса` on the first screen.
- New question flow: `Новый вопрос`, `Быстрый совет`, `Глубокое исследование`, `Спросить одного`, `Выбрать философов`, help sections, and back-home callbacks are config-driven and message-only until a topic/confirmation path is explicit.
- Ask-one search: `agora.mjs philosopher-search --json` supports Russian names, English names, inflected close aliases, and up to three closest suggestions; Telegram helper payloads expose candidate buttons through generic `choose_philosopher:<key>` callbacks without launching a session.
- Ask-one pending state: choosing a philosopher stores a per-chat `pendingQuestion`; the next ordinary Telegram text rewrites deterministically to `/agora ask --philosophers <key> <topic>` and clears the pending state. `Назад` and `Отмена` clear the pending state.
- Free text: ambiguous ordinary topics return a confirmation card with contract buttons instead of silently rewriting to `/agora ask`; pending callbacks are safe messages until topic state/launch is explicit.
- Pending topic confirmation: ambiguous free-text cards now persist the launch topic per chat. `Запустить` runs the saved balanced `ask`, `Сделать быстро` runs saved topic through `min`, `Сделать глубоко` shows the deep proposal and then `Запустить` runs saved topic through `max`; `Изменить тему`, `Отмена`, and `Назад` clear stale pending state.
- Custom composition proposal/editing: `Выбрать философов` with a saved topic now calls a local structured `role-proposal`, shows a 4-philosopher editable proposal, persists `--philosophers <keys> <topic>`, supports `Добавить`/`Убрать` through per-chat pending edit state and local philosopher search, then `Запустить` launches the exact updated custom composition.
- Counts/copy: fast dry-run selection keeps `пару философов` at 2 and fast copy at 2-3; deep proposal shows 6 named philosophers and waits for confirmation.
- Result/progress payloads: first-level labels use `Полный итог`, `Философы`, `Продолжить`, `Новый вопрос`, and `Детали`; progress text hides root issue ids, reports ready/waiting philosophers in user-facing copy, and uses progress-specific buttons (`Статус`, `Показать готовые`, `Философы`) for Agora.
- Progress dedupe: the monitor persists `lastProgressFingerprint` per root and sends progress only when the ready/waiting voice fingerprint changes.
- Final итог: monitor `send-result` now sends a short `Итог готов` Telegram card with 3-6 filtered lines by default; the full material remains reachable through `Полный итог`.
- Disagreements: final-result keyboards add `Разногласия` only when the final text contains an explicit conflict marker such as `Разногласия:` or `Главное напряжение:`.
- Dynamic top-level session surfaces: `Последняя сессия`, `Итог`, `История`, `Философы`, and `Детали` use read-only Telegram payload actions. They resolve the Paperclip company/root sessions through API, ignore placeholder callback args such as `help`, show compact latest/empty states, list root sessions only with `telegram.history.defaultLimit = 5`, support read-only history pagination and active/done/stopped filters, add numbered `1 THE-*` open buttons for the visible history page, keep philosophers scoped to the selected session, and put Paperclip links/route/model only in `Детали`.
- Continue flow: `Продолжить` opens the contract follow-up menu (`Уточнить`, `Углубить`, `Спросить философа`, `Новый совет по теме`, `Завершить`) without launching side effects.
- Follow-up pending state: `Продолжить`/`Уточнить` store the current root session in per-chat pending state; the next ordinary Telegram text rewrites deterministically to `/agora follow-up <root> <text>` and clears the pending state.
- QA surface: `Помощь -> Состояние` exposes QA status/report/failures/cleanup buttons as read-only Telegram payloads over the latest existing `artifacts/telegram-test-runs/*` run. Status reads `manifest.json`, report clips `REPORT.md`, failures combine failed manifest tests with `bugs.jsonl`, cleanup reads manifest cleanup metadata, and none of these callbacks launches a live suite.
- Error recovery surface: humanized project-action errors can attach recovery buttons (`Восстановить и повторить`, `Попробовать без него`, `Показать детали`, `Назад`) through opt-in `telegram.error_recovery`; current recovery callbacks are safe prompts and do not run live repair/retry.
- Stop/cleanup flow: active sessions expose `Остановить`, confirmation is read-only, and the confirmed cleanup path is scoped to the selected root plus visible child issues. In non-live tests it patches only those issues to `cancelled + hiddenAt`, attempts to cancel active runs before hiding issues, and offers `Дочистить` on partial failure.
- Documentation: README records the 2026-07-04 Telegram contract, non-live checks, live-approval boundary, and current history pagination/filter limitations.

Deliberately second-phase:

- Replacing the whole selected philosopher set in one step can still be improved, but add/remove editing before launch is implemented.
- Live recovery actions and richer disagreement extraction need separate scoped packages.
- Config extraction remains partial: labels, first-level limits, history default limit, and philosophers button routing are config-driven, but details fields, icons, and progress throttle/dedupe require another pass.

Blocked by live approval:

- Live Telegram command acceptance, Paperclip issue creation, progress messages from real council runs, real stop/cleanup side effects, and live QA suites. These require the explicit `можно трогать живую систему` gate from the spec.
