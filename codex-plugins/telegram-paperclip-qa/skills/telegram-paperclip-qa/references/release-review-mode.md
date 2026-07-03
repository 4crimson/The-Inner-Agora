# Release Review Mode

Use release-review mode for final acceptance.

Workflow:

1. Confirm the intended acceptance suite.
2. Run `live-plan`, config, health, and dry-run checks.
3. Ask for explicit live confirmation using the live-plan acknowledgement.
4. Run the full suite.
5. Run cleanup.
6. Generate report, bug output, and acceptance output.
7. Use `acceptance --run RUN_ID --json` and `ACCEPTANCE.md` as the decision source.
8. Decide accept, accept-with-known-issues, or reject.

Acceptance gates:

- Local-model route is visible where expected.
- Telegram output is readable and has useful buttons.
- Paperclip issue trees are valid and recoverable.
- Synthesis completes and can navigate to individual voices.
- Cleanup leaves no unreported test artifacts.
- Any remaining bug has severity, area, evidence, and retest criteria.
