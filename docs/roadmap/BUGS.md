# Live Bugs / Acceptance Backlog

This file tracks live Telegram acceptance failures separately from roadmap phases. A phase can be code-complete while live behavior still fails acceptance because runtime state, Hermes profile text, provider streaming, or Paperclip agents are out of sync.

## BUG-2026-07-04-004 — Telegram launch flow hides the question and leaks wake details

**Status:** live accepted for release-suite launch summaries on 2026-07-05
**Severity:** P1 for Telegram launch UX
**Reported:** 2026-07-04
**Surface:** Telegram → New question → proposal/launch cards

### Evidence

Live Telegram screenshots showed:

- `Глубокое исследование` displayed a launchable 6-philosopher composition before asking the user to enter the question.
- The editable philosopher composition card showed selected philosophers but did not show the question text.
- The launch acknowledgement leaked route/model, local Paperclip URL, child issue rows, and `wake=queued:...` ids.

Live 2026-07-05 `mode-routing` retest accepted the routing behavior, but the
default/custom natural launch replies still showed raw `scripts/agora.mjs ask`
stdout: route/model details, local Paperclip URL, child issue rows, and
`wake=queued:...` ids. Keep that as a separate Telegram launch-summary fix; do
not mix it with router or Paperclip repair changes.

Follow-up 2026-07-05: selected-mode natural launch now reuses the existing
Telegram launch-summary renderer before falling back to raw action output.
The live Hermes profile plugin was synced via `scripts/setup-hermes-profile.mjs`,
the `inneragora` gateway was restarted, and
`QA-20260705-2106-mode-routing-475f2b` passed 4/4 with strengthened
`replyNotContains` checks for `Маршрут:`, `model=`, localhost URLs,
`Открыть:`, `wake=queued`, and child `Голоса:` rows. Post-suite guard returned
`ok=true` with no `errorAgents`.

Additional follow-up 2026-07-05: launch-summary parsing now treats `--mode` as
a value flag, so council/quick/deep launch questions do not leak `--mode min`
or similar CLI control flags into `Вопрос:`. Live accepted suites after this
cleanup:

- `QA-20260705-2111-natural-dialogue-053534` passed 3/3.
- `QA-20260705-2116-interface-contract-topics-3de3a6` passed 4/4.
- `QA-20260705-2123-council-create-adfe3b` passed 3/3.

### Root Cause

The Telegram callback config mixed format selection with launch confirmation. `deep_prompt` was a static composition card rather than a topic prompt. The launch callback sent raw `scripts/agora.mjs ask` stdout directly to Telegram, which is useful for CLI debugging but too technical for the first-level chat UI.

The selected-mode natural launcher had a second parser gap: `--mode` takes a
value, but the launch-summary cleanup did not classify it as a value flag, so
the flag value could remain in the visible question text.

### Fix

- `Новый вопрос` now says the user will enter the question after choosing a format.
- `Глубокое исследование` asks for the question first; after a topic is known it uses a Telegram payload proposal with `Вопрос:`.
- `Выбрать философов` only shows edit/launch buttons after a topic is known.
- Proposal cards include `Вопрос:` with the parsed question.
- Telegram launch callbacks can render a clean launch summary with session id, question, philosophers, status, and buttons to session/philosophers/итог/details.
- Selected-mode natural launches use the same clean launch summary instead of
  raw `scripts/agora.mjs ask` stdout.
- First-level launch acknowledgement hides `wake=`, route/model details, local URLs, and child issue internals.
- Launch-summary question cleanup strips value flags such as `--mode min`.
- `Назад` sends the home screen with a fresh inline keyboard attached to the new bottom message.

### Acceptance Criteria

- No `Запустить` button appears before the topic/question is known.
- Proposal cards show `Вопрос:` before philosopher lists.
- Launch acknowledgements show `Запустил совет: THE-...`, `Вопрос:`, `Философы:`, and a short waiting status.
- First-level launch acknowledgements do not show `wake=`, local URLs, route/model details, or raw child task rows.
- Pressing `Назад` shows the main menu buttons on the new bottom message, not only in older messages above.
- Technical details remain available through `Детали`.
- Live retest covers mode-routing, natural dialogue, interface topics, and council creation without first-level technical leakage.

## BUG-2026-07-03-003 — Telegram has no visible mode routing control

**Status:** live accepted for `mode-routing` on 2026-07-05
**Severity:** P1 for Telegram UX / route control
**Reported:** 2026-07-03
**Surface:** Telegram → Paperclip Cockpit → Inner Agora ask route

### Evidence

During design review, Telegram help/actions exposed quick/deep prompts but did not let the user visibly select the route for the next normal question. This made "куда пойдет запрос" implicit and hard to verify.

### Root Cause

Telegram buttons were action callbacks only. There was no generic per-chat mode selector that could persist the selected route and apply it to later natural-language asks.

### Fix

- Added generic `telegram.mode_selector` support to Paperclip Cockpit.
- Mode buttons are rendered from config in selected command-boundary menus.
- `set_mode` stores selected mode per Telegram chat.
- Natural `ask` rewrites can execute through the selected mode action/env/args and skip the raw Hermes command path.
- Inner Agora config defines visible route modes: `quick_local`, `balanced_local`, `deep_local`, `codex_deep`, `custom_voices`, and `go_no_go_local`; the `all` action remains CLI-only.
- `codex_deep` routes through `--max` with `INNER_AGORA_FORCE_LOCAL_ADAPTER=0`, letting `model-routing.mjs` choose `codex_local`.
- `custom_voices` is a local route that prompts the user to name participants in ordinary language; role resolution stays in Inner Agora scripts/config.
- Live failure root causes found on first `mode-routing` run: action replies with empty keyboards lost mode buttons; QA evaluator did not read local route from reply text; regex participant parsing kept only the first named philosopher.
- Added `mode-routing` QA suite and checklist entries.
- Live 2026-07-05 root cause split: the first failed run was blocked by live
  Paperclip agents in `error`; after read-only backup and `prepare local`, guard
  returned `ok=true` with no `errorAgents`. The remaining pair-voices failure
  was a router contract mismatch: exact pair count words were treated as vague
  small-group confirmation instead of launch.
- Router fix: exact pair/two-voice wording now rewrites to `/agora ask ...`,
  letting the existing ask selector choose two voices. Vague `несколько
  философов` still confirms before launch.
- Live evidence: `QA-20260705-2054-mode-routing-234c17` passed 4/4 with hard
  cleanup and no residual artifacts. Raw launch-summary leakage observed during
  the same suite remains tracked under `BUG-2026-07-04-004`.

### Acceptance Criteria

- `/help` and `/agents` show current mode plus mode buttons.
- Selecting a mode changes the current mode for that Telegram chat.
- The next normal human question routes through the selected action/env/args.
- Local modes include `INNER_AGORA_FORCE_LOCAL_ADAPTER=1`.
- `Codex` mode routes to `codex_local`.
- "Свои голоса" / named-philosopher phrasing can create a session with the named voices.
- Live retest suite `mode-routing` passes and cleanup leaves no residual QA artifacts.

## BUG-2026-07-03-002 — Telegram service commands leak raw Hermes UI

**Status:** live accepted for `service-commands` on 2026-07-05
**Severity:** P1 for Telegram UX
**Reported:** 2026-07-03
**Surface:** Telegram → Hermes BoF / Paperclip Cockpit

### Evidence

Live Telegram history showed:

- `/agents` returned generic Hermes "Active Agents & Tasks" output.
- `/help` returned a large global Hermes command dump in English.
- `/agora` and `/agora help` returned Agora help text without buttons.
- `/agora help full` was technically useful but too flat and hard to read.

Additional 2026-07-04 live transcript showed:

- `/start` and the plain text `Агора` still returned the old `Агора подключена к Paperclip` command card.
- `Агора статус` produced a compact last-session card, then still leaked raw `# Последняя Paperclip-сессия` details from the CLI path.

### Root Cause

Telegram slash commands bypassed the natural-language rewrite path and fell through to the generic Hermes command router. The command-handler stage does not have the same Telegram side-channel keyboard context as `pre_gateway_dispatch`.

The 2026-07-04 follow-up root cause was narrower: `/start` and exact text aliases such as `Агора` were not part of the Telegram command boundary, so they fell through to `/agora start` or natural follow-up routing. The fallback `presentation.home` text also still contained the old Paperclip command-card copy.

### Fix

- Added a config-driven Telegram command boundary in Paperclip Cockpit `pre_gateway_dispatch`.
- Hard-overrode `/help`, `/agora`, `/agora help`, and `/agents` into Agora menu messages with inline buttons.
- Preserved explicit full/admin paths such as `/agora help full`.
- Reworked full help into grouped readable sections: ordinary entry, ordinary commands, sessions, voices, admin/diagnostics, safety.
- Added `service-commands` QA suite expectations.
- Added `/start`, bot-addressed `/start@...`, and exact `Агора` / `The Inner Agora` home aliases to the same Telegram boundary.
- Updated the fallback human home text in the root config and philosophy chamber override so stale Paperclip command-card copy no longer appears if the button path is bypassed.
- Added regression coverage that `Агора статус` uses the compact `telegram_last_session` payload and skips raw `latest` output.
- Live evidence: `QA-20260705-2040-service-commands-ca0477` passed 5/5 with hard
  cleanup and no residual artifacts.

### Acceptance Criteria

- `/start`, `/help`, `/agora`, `/agora help`, exact `Агора`, and `/agents` return Agora-oriented Telegram messages with buttons.
- These commands do not create Paperclip issues.
- `/agents` does not expose "Active Agents & Tasks".
- `Агора статус` sends only the compact last-session card and does not leak `# Последняя Paperclip-сессия`, local URLs, child task dumps, or raw CLI output.
- `/agora help full` remains technical but is grouped and readable.
- Live retest suite `service-commands` passes and cleanup leaves no residual QA artifacts.

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

Status 2026-07-06: local routing slice implemented. `scripts/agora.mjs natural
--routing-mode regex --dry-run --json` now rewrites `проверить что вышло` and
`давай acceptance` to `/agora latest`, and `финал проверяем` to `/agora result`.
The Paperclip Cockpit natural delegate inherits the same behavior, so these
phrases no longer produce `/agora ask`, wizard confirmation, or roadmap-persona
discussion in local tests. Covered by
`tests.test_phase4_intent_slots.Phase4IntentSlotTests.test_agora_natural_operational_check_phrases_do_not_launch_council`
and `tests.test_paperclip_cockpit_rewrites.PaperclipCockpitRewriteTests.test_natural_agora_research_roundtrip_phrases`.
Live Telegram replay remains open for the broader BUG-001 acceptance.

**Batch C2 — Local Help/Menu Intent**

- Route `агора помощь`, `помощь агора`, and close variants to a local Telegram help/menu response.
- Ensure help/menu intent does not create Paperclip issues, select voices, or start council work.
- Add a regression test proving help works even when Paperclip hierarchy health is failing.

Status 2026-07-03: implemented. `help` now returns a local `message` plan instead of `/agora help`; the Paperclip cockpit delegate sends that message to Telegram and returns `skip`, so the gateway does not create Paperclip issues for help. Verified with unit tests and a live Telegram smoke to chat `1446198327`.

Live follow-up 2026-07-03: a userbot smoke against `@crimson_philosophs_bot` initially reproduced the old bug because the installed Hermes profile plugin was stale while the repo plugin was fixed. After `scripts/setup-hermes-profile.mjs` synced the profile plugin and the gateway was restarted, userbot message `агора помощь` returned the local help/menu text and did not create another Paperclip issue. Acceptance evidence: transcript `transcripts/telegram-userbot/crimson-agora-help-after-sync-20260703.jsonl`.

Live QA follow-up 2026-07-03: controlled run `QA-20260703-1517-help-c8e2b1` rejected `help.ru.basic` and `help.ru.capabilities` because help/capabilities replies had no inline buttons. Root cause: local help messages were sent through the Telegram side channel without a fallback keyboard, and “что ты умеешь...” was not protected as a deterministic help service intent when follow-up state or LLM routing was present. Fix: added config-driven `telegram.help_buttons`, attached them to delegate help messages, forced help/capabilities phrases to deterministic help before LLM/follow-up handling, and taught the QA userbot driver to record Telethon inline buttons. Retest `QA-20260703-1530-help-retest-32272c` reran only `help.ru.basic` and `help.ru.capabilities`: 2/2 pass, decision `accept`, cleanup residuals none.

**Batch D — Quick Preset Dispatch**

- Add/verify natural routing for “сделай быстрый совет: ...” to `quick`.
- Ensure `/agora quick ...` executes through Paperclip Cockpit/Hermes command dispatch, not shell execution.
- Add regression test that quick advice creates a session and never produces internal direct advice.

Status 2026-07-03: partially implemented. `quick`/`deep` actions now force the local adapter route with `INNER_AGORA_FORCE_LOCAL_ADAPTER=1` while preserving `--min`/`--max` depth. Live forced-local verification created `THE-91` with route `hermes_local`, model `google/gemma-4-26b-a4b-qat`, reason `forcedLocalAdapter`. Remaining: live Telegram inbound verification through the actual gateway, not only plugin/action and CLI diagnostics.

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

Status 2026-07-03: repair path implemented through `prepare local`. Existing agents now resync `reportsTo` to the active `Agora Assistant / Синтезатор`, switch to `hermes_local`, and clear `error` status after successful sync. Live verification: `node scripts/agora.mjs prepare local` passed; guard returned `ok=true`; `Хайдеггер` and `Аристотель` are `idle`, `hermes_local`, and report to the active синтезатор. A live max-depth create no longer hit the 409 and created `THE-82`; a follow-up forced-local create created `THE-91` and queued `Хайдеггер` successfully.

Status 2026-07-06: explicit selected-voice ancestry validation is now implemented before `ask` creates Paperclip work. `scripts/agora.mjs ask` checks selected voice agents and their `reportsTo` chain for blocked statuses such as `terminated`, `error`, and `archived`; if the hierarchy is red, it returns a short recovery message pointing to `node scripts/agora.mjs prepare local` and does not create root/child issues or wakeups. Local regression: `python3 -m unittest tests.test_inner_agora_ask_flow.InnerAgoraAskFlowTests.test_ask_blocks_selected_voice_with_terminated_ancestor_before_writes`. Live replay of an intentionally broken hierarchy was not run in this slice.

Live follow-up 2026-07-03: `node scripts/inner-agora-guard.mjs --json` now passes Telegram/router/callback checks after profile sync, but remains red because one Paperclip agent (`Фуко`) is in `error`. This is a separate Paperclip recovery task and should not be mixed with Telegram help/menu routing.

Live recovery 2026-07-05: after explicit operator approval, a read-only backup
was written to `backups/2026-07-05T20-48-53-793Z-the-inner-agora/backup.json`
with 84 agents, 77 issues, and 821 comments. Then `node scripts/agora.mjs
prepare local` re-synced the live company. Fresh guard returned `ok=true`,
`agents.errorAgents=[]`, and all checked agents on `hermes_local`; the default
mode-routing ask then passed and created Paperclip work successfully.

Post-suite live health 2026-07-05: after the accepted full `mode-routing` run,
hard cleanup left no issue residuals, but guard turned red because `Аристотель`
was in `error`. A second backup
`backups/2026-07-05T20-59-59-701Z-the-inner-agora/backup.json` was captured
(85 agents, 77 issues, 821 comments), then `prepare local` restored guard to
`ok=true`. Treat post-work-suite guard/repair as a release gate; QA cleanup can
remove test artifacts without restoring Paperclip agent health.

Later release-suite evidence confirmed the same live-health pattern. The
accepted `natural-dialogue` suite left guard green. The accepted
`interface-contract-topics` suite left no QA artifacts, but guard later showed
`Диоген` and `Ницше` in `error`; backup
`backups/2026-07-05T21-19-08-665Z-the-inner-agora/backup.json` plus
`prepare local` restored guard. The accepted `council-create` suite also left no
QA artifacts, but guard later showed `Платон` and `Жан-Поль Сартр` in `error`;
backup `backups/2026-07-05T21-27-54-564Z-the-inner-agora/backup.json` plus
`prepare local` restored guard to `ok=true`. A final pre-commit guard check
again found transient agent errors (`Фуко`, `Аристотель`), and backup
`backups/2026-07-05T21-31-39-714Z-the-inner-agora/backup.json` plus
`prepare local` restored guard; a repeat guard 15 seconds later stayed
`ok=true`. This is an operational live-health gap, not a Telegram UX acceptance
failure.

Adapter failure evidence 2026-07-05: heartbeat run
`20b5a4ed-9021-4830-9654-718e2c10534b` стартовал в `21:06:32Z`, но связанный
issue `357f13b2-ad4f-46a8-bbb5-0817b4029bab` был удален hard cleanup-ом в
`21:08:36Z`. Hermes успешно завершился в `21:18:14Z`, затем
`workspace_finalize` не смог вставить `workspace_operations`, потому что
`workspace_operations.issue_id` ссылался на уже удаленный issue. Это точный
RL-3 cleanup/finalize race, а не model, router или Telegram UX failure.

Live release-gate follow-up 2026-07-06: focused `interface-contract-topics`
run `QA-20260706-0849-interface-contract-topics-646217` passed all 4 UX tests
with guardBefore/guardAfter green, but first release-live-gate
`RLG-20260706-085238-68837e` blocked because hard cleanup cancelled active
runs and then Paperclip terminal recovery queued replacement
`Agora Assistant / Синтезатор` runs while child issues stayed assigned
`in_progress`. Fix: `paperclip-qa cleanup hard` now stabilizes assigned active
issues as hidden/cancelled and clears execution locks before cancel/wait; retry
cleanup can clear current residuals while preserving old attempts in
`residualHistory`. Accepted evidence after retry: release-live-gate
`RLG-20260706-085927-629b7c`, release gate `RG-20260706-085927-02df11`, backup
`artifacts/telegram-test-runs/backups/2026-07-06t08-49-59-171z-the-inner-agora/backup.json`,
profile/plugin sync `ok`, guardBefore/guardAfter/guardRepeat `ok`, cleanup
residuals `0`, active runs before cleanup `5`, cancelled runs `5`. A post-run
guard later found transient `Платон` error; backup
`backups/2026-07-06T08-58-55-378Z-the-inner-agora/backup.json` plus
`node scripts/agora.mjs prepare local` restored guard to `ok=true`.

Read-only release-gate follow-up 2026-07-06: `help` run
`QA-20260706-0907-help-7917d5` passed all 4 checks, created no Paperclip work,
deleted Telegram QA messages cleanly, and produced accepted wrapper
`RLG-20260706-090802-35c2fb` / release gate `RG-20260706-090802-77c948`.
The run records `guardRequired=false` with guardBefore/guardAfter/guardRepeat
`not-run`, proving read-only suites should not be blocked by synthetic
post-suite-health expectations.

Read-only service-command release-gate follow-up 2026-07-06:
`service-commands` first blocked usefully rather than producing a false accept.
`RLG-20260706-091855-4ecee1` / run
`QA-20260706-0916-service-commands-d960af` failed
`service.agora.help.full` because the first-level full help exposed raw/CLI
details (`--min`, `--max`, `--all`, and service `telegram_*` actions). Fix:
human full help hides raw actions and strips `--` option groups from project
action usage; focused local tests passed. After live profile sync and gateway
restart, `RLG-20260706-092456-855264` and
`RLG-20260706-092825-6748ff` exposed a separate QA timing attribution problem:
20-second menu-command waits could put the reply into the next test bucket.
Fix: `service-commands` menu/help waits are now 35 seconds, assertions
unchanged. Accepted evidence: wrapper `RLG-20260706-093243-a2491c`, release gate
`RG-20260706-093243-9ce35c`, run `QA-20260706-0929-service-commands-b51db6`,
backup
`artifacts/telegram-test-runs/backups/2026-07-06t09-29-40-389z-the-inner-agora/backup.json`,
profile/plugin sync `ok`, tests 5/5 pass, cleanup residuals `0`, no Paperclip
work, `activeRunsBeforeCleanup=0`, `cancelledRuns=0`, guardRequired `false`.

Natural-dialogue release-gate follow-up 2026-07-06: wrapper
`RLG-20260706-093712-e47310` / release gate `RG-20260706-093712-3558bb` accepted
run `QA-20260706-0936-natural-dialogue-490a3f` with backup
`artifacts/telegram-test-runs/backups/2026-07-06t09-36-35-861z-the-inner-agora/backup.json`.
The suite passed 3/3. It usefully exercised both sides of the contract:
`dialogue.freedom-adult-child` did not create Paperclip work, while
`dialogue.ask-two-philosophers` created root `THE-268` and active child runs
`THE-269`/`THE-270`. Active-run-safe cleanup cancelled 2 live runs and left
cleanup residuals `0`; guardAfter and post-run guard were `ok`.

Live profile-sync recovery 2026-07-06: new read-only
`paperclip-qa profile-plugin-sync --config telegram-testing.config.json --json`
first reported `profilePluginSync=blocked` because the live `inneragora`
profile plugin tree was stale: missing `qa-tool/src/guard-runner.mjs`,
`qa-tool/src/release-gate.mjs`, and `qa-tool/src/profile-plugin-sync.mjs`, with
additional changed QA/runtime files. After `node scripts/setup-hermes-profile.mjs`
and `inneragora gateway restart`, the same check returned `profilePluginSync=ok`
with matching sha/file count. Guard then found one transient error agent
(`Джудит Батлер`), so a read-only backup was written to
`backups/2026-07-05T22-25-55-730Z-the-inner-agora/backup.json` (85 agents, 77
issues, 821 comments), `node scripts/agora.mjs prepare local` restored agent
health, and a repeat guard 15 seconds later stayed `ok=true`.

**Batch H — Per-Chat State Propagation**

- Ensure Telegram natural text actions inject the chat id into Agora command/action execution.
- Verify `mode get` from Telegram reports the expected chat-scoped state when chat id is available.
- Add tests for natural text, command aliases, and callback/button paths so they share the same state scope.

**Batch I — Project Action Error UX**

- Wrap project-action stderr/JSON failures before sending to Telegram.
- Preserve full technical details in logs, but show the user a short Russian recovery explanation.
- Add tests for Paperclip 409, command-not-found, and provider timeout/error formatting.

Status 2026-07-06: locally covered for Paperclip `409 terminated ancestor`,
command-not-found, subprocess timeout, and provider timeout/error formatting.
Default project actions now show a short Russian recovery message and hide raw
`Project action...`, `stderr:` and JSON unless the action explicitly uses
`presentation.mode=raw` or global debug details. Covered by
`test_run_action_humanizes_paperclip_terminated_ancestor_error`,
`test_run_action_humanizes_missing_command_error`,
`test_run_action_humanizes_project_action_timeout`, and
`test_run_action_humanizes_provider_timeout_error`. Live Telegram replay remains
part of the release lane.

### Non-Goals

- Do not implement Phase 9 as part of this bug.
- Do not change council synthesis logic.
- Do not change Paperclip issue schema.
- Do not add cloud-model dependency.

### Notes

This bug means Phase 8 mechanisms are present in code, but live acceptance is not yet passed. Treat this as a live integration hardening bug before moving to Phase 9.
