# Phase 7 Chamber Safety Design

## Goal

Make safety and transparency policy a per-chamber contract, not a hard-coded philosophy prompt. The Telegram/Hermes/Paperclip path must be able to run on local models while still receiving the correct policy text, risk disclaimer, and review status from chamber metadata.

## Problem

Phase 6 made Telegram state per-chat. The next failure mode is semantic drift: a business chamber, a philosophy chamber, and a future high-stakes chamber can all reuse the same orchestration code, but they should not share the same transparency language or safety constraints.

Current state:

- `chambers/philosophy/chamber.json` and `chambers/board-directors/chamber.json` both point at `source-citation`.
- `scripts/agora.mjs` and `scripts/import-inner-agora.mjs` load transparency policy through a local function with an active-chamber default.
- `board-directors` is marked `draft`, but the roadmap asks for explicit non-reviewed chambers to use `research-only`.
- There is no chamber-level `riskTier`, so a future health/finance/legal chamber cannot force a high-stakes disclaimer into every child prompt.

## Constraints

- Local model first: do not add any cloud dependency, hosted classifier, or remote policy fetch.
- Universal plugin design: policy selection must live in reusable scripts and chamber/skill metadata, not in Telegram-specific code.
- Human-language UX later: Phase 8 can add buttons and prettier Telegram output, but Phase 7 should make the generated child tasks safe and self-describing before UI polish.
- Existing chamber compatibility: philosophy remains active and keeps the source/reconstruction/imitation/modern-transfer protocol.

## Decisions

1. Add chamber-level `riskTier` with values `reflective`, `advisory`, and `high-stakes`.
2. Add `research-only` to the chamber `status` enum and use it for chambers that exist for experiments but are not reviewed for real-world advice.
3. Create a reusable policy composition module. It loads `chamber.transparencyPolicy` from skills and appends a mandatory high-stakes disclaimer when `chamber.riskTier === "high-stakes"`.
4. Give the board chamber its own business advisory transparency skill. It still marks sources and reconstructions, but frames outputs as advisory memo, assumptions, risk, and decision conditions rather than philosophy-role imitation.
5. Wire policy composition into child prompts in `agora.mjs` and agent instructions in `import-inner-agora.mjs`.

## Acceptance Criteria

- Philosophy and board chambers physically output different policy text through `node scripts/agora.mjs policy`.
- Board chamber is listed as `research-only` and uses a board-specific transparency policy.
- A temporary high-stakes chamber receives the mandatory disclaimer in every generated child prompt.
- Import-generated agent instructions use the same composed policy path as live Agora child tasks.
- Existing local model routing stays intact: Phase 7 changes prompts and metadata, not provider selection.

## Non-Goals

- Telegram inline buttons and result formatting. That is Phase 8.
- Legal/medical/financial domain implementation. Phase 7 only creates the guardrail path for such chambers.
- Replacing role selection or synthesis logic.
