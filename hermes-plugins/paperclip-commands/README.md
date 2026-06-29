# paperclip-commands

Universal Hermes slash commands for Paperclip.

The goal is to give Telegram a deterministic Paperclip control surface that can move between projects:

```text
Telegram -> Hermes slash command -> Paperclip API
```

No LLM routing is required for these commands, so they do not drag a long chat history into LM Studio.

## Commands

- `/pc help`
- `/pc companies`
- `/pc health`
- `/pc agents [--company "Company Name"]`
- `/pc tasks [--company "Company Name"] [open|all|todo|in_progress|blocked|done|cancelled] [limit]`
- `/pc task ISSUE`
- `/pc comments ISSUE`
- `/pc move ISSUE <todo|in_progress|blocked|done|cancelled>`

Telegram also exposes explicit underscore versions:

- `/pc_companies`
- `/pc_health`
- `/pc_agents`
- `/pc_tasks`
- `/pc_task`
- `/pc_comments`
- `/pc_move`

## Company Selection

The plugin chooses the Paperclip company in this order:

1. Explicit `--company "Company Name"`.
2. `PAPERCLIP_DEFAULT_COMPANY` or `PAPERCLIP_COMPANY_NAME`.
3. `INNER_AGORA_COMPANY_NAME` or `AI_BOARD_COMPANY_NAME`, for compatibility with local projects.
4. The basename of `terminal.cwd` from the Hermes profile config.
5. The Hermes profile directory name.

If multiple companies still match, pass `--company`.

## Environment

```bash
PAPERCLIP_API_BASE=http://127.0.0.1:3100/api
PAPERCLIP_DEFAULT_COMPANY="The Inner Agora"
```
