# PP2 save JSON schema (verified against SaveFileVersion 20)

This document corrects and extends [Notes.json](Notes.json) using a real decoded save (`LightRepublic_decoded.json`).

## Top level

| Key | Present in v20 | Notes |
|-----|----------------|-------|
| `SaveFileVersion` | yes | Integer (e.g. 20). |
| `GameTimeManager` | yes | `current_tick` for simulation time. |
| `IslandManager.islands[]` | yes | Per-island `UID`, `Name`, `Grid`, `GameEntities`, `MapSettings`. |
| `ResourceManager` | yes | Global warehouse stocks (see below). |
| `PopulationManager` | yes | See below — **not** only `PopulationTiers`. |
| `ResearchManager.CompletedResearchTimes[]` | yes | `{ key: researchId, value: levelOrFlag }`. |
| `RouteManager` | yes | **`SimpleRoutes`** and **`ComplexRoutes`** — not a single `routes` array. |
| `ShipManager.Ships[]` | yes | `Type`, `Name`, `Slots[]` (cargo), `RouteUID`, etc. |

### Per-island `Grid` and `GameEntities`

- **`Grid[]`**: terrain only — e.g. `Type` 2 = water, `Type` 3 + `DepositType` = mineral deposit, `IsRiver: true` = river on land. There is **no** serialized field for which building “owns” a grass or deposit tile.
- **`GameEntities`**: building anchors (`id`, `xy`). On gatherer components, **`AmountRemainder`** is **not** “tiles used / tiles needed”; it is **fractional production carry** between ticks. Tile utilization for save analysis must be **recomputed** from grid + footprints + `data.js` inputs (see companion `save-island-from-save.js` / overlap model in `save-tile-utilization.js`).

## ResourceManager (stocks)

Verified path:

`ResourceManager.GlobalResources.Resources[]` → `{ key: number, value: { balance?: number } }`

Keys are **numeric resource ids**. Empty `value: {}` means zero / uninitialized.

## PopulationManager

**Observed in v20:** `MaxPopulationCount[]` as `{ key: number, value: number }` (population caps or counts per tier key).

**Notes.json** also mentions `PopulationTiers[]` with `BasicNeeds` / `LuxuryNeeds` — that structure may appear in other saves or versions. The parser reads **both** when present:

- `MaxPopulationCount`
- `PopulationTiers`

## RouteManager

**Observed:** `SimpleRoutes[]` and `ComplexRoutes[]` (often `ComplexRoutes: []`).

Each simple route has: `UID`, `Name`, `Simple`, `Waypoints[]` with `IslandUID`, `Actions[]` (`Resource`, `Unit`, `Load` boolean), etc.

## ShipManager

`Ships[]`: `Type` (int, maps to [ships.json](ships.json)), `Slots[]` with `Resource`, `Unit`, `Balance`, optional route fields.

## Production entities (`GameEntities`)

- Production timers live under **`components.<name>.Timer.Cooldown`** — not only `harvester` / `factory` / `gatherer`; e.g. nested `resourcefield.spots[].resource.Timer` for forests. **`internalstorage` and `portal` are ignored** when scanning for a timer (avoids picking silo transporter timers on unrelated entities).
- For standard producers, **`components.internalstorage.OutputResources.Resources[]`** gives `{ key: resourceId, value: { balance } }`. **Save `balance` is often stock, not guaranteed batch-per-cycle** — when there is no top-level timer but outputs exist, the island planner parser uses **`data/building_production_fallback.json`** (from `data.js`) with **`producePerIteration × 60 / iterationTime`** or **`producePerMinute`** instead of mis-reading balances (e.g. Sawmill).
- If **`OutputResources` is missing or empty** but `factory` / `harvester` / … has a timer, rates come from the same **fallback** file so buildings like **Jam Maker** (inputs-only on disk) still match planner math.
- **Rickyard / Paddock (save analysis):** Game saves use entity id **`Silo`** for rickyards. **5×5** footprint (Chebyshev distance ≤ 2 from silo/paddock anchor). If a **collector’s anchor** lies inside that footprint: **×2** output (after tile utilization). **Rickyard:** pigs, cattle, sheep, horses only. **Paddock:** entities with a **`harvester`** component. **No stacking** (at most ×2 from this rule).
- **Non-producers** (fields, forests, deposits, `Warehouse*`, `House*`, `Silo`, etc.) use **`nonProducerExactIds` / `nonProducerIdPrefixes`** in `production_modifiers.json`, not broad substring skips (so `StrawberryFarm` is not dropped because of `Field` in another id).
- **Per-resource output rate (goods/min)** when using save outputs: `sum over outputs: (balance || 0) * 60 / cooldown` (with batch `1` if missing).
- **Spatial inputs (grass, deposits, `water_tile`, etc.):** companion save analysis scales nameplate rates by **effective tile units** — footprint cells that match the input, excluding cells blocked by another building’s anchor, with **shared** matching cells split **evenly** among all buildings that count that cell for the same resource id (e.g. two ranches on one grass tile → 50% each).

## Corrections to Notes.json

1. **Population:** Document `MaxPopulationCount`; do not assume only `PopulationTiers`.
2. **Routes:** Use `SimpleRoutes` / `ComplexRoutes`, not `routes`.
3. **Rate formula:** Closing code fence was broken; per-output rate should incorporate **batch `balance`** from `OutputResources`, not `60 / Cooldown` alone when multiple goods or batch size ≠ 1.
