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

- Production timers live under **`components.<name>.Timer.Cooldown`** — not only `harvester` / `factory` / `gatherer`; e.g. nested `resourcefield.spots[].resource.Timer` for forests.
- For standard producers, **`components.internalstorage.OutputResources.Resources[]`** gives `{ key: resourceId, value: { balance } }` per batch.
- **Per-resource output rate (goods/min):**  
  `sum over outputs: (balance || 0) * 60 / cooldown`  
  If `balance` is missing, treat as **1** for a single-output producer (fallback).

## Corrections to Notes.json

1. **Population:** Document `MaxPopulationCount`; do not assume only `PopulationTiers`.
2. **Routes:** Use `SimpleRoutes` / `ComplexRoutes`, not `routes`.
3. **Rate formula:** Closing code fence was broken; per-output rate should incorporate **batch `balance`** from `OutputResources`, not `60 / Cooldown` alone when multiple goods or batch size ≠ 1.
