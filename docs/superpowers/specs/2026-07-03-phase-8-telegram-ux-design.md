# Phase 8 Telegram UX Design

## Goal

Make Telegram feel like a human conversational interface for Paperclip/Aгора: the user writes normal text, the system asks only the missing question, shows progress during long councils, and returns synthesis/voice views with useful inline actions. The implementation must stay universal for Paperclip Cockpit and local-model-first for The Inner Agora.

## Hard Constraints

- Local model first: natural-language routing continues through `scripts/agora.mjs natural` and `scripts/intent-slots.mjs` with `ROUTING_MODE=llm` using the configured local LM Studio endpoint. Regex remains deterministic fallback, not a cloud dependency.
- No project-specific logic inside the Hermes plugin: button names, callbacks, progress notifications, presets, and actions must be config-driven.
- Slash commands keep working exactly as before. Telegram UX adds a human layer over the command path; it does not replace `/agora`.
- No silent session creation from incomplete input. Missing topic starts the existing wizard. Missing chamber/depth is answered by buttons or deterministic numbered text.

## Spike Result

Hermes `pre_gateway_dispatch` is text-only for dispatch control. The gateway accepts `skip`, `rewrite`, and `allow`; `rewrite` only replaces `event.text`. Returning arbitrary `reply_markup` from this hook is not a supported contract.

Plan A is still available through the Paperclip Cockpit Telegram side channel. The plugin already receives Telegram chat ids, can call Bot API `sendMessage`, and callback queries can send JSON Telegram payloads with `reply_markup`. Therefore:

- `pre_gateway_dispatch` remains the translator from human text to command or skip.
- Inline keyboards are sent by explicit Bot API calls from the plugin or the Telegram helper.
- If Bot API credentials/chat are unavailable, the same flow falls back to numbered text menus.

## User Experience

### Ambiguity And Wizard

When a user writes an incomplete natural message, Hermes should respond in the same chat without forcing a slash command.

- Missing topic: start the existing wizard and ask for the topic.
- Missing chamber: show available chambers as inline buttons when Telegram buttons are enabled; otherwise print numbered choices.
- Missing depth: show `quick`, `balanced`, `deep` as inline buttons; otherwise print numbered choices.
- Button callbacks feed the existing `wizard-answer` path, so state handling stays in `agora.mjs`.

### Synthesis And Voice Views

Every Telegram result view should carry the same navigation surface:

- Synthesis.
- Individual voices, capped by config.
- All voices.
- Clarify / continue.
- Optional export when configured.
- New quick action buttons: disagreements, deepen, new question.

Role/voice callbacks must return a payload with keyboard, not a plain text dead end.

### Progress

The monitor should send progress only when something materially changed:

- A new voice finished.
- The list of waiting voices changed.
- Synthesis started.

The progress message is compact: root id, done count, waiting count, ready voice names, waiting voice names. It must be idempotent through the monitor state file so polling does not spam Telegram.

### Presets

Presets are ordinary configured actions:

- Quick council: local/min mode.
- Deep research: max mode.
- Board go/no-go: board-directors chamber with a local model route.

The plugin action runner must allow per-action env overrides so a preset can select a chamber without hardcoding that chamber into plugin Python.

### Guard / Self-Heal

`inner-agora-guard.mjs` already checks gateway, monitor, Telegram, router, callbacks, Paperclip health, and local model adapter configuration. Phase 8 adds chamber-loader health:

- list and validate every chamber manifest;
- check active/default chamber can produce merged cockpit config;
- report a guard error if chamber loading fails.

## Data Flow

Normal text:

1. Telegram text reaches Hermes.
2. `paperclip-cockpit` `pre_gateway_dispatch` calls configured natural delegate with `INNER_AGORA_CHAT_ID`.
3. Delegate returns a rewrite command, a message, or a menu payload.
4. Rewrite commands continue through Hermes normally.
5. Menu payloads are sent by Bot API and the hook returns `skip`.
6. Callback buttons call configured actions and may send another Telegram payload with keyboard.

Monitor:

1. `paperclip-cockpit-monitor.mjs` scans roots.
2. If voices are open, it computes a progress fingerprint.
3. If fingerprint changed, it runs configured progress notify command.
4. When voices are terminal, existing synthesis path runs.
5. When synthesis is terminal, existing final notification path runs.

## Testing

Tests must cover the contracts, not just snapshots:

- Plugin can skip gateway dispatch after sending a Telegram payload for a natural menu.
- Action env overrides are passed to subprocesses with `INNER_AGORA_CHAT_ID`.
- Telegram helper can render progress payload and quick-action keyboard.
- Monitor sends one progress notification per changed fingerprint and does not spam unchanged state.
- Guard reports chamber-loader health.
- Existing conversation cycle still creates local-mode sessions and returns voice callbacks with keyboard.

## Non-Goals

- No visual redesign of the Paperclip web UI.
- No cloud extractor.
- No new Telegram framework dependency.
- No generic multi-user permission model beyond the callback authorization already present.

## Self-Review

- No placeholders remain.
- The spike result separates unsupported `pre_gateway_dispatch.reply_markup` from supported Bot API side-channel buttons.
- The design keeps project specifics in JSON config and scripts, not in the generic Hermes plugin.
- Every Phase 8 roadmap item has an implementation target: T8.1 spike, T8.2 menu/buttons, T8.3 quick actions, T8.4 progress, T8.5 presets, T8.6 guard chamber health.
