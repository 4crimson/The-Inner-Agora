# Phase 1 Soak Gate

Phase 1 implementation landed in commit `ac819c5 Add Phase 1 role schema migration`.

## T1.6 Status

`T1.6` is not ready to execute yet.

Roadmap requirement:

> Удалить legacy-путь и `CHAMBER_MODE` флаг после подтверждения совпадения ≥1 недели.

Soak window:

- Started at: `2026-07-02T09:01:09.000Z`
- Earliest eligible at: `2026-07-09T09:01:09.000Z`
- Current policy before that date: keep `CHAMBER_MODE=legacy|chambers`

## Daily Check

Run:

```bash
node scripts/phase1-soak-check.mjs --started-at 2026-07-02T09:01:09.000Z
```

For machine-readable output:

```bash
node scripts/phase1-soak-check.mjs --started-at 2026-07-02T09:01:09.000Z --json
```

The check is acceptable for T1.6 only when:

- `checks=ok`
- `eligible=yes`
- `node scripts/regression.mjs check` passes in legacy mode
- `CHAMBER_MODE=chambers node scripts/regression.mjs check` passes in chambers mode
- `node scripts/migrate-roles.mjs --check` passes

## T1.6 Execution Rule

After the soak date, delete the legacy path only in a separate T1.6 commit. That commit must remove `CHAMBER_MODE`, make `chambers/philosophy/roles.json` the only runtime source, and rerun the full Phase 1 verification gates before marking Phase 1 complete.
