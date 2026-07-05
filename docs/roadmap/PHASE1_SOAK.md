# Phase 1 Readiness Gate

Phase 1 implementation landed in commit `ac819c5 Add Phase 1 role schema migration`.

## T1.6 Status

`T1.6` is not a calendar wait anymore.

Operator decision on 2026-07-05 removed the elapsed-time requirement. The gate
is now evidence-based:

- `node scripts/migrate-roles.mjs --check` passes;
- `node scripts/regression.mjs check` passes in legacy mode;
- `CHAMBER_MODE=chambers node scripts/regression.mjs check` passes;
- legacy removal is still done only in a separate T1.6 slice.

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
- `node scripts/regression.mjs check` passes in legacy mode
- `CHAMBER_MODE=chambers node scripts/regression.mjs check` passes in chambers mode
- `node scripts/migrate-roles.mjs --check` passes

## T1.6 Execution Rule

Delete the legacy path only in a separate T1.6 commit after the readiness check is
green. That commit must remove `CHAMBER_MODE`, make
`chambers/philosophy/roles.json` the only runtime source, and rerun the full
Phase 1 verification gates before marking Phase 1 complete.
