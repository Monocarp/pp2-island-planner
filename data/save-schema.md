# PP2 save JSON schema (verified against SaveFileVersion 20)

This document corrects and extends [Notes.json](Notes.json) using a real decoded save (`LightRepublic_decoded.json`).

## Top level

| Key | Present in v20 | Notes |
|-----|----------------|-------|
| `SaveFileVersion` | yes | Integer (e.g. 20). |
| `GameTimeManager` | yes | `current_tick` for simulation time. |
| `IslandManager.islands[]` | yes | Per-island `UID`, `Name`, `Grid`, `GameEntities`, `MapSettings`, **`Sectors`**, `Fertilities`, `Population`, `Storage`, `Units`, etc. |
| `ResourceManager` | yes | Global warehouse stocks (see below). |
| `PopulationManager` | yes | See below — **not** only `PopulationTiers`. |
| `ResearchManager.CompletedResearchTimes[]` | yes | `{ key: researchId, value: levelOrFlag }`. |
| `RouteManager` | yes | **`SimpleRoutes`** and **`ComplexRoutes`** — not a single `routes` array. |
| `ShipManager.Ships[]` | yes | `Type`, `Name`, `Slots[]` (cargo), `RouteUID`, etc. |

### Per-island `Sectors` (conquest regions)

- **`Sectors[]`**: each sector has **`ID`**, **`Center`** `[x,y]`, **`Fields`** (list of land cells in that sector), **`NeighbourIDs`**, **`IsConquered`**, **`IsRevealed`**, etc.
- **`Grid[]`** entries on land often include **`SectorID`** matching `Sectors[].ID` for that tile.
- **Rickyard (livestock ×2 area) vs `Silo`:** the UI “rickyard” location **does not** match `GameEntities` with `id: "Silo"` in general. On **Bursting Cay** (`data/bursting_cay.json`), three UI rickyard points **`(6,17)`**, **`(19,9)`**, **`(15,13)`** align with **`Sectors[].Center`** for sectors **9**, **21**, and **23** (`[5,17]`, `[18,7]`, `[17,14]` — centers are adjacent/coincident with the indicated tiles). There are **three** `Silo` entities at **`(6,17)`**, **`(14,9)`**, **`(17,7)`**; silo anchors fall in sectors **9**, **22**, and **21** — so **one** rickyard sector (**23**) has **no** silo, and **one** silo sits in sector **22** without the user’s rickyard label on that tile. **Conclusion:** save analysis should treat **sector centers** (or sector territory from `Fields`) as the boost source for livestock, **not** the `Silo` entity id alone. (Needs in-game confirmation; `Rickyard` exists in planner `data.js` but was not present as an entity id in this island JSON.)

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
- **Rickyard / Paddock (save analysis):** Saves use **`Silo`** for rickyards. Silo and Paddock are **boost sources only** (not production rows). **5×5** area: Chebyshev distance ≤ 2 from the silo/paddock **anchor**. **Rickyard ×2** applies only to pigs/cattle/sheep/horses whose anchor is in that area **and** whose **tile utilization is full** (all spatial inputs satisfied); partial grass still scales output down but **without** rickyard ×2 on that building (matches in-game UI totals). **Paddock ×2:** entities with a **`harvester`** component whose anchor is in the paddock footprint, and **not** a rickyard-eligible building in a silo footprint (no stacking). Valid saves do not place two building anchors on the same cell.
- **Non-producers** (fields, forests, deposits, `Warehouse*`, `House*`, `Silo`, etc.) use **`nonProducerExactIds` / `nonProducerIdPrefixes`** in `production_modifiers.json`, not broad substring skips (so `StrawberryFarm` is not dropped because of `Field` in another id).
- **Per-resource output rate (goods/min)** when using save outputs: `sum over outputs: (balance || 0) * 60 / cooldown` (with batch `1` if missing).
- **Spatial inputs (grass, deposits, `water_tile`, etc.):** non-grass tile resources use **per-cell 1/n** splitting among overlapping footprints. **`HorseBreeder`:** linear grass — gatherable grass cells in footprint ÷ `inputs.grass` × `producePerMinute` (no 1/n); **rickyard ×2** on that result when anchor is in silo 5×5 **even if** grass count &lt; need. **`PigRanch` / `SheepFarm`:** 1/n within each **connected** overlap component. **`CattleRanch`:** island-wide aggregate pool. **Rickyard ×2** for pigs/cattle/sheep still requires **full** tile utilization.

## Corrections to Notes.json

1. **Population:** Document `MaxPopulationCount`; do not assume only `PopulationTiers`.
2. **Routes:** Use `SimpleRoutes` / `ComplexRoutes`, not `routes`.
3. **Rate formula:** Closing code fence was broken; per-output rate should incorporate **batch `balance`** from `OutputResources`, not `60 / Cooldown` alone when multiple goods or batch size ≠ 1.
