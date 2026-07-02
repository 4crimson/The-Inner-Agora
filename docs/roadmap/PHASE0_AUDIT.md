# Phase 0 Audit

Дата: 2026-07-02

Этот файл фиксирует контракт Фазы 0 перед миграцией `Philosopher` → `CouncilMember` и `philosophy` → `chambers`.

## Baseline

- Regression harness: `scripts/regression.mjs`
- Baseline snapshots: `tests/fixtures/baseline/*.json`
- Unknown `--philosophers` behavior зафиксирован как текущий контракт:
  - command: `node scripts/agora.mjs ask --dry-run --philosophers nonexistent-key "тест"`
  - exit: `1`
  - stderr: `No known philosophers in --philosophers nonexistent-key`

Это поведение пока не улучшается в Фазе 0. Человекочитаемая подсказка ближайших голосов относится к QW-1 / T4.6.

## Philosopher Hardcodes

Минимальный список мест, которые нужно параметризовать в Фазах 1-2:

| # | Файл | Место | Что зашито |
|---|---|---|---|
| 1 | `scripts/agora.mjs` | `DATA_PATH` | Прямое чтение `data/philosophers.json`. |
| 2 | `scripts/agora.mjs` | `MINIMUM_COUNCIL_KEYS` | MVP-состав `plato, descartes, heidegger` как константа. |
| 3 | `scripts/agora.mjs` | `philosophers` / `philosopherByKey` | Глобальный roster загружается как список философов. |
| 4 | `scripts/agora.mjs` | `usage()` | CLI help говорит только о `philosophers`, `voices`, `all philosophers`. |
| 5 | `scripts/agora.mjs` | `philosopherByToken()` | Разрешение роли по `key/name/englishName/aliases` только для философов. |
| 6 | `scripts/agora.mjs` | `philosopherAliases()` / `philosopherScoreInText()` / `philosopherFromText()` | Поиск голосов и fuzzy matching завязаны на философские поля и имена. |
| 7 | `scripts/agora.mjs` | `parseAskArgs()` | Опция называется `--philosophers`; ошибка тоже говорит `philosopher keys or names`. |
| 8 | `scripts/agora.mjs` | `detectMode()` | `all` распознается через фразу `все философы`. |
| 9 | `scripts/agora.mjs` | `requestedVoiceLimit()` | Количество участников ищется через слова `философ`, `голос`, `thinkers`. |
| 10 | `scripts/agora.mjs` | `minimumCouncil()` | `council` строится через `--philosophers MINIMUM_COUNCIL_KEYS`. |
| 11 | `scripts/agora.mjs` | `selectPhilosophers()` | Основной роутер выбора участников — набор философских тематических regex и ключей. |
| 12 | `scripts/agora.mjs` | `modePolicy()` | Режим `all` описан как все философские машины. |
| 13 | `scripts/agora.mjs` | `transparencyPolicy()` | Протокол `[источник]/[реконструкция]/[имитация]` глобален, не per-chamber. |
| 14 | `scripts/agora.mjs` | `philosopherLine()` | Формат строки участника знает `architect` и философскую терминологию. |
| 15 | `scripts/agora.mjs` | `buildRootDescription()` | Root issue говорит `Выбранные философские машины`, `Child-задачи ... назначаются философам`. |
| 16 | `scripts/agora.mjs` | `buildPhilosopherDescription()` | Child prompt строится вокруг `философская машина`, `Эпоха`, `Центральная интуиция`, `Манера`, `Напряжение`. |
| 17 | `scripts/agora.mjs` | `buildDialogueDescription()` | Dialogue prompt жестко философский. |
| 18 | `scripts/agora.mjs` | `ask()` | Создает `Философские задачи`, wake reason `The Inner Agora voice task`. |
| 19 | `scripts/agora.mjs` | `dialogue()` | Требует `<philosopher>`, ищет Paperclip agent по имени философа. |
| 20 | `scripts/agora.mjs` | `tagSummary()` / `listPhilosophers()` | Команда `philosophers` читает теги только текущего roster. |
| 21 | `scripts/agora.mjs` | `latest()` / `voice()` / `result()` | Child issues трактуются как философские голоса; `printSessionActions()` печатает `/agora voice`. |
| 22 | `scripts/agora.mjs` | `synthesize()` | Prompt синтеза говорит `философская сессия` и `Материалы философов`. |
| 23 | `scripts/import-inner-agora.mjs` | `DATA_PATH` / `PROMPTS_DIR` | Импорт читает `data/philosophers.json` и `philosophers/prompts`. |
| 24 | `scripts/import-inner-agora.mjs` | `assistantInstructions()` | Assistant prompt описывает только философскую Агору. |
| 25 | `scripts/import-inner-agora.mjs` | `philosopherInstructions()` | Role prompt целиком философский и использует поля current schema. |
| 26 | `scripts/import-inner-agora.mjs` | `loadPhilosopherPrompts()` / `loadPhilosophers()` | Загрузка prompts/roster зашита в legacy-структуру. |
| 27 | `scripts/import-inner-agora.mjs` | `roleDefs()` | Создает Agora Assistant + философов, не абстрактные chamber roles. |
| 28 | `paperclip-cockpit.json` | `labels`, `terms`, `aliases` | `agent=philosopher`, `agents=philosophers`, русские алиасы `философы`, `мыслители`. |
| 29 | `paperclip-cockpit.json` | `actions.prepare/catalog/voice/council/all/dialogue` | Описания и команды используют философскую терминологию. |
| 30 | `scripts/setup-hermes-profile.mjs` | SOUL command card | Telegram persona говорит `philosopher roster`, `/agora philosophers`, `философы`. |

## Notes

- `scripts/build-philosopher-candidate-bank.mjs` также философский, но это контентный генератор candidate bank. Он не блокирует kernel/chamber migration, пока остается утилитой для палаты `philosophy`.
- README и `docs/MINIMUM_COUNCIL.md` философские по смыслу; их нужно обновлять после появления `chambers`, но они не являются runtime blockers.

## Guard Run

Команда:

```bash
node scripts/inner-agora-guard.mjs --json
```

Результат после обновления callback-contract guard:

- `paperclip.ok = true`
- `gateway.ok = true`
- `monitor.ok = true`
- `telegram.ok = true`
- `telegramAdapter.ok = true`
- `router.ok = true`
- `callback.ok = true`
- `agents.ok = false`

Текущие live Paperclip findings:

- `Аристотель` — status `error`
- `Хайдеггер` — status `error`

Эти агенты не сбрасывались в Фазе 0: это live state, а не deterministic code/config migration. Решение по ним должно быть отдельным explicit operational action.

## Guard / Self-Heal Gaps

Что guard уже проверяет:

- Hermes profile files and plugin presence.
- Hermes gateway launchd status.
- Paperclip cockpit monitor launchd status.
- Paperclip `/api/health`.
- Telegram token/home chat/getMe.
- Hermes Telegram adapter hook contract.
- Natural-language rewrite smoke for a research phrase.
- Telegram callback query contract.
- Agent adapter/model/status sanity.

Пробелы, которые стоит закрывать в QW-2 / T8.6:

| Gap | Почему важно |
|---|---|
| Нет автоматического периодического запуска `inner-agora-guard.mjs --fix`. | Guard умеет чинить часть проблем, но сейчас это ручная команда после того, как бот уже замолчал. |
| Agent `error` status только репортится. | Нет безопасной политики: когда можно reset/retry агента, когда нужно оставить evidence, когда спросить пользователя. |
| Callback contract был завязан на конкретный старый action. | Guard должен сверять актуальную callback config, а не хардкодить исторический `result` для всех проектов. Минимальный фикс сделан: `voice` теперь ожидает `telegram_voice`. |
| Нет canary для `агора помощь`. | Router smoke проверяет research phrase, но не проверяет service-intent priority. Именно это привело к багу `агора помощь` → новая research session. |
| Нет проверки исходящих progress/notification сообщений вне ответа на входящее сообщение. | Фаза 8 требует прогресс-сообщения; guard пока проверяет callback/sendMessage, но не monitor-originated notification path end-to-end. |
| Нет стоимости/latency telemetry. | Будущий slot extractor и long council runs должны иметь видимые latency/cost counters. |
