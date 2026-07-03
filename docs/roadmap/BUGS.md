# Live Bugs / Acceptance Backlog

This file tracks live Telegram acceptance failures separately from roadmap phases. A phase can be code-complete while live behavior still fails acceptance because runtime state, Hermes profile text, provider streaming, or Paperclip agents are out of sync.

## BUG-2026-07-03-001 — Telegram leaks service tokens and answers as an internal roadmap assistant

**Status:** open
**Severity:** P0 for live Telegram UX
**Reported:** 2026-07-03
**Surface:** Telegram → Hermes BoF / Paperclip Cockpit / The Inner Agora
**Related phase:** Phase 8 follow-up hardening, not Phase 9

### Evidence

From the live Telegram check:

```text
[03.07.2026 10:24] User: Ну что финал, надо проверять что вышло
[03.07.2026 10:26] BoF: <|channel>
[03.07.2026 10:27] BoF: ⏳ Working — 2 min — waiting for provider response (streaming)
[03.07.2026 10:27] BoF: <|channel>Итого по плану — Фаза 8 (Telegram UX) завершена.
...
[03.07.2026 10:28] User: Фаза 9 реализована
[03.07.2026 10:30] BoF: По моим документам, Фаза 9 ... всё ещё висит ...
```

### Actual Behavior

- Telegram receives raw service markup: `<|channel>`.
- The bot exposes provider/streaming status text to the user.
- The bot answers like a roadmap/project-doc assistant, not like a human operator helping test Agora.
- The bot discusses Phase 9 instead of starting a live acceptance check.
- The bot tells the user to update docs manually, which is wrong for this Telegram UX.

### Expected Behavior

For a message like:

```text
Ну что финал, надо проверять что вышло
```

the bot should answer in plain human Russian, for example:

```text
Да, давай проверим живой контур. Сначала сверю, что Hermes/Paperclip идут через local, потом запустим короткий вопрос и посмотрим прогресс, синтез и кнопки.
```

Then it should route into the live acceptance flow, not into roadmap discussion.

### Acceptance Criteria

- No Telegram message contains `<|channel>`, `<tool_call|>`, raw provider markers, or internal stream protocol text.
- No live Telegram answer contains `Working — waiting for provider response` unless it is intentionally rendered by the adapter as a user-friendly status and never mixed with raw tokens.
- A natural phrase about “проверить что вышло” triggers an acceptance-check flow or a clear next operational step.
- The bot does not tell the user to update repo docs manually.
- The bot does not propose Phase 9 when the user is testing Phase 8 live behavior.
- The answer is short, operational, and human: what will be checked next, what the user should send/click, and what result to expect.

### Initial Root-Cause Hypotheses

These are hypotheses only; do not fix before evidence is gathered.

1. **Output sanitizer gap:** Telegram adapter or Hermes gateway sends provider stream chunks without filtering service-channel tokens.
2. **Wrong model/profile route:** The live bot may be using a provider/profile whose system instructions expose Codex-style channel syntax.
3. **Profile/SOUL drift:** The installed Hermes profile may still contain older instructions that emphasize roadmap/project management over Telegram operation.
4. **Runtime agents out of sync:** Paperclip/Hermes live state may not have been re-prepared after Phase 8 code changes.
5. **Intent gap:** There is no explicit intent for “проверяем что вышло”, so the model freewheels into docs/planning talk.

### Investigation Checklist

- Capture the exact raw Telegram adapter outgoing payload for the failing messages.
- Check whether `<|channel>` appears before or after Telegram adapter formatting.
- Check Hermes active profile, model, and route used for the live response.
- Run `node scripts/inner-agora-guard.mjs --json` and record whether agents/profile/model are aligned with local expectations.
- Inspect installed profile files under `~/.hermes/profiles/inneragora/` for stale SOUL/MEMORY instructions.
- Reproduce with a local unit/integration test that feeds `<|channel>` through the Telegram output layer.
- Reproduce intent routing for “Ну что финал, надо проверять что вышло” without live Telegram side effects.

### Fix Batches

**Batch A — Output Hygiene**

- Add a Telegram output sanitizer for service tokens and provider stream artifacts.
- Add tests with `<|channel>`, `<tool_call|>`, and adjacent human text.
- Ensure sanitizer runs at the final Telegram send boundary.

**Batch B — Live Route / Profile Sync**

- Run guard/prepare diagnostics.
- Confirm live Hermes route is local where expected.
- Refresh installed profile if SOUL/MEMORY is stale.
- Add a guard check that flags raw-channel-token leaks in profile or adapter output paths if practical.

**Batch C — Human Acceptance Intent**

- Add natural intent/alias for “проверить что вышло”, “финал проверяем”, “давай acceptance”.
- Route to an acceptance checklist response or command.
- Prevent roadmap-phase discussion unless the user explicitly asks about roadmap.

**Batch D — Telegram Persona Hardening**

- Update Hermes instructions: Telegram user should never be told to edit docs manually.
- The bot should perform checks or ask for one concrete user action.
- Keep responses short and operational in live Telegram.

### Non-Goals

- Do not implement Phase 9 as part of this bug.
- Do not change council synthesis logic.
- Do not change Paperclip issue schema.
- Do not add cloud-model dependency.

### Notes

This bug means Phase 8 mechanisms are present in code, but live acceptance is not yet passed. Treat this as a live integration hardening bug before moving to Phase 9.
