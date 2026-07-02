# Memory Export

Use this skill only when the chamber and role explicitly allow `memory-export`.

<!-- INNER_AGORA_SKILL_PROMPT_START -->
Скилл `memory-export` разрешает сохранять результат завершенной Paperclip-сессии в локальную память проекта через детерминированную команду.

Правила:
- Используй только существующий путь `node scripts/agora.mjs export-memory <issue-id-or-key>`.
- Не записывай память вручную, если команда экспорта не запускалась.
- Не экспортируй незавершенную сессию как финальную память; сначала проверь статус и наличие синтеза.
- В ответе называй файл памяти только после успешного выполнения команды.
<!-- INNER_AGORA_SKILL_PROMPT_END -->
