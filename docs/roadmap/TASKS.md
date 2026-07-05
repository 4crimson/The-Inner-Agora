# Tasks / Backlog

**Связанные документы:** `ROADMAP.md` (фазы и «зачем»), `IMPLEMENTATION_PLAN.md` (технический «как»)

**Легенда:**
- **Приоритет:** P0 — блокирует остальное в фазе; P1 — важно, но не блокирует; P2 — можно отложить без вреда фазе.
- **Размер:** S — до 1 дня; M — 1–3 дня; L — 3+ дней.
- **Готово, когда** — проверяемый факт, не ощущение.

Задачи внутри фазы в целом упорядочены по зависимости сверху вниз, если не указано иное в колонке «Зависит от».

---

## Трек QW — Быстрые победы (первая неделя, параллельно Фазе 0)

Не зависят от миграции схемы; дают ощутимый эффект сразу. Дубли в «домашних» фазах помечены `[QW → сделано ранее]`.

| ID | Задача | Приоритет | Размер | Зависит от | Готово, когда |
|---|---|---|---|---|---|
| QW-1 | Человекочитаемая ошибка на опечатку в `--philosophers` + `closestMatch` по Левенштейну (= T4.6, вперёд) | P0 | M | — | Опечатка даёт понятную ошибку с подсказкой похожего ключа против текущего `philosophers.json` |
| QW-2 | Проактивный self-heal gateway: health-check по таймеру + авто `guard --fix` (= T8.6, вперёд) | P0 | M | — | `EX_TEMPFAIL`-сценарий устраняется без ручного `launchctl kickstart` |
| QW-3 | Статический `/start`-онбординг: 2–3 захардкоженных сообщения с метафорой и примерами | P1 | S | — | Новый чат получает онбординг; умная версия — позже в T4.7 |
| QW-4 | `scripts/backup-company.mjs`: дамп агентов/issues/comments в `backups/<date>/` | P0 | S | — | Дамп снят до первого миграционного прогона Фазы 1 |

**Срез 2026-07-05:** QW-4 закрыт локально как read-only инструмент:
`scripts/backup-company.mjs [--company-id ID|--company NAME] [--api-base URL] [--out DIR] [--json]`
сохраняет `org`, `agents`, `issues` и comments в `backups/<timestamp>-<company>/backup.json`.
`backups/` игнорируется git. Скрипт покрыт `tests/test_backup_company.py`.
Снимок живой Paperclip-компании этим срезом не запускался; live-read остается за
отдельным явным разрешением.

---

## Трек RL — Release live workflow (ретро 2026-07-06)

Цель трека: превратить последний live-прогон в повторяемый release workflow для
Agora/Telegram/Paperclip, чтобы следующий запуск быстро отличал UX-баг,
router-баг, stale QA expectation и живой Paperclip drift.

Рабочая связка доказательства:

```text
preflight -> backup -> profile/plugin sync -> live suite -> cleanup -> acceptance -> post-suite guard -> docs/commit
```

Главный root cause из ретро: `hard cleanup` может удалить тестовый issue, пока
heartbeat/run еще завершает работу. Конкретный пример: run
`20b5a4ed-9021-4830-9654-718e2c10534b` стартовал в
`2026-07-05T21:06:32Z`, связанный issue
`357f13b2-ad4f-46a8-bbb5-0817b4029bab` был удален cleanup-ом в
`21:08:36Z`, а Hermes завершился с `Exit code: 0` только в `21:18:14Z`.
После этого Paperclip попытался записать `workspace_finalize` в
`workspace_operations` со ссылкой на уже удаленный `issue_id` и получил
`workspace_operations_issue_id_issues_id_fk`. Поэтому `cleanup` без
active-run safety и post-suite guard не доказывает live health.

| ID | Задача | Приоритет | Размер | Зависит от | Готово, когда |
|---|---|---|---|---|---|
| RL-1 | `release-live-gate` для Codex QA workflow plugin: единый release режим вместо ручной цепочки | P0 | M | live approval gate | Команда/режим пишет preflight, backup id, plugin/profile sync result, suite run ids, acceptance decision, post-suite guard и итог `accepted` / `accepted_with_repair` / `blocked` |
| RL-2 | `post-suite-health-gate` в `paperclip-qa` | P0 | M | RL-1 | Work-creating suites автоматически пишут `guardBefore`, `guardAfter`, `repairBackup`, `repairCommand`, `guardRepeat` в manifest/ACCEPTANCE; красный guard не считается чистым PASS |
| RL-3 | Cleanup safety для active heartbeat runs | P0 | M | RL-2 | `cleanup hard` перед удалением issue пишет `activeRunsBeforeCleanup`, cancel/stop для активных runs, ждет terminal state или возвращает blocked cleanup result; только потом удаляет issue; тест доказывает, что issue не удаляется до terminal run state |
| RL-4 | Profile/plugin sync preflight | P1 | S | RL-1 | Перед live suite repo plugin sha сравнивается с Hermes profile plugin sha; mismatch блокирует suite или требует явный warning/override |
| RL-5 | `visible-output-sanitizer` contract | P1 | M | RL-2 | Вместо копирования `replyNotContains` есть macro `noTechnicalFirstLevelLeak` для route/model/local URL/wake/raw child rows/CLI flags; first-level Telegram UX доказывается централизованно |
| RL-6 | Operational intent tests для `BUG-2026-07-03-001` | P0 | S | RL-5 | Фразы `проверить что вышло`, `финал проверяем`, `давай acceptance` ведут в operational acceptance/status flow, а не в философский совет или roadmap persona |
| RL-7 | Selected-voice ancestry guard перед ask creation | P0 | M | RL-2 | Если voice/manager hierarchy red, Paperclip work не создается; пользователь получает короткое recovery-сообщение, детали уходят в diagnostics |
| RL-8 | Error UX tests для project-action failures | P1 | M | RL-5 | `command not found`, provider timeout и Paperclip 409 показывают короткий русский recovery; raw stderr/JSON доступны только в diagnostics |
| RL-9 | Docs evidence checklist/updater | P1 | S | RL-1 | Перед commit есть checklist, какие run ids, backup ids, guard status, repair status и commit hashes должны попасть в `BUGS.md` / `COMPLETION_AUDIT.md` |

Тестовую стратегию упростить:

- route/local evidence не проверять через first-level Telegram text; маршрут
  доказывать через artifacts, metadata или guard;
- точные `replyContains` для авто-выбранных философов держать только в explicit
  named-voice сценариях;
- live suites не добавлять в обычный локальный regression; live остается
  release lane с явным `--live-ok`;
- старое ожидание `Я понял тему` оставить только для plain ambiguous flow;
  pair/exact launch должен проверять clean launch summary.

Фикс для cleanup/finalize race:

1. Перед `hard cleanup` получить active heartbeat/live runs для каждого issue,
   который будет удален.
2. Если runs активны, выполнить cancel/stop и дождаться terminal state; если
   terminal state не наступил в budget, вернуть blocked cleanup result и не
   удалять issue.
3. После удаления artifacts запустить `inner-agora-guard`.
4. В QA manifest записать `activeRunsBeforeCleanup`, `cancelledRuns`,
   `guardAfter`, а при repair еще `repairBackup`, `repairCommand`,
   `guardRepeat`.
5. В acceptance считать suite `accepted_with_repair` или `blocked`, но не чистым
   PASS, если cleanup оставил running/finalizing runs или guard red.

Статус 2026-07-06: первый кодовый срез RL-3 реализован в `paperclip-qa`.
`cleanup hard` теперь перед `DELETE` читает `/issues/:id/live-runs`; если есть
active run, delete/patch для этого issue не выполняется, cleanup возвращает
blocked result через residual `active-runs-before-cleanup`, а manifest пишет
`activeRunsBeforeCleanup` и `cancelledRuns`. Покрыто регрессией
`test_cleanup_hard_blocks_issue_delete_when_live_run_is_active`. Следующий срез:
auto-cancel/wait terminal state и post-suite `inner-agora-guard`.

Статус 2026-07-06: первый кодовый срез RL-2 реализован в `paperclip-qa`.
Для work-creating suites `run --live-ok` запускает configurable
`guards.postSuiteHealth` до Telegram/Paperclip side effects и после cleanup.
Красный `guardBefore` блокирует suite до создания work; красный `guardAfter`
пишется в manifest и `ACCEPTANCE.md` как `post-suite-guard`, а decision не
может быть clean accept. Реальный `telegram-testing.config.json` включает
`node scripts/inner-agora-guard.mjs --json` для work-creating release suites.
Осталось: repair backup/command, `guardRepeat`, и общий `release-live-gate`.

Рекомендуемый порядок:

1. **Release Gate First:** RL-1, RL-2, RL-3.
2. **UX Contract First:** RL-5, RL-6, RL-8.
3. **Architecture First:** продолжать Pass C после того, как release lane
   перестанет требовать ручного расследования после каждого suite.

---

## Фаза 0 — Аудит, тесты, заморозка контракта

| ID | Задача | Приоритет | Размер | Зависит от | Готово, когда |
|---|---|---|---|---|---|
| T0.1 | Написать `scripts/regression.mjs` с режимами `record`/`check` **и нормализацией динамических полей** (issue-ID `THE-\d+`, таймстампы, URL, `run=` → плейсхолдеры до сравнения) | P0 | M | — | `record` создаёт снапшоты; `check` зелёный при двух подряд запусках без изменений кода (это и есть проверка нормализации) |
| T0.2 | Записать baseline для всех команд из README smoke-теста (council/ask/dialogue/synthesize/status/latest/recheck/finalize/mode/tasks/task/comments/move) | P0 | S | T0.1 | `node scripts/regression.mjs check` зелёный сразу после записи |
| T0.3 | Явно протестировать поведение `--philosophers` с несуществующим ключом, задокументировать текущий результат | P0 | S | — | Baseline включает этот кейс с зафиксированным (пусть даже плохим) выводом |
| T0.4 | Список мест, где `philosophers.json` захардкожен по имени | P1 | S | — | Список из ≥15 мест с файлом и функцией, приложен к `ARCHITECTURE.md` |
| T0.5 | Вынести `cwd` из `paperclip-cockpit.json` в переменную окружения / `.env.local` вне git | P0 | S | — | `git grep "/Users/admin"` не находит совпадений в конфигах |
| T0.6 | Прогнать `node scripts/inner-agora-guard.mjs` и зафиксировать, какие проверки есть сейчас, каких не хватает | P2 | S | — | Список пробелов приложен к Фазе 8 (self-heal) |

---

## Фаза 1 — Обобщение схемы роли

| ID | Задача | Приоритет | Размер | Зависит от | Готово, когда |
|---|---|---|---|---|---|
| T1.1 | Создать `data/schema/role.schema.json` | P0 | S | — | Валидируется JSON Schema draft 2020-12 линтером |
| T1.2 | Написать `scripts/migrate-roles.mjs`, сгенерировать `chambers/philosophy/roles.json` | P0 | M | T1.1 | Все записи из `data/philosophers.json` присутствуют 1:1 + новые поля `chamberId`/`riskTier` |
| T1.3 | Ввести флаг `CHAMBER_MODE=legacy|chambers` в `agora.mjs`/`import-inner-agora.mjs` | P0 | M | T1.2 | `CHAMBER_MODE=chambers node scripts/regression.mjs check` совпадает с `legacy` |
| T1.4 | Переименовать функции (`philosopherLine`→`roleLine` и т.п.) с deprecated-алиасами | P1 | M | T1.3 | Старые имена работают, помечены `@deprecated` в комментарии |
| T1.5 | `MINIMUM_COUNCIL_KEYS` → `chambers/philosophy/presets/mvp.json` | P1 | S | T1.2 | `council` читает пресет из файла, не из константы в коде |
| T1.6 | Удалить legacy-путь и `CHAMBER_MODE` флаг после зелёного readiness gate | P2 | S | T1.3, migration check, regression зелёный | Done: runtime читает активную палату напрямую, `chambers/philosophy/roles.json` — дефолтный источник |

---

## Фаза 2 — Палаты как плагины

| ID | Задача | Приоритет | Размер | Зависит от | Готово, когда |
|---|---|---|---|---|---|
| T2.1 | Определить JSON Schema для `chamber.json` | P0 | S | T1.1 | Валидатор ловит опечатку в обязательном поле до загрузки |
| T2.2 | Разбить `paperclip-cockpit.json` на `cockpit.core.json` + `chambers/philosophy/cockpit.overrides.json` | P0 | M | T2.1 | Философская палата работает от смёрженного конфига идентично текущему поведению |
| T2.3 | Написать `scripts/chamber-loader.mjs` с `deepMerge`, явно задокументировать поведение для массивов | P0 | M | T2.2 | Юнит-тест на мёрж `allowedSkills`/`labels` |
| T2.4 | Команды `/agora chamber list` / `/agora chamber use <id>` | P0 | M | T2.3 | Переключение палаты сохраняется в `state`, видно в `/agora status` |
| T2.5 | Перенести `companyId` в `chamber.json`, убрать 5-уровневый fuzzy-match для активной палаты | P1 | S | T2.1 | Выбор компании детерминирован при указанной палате |
| T2.6a | Палата `board-directors`, конфигурация: `chamber.json`, `roles.json`-скелет с черновыми промптами, каркас синтезатора | P0 | M | T2.4 | `/agora chamber use board-directors` + `/agora ask` создаёт сессию с бизнес-ролями и своим протоколом прозрачности |
| T2.6b | Палата `board-directors`, контент: промпты CEO/CFO/юриста до качества философских (двигатель, слепые зоны, ошибки имитации, формат) | P1 | L | T2.6a | Каждая роль проходит 2–3 voice-теста (узнаётся без имени); итерируется по живым сессиям, не блокирует T2.6a |
| T2.7 | Regression на обеих палатах одновременно (философия не сломалась от появления второй) | P0 | S | T2.6a | `regression.mjs check` зелёный для обеих палат |

---

## Фаза 3 — Скиллы как отдельный слой

| ID | Задача | Приоритет | Размер | Зависит от | Готово, когда |
|---|---|---|---|---|---|
| T3.1 | `skill.json` schema + `scripts/skill-loader.mjs` с `resolveSkillsForRole()` | P0 | M | T2.1 | Юнит-тест: скилл без опоры в `chamber.allowedSkills` не подключается, логируется предупреждение |
| T3.2 | Скилл `web-research`: `SKILL.md` + `skill.json` (риск-тир L1) | P1 | M | T3.1 | Роль с `skills: ["web-research"]` в разрешающей палате реально может вызвать веб-поиск в dry-run сценарии |
| T3.3 | Скилл `source-citation`: формализовать текущий протокол `[источник]/[реконструкция]` как переиспользуемый модуль | P1 | S | T3.1 | `transparencyPolicy()` подключает модуль по ссылке, не копипастой текста |
| T3.4 | Скилл `memory-export`: обернуть существующий `export-memory` в манифест | P2 | S | T3.1 | `/agora memory` работает как раньше, но теперь описан как скилл |
| T3.5 | Явная проверка риск-тира L2+ на этапе загрузки роли | P0 | S | T3.1 | Роль с L2-скиллом без явного упоминания в обоих местах не запускается, ошибка человекочитаема |

---

## Фаза 4 — Ядро человеческого ассистента

| ID | Задача | Приоритет | Размер | Зависит от | Готово, когда |
|---|---|---|---|---|---|
| T4.0 | **Спайк:** 20 реальных фраз через LM Studio (gemma, reasoning off) с прототипом slot-extraction-промпта; замер валидности JSON и латентности | P0 | S | — (можно на первой неделе, рядом с Фазой 0) | Письменный вывод по матрице из `IMPLEMENTATION_PLAN.md` 5.0: ≥80% → план как есть; 50–80% → few-shot+retry; <50% → редизайн (облачный extractor или структурированный ввод как основной путь) |
| T4.1 | `data/schema/intent-slots.schema.json` (со слотом `intent: new_session/follow_up/dialogue_with_role/other`) | P0 | S | T4.0 позитивный | Валидируется, покрывает `intent/chamber/mode/topic/philosophers/missingSlots` |
| T4.2 | `buildSlotExtractionPrompt()` + первая версия промпта для LLM-извлечения слотов | P0 | L | T4.1; для однопалатного режима НЕ зависит от T2.4 — слот `chamber` исключается из схемы и промпта, подключается позже | На 10 тестовых фразах извлекает корректные слоты в ≥8 случаях |
| T4.3 | `extractIntentSlots()` с валидацией ответа против схемы и fallback на regex | P0 | M | T4.2 | Невалидный JSON от LLM не роняет систему, уходит в `legacyRegexFallback` |
| T4.4 | `decideNextStep()`: правило 0/1/2+ missing slots | P0 | M | T4.3 | Юнит-тесты на все три ветки |
| T4.5 | `questionFor(slot, context)` — короткие конкретные уточняющие вопросы по каждому типу слота | P0 | M | T4.4 | Вопрос по `chamber` и по `mode` — разные, оба короче одной строки |
| T4.6 | `[QW → сделано ранее как QW-1]` `resolvePhilosopherKeys()` — при выполнении фазы только проверить совместимость с новой схемой ролей | P2 | S | QW-1, T1.2 | Работает против `chambers/*/roles.json`, не только legacy-файла |
| T4.7 | Умный `/start`-онбординг поверх статического QW-3: учитывает число палат, предлагает первый вопрос | P1 | M | QW-3, T2.4 | Онбординг меняется при добавлении второй палаты без правки кода |
| T4.8 | Визард создания сессии как повторное использование `decideNextStep` с пустыми слотами | P1 | L | T4.4, T4.5 | Пользователь без единого флага проходит тему→палату→глубину→подтверждение и получает ту же сессию, что и через прямую команду |
| T4.9 | Флаг `ROUTING_MODE=regex|llm`, сравнительный прогон на 20 реальных фразах из истории | P0 | M | T4.3 | Доля fallback на `llm`-режиме <5% на тестовом наборе |
| T4.10 | Сценарные ручные тесты: 6 типичных фраз (5 прежних + follow-up после синтеза) | P0 | S | T4.9, T4.12 | Все 6 дают ожидаемый результат без падения в fallback |
| T4.11 | Follow-up: `createFollowUpChild()` — новая child-задача к последнему root с выжимкой синтеза в описании | P0 | M | T4.1 | Реплика после синтеза продолжает сессию, а не создаёт новую; в ответе видна пометка «продолжаю в контексте THE-X» |
| T4.12 | Follow-up: `dialogueWithContext()` — диалог с конкретной ролью с выжимкой синтеза в контексте | P1 | M | T4.11 | «А что бы Хайдеггер ответил на второе возражение?» уходит именно Хайдеггеру с контекстом сессии |
| T4.13 | Эвристика привязки к последней сессии: свежий `lastSynthesisRef` + отсутствие маркера новой темы → follow-up с явной пометкой и опцией «новый вопрос» | P1 | M | T4.11 | Спорный случай никогда не решается молча — пометка присутствует в ответе |

**Статус на 2026-07-02:** Фаза 4 закрыта по roadmap scope. Evidence: `docs/superpowers/specs/2026-07-02-phase-4-human-assistant-design.md`, `docs/superpowers/plans/2026-07-02-phase-4-human-assistant.md`, `docs/superpowers/plans/2026-07-02-phase-4-completion.md`, `data/schema/intent-slots.schema.json`, `scripts/intent-slots.mjs`, `scripts/agora.mjs`, `hermes-plugins/paperclip-cockpit/__init__.py`. Закрыты хвосты после MVP: T4.7 dynamic `/start` по `chambers/`; T4.8 текстовый wizard `topic -> chamber -> depth -> confirmation`, который на подтверждении вызывает тот же `ask()` path; T4.12 `dialogue-context` для конкретной роли с выжимкой синтеза; T4.13 свежий `lastSynthesisRef` + явная пометка follow-up и escape hatch `новый вопрос:`. Live routing остается local-only: `ROUTING_MODE=llm` через LM Studio, regex только fallback/тестовый режим. Telegram inline buttons для wizard не входят в Фазу 4 и остаются в Фазе 8 после hook-spike по `reply_markup`.

---

## Фаза 5 — Гибридная маршрутизация моделей

| ID | Задача | Приоритет | Размер | Зависит от | Готово, когда |
|---|---|---|---|---|---|
| T5.1 | `models.config.json` с адаптерами и `routingRule` | P0 | S | — | Done: модель меняется правкой JSON, без правки `.mjs`-файлов |
| T5.2 | `setup-hermes-profile.mjs` читает конфиг вместо литералов (закрытие болячки №8) | P0 | M | T5.1 | Done: `git grep "gemma-4-26b" -- "*.mjs"` не находит совпадений |
| T5.3 | `adapterForRequest({mode, chamberRiskTier})` вместо `adapterForMode(mode)` | P1 | M | T5.1 | Done: `local` идет в `hermes_local`; high-stakes full council идет в `codex_local` |
| T5.4 | Логировать использованный адаптер в `state`/комментарии issue | P1 | S | T5.3 | Done: `/agora status`/`/agora latest` показывают адаптер сессии |

**Статус на 2026-07-02:** Фаза 5 закрыта по roadmap scope. Evidence: `models.config.json`, `scripts/model-routing.mjs`, `tests/test_phase5_model_routing.py`, `tests/test_inner_agora_mode.py`, `tests/test_inner_agora_ask_flow.py`. Модели и endpoint defaults вынесены из `.mjs` в `models.config.json`; env overrides сохранены для live/local запусков. `setup-hermes-profile.mjs`, `import-inner-agora.mjs`, `intent-slots.mjs`, `inner-agora-guard.mjs` и `agora.mjs` читают модельные настройки через `model-routing.mjs`. `ask` пишет adapter/model/reason/risk в root issue metadata, root comment и локальный state; `mode get`, `status` и `latest` показывают маршрут. Verification: 110 unit tests passed; both regression modes passed; live local-model fixture was 20/20 semantic correct. Важно: Phase 5 не добавляла внешние credentials или облачный провайдер; `codex_local` остается существующим локальным адаптером/профилем, а правило `fullCouncilHighStakes` только выбирает этот более строгий маршрут.

---

## Фаза 6 — Личная память и per-chat state

| ID | Задача | Приоритет | Размер | Зависит от | Готово, когда |
|---|---|---|---|---|---|
| T6.1 | `data/schema/state.schema.json` с `schemaVersion` | P0 | S | — | Done: валидируется, есть версия схемы |
| T6.2 | `scripts/migrate-state.mjs`: разделение `.inner-agora-state.json` на `state/<chat-id>.json` | P0 | M | T6.1 | Done: старый файл копируется в per-chat профиль при первом запуске, не теряется |
| T6.3 | Прокинуть `chatId` через все команды `agora.mjs` от вызывающего Hermes-плагина | P0 | M | T6.2 | Done: два разных `chatId` не видят `lastIssueRef` друг друга |
| T6.4 | `memory/profiles/<chat-id>.json`: предпочитаемая палата, глубина по умолчанию | P1 | M | T6.3 | Done: повторный запрос без явного режима использует profile/state mode этого чата |
| T6.5 | Миграция схемы состояния при несовпадении `schemaVersion` вместо тихой порчи | P1 | S | T6.1 | Done: unversioned state мигрирует в `schemaVersion: 1` |

**Статус на 2026-07-02:** Фаза 6 закрыта по roadmap scope. Evidence: `data/schema/state.schema.json`, `scripts/state-manager.mjs`, `scripts/migrate-state.mjs`, `scripts/agora.mjs`, `scripts/import-inner-agora.mjs`, `hermes-plugins/paperclip-cockpit/__init__.py`, `tests/test_phase6_state_manager.py`, `tests/test_inner_agora_conversation_cycle.py`, `tests/test_paperclip_cockpit_telegram_callbacks.py`. `INNER_AGORA_CHAT_ID` выбирает `state/<chat-id>.json`; legacy `.inner-agora-state.json` копируется и мигрирует, но не удаляется; explicit `INNER_AGORA_STATE_PATH` остается тестовым/legacy override. Profile memory пишет `preferredMode`, `preferredChamberId`, `recentRoles`; при explicit state path profile изолируется рядом с temp state. Verification: 119 unit tests passed; both regression modes passed; `STATE_MODE=per-chat INNER_AGORA_CHAT_ID=test-chat node scripts/agora.mjs mode get` printed `state=/Users/admin/Documents/The Inner Agora/state/test-chat.json`.

---

## Фаза 7 — Безопасность и дисклеймеры per-chamber

| ID | Задача | Приоритет | Размер | Зависит от | Готово, когда |
|---|---|---|---|---|---|
| T7.1 | Параметризовать `transparencyPolicy()` полем `chamber.transparencyPolicy` | P0 | M | T2.1 | Done: `policy-loader.mjs` физически выводит разные протоколы для philosophy и board-directors |
| T7.2 | Обязательный дисклеймер-блок для `riskTier: high-stakes` (если появится такая палата) | P1 | S | T7.1 | Done: high-stakes дисклеймер вставляется в child-промпт `agora ask` и importer instructions |
| T7.3 | Явный список палат вне review (только `research-only` статус) | P2 | S | T7.1 | Done: `board-directors` помечена `research-only`, схема и loader валидируют статус |

**Статус на 2026-07-03:** Фаза 7 закрыта по roadmap scope. Evidence: `scripts/policy-loader.mjs`, `scripts/agora.mjs`, `scripts/import-inner-agora.mjs`, `data/schema/chamber.schema.json`, `chambers/board-directors/chamber.json`, `skills/business-advisory-transparency`, `skills/high-stakes-disclaimer`, `tests/test_phase7_chamber_safety.py`. Board chamber получила собственный `business-advisory-transparency`, philosophy оставлена на `source-citation`, high-stakes палаты получают обязательный disclaimer из skill prompt до запуска локальной модели. `agora.mjs` и importer больше не держат разные локальные версии policy logic; оба используют shared composition. Verification: 126 unit tests passed; both regression modes passed; `STATE_MODE=per-chat INNER_AGORA_CHAT_ID=test-chat node scripts/agora.mjs mode get` printed `adapter=hermes_local`, `model=google/gemma-4-26b-a4b-qat`, `state=/Users/admin/Documents/The Inner Agora/state/test-chat.json`.

---

## Фаза 8 — Интерфейсы и Telegram UX

| ID | Задача | Приоритет | Размер | Зависит от | Готово, когда |
|---|---|---|---|---|---|
| T8.1 | **Спайк:** проверить, может ли `pre_gateway_dispatch`-хук (или другой доступный хук) вернуть `reply_markup`/inline keyboard | P0 | S | — | Письменный вывод: «да, вот как» либо «нет, план B» — фиксирует, какие задачи ниже актуальны |
| T8.2a | (План A, если кнопки доступны) Inline-кнопки для выбора палаты/глубины при неоднозначности | P1 | M | T8.1 (позитивный) | Уточняющий вопрос из T4.5 показывается как кнопки, а не только текст |
| T8.2b | (План B, если кнопок нет) Пронумерованные текстовые меню с детерминированным маппингом | P1 | S | T8.1 (негативный) | Ответ цифрой однозначно маппится на слот без LLM-извлечения |
| T8.3 | Кнопки/меню быстрых действий после синтеза («Показать разногласия», «Углубить», «Новый вопрос») | P2 | M | T8.2a или T8.2b | Хотя бы одно быстрое действие работает end-to-end |
| T8.4 | Прогресс-сообщения во время долгого совета | P1 | L | T8.1 (нужно знать канал исходящих сообщений) | Пользователь видит промежуточные апдейты до финального синтеза хотя бы для `max`/`all` режимов |
| T8.5 | Пресеты одной командой: «быстрый совет», «глубокое исследование», «go/no-go» | P2 | S | T2.6 | Каждый пресет — рабочий алиас на комбинацию mode+chamber |
| T8.6 | `[QW → сделано ранее как QW-2]` Проактивный self-heal gateway — при выполнении фазы только ревизия после появления палат (health-check покрывает и chamber-loader) | P2 | S | QW-2 | Health-check валидирует загрузку активной палаты, не только gateway |

**Статус на 2026-07-03:** Фаза 8 закрыта по roadmap scope. Evidence: `docs/superpowers/specs/2026-07-03-phase-8-telegram-ux-design.md`, `docs/superpowers/plans/2026-07-03-phase-8-telegram-ux.md`, `scripts/paperclip-cockpit-telegram.mjs`, `scripts/paperclip-cockpit-monitor.mjs`, `scripts/inner-agora-guard.mjs`, `hermes-plugins/paperclip-cockpit/__init__.py`, `paperclip-cockpit.json`, `cockpit.core.json`, `tests/test_paperclip_cockpit_telegram_helper.py`, `tests/test_paperclip_cockpit_monitor.py`, `tests/test_inner_agora_guard.py`. T8.1 result: `pre_gateway_dispatch` is text-only, so ambiguity uses deterministic wizard/numbered menus while inline buttons use the Telegram Bot API side-channel. T8.3/T8.4/T8.5/T8.6 are implemented with quick-action buttons, progress payloads, presets, action env overrides, and chamber-loader health. Verification: 131 unit tests passed; focused Telegram/monitor/guard/conversation suite passed; `node scripts/regression.mjs check` and `CHAMBER_MODE=chambers node scripts/regression.mjs check` passed; local model smoke printed `adapter=hermes_local`, `model=google/gemma-4-26b-a4b-qat`.

---

## Фаза 9 — Наблюдаемость и стоимость

| ID | Задача | Приоритет | Размер | Зависит от | Готово, когда |
|---|---|---|---|---|---|
| T9.1 | Логировать токены каждого LLM-вызова (включая intent-extractor) в `session.costLog[]` | P0 | M | T6.3 | `status`/`latest` показывают сумму по сессии |
| T9.2 | Предупреждение перед созданием сессии в `all`-режиме при превышении порога стоимости | P1 | S | T9.1 | Пользователь видит оценку до подтверждения, а не постфактум |
| T9.3 | Контроль объёма на входе `ask --all` (сейчас есть только `clip()` на выходе синтеза) | P1 | M | — | 84-голосый режим не создаёт 84 child-задачи без явного подтверждения |
| T9.4 | Дашборд/команда `/agora costs` за период | P2 | M | T9.1 | Показывает суммарную стоимость за последние N сессий |

**Срез 2026-07-05:** T9.1 начат локально. `scripts/agora/cost-utils.mjs`
нормализует token usage, `scripts/intent-slots.mjs` прокидывает usage локального
intent extractor, `state.session.costLog[]` описан в state schema, а `status` и
`latest` показывают сумму токенов. T9.4 локально закрыт как read-only dashboard:
`node scripts/agora.mjs costs [--json] [--limit N] [--since ISO|--hours N]`, плюс
`costs` action в cockpit config. Денежная оценка добавлена как явный pricing
config: `costs.config.json` задает zero-cost для локальных LM Studio/Hermes
моделей, а `node scripts/agora.mjs costs --pricing default` считает known cost и
отдельно показывает unknown calls/tokens без тарифа. T9.2/T9.3 локально закрыты
как volume/preflight guard: `ask --all` без `--confirm-all` останавливается до
Paperclip API и показывает оценку количества голосов/child-задач; `--dry-run`
остается безопасным просмотром состава, а `--confirm-all` явно сохраняет прежний
путь создания задач. Еще не закрыто: usage Paperclip agent calls; текущий
preflight пока не делает денежную оценку будущей сессии.

---

## Сводка по приоритетам P0 (то, что нельзя пропускать ни в одной фазе)

Если нужно урезать скоуп под ограниченное время — вот минимальный набор, который всё ещё даёт рабочий результат по каждой фазе:

```
QW-1, QW-2, QW-4
T0.1, T0.2, T0.3, T0.5
T1.1, T1.2, T1.3
T2.1, T2.2, T2.3, T2.4, T2.6a, T2.7
T3.1, T3.5
T4.0, T4.1, T4.2, T4.3, T4.4, T4.5, T4.9, T4.10, T4.11
T5.1, T5.2
T6.1, T6.2, T6.3
T7.1
T8.1
T9.1
```

Всё, что помечено P1/P2, можно двигать в бэклог без риска сломать основной сценарий «доведено до идеала» из `ROADMAP.md`.
