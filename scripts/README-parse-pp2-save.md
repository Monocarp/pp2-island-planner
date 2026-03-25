# `parse-pp2-save.mjs` — decoded JSON save parser

Parses **decoded** PP2 save JSON (same structure as used by `save-import.js`). Outputs one JSON object to stdout (or pretty with `--human`).

## Usage

```bash
node scripts/parse-pp2-save.mjs path/to/decoded-save.json
node scripts/parse-pp2-save.mjs path/to/decoded-save.json --human
node scripts/parse-pp2-save.mjs path/to/decoded-save.json --human --debug-production
```

## Inputs (relative to repo root)

| File | Purpose |
|------|---------|
| `data/production_modifiers.json` | Silo distance, boosts, **non-producer exact ids / id prefixes** (no substring skip), preferred component keys, fisher → hut remap |
| `data/building_production_fallback.json` | Planner `producePerMinute` / iteration data per building id (regen: `node scripts/generate-building-production-fallback.mjs`) |
| `scripts/save-production-core.mjs` | Shared timer + rate resolution used by the CLI parser |
| `data/ships.json` | Join `ShipManager.Ships[].Type` → ship class / slot metadata |
| `data/resource_names.json` | Numeric resource id → display name for stocks and production |
| `data/resource_names_extra.json` | Optional overrides (merged in code if present) |
| `data/research.json` | Research id → name for completed research list |
| `data/research_unlocks.json` | Optional future: research id → building ids |

## Output sections

- `meta` — `saveFileVersion`, `currentTick`
- `stocks` / `stocksWithNames` — `ResourceManager.GlobalResources`
- `population` — `MaxPopulationCount`, `PopulationTiers` (if present)
- `researchCompleted` — with names from `research.json`
- `routes` — counts + sample of `SimpleRoutes`
- `ships` — merged with `ships.json`
- `islands[].productionBuildings` — per-entity rates: save **batch × 60 / cooldown** when outputs + timer are trustworthy; otherwise **`building_production_fallback.json`** (e.g. Jam Maker with inputs only, Sawmill with no top-level timer). Each row may include `rateSource`, `plannerBuildingId`.
- With **`--debug-production`**, includes `debugProduction[]` with per-entity resolution details.
- `globalProductionByResourceId` — summed across islands
- `warnings` — e.g. non-v20 version

## Schema reference

See [`data/save-schema.md`](../data/save-schema.md) for verified SaveFileVersion 20 paths vs older notes.

## Tests

```bash
node --test tests/parse-pp2-save.test.mjs tests/parse-production-accuracy.test.mjs
```

## `.dat` files

The game export may need decoding to JSON first; this script does not decode binary/encrypted `.dat` by itself.
