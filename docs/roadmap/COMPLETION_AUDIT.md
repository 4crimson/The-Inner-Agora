# Completion Audit: Roadmap Realization

Date: 2026-07-05
Scope: `/Users/admin/Documents/The Inner Agora`

This document is the current completion audit for the active goal: implement
`docs/roadmap/README.md`. It is intentionally stricter than a status note:
roadmap completion is not treated as true until every requirement has direct
current-state evidence.

## Verdict

The roadmap is substantially implemented locally, but the full goal is not
complete yet.

The main blockers are not lack of random cleanup. They are specific acceptance
gates:

- live Telegram acceptance is only partially proven;
- Phase 9 is partial: local token ledger and pricing exist, but Paperclip agent
  usage and monetary preflight are not covered;
- `scripts/agora.mjs` is still a large runtime file, so Pass C is not finished;
- plugin/pack boundaries are documented, but install/publish/profile promotion
  has intentionally not been run without operator approval.

## Evidence Rules

Completion evidence must be one of:

- current file state;
- current command output from non-live local checks;
- live QA evidence explicitly gathered after operator approval;
- a documented gate that explains why work must not proceed yet.

A green unit test is useful evidence for local behavior. It is not, by itself,
evidence that Telegram live UX is accepted.

## Requirement Matrix

| Requirement area | Current evidence | Audit status | Remaining acceptance |
| --- | --- | --- | --- |
| Roadmap entrypoint and status navigation | `README.md`, `CURRENT_STATUS.md`, `PLUGIN_BOUNDARIES.md`, this audit | Local docs current | Keep this audit updated after each slice |
| Phase 0 regression baseline | `scripts/regression.mjs`, baseline fixtures, current readiness check runs regression on the chamber role path | Locally proven | Keep running before behavior-changing slices |
| QW-1 typo handling | `ask-unknown-philosopher-dry-run` in regression baseline, role search helpers | Locally proven | None for local scope |
| QW-2 self-heal / guard direction | `scripts/inner-agora-guard.mjs`, monitor/guard tests and Phase 8 notes | Locally implemented | Live reliability still belongs to live acceptance, not cleanup |
| QW-3 onboarding / compact Telegram entry | Telegram command boundary, `/start` aliases, compact home/help callbacks | Locally implemented | Live retest still pending for full service command surface |
| QW-4 Paperclip backup before migrations | `scripts/backup-company.mjs`, `.gitignore` `backups/`, `tests/test_backup_company.py`, live backup `backups/2026-07-05T20-48-53-793Z-the-inner-agora/backup.json` | Locally implemented and used before approved live recovery | Keep backup-before-repair discipline for future live migrations |
| Phase 1 role schema and migration | `data/schema/role.schema.json`, `scripts/migrate-roles.mjs`, `chambers/philosophy/roles.json`, importer/CLI chamber role source, readiness check `migration` ok | Locally complete | Keep migration check as a drift guard while `data/philosophers.json` remains the source for generated chamber roles |
| Phase 2 chambers / packs | `data/schema/chamber.schema.json`, `scripts/chamber-loader.mjs`, philosophy and board-directors chambers | Locally implemented | Board role content quality T2.6b is not proven by voice tests |
| Phase 3 skills layer | `data/schema/skill.schema.json`, `scripts/skill-loader.mjs`, `skills/*/skill.json`, skill tests | Locally implemented | Do not promote as public skill/plugin layer without a separate gate |
| Phase 4 human assistant | `data/schema/intent-slots.schema.json`, `scripts/intent-slots.mjs`, wizard/follow-up tests | Locally implemented | Live profile/router drift can still break the intended UX |
| Phase 5 model routing | `models.config.json`, `scripts/model-routing.mjs`, routing tests | Locally implemented | Cloud/provider route is not part of this phase |
| Phase 6 per-chat state | `scripts/state-manager.mjs`, `data/schema/state.schema.json`, per-chat tests | Locally implemented | Live Telegram must prove chat id propagation in actual gateway |
| Phase 7 chamber safety | `scripts/policy-loader.mjs`, chamber risk/status fields, high-stakes disclaimer skill, selected voice ancestry pre-ask guard | Locally implemented | Live replay of a red hierarchy remains optional evidence; local guard coverage now blocks writes before ask creation |
| Phase 8 Telegram UX | Compact callbacks, mode selector, payload helpers, QA surfaces, `BUGS.md` fixes, live QA runs | Live-proven for release suites | `help`, `service-commands`, `mode-routing`, `natural-dialogue`, `interface-contract-topics`, and `council-create` are accepted; post-suite agent-health drift and UX leak/intent portions of BUG-2026-07-03-001 remain open |
| Phase 9 observability/cost | `scripts/agora/cost-utils.mjs`, `costs.config.json`, `/agora costs`, all-mode volume preflight | Partial | Paperclip agent usage, unknown pricing, and monetary preflight remain open |
| Config source split | `config/cockpit/*.json`, build/check tooling, matching runtime sha | Locally proven | Humans should edit fragments, runtime keeps `paperclip-cockpit.json` |
| Generic plugin boundary | `paperclip-cockpit` no longer owns Agora launch copy; `PLUGIN_BOUNDARIES.md` defines gates | Locally improved | No install/publish/profile copy without explicit approval |
| Agora runtime cleanup | `scripts/agora/*.mjs` contains many extracted pure/helper modules | Partial | `scripts/agora.mjs` is still a large runtime file and not a thin dispatcher |
| Telegram helper cleanup | `scripts/telegram/*.mjs` extracted payload, QA artifact, send, stop cleanup helpers | Locally started | Future UX/copy changes need focused contract tests |

Latest local Pass C slice: `scripts/agora/cli-parse-utils.mjs` now owns pure
CLI argument parsing for ask, council, follow-up, role-proposal, tasks, and
full-output flags. `scripts/agora.mjs` still owns default mode resolution, help
output, role selection, command execution, Paperclip API calls, and terminal
printing, so the roadmap remains partial rather than complete.
Next local Pass C slice: `scripts/agora/state-output-utils.mjs` now owns pure
state patch and CLI line formatting for remembered issues, decorated token cost
entries, compact cost summaries, active chamber readout, and mode readout.
`scripts/agora.mjs` still owns state reads/writes, adapter/chamber selection,
Paperclip API calls, command dispatch, and printing side effects.
Previous local Pass C slice: `scripts/agora/role-output-utils.mjs` now owns pure
role/skill presentation payloads and line rendering for role search, role
proposal, and `skills` readouts. `scripts/agora.mjs` still owns roster loading,
role selection, skill resolution, active chamber state, JSON output, and
terminal printing.
Previous local Pass C slice: `scripts/agora/finalize-utils.mjs` now owns pure
finalize tree traversal and visible child sorting. `scripts/agora.mjs` still
owns Paperclip issue reads, dry-run/write behavior, auto-close comments/status
updates, and terminal output, so roadmap completion remains blocked on the
larger runtime split and live/readiness gates.
Previous local Pass C slice: `scripts/agora/natural-utils.mjs` now also owns the
pure natural command rewrite payload builder. `scripts/agora.mjs` still owns
dry-run printing, JSON output, planned-command execution, state reads/writes,
slot extraction, and cost-log persistence.
Previous local Pass C slice: `scripts/agora/text-utils.mjs` now also owns the
pure Paperclip issue title cleanup helper (`cleanTitle`). `scripts/agora.mjs`
still owns session, follow-up, and dialogue issue creation, so this is another
module-boundary cleanup, not a behavior or Paperclip write-path change.
Latest local Pass C slice: `scripts/agora/issue-query-utils.mjs` now owns
Paperclip read-side issue resolution for latest synthesis lookup, root session
selection, and top-root traversal through an injected `api` dependency.
`scripts/agora.mjs` still owns command flow, terminal output, state updates, and
all Paperclip write paths.

## Definition Of Ideal Check

| Roadmap ideal | Current result |
| --- | --- |
| New chamber by config without editing `agora.mjs` | Mostly true for current board-directors chamber; some selection/runtime policy still passes through `agora.mjs`, so do not call the core fully pluginized yet |
| New user can start in Telegram without README | Locally implemented with compact menus and `/start` aliases; `help`, `natural-dialogue`, `interface-contract-topics`, and `council-create` have accepted live runs |
| Maximum one clarification question, no silent incomplete session | Locally implemented through slot/wizard planning and pending question flow; accepted live suites now cover natural dialogue and interface-topic launches |
| Follow-up after synthesis stays in session context | Locally implemented via follow-up and dialogue-context paths; live gateway state propagation remains a future focused proof |
| No hardcoded absolute path or duplicated en/ru dictionary outside manifest/config | Runtime config no longer shows `/Users/admin` paths; generic plugin is cleaner, but Agora-facing philosopher labels remain intentionally product config |
| Regression runs before release | Harness exists and current non-live checks pass; release discipline must keep using it |
| Per-chat state isolation | Locally implemented; live Telegram must still prove actual chat id propagation |

## Live Acceptance Backlog

`docs/roadmap/BUGS.md` is still authoritative for live acceptance failures.
Current audit blockers:

- `BUG-2026-07-03-001` is open: raw service tokens, internal reasoning fallback,
  wrong operational persona, and mode/status continuation were observed in live
  Telegram. The Paperclip hierarchy repair path was recovered on 2026-07-05,
  and local selected-voice ancestry guard coverage was added on 2026-07-06:
  red `reportsTo` ancestry now blocks `ask` before any Paperclip issue write.
  Local operational-intent routing was also added on 2026-07-06:
  `проверить что вышло` and `давай acceptance` route to `/agora latest`, while
  `финал проверяем` routes to `/agora result`. Live replay of these slices was
  not run here.
- `BUG-2026-07-03-002`, `BUG-2026-07-03-003`, and `BUG-2026-07-04-004` have
  live accepted suites on 2026-07-05: `help`, `service-commands`,
  strengthened `mode-routing`, `natural-dialogue`, `interface-contract-topics`,
  and `council-create`.
- Accepted work-creating live suites can still leave Paperclip agents in
  `error` after issue cleanup. 2026-07-05 `mode-routing`,
  `interface-contract-topics`, and `council-create` required backup plus
  `prepare local` before guard returned to `ok=true`. First local
  post-suite-health slice is now implemented: work-creating `paperclip-qa run`
  writes `guardBefore`/`guardAfter`, blocks live side effects on red before
  guard, and rejects clean acceptance on red after guard. The follow-up local
  slice adds `paperclip-qa guard-repeat`: after manual repair and backup it
  writes `repairBackup`, `repairCommand`, and `guardRepeat`, making acceptance
  `accept-with-repair` and release-gate `accepted_with_repair` instead of a
  clean pass. `paperclip-qa release-live-gate` now writes the top-level
  non-live evidence wrapper around profile sync, run ids, backup id,
  release-gate, and evidence-checklist. Live suite execution, backup
  orchestration, and any auto-repair policy remain open.
- 2026-07-06 profile/plugin sync preflight is now locally implemented and was
  exercised against the live `inneragora` profile. It first blocked on stale
  plugin digest, then `scripts/setup-hermes-profile.mjs` plus gateway restart
  restored `profilePluginSync=ok`. A follow-up backup
  `backups/2026-07-05T22-25-55-730Z-the-inner-agora/backup.json` plus
  `prepare local` restored guard to `ok=true`, and a 15-second repeat guard
  stayed green.
- A related Paperclip lifecycle race was observed in run
  `20b5a4ed-9021-4830-9654-718e2c10534b`: `hard cleanup` deleted the issue
  before `workspace_finalize` wrote its `workspace_operations` row, causing a
  `workspace_operations_issue_id_issues_id_fk` failure and an `adapter_failed`
  surface even though Hermes exited successfully. Cleanup must become
  active-run-safe before it can be treated as release evidence. Local cleanup
  lifecycle protection is now present: `paperclip-qa cleanup hard` cancels
  active heartbeat runs, waits for terminal state before delete, records
  `activeRunsBeforeCleanup` and `cancelledRuns`, and blocks delete if runs stay
  active.
- Quick/deep and council live inbound verification through the actual Telegram
  gateway now have accepted release-suite evidence; future work should focus on
  making the repair/repeat part of the post-suite guard explicit and less
  manual.
- Project-action error UX now handles terminated-ancestor 409,
  command-not-found, subprocess timeout, and provider timeout/error formatting
  locally. Raw stderr/JSON stays out of first-level output unless raw/debug
  presentation is explicitly enabled. Live replay remains part of the release
  lane, not this local contract slice.
- First-level Telegram leak expectations now use the shared
  `noTechnicalFirstLevelLeak` QA macro. It covers route/model/local URL/open
  link/wake/raw child rows/CLI flags and is classified as `telegram-ui`/`P1`
  when it fails. Live replay remains part of the normal release lane, not this
  local contract slice.

Operator approval to touch the live system was granted on 2026-07-05. Live
retests still remain a separate workstream with their own QA commands and
evidence; they should not be mixed into cleanup or T1.6 removal commits.

## Next Safe Work Order

1. Finish the release live gate first: keep the non-live evidence wrapper, then
   add explicit live execution/backup orchestration only behind `--live-ok` and
   operator confirmation.
2. Continue Pass C as behavior-preserving `agora.mjs` module extraction only
   after the release lane no longer needs manual post-suite investigation.
3. Extend Phase 9 only where usage data is actually available; keep unknown
   pricing unknown.
