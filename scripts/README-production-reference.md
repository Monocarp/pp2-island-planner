# Production / consumption reference generator

Generated files (committed under `data/`):

| File | Contents |
|------|----------|
| `production-reference.json` | Full structured data: buildings + tiles, warnings, schema version |
| `production-reference-buildings.csv` | One row per building; JSON columns for consume maps |
| `production-reference-tiles.csv` | Tile regrowth / output rates |
| `production-reference.md` | Short human summary + tier counts |

Source: [ElQDuck/paragon-pioneers-2-calculator](https://github.com/ElQDuck/paragon-pioneers-2-calculator) — folder `src/pages/production-chain/` (`buildings/**`, `tiles/**`).

## One-time setup

From the repo root:

```bash
git clone --depth 1 https://github.com/ElQDuck/paragon-pioneers-2-calculator.git vendor/paragon-pioneers-2-calculator
```

(`vendor/paragon-pioneers-2-calculator` is gitignored; only `data/production-reference*` is meant to be committed.)

## Regenerate

```bash
node scripts/generate-production-reference.mjs
```

Custom root (if the calculator lives elsewhere):

```bash
set PP2_PRODUCTION_CHAIN_ROOT=C:\path\to\paragon-pioneers-2-calculator\src\pages\production-chain
node scripts/generate-production-reference.mjs
```

or:

```bash
node scripts/generate-production-reference.mjs --root "C:/path/to/.../production-chain"
```

The script records `source.commit` when `vendor/paragon-pioneers-2-calculator` is a git checkout.

## Notes

- Rates match the calculator: **per minute = per iteration ÷ (iterationSeconds / 60)**.
- Population “composite” buildings under `buildings/population/` use fractional `CONSUME_PER_ITERATION` expressions; those are evaluated and rounded to JS floats.
