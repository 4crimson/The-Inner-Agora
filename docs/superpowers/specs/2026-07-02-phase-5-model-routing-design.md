# Phase 5 Model Routing Design

## Goal

Phase 5 makes model and adapter routing configurable instead of hard-coded. The system should choose the Paperclip agent adapter from a project-level JSON file, prepare Hermes from that same file, route high-risk full councils to the safer default adapter, and expose the adapter used for the latest Agora session in state and user-facing status.

## Scope

This phase covers roadmap items T5.1-T5.4:

- `models.config.json` defines adapters, model names, endpoint defaults, and routing rules.
- `scripts/setup-hermes-profile.mjs` reads Hermes model/base URL from the model config instead of literals.
- `scripts/agora.mjs` uses `adapterForRequest({ mode, chamberRiskTier, roleRiskTier, roleCount })` instead of `adapterForMode(mode)`.
- Session creation records the selected adapter in local state and a root issue comment; `/agora status` and `/agora latest` surface it.

This phase also moves the Phase 4 slot-extractor model default out of `.mjs` files, because `gemma-4-26b` literals in scripts would contradict the Phase 5 acceptance gate.

Phase 5 does not add cloud credentials, billing, provider setup, or a new adapter implementation. The "cloud/safe" route in this repo maps to the existing `codex_local` adapter until a future phase adds another adapter.

## Architecture

Add `models.config.json` at the repository root and a focused module `scripts/model-routing.mjs`.

`model-routing.mjs` owns:

- loading and validating `models.config.json`;
- environment-variable overrides for model names and endpoints;
- `adapterForRequest(request)` for Agora routing;
- `adapterEnv(adapter)` for `prepare`;
- `slotExtractorConfig()` for `intent-slots.mjs`;
- `hermesProfileConfig()` for `setup-hermes-profile.mjs`;
- small CLI diagnostics such as `node scripts/model-routing.mjs route --json --mode all --risk-tier high-stakes`.

The rest of the system imports these helpers. No other `.mjs` file should hard-code model IDs such as `gemma-4-26b...` or `gpt-5.4`.

## Config Shape

`models.config.json` uses a narrow schema:

```json
{
  "schemaVersion": 1,
  "slotExtractor": {
    "adapter": "lmstudio_slots",
    "model": "gemma-4-26b-a4b-it-mlx",
    "baseUrl": "http://127.0.0.1:1234/v1"
  },
  "adapters": {
    "hermes_local": {
      "type": "hermes_local",
      "model": "google/gemma-4-26b-a4b-qat",
      "baseUrl": "http://192.168.1.229:1234/v1",
      "reasoningEffort": "none"
    },
    "codex_local": {
      "type": "codex_local",
      "model": "gpt-5.4",
      "reasoningEffort": "medium"
    }
  },
  "routingRule": {
    "default": "codex_local",
    "localMode": "hermes_local",
    "shortDialogueSingleRole": "hermes_local",
    "fullCouncilHighStakes": "codex_local"
  }
}
```

Environment variables remain valid overrides:

- `INNER_AGORA_MODELS_CONFIG`
- `INNER_AGORA_LLM_MODEL`
- `INNER_AGORA_LLM_BASE_URL`
- `INNER_AGORA_HERMES_MODEL`
- `INNER_AGORA_HERMES_BASE_URL`
- `INNER_AGORA_CODEX_MODEL`
- `INNER_AGORA_CODEX_REASONING_EFFORT`

## Routing Rules

`adapterForRequest()` returns `{ name, adapter, reason, env }`.

Rules are evaluated in this order:

1. If `mode === "local"`, use `routingRule.localMode`.
2. If the request is a single-role dialogue/follow-up, use `routingRule.shortDialogueSingleRole`.
3. If `mode === "all"` and the request risk is `high-stakes`, use `routingRule.fullCouncilHighStakes`.
4. Otherwise use `routingRule.default`.

Risk is derived from:

- `request.chamberRiskTier` when explicitly supplied;
- the highest `riskTier` among selected roles;
- the active chamber's `riskTier` if a future chamber declares it;
- fallback `reflective`.

Risk order is `reflective < advisory < high-stakes`.

## Integration Points

`scripts/setup-hermes-profile.mjs`:

- imports `hermesProfileConfig()`;
- uses config model and base URL for `configTemplate()` and `transformConfig()`;
- keeps env overrides working.

`scripts/import-inner-agora.mjs`:

- imports adapter configs from `model-routing.mjs`;
- keeps `INNER_AGORA_AGENT_ADAPTER` as a supported explicit override;
- no longer stores model literals locally.

`scripts/intent-slots.mjs`:

- imports `slotExtractorConfig()`;
- uses model/base URL from config unless env overrides are set.

`scripts/agora.mjs`:

- replaces `adapterForMode()` with `adapterForRequest()`;
- `mode get` prints adapter and model from routing;
- `prepare` passes the route env into `import-inner-agora.mjs`;
- `ask`, `follow-up`, `dialogue`, and `dialogue-context` record adapter metadata where they create durable work;
- `status` and `latest` print the last selected adapter from state, and `latest` can also read adapter metadata from root issue metadata/comment when available.

`scripts/inner-agora-guard.mjs`:

- reads expected Hermes model from `model-routing.mjs`.

## User-Facing Behavior

After Phase 5:

- changing a model normally means editing `models.config.json`, not JS;
- `node scripts/agora.mjs mode get` reports both the mode and selected adapter/model;
- `/agora ask ...` root comments include a line such as `Adapter: codex_local (model=gpt-5.4, reason=default)`;
- `/agora status` shows the last adapter recorded in bridge state;
- `/agora latest` shows the adapter recorded for the latest root session when available.

## Tests And Verification

Unit tests should cover:

- model config loading and env overrides;
- routing for `local`, default, single-role dialogue, and full high-stakes council;
- `setup-hermes-profile.mjs` using model config in a temporary Hermes home;
- no `gemma-4-26b` literal in `.mjs` files;
- adapter metadata recorded in state/comment during `ask`;
- `/agora status` and `/agora latest` rendering adapter metadata.

Full verification:

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
node scripts/regression.mjs check
CHAMBER_MODE=chambers node scripts/regression.mjs check
ROUTING_MODE=llm INNER_AGORA_LLM_MODEL=gemma-4-26b-a4b-it-mlx node scripts/intent-slots.mjs fixture-20 --json
git grep "gemma-4-26b" -- "*.mjs"
```

The final `git grep` must return no matches. The live local-model slot fixture must remain semantically correct.
