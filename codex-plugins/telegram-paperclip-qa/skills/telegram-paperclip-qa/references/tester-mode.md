# Tester Mode

Use tester mode to collect evidence. Do not patch code.

Workflow:

1. State the target suite and whether live side effects are allowed.
2. Run `readiness --suite SUITE --json` first. Inspect `readyForLive`, `health`, `preview`, and `livePlan`.
3. If live testing is needed, ask for explicit confirmation using the readiness/live-plan acknowledgement before sending Telegram messages.
4. Run the selected suite.
5. Preserve the run id, manifest path, report path, and bugs path.
6. Run `bug-batch --run RUN_ID` to group failures by area and severity.
7. Use `bug-batch --run RUN_ID --area AREA` for one-area developer handoff.
8. Stop after evidence and bug candidates. Hand accepted bugs to developer mode.

Acceptance:

- Every observed failure has a test id.
- Every live artifact is in the manifest.
- Cleanup residuals are visible.
- Raw provider tokens, stack traces, or command errors in Telegram are product bugs.
