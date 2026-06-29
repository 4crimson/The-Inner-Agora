# The Inner Agora

Простой локальный проект для философских диалогов через Paperclip и Hermes.

Идея: это не "совет директоров" и не обычный чат-бот. Это набор философских машин-личностей. Пользователь задает вопрос, система вызывает одного или нескольких философов, каждый отвечает из своей оптики, а `Agora Assistant / Синтезатор` собирает карту позиций и конфликтов.

## Что уже есть

- Paperclip company: `The Inner Agora`
- Project: `Agora Sessions`
- Hermes profile: `inneragora`
- Hermes plugin: `inner-agora-commands`
- CLI bridge: `scripts/agora.mjs`
- Состав философов: `data/philosophers.json`
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

Античность:
Сократ, Платон, Аристотель, Парменид, Пиррон, Эпикур, Эпиктет, Марк Аврелий, Плотин.

Христианская и средневековая мысль:
Августин, Фома Аквинский, Николай Кузанский.

Новое время и немецкая классика:
Декарт, Спиноза, Руссо, Кант, Гегель.

Современность и постструктурализм:
Ницше, Хайдеггер, Ролан Барт, Бодрийяр, Делез, Фуко, Дугин.

Для современных публичных фигур система работает как реконструкция интеллектуальной оптики по публичным идеям, а не как утверждение, что говорит сам человек.

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

Частые ключи:

```text
socrates, plato, aristotle, parmenides, pyrrho, epicurus,
epictetus, marcus-aurelius, plotinus, augustine, aquinas,
cusanus, descartes, spinoza, rousseau, kant, hegel,
nietzsche, heidegger, barthes, baudrillard, deleuze,
foucault, dugin
```

## Hermes

Локальная команда профиля:

```bash
inneragora status
```

Проверить gateway:

```bash
inneragora gateway status
```

Если команда показывает `stopped` или Telegram `not configured`, это нормально до отдельной настройки Telegram.

Slash-команды для Hermes gateway:

```text
/agora-prepare
/agora-status
/agora-tasks
/agora-task THE-1
/agora-council QUESTION
/agora-ask [--min|--balanced|--max|--all|--philosophers list] QUESTION
/agora-dialogue PHILOSOPHER QUESTION
/agora-synth THE-1
/agora-memory THE-3
/agora-guard
```

`THE-1` и `THE-3` в примерах нужно заменить на реальные issue из Paperclip.

Важно: Telegram для профиля `inneragora` не настраивается автоматически. Секреты не копируются из других профилей.

## Проверка

Минимальная проверка проекта:

```bash
node --check scripts/agora.mjs
node --check scripts/import-inner-agora.mjs
node --check scripts/setup-hermes-profile.mjs
node --check scripts/inner-agora-guard.mjs
python3 -m py_compile hermes-plugins/inner-agora-commands/__init__.py
node scripts/inner-agora-guard.mjs
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
