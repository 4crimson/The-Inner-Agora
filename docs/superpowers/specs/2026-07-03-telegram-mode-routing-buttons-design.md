# Telegram Mode Routing Buttons Design

## Goal

Telegram should let a normal user choose how the next Agora question will run before they write the question. The selected mode must not be cosmetic: it must control the project action arguments, model adapter route, and participant selection used when the next natural-language question creates Paperclip work.

The default UX decision is persistent chat mode: a mode selected in Telegram stays active for that chat until changed. Every main menu and result view should make the current mode visible and provide a way to change it.

## Product Behavior

The `/agora` home menu and relevant result views show mode buttons:

- `Быстро / локально`: fewer voices, local adapter.
- `Глубоко`: wider council, local adapter by default for Inner Agora presets.
- `Codex / сильный разбор`: wider council, `codex_local` adapter.
- `Все голоса`: all available voices or a configured large set.
- `Выбрать философов`: starts a participant-selection flow before asking the question.

After a mode button is pressed, Telegram replies with a short confirmation:

```text
Режим выбран: Быстро / локально.
Теперь напиши вопрос обычным языком.
```

When the next ordinary message is interpreted as an Agora question, the selected mode is applied automatically. The acknowledgement for created work should include the route in human-readable form:

```text
Режим: Быстро / локально
Маршрут: hermes_local model=...
Голоса: Платон, Декарт, Хайдеггер
```

## Scope

This feature covers:

- Telegram mode buttons and callback handling.
- Per-chat selected mode state.
- Applying selected mode to natural-language Agora question creation.
- Showing current mode in `/agora`, help/menu, and result/progress surfaces.
- Project-specific mode definitions for Inner Agora.
- QA checks proving the selected mode affects route and participants.

This feature does not require:

- Per-agent mixed routing in the first implementation.
- New model providers.
- A visual Paperclip web UI redesign.
- Live Telegram testing before local unit/regression tests pass.

## Architecture Boundary

### Generic Paperclip Cockpit Plugin

The plugin owns the universal mechanics:

- render configured mode menus as Telegram inline keyboards;
- handle configured callbacks such as `set_mode`;
- store lightweight per-chat mode state;
- inject selected mode into configured project actions through generic env and/or args;
- expose the current mode to menu text templates;
- keep live side effects behind the existing Telegram Bot API side-channel.

The plugin must not contain Inner Agora terms such as philosophers, Plato, chambers, THE identifiers, or local project routing policy.

### Inner Agora Project

Inner Agora owns domain policy:

- mode ids, labels, descriptions, and aliases;
- mapping from mode id to `scripts/agora.mjs ask` arguments;
- mapping from mode id to adapter policy through `models.config.json` and action env;
- participant selection rules;
- Russian Telegram copy;
- QA suite expectations.

## Config Shape

The project config adds a generic Telegram mode block. The implementation should reuse the existing `telegram.callbacks` and action env machinery instead of adding a second callback/action system.

```json
{
  "telegram": {
    "mode_selector": {
      "enabled": true,
      "state_key": "agora_mode",
      "default": "quick_local",
      "show_current_mode": true,
      "menus": ["home", "result", "latest"],
      "modes": [
        {
          "id": "quick_local",
          "label": "Быстро",
          "description": "3-5 голосов, локальная модель",
          "action": "ask",
          "args": ["--min"],
          "env": {
            "INNER_AGORA_MODE": "local",
            "INNER_AGORA_FORCE_LOCAL_ADAPTER": "1"
          }
        },
        {
          "id": "deep_local",
          "label": "Глубоко",
          "description": "широкий совет, локальная модель",
          "action": "ask",
          "args": ["--max"],
          "env": {
            "INNER_AGORA_MODE": "local",
            "INNER_AGORA_FORCE_LOCAL_ADAPTER": "1"
          }
        },
        {
          "id": "codex_deep",
          "label": "Codex",
          "description": "широкий совет через codex_local",
          "action": "ask",
          "args": ["--max"],
          "env": {
            "INNER_AGORA_MODE": "max",
            "INNER_AGORA_FORCE_LOCAL_ADAPTER": "0"
          }
        },
        {
          "id": "all_voices",
          "label": "Все голоса",
          "description": "весь текущий roster",
          "action": "ask",
          "args": ["--all"]
        },
        {
          "id": "custom_voices",
          "label": "Выбрать философов",
          "description": "ручной список голосов",
          "flow": "participant_select"
        }
      ]
    }
  }
}
```

The same shape is generic enough for another Paperclip project: the mode labels and action args change, but the plugin still only sees mode ids, labels, env, args, and callbacks.

## State Model

The plugin stores per-chat state, keyed by platform/chat/session identity. Minimum state:

```json
{
  "selectedMode": "quick_local",
  "selectedParticipants": [],
  "updatedAt": "2026-07-03T00:00:00.000Z"
}
```

The state is intentionally small and UI-oriented. Durable truth about created work remains in Paperclip root metadata and comments, where `scripts/agora.mjs` already records adapter route metadata.

The state should be resettable through a button or command:

- `Сменить режим`: opens the selector.
- `Сбросить режим`: returns to config default.

## Data Flow

### Selecting A Mode

1. User opens `/agora` or another configured menu.
2. Plugin renders buttons from `telegram.mode_selector.modes`.
3. User presses a mode button.
4. Plugin validates the callback prefix and mode id.
5. Plugin writes selected mode to per-chat state.
6. Plugin sends a short confirmation and prompts for the question.
7. No Paperclip issue is created by mode selection alone.

### Asking A Question

1. User writes a normal message.
2. Existing natural intent routing decides whether it is an Agora question.
3. If it is an Agora question and chat mode state exists, the plugin applies selected mode args/env to the configured project action.
4. `scripts/agora.mjs ask` chooses participants from the supplied args and request text.
5. `scripts/model-routing.mjs` chooses the adapter from mode/env/risk rules.
6. Root issue metadata and the immediate Telegram acknowledgement show mode and route.

### Custom Participants

The first implementation uses a structured text prompt instead of a full multi-select UI:

```text
Напиши имена через запятую: Платон, Сартр
```

The project action then calls:

```bash
node scripts/agora.mjs ask --philosophers "plato,sartre" QUESTION
```

The same implementation batch must fix the participant text edge cases found during routing QA: partial aliases such as `Сартр` resolve to `Жан-Поль Сартр`, and natural phrases such as `пару философов` constrain voice count to 2.

## Routing Rules

Current routing is session-level. One adapter is chosen for the whole created council:

- `quick_local` -> `hermes_local`.
- `deep_local` -> `hermes_local`.
- `codex_deep` -> `codex_local`.
- `all_voices` -> existing model-routing policy, usually `codex_local` for high-stakes/all.
- `custom_voices` -> adapter depends on the selected mode or an explicit custom-mode option.

Per-agent mixed routing is a future extension. The v1 schema must not block it: child issue metadata can later carry a per-role adapter override, but v1 does not run Plato locally and Sartre through Codex in the same root session.

## Error Handling

- Unknown mode id: ignore the state change, answer with a compact mode menu.
- Mode callback from an unauthorized chat: follow the existing callback authorization behavior.
- Missing Bot API side-channel: fall back to text menu and do not leak raw Hermes UI.
- Selected mode references a missing action: show a project configuration error and return `skip`.
- Custom participants cannot be resolved: ask for names again and show examples.
- Natural question is ambiguous: keep the selected mode, but ask the existing wizard clarification instead of creating work.

## Testing

Unit tests should prove:

- Plugin renders mode buttons from config without project hardcoding.
- `set_mode` callback stores selected mode per chat and returns `skip`.
- Mode selection does not create Paperclip issues.
- The next natural question receives selected mode args/env in the project action.
- `/agora` menu shows the current mode.
- Missing Bot API falls back without raw Hermes help.
- Invalid mode ids do not crash or mutate state.

Inner Agora tests should prove:

- `quick_local` creates a min/local route with `hermes_local`.
- `deep_local` creates a max/local route with `hermes_local`.
- `codex_deep` creates a max route with `codex_local`.
- `all_voices` creates an all-mode request.
- `custom_voices` passes `--philosophers` and resolves names/aliases.
- Natural phrases `пару философов` and `2 философа` constrain selected voice count to 2.

Live QA should add or update suites:

- `mode-buttons`: `/agora`, select each mode, verify confirmation and no Paperclip roots.
- `mode-applied`: select mode, send one question, verify route and participant count.
- `custom-participants`: choose philosophers, send question, verify selected voices.
- `mode-persistence`: mode remains active until changed or reset.

## Acceptance Criteria

- A user can set mode from Telegram buttons without slash-command knowledge.
- The selected mode visibly changes the next created Agora session.
- The selected mode is visible in menus and created-session acknowledgements.
- The generic plugin contains no Inner Agora nouns.
- Inner Agora config documents all modes and their routing intent.
- QA artifacts show at least one local-mode and one codex-mode live or fake-live run.
- Cleanup remains manifest-scoped and mode selection alone leaves no Paperclip artifacts.

## Non-Goals

- Do not implement per-agent mixed adapters in v1.
- Do not add a new cloud provider.
- Do not replace existing `/agora mode get/set`; button mode should coexist with it.
- Do not hardcode button labels or mode ids inside plugin Python.

## Self-Review

- No placeholders remain.
- The design separates generic plugin mechanics from Inner Agora routing policy.
- Persistent chat mode is explicit, including reset/change behavior.
- The route is required to affect actual action args/env, not just display text.
- Per-agent mixed routing is intentionally scoped as future work, with metadata compatibility preserved.
- The known `пару философов` and short-name alias issues are captured as routing/participant acceptance concerns.
