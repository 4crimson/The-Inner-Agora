# Implementation Plan

**Связанные документы:** `ROADMAP.md` (что и зачем, по фазам), `TASKS.md` (атомарные задачи с ID)
**Назначение этого документа:** для каждой фазы роадмапа — конкретный технический подход: какие файлы трогать, в каком порядке, с каким псевдокодом, и как проверить, что не сломалось.

---

## 0. Как этим пользоваться

Каждый раздел ниже соответствует фазе из `ROADMAP.md` (тот же номер). Раздел содержит:
- **Файлы** — что создаётся/меняется
- **Подход** — конкретика, псевдокод, схемы
- **Как проверить** — критерий готовности в терминах команды/теста, не «ощущения»
- **Оценка** — грубая оценка в днях для одного разработчика, знакомого с проектом
- **Риски** — что может пойти не так

Общее правило миграции через все фазы: **feature-flag, не big-bang rewrite.** Каждая фаза, которая меняет поведение видимой команды, вводит флаг (`CHAMBER_MODE=legacy|chambers`, `ROUTING_MODE=regex|llm` и т.д.), гоняет regression-тесты в обоих режимах, и только после совпадения удаляет старый путь.

---

## 1. Регресс-harness (Фаза 0)

**Файлы:** `tests/fixtures/baseline/*.txt`, `scripts/regression.mjs`

**Подход:**

Никакого сложного тест-фреймворка не нужно — это личный/семейный проект на пять палат, а не SaaS. Достаточно снапшот-теста:

```
scripts/regression.mjs record   → прогоняет список команд с --dry-run, сохраняет stdout в tests/fixtures/baseline/<command-slug>.txt
scripts/regression.mjs check    → прогоняет тот же список, сравнивает построчно с baseline, печатает diff при расхождении
```

**Критично: нормализация динамических полей перед сравнением.** Сырой stdout содержит issue-ID (`THE-42`), ISO-таймстампы, `updated=...`, URL с внутренними ID — они меняются между запусками даже без изменений кода. Без нормализации тест будет вечно красным, и ему перестанут верить в первую же неделю. Прогонять и `record`, и `check` через один и тот же фильтр:

```js
function normalize(stdout) {
  return stdout
    .replace(/THE-\d+/g, "THE-<N>")
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, "<TIMESTAMP>")
    .replace(/updated=\S+/g, "updated=<TS>")
    .replace(/issues\/[a-f0-9-]{8,}/g, "issues/<ID>")
    .replace(/run=\S+/g, "run=<ID>");
}
```

Список регэкспов пополняется по мере обнаружения новых динамических полей — это нормально; ненормально молча принимать красный тест.

Список команд для записи (соответствует README smoke-тестам):
```
council --dry-run "Что такое свобода?"
ask --dry-run --philosophers socrates,kant,foucault "Что такое свобода?"
ask --dry-run --min "тест"
ask --dry-run --max "тест"
mode get
status
philosophers
philosophers --tags
```

Отдельно — тест на болячку №7 (несуществующий ключ философа): `ask --dry-run --philosophers nonexistent-key "тест"` должен дать понятную ошибку, а не тихо пройти. Записать *ожидаемое* поведение как часть baseline, даже если для этого сначала придётся поправить код — то есть эта задача частично заезжает в Фазу 4.1, и это нормально, они об одном.

**Как проверить:** `node scripts/regression.mjs check` зелёный до и после любого последующего рефакторинга.

**Оценка:** 1 день.

**Риски:** нет реальных рисков — это чистый write-only ход, ничего не меняет в поведении.

---

## 2. Обобщение схемы роли (Фаза 1)

**Файлы:** `data/schema/role.schema.json` (новый), `data/philosophers.json` (не трогать), `chambers/philosophy/roles.json` (новый, копия с доп. полями), `scripts/agora.mjs`, `scripts/import-inner-agora.mjs`

**Подход:**

1. Добавить `role.schema.json` из вчерашнего `ARCHITECTURE.md` (раздел 3) как есть — без изменений от вчерашней версии, она уже продумана.
2. Скрипт-мигратор `scripts/migrate-roles.mjs`:
   ```js
   const legacy = JSON.parse(fs.readFileSync("data/philosophers.json"));
   const migrated = legacy.map(p => ({
     ...p,
     chamberId: "philosophy",
     riskTier: "reflective",
   }));
   fs.writeFileSync("chambers/philosophy/roles.json", JSON.stringify(migrated, null, 2));
   ```
   Прогнать, сравнить количество записей и ключей 1:1 со старым файлом (простой `diff` по отсортированным ключам).
3. Feature-flag `CHAMBER_MODE`:
   ```js
   function loadRoles() {
     if (process.env.CHAMBER_MODE === "chambers") {
       return JSON.parse(fs.readFileSync("chambers/philosophy/roles.json"));
     }
     return JSON.parse(fs.readFileSync("data/philosophers.json"));
   }
   ```
4. Переименовать функции (`philosopherLine` → `roleLine` и т.д.), старые имена оставить как `const philosopherLine = roleLine;` на переходный период.

**Как проверить:** `CHAMBER_MODE=chambers node scripts/regression.mjs check` даёт тот же результат, что `CHAMBER_MODE=legacy` (он же дефолт).

**Оценка:** 4–6 дней.

**Риски:** поля вроде `contemporaryPublicFigure` могут быть не у всех записей — мигратор должен явно проставлять дефолты, а не падать на `undefined`.

---

## 3. Палаты как плагины (Фаза 2)

**Файлы:** `chambers/<id>/chamber.json`, `chambers/<id>/roles.json`, `chambers/<id>/presets/*.json`, `cockpit.core.json` (новый, выделен из `paperclip-cockpit.json`), `chambers/<id>/cockpit.overrides.json`, `scripts/chamber-loader.mjs` (новый), `state/<chat-id>.json` (поле `activeChamberId`)

**Подход:**

`chamber-loader.mjs` — единственное место, которое знает про мёрж core+overrides:

```js
function loadChamberConfig(chamberId) {
  const core = JSON.parse(fs.readFileSync("cockpit.core.json"));
  const overridesPath = `chambers/${chamberId}/cockpit.overrides.json`;
  const overrides = fs.existsSync(overridesPath)
    ? JSON.parse(fs.readFileSync(overridesPath))
    : {};
  return deepMerge(core, overrides); // overrides выигрывает на конфликте ключей
}
```

`agora.mjs` больше нигде не хардкодит слово "philosopher" — везде, где сейчас `"philosopher"` в строках, заменяется на `chamber.labels.agent`.

Команды:
```
/agora chamber list          → перечисляет папки в chambers/ с валидным chamber.json
/agora chamber use <id>      → пишет activeChamberId в state/<chat-id>.json, откатывается если id не найден
```

**Пилотная вторая палата (board-directors):** переносится по инструкции из вчерашнего `ARCHITECTURE.md`, раздел 6, но задача явно разбивается на две разные по природе части:
- **(а) Конфигурация** — `chamber.json`, `roles.json`-скелет с черновыми промптами, каркас синтезатора. Кодовая работа, 2–3 дня.
- **(б) Контент ролей** — доведение промптов CEO/CFO/юриста до качества существующих философских (внутренний двигатель, слепые зоны, типичные ошибки имитации, формат ответа). Это неделя+ контентной работы, которая **не блокирует** запуск палаты: (а) запускается с черновиками, (б) итерируется по живым сессиям.

**Бэкап перед миграционными прогонами (QW-4):** `prepare`/`import-inner-agora.mjs` мутируют агентов в живом Paperclip — системе записи. Фазы 1–2 гоняют импорт в режимах `legacy`/`chambers` многократно. До первого такого прогона — `scripts/backup-company.mjs`: дамп `/companies/<id>/org`, всех issues и comments в `backups/<date>/`. Это read-only скрипт на час работы; восстановление вручную по дампу — приемлемо для личного проекта, автоматический restore не нужен.

**Закрытие болячки №11 (fuzzy-match компании):** `chamber.json` получает обязательное поле `companyId`, `getAgora()` в `agora.mjs` использует его напрямую при активной палате, fallback-цепочка из README остаётся только для legacy-режима без палат.

**Порядок миграции без даунтайма (как во вчерашнем `ARCHITECTURE.md`, раздел 8):**
1. Добавить схему, не трогая данные.
2. Скопировать (не переместить) данные в новую структуру.
3. `CHAMBER_MODE=legacy|chambers`, прогнать regression в обоих.
4. Только после совпадения — удалить legacy-путь.
5. Добавить вторую палату только после удаления legacy-пути.

**Как проверить:** один и тот же `agora.mjs` и один Telegram-бот отвечают и на философские, и на бизнес-запросы, переключаясь `/agora chamber use`, без дублирования кода.

**Оценка:** 8–12 дней.

**Риски:** `deepMerge` для конфигов может неожиданно перезаписать массивы вместо их объединения (например, `allowedSkills`) — явно решить для каждого поля, массив мёржится или заменяется, задокументировать в `chamber.json` schema-комментарии.

---

## 4. Скиллы как отдельный слой (Фаза 3)

**Файлы:** `skills/<skill-id>/SKILL.md`, `skills/<skill-id>/skill.json`, `scripts/skill-loader.mjs`

**Подход:**

```js
function resolveSkillsForRole(role, chamber) {
  const requested = role.skills || [];
  const allowed = new Set(chamber.allowedSkills || []);
  return requested.filter(skillId => {
    if (!allowed.has(skillId)) {
      warn(`Skill ${skillId} requested by role ${role.key} but not allowed by chamber ${chamber.id}`);
      return false;
    }
    return true;
  });
}
```

Риск-тир проверяется на этом же шаге: скилл `L2+` требует явного упоминания и в `chamber.allowedSkills`, и в `role.skills` — без обоих не подключается, ошибка логируется, а не проглатывается молча (это тот же принцип «никаких тихих домыслов», что и в Фазе 4).

**Как проверить:** роль без `skills: []` в манифесте не может вызвать инструмент, даже если промпт её об этом просит — проверяется юнит-тестом на `resolveSkillsForRole`.

**Оценка:** 6–8 дней (включая написание 3 стартовых SKILL.md).

**Риски:** нет.

---

## 5. Ядро человеческого ассистента (Фаза 4) — детально

Это центральная новая часть плана, поэтому расписана подробнее остальных.

### 5.0 Спайк-предусловие: способность локальной модели к слот-филлингу (0.5 дня, ДО всего остального в этом разделе)

Весь дизайн ниже стоит на допущении, что модель в контуре надёжно возвращает валидный JSON по схеме. Текущая конфигурация — gemma-26b через LM Studio с `reasoning_effort: none` и выключенным thinking (ваше собственное требование стабильности) — делает это допущение сомнительным. Проверить до написания кода:

1. Собрать 20 реальных фраз из истории Telegram-чата (не синтетических).
2. Прогнать через LM Studio с прототипом slot-extraction-промпта (можно прямо в UI LM Studio, без кода).
3. Замерить: (а) долю ответов, парсящихся как валидный JSON по схеме; (б) долю содержательно верных извлечений; (в) латентность на запрос.

**Матрица решений по результату:**

| Валидных извлечений | Решение |
|---|---|
| ≥80% | План как написан ниже: локальный extractor + regex-fallback |
| 50–80% | Few-shot промпт + один автоматический ретрай при невалидном JSON; перемерить. Если не помогло — строка ниже |
| <50% | Extractor на облачной модели (компромисс privacy: облаку уходит только фраза для извлечения слотов, не содержимое совета) **или** поднять Фазу 8 (кнопки/нумерованные меню) выше 4.1 и сделать структурированный ввод основным путём, а свободный текст — дополнительным |

Латентность >3–4 сек на извлечение — отдельный сигнал: extractor на каждое сообщение будет ощущаться как лаг, стоит рассмотреть более лёгкую локальную модель специально под эту задачу.

### 5.1 Архитектура

```
Свободный текст пользователя
        │
        ▼
┌───────────────────────┐
│   Intent Extractor     │  ← LLM-вызов со строгой JSON-схемой на выходе
│  (structured slots)    │
└───────────────────────┘
        │
        ▼
   { chamber, mode, topic, philosophers?, missingSlots[] }
        │
        ├── missingSlots.length === 0  → детерминированно строится /agora ask ... и выполняется
        ├── missingSlots.length === 1  → один уточняющий вопрос, ждём ответ, повторяем extractor с добавленным контекстом
        └── missingSlots.length >= 2   → предполагаем наиболее вероятный вариант, явно помечаем "предполагаю X, поправь если не так", выполняем с возможностью отмены
```

Ключевая мысль: **LLM никогда не пишет в Paperclip напрямую.** Она только заполняет структурированные слоты. Запись в Paperclip всегда идёт через существующий детерминированный путь `agora.mjs ask`, как сейчас. Это разрешает противоречие между «строгий командный режим» (см. `soul` в `setup-hermes-profile.mjs`: `"Telegram is strict command mode"`) и «понимает человеческую речь»: понимание — это слой перевода в команду, а не замена команды.

### 5.2 Схема слотов

`data/schema/intent-slots.schema.json`:

```json
{
  "type": "object",
  "required": ["intent", "topic", "missingSlots"],
  "properties": {
    "intent": { "enum": ["new_session", "follow_up", "dialogue_with_role", "other"] },
    "chamber": { "type": ["string", "null"] },
    "mode": { "type": ["string", "null"], "enum": ["min", "balanced", "max", "all", null] },
    "topic": { "type": ["string", "null"] },
    "philosophers": { "type": ["array", "null"], "items": { "type": "string" } },
    "missingSlots": { "type": "array", "items": { "enum": ["chamber", "mode", "topic"] } },
    "assumedDefaults": { "type": "array", "items": { "type": "string" } }
  }
}
```

`topic` обязателен содержательно (если пуст — это не запрос на создание сессии, а что-то другое: статус, помощь и т.д. — этот случай обрабатывается существующими intent-роутами `paperclip-cockpit.json`, не новыми слоями). `chamber` обязателен только если активных палат больше одной — **для однопалатного режима слот исключается из схемы и промпта вовсе**, что позволяет начать 4.1 до Фазы 2. `mode` не обязателен — дефолт `balanced`. `intent` — см. 5.7: если в state есть свежий `lastSynthesisRef`, extractor'у передаётся однострочная выжимка последней сессии, и он различает новый вопрос от продолжения.

### 5.3 Функция-извлекатель (псевдокод)

```js
async function extractIntentSlots(userText, context) {
  const prompt = buildSlotExtractionPrompt(userText, {
    availableChambers: context.chambers.map(c => ({ id: c.id, description: c.description })),
    conversationSoFar: context.recentTurns,
  });

  const raw = await callLLM(prompt, { responseFormat: "json", schema: INTENT_SLOTS_SCHEMA });

  try {
    return validateAgainstSchema(raw, INTENT_SLOTS_SCHEMA);
  } catch {
    // fallback: старый regex-детект как последняя линия обороны, не основной путь
    return legacyRegexFallback(userText, context.defaultMode);
  }
}
```

`legacyRegexFallback` — это буквально сегодняшний `detectMode()`/`requestedVoiceLimit()`, не выбрасывается, а понижается в статус аварийного запасного пути на случай недоступности LLM-вызова (например, офлайн у LM Studio).

### 5.4 Правило одного вопроса

```js
function decideNextStep(slots) {
  if (slots.missingSlots.length === 0) return { action: "execute", slots };
  if (slots.missingSlots.length === 1) {
    return { action: "ask", question: questionFor(slots.missingSlots[0], slots) };
  }
  // 2+ missing: предполагаем самое вероятное, не молчим об этом
  const withDefaults = applyMostLikelyDefaults(slots);
  return { action: "confirm", assumedText: describeAssumptions(withDefaults), slots: withDefaults };
}
```

`questionFor("chamber", slots)` — короткий, конкретный вопрос («Это про философию или про бизнес-решение?»), не общий «уточните, пожалуйста».

### 5.5 Валидация ключей философов (закрытие болячки №7)

```js
function resolvePhilosopherKeys(requested, roster) {
  const known = new Set(roster.map(r => r.key));
  const unknown = requested.filter(key => !known.has(key));
  if (unknown.length) {
    const suggestions = unknown.map(key => ({ key, closest: closestMatch(key, roster) }));
    throw new HumanReadableError(
      `Такого голоса нет в текущем составе: ${unknown.join(", ")}. ` +
      `Похожие есть: ${suggestions.map(s => `${s.key} → ${s.closest}`).join(", ")}`
    );
  }
  return requested;
}
```

`closestMatch` — простое расстояние Левенштейна по `key`/`aliases`, без внешних зависимостей.

### 5.6 Онбординг-визард

`/start` — новый обработчик в `paperclip-cockpit.json`/`agora.mjs`, не завязан на LLM-извлечение (это чистый линейный сценарий):

```
Сообщение 1: что такое Агора (метафора совета, не чат-бота)
Сообщение 2: что можно спросить прямо сейчас, с 2 примерами
Сообщение 3 (если больше одной палаты): "С кем начнём: философия или бизнес-решения?"
```

Визард создания сессии (для тех, кто предпочитает пошаговый ввод, не одну фразу) — это тот же `decideNextStep`, вызванный с изначально пустыми слотами и явным намерением "запусти визард", а не отдельная система. Технически это переиспользование 5.1–5.4, не новый код.

### 5.7 Продолжение разговора (follow-up)

Разговор не заканчивается на синтезе. Если у чата есть свежий `lastSynthesisRef` (state уже это хранит), extractor получает в контекст однострочную выжимку последней сессии и различает через слот `intent`:

```js
switch (slots.intent) {
  case "follow_up":
    // новая child-задача к тому же root issue; в описание вкладывается
    // выжимка синтеза + реплика пользователя. Ядро root→child переиспользуется.
    return createFollowUpChild(state.lastRootIssueId, slots.topic, synthesisDigest);
  case "dialogue_with_role":
    // существующий dialogue-механизм, но с контекстом: выжимка синтеза
    // добавляется в buildDialogueDescription перед вопросом
    return dialogueWithContext(slots.philosophers[0], slots.topic, synthesisDigest);
  case "new_session":
  default:
    return decideNextStep(slots); // обычный путь из 5.4
}
```

Эвристика по умолчанию: реплика без явного маркера новой темы в течение N минут после синтеза трактуется как follow-up с пометкой «продолжаю в контексте THE-X; скажи "новый вопрос", если хочешь начать с чистого листа». Никогда не решать молча в спорном случае — это тот же принцип «никаких тихих домыслов».

**Implementation note 2026-07-02:** Phase 4 is implemented against the local-model route. Slot extraction uses generic `roles[]`, validates against `data/schema/intent-slots.schema.json`, and routes natural Telegram text through `scripts/agora.mjs natural`. In live use set `ROUTING_MODE=llm` so the delegate calls LM Studio (`gemma-4-26b-a4b-it-mlx` by default); regex remains deterministic fallback and test mode. Completed follow-up work: dynamic `/start` onboarding from `chambers/`; text wizard (`/agora wizard` + `wizard-answer`) for topic -> chamber -> depth -> confirmation; `dialogue-context` for a specific role with latest synthesis digest; and the fresh `lastSynthesisRef` heuristic that binds ambiguous replies to the previous session only with an explicit "new question" escape hatch. Native Telegram inline buttons for ambiguous choices remain Phase 8 because `pre_gateway_dispatch` currently documents `skip`, `rewrite`, and `allow`, not `reply_markup`.

**Как проверить:**
- Юнит-тесты на `decideNextStep` для всех комбинаций `missingSlots` (0/1/2+).
- Ручной сценарный тест: 6 типичных фраз пользователя ("хочу разобрать вопрос свободы", "надо решить, нанимать ли CTO", "давай что-нибудь глубокое про истину", "визард", "/agora ask --min ...", и — после готового синтеза — "а что бы Хайдеггер ответил на второе возражение?") должны давать ожидаемый результат без падения в fallback.
- Тест на болячку №3: "5-6 сильных философов на тему времени" корректно извлекает диапазон/число, а не падает на "человек пять".

**Оценка:** 10–14 дней после позитивного спайка 5.0 (это самая объёмная фаза v2, аккуратно выделить время на промпт-инжиниринг extractor'а — там будет несколько итераций подбора). При негативном спайке — оценка пересматривается вместе с дизайном, не начинать кодинг по старому плану.

**Риски:**
- Главный риск закрывается спайком 5.0 до старта; не пропускать его ради экономии половины дня.
- LLM может галлюцинировать несуществующий `chamber`/`mode` вне enum — схема-валидация должна жёстко это отбрасывать в fallback, не пропускать.
- Задержка на LLM-вызов извлечения слотов добавляет латентность к каждому сообщению — измеряется в спайке 5.0 и мониторится через Фазу 9.

---

## 6. Гибридная маршрутизация моделей (Фаза 5)

**Файлы:** `models.config.json` (новый), `scripts/setup-hermes-profile.mjs`, `scripts/agora.mjs`

**Подход:**

```json
{
  "adapters": {
    "hermes_local": { "model": "google/gemma-4-26b-a4b-qat", "reasoningEffort": "none" },
    "codex_local": { "model": "..." }
  },
  "routingRule": {
    "default": "codex_local",
    "shortDialogueSingleRole": "hermes_local",
    "fullCouncilHighStakes": "codex_local"
  }
}
```

`setup-hermes-profile.mjs` читает `models.config.json` вместо литералов в коде (закрытие болячки №8). `adapterForMode()` в `agora.mjs` расширяется до `adapterForRequest({mode, chamberRiskTier})`.

**Implementation note 2026-07-02:** Phase 5 is implemented as local-first configurable routing. `models.config.json` is the model source of truth for slot extraction, Hermes profile setup, Paperclip import adapters, guard checks, and Agora request routing. `scripts/model-routing.mjs` owns env overrides and route decisions; `agora.mjs mode get` prints adapter/model/reason; `ask` records adapter metadata into root issue metadata, root comment, and `.inner-agora-state.json`; `status` and `latest` surface that route. `codex_local` remains the existing local adapter/profile, not a new external credentialed cloud route.

**Как проверить:** смена модели в `models.config.json` не требует правки JS.

Verification gate:
- `python3 -m unittest discover -s tests -p 'test_*.py'`
- `node scripts/regression.mjs check`
- `CHAMBER_MODE=chambers node scripts/regression.mjs check`
- `ROUTING_MODE=llm INNER_AGORA_LLM_MODEL=gemma-4-26b-a4b-it-mlx node scripts/intent-slots.mjs fixture-20 --json`
- `git grep "gemma-4-26b" -- "*.mjs"; test $? -eq 1`

Observed 2026-07-02: 110 unit tests passed; both regression modes passed; grep found no `.mjs` model literal; live local-model fixture returned `semanticCorrectRate=1` for 20/20 prompts with `avgLatencyMs=2335`.

**Оценка:** 4–5 дней.

---

## 7. Личная память и per-chat state (Фаза 6)

**Файлы:** `data/schema/state.schema.json` (новый), `state/<chat-id>.json` (заменяет единый `.inner-agora-state.json`), `scripts/migrate-state.mjs`

**Подход:**

```js
function readState(chatId) {
  const legacy = ".inner-agora-state.json";
  const perChat = `state/${chatId}.json`;
  if (!fs.existsSync(perChat) && fs.existsSync(legacy)) {
    // одноразовая миграция: старый общий state становится дефолтным профилем
    fs.mkdirSync("state", { recursive: true });
    fs.copyFileSync(legacy, perChat);
  }
  const raw = JSON.parse(fs.readFileSync(perChat, "utf8") || "{}");
  if (raw.schemaVersion !== CURRENT_STATE_SCHEMA_VERSION) {
    return migrateStateSchema(raw);
  }
  return raw;
}
```

`chatId` пробрасывается во все команды `agora.mjs` из вызывающего Hermes-плагина (сейчас в `__init__.py` chat id уже есть в контексте гейтвея — это просто прокидывание параметра, не новая инфраструктура).

**Implementation note 2026-07-02:** Phase 6 is implemented. `scripts/state-manager.mjs` owns state/profile path resolution, `schemaVersion: 1` migration, legacy copy from `.inner-agora-state.json`, and profile memory. `scripts/agora.mjs` and `scripts/import-inner-agora.mjs` use the shared manager. `hermes-plugins/paperclip-cockpit/__init__.py` passes `INNER_AGORA_CHAT_ID` into natural delegate and callback action subprocesses. Tests prove two Telegram chats keep separate `lastRootIssueRef` values.

**Как проверить:** два разных `chatId` не видят `lastIssueRef` друг друга; старый `.inner-agora-state.json` мигрирует автоматически при первом запуске.

Verification gate:
- `python3 -m unittest discover -s tests -p 'test_*.py'`
- `node scripts/regression.mjs check`
- `CHAMBER_MODE=chambers node scripts/regression.mjs check`
- `STATE_MODE=per-chat INNER_AGORA_CHAT_ID=test-chat node scripts/agora.mjs mode get`

Observed 2026-07-02: 119 unit tests passed; both regression modes passed; per-chat mode printed `state=/Users/admin/Documents/The Inner Agora/state/test-chat.json`.

**Оценка:** 5–7 дней.

---

## 8. Безопасность и дисклеймеры per-chamber (Фаза 7)

**Файлы:** `chambers/<id>/chamber.json` (поле `transparencyPolicy`), `scripts/agora.mjs` (`transparencyPolicy()` → читает из активной палаты вместо жёстко зашитого текста)

**Подход:** `transparencyPolicy()` в `import-inner-agora.mjs` перестаёт быть одной функцией на всё приложение — она параметризуется `chamber.transparencyPolicy`, high-stakes палаты получают обязательный блок дисклеймера, вставляемый в каждый child-промпт, а не только упоминаемый в документации.

**Implementation note 2026-07-03:** Phase 7 is implemented. `scripts/policy-loader.mjs` owns shared policy composition and appends `skills/high-stakes-disclaimer` when `chamber.riskTier === "high-stakes"`. `chambers/board-directors/chamber.json` is now `research-only`, `riskTier: advisory`, and uses `business-advisory-transparency`; `chambers/philosophy/chamber.json` declares `riskTier: reflective`. `scripts/agora.mjs` and `scripts/import-inner-agora.mjs` both use the shared composer, and non-philosophy prompts use neutral chamber/role language instead of philosophy-specific identity.

**Как проверить:** `node scripts/policy-loader.mjs compose board-directors` shows the advisory memo protocol; a high-stakes temporary chamber receives `Обязательный high-stakes дисклеймер` in both `agora ask` child prompts and importer `--print-role-instructions`.

Verification gate:
- `python3 -m unittest discover -s tests -p 'test_*.py'`
- `node scripts/regression.mjs check`
- `CHAMBER_MODE=chambers node scripts/regression.mjs check`
- `STATE_MODE=per-chat INNER_AGORA_CHAT_ID=test-chat node scripts/agora.mjs mode get`

Observed 2026-07-03: 126 unit tests passed; both regression modes passed; per-chat mode printed `adapter=hermes_local`, `model=google/gemma-4-26b-a4b-qat`, `state=/Users/admin/Documents/The Inner Agora/state/test-chat.json`.

**Оценка:** 3–4 дня (в основном текстовая работа, не код).

---

## 9. Интерфейсы и Telegram UX (Фаза 8)

**Файлы:** `hermes-plugins/paperclip-cockpit/__init__.py` (проверка возможностей hook'а), `scripts/agora.mjs` (прогресс-сообщения, пресеты)

### 9.1 Спайк: доступны ли inline-кнопки

Это первая задача фазы и явно ограничена по времени (0.5 дня). Проверить:
1. Есть ли в API хука `pre_gateway_dispatch` (или в другом доступном хуке Hermes-плагина) возможность вернуть не просто текст, а структуру с `reply_markup`.
2. Если нет прямого способа — есть ли способ вызвать Telegram Bot API напрямую из плагина в обход стандартного пути ответа (не рекомендуется как основной путь, но стоит знать, возможно ли).

Результат спайка определяет План A/B из `ROADMAP.md` — здесь сознательно не проектируется реализация кнопок заранее, чтобы не писать код под недоказанную возможность платформы.

### 9.2 Прогресс-сообщения (не зависит от исхода спайка)

```js
async function askWithProgress(rootIssue, selectedRoles) {
  const childIssues = await createChildIssues(rootIssue, selectedRoles);
  notifyUser(`Совет собран: ${childIssues.length} участников. Жду ответов…`);
  pollForCompletion(childIssues, {
    onEachComplete: (issue) => notifyUser(`${issue.roleName} ответил(а). Осталось: ${remaining(childIssues)}.`),
    onAllComplete: () => notifyUser("Все ответили — можно запускать синтез: /agora synth " + rootIssue.identifier),
  });
}
```

Это не блокирующий поллинг внутри одного вызова CLI (текущий `agora.mjs` — короткоживущий процесс), а отдельный лёгкий воркер/cron, который проверяет статус child-issues раз в N секунд и шлёт апдейт через тот же канал, что использует Hermes для исходящих сообщений — нужно свериться с тем, как именно Hermes-плагины могут инициировать исходящее сообщение вне ответа на входящее (тоже часть спайка 9.1).

### 9.3 Проактивный self-heal gateway (закрытие болячки №6)

```js
// cron/health-check, не по требованию пользователя
async function proactiveGuard() {
  const health = await checkGatewayHealth();
  if (!health.ok) {
    await runGuardFix();
    logSelfHeal(health, "auto");
  }
}
```

**Как проверить:** тишина бота после `EX_TEMPFAIL` устраняется автоматически в пределах интервала health-check, без ручного `launchctl kickstart`.

**Оценка:** 6–9 дней (сильно зависит от исхода спайка 9.1 — если кнопок нет, План B заметно проще и быстрее плана A).

---

## 10. Наблюдаемость и стоимость (Фаза 9)

**Файлы:** `scripts/agora.mjs` (`status`, `latest`), `state/<chat-id>.json` (поле `sessionCost`)

**Подход:** каждый вызов LLM (включая новый intent-extractor из Фазы 4) логирует токены в `session.costLog[]`; `status`/`latest` суммируют и показывают. Явный лимит на `ask --all`: если предполагаемое число участников × средний размер ответа превышает порог — предупреждение перед созданием, не после.

**Оценка:** 4–5 дней.

---

## 11. Сводная стратегия миграции (все фазы)

| Флаг | Фаза | Значения | Когда убрать legacy |
|---|---|---|---|
| `CHAMBER_MODE` | 1–2 | `legacy` / `chambers` | После совпадения regression на обоих режимах |
| `ROUTING_MODE` | 4 | `regex` / `llm` | После сценарных тестов 5 типичных фраз, стабильных 2+ недели в проде |
| `STATE_MODE` | 6 | `single-file` / `per-chat` | После однократной успешной автомиграции у реального пользователя |

Ни один флаг не должен жить дольше одной-двух фаз после введения — иначе накапливается вторая версия технического долга поверх первой.

## 12. Метрики успеха (как измерить, что «стало по-человечески»)

Субъективные ощущения плохо проверяются, поэтому фиксируются прокси-метрики:

- Доля сессий, где потребовался ровно 0 или 1 уточняющий вопрос (цель: >85%).
- Доля сообщений, ушедших в `legacyRegexFallback` (цель: <5% в установившемся режиме — иначе LLM-extractor работает хуже, чем должен, и это сигнал чинить промпт, а не полагаться на fallback).
- Время от `/start` до первой успешно созданной сессии у нового пользователя без обращения к README (замерить вручную на 2–3 тестовых прогонах).
- Количество ручных `launchctl kickstart` в месяц (цель: 0 после Фазы 8.3).
