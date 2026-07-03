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

Additional live Telegram check:

```text
[03.07.2026 10:31] User: сделай быстрый совет: что такое свобода ребенка когда ему уже 18-20 лет
[03.07.2026 10:31] BoF: <|channel>I apologize. It seems the `/agora` command is not correctly configured in this terminal environment (it returned `command not found`).

Since I cannot run the direct `/agora` command to initiate the session through the Paperclip gateway right now, I will process this as a **"Quick Advice" (быстрый совет)** using my internal reasoning...
...
[03.07.2026 10:32] BoF: <|channel>I apologize. It seems the /agora command is not correctly configured in this terminal environment ...
```

Additional live Telegram check for mode/state and deep research dispatch:

```text
[03.07.2026 10:35] User: mode get
[03.07.2026 10:35] BoF: Текущий режим системы:

* Режим (Mode): local (минимальный)
* Адаптер: hermes_local
* Модель: google/gemma-4-26b-a4b-qat
* Текущее состояние: state=/Users/admin/Documents/The Inner Agora/.inner-agora-state.json

Так как выбран режим local, я отвечу максимально лаконично, без привлечения совета философов.
...
Если тебе нужен глубокий анализ этой темы ... просто скажи: «агора: что такое свобода...».

[03.07.2026 10:36] User: глубокое исследование: как заботу не превратить в контроль
[03.07.2026 10:36] BoF: Project action exited with 1.

stderr:
POST /companies/20a10ec7-7ddc-42ac-a474-beebb574b028/issues failed: 409 {"error":"Хайдеггер reports through terminated ancestor Agora Assistant / Синтезатор. Reassign Хайдеггер or the nearest affected ancestor under an active manager/root, or explicitly pause or terminate the invalid subtree before assigning work or starting runs."}
```

Additional live Telegram check for help intent:

```text
[03.07.2026 10:37] User: агора помощь
[03.07.2026 10:37] BoF: Project action exited with 1.

stderr:
POST /companies/20a10ec7-7ddc-42ac-a474-beebb574b028/issues failed: 409 {"error":"Хайдеггер reports through terminated ancestor Agora Assistant / Синтезатор. Reassign Хайдеггер or the nearest affected ancestor under an active manager/root, or explicitly pause or terminate the invalid subtree before assigning work or starting runs."}
```

### Actual Behavior

- Telegram receives raw service markup: `<|channel>`.
- The bot exposes provider/streaming status text to the user.
- The bot answers like a roadmap/project-doc assistant, not like a human operator helping test Agora.
- The bot discusses Phase 9 instead of starting a live acceptance check.
- The bot tells the user to update docs manually, which is wrong for this Telegram UX.
- A quick-council request does not create a Paperclip session.
- The bot claims `/agora` is `command not found`, which means the live dispatch path may be treating `/agora` as a shell command instead of a registered Hermes/Paperclip command.
- The bot falls back to internal reasoning, which violates the product contract: Agora research must create Paperclip work, not answer from the assistant's private reasoning.
- The answer is duplicated in two Telegram messages.
- The response switches to English and long markdown instead of concise Russian operational UX.
- `mode get` confirms the live route is `local` with `hermes_local` and `google/gemma-4-26b-a4b-qat`, but reports the legacy/global state path `.inner-agora-state.json` instead of a per-chat state path.
- `mode get` then answers the previous philosophical topic directly; a mode/status command should not continue latent conversation content.
- A deep-research natural request reaches the Paperclip project action path, but issue creation fails with HTTP 409 because `Хайдеггер` reports through a terminated `Agora Assistant / Синтезатор` ancestor.
- The raw Paperclip stderr/JSON error is sent to the Telegram user.
- `агора помощь` incorrectly reaches the Paperclip issue-creation/action path and fails on the same `Хайдеггер` hierarchy error; help should be a local Telegram UX/menu response and must not depend on live philosopher hierarchy.

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

For a message like:

```text
сделай быстрый совет: что такое свобода ребенка когда ему уже 18-20 лет
```

the bot should create a real Paperclip Agora session through the configured `quick` preset. Expected user-facing shape:

```text
Поставил вопрос в Агору: THE-...
Выбрал 3 голоса: ...
Напишу сюда, когда будет готов синтез.
```

It should not produce a direct philosophical answer from internal reasoning.

For a message like:

```text
mode get
```

the bot should only report current mode, adapter, model, and state scope. It should not answer a previous Agora topic or offer philosophical advice.

For a message like:

```text
глубокое исследование: как заботу не превратить в контроль
```

the bot should either create a real Paperclip Agora session or stop before dispatch with a human recovery message, for example:

```text
Вижу проблему в Paperclip-иерархии: один из голосов привязан к завершенному синтезатору. Сначала нужно выполнить repair/prepare, потом я запущу исследование.
```

For a message like:

```text
агора помощь
```

the bot should return a local help/menu response with available natural actions and buttons. It should not create Paperclip issues, select voices, or depend on philosopher agent health.

### Acceptance Criteria

- No Telegram message contains `<|channel>`, `<tool_call|>`, raw provider markers, or internal stream protocol text.
- No live Telegram answer contains `Working — waiting for provider response` unless it is intentionally rendered by the adapter as a user-friendly status and never mixed with raw tokens.
- A natural phrase about “проверить что вышло” triggers an acceptance-check flow or a clear next operational step.
- A natural phrase with “быстрый совет” creates a Paperclip session via the `quick` preset and local model route.
- The bot never falls back to internal reasoning for Agora research when command dispatch fails; it reports the dispatch failure and suggests/runs recovery.
- The bot does not tell the user to update repo docs manually.
- The bot does not propose Phase 9 when the user is testing Phase 8 live behavior.
- The bot does not emit duplicate answer bodies for one user request.
- The bot answers live Telegram operational flows in Russian unless the user explicitly asks otherwise.
- The answer is short, operational, and human: what will be checked next, what the user should send/click, and what result to expect.
- `mode get` only reports mode/status and never answers a previous latent topic.
- Telegram mode/status and Agora actions use the same expected state scope; when a chat id is available, state must be per-chat rather than the legacy/global `.inner-agora-state.json`.
- Before creating live Paperclip issues, the system detects invalid `reportsTo` ancestry and terminated-manager links for selected voices.
- Paperclip 409/runtime errors are translated into short human recovery messages; raw stderr/JSON is not sent to Telegram.
- `агора помощь` is handled locally as help/menu UX and never triggers Paperclip issue creation.

### Initial Root-Cause Hypotheses

These are hypotheses only; do not fix before evidence is gathered.

1. **Output sanitizer gap:** Telegram adapter or Hermes gateway sends provider stream chunks without filtering service-channel tokens.
2. **Wrong model/profile route:** The live bot may be using a provider/profile whose system instructions expose Codex-style channel syntax.
3. **Profile/SOUL drift:** The installed Hermes profile may still contain older instructions that emphasize roadmap/project management over Telegram operation.
4. **Runtime agents out of sync:** Paperclip/Hermes live state may not have been re-prepared after Phase 8 code changes.
5. **Intent gap:** There is no explicit intent for “проверяем что вышло”, so the model freewheels into docs/planning talk.
6. **Command dispatch boundary bug:** The live model tries to execute `/agora` inside a terminal shell, where slash commands are not available, instead of returning a rewrite/command to Hermes gateway.
7. **Unsafe fallback policy:** Profile instructions may allow internal-reasoning fallback when project command execution fails; for Agora research this must be forbidden.
8. **Duplicate send path:** Streaming chunks and final message may both be sent to Telegram, causing duplicate content.
9. **Per-chat state propagation gap:** The Telegram natural-command path may not propagate `INNER_AGORA_CHAT_ID`, so commands fall back to `.inner-agora-state.json`.
10. **Mode command continuation bug:** The profile or gateway may treat `mode get` output as context for answering the previous topic instead of as a terminal status command.
11. **Paperclip hierarchy drift:** Existing Paperclip agents may have stale `reportsTo` links to a terminated `Agora Assistant / Синтезатор` ancestor after imports or previous live runs.
12. **Guard coverage gap:** `inner-agora-guard` may check chamber availability but not active manager ancestry before live issue creation.
13. **Error humanization gap:** Project-action failures may be forwarded directly to Telegram without a product-level recovery formatter.
14. **Help intent routing gap:** `агора помощь` may be routed through the generic Agora ask/create path instead of a local help/menu handler.

### Investigation Checklist

- Capture the exact raw Telegram adapter outgoing payload for the failing messages.
- Check whether `<|channel>` appears before or after Telegram adapter formatting.
- Check Hermes active profile, model, and route used for the live response.
- Run `node scripts/inner-agora-guard.mjs --json` and record whether agents/profile/model are aligned with local expectations.
- Inspect installed profile files under `~/.hermes/profiles/inneragora/` for stale SOUL/MEMORY instructions.
- Reproduce with a local unit/integration test that feeds `<|channel>` through the Telegram output layer.
- Reproduce intent routing for “Ну что финал, надо проверять что вышло” without live Telegram side effects.
- Reproduce intent routing for “сделай быстрый совет: ...” and verify it maps to `quick`, not internal answer mode.
- Determine whether `/agora` is being invoked by Hermes as a shell command or by Paperclip Cockpit as a registered command.
- Check whether streaming partials and final responses both reach Telegram for the same provider turn.
- Compare environment/state variables for Telegram `mode get`, natural quick requests, natural deep requests, and callback/button actions.
- Inspect why Telegram `mode get` reports `.inner-agora-state.json` and whether a chat-specific state path should have been selected.
- Reproduce `mode get` in isolation and verify whether it can accidentally consume/answer prior conversation content.
- Inspect Paperclip agents/manager tree for `Хайдеггер` and `Agora Assistant / Синтезатор`.
- Run a guard/prepare dry check that validates selected voices are under an active manager/root before live ask creation.
- Reproduce the deep-research create path in dry-run mode, then identify exactly where the Paperclip 409 is surfaced to Telegram.
- Reproduce `агора помощь` without live side effects and verify whether it is classified as help/menu or as a generic ask.

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

**Batch C2 — Local Help/Menu Intent**

- Route `агора помощь`, `помощь агора`, and close variants to a local Telegram help/menu response.
- Ensure help/menu intent does not create Paperclip issues, select voices, or start council work.
- Add a regression test proving help works even when Paperclip hierarchy health is failing.

**Batch D — Quick Preset Dispatch**

- Add/verify natural routing for “сделай быстрый совет: ...” to `quick`.
- Ensure `/agora quick ...` executes through Paperclip Cockpit/Hermes command dispatch, not shell execution.
- Add regression test that quick advice creates a session and never produces internal direct advice.

**Batch E — Telegram Persona Hardening**

- Update Hermes instructions: Telegram user should never be told to edit docs manually.
- Update Hermes instructions: if Agora command dispatch fails, do not answer with internal reasoning; report the failure and run/suggest recovery.
- The bot should perform checks or ask for one concrete user action.
- Keep responses short and operational in live Telegram.

**Batch F — Duplicate Message Control**

- Identify whether streaming and final messages both go through Telegram send.
- Ensure only one final answer body is sent for non-progress responses.
- Keep explicit progress messages, but make them clearly separate and never include raw provider text.

**Batch G — Paperclip Runtime Repair / Hierarchy Health**

- Add/verify a guard check for selected voice ancestry: no selected voice may report through a terminated manager/root.
- Add a repair/prepare path that reassigns affected voices, including `Хайдеггер`, under an active Agora manager/root.
- Block live ask creation when hierarchy health fails and return a human recovery message.
- Add a regression or dry-run test for the HTTP 409 terminated-ancestor case.

**Batch H — Per-Chat State Propagation**

- Ensure Telegram natural text actions inject the chat id into Agora command/action execution.
- Verify `mode get` from Telegram reports the expected chat-scoped state when chat id is available.
- Add tests for natural text, command aliases, and callback/button paths so they share the same state scope.

**Batch I — Project Action Error UX**

- Wrap project-action stderr/JSON failures before sending to Telegram.
- Preserve full technical details in logs, but show the user a short Russian recovery explanation.
- Add tests for Paperclip 409, command-not-found, and provider timeout/error formatting.

### Non-Goals

- Do not implement Phase 9 as part of this bug.
- Do not change council synthesis logic.
- Do not change Paperclip issue schema.
- Do not add cloud-model dependency.

### Notes

This bug means Phase 8 mechanisms are present in code, but live acceptance is not yet passed. Treat this as a live integration hardening bug before moving to Phase 9.
