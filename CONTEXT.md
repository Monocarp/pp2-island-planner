# PP2 Island Planner — Project Context

## What Is This?

A browser-based island planning tool for the game **Paragon Pioneers 2** (PP2). Players use it to design island layouts: paint terrain, place deposits, position buildings, and validate that everything works together (warehouse coverage, service coverage, tile resource needs, production chains). It also has a **production planner** that calculates the full bill of materials for a target population, and an **auto-populate** feature that places buildings automatically.

**Live URL:** Hosted on Vercel, auto-deploys from the `master` branch.  
**Repo:** https://github.com/Monocarp/pp2-island-planner

## Tech Stack

- **Pure vanilla HTML/CSS/JS** — no framework, no build step, no npm dependencies
- Single `index.html` (HTML + CSS) with 8 JS files loaded via `<script src>` tags
- `data.js` is auto-generated game data (~3,400+ lines) — do not edit manually
- Deployed as static files; works as a local file too (`file://` protocol)

## File Structure

| File | Purpose |
|------|---------|
| `index.html` | HTML structure + all CSS styles; island-type bar (Temperate / Tropical UI only) |
| `data.js` | Game data: buildings, tiles, resources, producers (auto-generated) |
| `buildings.js` | Footprint definitions, placement rules, terrain/location checks |
| `island.js` | Application state, `DEPOSIT_TYPES`, `FERTILITY_RESOURCES`, `ISLAND_TYPE_TIERS`, `getDepositPaintStyle`, cell/island creation |
| `renderer.js` | Canvas rendering, pan/zoom, mouse/touch input handling |
| `ui.js` | Building palette, deposit tools, fertility panel, `refreshIslandTypeDependentUI`, context menu, tooltips, undo/redo |
| `validation.js` | Island stats, validation (warehouse/service coverage, tile resources, overlap) |
| `planner.js` | Production chain solver, `NATURAL_DEPOSIT_IDS`, demand calculator, auto-populate |
| `saveload.js` | LocalStorage persistence, **multi-island project** (`pp2_island_layout_v1`), setup/size modals, named saves, initialization |

### Script Load Order (matters — globals are shared)

```
data.js → buildings.js → island.js → renderer.js → ui.js → validation.js → planner.js → saveload.js
```

Each file depends on globals from previous files. There is no module system.

## Phase 1 multi-island project

- On first visit (no **`pp2_island_layout_v1`**), the user sees **Island layout**: counts of **temperate** and **tropical** islands (at least one total). Order in memory: **all temperate slots first**, then tropical.
- **`state.projectSlots`** — `{ type, island|null, activeFertilities: string[] }[]`. **`state.activeSlotIndex`** selects the slot edited on the canvas (`state.island` is the active grid mirror).
- **Switch island slot** dropdown + **Island counts** (header): change counts (with confirm if removing a non-empty slot). Temperate/Tropical **type bar is hidden** in project mode; archetype comes from the slot.
- **`setActiveSlot`**, **`saveProjectToStorage`**, **`loadProjectFromStorage`**, **`commitActiveSlotFromState`** (saveload.js); **`buildSlotSelectorUI`**, **`syncMultiIslandUI`** (ui.js). `beforeunload` commits the active grid into the slot.
- **Named saves** may include a full **`projectSlots`** snapshot + **`activeSlotIndex`**; legacy single-island entries are **migrated** into a one-slot project on load.
- Planner / validation still use **only the active slot’s** `state.island` (no cross-island trade in Phase 1).

## Island archetypes & fertilities

- **`state.islandType`** — `temperate` \| `tropical` \| `northern` \| `magical` (see `VALID_ISLAND_TYPES`). The **header bar only offers Temperate and Tropical**; `northern` / `magical` remain in code and saves until planner data is ready.
- **`getIslandTypeConfig()`** — resolves `prodTiers`, `popTiers`, and default `fertilities` from `ISLAND_TYPE_TIERS`. Invalid or stub configs fall back to temperate behavior where applicable.
- **`FERTILITY_RESOURCES`** — per-type list of `{ id, label, tileResources }`. **`isTileResourceFertilityBlocked`** scans all types so wrong-climate gated tiles cannot be painted on the current island.
- **`state.activeFertilities`** — `Set` of fertility IDs enabled for the current layout; drives deposit tool enablement and planner assumptions (import vs local growth).

### Global vs per-save preferences

- **`pp2_island_layout_v1`** — persisted **project** (counts, slots, grids, fertilities per slot, active index). Required for the app after the multi-island Phase 1 change.
- **`pp2_island_type`** / **`pp2_island_fertilities`** — still updated when switching slots (compatibility).
- **Each entry in `pp2_island_saves`** may store a full **multi-island** snapshot (`projectSlots`, `activeSlotIndex`) or a legacy single `island`; legacy loads are migrated into a one-slot project.

## Key Data Structures

### Cell (the atomic island tile)
```js
{ terrain: 'grass'|'water'|'river'|'coastal'|'forest'|'empty',
  deposit: null | depositId,    // e.g. 'copper_deposit', 'tea_field', or any PP2 tile resource id
  building: null | buildingId } // set when a building occupies this cell
```

### Island
```js
{ width: number, height: number,
  cells: Cell[][],           // 2D array indexed as cells[y][x]
  buildings: [{ id, x, y, uid }] }  // flat list of placed buildings (anchor positions)
```

### Application State (`state` in island.js)
```js
{ island, islandType, activeFertilities,
  tool, terrainType, depositType, buildingId,
  zoom, panX, panY, isPanning, dragStart,
  undoStack, redoStack, hoveredCell, selectedBuilding,
  unlockedBuildings: Set,
  plannerActive: boolean,
  producerOverrides: {},     // resourceId → preferred producerId
  customBuildingEntries: [], // { id, count } for extra production + auto-place
  militaryEntries: [],       // { unitResId, ratePerHour } for military chain
  projectTemperateCount: 0, projectTropicalCount: 0,
  projectSlots: [],         // multi-island slots (see Phase 1 above)
  activeSlotIndex: 0 }
```

### Building (from data.js via `PP2DATA.getBuilding(id)`)
```js
{ id, name, tier, produces, producePerMinute, iterationTime, footprint,
  consumePerMinute: { resourceId: rate },  // what it consumes
  inputs: { resourceId: count },           // tile resources needed in footprint (grass, deposits, etc.)
  isPopulation, isService, isInfrastructure }
```

### Footprints (`FOOTPRINTS` in buildings.js)
Relative `[dx, dy]` offsets from the anchor cell. Sizes: 1×1, 3×3, 5×5, 9×9, 11×11, plus, diamond variants. A building at `(x,y)` occupies all cells `(x+dx, y+dy)` in its footprint. Warehouses and services use their footprint as their **coverage area**.

## Deposits on the map

- **`DEPOSIT_TYPES`** — list of `{ id, name, color }` for the **paint palette** and known grid styling. Extended with regional variants (`*_tropical`, `*_north`, `ironstone_deposit`, river/coastal tile-as-deposit ids) aligned with `data.js` tiles.
- **`getDepositPaintStyle(depId)`** — returns palette entry or **`PP2DATA.getResourceName`** + neutral color so unknown / future tile ids still **render** on the canvas and in **Island Stats**.
- **`NATURAL_DEPOSIT_IDS`** (planner.js) — mineral/geology ids that **must exist** on the island; auto-populate Phase 1.5 will not try to paint them. Keep in sync when adding new vein types from game data.

## Game Concepts (for non-players)

- **Tiers:** Pioneers → Colonists → Townsmen → Farmers → Merchants → Workers → Paragons → Northern Islands. Higher tiers unlock more buildings and have more complex needs.
- **Population Houses** consume resources and need **service coverage** (water, community, education, etc.). A house at `(x,y)` is "covered" by a service if `(x,y)` falls within that service building's footprint.
- **Production Buildings** produce resources, consume inputs, and must be within a **warehouse's footprint** to function.
- **Tile Resources:** Some buildings need specific terrain in their footprint (e.g., Pig Ranch needs 8 grass tiles, Copper Mine needs 1 copper_deposit). These are "spatial" tiles — overlapping footprints can compete for the same grass.
- **Location Requirements:** Some buildings have placement constraints: straight river (water wheels), ocean adjacent (harbors), river adjacent (tannery), in water/coastal (salmon hut).

## Major Features

### Island Editor
- Paint terrain (grass, water, river, coastal, forest)
- Place deposits (minerals, fields, regional/tropical tiles via `DEPOSIT_TYPES`)
- Place buildings with footprint preview and constraint checking
- Eraser tool, select tool, context menu
- Undo/redo (Ctrl+Z / Ctrl+Y)
- Save/load to localStorage (**layout + island type + fertilities per save**)
- Mobile-friendly: touch pan, pinch zoom, drawer panels

### Production Planner
- User sets population house counts per tier (tiers filtered by `popTiers` for the current island type)
- Calculates full resource demand per minute
- Recursively resolves production chains (what buildings produce each resource, and what *those* buildings need)
- Handles producer selection with tier priority + user overrides (click ⇅ to cycle)
- Distinguishes spatial tiles (grass, deposits — counted per footprint) vs regenerating tiles (apple trees, fields — counted by production rate)
- Compares needed vs placed, color-coded: green (enough), orange (partial), red (none)

### Auto-Populate
- "Auto-Place" button places all needed buildings on the island
- Placement order: warehouses → services → production (most-constrained first) → population houses
- Constraint priority: deposit-bound > river-bound > grass-hungry > unconstrained
- Multi-warehouse: places up to 5 warehouses targeting 70%+ land coverage
- Houses prefer positions with maximum service coverage
- Single undo operation for the entire auto-populate
- Reports failures with reasons (e.g., "needs Water Tile tiles", "Needs straight river")

### Validation
- Warehouse coverage check for production buildings
- Service coverage check for population houses (per service type)
- Tile resource minimum check (e.g., "has 3/8 Grass tiles")
- Tile overlap detection (warns when two buildings share spatial tiles)
- Location requirement validation

## Known Limitations / Open Issues

1. **Auto-populate is greedy, not optimal** — it places one building at a time, most-constrained first. Results are functional but not space-optimal. A smarter algorithm (simulated annealing, constraint propagation) could improve density.

2. **No multi-island support** — PP2 has multiple islands trading with each other. The planner assumes everything is on one **layout**.

3. **Fisherman's Hut / coastal buildings** fail to auto-place on all-grass islands because they need `water_tile` terrain in their footprint. The user must paint coastal/water edges first.

4. **Service building counts** — auto-populate places exactly one of each needed service. For large populations, multiple service buildings may be needed to cover all houses. Not yet implemented.

5. **Tile overlap in auto-populate** — the auto-placer doesn't track which grass tiles are "claimed" when placing grass-hungry buildings. Two pig ranches could be placed sharing grass, each thinking it has 8. The *validation* catches this after the fact, but the placer should avoid it proactively.

6. **data.js is static** — if the game updates, data.js must be regenerated. The extraction scripts (`extract_data.py`, `extract_data_v2.py`) are in the parent directory.

7. **No building rotation** — some buildings in the game can be rotated. Not implemented here.

8. **Northern / Magical island UIs** — not exposed in the type bar until population/planner coverage is defined; types remain in `ISLAND_TYPE_TIERS` for forward compatibility.

## Development Workflow

1. Edit files directly (no build step)
2. Test in browser (` file://` or local server)
3. `git add . && git commit -m "message" && git push`
4. Vercel auto-deploys from master

## Roadmap / Next Steps

The near-term goal (as stated by the project owner): **"Be able to select population goal and have it auto-populate the island to meet those goals with minimal wasted space."**

### Completed
- [x] Production chain solver
- [x] Basic auto-populate (greedy placement)
- [x] Warehouse coverage expansion (multi-warehouse)
- [x] Service → house coverage ordering
- [x] Tile resource validation + overlap detection
- [x] Per-save island type + fertilities; cross-climate fertility blocking; expanded deposit palette / planner natural-set alignment

### Planned Improvements
- [ ] **Smarter auto-populate** — avoid tile resource overlap during placement, not just in validation
- [ ] **Multiple service buildings** — detect when one service can't cover all houses, place additional ones
- [ ] **Auto-populate on non-blank islands** — better integration with pre-placed buildings and pre-painted terrain
- [ ] **Island templates** — preset island shapes (small, medium, large) with realistic terrain
- [ ] **Production surplus/deficit display** — show what the island over/under-produces vs demand
- [ ] **Export/share** — share island layouts via URL or file
- [ ] **Northern / Magical** — full tier + fertility + UI when game data and UX are ready

## Architecture Notes for Contributors

- **All primary state is in the global `state` object** (island.js). There are no classes or module boundaries.
- **Rendering is immediate-mode** — `render()` redraws the entire canvas every frame. Called after any state change.
- **Validation runs on demand** — `validateIsland()` is called after placing/removing buildings and after auto-populate. It doesn't run continuously.
- **The planner is pure computation** — `resolveProductionChain(demand)` returns data; `calculateProduction()` renders it to HTML.
- **Undo is snapshot-based** — `pushUndo()` deep-copies the entire island state. Keep undo operations coarse-grained.
- **FOOTPRINTS keys** — some keys are building IDs (e.g., `'PigRanch'`), some are generic sizes (e.g., `'5x5'`). When looking up a building's footprint, use `FOOTPRINTS[buildingId]` first, then fall back to the size key.
- **building.inputs vs building.consumePerMinute** — `inputs` contains tile resource needs (spatial things in the footprint). `consumePerMinute` contains production resource consumption rates (goods flowing in). Some keys appear in both (they serve different purposes).
- **TILE_RESOURCE_IDS** — populated from `PP2DATA.tiles` at load time. Used to distinguish tile resources from production resources in `building.inputs`.
- **SERVICE_RESOURCES** — hardcoded set of resource IDs that are coverage-based (not production-based). Service buildings "provide" these by having the house within their footprint, not by producing goods.
- **After changing island type or loading a save**, use **`refreshIslandTypeDependentUI()`** (ui.js) so palette, fertilities, planner inputs, deposit buttons, and localStorage prefs stay consistent.
