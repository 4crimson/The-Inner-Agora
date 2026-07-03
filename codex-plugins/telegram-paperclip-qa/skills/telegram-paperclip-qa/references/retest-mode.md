# Retest Mode

Use retest mode to verify previously failed test ids.

Workflow:

1. Read the previous manifest and bug batch.
2. Select only the failed test ids unless the user asks for a broader run.
3. Run a dry-run preview.
4. Ask for live confirmation before Telegram/Paperclip side effects.
5. Rerun the selected tests.
6. Compare old and new results.
7. Mark each bug `fixed`, `still-failing`, or `changed`.

Acceptance:

- A bug is fixed only when its original failing test id passes.
- A changed failure becomes a new or updated bug with fresh evidence.
- Cleanup runs after live retests and residuals are reported.
