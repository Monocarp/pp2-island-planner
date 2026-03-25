// ===== TILE RESOURCE GEOMETRY (shared) =====
// Used by validation, save analysis, and any code that matches terrain/deposits to PP2DATA tile inputs.
// Depends on: buildings.js (PLACEABLE_TERRAIN) when running in the browser.

/** Copper vein tiles — any member counts as satisfying spatial inputs of any other member (mine chain). */
var COPPER_MINE_DEPOSIT_IDS = new Set([
  'copper_deposit',
  'copper_deposit_tropical',
  'copper_pyrite_deposit',
]);

function copperMineFamilyTileCount(depositCounts) {
  let n = 0;
  for (const id of COPPER_MINE_DEPOSIT_IDS) n += depositCounts[id] || 0;
  return n;
}

/** True if building spatial inputs include this deposit (or any copper-family input for copper-family anchors). */
function buildingGatheringUsesDeposit(building, depositId) {
  if (!building || !building.inputs || !depositId) return false;
  if (Object.prototype.hasOwnProperty.call(building.inputs, depositId)) return true;
  if (COPPER_MINE_DEPOSIT_IDS.has(depositId)) {
    for (const k of Object.keys(building.inputs)) {
      if (COPPER_MINE_DEPOSIT_IDS.has(k)) return true;
    }
  }
  return false;
}

function matchesTileResource(cell, resId) {
  const terrainMultiMap = {
    water_tile: ['water', 'coastal'],
  };
  const terrainMap = {
    grass: 'grass',
    grass_north: 'grass',
    forest: 'forest',
    conifer_forest: 'forest',
    river: 'river',
    river_north: 'river',
    river_tropical: 'river',
    coastal: 'coastal',
    coastal_north: 'coastal',
    coastal_tropical: 'coastal',
  };
  if (terrainMultiMap[resId] && terrainMultiMap[resId].includes(cell.terrain)) return true;
  if (terrainMap[resId] && cell.terrain === terrainMap[resId]) return true;
  if (cell.deposit === resId) return true;
  if (cell.deposit && COPPER_MINE_DEPOSIT_IDS.has(resId) && COPPER_MINE_DEPOSIT_IDS.has(cell.deposit))
    return true;
  return false;
}

/** Open water / coastal terrain, or shoreline grass|forest (map edge = ocean) — fishable for water_tile counts. */
function cellProvidesWaterTile(cell, cx, cy, width, height, opts) {
  if (!cell) return false;
  if (matchesTileResource(cell, 'water_tile')) return true;
  const onBorder = cx === 0 || cy === 0 || cx === width - 1 || cy === height - 1;
  const placeable =
    opts && opts.placeableTerrain
      ? opts.placeableTerrain
      : typeof PLACEABLE_TERRAIN !== 'undefined'
        ? PLACEABLE_TERRAIN
        : null;
  if (onBorder && placeable && placeable.has(cell.terrain)) return true;
  return false;
}

/**
 * Whether (cx,cy) counts toward spatial resource resId for a building anchored at (ax,ay).
 * Cells occupied by another building's anchor are excluded from gathering (0% for that tile).
 */
function footprintCellCountsForGathering(cell, cx, cy, resId, ax, ay, width, height, opts) {
  if (!cell) return false;
  // Grass (livestock): only surrounding footprint cells count — not the building anchor (needs 8 in a 3×3 ring, etc.).
  if (resId === 'grass' && cx === ax && cy === ay) return false;
  if (cell.building && (cx !== ax || cy !== ay)) return false;
  if (resId === 'water_tile') return cellProvidesWaterTile(cell, cx, cy, width, height, opts);
  return matchesTileResource(cell, resId);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    COPPER_MINE_DEPOSIT_IDS,
    copperMineFamilyTileCount,
    buildingGatheringUsesDeposit,
    matchesTileResource,
    cellProvidesWaterTile,
    footprintCellCountsForGathering,
  };
}
