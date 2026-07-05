# Plugin And Pack Boundaries

Date: 2026-07-05

This document freezes the current extraction map for The Inner Agora. It is a
promotion guide, not an install or publish instruction.

## Existing Reusable Packages

### `paperclip-cockpit`

Location: `hermes-plugins/paperclip-cockpit/`

Role: generic Hermes runtime plugin for deterministic Telegram/Paperclip control.

Owns:

- slash command boundary;
- Paperclip read commands;
- explicitly enabled Paperclip writes;
- natural-language rewrite/delegate mechanics;
- Telegram callback dispatch;
- configurable labels, terms, menus, actions, and callbacks;
- generic builtin helpers such as parent-tree finalization;
- project-neutral QA runner under `qa-tool/`.

Must not own:

- Inner Agora philosopher/chamber names;
- Agora-specific prompts, role selection, synthesis, or memory export;
- live Telegram suite decisions;
- project-specific copy beyond examples.

### `paperclip-cockpit/qa-tool`

Location: `hermes-plugins/paperclip-cockpit/qa-tool/`

Role: project-neutral Telegram/Paperclip QA runtime.

Owns suite execution, manifests, reports, cleanup mechanics, health checks, and
Telegram userbot transport. Project binding lives in `telegram-testing.config.json`.
Live commands require `--live-ok`.

### `telegram-paperclip-qa`

Location: `hermes-plugins/paperclip-cockpit/codex-plugin/telegram-paperclip-qa/`

Role: Codex workflow plugin for tester, developer, retest, and release-review
discipline.

It is not part of the Hermes runtime. It should guide Codex work, not handle
Telegram or Paperclip operations directly.

## Agora-Specific Packs To Keep Separate

### `agora-config-source`

Current location: `config/cockpit/*.json`

Role: editable source fragments for the generated runtime
`paperclip-cockpit.json`.

Promotion rule: keep runtime compatibility by generating the single JSON file
with `scripts/build-cockpit-config.mjs`; do not make Hermes read fragments until
that is explicitly designed.

### `agora-chamber-pack`

Current locations:

- `chambers/*/chamber.json`
- `chambers/*/roles.json`
- `chambers/*/presets/*.json`
- `chambers/*/cockpit.overrides.json`
- chamber-facing `skills/*`

Role: content/config pack for chambers, roles, presets, policy skills, and
prompt material.

Promotion rule: treat this as content/config first. Do not publish it as a
runtime plugin until chamber loading, policy loading, and role validation stay
stable across another verification pass.

### `agora-core-runtime`

Current locations: `scripts/agora.mjs` and `scripts/agora/*.mjs`

Role: Inner Agora orchestration: role planning, session creation, follow-up,
dialogue, synthesis, memory export, status, costs, and preflight.

Promotion rule: keep this internal until `scripts/agora.mjs` is a thin CLI over
focused modules. Generic Paperclip mechanics belong in `paperclip-cockpit`, not
here.

### `agora-telegram-payloads`

Current locations: `scripts/paperclip-cockpit-telegram.mjs` and
`scripts/telegram/*.mjs`

Role: Inner Agora Telegram payloads, compact Russian UX, result/progress cards,
safe stop cleanup, and project QA surface.

Promotion rule: keep it Agora-specific while the accepted Telegram contract is
still evolving. Do not move first-level UX copy into the generic plugin.

## Promotion Gates

- No install, publish, profile copy, or live Telegram/Paperclip command without
  explicit operator approval.
- `paperclip-cockpit` code must remain free of Inner Agora nouns.
- Project launch summaries must be configured through
  `telegram.launch_summary`, not hardcoded in the generic runtime plugin.
- Runtime `paperclip-cockpit.json` must stay generated from source fragments and
  pass `node scripts/build-cockpit-config.mjs --check --json`.
- QA plugin manifest must parse before any packaging claim.
- Role runtime must stay chamber-based; do not reintroduce a global
  legacy/chamber switch inside plugin boundaries.

## Local Verification

```bash
node scripts/build-cockpit-config.mjs --check --json
node paperclip-qa-tool/bin/paperclip-qa.mjs config-check --config telegram-testing.config.json --json
node -e 'JSON.parse(require("fs").readFileSync("hermes-plugins/paperclip-cockpit/codex-plugin/telegram-paperclip-qa/.codex-plugin/plugin.json","utf8")); console.log("plugin json ok")'
! rg -n "Inner Agora|The Inner Agora|философ|Агора|Agora|recover_without_philosopher|--philosophers|philosopher" hermes-plugins/paperclip-cockpit/__init__.py hermes-plugins/paperclip-cockpit/qa-tool -g '!**/__pycache__/**'
git diff --check
```
