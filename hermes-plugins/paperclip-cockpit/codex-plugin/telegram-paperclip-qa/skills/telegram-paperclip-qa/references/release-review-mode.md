# Release Review Mode

Use release-review mode for final acceptance.

Workflow:

1. Confirm the intended acceptance suite.
2. Run `release-plan --config telegram-testing.config.json --cleanup hard --json`, then `profile-plugin-sync --config telegram-testing.config.json --json` and any extra diagnostic config, health, readiness, or dry-run checks needed to explain failures.
3. Ask for explicit live confirmation using the readiness/live-plan acknowledgement.
4. Run `release-live-gate --config telegram-testing.config.json --suite SUITE --commit COMMIT --live-ok --json` to create the backup, run one suite, cleanup, guards, acceptance artifacts, release-gate, and evidence-checklist in one controlled lane.
5. For older manifests, run cleanup through the live run/retest command, or use standalone `cleanup --live-ok`.
6. Generate report, summary, bug output, and acceptance output for any run that was not produced by `release-live-gate --live-ok`.
7. If post-suite guard was red and a manual repair was performed, run `guard-repeat --config telegram-testing.config.json --run RUN_ID --backup-id BACKUP_ID --repair-command "REPAIR COMMAND" --json`, then regenerate acceptance for that run.
8. For already-existing run evidence, run `release-live-gate --config telegram-testing.config.json --suite SUITE --run RUN_ID --backup-id BACKUP_ID --profile-plugin-sync ok --commit COMMIT --json` to write the top-level release evidence wrapper without live side effects.
9. If lower-level artifacts are needed separately, run `release-gate --config telegram-testing.config.json --run RUN_ID --backup-id BACKUP_ID --profile-plugin-sync ok --json` and `evidence-checklist --config telegram-testing.config.json --release-gate RELEASE_GATE_JSON --commit COMMIT --json`.
10. Use `release-live-gate.json`, `RELEASE_LIVE_GATE.md`, `release-gate.json`, `RELEASE_GATE.md`, and `EVIDENCE_CHECKLIST.md` as the release decision and documentation source.
11. Run `completion-check --config telegram-testing.config.json --json` and compare the result with `docs/telegram-testing/TELEGRAM_QA_COMPLETION_CHECKLIST.json`.
12. Decide `accepted`, `accepted_with_repair`, or `blocked`.

Acceptance gates:

- Local-model route is visible where expected.
- Telegram output is readable and has useful buttons.
- Paperclip issue trees are valid and recoverable.
- Synthesis completes and can navigate to individual voices.
- Cleanup leaves no unreported test artifacts.
- Backup id, profile/plugin sync status, run ids, cleanup status, post-suite guard status, repair status, and commit hashes are present in the release-gate/evidence-checklist artifacts.
- Any remaining bug has severity, area, evidence, and retest criteria.
