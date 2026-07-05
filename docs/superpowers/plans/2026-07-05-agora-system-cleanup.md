# Agora System Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely clean up and actualize The Inner Agora as a product system by documenting current truth, separating plugin boundaries, and sequencing later config/code cleanup without live side effects or behavior change.

**Architecture:** Treat this as a staged stabilization project. Pass A creates the current map and acceptance gates; Pass B splits editable config from runtime config; Passes C and D modularize runtime files only after config and tests are stable; Pass E promotes reusable plugins/packs after internal boundaries are proven.

**Tech Stack:** Node.js `.mjs` scripts, Python Hermes plugin code, JSON cockpit/chamber configs, `unittest`, Telegram/Paperclip QA runner, Markdown docs.

---

## File Structure

- Create/update: `docs/roadmap/CURRENT_STATUS.md` - current layer map, plugin candidates, gates, and staged cleanup plan.
- Modify: `docs/roadmap/README.md` - make current status the first roadmap entry point.
- Later create: `scripts/cockpit-config-inventory.mjs` - non-live inventory for actions, callbacks, menus, labels, and source/runtime parity.
- Later create: `config/cockpit/*.json` - editable source fragments for runtime `paperclip-cockpit.json`.
- Later modify: `paperclip-cockpit.json` - generated or verified runtime artifact, still read by Hermes.
- Later split: `scripts/agora.mjs` into focused modules after config split is stable.
- Later split: `scripts/paperclip-cockpit-telegram.mjs` into focused payload, QA, stop-cleanup, and sender modules after UX contract remains green.

## Task 1: Current Status Documentation

**Files:**
- Create: `docs/roadmap/CURRENT_STATUS.md`
- Modify: `docs/roadmap/README.md`

- [x] **Step 1: Add current status doc**

Create `docs/roadmap/CURRENT_STATUS.md` with:

- user goal and safe-first boundaries;
- current layer map;
- root causes;
- plugin candidates;
- staged cleanup plan;
- live and legacy gates.

- [x] **Step 2: Update roadmap entry point**

Modify `docs/roadmap/README.md` so readers start with `CURRENT_STATUS.md`, then use `ROADMAP.md`, `IMPLEMENTATION_PLAN.md`, and `TASKS.md` as historical/planning detail.

- [x] **Step 3: Verify docs syntax and repo cleanliness**

Run:

```bash
git diff --check
git status --short
```

Expected:

- `git diff --check` exits 0;
- `git status --short` shows only intentional doc changes.

## Task 2: Config Split Design And Inventory

**Files:**
- Create: `scripts/cockpit-config-inventory.mjs`
- Test: `tests/test_cockpit_config_inventory.py` or a focused Node command in the plan if Python test harness is not appropriate
- Modify later: `docs/roadmap/CURRENT_STATUS.md`

- [x] **Step 1: Add an inventory command before splitting config**

Create a non-live inventory script that reads `paperclip-cockpit.json` and prints JSON with at least:

```json
{
  "actions": 43,
  "telegramCallbacks": 61,
  "telegramCommandBoundaryMenus": 2,
  "topLevelCommand": "agora"
}
```

The script must not call Telegram, Paperclip, Hermes, or the network.

- [x] **Step 2: Add focused test coverage**

Add a test that runs the inventory command against the real config and asserts:

- action count is greater than 0;
- callback count is greater than 0;
- command name is `agora`;
- command-boundary menus are present.

- [x] **Step 3: Document the source split proposal**

Update `CURRENT_STATUS.md` with the chosen source-fragment layout, for example:

```text
config/cockpit/core.json
config/cockpit/telegram-menus.json
config/cockpit/telegram-callbacks.json
config/cockpit/actions.json
config/cockpit/presentation.json
```

- [x] **Step 4: Verify**

Run:

```bash
node scripts/cockpit-config-inventory.mjs
python3 -m unittest tests.test_paperclip_cockpit_rewrites tests.test_paperclip_cockpit_telegram_callbacks tests.test_paperclip_cockpit_telegram_helper -v
git diff --check
```

Expected:

- inventory prints valid JSON;
- focused tests pass;
- diff check exits 0.

## Task 3: Config Source Split

**Files:**
- Create: `config/cockpit/*.json`
- Create: `scripts/build-cockpit-config.mjs`
- Test: focused config build/parity test
- Modify: `paperclip-cockpit.json` only if generated output is byte-stable or intentionally reformatted in a separate commit

- [x] **Step 1: Create source fragments**

Split config by responsibility:

- core command/gateway/hooks/monitor/issue/notifications;
- Telegram command boundary menus;
- Telegram callbacks and mode selector;
- presentation, labels, terms, aliases, markers;
- project actions and natural-language intents.

- [x] **Step 2: Add a build/check command**

Create `scripts/build-cockpit-config.mjs` with two modes:

```bash
node scripts/build-cockpit-config.mjs --check
node scripts/build-cockpit-config.mjs --write
```

`--check` must compare generated JSON to `paperclip-cockpit.json` without writing.

- [x] **Step 3: Verify parity before write mode is trusted**

Run:

```bash
node scripts/build-cockpit-config.mjs --check
node -e 'JSON.parse(require("fs").readFileSync("paperclip-cockpit.json", "utf8")); console.log("json ok")'
python3 -m unittest tests.test_paperclip_cockpit_rewrites tests.test_paperclip_cockpit_telegram_callbacks tests.test_paperclip_cockpit_telegram_helper -v
```

Expected:

- generated config matches runtime config;
- JSON parses;
- focused Telegram/callback tests pass.

## Task 4: Agora Runtime Module Split

**Files:**
- Modify: `scripts/agora.mjs`
- Create later: focused modules under `scripts/agora/` or another local pattern chosen after reading existing loader style
- Test: existing ask-flow, intent-slot, regression, migration tests

Progress 2026-07-05:

- Created `scripts/agora/text-utils.mjs`.
- Moved pure helpers from `scripts/agora.mjs`: `stableJson`, `clip`,
  `looseText`, `looseStem`, `searchStem`, `editDistance`, `oneLine`,
  `extractHereDocBody`, and `slugify`.
- Added `tests/test_agora_text_utils.py`.
- Created `scripts/agora/role-search.mjs`.
- Moved roster-scoped role helpers from `scripts/agora.mjs`: `roleAliases`,
  `roleByToken`, `searchRoles`, `roleScoreInText`, `roleFromText`,
  `uniqueRoles`, and `genericRoleScore`.
- Added `tests/test_agora_role_search.py`.
- Created `scripts/agora/issue-utils.mjs`.
- Moved mechanical Paperclip issue helpers from `scripts/agora.mjs`: issue ref
  parsing, status sets, issue sorting, child traversal, synthesis-child
  detection, display labels, root lookup, and voice-child filtering.
- Added `tests/test_agora_issue_utils.py`.
- Created `scripts/agora/digest-utils.mjs`.
- Moved synthesis/voice digest helpers from `scripts/agora.mjs`: meaningful body
  cleanup, normalized digest text, synthesis-shape detection, root-question
  extraction, section/bullet/paragraph parsing, best synthesis comment
  selection, and compact digest printers.
- Added `tests/test_agora_digest_utils.py`.
- Created `scripts/agora/paperclip-client.mjs`.
- Moved Paperclip HTTP helpers from `scripts/agora.mjs`: API requests, local
  auto-restart error reporting, issue create/update/comment helpers, agent
  wakeup, safe wakeup, and wake summaries.
- Added `tests/test_agora_paperclip_client.py`.
- Created `scripts/agora/session-builders.mjs`.
- Moved pure session task-description builders from `scripts/agora.mjs`: root
  session, role child, follow-up, direct dialogue, context dialogue, synthesis
  description, mode policy, and chamber-kind checks. Policy prompt resolution
  stays in `scripts/agora.mjs` and is passed in as resolved text.
- Added `tests/test_agora_session_builders.py`.
- Created `scripts/agora/mode-utils.mjs`.
- Moved pure mode/request helpers from `scripts/agora.mjs`: `normalizeMode`,
  `detectMode`, requested voice-limit parsing, and selected-role limit
  calculation. This keeps the existing semantics and intentionally does not
  broaden numeric voice parsing during cleanup.
- Added `tests/test_agora_mode_utils.py`.
- Created `scripts/agora/role-selection.mjs`.
- Moved pure role/chamber planning from `scripts/agora.mjs`: explicit
  `--philosophers` selection, philosophy heuristic buckets, non-philosophy
  chamber role scoring, MVP preset fallback, and mode/voice limits. Runtime
  roster loading, active chamber state, and preset-file loading stay in
  `scripts/agora.mjs` and are passed into the selector.
- Added `tests/test_agora_role_selection.py`.
- Created `scripts/agora/adapter-utils.mjs`.
- Moved pure adapter route metadata helpers from `scripts/agora.mjs`: metadata
  projection, state patch generation, display-line formatting, and route
  readback from issue/state payloads. Actual adapter selection remains in
  `model-routing.mjs` plus `scripts/agora.mjs` runtime chamber/risk context.
- Created `scripts/agora/session-output.mjs`.
- Moved read-only CLI presentation helpers from `scripts/agora.mjs`: session
  next-action lines, voice command names, available voice list lines, and voice
  child scoring. `scripts/agora.mjs` still owns command dispatch and printing;
  the module stays pure and does not call Paperclip, Telegram, Hermes, or the
  network.
- Created `scripts/agora/roster-utils.mjs`.
- Moved pure roster/catalog helpers from `scripts/agora.mjs`: tag extraction,
  tag normalization, tag-count summaries, and `philosophers` CLI argument
  parsing. Paperclip reads and user-facing printing remain in
  `scripts/agora.mjs`.
- Created `scripts/agora/chamber-utils.mjs`.
- Moved pure active-chamber/source mechanics from `scripts/agora.mjs`:
  active-chamber id precedence, chamber-relative paths, role roster source path,
  MVP preset path, and chamber company config env overrides. State/profile reads
  and chamber command writes remain in `scripts/agora.mjs`.
- Created `scripts/agora/natural-utils.mjs`.
- Moved pure natural-language planning helpers from `scripts/agora.mjs`:
  natural CLI argument parsing, text normalization, explicit follow-up,
  new-topic, new-session, read-only intent predicates, synthesis freshness
  checks, and context projection from state data. Runtime state reads, cost-log
  writes, LLM slot extraction, command execution, and all Paperclip/Telegram
  effects remain in `scripts/agora.mjs`.
- Created `scripts/agora/wizard-utils.mjs`.
- Moved pure wizard helpers from `scripts/agora.mjs`: default wizard slots,
  chamber choice line formatting, chamber answer parsing, mode/depth answer
  parsing, and confirmation/cancellation predicates. Wizard state transitions,
  prompts, command execution, and printing remain in `scripts/agora.mjs`.
- Created `scripts/agora/cost-utils.mjs`.
- Started Phase 9 token observability locally: OpenAI-compatible LLM `usage`
  payloads are normalized into `session.costLog[]`, the local intent extractor
  passes usage through, `natural`/`understand` persist it in local state, and
  `status`/`latest` print a compact token summary.
- Added the read-only `costs` dashboard command and cockpit action:
  `node scripts/agora.mjs costs [--json] [--limit N] [--since ISO|--hours N]`.
  Pricing is now explicit and config-driven: `costs.config.json` marks local
  LM Studio/Hermes routes as zero-cost, and `costs --pricing default` computes
  known cost while leaving missing rates as unknown instead of `$0`.
  This still does not measure Paperclip agent calls whose usage is not exposed
  through this bridge path.
- Extended `scripts/agora/cost-utils.mjs`.
- Moved pure `costs` CLI parsing and pricing-config path resolution from
  `scripts/agora.mjs` into the cost module. State reads, pricing JSON reads,
  command dispatch, and dashboard printing remain in `scripts/agora.mjs`.
- Created `scripts/agora/memory-export-utils.mjs`.
- Moved pure memory-export formatting from `scripts/agora.mjs`: export filename,
  output path, YAML front matter, issue markdown, Paperclip link, description,
  and comment sections. Paperclip reads, directory creation, file writes, and
  CLI dispatch remain in `scripts/agora.mjs`.
- Created `scripts/agora/preflight-utils.mjs`.
- Added a local volume preflight for `ask --all`: without `--confirm-all` it
  exits before any Paperclip write and tells the operator to inspect with
  `--dry-run` or explicitly confirm. This closes the accidental 84-child-task
  risk without adding live behavior. Monetary preflight for future sessions
  remains separate from this volume guard.
- Created `scripts/agora/start-utils.mjs`.
- Moved pure `/agora start` helpers from `scripts/agora.mjs`: chamber example
  generation and onboarding-line rendering. State reads, chamber listing, JSON
  output, terminal printing, and CLI dispatch remain in `scripts/agora.mjs`.
- Created `scripts/agora/cli-parse-utils.mjs`.
- Moved pure CLI argument parsing from `scripts/agora.mjs`: ask, council,
  follow-up, role-proposal, tasks, and full-output flag parsing. Default mode
  resolution, help output, role selection, command execution, Paperclip API
  calls, and terminal printing remain in `scripts/agora.mjs`.
- Created `scripts/agora/state-output-utils.mjs`.
- Moved pure state/output helpers from `scripts/agora.mjs`: remembered-issue
  state patches, decorated token cost entries, compact cost summary lines,
  active-chamber readout lines, and mode readout lines. Actual state reads and
  writes, adapter/chamber selection, command dispatch, Paperclip API calls, and
  terminal printing remain in `scripts/agora.mjs`.
- Created `scripts/agora/role-output-utils.mjs`.
- Moved pure role/skill presentation helpers from `scripts/agora.mjs`: role
  search lines, role proposal payload/lines, public skill projection, resolved
  role skill payloads, single-role skill lines, and all-role skill summary
  lines. Roster loading, role selection, skill resolution, active chamber state,
  JSON output, and terminal printing remain in `scripts/agora.mjs`.
- Created `scripts/agora/finalize-utils.mjs`.
- Moved pure finalize tree helpers from `scripts/agora.mjs`: hidden-issue
  filtering, issue-number child sorting, subtree depth collection, and visible
  child projection. Paperclip reads, dry-run/write behavior, comments/status
  updates, and terminal output remain in `scripts/agora.mjs`.
- Extended `scripts/agora/natural-utils.mjs`.
- Moved the pure natural rewrite payload builder from `scripts/agora.mjs`.
  Dry-run printing, JSON output, planned-command execution, state reads/writes,
  slot extraction, and cost-log persistence remain in `scripts/agora.mjs`.
- Extended `scripts/agora/text-utils.mjs`.
- Moved the pure Paperclip issue title cleanup helper (`cleanTitle`) from
  `scripts/agora.mjs`. Session, follow-up, and dialogue issue creation remain
  in `scripts/agora.mjs`.
- Created `scripts/agora/issue-query-utils.mjs`.
- Moved Paperclip read-side issue query helpers from `scripts/agora.mjs`:
  latest synthesis lookup, root issue selection, and top-root traversal through
  an injected `api` dependency. Command flow, terminal output, state updates,
  and all Paperclip write paths remain in `scripts/agora.mjs`.
- Added `tests/test_agora_adapter_utils.py`.
- Added `tests/test_agora_start_utils.py`.
- Added `tests/test_agora_cli_parse_utils.py`.
- Added `tests/test_agora_state_output_utils.py`.
- Added `tests/test_agora_role_output_utils.py`.
- Added `tests/test_agora_finalize_utils.py`.
- Added `tests/test_agora_issue_query_utils.py`.
- These are Pass C slices, not the full completion of the runtime split.

- [ ] **Step 1: Split only one responsibility at a time**

Start with the lowest-risk extraction: a Paperclip client module or pure formatting helpers. Do not split wizard, router, Telegram UX, and Paperclip API in the same patch.

- [ ] **Step 2: Keep CLI behavior stable**

For each extraction, run the existing focused tests that cover the moved behavior before moving to the next extraction.

- [ ] **Step 3: Verify both compatibility modes where relevant**

Run:

```bash
python3 -m unittest tests.test_inner_agora_ask_flow tests.test_phase4_intent_slots -v
node scripts/regression.mjs check
node scripts/phase1-soak-check.mjs --json
```

Expected:

- focused tests pass;
- regression passes on the chamber role path;
- readiness check is green.

## Task 5: Telegram Helper Module Split

**Files:**
- Modify: `scripts/paperclip-cockpit-telegram.mjs`
- Create later: focused modules for payloads, QA artifact reads, stop cleanup, and Telegram sending
- Test: Telegram payload/helper/callback tests

Progress 2026-07-05:

- Created `scripts/telegram/payload-utils.mjs`.
- Moved deterministic issue/button helpers from `scripts/paperclip-cockpit-telegram.mjs`:
  issue refs, issue sorting, synthesis/status checks, child traversal, voice
  labels, callback data, and two-column inline keyboard row construction.
- Added `tests/test_telegram_payload_utils.py`.
- Created `scripts/telegram/qa-artifacts.mjs`.
- Moved local QA artifact readers and status helpers: artifact path resolution,
  latest manifest selection, `bugs.jsonl` reading, pass/fail counting, QA status
  word, and cleanup word.
- Added `tests/test_telegram_qa_artifacts.py`.
- Created `scripts/telegram/sender.mjs`.
- Moved Telegram message chunking and send mechanics behind injected
  `telegramChat`/`telegramApi` dependencies.
- Added `tests/test_telegram_sender.py`.
- Created `scripts/telegram/stop-cleanup.mjs`.
- Moved Paperclip stop-cleanup mechanics behind an injected `api`: live-run
  lookup, active-run cancellation, issue cancellation/hiding, target selection,
  and partial failure reporting.
- Added `tests/test_telegram_stop_cleanup.py`.
- These are internal module splits only; they do not change first-level Telegram
  UX, callback payloads, live behavior, or config labels.

- [x] **Step 1: Extract pure payload builders first**

Move formatting code that does not call Telegram or Paperclip before moving code
with side effects.

- [x] **Step 2: Keep side-effectful flows explicit**

Stop cleanup, Bot API send, and QA live commands must remain visibly separate.
Do not introduce implicit live operations.

- [x] **Step 3: Verify**

Run:

```bash
python3 -m unittest tests.test_paperclip_cockpit_telegram_helper tests.test_paperclip_cockpit_telegram_callbacks -v
node --check scripts/paperclip-cockpit-telegram.mjs
git diff --check
```

Expected:

- payload and callback tests pass;
- syntax check exits 0;
- diff check exits 0.

## Task 6: Plugin And Pack Promotion

**Files:**
- Modify later: `hermes-plugins/paperclip-cockpit/README.md`
- Modify later: docs under `docs/roadmap/`
- Optional later create: repo-local package docs for chamber packs

Progress 2026-07-05:

- Created `docs/roadmap/PLUGIN_BOUNDARIES.md`.
- Documented which pieces are reusable now (`paperclip-cockpit`, `qa-tool`,
  `telegram-paperclip-qa`) and which remain local/internal packs
  (`agora-config-source`, `agora-chamber-pack`, `agora-core-runtime`,
  `agora-telegram-payloads`).
- Found a real plugin-boundary leak: `paperclip-cockpit/__init__.py` still
  contained Agora/философ launch-copy literals. Moved launch-summary markers,
  labels, callbacks, and role-list flag into `telegram.launch_summary` config
  and migrated pending-question state from `philosopher(s)` keys to generic
  `role(s)` keys.
- No install, publish, profile copy, or live command was run.

- [x] **Step 1: Promote only proven boundaries**

Keep these as distinct packages:

- `paperclip-cockpit`: Hermes runtime plugin;
- `paperclip-cockpit/qa-tool`: project-neutral QA runtime;
- `telegram-paperclip-qa`: Codex workflow plugin;
- `agora-chamber-pack`: future content/config pack, not a runtime plugin at first.

- [x] **Step 2: Do not install or publish without approval**

Any install/publish step is outside cleanup and requires explicit user approval.

- [ ] **Step 3: Verify packaging docs**

Run:

```bash
python3 -m unittest tests.test_telegram_qa_tool -v
node -e 'JSON.parse(require("fs").readFileSync("hermes-plugins/paperclip-cockpit/codex-plugin/telegram-paperclip-qa/.codex-plugin/plugin.json", "utf8")); console.log("plugin json ok")'
git diff --check
```

Expected:

- QA tool tests pass;
- plugin manifest parses;
- diff check exits 0.

## Task 7: Approved Live Acceptance And Recovery

Progress 2026-07-05:

- Operator approval to touch the live system was granted after the initial
  cleanup/doc passes.
- Ran `help` live suite: first run exposed a transient missing-buttons failure;
  focused retest passed, and the full `help` suite later passed 4/4 with hard
  cleanup.
- Ran `service-commands` live suite: `QA-20260705-2040-service-commands-ca0477`
  passed 5/5 with hard cleanup and no residual artifacts.
- Ran `mode-routing` live suite: first run split into two root causes.
  Default route failed because live Paperclip agents were in `error`; pair route
  failed because exact pair wording was treated as vague confirmation.
- Before Paperclip recovery, wrote read-only backup
  `backups/2026-07-05T20-48-53-793Z-the-inner-agora/backup.json`.
- Ran `node scripts/agora.mjs prepare local`; fresh guard returned `ok=true`
  with `agents.errorAgents=[]`.
- Fixed pair routing locally so exact pair/two-voice wording launches
  `/agora ask ...`, while vague `несколько философов` still confirms.
- Full live `mode-routing` suite `QA-20260705-2054-mode-routing-234c17` passed
  4/4 with hard cleanup and no residual artifacts.
- A fresh guard after that accepted suite was red because `Аристотель` moved to
  `error`; a second backup
  `backups/2026-07-05T20-59-59-701Z-the-inner-agora/backup.json` plus
  `prepare local` restored guard to `ok=true`. Cleanup artifact success is not
  enough; work-creating suites need a post-suite guard/repair gate.
- Observed separate Telegram launch-summary leakage in accepted live replies:
  route/model, local URL, child issue rows, and `wake=queued` ids. This remains
  `BUG-2026-07-04-004` and must be fixed in a focused Telegram UX slice.
- Fixed that focused Telegram UX slice: selected-mode natural launches now pass
  successful raw ask stdout through the same clean `telegram.launch_summary`
  renderer used by launch callbacks. The live profile plugin was synced with
  `scripts/setup-hermes-profile.mjs`, `inneragora gateway restart` loaded it,
  and strengthened live run `QA-20260705-2106-mode-routing-475f2b` passed 4/4
  while forbidding route/model, local URL, `Открыть:`, `wake=queued`, and raw
  child `Голоса:` rows. Post-suite guard returned `ok=true`.
- Ran the remaining release suites after the clean-summary fix:
  `QA-20260705-2111-natural-dialogue-053534` passed 3/3,
  `QA-20260705-2116-interface-contract-topics-3de3a6` passed 4/4, and
  `QA-20260705-2123-council-create-adfe3b` passed 3/3.
- The `interface-contract-topics` suite exposed stale QA expectations: it
  expected the old "Я понял тему" flow while live behavior correctly launched a
  clean summary. The contract now accepts the clean launch summary instead.
- The first `council-create` run exposed a launch-summary parser gap: `--mode`
  was not classified as a value flag, so `--mode min` could leak into
  `Вопрос:`. Added `--mode` to `telegram.launch_summary.value_flags`,
  regenerated `paperclip-cockpit.json`, and covered it with a regression test.
- Work-creating suites still need an explicit post-suite guard step. Latest
  live recovery backup before commit:
  `backups/2026-07-05T21-31-39-714Z-the-inner-agora/backup.json`; final guard
  returned `ok=true` and stayed green on a 15-second repeat check.

## Completion Checklist

- [x] Current status doc exists and is linked from roadmap README.
- [x] Plugin candidates are classified as existing, extract later, or do not extract yet.
- [x] Live/Paperclip/Telegram gates are explicit.
- [x] Phase 1 legacy role runtime removal is handled as its own T1.6 slice.
- [x] Approved live backup/recovery was run before live Paperclip repair.
- [x] `help`, `service-commands`, `mode-routing`, `natural-dialogue`,
  `interface-contract-topics`, and `council-create` live QA suites have
  accepted runs.
- [x] Post-suite guard was rerun and live agent health was restored with
  `prepare local`.
- [x] Each later cleanup pass has acceptance criteria.
- [x] Non-live verification passes before claiming completion of any pass.
- [x] Telegram launch-summary leakage is fixed and live-retested.
- [ ] Work-creating live QA suites include an explicit post-suite agent-health
  gate or documented repair step.
