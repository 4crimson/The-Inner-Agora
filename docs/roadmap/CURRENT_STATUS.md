# Current Status: The Inner Agora

Date: 2026-07-05
Scope: product-system cleanup map for `/Users/admin/Documents/The Inner Agora`.

This is the current navigation document for cleanup and plugin extraction. It does
not replace the older roadmap/spec files. It marks what is current, what is a
candidate, and what must stay gated.

## User Goal

Make The Inner Agora easier to maintain as a product by separating:

- meaning and Telegram UX;
- generic `paperclip-cockpit` runtime mechanics;
- Agora-specific orchestration;
- chamber, role, skill, and prompt content;
- QA/runtime tooling;
- documentation and roadmap state;
- live Telegram/Paperclip operations.

The cleanup pass must be safe: no user-facing behavior change unless a slice is
explicitly UX-scoped. Live system touches are now operator-approved, but still
stay separate from cleanup commits.

## Current Layer Map

| Layer | Current source of truth | Status | Cleanup direction |
| --- | --- | --- | --- |
| Product and Telegram UX contract | `README.md`, `docs/superpowers/specs/2026-07-04-telegram-interface-contract-design.md`, `paperclip-cockpit.json`, `scripts/paperclip-cockpit-telegram.mjs` | Current, locally tested, live acceptance still gated | Keep first-level Telegram short and Russian-first; move only with focused UX tests |
| Generic Paperclip cockpit runtime | `hermes-plugins/paperclip-cockpit/__init__.py`, `hermes-plugins/paperclip-cockpit/README.md` | Already a reusable Hermes plugin | Keep project-specific nouns out of plugin code; extract helpers only inside the plugin boundary |
| Agora orchestration runtime | `scripts/agora.mjs` plus loaders in `scripts/*-loader.mjs`, `state-manager.mjs`, `model-routing.mjs`, `intent-slots.mjs` | Working, but `agora.mjs` is still a large mixed-responsibility file | Split by domain after docs/status pass, without behavior change |
| Chamber and role content | `chambers/*`, `philosophers/*`, `skills/*` | Chamber abstraction exists; philosophy and board-directors are present | Treat as future `agora-chamber-pack` style content/config package |
| Cockpit project config | `config/cockpit/*.json`, `scripts/build-cockpit-config.mjs`, `scripts/cockpit-config-inventory.mjs`, runtime `paperclip-cockpit.json`, `cockpit.core.json`, chamber `cockpit.overrides.json` files | Source fragments now generate the unchanged runtime config | Keep runtime path stable; edit fragments and prove parity with `build-cockpit-config --check` |
| QA runtime | `hermes-plugins/paperclip-cockpit/qa-tool/`, `telegram-testing.config.json`, root `paperclip-qa-tool/bin/paperclip-qa.mjs` wrapper | Good plugin extraction already done | Keep canonical runner in the plugin; root wrapper remains compatibility |
| Codex QA workflow plugin | `hermes-plugins/paperclip-cockpit/codex-plugin/telegram-paperclip-qa/` | Exists and is separate from Hermes runtime | Keep as workflow/plugin layer, not part of runtime code |
| Observability and cost | `scripts/agora/cost-utils.mjs`, `scripts/intent-slots.mjs`, `data/schema/state.schema.json`, `scripts/agora.mjs`, `costs.config.json` | Token ledger and explicit pricing table exist for retained local usage | Keep token capture separate from provider price discovery; extend to other LLM calls only when usage data is available |
| Paperclip backup safety | `scripts/backup-company.mjs`, `backups/` | Live read-only backup was run after explicit approval before 2026-07-05 Paperclip recovery | Keep using backup before future migration/live repair runs |
| Runtime state and artifacts | `.env`, `.inner-agora-state.json`, `.paperclip-cockpit-monitor-state.json`, `.paperclip-cockpit-telegram-mode-state.json`, `.telegram-userbot.session`, `.venv-telegram-userbot/`, `artifacts/`, `backups/`, `memory/`, `state/` | Ignored by git; useful operational evidence but not source | Document retention and cleanup policy before deleting anything |
| Live Telegram/Paperclip | Hermes profile `inneragora`, Paperclip company/project, Telegram bot/userbot | Approved for separate live validation as of 2026-07-05; `help`, `service-commands`, `mode-routing`, `natural-dialogue`, `interface-contract-topics`, and `council-create` suites accepted after recovery/profile sync; repeated post-suite guard repairs were needed after work-creating suites | Use explicit live QA commands and `--live-ok`; run guard after work-creating suites |

## Root Causes Found

1. The cleanup problem is mainly architectural, not storage-related. The largest
   burden is that product UX, project config, generic plugin behavior, and
   Agora orchestration are all valid but too close together.
2. `paperclip-cockpit.json` is now a mini-application contract. It contains
   command configuration, Telegram menus, callbacks, labels, intents, and
   project actions in one file. That is useful at runtime, but hard to review.
3. `scripts/agora.mjs` handles too many domains: chamber selection, Paperclip
   API work, session creation, follow-up, dialogue, synthesis, wizard/natural
   planning, memory export, and CLI dispatch.
4. `scripts/paperclip-cockpit-telegram.mjs` mixes Telegram payload formatting,
   Paperclip reads/writes, QA artifact reads, stop cleanup, and Bot API sending.
5. `hermes-plugins/paperclip-cockpit/__init__.py` is correctly generic, but it is
   large enough that future extraction should happen within the plugin package
   before adding more public surface.
6. Roadmap and bug docs contain a mix of planned, done, locally fixed, and
   live-pending items. A current status document is needed to stop old plans from
   reading as current instructions.
7. A visible Paperclip `adapter_failed` after Hermes exits with code 0 can be a
   lifecycle race, not a model/router/Telegram UX bug. The observed pattern was
   `hard cleanup` deleting an issue before `workspace_finalize` recorded its
   `workspace_operations` row. Release evidence must therefore include
   active-run-safe cleanup and post-suite guard status before it can be called a
   clean pass.

## Plugin Candidates

### Keep As Existing Plugins

- `paperclip-cockpit`: generic Hermes plugin for Paperclip command boundary,
  callbacks, mode selector, action runner, safety defaults, and Paperclip views.
- `paperclip-cockpit/qa-tool`: project-neutral Telegram/Paperclip QA runner.
- `telegram-paperclip-qa`: Codex workflow plugin for tester/developer/retest and
  release-review discipline.

### Add To Workflow Plugins Next

- `release-live-gate`: a QA workflow mode that runs the release evidence chain
  explicitly: preflight, backup, profile/plugin sync, live suite, cleanup,
  acceptance, post-suite guard, docs/commit evidence. First local slice is
  implemented as non-live `paperclip-qa release-gate`: it aggregates existing
  run manifests plus backup/profile-sync evidence into `accepted`,
  `accepted_with_repair`, or `blocked`. It does not yet execute backup,
  profile sync, or live suites itself.
- `profile-plugin-sync`: implemented in `paperclip-qa` as a read-only preflight
  that compares the repo `paperclip-cockpit` plugin tree with the installed
  Hermes profile plugin tree and blocks on digest mismatch before live suites.
- `post-suite-health-gate`: a `paperclip-qa` gate for work-creating suites that
  now records `guardBefore` and `guardAfter` in the manifest and acceptance
  report; red before-guard blocks live side effects, and red after-guard rejects
  acceptance. Repair backup/command and repeat guard remain next.
- `cleanup-active-run-guard`: implemented in `paperclip-qa`; hard cleanup now
  blocks issue delete when `/issues/:id/live-runs` reports active runs, cancels
  active heartbeat runs, waits for terminal state, and records
  `activeRunsBeforeCleanup` plus `cancelledRuns` in the manifest.
- `visible-output-sanitizer`: a shared first-level Telegram leak policy for
  route/model/local URL/wake/raw child rows/CLI flags, replacing duplicated
  `replyNotContains` lists.
- `docs-evidence-checklist`: a lightweight release checklist for run ids,
  backup ids, guard status, repair status, and commit hashes that must be
  reflected in `BUGS.md` and `COMPLETION_AUDIT.md`. Implemented as
  non-live `paperclip-qa evidence-checklist`; it reads `release-gate.json` and
  writes `EVIDENCE_CHECKLIST.md` next to the release gate artifact.

### Extract Later

- `agora-chamber-pack`: content/config package for `chambers/*`, `roles`,
  presets, safety policies, chamber overrides, and prompt content. This should
  be treated as a pack before it is treated as a runtime plugin.
- `agora-config-source`: editable source fragments for `paperclip-cockpit.json`.
  Runtime can keep one generated JSON file while humans edit smaller files.
- `agora-telegram-payloads`: internal module split from
  `scripts/paperclip-cockpit-telegram.mjs`. Keep it Agora-specific until the
  compact UX contract stabilizes further.
- `agora-core-runtime`: internal module split from `scripts/agora.mjs`. Do this
  before considering any public plugin boundary for Agora orchestration.

### Do Not Extract Yet

- First-level Telegram UX copy and button policy. It is product-specific and
  still tied to the accepted Inner Agora contract.
- Live QA execution as an incidental cleanup refactor. It should move only
  through the explicit `release-live-gate` workflow, not through behavior or
  architecture cleanup slices.

## Cleanup Plan

### Pass A - Documentation and Status, No Behavior Change

Acceptance criteria:

- `CURRENT_STATUS.md` describes the current layer map and plugin boundaries.
- Roadmap entry points point readers to current status first.
- No live commands are run.
- No runtime behavior changes.
- Non-live checks pass after the doc update.

### Pass B - Config Source Split, Generated Runtime JSON

Status: implemented locally as a non-live config-only change.

Acceptance criteria:

- Humans edit smaller config fragments.
- A build/check command produces or verifies the existing `paperclip-cockpit.json`.
- Runtime still reads the same JSON path.
- Tests prove menus, callbacks, actions, and visible Telegram labels are unchanged.

Implemented source layout:

```text
config/cockpit/00-runtime-core.json
config/cockpit/10-telegram-core.json
config/cockpit/11-telegram-command-boundary.json
config/cockpit/12-telegram-mode-selector.json
config/cockpit/13-telegram-callbacks.json
config/cockpit/20-project-runtime.json
config/cockpit/30-presentation.json
config/cockpit/40-intents.json
config/cockpit/50-actions.json
```

Local checks:

```bash
node scripts/cockpit-config-inventory.mjs --json
node scripts/build-cockpit-config.mjs --check --json
node scripts/chamber-loader.mjs cockpit philosophy --json
python3 -m unittest tests.test_cockpit_config_inventory tests.test_cockpit_config_build -v
```

Compatibility note: the legacy `chamber-loader cockpit philosophy` command now
delegates to the same `config/cockpit/*.json` fragment source used by
`build-cockpit-config.mjs`, so old Phase 2 checks do not drift from the current
runtime config source.

### Pass C - Agora Runtime Module Split

Status: started locally. First low-risk extraction completed:
`scripts/agora/text-utils.mjs` now owns pure string/JSON helpers that used to
live inside `scripts/agora.mjs`. Second low-risk extraction completed:
`scripts/agora/role-search.mjs` now owns roster-scoped alias matching, fuzzy
search, text scoring, and role de-duplication. Third low-risk extraction
completed: `scripts/agora/issue-utils.mjs` now owns mechanical Paperclip issue
helpers for refs, statuses, child sorting, synthesis-child detection, display
labels, and root traversal. Fourth low-risk extraction completed:
`scripts/agora/digest-utils.mjs` now owns synthesis/voice comment
normalization, digest section parsing, best-comment selection, and compact
digest printing. Fifth extraction completed: `scripts/agora/paperclip-client.mjs`
now owns Paperclip HTTP requests, local auto-restart error reporting, issue
create/update/comment helpers, agent wakeup, safe wakeup, and wake summaries.
Sixth extraction completed: `scripts/agora/session-builders.mjs` now owns pure
session task-description builders for root, role, follow-up, dialogue,
context-dialogue, and synthesis tasks. Policy resolution remains in
`scripts/agora.mjs`; the module receives already-resolved transparency text and
does not call Paperclip, Telegram, Hermes, or the network. Seventh extraction
completed: `scripts/agora/mode-utils.mjs` now owns pure mode normalization,
request mode detection, requested voice-limit parsing, and selected-role limit
calculation. This preserved the current semantics, including the existing
behavior where pair/range phrasing can limit voices but a standalone numeric
phrase is not broadened during cleanup. Eighth extraction completed:
`scripts/agora/role-selection.mjs` now owns pure role/chamber selection policy
for explicit role lists, philosophy heuristic buckets, non-philosophy chamber
scoring, MVP preset fallback, and mode/voice limits. `scripts/agora.mjs`
continues to own runtime roster loading, active chamber state, and preset-file
loading, then passes those values into the pure selector. Ninth extraction
completed: `scripts/agora/adapter-utils.mjs` now owns pure adapter route
metadata, state patch, display-line, and readback helpers. Model routing itself
still lives in `model-routing.mjs` plus `scripts/agora.mjs` runtime chamber/risk
context; this slice does not change adapter choice.
Tenth extraction completed: `scripts/agora/session-output.mjs` now owns
read-only CLI presentation helpers for session next-action lines, voice command
names, available voice list lines, and voice child scoring. `scripts/agora.mjs`
continues to own command dispatch and printing, so this slice changes module
boundaries only and does not touch router semantics, Telegram UX, Paperclip
writes, or live checks.
Eleventh extraction completed: `scripts/agora/roster-utils.mjs` now owns pure
roster/catalog helpers for tag extraction, tag normalization, tag summaries, and
`philosophers` CLI argument parsing. Paperclip reads and user-facing printing
remain in `scripts/agora.mjs`, keeping this slice local and read-only.
Twelfth extraction completed: `scripts/agora/chamber-utils.mjs` now owns pure
active-chamber and source-path mechanics: active-chamber id precedence,
chamber-relative paths, role roster source path, MVP preset source path, and
chamber company config env overrides. `scripts/agora.mjs` still owns
state/profile reads, chamber command writes, and active runtime loading, so this
slice does not change router semantics, Telegram UX, Paperclip writes, or live
checks.
Thirteenth extraction completed: `scripts/agora/natural-utils.mjs` now owns pure
natural-language CLI parsing and follow-up context predicates: natural text
normalization, explicit follow-up/new-topic/new-session/read-only detection,
fresh synthesis window checks, and context projection from local state data.
`scripts/agora.mjs` still owns actual state reads, cost-log writes, slot
extraction calls, planned command execution, and all Paperclip/Telegram effects,
so this slice changes only module boundaries.
Fourteenth extraction completed: `scripts/agora/wizard-utils.mjs` now owns pure
wizard slot defaults and answer parsing: chamber choice lines, chamber answer
matching, depth/mode answer parsing, and confirmation/cancellation predicates.
`scripts/agora.mjs` still owns wizard state transitions, prompts, planned command
execution, and printing, so this slice keeps the visible wizard UX unchanged.
Fifteenth extraction completed: `scripts/agora/cost-utils.mjs` now also owns
pure `costs` CLI option parsing and pricing-config path resolution. `scripts/agora.mjs`
still owns state reads, pricing JSON reads, dashboard printing, and command
dispatch, so this slice keeps Phase 9 behavior local and read-only while moving
cost mechanics closer to the cost module boundary.
Sixteenth extraction completed: `scripts/agora/memory-export-utils.mjs` now
owns pure memory-export filename/path and markdown rendering for Paperclip issue
exports. `scripts/agora.mjs` still owns Paperclip issue/comment reads,
`memory/sessions` directory creation, file writes, and CLI dispatch, so this
slice moves the export format toward a future skill boundary without changing
live behavior or filesystem side effects. Seventeenth extraction completed:
`scripts/agora/preflight-utils.mjs` now owns the pure `ask --all` volume
preflight payload. `scripts/agora.mjs` still owns CLI argument flow and any
Paperclip write path, so the guard remains a local no-write confirmation gate.
Eighteenth extraction completed: `scripts/agora/start-utils.mjs` now owns pure
`/agora start` example generation and onboarding-line rendering.
`scripts/agora.mjs` still owns state reads, chamber listing, JSON output,
printing, and CLI dispatch, so this slice preserves the visible start copy and
keeps it as a candidate CLI UX helper boundary rather than a runtime side
effect. Nineteenth extraction completed: `scripts/agora/cli-parse-utils.mjs`
now owns pure CLI argument parsing for ask, council, follow-up, role-proposal,
tasks, and full-output flags. `scripts/agora.mjs` still owns default mode
resolution, help output, role selection, command execution, Paperclip API calls,
and all terminal output, so this slice changes parsing module boundaries only.
Twentieth extraction completed: `scripts/agora/state-output-utils.mjs` now owns
pure state patch and CLI line formatting for remembered issues, decorated token
cost entries, compact cost summaries, active chamber readout, and mode readout.
`scripts/agora.mjs` still owns actual state reads/writes, adapter/chamber
selection, Paperclip API calls, command dispatch, and printing side effects.
Twenty-first extraction completed: `scripts/agora/role-output-utils.mjs` now
owns pure role/skill presentation payloads and line rendering for role search,
role proposal, and `skills` readouts. `scripts/agora.mjs` still owns roster
loading, role selection, skill resolution, active chamber state, JSON output,
and terminal printing. Twenty-second extraction completed:
`scripts/agora/finalize-utils.mjs` now owns pure finalize tree traversal and
visible child sorting. `scripts/agora.mjs` still owns Paperclip reads/writes,
dry-run behavior, comments/status updates, and terminal output. Twenty-third
extraction completed: `scripts/agora/natural-utils.mjs` now also owns the pure
natural command rewrite payload builder. `scripts/agora.mjs` still owns dry-run
printing, JSON output, command execution, state reads/writes, and slot
extraction. Twenty-fourth extraction completed: `scripts/agora/text-utils.mjs`
now also owns Paperclip issue title cleanup (`cleanTitle`). `scripts/agora.mjs`
still owns where those titles are used during session, follow-up, and dialogue
issue creation. Twenty-fifth extraction completed:
`scripts/agora/issue-query-utils.mjs` now owns Paperclip read-side issue
resolution for latest synthesis lookup, root issue selection, and top-root
traversal through an injected `api` dependency. `scripts/agora.mjs` still owns
command flow, terminal output, state updates, and all Paperclip write paths.

Acceptance criteria:

- `scripts/agora.mjs` becomes a thin CLI dispatcher.
- Paperclip client, session orchestration, role/chamber planning, synthesis,
  memory export, and natural-language planning live in focused modules.
- Existing CLI and Telegram behavior remains unchanged.
- Regression and focused unit tests pass on the chamber role path.

Current Pass C progress:

```text
scripts/agora/text-utils.mjs
scripts/agora/role-search.mjs
scripts/agora/issue-utils.mjs
scripts/agora/issue-query-utils.mjs
scripts/agora/digest-utils.mjs
scripts/agora/paperclip-client.mjs
scripts/agora/session-builders.mjs
scripts/agora/mode-utils.mjs
scripts/agora/role-selection.mjs
scripts/agora/adapter-utils.mjs
scripts/agora/session-output.mjs
scripts/agora/roster-utils.mjs
scripts/agora/chamber-utils.mjs
scripts/agora/natural-utils.mjs
scripts/agora/wizard-utils.mjs
scripts/agora/cost-utils.mjs
scripts/agora/memory-export-utils.mjs
scripts/agora/preflight-utils.mjs
scripts/agora/start-utils.mjs
scripts/agora/cli-parse-utils.mjs
scripts/agora/state-output-utils.mjs
scripts/agora/role-output-utils.mjs
scripts/agora/finalize-utils.mjs
```

These slices intentionally avoid router semantics, Telegram UX, Paperclip write
semantics, selection policy changes, and live checks.

### Pass D - Telegram Helper Module Split

Status: started locally as internal module extraction. Pure payload mechanics,
local QA artifact reading, Bot API sending mechanics, and stop-cleanup
Paperclip API mechanics now live under `scripts/telegram/`; the public helper
CLI and visible Telegram payload contract remain unchanged.

Acceptance criteria:

- Telegram payload formatting, QA artifact readers, stop cleanup, and Bot API
  sending are separated inside `scripts/` or a small local module directory.
- First-level UX contract remains unchanged.
- Payload tests continue to cover compact cards, hidden technical surfaces, and
  safe confirmation before work creation.

Current Pass D progress:

```text
scripts/telegram/payload-utils.mjs
scripts/telegram/qa-artifacts.mjs
scripts/telegram/sender.mjs
scripts/telegram/stop-cleanup.mjs
```

### Pass E - Plugin/Pack Promotion

Status: documented and tightened locally. No install, publish, profile copy, or
live action has been run.

Acceptance criteria:

- `paperclip-cockpit` stays project-neutral.
- Chamber packs can be added without forking Agora runtime code.
- Codex QA workflow plugin remains separate from Hermes runtime.
- Promotion/install/publish steps are documented but not run without approval.

Current promotion map:

- `docs/roadmap/PLUGIN_BOUNDARIES.md` is the source of truth for package
  boundaries.
- `paperclip-cockpit` and its `qa-tool/` are reusable plugin/tool layers.
- `telegram-paperclip-qa` is a Codex workflow plugin, not Hermes runtime.
- `agora-config-source`, `agora-chamber-pack`, `agora-core-runtime`, and
  `agora-telegram-payloads` stay local/internal until their boundaries stabilize.
- `telegram.launch_summary` in `config/cockpit/10-telegram-core.json` now owns
  the Agora launch regex/copy/buttons that were previously embedded in the
  generic `paperclip-cockpit` runtime. Pending-question state uses generic
  `role`/`roles` keys while the Agora CLI still receives `--philosophers` via
  config.

### Phase 9 - Token Observability Foundation

Status: started locally as a non-live state/schema/readout change.

Implemented:

- `scripts/agora/cost-utils.mjs` normalizes OpenAI-compatible `usage` payloads,
  appends entries to `session.costLog[]`, and summarizes prompt/completion/total
  tokens.
- `scripts/intent-slots.mjs` preserves token usage from the local LLM slot
  extractor, including fake usage for deterministic tests.
- `scripts/agora.mjs natural/understand` records extractor usage in local state.
- `scripts/agora.mjs status/latest` show a compact token summary when the local
  state contains LLM usage.
- `scripts/agora.mjs costs [--json] [--limit N] [--since ISO|--hours N]` shows
  a read-only dashboard over retained local token entries.
- `scripts/agora.mjs costs --pricing default` reads `costs.config.json` and
  computes known cost while preserving unknown calls/tokens separately. The
  committed pricing table only marks local LM Studio/Hermes routes as zero-cost;
  it does not guess cloud/provider prices.
- `paperclip-cockpit.json` and `config/cockpit/50-actions.json` expose the
  `costs --pricing default` action without adding live side effects.
- `scripts/agora/preflight-utils.mjs` blocks large all-mode runs before any
  Paperclip write: `ask --all` now requires `--confirm-all`, while `--dry-run`
  remains the safe preview path.
- `data/schema/state.schema.json` documents `session.costLog[]`.

Not complete yet:

- Paperclip agent/model calls are not yet measured because their usage payload is
  not available through this local bridge path.
- Paperclip agent/model calls whose usage is not in `session.costLog[]` still
  cannot be priced.
- All-mode preflight is volume-based for now; monetary threshold warnings for
  future sessions remain future Phase 9 work after source usage estimates are
  available.

Local checks:

```bash
python3 -m unittest tests.test_agora_cost_utils tests.test_agora_costs_command tests.test_agora_preflight_utils tests.test_phase6_state_manager tests.test_phase4_intent_slots tests.test_inner_agora_ask_flow -v
node scripts/agora.mjs costs --pricing default
```

## Gates And Invariants

- Live Telegram/Paperclip side effects are approved only as their own live QA
  workstream, not as incidental cleanup.
- No command with `--live-ok` during docs/code cleanup unless that cleanup slice
  explicitly includes live validation.
- Router changes, Telegram UI changes, Paperclip recovery, and plugin packaging
  must be separate changes.
- A green unit test is not enough to claim live UX acceptance.
- Ignored runtime artifacts are not source files; clean them only under an
  explicit retention/cleanup task.

## Recommended Next Work

1. Build the release live gate first: post-suite guard/manifest/acceptance
   fields plus active-run-safe cleanup evidence. Treat blocked active runs,
   cleanup residuals, red post-suite guard, or `workspace_finalize`/FK
   `adapter_failed` as `blocked` or `accepted_with_repair`, not a clean pass.
2. Centralize the Telegram first-level leak contract after that, so UX tests
   stop duplicating route/model/local URL/wake/raw child row exclusions.
3. Continue Pass C runtime-module splits only after the release lane no longer
   requires manual investigation after every work-creating suite.
4. Keep production Telegram checks and plugin install/publish in their own
   focused turns even when approved.
