# Developer Mode

Use developer mode only after tester mode produces accepted bugs.

Workflow:

1. Select one bug batch and one area only.
2. Restate root cause hypotheses before patching.
3. Write or update tests that fail for the accepted bug.
4. Patch the smallest area that owns the root cause.
5. Run local verification.
6. Update docs when behavior, commands, or workflow changes.
7. Hand the fixed test ids to retest mode.

Boundaries:

- Router fixes do not include Telegram UI polish.
- Telegram UI fixes do not include Paperclip hierarchy recovery.
- Cleanup fixes do not include synthesis formatting.
- Green unit tests do not prove live UX acceptance.
