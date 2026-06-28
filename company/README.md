# The Inner Agora Paperclip Package

Runtime import is handled by:

```bash
node scripts/import-inner-agora.mjs
```

The import creates:

- company: `The Inner Agora`;
- project: `Agora Sessions`;
- goal: `Run philosophical research dialogues with The Inner Agora`;
- `Agora Assistant / Синтезатор`;
- one Paperclip agent per philosopher in `data/philosophers.json`.

The native Paperclip company package can be added later if needed. For now the JS importer is the source of truth because it also configures local Codex/Hermes adapters.
