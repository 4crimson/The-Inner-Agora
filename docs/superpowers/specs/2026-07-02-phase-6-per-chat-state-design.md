# Phase 6 Per-Chat State Design

Phase 6 replaces one shared Agora state file with per-chat state and a small profile memory layer. The goal is that two Telegram chats using the same Hermes profile do not see each other's `lastIssueRef`, wizard state, mode, chamber, or follow-up context.

## Scope

Phase 6 covers:

- a versioned state schema at `data/schema/state.schema.json`;
- a state resolver module used by `scripts/agora.mjs`;
- automatic migration from legacy `.inner-agora-state.json` into `state/default.json`;
- `INNER_AGORA_CHAT_ID` propagation from the Hermes Paperclip cockpit plugin into project actions and natural-language delegates;
- profile memory at `memory/profiles/<chat-id>.json` for preferred chamber and mode;
- schema migration when older or unversioned state is read.

Phase 6 does not add multi-user authorization, Telegram UI buttons, cost tracking, or a database. Those remain later phases.

## State Paths

`scripts/state-manager.mjs` owns all state and profile paths.

Inputs:

- `INNER_AGORA_STATE_PATH`: explicit legacy/test override. If set, read and write exactly this file.
- `STATE_MODE=single-file`: legacy mode. Uses `.inner-agora-state.json` unless `INNER_AGORA_STATE_PATH` is set.
- `STATE_MODE=per-chat`: per-chat mode.
- default mode: `per-chat` when `INNER_AGORA_CHAT_ID` is set, otherwise `single-file` for direct CLI compatibility.
- `INNER_AGORA_CHAT_ID`: chat/user key passed by Hermes. Sanitized to lowercase `[a-z0-9._-]`; unsafe or empty values become `default`.
- `INNER_AGORA_STATE_DIR`: optional directory override for tests; default `state/`.

Per-chat state path:

```text
state/<sanitized-chat-id>.json
```

Legacy migration:

- if per-chat mode is active;
- target state file does not exist;
- legacy `.inner-agora-state.json` exists;
- then copy and migrate the legacy file into the per-chat target.

For a real Telegram chat, the first message from that chat gets a migrated copy. For CLI with no chat id, legacy behavior remains stable until `STATE_MODE=per-chat` is explicitly set.

## State Schema

State files use:

```json
{
  "schemaVersion": 1,
  "chatId": "test-chat",
  "updatedAt": "2026-07-02T00:00:00.000Z",
  "mode": "local",
  "activeChamberId": "philosophy",
  "lastIssueRef": "THE-900",
  "lastRootIssueRef": "THE-900",
  "lastSynthesisRef": "THE-999",
  "wizard": null,
  "lastAdapterName": "hermes_local"
}
```

Unknown keys are preserved. Migration from unversioned state adds `schemaVersion: 1` and `chatId`.

## Profile Memory

Profile files live at:

```text
memory/profiles/<sanitized-chat-id>.json
```

Schema is intentionally small in Phase 6:

```json
{
  "schemaVersion": 1,
  "chatId": "test-chat",
  "preferredMode": "local",
  "preferredChamberId": "philosophy",
  "recentRoles": ["plato", "socrates"],
  "updatedAt": "2026-07-02T00:00:00.000Z"
}
```

Agora updates the profile when:

- `mode set` or equivalent saves a mode;
- `chamber use` saves an active chamber;
- `ask` creates a session and records the selected mode, chamber, and explicit voices.

Default selection reads profile before global config:

1. explicit env/CLI mode;
2. per-chat state mode;
3. per-chat profile preferred mode;
4. cockpit default mode.

Active chamber selection follows the same pattern:

1. `INNER_AGORA_ACTIVE_CHAMBER`;
2. per-chat state `activeChamberId`;
3. per-chat profile `preferredChamberId`;
4. default chamber.

## Hermes Plugin Propagation

`hermes-plugins/paperclip-cockpit/__init__.py` already receives `chat_id` in Telegram gateway and callback hooks. Phase 6 adds a tiny execution context:

- `_run_action(..., chat_id=None)` passes `INNER_AGORA_CHAT_ID=<chat_id>` to subprocess env;
- `_rewrite_delegate(..., chat_id=None)` passes the same env to natural-language delegate subprocesses;
- callback actions pass their `chat_id` into `_run_action`;
- `pre_gateway_dispatch` derives chat id from `event.source.chat_id` and passes it into rewrite/delegate.

No Telegram API behavior changes in this phase.

## User-Visible Behavior

- `node scripts/agora.mjs mode get` prints the resolved state file path.
- In Telegram, two different chats can each run natural requests and retain independent last session, wizard, mode, and chamber.
- Direct local CLI keeps working with `.inner-agora-state.json` unless `INNER_AGORA_CHAT_ID` or `STATE_MODE=per-chat` is set.
- Legacy state is copied, not deleted.

## Tests

Acceptance tests:

- state schema exists and requires `schemaVersion`;
- unversioned legacy state migrates to schema v1;
- `STATE_MODE=per-chat INNER_AGORA_CHAT_ID=chat-a` writes `state/chat-a.json`;
- two chat IDs do not share `lastIssueRef`;
- Hermes natural delegate and callback action pass `INNER_AGORA_CHAT_ID`;
- profile preferred mode is used when no explicit mode/state mode exists;
- existing single-file tests remain green with `INNER_AGORA_STATE_PATH`.

Verification gate:

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
node scripts/regression.mjs check
CHAMBER_MODE=chambers node scripts/regression.mjs check
STATE_MODE=per-chat INNER_AGORA_CHAT_ID=test-chat node scripts/agora.mjs mode get
```
