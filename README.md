# The Inner Agora

Простой локальный проект для философских диалогов через Paperclip и Hermes.

Идея: это не "совет директоров" и не обычный чат-бот. Это набор философских машин-личностей. Пользователь задает вопрос, система вызывает одного или нескольких философов, каждый отвечает из своей оптики, а `Agora Assistant / Синтезатор` собирает карту позиций и конфликтов.

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
| `min` | `--min` | Быстрый разбор на 3 голоса |
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

В `paperclip-cockpit.json` включен `gateway.reset_on_gateway_shutdown`: если Hermes прислал `Gateway shutting down — Your current task will be interrupted` и пометил сессию как interrupted/resume-pending, следующий входящий Telegram-turn начнется с чистого Hermes-контекста, а не с автопродолжения старого.

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

Обычные read-only фразы про Paperclip тоже разрешены для Hermes: например, `список философов`, `кто в перклипе`, `узнай список философов в перклипе`, `статус`, `задачи`. Они должны запускать безопасные команды чтения, а не создавать новые задачи.

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
