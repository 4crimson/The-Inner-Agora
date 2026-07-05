# Release Review Mode

Use release-review mode for final acceptance.

Workflow:

1. Confirm the intended acceptance suite.
2. Run `release-plan --config telegram-testing.config.json --cleanup hard --json`, then `profile-plugin-sync --config telegram-testing.config.json --json` and any extra diagnostic config, health, readiness, or dry-run checks needed to explain failures.
3. Ask for explicit live confirmation using the readiness/live-plan acknowledgement.
4. Run the full suite.
5. Run cleanup through the live run/retest command, or use standalone `cleanup --live-ok` for an existing manifest.
6. Generate report, summary, bug output, and acceptance output for each run.
7. Run `release-gate --config telegram-testing.config.json --run RUN_ID --backup-id BACKUP_ID --profile-plugin-sync ok --json` after backup id is known and `profile-plugin-sync` returned `ok`.
8. Use `release-gate.json` and `RELEASE_GATE.md` as the release decision source.
9. Run `completion-check --config telegram-testing.config.json --json` and compare the result with `docs/telegram-testing/TELEGRAM_QA_COMPLETION_CHECKLIST.json`.
10. Decide `accepted`, `accepted_with_repair`, or `blocked`.

Acceptance gates:

- Local-model route is visible where expected.
- Telegram output is readable and has useful buttons.
- Paperclip issue trees are valid and recoverable.
- Synthesis completes and can navigate to individual voices.
- Cleanup leaves no unreported test artifacts.
- Backup id, profile/plugin sync status, run ids, cleanup status, and post-suite guard status are present in the release-gate artifact.
- Any remaining bug has severity, area, evidence, and retest criteria.
