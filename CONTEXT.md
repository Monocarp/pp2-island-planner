# PP2 Island Planner — Project Context

## What Is This?

A browser-based island planning tool for the game **Paragon Pioneers 2** (PP2). Players use it to design island layouts: paint terrain, place deposits, position buildings, and validate that everything works together (warehouse coverage, service coverage, tile resource needs, production chains). It also has a **production planner** that calculates the full bill of materials for a target population, and an **auto-populate** feature that places buildings automatically.

**Live URL:** Hosted on Vercel, auto-deploys from the `master` branch.  
**Repo:** https://github.com/Monocarp/pp2-island-planner

## Tech Stack

- **Pure vanilla HTML/CSS/JS** — no framework, no build step, no npm dependencies
- Single `index.html` (HTML + CSS) with 8 JS files loaded via `<script src>` tags
- `data.js` is auto-generated game data (3,466 lines) — do not edit manually
- Deployed as static files; works as a local file too (`file://` protocol)

## File Structure

| File | Lines | Purpose |
|------|-------|---------|
| `index.html` | ~483 | HTML structure + all CSS styles |
| `data.js` | ~3,466 | Game data: buildings, tiles, resources, producers (auto-generated) |
| `buildings.js` | ~256 | Footprint definitions, placement rules, terrain/location checks |
| `island.js` | ~79 | Application state, terrain colors, deposit types, cell/island creation |
| `renderer.js` | ~448 | Canvas rendering, pan/zoom, mouse/touch input handling |
| `ui.js` | ~461 | Building palette, context menu, tooltips, undo/redo, keyboard shortcuts |
| `validation.js` | ~269 | Island stats, validation (warehouse/service coverage, tile resources, overlap) |
| `planner.js` | ~709 | Production chain solver, demand calculator, auto-populate algorithm |
| `saveload.js` | ~155 | LocalStorage persistence, modal dialogs, initialization |

### Script Load Order (matters — globals are shared)

```
data.js → buildings.js → island.js → renderer.js → ui.js → validation.js → planner.js → saveload.js
```

Each file depends on globals from previous files. There is no module system.

## Key Data Structures

### Cell (the atomic island tile)
```js
{ terrain: 'grass'|'water'|'river'|'coastal'|'forest'|'empty',
  deposit: null | depositId,    // e.g. 'copper_deposit', 'coal_deposit'
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
{ island, tool, terrainType, depositType, buildingId,
  zoom, panX, panY, isPanning, dragStart,
  undoStack, redoStack, hoveredCell,
  unlockedBuildings: Set,    // building IDs the user has unlocked in palette
  savedIslands: [],          // localStorage saves
  plannerActive: boolean,    // auto-refresh planner on stats update
  producerOverrides: {} }    // resourceId → preferred producerId
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

## Game Concepts (for non-players)

- **Tiers:** Pioneers → Colonists → Townsmen → Farmers → Merchants → Workers → Paragons → Northern Islands. Higher tiers unlock more buildings and have more complex needs.
- **Population Houses** consume resources and need **service coverage** (water, community, education, etc.). A house at `(x,y)` is "covered" by a service if `(x,y)` falls within that service building's footprint.
- **Production Buildings** produce resources, consume inputs, and must be within a **warehouse's footprint** to function.
- **Tile Resources:** Some buildings need specific terrain in their footprint (e.g., Pig Ranch needs 8 grass tiles, Copper Mine needs 1 copper_deposit). These are "spatial" tiles — overlapping footprints can compete for the same grass.
- **Location Requirements:** Some buildings have placement constraints: straight river (water wheels), ocean adjacent (harbors), river adjacent (tannery), in water/coastal (salmon hut).

## Major Features

### Island Editor
- Paint terrain (grass, water, river, coastal, forest)
- Place deposits (copper, coal, iron, etc. + fields like wheat, hop, apple trees)
- Place buildings with footprint preview and constraint checking
- Eraser tool, select tool, context menu
- Undo/redo (Ctrl+Z / Ctrl+Y)
- Save/load to localStorage
- Mobile-friendly: touch pan, pinch zoom, drawer panels

### Production Planner
- User sets population house counts per tier
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

2. **No multi-island support** — PP2 has multiple islands trading with each other. The planner assumes everything is on one island.

3. **Fisherman's Hut / coastal buildings** fail to auto-place on all-grass islands because they need `water_tile` terrain in their footprint. The user must paint coastal/water edges first.

4. **Service building counts** — auto-populate places exactly one of each needed service. For large populations, multiple service buildings may be needed to cover all houses. Not yet implemented.

5. **Tile overlap in auto-populate** — the auto-placer doesn't track which grass tiles are "claimed" when placing grass-hungry buildings. Two pig ranches could be placed sharing grass, each thinking it has 8. The *validation* catches this after the fact, but the placer should avoid it proactively.

6. **data.js is static** — if the game updates, data.js must be regenerated. The extraction scripts (`extract_data.py`, `extract_data_v2.py`) are in the parent directory.

7. **No building rotation** — some buildings in the game can be rotated. Not implemented here.

## Development Workflow

1. Edit files directly (no build step)
2. Test in browser (`file://` or local server)
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

### Planned Improvements
- [ ] **Smarter auto-populate** — avoid tile resource overlap during placement, not just in validation
- [ ] **Multiple service buildings** — detect when one service can't cover all houses, place additional ones
- [ ] **Auto-populate on non-blank islands** — better integration with pre-placed buildings and pre-painted terrain
- [ ] **Island templates** — preset island shapes (small, medium, large) with realistic terrain
- [ ] **Production surplus/deficit display** — show what the island over/under-produces vs demand
- [ ] **Export/share** — share island layouts via URL or file

## Architecture Notes for Contributors

- **All state is in the global `state` object** (island.js). There are no classes or module boundaries.
- **Rendering is immediate-mode** — `render()` redraws the entire canvas every frame. Called after any state change.
- **Validation runs on demand** — `validateIsland()` is called after placing/removing buildings and after auto-populate. It doesn't run continuously.
- **The planner is pure computation** — `resolveProductionChain(demand)` returns data; `calculateProduction()` renders it to HTML.
- **Undo is snapshot-based** — `pushUndo()` deep-copies the entire island state. Keep undo operations coarse-grained.
- **FOOTPRINTS keys** — some keys are building IDs (e.g., `'PigRanch'`), some are generic sizes (e.g., `'5x5'`). When looking up a building's footprint, use `FOOTPRINTS[buildingId]` first, then fall back to the size key.
- **building.inputs vs building.consumePerMinute** — `inputs` contains tile resource needs (spatial things in the footprint). `consumePerMinute` contains production resource consumption rates (goods flowing in). Some keys appear in both (they serve different purposes).
- **TILE_RESOURCE_IDS** — populated from `PP2DATA.tiles` at load time. Used to distinguish tile resources from production resources in `building.inputs`.
- **SERVICE_RESOURCES** — hardcoded set of resource IDs that are coverage-based (not production-based). Service buildings "provide" these by having the house within their footprint, not by producing goods.
