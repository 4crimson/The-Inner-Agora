# Phase 4 Human Assistant Design

## Goal

Build a Telegram-facing Hermes/Paperclip assistant that accepts normal human language, extracts a small set of safe slots with a local model, asks at most one useful clarification, then deterministically routes the request into Agora commands, follow-ups, dialogue, status, or result views.

The assistant must feel conversational, but the model must not directly write to Paperclip or create Agora work. The model only proposes slots; code validates, normalizes, filters, and executes.

## T4.0 Local Model Spike

Date: 2026-07-02.

Endpoint: `http://127.0.0.1:1234/v1/chat/completions`.

Models tested:

- `google/gemma-4-26b-a4b-qat`: failed as an extractor in this API shape. It produced `reasoning_content`, and reasoning tokens consumed the completion budget. With `max_tokens=500`, only 3 of 20 responses had complete parseable JSON. API parameters `reasoning: { effort: "none" }`, `reasoning: false`, and `think: false` did not disable reasoning in LM Studio.
- `gemma-4-26b-a4b-it-mlx`: passed the same 20 Telegram-like phrases with no reasoning tokens.

Primary T4.0 result:

| Metric | Result |
| --- | ---: |
| Total phrases | 20 |
| Valid JSON | 20 / 20 |
| Semantically correct | 20 / 20 |
| Average latency | 1392 ms |
| P95 latency | 3257 ms |
| Reasoning tokens | 0 |

Decision: use a local extractor path with `gemma-4-26b-a4b-it-mlx`, strict schema validation, and regex fallback. Do not use the reasoning `google/gemma-4-26b-a4b-qat` model for extraction unless the runtime can actually disable reasoning or raise the completion budget enough to avoid truncation.

## Scope

Phase 4 covers:

- Natural Telegram requests for new Agora sessions.
- Natural status/result/task lookup requests.
- Role detail requests such as "а что сказал Платон?"
- One-step clarification for missing critical slots.
- Wizard reuse of the same planner.
- Follow-up requests bound to the last known root session.
- Human-readable output and consistent action buttons after summaries and role views.

Phase 4 does not cover:

- Cloud extraction.
- Letting the LLM call Paperclip or write issues directly.
- A new chamber-specific plugin. The plugin integration stays generic.
- Full redesign of Agora synthesis content. Formatting is improved at the delivery layer.

## Slot Contract

The extractor returns this generic, chamber-neutral shape:

```json
{
  "intent": "new_session",
  "chamber": "philosophy",
  "mode": "balanced",
  "topic": "свобода ребенка и власть родителей",
  "roles": ["Платон"],
  "taskRef": null,
  "missingSlots": [],
  "confidence": 0.95
}
```

Allowed intents:

- `new_session`
- `status`
- `result`
- `task_lookup`
- `role_detail`
- `help`
- `other`

Allowed chambers come from `data/chambers/*.json`.

Allowed modes:

- `min`
- `balanced`
- `max`
- `all`
- `null` for non-session intents.

`roles` is intentionally generic instead of `philosophers`. Philosophy roles, board directors, and future chamber roles use the same field. Role names from the model are aliases only; deterministic code resolves them through chamber manifests and drops unknown role-like words such as "агора".

## Architecture

Add a small intent layer around the existing command flow:

1. `buildSlotExtractionPrompt()` builds a compact local-model prompt from available chambers, chamber aliases, role names, and the user text.
2. `extractIntentSlots()` calls the local OpenAI-compatible endpoint, parses one JSON object, validates it against `intent-slots.schema.json`, normalizes fields, and falls back to regex when the local model is unavailable or invalid.
3. `decideNextStep()` turns validated slots plus conversation state into one deterministic action: ask a clarification, run a new session, show status, show result, show a task, show role detail, or show help.
4. Telegram/Paperclip only receives the deterministic action output. The LLM never receives write access to Paperclip.

The plugin remains universal by invoking a generic Agora natural-language CLI entrypoint rather than hard-coding philosophy behavior in Python.

## Clarification Rules

The assistant should not interrogate the user endlessly.

- Zero missing critical slots: execute the action.
- One missing critical slot: ask one natural question.
- Two or more missing slots: use safe defaults where possible and explicitly say what was assumed.

Critical slots by intent:

- `new_session`: needs `chamber`, `mode`, and `topic`. `mode` defaults to `balanced`; `chamber` can default from active conversation/chamber if available; `topic` must be asked if absent.
- `role_detail`: needs one resolvable role and a recent session context.
- `task_lookup`: needs `taskRef`.
- `status`, `result`, and `help`: can run without topic.

## Telegram Experience

Human-language examples should work without special commands:

- "давай спросим агору про отцов и детей"
- "коротко спроси агору: что такое свобода у Сартра и Камю"
- "совет директоров, нужен go/no-go по найму CTO"
- "дай выжимку по последней таске"
- "а что сказал Платон?"

Expected behavior:

- The assistant acknowledges what it understood before slow work starts.
- If a session is created, it reports the session key, selected chamber, selected voices, and link.
- When synthesis completes, the answer is formatted as a digest and includes buttons for synthesis, role views, and opening the issue.
- Role-detail answers also include navigation buttons back to the synthesis and other roles.
- If the local model is unavailable, the assistant falls back to deterministic regex where possible; otherwise it asks a human clarification instead of silently failing.

## Error Handling

Extractor failures are non-fatal:

- Invalid JSON: retry once with a repair prompt.
- Schema failure: use regex fallback.
- Local endpoint unavailable: use regex fallback and record the extractor status.
- Low confidence: treat missing/ambiguous slots as missing and ask one clarification.
- Unknown role aliases: drop them unless the chamber role resolver can map them.

The assistant should expose friendly Telegram text, while logs keep technical details such as model name, latency, parse errors, and fallback path.

## Testing Strategy

Automated tests should not require LM Studio.

- Unit tests cover schema validation, JSON parsing, prompt construction, normalization, regex fallback, and planner decisions.
- A fixed 20-phrase regression set uses an injected fake extractor so CI remains deterministic.
- Existing Paperclip rewrite and inner Agora conversation-cycle tests are extended to natural language routes.
- A manual/local command runs the same 20 phrases against LM Studio for T4.9 comparison of `ROUTING_MODE=regex|llm`.

## Open Risks

- Local model choice matters. `gemma-4-26b-a4b-it-mlx` is acceptable; `google/gemma-4-26b-a4b-qat` is not acceptable with the current LM Studio response behavior.
- Role extraction is useful but noisy. Deterministic role resolution must be the authority.
- Telegram UX can regress if buttons are only attached to root synthesis. Button rendering must be tested for both synthesis and role-detail responses.

## Self-Review

- No placeholders remain.
- The design keeps the plugin universal by using generic chambers and roles.
- The LLM boundary is explicit: slots only, no direct writes.
- The spike decision follows the roadmap matrix: the no-reasoning local model exceeded the 80% threshold, so local extractor plus regex fallback is the selected path.
