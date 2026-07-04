# The Inner Agora

Простой локальный проект для философских диалогов через Paperclip и Hermes.

Идея: это не "совет директоров" и не обычный чат-бот. Это набор философских машин-личностей. Пользователь задает вопрос, система вызывает одного или нескольких философов, каждый отвечает из своей оптики, а `Agora Assistant / Синтезатор` собирает карту позиций и конфликтов.

## Для чего проект

The Inner Agora сделана как рабочий контур для вдумчивого разговора с несколькими интеллектуальными оптиками через обычный человеческий язык.

Главная цель — не получить быстрый "ответ от бота", а созвать видимый совет: поставить вопрос, раздать его разным голосам, дождаться отдельных позиций, собрать синтез и продолжить разговор по итогам. Paperclip дает этому процессу durable-структуру: root issue для сессии, child issues для голосов, отдельную задачу синтеза, историю комментариев и возможность вернуться к результатам позже.

Проект также служит тестовой площадкой для универсального `paperclip-cockpit`: Telegram должен быть не командной строкой, а человеческим интерфейсом к Paperclip/Hermes. Поэтому здесь отдельно развиваются кнопки, progress-сообщения, понятные ошибки, live QA-прогоны, hard cleanup тестовых артефактов и config-driven plugin API без привязки к философии.

## Что проект умеет сейчас

- Принимать обычные вопросы через Telegram/Hermes и превращать их в Paperclip-сессии.
- Работать local-first: быстрые и глубокие пресеты идут через локальную модель/локальный Hermes route, если это задано режимом.
- Выбирать состав голосов автоматически или принимать явный список философов.
- Создавать разные форматы разбора: короткий совет, balanced/max/all council, диалог с одним философом, follow-up к последней сессии.
- Показывать пользователю прогресс долгой сессии и присылать итог в Telegram.
- Давать inline-кнопки для синтеза, отдельных голосов, всех голосов, уточнения, углубления и нового вопроса.
- Перехватывать Telegram service-команды (`/help`, `/agora`, `/agora help`, `/agents`) и показывать Agora-меню вместо сырого Hermes UI.
- Давать читаемую полную справку через `/agora help full`.
- Экспортировать готовые сессии в Markdown-память.
- Проверять живой контур guard-скриптом: профиль Hermes, Paperclip, Telegram, callbacks, chamber loader, cockpit config.
- Запускать repeatable Telegram QA suites через userbot, собирать evidence, баги и чистить тестовые сообщения/задачи.
- Использовать один generic plugin-слой для других Paperclip-проектов: command boundary, меню и callbacks задаются через config, а не хардкодятся в Python.

## Чем это не является

- Это не имитация "настоящего Платона" или любого современного автора. Это реконструкция интеллектуальной оптики по текстам и публичным идеям.
- Это не замена источниковедению: точные цитаты, страницы и ссылки нельзя выдумывать.
- Это не медицинский, юридический или финансовый советчик. Для high-stakes тем нужны отдельные политики, дисклеймеры и проверка источников.
- Это не облачный SaaS по умолчанию: текущий фокус — локальный, воспроизводимый, наблюдаемый контур.

## Что уже есть

- Paperclip company: `The Inner Agora`
- Project: `Agora Sessions`
- Hermes profile: `inneragora`
- Hermes plugin: `paperclip-cockpit`
- Cockpit config: `paperclip-cockpit.json`
- CLI bridge: `scripts/agora.mjs`
- Активный состав философов: 84 машины в `data/philosophers.json`
- Markdown-каталог философов и промптов: `philosophers/README.md`
- Активный Paperclip roster: `philosophers/active-roster.md`
- Большой банк кандидатов, рейтинги и draft-промпты: `philosophers/candidates/`
- Память экспортов: `memory/sessions/` (не коммитится в git)

## Как устроено

| Слой | Что делает |
|------|------------|
| `Agora Assistant / Синтезатор` | Модерирует сессию и собирает итог |
| Архитекторы | Платон, Декарт, Хайдеггер задают верхнюю рамку мышления |
| Философы | Отдельные Paperclip-агенты с личной интеллектуальной оптикой |
| Сессии | Root issue + child issue для каждого выбранного философа |
| Память | Экспорт готовых сессий в Markdown |

## Состав

Полная рабочая папка для проработки личностей: [philosophers/README.md](philosophers/README.md).

Текущий импортируемый в Paperclip состав: [philosophers/active-roster.md](philosophers/active-roster.md).

Широкий банк всех кандидатов из канона, включая тех, кто пока не импортируется в Paperclip: [philosophers/candidates/](philosophers/candidates/README.md).

Архитекторы над пространством:
[Платон](philosophers/prompts/plato.md), [Декарт](philosophers/prompts/descartes.md), [Хайдеггер](philosophers/prompts/heidegger.md).

Античность:
[Сократ](philosophers/prompts/socrates.md), [Диоген](philosophers/prompts/diogenes.md), [Платон](philosophers/prompts/plato.md), [Аристотель](philosophers/prompts/aristotle.md), [Парменид](philosophers/prompts/parmenides.md), [Пиррон](philosophers/prompts/pyrrho.md), [Эпикур](philosophers/prompts/epicurus.md), [Эпиктет](philosophers/prompts/epictetus.md), [Марк Аврелий](philosophers/prompts/marcus-aurelius.md), [Плотин](philosophers/prompts/plotinus.md).

Христианская и средневековая мысль:
[Августин](philosophers/prompts/augustine.md), [Фома Аквинский](philosophers/prompts/aquinas.md), [Николай Кузанский](philosophers/prompts/cusanus.md).

Новое время и немецкая классика:
[Декарт](philosophers/prompts/descartes.md), [Спиноза](philosophers/prompts/spinoza.md), [Руссо](philosophers/prompts/rousseau.md), [Кант](philosophers/prompts/kant.md), [Гегель](philosophers/prompts/hegel.md).

Современность и постструктурализм:
[Ницше](philosophers/prompts/nietzsche.md), [Хайдеггер](philosophers/prompts/heidegger.md), [Ролан Барт](philosophers/prompts/barthes.md), [Бодрийяр](philosophers/prompts/baudrillard.md), [Делез](philosophers/prompts/deleuze.md), [Фуко](philosophers/prompts/foucault.md), [Дугин](philosophers/prompts/dugin.md).

Для современных публичных фигур система работает как реконструкция интеллектуальной оптики по публичным идеям, а не как утверждение, что говорит сам человек.

Редактируемые Paperclip-промпты лежат в `philosophers/prompts/`. После правок запусти `node scripts/agora.mjs prepare`, чтобы обновить агентов в Paperclip.

Исследовательские досье, карта конфликтов и тесты голосов лежат в [philosophers](philosophers/README.md).

## Прозрачность

Все философские машины обязаны по возможности маркировать, что именно они делают: `[источник]`, `[реконструкция]`, `[имитация]`, `[современный перенос]`. В конце содержательного ответа должен быть короткий блок `Пометки:` с источниками, реконструкциями, имитацией голоса, современными переносами и тем, что требует проверки. Точные цитаты, страницы и ссылки нельзя выдумывать: если агент не уверен, он пишет `нужна проверка источника`.

## Быстрый старт

Из папки проекта:

```bash
cd "/Users/admin/Documents/The Inner Agora"
```

Подготовить Hermes-профиль:

```bash
node scripts/setup-hermes-profile.mjs
```

Проверить окружение:

```bash
node scripts/inner-agora-guard.mjs
```

Импортировать или обновить агентов в Paperclip:

```bash
node scripts/agora.mjs prepare
```

Посмотреть статус:

```bash
node scripts/agora.mjs status
```

## Основные команды

Минимально работающий совет:

```bash
node scripts/agora.mjs council "Что такое свобода в цифровой среде?"
```

Он всегда вызывает трех архитекторов: Платон, Декарт, Хайдеггер.
Цель и критерии MVP описаны в `docs/MINIMUM_COUNCIL.md`.

Создать совет из автоматически выбранных философов:

```bash
node scripts/agora.mjs ask "Что такое свобода в цифровой среде?"
```

Создать совет из конкретных философов:

```bash
node scripts/agora.mjs ask --philosophers socrates,kant,foucault "Что такое свобода?"
```

Поговорить с одним философом:

```bash
node scripts/agora.mjs dialogue heidegger "Что значит мыслить технически?"
```

После того как философы ответили, собрать синтез:

```bash
node scripts/agora.mjs synthesize THE-1
```

`THE-1` здесь пример. Используй root issue, который вернула команда `ask`.

Экспортировать готовую задачу в Markdown-память:

```bash
node scripts/agora.mjs export-memory THE-3
```

`THE-3` здесь пример. Обычно экспортируют задачу синтеза.

## Режимы

| Режим | Команда | Что делает |
|-------|---------|------------|
| `min` | `--min` | Быстрый разбор на 2-3 голоса |
| `balanced` | по умолчанию | Обычно 5-7 релевантных голосов |
| `max` | `--max` | Широкий совет, примерно до 12 голосов |
| `all` | `--all` | Все философы из списка |

Примеры:

```bash
node scripts/agora.mjs ask --min "С чего начать исследование?"
node scripts/agora.mjs ask --max "Что такое подлинность?"
node scripts/agora.mjs ask --all "Что такое истина?"
```

## Имена для `--philosophers`

Используй ключи из `data/philosophers.json`.

Полный текущий список смотри в [philosophers/active-roster.md](philosophers/active-roster.md).

Примеры ключей:

```text
socrates, plato, aristotle, parmenides, pyrrho, epicurus,
diogenes, epictetus, marcus-aurelius, plotinus, augustine, aquinas,
cusanus, descartes, spinoza, rousseau, kant, hegel,
nietzsche, heidegger, barthes, baudrillard, deleuze,
foucault, dugin
```

Расширенный список лежит в `philosophers/candidates/`, но эти кандидаты не импортируются в Paperclip, пока мы не включим их осознанно.

## Hermes

Локальная команда профиля:

```bash
inneragora status
```

Проверить gateway:

```bash
inneragora gateway status
```

Если Telegram молчит, а Paperclip жив, сначала проверь проектный guard:

```bash
node scripts/inner-agora-guard.mjs --fix
```

Этот случай уже встречался: `inneragora gateway status` показывал зарегистрированный launchd-service без PID и `last exit code = 75: EX_TEMPFAIL` после planned restart. `--fix` поднимает профиль через `inneragora gateway start` и проверяет PID повторно.

Сейчас профиль `inneragora` настроен как отдельный Telegram gateway. Токен хранится локально в `~/.hermes/profiles/inneragora/.env` и не входит в git.

Для стабильной работы через LM Studio держи reasoning/thinking выключенным в настройках модели:
`Enable Thinking = off`, `Preserve Thinking = off`. Проектный Hermes-профиль также проверяет, что `reasoning_effort: none` и модель по умолчанию `google/gemma-4-26b-a4b-qat`.

Telegram menu показывает одну команду проекта: `/agora`. Это универсальный `paperclip-cockpit`, настроенный через `paperclip-cockpit.json`; generic `/pc` в этом проекте не регистрируется.

С 2026-07-04 первый Telegram-экран следует контракту `docs/superpowers/specs/2026-07-04-telegram-interface-contract-design.md`: `/help`, `/agora` и `/agora help` показывают `The Inner Agora`, короткое описание через философов и кнопки `Новый вопрос`, `Последняя сессия`, `Итог`, `История`, `Помощь`. Главный экран больше не показывает Paperclip, диагностику, режимы, каталог, `Синтез` или `Все голоса`.

`Новый вопрос` открывает безопасный выбор формата, а не создает Paperclip-сессию: `Быстрый совет`, `Глубокое исследование`, `Спросить одного`, `Выбрать философов`, `Назад`. `Спросить одного` поддерживает локальный поиск по русскому/английскому имени и близким alias с максимум тремя вариантами; выбор философа сохраняется в per-chat pending state, и следующий обычный текст становится ask-one запросом к выбранному философу. Глубокий разбор предлагает 6 философов и требует отдельного подтверждения. Обычный свободный текст в Telegram-safe dry-run сначала возвращает подтверждение темы (`Я понял тему... Запустить?`) с кнопками выбора, чтобы Paperclip work не создавался молча; `Запустить`, `Сделать быстро` и `Сделать глубоко` используют сохраненную тему, а `Изменить тему`/`Отмена` очищают черновик. `Выбрать философов` по сохраненной теме показывает 4-философский proposal; `Добавить`/`Убрать` меняют сохраненный состав через короткий поиск, и только `Запустить` создает точный `--philosophers ...` состав.

Режимные кнопки не показывают технический размер состава: `Быстро`, `Сбаланс`, `Глубоко`, `Codex`, `Свои голоса`, `Проверить`. `Все голоса` остается CLI/action-возможностью, но не предлагается как обычная Telegram-кнопка. `Проверить` означает режим практического выбора "делать / не делать": пользователь описывает конкретное решение, критерии, цену ошибки и дедлайн, а ответ должен дать решение, условия, риски и следующий шаг.

Первичные payload-кнопки используют пользовательские слова: `Итог`, `Философы`, `Продолжить`, `Новый вопрос`, `Детали`. Верхнеуровневые `Последняя сессия`, `Итог`, `История`, `Философы` читают Paperclip read-only и возвращают compact Telegram payloads: последнюю root-сессию, последний готовый итог, первые 5 root-сессий из истории или философов текущей сессии. `История` нумерует видимые сессии и дает кнопки `1 THE-...`, `2 THE-...`, чтобы открыть выбранную compact session card одним нажатием. `Продолжить` и `Уточнить` сохраняют текущую root-сессию в per-chat pending state, поэтому следующий обычный текст становится `/agora follow-up` к этой сессии. Финальное авто-уведомление `send-result` отправляет короткое `Итог готов` с 3-6 строками, а полный материал открывается через `Полный итог`; кнопка `Разногласия` появляется только при явном marker-е конфликта в итоговом тексте. История поддерживает read-only пагинацию и фильтры `В работе`, `С итогом`, `Остановленные`. Технические поля, Paperclip, route/model и экспорт остаются вторым уровнем через `Детали`/полную справку. `Остановить` работает как двухшаговый flow: сначала confirmation, затем confirmed cleanup скрывает/cancel root и child-задачи этой сессии и пытается отменить active runs. Ошибки action-callbacks могут показывать recovery-кнопки, но фактический repair/retry остается отдельным явным шагом. QA-кнопки в `Помощь -> Состояние` читают последний существующий `artifacts/telegram-test-runs/*` (`manifest.json`, `REPORT.md`, `bugs.jsonl`) и не запускают live suite. QA launch и live acceptance остаются отдельными пакетами работ после non-live проверки и явного live-approval.

`Полный итог` показывает форматированный Telegram-текст полного memo: заголовок `Полный итог: THE-...`, тему и содержательные секции. Служебные строки `# Результат`, `status`, `пакет`, `url`, `источник`, `примечание` и блок `Дальше: /agora ...` не выводятся в этот экран; такие детали остаются за кнопкой `Детали`.

Если Paperclip agent output пришел как `review diff` для `synthesis_final.json`, Telegram formatter извлекает содержательное поле `comment` и показывает его как обычный итог. Diff-заголовки, `@@`, leading `+`, JSON wrapper и markdown `**` в пользовательский экран не попадают.

В `paperclip-cockpit.json` включен `gateway.reset_on_gateway_shutdown`: если Hermes прислал `Gateway shutting down — Your current task will be interrupted` и пометил сессию как interrupted/resume-pending, следующий входящий Telegram-turn начнется с чистого Hermes-контекста, а не с автопродолжения старого.

Также включены stale-context guards: `reset_session_age_minutes: 60` и `reset_idle_minutes: 15`. Если Telegram-сессия слишком старая или простаивала, cockpit сбросит Hermes-контекст до вызова модели, чтобы старые обещания про фоновых агентов не жили часами.

Для Telegram-профиля `inneragora` отключены toolsets `delegation`, `code_execution` и `session_search`, а авто-review памяти/скиллов выключен через интервалы `0`. Долгие исследования должны создаваться как Paperclip-сессии через `/agora ask`, чтобы у них были видимые issue, а не невидимые фоновые subagents. Запросы про последнюю задачу, подтаски и результаты должны идти в Paperclip через `/agora latest`, а не в старую историю Telegram.

```text
/agora help
/agora health
/agora agoras
/agora philosophers [--tags|--tag TAG]
/agora sessions [open|all|todo|in_progress|blocked|done|cancelled] [limit]
/agora session THE-1
/agora notes THE-1
/agora capabilities
/agora prepare [local|balanced|max]
/agora status
/agora mode [get|set MODE]
/agora latest [THE-18]
/agora council QUESTION
/agora ask [--min|--balanced|--max|--all|--philosophers list] QUESTION
/agora min QUESTION
/agora max QUESTION
/agora all QUESTION
/agora dialogue PHILOSOPHER QUESTION
/agora synth THE-1
/agora memory THE-3
/agora guard
```

`/agora philosophers`, `/agora sessions`, `/agora notes` — это не отдельный Agora-плагин. Это словарь The Inner Agora поверх универсального `paperclip-cockpit`.

Философы размечены структурно в `agent.metadata.tags`. Команды `/agora philosophers --tags` и `/agora philosophers --tag ethics` позволяют смотреть словарь тегов и фильтровать состав.

`THE-1` и `THE-3` в примерах нужно заменить на реальные issue из Paperclip.

## Telegram/Paperclip QA

Canonical QA harness lives in `hermes-plugins/paperclip-cockpit/qa-tool/`; `paperclip-qa-tool/bin/paperclip-qa.mjs` is a compatibility wrapper, and project binding lives in `telegram-testing.config.json`.
Run artifacts are written to `artifacts/telegram-test-runs/` and are ignored by git.
Telegram QA callbacks are read-only surfaces over those existing artifacts: `QA статус` summarizes latest manifest, `Последний QA отчет` clips `REPORT.md`, `Упавшие проверки` lists failed tests/bugs, and `Cleanup статус` reads manifest cleanup metadata. They do not create Telegram messages, Paperclip issues, or new QA runs by themselves.
Live interface acceptance is gated by the saved operator checklist in [docs/telegram-testing/TELEGRAM_INTERFACE_LIVE_ACCEPTANCE_CHECKLIST.md](docs/telegram-testing/TELEGRAM_INTERFACE_LIVE_ACCEPTANCE_CHECKLIST.md).

Safe non-live checks:

```bash
python3 -m unittest tests.test_paperclip_cockpit_rewrites tests.test_paperclip_cockpit_telegram_callbacks tests.test_paperclip_cockpit_telegram_helper tests.test_phase4_intent_slots tests.test_inner_agora_ask_flow
node --check scripts/agora.mjs
node --check scripts/paperclip-cockpit-telegram.mjs
python3 -m py_compile hermes-plugins/paperclip-cockpit/__init__.py
node -e "JSON.parse(require('fs').readFileSync('paperclip-cockpit.json','utf8')); console.log('json ok')"
[ -f .env ] && set -a && source .env && set +a
node paperclip-qa-tool/bin/paperclip-qa.mjs config-check --config telegram-testing.config.json --json
node paperclip-qa-tool/bin/paperclip-qa.mjs completion-check --config telegram-testing.config.json --json
node paperclip-qa-tool/bin/paperclip-qa.mjs release-plan --config telegram-testing.config.json --cleanup hard --json
node paperclip-qa-tool/bin/paperclip-qa.mjs readiness --config telegram-testing.config.json --suite help --cleanup hard --json
node paperclip-qa-tool/bin/paperclip-qa.mjs live-plan --config telegram-testing.config.json --suite help --cleanup hard --json
node paperclip-qa-tool/bin/paperclip-qa.mjs health --config telegram-testing.config.json --json
node paperclip-qa-tool/bin/paperclip-qa.mjs telegram-check --config telegram-testing.config.json --json
node paperclip-qa-tool/bin/paperclip-qa.mjs run --config telegram-testing.config.json --suite help --dry-run --json
```

`readiness` returns `readyForLive: false` when Telegram userbot env is missing. That is expected; load local `.env` first. The CLI intentionally does not read `.env` by itself, so secrets stay under the operator's shell control.

`config-check` also prints `guards.allowWarnings`. These are predeclared warnings with reasons; they are visible before live confirmation and do not automatically approve a red guard.

Report and bug output for an existing run:

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs report --config telegram-testing.config.json --run QA-... --json
node paperclip-qa-tool/bin/paperclip-qa.mjs acceptance --config telegram-testing.config.json --run QA-... --json
node paperclip-qa-tool/bin/paperclip-qa.mjs bugs --config telegram-testing.config.json --run QA-... --dry-run --json
node paperclip-qa-tool/bin/paperclip-qa.mjs bug-batch --config telegram-testing.config.json --run QA-... --json
node paperclip-qa-tool/bin/paperclip-qa.mjs bug-batch --config telegram-testing.config.json --run QA-... --area telegram-ui --json
node paperclip-qa-tool/bin/paperclip-qa.mjs retest --config telegram-testing.config.json --run QA-... --dry-run --json
```

Live retest reruns only failed test ids from the previous manifest and then writes cleanup/report/bug artifacts:

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs retest --config telegram-testing.config.json --run QA-... --cleanup hard --live-ok --json
```

Cleanup for a manifest-backed run:

```bash
node paperclip-qa-tool/bin/paperclip-qa.mjs cleanup --config telegram-testing.config.json --run QA-... --mode hard --live-ok --json
```

When a live run or retest is started with `--cleanup hard|soft`, the same manifest-backed cleanup runs automatically after the suite and is written into `manifest.json`. Completed non-dry runs also write `REPORT.md`, `ACCEPTANCE.md`, and `bugs.jsonl` in the run directory.

Do not add `--notify telegram` when the notification target is the same bot being tested. In live acceptance this can be interpreted as ordinary user text and create Paperclip follow-up work. Report QA results in Codex chat/artifacts or use a separate out-of-band notification target.

Live Telegram runs require an explicit operator confirmation immediately before the run:

```text
This will send Telegram messages and may create Paperclip issues. Cleanup will run with hard-delete-first and soft fallback. Proceed?
```

For the 2026-07-04 interface contract, do not run live Telegram or Paperclip suites from documentation alone. First run the non-live checks above, then QA readiness/live-plan, then ask the operator for an explicit `можно трогать живую систему`. After confirmation, pass `--live-ok` on the exact command being run.

The canonical QA runner and Codex QA workflow plugin now live inside `hermes-plugins/paperclip-cockpit/`: `qa-tool/` contains the runtime, and `codex-plugin/telegram-paperclip-qa/` contains the tester/developer/retest/release discipline. The root `paperclip-qa-tool/bin/paperclip-qa.mjs` command is a compatibility wrapper.

Обычные read-only фразы про Paperclip тоже разрешены для Hermes: например, `список философов`, `кто в перклипе`, `узнай список философов в перклипе`, `статус`, `задачи`. Они должны запускать безопасные команды чтения, а не создавать новые задачи.

Для создания исследовательской сессии можно писать явно:

```text
поставь задачу: исследование времени в восточной и иной философии, 5-6 сильных на выбор
запусти исследование: ...
создай сессию: ...
```

Короткие подтверждения вроде `мне нравится твой выбор, давай поставим задачу и потом сведем` не переписываются слепо на уровне плагина: Hermes должен взять конкретный список философов из предыдущего сообщения и вызвать `/agora ask --philosophers ... QUESTION`.

## Проверка

Минимальная проверка проекта:

```bash
node --check scripts/agora.mjs
node --check scripts/import-inner-agora.mjs
node --check scripts/setup-hermes-profile.mjs
node --check scripts/inner-agora-guard.mjs
python3 -m py_compile hermes-plugins/paperclip-cockpit/__init__.py
node scripts/inner-agora-guard.mjs
node scripts/inner-agora-guard.mjs --fix
node scripts/agora.mjs council --dry-run "Что такое свобода?"
node scripts/agora.mjs ask --dry-run --philosophers socrates,kant,foucault "Что такое свобода?"
```

Живой smoke test создает реальные Paperclip-задачи:

```bash
node scripts/agora.mjs ask --philosophers socrates "Тестовая сессия: что значит начать мыслить?"
node scripts/agora.mjs tasks --open --limit 5
```

Когда задача философа завершится:

```bash
node scripts/agora.mjs synthesize THE-1
```

Замени `THE-1` на root issue из вывода команды `ask`.

## Если Paperclip не отвечает

Проверить:

```bash
curl http://127.0.0.1:3100/api/health
```

Перезапустить локальный сервис:

```bash
launchctl kickstart -k gui/$(id -u)/local.paperclipai.default
```

Потом снова:

```bash
node scripts/agora.mjs prepare
```

## Git

Проект является отдельным git-репозиторием:

```bash
git status
git log --oneline --decorate -3
```

Экспортированные сессии в `memory/sessions/` игнорируются, потому что могут содержать личные вопросы и заметки.
