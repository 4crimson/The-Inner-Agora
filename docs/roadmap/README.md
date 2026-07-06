# Roadmap: The Inner Agora → Platform

Читать в этом порядке:

1. **CURRENT_STATUS.md** — актуальная карта слоев, plugin boundaries, что уже вынесено, что выносить позже, какие live/legacy-гейты действуют сейчас.
2. **COMPLETION_AUDIT.md** — строгая карта доказательств: что локально готово, что partial, что live-pending, что заблокировано gate-ами.
3. **PLUGIN_BOUNDARIES.md** — что уже является reusable plugin/tool, что остается Agora pack/runtime, какие promotion gates запрещают silent install/publish.
4. **ROADMAP.md** — фазы, принципы, реестр текущих костылей, критерии "доведено до идеала".
5. **IMPLEMENTATION_PLAN.md** — по каждой фазе: файлы, псевдокод, критерий готовности.
6. **TASKS.md** — атомарные задачи с ID/приоритетом/размером, привязанные к фазам выше.

Статус: `CURRENT_STATUS.md` обновляет навигацию на 2026-07-05, а `COMPLETION_AUDIT.md` фиксирует доказательства и незакрытые acceptance gates. Остальные документы остаются полезными как roadmap/планы, но могут содержать уже выполненные или live-pending пункты.

После live-ретро 2026-07-06 отдельный приоритетный трек `RL` в `TASKS.md`
фиксирует повторяемый release workflow для Agora/Telegram/Paperclip:
`preflight -> backup -> profile/plugin sync -> live suite -> cleanup ->
acceptance -> post-suite guard -> docs/commit`.

Главный lifecycle-фикс этого трека: если Paperclip показывает
`adapter_failed` после успешного Hermes exit code 0, это может быть не ошибка
модели или UX, а race между `hard cleanup` и еще живым `workspace_finalize`.
`RL-3` и `RL-2` фиксируют правило: cleanup сначала cancel/wait active runs,
затем delete, затем post-suite guard. Если guard красный и был ручной repair,
`guard-repeat` должен записать backup, repair command и repeat guard; иначе
release decision не может быть чистым `accepted`.
`release-live-gate` без `--live-ok` собирает evidence wrapper вокруг уже
полученных run ids/backup/profile-sync/guard/docs данных. С `--live-ok` он
создает read-only Paperclip backup, запускает одну suite, cleanup, guard и
release artifacts в одном контролируемом lane; реальный запуск все равно
требует отдельного операторского подтверждения.
