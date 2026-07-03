# Telegram Command Boundary Design

## Goal

Make Telegram commands behave as part of the Agora product, not as a leak of the generic Hermes control surface. In hard mode, the ordinary Telegram user should never see raw Hermes `/help` or `/agents` output unless they ask for an explicit technical/full view.

The target experience is:

- `/help` opens the Agora assistant menu with inline buttons.
- `/agora` and `/agora help` open the same Agora assistant menu with inline buttons.
- `/agents` opens an Agora-oriented status/navigation menu, not the generic Hermes "Active Agents & Tasks" screen.
- `/agora help full` remains a technical/admin reference.
- Optional raw escapes are explicit, documented, and easy to audit.

## Current Evidence

Live Telegram observation on 2026-07-03 showed:

- `/agents` returns generic Hermes text: "Active Agents & Tasks".
- `/agora` and `/agora help` return Agora help text, but without buttons.
- `/help` returns a very large global Hermes help text in English, split across messages, without buttons.
- `/agora help full` returns long technical Agora help; this is acceptable for an admin/full path, but not as the default UX.

This is a product boundary bug. The user typed normal service commands in the Agora chat and received platform internals.

## Scope

This design changes only the Telegram command boundary for the Paperclip Cockpit profile. It does not change Agora council routing, philosopher selection, synthesis logic, Paperclip issue creation, or the web UI.

Commands in scope:

- `/help`
- `/help@<botname>`
- `/agora`
- `/agora@<botname>`
- `/agora help`
- `/agents`
- `/agents@<botname>`

Admin/full commands:

- `/agora help full` stays technical and may continue through the existing command path.
- `/help full` and `/agents full` are reserved raw escape candidates. If Hermes cannot handle them natively, the implementation should document them as unsupported rather than inventing hidden behavior.

## UX Contract

### Agora Home Menu

For `/help`, `/agora`, and `/agora help`, Telegram should receive one compact product-facing message:

```text
Я могу помочь через Агору: быстрый совет, глубокое исследование, разбор голосов и итоговый синтез.

Напиши обычным языком, что хочешь понять. Если тема широкая, я уточню.
```

The message must include inline buttons. The first version should prefer reliable buttons over clever buttons:

- "Быстрый совет" - shows a short prompt example or starts the quick-advice prompt path without creating a task by itself.
- "Глубокое исследование" - shows a short prompt example or starts the deep-research prompt path without creating a task by itself.
- "Философы" - opens the configured chamber/voice catalog or explains how to ask for one or two philosophers.
- "Последний итог" - asks the user to choose or provide a session if there is no safe current session.
- "Помощь full" - points to `/agora help full`.

Pressing a button must not unexpectedly create a Paperclip issue. Buttons may create work only when the label clearly says so and the user has already supplied a topic.

### Agora Agents Menu

For `/agents`, Telegram should receive an Agora-oriented message, not raw Hermes internals:

```text
В Агоре "агенты" - это голоса и текущие сессии.

Могу показать философов, последние сессии, прогресс или диагностику.
```

Buttons:

- "Философы"
- "Последние сессии"
- "Прогресс"
- "Диагностика"
- "Помощь"

The first implementation may make these buttons informational or read-only. It must not start a council merely because the user pressed `/agents`.

### Full/Admin Path

`/agora help full` remains the long technical help. It may have no buttons in the first implementation because it is explicitly admin-oriented.

The help text should mention that normal users should use `/help`, `/agora`, or plain language, while admins can use `/agora help full` for raw commands.

## Architecture

Add a Telegram command boundary in `hermes-plugins/paperclip-cockpit/__init__.py`, inside `pre_gateway_dispatch`.

The boundary should run before the existing natural-language rewrite path:

1. Confirm the incoming event is Telegram and has a usable `chat_id`.
2. Normalize command text:
   - trim whitespace;
   - remove bot suffix from slash commands, e.g. `/help@crimson_philosophs_bot`;
   - compare command words case-insensitively.
3. If the command is a hard-overridden product command, send a Bot API message with configured inline keyboard.
4. Return `{"action": "skip"}` so Hermes does not also emit generic command output.
5. If the command is an explicit full/admin path, allow existing command handling.

The plugin remains universal:

- command-boundary behavior is config-driven;
- button labels, callback ids, and text live in JSON config;
- no philosopher names, Agora issue prefixes, or project-specific wording are hardcoded in the generic plugin code.

The Inner Agora profile config provides the actual Telegram menu copy and buttons.

## Data And Config

Extend Paperclip Cockpit config with a section shaped like:

```json
{
  "telegram": {
    "command_boundary": {
      "enabled": true,
      "commands": {
        "home": ["/help", "/agora", "/agora help"],
        "agents": ["/agents"],
        "allow_full": ["/agora help full", "/help full", "/agents full"]
      },
      "menus": {
        "home": {
          "text": "Я могу помочь через Агору: быстрый совет, глубокое исследование, разбор голосов и итоговый синтез.",
          "buttons": [
            { "text": "Быстрый совет", "callback": "agora:help:quick" },
            { "text": "Глубокое исследование", "callback": "agora:help:deep" }
          ]
        },
        "agents": {
          "text": "В Агоре агенты - это голоса и текущие сессии.",
          "buttons": [
            { "text": "Философы", "callback": "agora:agents:voices" },
            { "text": "Прогресс", "callback": "agora:agents:progress" }
          ]
        }
      }
    }
  }
}
```

Exact schema can follow existing `telegram.help_buttons` style if that keeps the config smaller. The important contract is that generic plugin code reads menu definitions from config.

## Root-Cause Hypothesis To Verify

The likely root cause is not that buttons are impossible for slash commands. The plugin already can send Telegram Bot API side-channel messages with keyboards.

The likely root cause is that `_rewrite_text` currently ignores slash commands, so `/help`, `/agents`, and `/agora` fall through into the regular Hermes command router. Because command handlers return plain text and do not carry `chat_id`, they cannot attach inline keyboards at that stage.

Before implementation, verify with a focused unit/fake test that `pre_gateway_dispatch` sees Telegram slash command events before Hermes consumes them. If Hermes handles `/help` before the hook, then `/help` must be fixed at the gateway/router layer instead of inside the plugin.

## Acceptance Criteria

- In Telegram, `/help` returns an Agora-facing message with inline buttons and does not include the global Hermes command dump.
- In Telegram, `/agora` returns an Agora-facing message with inline buttons.
- In Telegram, `/agora help` returns an Agora-facing message with inline buttons.
- In Telegram, `/agents` returns an Agora-facing agents/status menu with inline buttons and does not include "Active Agents & Tasks".
- `/agora help full` still returns technical/full help.
- No hard-overridden command creates a Paperclip issue by itself.
- The generic Paperclip Cockpit plugin contains no Inner Agora philosopher/chamber literals.
- The behavior can be disabled or changed from config.
- Existing natural-language help still works and keeps buttons.

## Tests

Unit tests:

- `pre_gateway_dispatch` intercepts `/help`, `/help@bot`, `/agora`, `/agora help`, `/agents`, and `/agents@bot`.
- Intercepted commands call Telegram `sendMessage` with `reply_markup`.
- Intercepted commands return `skip`.
- `/agora help full` is allowed through.
- Disabled `telegram.command_boundary.enabled` restores legacy behavior.
- Missing `chat_id` falls back safely and does not crash.

QA runner:

- Add or extend a service-command suite with `/help`, `/agora`, `/agora help`, `/agents`, `/agora help full`.
- Expected for hard-overridden commands: buttons present, no Hermes global dump, no Paperclip issue creation.
- Expected for `/agora help full`: technical output allowed, no button requirement.

Live verification:

- Run targeted service-command retest only after explicit live permission.
- Capture transcript and button payloads in `var/telegram-qa/runs/<runId>`.
- Hard-clean test messages after the run.

## Risks

- If the Hermes gateway handles global slash commands before `pre_gateway_dispatch`, plugin-level interception cannot catch `/help` or `/agents`. In that case, the implementation plan must move the boundary to the gateway command router.
- Admin users may miss raw Hermes commands if the hard boundary is too aggressive. Explicit full/admin paths reduce that risk.
- Overly smart buttons can create accidental work. The first version should keep menu buttons read-only or prompt-oriented unless the user has already supplied a topic.

## Non-Goals

- No redesign of the Paperclip web interface.
- No changes to philosopher selection.
- No new local model behavior.
- No broad command-router refactor unless the pre-dispatch hook cannot intercept global slash commands.
- No live Telegram run during design review.

## Self-Review

- No placeholders remain.
- The spec separates UX contract, architecture, config, tests, and live verification.
- The hard boundary is explicit: bare `/help` and `/agents` become Agora UX in Telegram.
- The design preserves a technical path through `/agora help full`.
- Implementation is scoped to one direction: Telegram command boundary and buttons.
