// ===== SAVE ANALYSIS: TILE INPUT UTILIZATION =====
// Overlapping spatial claims: each claimant gets 1/n of a contested tile (e.g. two pig ranches → 50% each).
// Cells with another building's anchor are excluded by footprintCellCountsForGathering (0% for that tile).

function defaultTileUtilDeps() {
  return {
    getBuildingData: typeof getBuildingData === 'function' ? getBuildingData : null,
    FOOTPRINTS: typeof FOOTPRINTS !== 'undefined' ? FOOTPRINTS : null,
    TILE_RESOURCE_IDS: typeof TILE_RESOURCE_IDS !== 'undefined' ? TILE_RESOURCE_IDS : null,
    LOCATION_REQUIREMENTS: typeof LOCATION_REQUIREMENTS !== 'undefined' ? LOCATION_REQUIREMENTS : null,
    footprintCellCountsForGathering:
      typeof footprintCellCountsForGathering === 'function' ? footprintCellCountsForGathering : null,
    placeableTerrain: typeof PLACEABLE_TERRAIN !== 'undefined' ? PLACEABLE_TERRAIN : null,
  };
}

function geomOptsFromDeps(deps) {
  return deps && deps.placeableTerrain ? { placeableTerrain: deps.placeableTerrain } : undefined;
}

/**
 * @param {{ width: number, height: number, cells: object[][], buildings: {id:string,x:number,y:number}[] }} island
 * @param {object} [deps] - optional; browser uses globals when omitted
 * @returns {Map<string, { id: string, x: number, y: number }[]>}
 */
function buildSpatialTileClaimantsMap(island, deps) {
  const d = deps || defaultTileUtilDeps();
  const map = new Map();
  if (!island || !island.cells || !island.buildings) return map;
  if (!d.getBuildingData || !d.FOOTPRINTS || !d.TILE_RESOURCE_IDS || !d.footprintCellCountsForGathering) {
    return map;
  }

  const { width, height, cells, buildings } = island;
  const gopts = geomOptsFromDeps(d);

  for (const b of buildings) {
    const building = d.getBuildingData(b.id);
    if (!building || !building.inputs) continue;

    const fp = d.FOOTPRINTS[b.id];
    if (!fp) continue;

    for (const [resId, amount] of Object.entries(building.inputs)) {
      if (!d.TILE_RESOURCE_IDS.has(resId)) continue;
      if (!amount || amount <= 0) continue;
      if (resId === 'river' && d.LOCATION_REQUIREMENTS && d.LOCATION_REQUIREMENTS[b.id]) continue;

      for (const [dx, dy] of fp) {
        const fx = b.x + dx;
        const fy = b.y + dy;
        if (fx < 0 || fx >= width || fy < 0 || fy >= height) {
          if (resId === 'water_tile') {
            const key = `${fx},${fy},${resId}`;
            const entry = { id: b.id, x: b.x, y: b.y };
            const list = map.get(key);
            if (list) list.push(entry);
            else map.set(key, [entry]);
          }
          continue;
        }

        const cell = cells[fy][fx];
        if (!d.footprintCellCountsForGathering(cell, fx, fy, resId, b.x, b.y, width, height, gopts)) {
          continue;
        }

        const key = `${fx},${fy},${resId}`;
        const entry = { id: b.id, x: b.x, y: b.y };
        const list = map.get(key);
        if (list) list.push(entry);
        else map.set(key, [entry]);
      }
    }
  }

  return map;
}

function claimantKey(c) {
  return `${c.id}@${c.x},${c.y}`;
}

function effectiveSpatialInputUnits(island, plannerBuildingId, anchorX, anchorY, resId, needed, claimantsMap, deps) {
  const d = deps || defaultTileUtilDeps();
  const fp = d.FOOTPRINTS && d.FOOTPRINTS[plannerBuildingId];
  if (!fp || !island || !d.footprintCellCountsForGathering) return { effective: needed, cappedRatio: 1 };

  const { width, height, cells } = island;
  const gopts = geomOptsFromDeps(d);
  let sum = 0;
  const myKey = claimantKey({ id: plannerBuildingId, x: anchorX, y: anchorY });

  for (const [dx, dy] of fp) {
    const fx = anchorX + dx;
    const fy = anchorY + dy;
    if (fx < 0 || fx >= width || fy < 0 || fy >= height) {
      if (resId === 'water_tile') {
        const key = `${fx},${fy},${resId}`;
        const claimants = claimantsMap.get(key) || [];
        const n = claimants.filter(c => claimantKey(c) === myKey).length;
        const total = claimants.length;
        if (total > 0) sum += n / total;
      }
      continue;
    }

    const cell = cells[fy][fx];
    if (!d.footprintCellCountsForGathering(cell, fx, fy, resId, anchorX, anchorY, width, height, gopts)) {
      continue;
    }

    const key = `${fx},${fy},${resId}`;
    const claimants = claimantsMap.get(key) || [];
    const n = claimants.filter(c => claimantKey(c) === myKey).length;
    const total = claimants.length;
    if (total > 0) sum += n / total;
  }

  const cappedRatio = needed > 0 ? Math.min(1, sum / needed) : 1;
  return { effective: sum, needed, cappedRatio };
}

/**
 * @returns {{ tileUtilizationFactor: number, spatialBreakdown: object[] | null }}
 */
function computeTileUtilizationForProducer(island, plannerBuildingId, xy, claimantsMap, deps) {
  const d = deps || defaultTileUtilDeps();
  if (!island || !Array.isArray(xy) || xy.length < 2) {
    return { tileUtilizationFactor: 1, spatialBreakdown: null };
  }

  const building = d.getBuildingData ? d.getBuildingData(plannerBuildingId) : null;
  if (!building || !building.inputs) {
    return { tileUtilizationFactor: 1, spatialBreakdown: null };
  }

  const bx = xy[0];
  const by = xy[1];
  const spatialRatios = [];
  const breakdown = [];

  for (const [resId, needed] of Object.entries(building.inputs)) {
    if (!d.TILE_RESOURCE_IDS || !d.TILE_RESOURCE_IDS.has(resId)) continue;
    if (!needed || needed <= 0) continue;
    if (resId === 'river' && d.LOCATION_REQUIREMENTS && d.LOCATION_REQUIREMENTS[plannerBuildingId]) continue;

    const { effective, cappedRatio } = effectiveSpatialInputUnits(
      island,
      plannerBuildingId,
      bx,
      by,
      resId,
      needed,
      claimantsMap,
      d
    );
    spatialRatios.push(cappedRatio);
    breakdown.push({ resId, needed, effectiveUnits: effective, ratio: cappedRatio });
  }

  if (!spatialRatios.length) {
    return { tileUtilizationFactor: 1, spatialBreakdown: null };
  }

  const tileUtilizationFactor = Math.min(...spatialRatios);
  return { tileUtilizationFactor, spatialBreakdown: breakdown };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildSpatialTileClaimantsMap,
    computeTileUtilizationForProducer,
    defaultTileUtilDeps,
  };
}
