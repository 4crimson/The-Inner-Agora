# Developer Mode

Use developer mode only after tester mode produces accepted bugs.

Workflow:

1. Read the grouped `bug-batch` summary.
2. Select one `--area` bug batch only.
3. Restate root cause hypotheses before patching.
4. Write or update tests that fail for the accepted bug.
5. Patch the smallest area that owns the root cause.
6. Run local verification.
7. Update docs when behavior, commands, or workflow changes.
8. Hand the fixed test ids to retest mode.

Boundaries:

- Router fixes do not include Telegram UI polish.
- Telegram UI fixes do not include Paperclip hierarchy recovery.
- Cleanup fixes do not include synthesis formatting.
- Green unit tests do not prove live UX acceptance.
