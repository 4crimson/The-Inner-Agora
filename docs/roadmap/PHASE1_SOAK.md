# Phase 1 Readiness Gate

Phase 1 implementation landed in commit `ac819c5 Add Phase 1 role schema migration`.

## T1.6 Status

`T1.6` is complete locally.

Operator decision on 2026-07-05 removed the elapsed-time requirement. The gate
was made evidence-based, then executed as a separate legacy-removal slice:

- `node scripts/migrate-roles.mjs --check` passes;
- `node scripts/regression.mjs check` passes on the chamber role path;
- `scripts/agora.mjs` and `scripts/import-inner-agora.mjs` read active chamber
  roles directly;
- `chambers/philosophy/roles.json` is the default philosophy role source.

The checker keeps the historical filename `phase1-soak-check.mjs` for
compatibility, but its contract is now a Phase 1 readiness check.

## Readiness Check

Run:

```bash
node scripts/phase1-soak-check.mjs
```

For machine-readable output:

```bash
node scripts/phase1-soak-check.mjs --json
```

The check is acceptable for T1.6 only when:

- `checks=ok`
- `eligible=yes`
- `gate=migration-and-regression`
- `node scripts/regression.mjs check` passes
- `node scripts/migrate-roles.mjs --check` passes

## T1.6 Completion Rule

Do not reintroduce a second role-loader path. Future role/chamber changes should
extend chamber manifests, role files, presets, and focused loaders rather than
adding a new global compatibility flag.
