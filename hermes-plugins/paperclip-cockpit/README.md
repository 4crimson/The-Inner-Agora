# Hermes Paperclip Cockpit

A compact Hermes plugin that turns Telegram into a deterministic control surface for Paperclip.

```text
Telegram -> Hermes command or rewrite hook -> Paperclip API
```

This is complementary to [NousResearch/hermes-paperclip-adapter](https://github.com/NousResearch/hermes-paperclip-adapter): that adapter lets Paperclip run Hermes-backed workers; this plugin lets Hermes operate Paperclip from a chat interface.

## What It Does

- Adds one visible Hermes command. Default: `/pc`; configurable per project.
- Lists Paperclip companies, agents, tasks, task details, and comments.
- Shows human-readable home, status, agent, task, and comment views by default.
- Keeps raw technical output available through `full`, `raw`, `debug`, and `capabilities`.
- Can move an issue between Paperclip statuses when writes are explicitly enabled.
- Can rewrite simple natural-language Telegram messages into `/pc ...` commands before the LLM is called.
- Can route project-specific natural-language intents into configured project actions.
- Ships a generic `qa-tool/` runner for Telegram/Paperclip acceptance cycles.
- Ships an optional `codex-plugin/telegram-paperclip-qa/` workflow layer for tester, developer, retest, and release-review discipline.
- Keeps Paperclip control out of the model context, which helps avoid slow or bloated prompts.
- Ships a model-facing skill note in `skills/paperclip-control/SKILL.md`.

## Safety Defaults

The public defaults are intentionally conservative:

- Slash-command reads are enabled.
- Slash-command writes are disabled unless `PAPERCLIP_COCKPIT_ENABLE_WRITES=1`.
- Natural-language rewrites are enabled for read operations.
- Natural-language writes are disabled unless `PAPERCLIP_COCKPIT_NL_WRITES=1`.
- Only `/pc` is registered by default, so Telegram command menus stay small.

## Install

From GitHub after this repository is published:

```bash
hermes plugins install 4crimson/hermes-paperclip-cockpit --enable
```

For local development:

```bash
./scripts/install-local.sh myprofile
myprofile plugins enable paperclip-cockpit
```

The script copies this plugin into `~/.hermes/profiles/<profile>/plugins/paperclip-cockpit`.

## Environment

```bash
PAPERCLIP_API_BASE=http://127.0.0.1:3100/api
PAPERCLIP_PUBLIC_BASE=http://127.0.0.1:3100
PAPERCLIP_DEFAULT_COMPANY="Example Workspace"

# Optional:
PAPERCLIP_COCKPIT_ENABLE_WRITES=0
PAPERCLIP_COCKPIT_NL_REWRITE=1
PAPERCLIP_COCKPIT_NL_WRITES=0
PAPERCLIP_COCKPIT_REGISTER_EXPLICIT=0
PAPERCLIP_COCKPIT_ALLOWED_PLATFORMS=telegram
PAPERCLIP_COCKPIT_ALLOWED_CHATS=
PAPERCLIP_COCKPIT_PRESENTATION=human
```

## Project Config

Put `paperclip-cockpit.json` in the Hermes profile directory or in the profile `terminal.cwd`.

If a config defines a command name, that command replaces `/pc` in the Telegram menu. For example, `"name": "work"` registers `/work`, not `/pc`.

See `examples/paperclip-cockpit.example.json` for a generic placeholder config. The plugin itself should not contain project-specific nouns, scripts, or prompts.

## QA Runner

The `qa-tool/` directory contains a project-neutral Telegram/Paperclip QA runner. It reads a project config, executes suites, captures Telegram messages and Paperclip issues in a manifest, performs manifest-scoped cleanup, writes reports, and can send a compact retained Telegram result summary after a live run.

Canonical CLI:

```bash
node hermes-plugins/paperclip-cockpit/qa-tool/bin/paperclip-qa.mjs config-check --config telegram-testing.config.json --json
node hermes-plugins/paperclip-cockpit/qa-tool/bin/paperclip-qa.mjs run --config telegram-testing.config.json --suite service-commands --cleanup hard --notify telegram --live-ok --json
```

Projects may keep their own wrapper command for compatibility. Live mutation commands such as `run`, `retest`, `cleanup`, and `notify` require explicit `--live-ok`; planning, readiness, dry-run, summary, report, acceptance, and bug-batch commands are non-live.

The optional Codex workflow plugin lives in `codex-plugin/telegram-paperclip-qa/`. It is not part of the Hermes runtime; it teaches Codex agents how to keep tester, developer, retest, and release-review work separate.

Optional gateway behavior:

```json
{
  "gateway": {
    "reset_on_gateway_shutdown": true,
    "reset_session_age_minutes": 60,
    "reset_idle_minutes": 15
  }
}
```

When enabled, the plugin resets Hermes gateway sessions that Hermes marked as `resume_pending` after an interrupted gateway shutdown. This is useful for command-cockpit profiles where a fresh Telegram turn is safer than automatic continuation.

`reset_session_age_minutes` and `reset_idle_minutes` are optional stale-context guards. They reset the Hermes chat session before the LLM runs when a command-cockpit session is too old or idle too long. This keeps Telegram control surfaces from carrying stale plans or phantom background work for hours.

### Async Project Backend

For project workflows where a chat message creates durable Paperclip work, keep the plugin generic and put the project behavior in config:

```json
{
  "actions": {
    "ask": {
      "exec": ["node", "scripts/project.mjs", "ask"]
    },
    "synth": {
      "exec": ["node", "scripts/project.mjs", "synthesize"]
    },
    "result": {
      "exec": ["node", "scripts/project.mjs", "result"]
    }
  },
  "monitor": {
    "enabled": true,
    "interval_seconds": 60,
    "ignore_existing_roots": true,
    "terminal_statuses": ["done", "blocked", "cancelled"],
    "synthesis_title_pattern": "^Synthesis:",
    "synthesis_action": "synth",
    "notify": {
      "exec": ["node", "scripts/paperclip-cockpit-telegram.mjs", "send-result", "{issue}"]
    }
  }
}
```

The intended chat flow is:

```text
natural text -> pre_gateway_dispatch rewrite -> configured ask action
ask action creates a root issue + child issues and returns a short acknowledgement
paperclip-cockpit-monitor watches Paperclip in the background
when child issues are terminal, monitor runs the configured synth action
when synthesis is terminal, monitor sends the configured Telegram result
```

Install the monitor as a macOS LaunchAgent from the project root:

```bash
node scripts/paperclip-cockpit-monitor.mjs install
node scripts/paperclip-cockpit-monitor.mjs status
```

Use `ignore_existing_roots: true` for live projects so the first monitor start does not backfill old completed sessions into Telegram. A project guard should check the monitor process alongside Paperclip and the Hermes gateway.

### Telegram Inline Buttons

Project Telegram buttons are config-driven. The Hermes Telegram adapter exposes a generic `telegram_callback_query` hook; the plugin handles only callback data with the configured prefix:

```json
{
  "telegram": {
    "enabled": true,
    "callback_prefix": "pc",
    "buttons": {
      "enabled": true,
      "labels": {
        "synthesis": "Synthesis",
        "all_voices": "All voices",
        "export": "Export",
        "clarify": "Clarify"
      }
    },
    "callbacks": {
      "result": { "action": "result", "args": "{arg}" },
      "voice": { "action": "result", "args": "{arg}" },
      "latest": { "action": "latest", "args": "{arg}" },
      "export": { "action": "memory", "args": "{arg}" },
      "clarify": { "message": "Write a follow-up as a normal message for {arg}." }
    }
  }
}
```

Buttons and callbacks use the Telegram Bot API directly; they do not ask the LLM to interpret a button click.

### Telegram Command Boundary

`telegram.command_boundary` lets a project override ordinary Telegram slash commands before they leak into the generic Hermes command router. It is useful for commands such as `/help`, `/status`, `/support`, or `/agents` where the chat should show a product-facing menu instead of raw platform help.

The boundary is generic: every key under `commands` maps to the same key under `menus`. The only reserved command group is `allow_full`, which explicitly passes through to the normal command path.

Example:

```json
{
  "telegram": {
    "enabled": true,
    "callback_prefix": "wk",
    "command_boundary": {
      "enabled": true,
      "commands": {
        "help": ["/help", "/work"],
        "status": ["/status"],
        "allow_full": ["/work help full"]
      },
      "menus": {
        "help": {
          "text": "I can help with tasks, status, and handoffs. Write normally or choose an action.",
          "buttons": [
            { "label": "New task", "callback": "new_task_prompt" },
            { "label": "Status", "callback": "status_prompt" }
          ]
        },
        "status": {
          "text": "Status options:",
          "buttons": [
            { "label": "Open tasks", "callback": "open_tasks_prompt" },
            { "label": "Diagnostics", "callback": "diagnostics_prompt" }
          ]
        }
      }
    },
    "callbacks": {
      "new_task_prompt": { "message": "Write: new task: <what needs to happen>." },
      "status_prompt": { "message": "Write: status." },
      "open_tasks_prompt": { "message": "Write: show open tasks." },
      "diagnostics_prompt": { "message": "Use the full help or project guard command." }
    }
  }
}
```

Validation is available through the project guard. It fails when a command group has no matching menu, a menu has no text, or a button references a missing callback. If the Telegram Bot API side-channel fails while handling a boundary command, the plugin returns `skip` so raw Hermes help is not sent to the user.

If you prefer the old technical output by default, set:

```json
{
  "presentation": {
    "show_technical_by_default": true
  }
}
```

That makes the default `help`, `status`, `agents`, `tasks`, `task`, and `comments` views use the technical format unless the command explicitly asks for a human presentation mode.

Durable Paperclip comments created by write operations are also configurable:

```json
{
  "notifications": {
    "comments": {
      "move_status_changed": "Status changed via cockpit: {old_status} -> {new_status}.",
      "auto_finalized": "Automatically finalized: all visible child issues are in terminal statuses."
    }
  }
}
```

Available placeholders include `{old_status}`, `{new_status}`, `{issue_id}`, and `{issue_identifier}`.

Company selection order:

1. `--company "Company Name"` in a command.
2. `company_hints` in `paperclip-cockpit.json`.
3. `PAPERCLIP_DEFAULT_COMPANY` or `PAPERCLIP_COMPANY_NAME`.
4. The basename of `terminal.cwd` from the Hermes profile config.
5. The Hermes profile directory name.

### Human-Readable Presentation

The default presentation mode is `human`: Telegram output is compact, readable, and low-noise. Technical detail is still available explicitly:

```text
/pc help full
/pc status full
/pc agents full
/pc tasks full
/pc task ABC-1 full
/pc comments ABC-1 full
/pc debug
/pc capabilities
```

Projects can tune the visible voice without changing plugin code:

```json
{
  "presentation": {
    "mode": "human",
    "language": "en",
    "home": {
      "intro": "Connected to Paperclip.",
      "items": [
        { "action": "status", "text": "show current state" },
        { "action": "agents", "text": "show agents" },
        { "action": "tasks", "text": "show tasks" }
      ]
    },
    "limits": {
      "agents": 12,
      "tasks": 10,
      "comments": 3,
      "comment_chars": 500,
      "runs": 0
    },
    "visibility": {
      "status_runs": false,
      "uuids": false
    }
  }
}
```

Set `presentation.language` to `ru` for Russian technical help headings, safety labels, and built-in command descriptions. Project actions can expose help text with `description`:

```json
{
  "presentation": {
    "language": "ru"
  },
  "actions": {
    "status": {
      "usage": "status",
      "description": "кратко показать состояние проекта",
      "exec": ["node", "scripts/project.mjs", "status"]
    }
  }
}
```

Use `labels`, `terms`, and `aliases` for project vocabulary. The plugin code stays generic; project-specific nouns belong in config.

## Commands

```text
/pc help
/pc companies
/pc health
/pc status [full]
/pc agents [--company NAME] [--tags|--tag TAG]
/pc tasks [--company NAME] [open|all|todo|in_progress|blocked|done|cancelled] [limit]
/pc task ISSUE
/pc comments ISSUE
/pc move ISSUE <todo|in_progress|blocked|done|cancelled>
/pc capabilities
/pc debug
```

Short aliases:

```text
/pc orgs
/pc people
/pc list
/pc t ISSUE
/pc m ISSUE STATUS
```

## Natural-Language Rewrites

When `PAPERCLIP_COCKPIT_PRE_GATEWAY=1`, the plugin can rewrite simple messages before they reach the LLM:

```text
show paperclip companies      -> /pc companies
покажи задачи                 -> /pc tasks
who is in paperclip           -> /pc agents
what about ABC-9              -> /pc task ABC-9
comments ABC-9                -> /pc comments ABC-9
```

If agents carry `metadata.tags`, the agents command displays them. Use `/pc agents --tags` for a tag summary or `/pc agents --tag research` to filter agents by one tag.

Project configs can also map explicit natural-language intents to project actions:

```json
{
  "actions": {
    "research": {
      "usage": "research QUESTION",
      "exec": ["./scripts/research"]
    }
  },
  "intents": {
    "create_research": {
      "action": "research",
      "aliases": ["start research", "create research task"],
      "require_tail": true,
      "min_tail_chars": 10
    }
  }
}
```

This keeps project words in `paperclip-cockpit.json`: the plugin only knows how to route an intent to an action. Use `require_tail` and `min_tail_chars` for actions that create work, so vague confirmations do not become empty tasks.

For reusable workflow helpers, project actions can call a plugin builtin instead of a project script. The first builtin is `finalize`, which closes a parent issue tree when all visible child issues are already in terminal statuses (`done`, `blocked`, or `cancelled`):

```json
{
  "actions": {
    "finalize": {
      "usage": "finalize ISSUE",
      "builtin": "finalize",
      "description": "close a package when all child issues are finished"
    }
  }
}
```

Run it as `/pc finalize ABC-12` or `/pc finalize ABC-12 --dry-run`. Real status changes still require `PAPERCLIP_COCKPIT_ENABLE_WRITES=1`.

Projects can also attach a reusable hook after `/pc move` so terminal child statuses automatically try to finalize parent packages:

```json
{
  "hooks": {
    "after_move": {
      "auto_finalize_parents_on_statuses": ["done", "blocked", "cancelled"]
    }
  }
}
```

With that enabled, `/pc move ABC-12 done` still updates the target issue first, then attempts the same parent-tree finalization logic and reports whether any parents were auto-finalized.

Write rewrites are disabled by default. To allow phrases like `move THE-9 done`, set both:

```bash
PAPERCLIP_COCKPIT_ENABLE_WRITES=1
PAPERCLIP_COCKPIT_NL_WRITES=1
```

## Model-Facing Skill

Copy or reference `skills/paperclip-control/SKILL.md` from your Hermes assistant profile. It tells the model:

- Paperclip facts should come from the configured command, not memory.
- Writes require explicit user intent.
- Routine state should use compact human commands; use `full` or `debug` only when technical detail is needed.
- Replies should label Paperclip API facts separately from inference.
- Durable work needs a real Paperclip issue/run/automation identifier; local notes, `delegate_task`, and `execute_code` are not a substitute for trackable Paperclip state.

Project-specific wording belongs in `paperclip-cockpit.json`, not in the plugin.

## Development

Roadmap for the configurable human-readable Telegram presentation layer:
[`docs/human-readable-roadmap.md`](docs/human-readable-roadmap.md).

Run local checks:

```bash
python3 -m py_compile __init__.py
python3 -m unittest discover -s tests
```

This plugin uses only the Python standard library.
