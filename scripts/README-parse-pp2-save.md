# `parse-pp2-save.mjs` — decoded JSON save parser

Parses **decoded** PP2 save JSON (same structure as used by `save-import.js`). Outputs one JSON object to stdout (or pretty with `--human`).

## Usage

```bash
node scripts/parse-pp2-save.mjs path/to/decoded-save.json
node scripts/parse-pp2-save.mjs path/to/decoded-save.json --human
```

## Inputs (relative to repo root)

| File | Purpose |
|------|---------|
| `data/production_modifiers.json` | Silo distance, boost multipliers, skip substrings, preferred component keys |
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
- `islands[].productionBuildings` — per-entity output rates using **batch balance × 60 / cooldown**
- `globalProductionByResourceId` — summed across islands
- `warnings` — e.g. non-v20 version

## Schema reference

See [`data/save-schema.md`](../data/save-schema.md) for verified SaveFileVersion 20 paths vs older notes.

## Tests

```bash
node --test tests/parse-pp2-save.test.mjs
```

## `.dat` files

The game export may need decoding to JSON first; this script does not decode binary/encrypted `.dat` by itself.
