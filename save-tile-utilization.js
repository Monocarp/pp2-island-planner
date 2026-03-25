// ===== SAVE ANALYSIS: TILE INPUT UTILIZATION =====
// Grass (cattle, horse, pig, sheep): shared evenly — 1/n per footprint cell among all overlapping claimants.
// Other tile resources: per-building count only (same-type harvesters each get full credit per cell; different
//   resource types cannot occupy one save cell).
// water_tile: 1/n on OOB keys like grass.

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

/**
 * Per-building count of footprint cells that match resId (no 1/n — game UI for same-type harvest / deposits).
 */
function countIndependentSpatialCells(island, plannerBuildingId, anchorX, anchorY, resId, deps) {
  const d = deps || defaultTileUtilDeps();
  const fp = d.FOOTPRINTS && d.FOOTPRINTS[plannerBuildingId];
  const fcg = d.footprintCellCountsForGathering;
  if (!fp || !island || !fcg) return 0;
  const { width, height, cells } = island;
  const gopts = geomOptsFromDeps(d);
  let n = 0;
  for (let i = 0; i < fp.length; i++) {
    const fx = anchorX + fp[i][0];
    const fy = anchorY + fp[i][1];
    if (fx < 0 || fx >= width || fy < 0 || fy >= height) {
      if (resId === 'water_tile') {
        const offMapWater = { terrain: 'water', deposit: null, building: null };
        if (fcg(offMapWater, fx, fy, resId, anchorX, anchorY, width, height, gopts)) n++;
      }
      continue;
    }
    const cell = cells[fy][fx];
    if (fcg(cell, fx, fy, resId, anchorX, anchorY, width, height, gopts)) n++;
  }
  return n;
}

/** Grass + water_tile: 1/n per cell among overlapping footprints (claimants map). */
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

    let cappedRatio;
    let effective;
    if (resId === 'grass' || resId === 'water_tile') {
      const u = effectiveSpatialInputUnits(
        island,
        plannerBuildingId,
        bx,
        by,
        resId,
        needed,
        claimantsMap,
        d
      );
      effective = u.effective;
      cappedRatio = u.cappedRatio;
    } else {
      const raw = countIndependentSpatialCells(island, plannerBuildingId, bx, by, resId, d);
      cappedRatio = needed > 0 ? Math.min(1, raw / needed) : 1;
      effective = raw;
    }
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
    countIndependentSpatialCells,
    defaultTileUtilDeps,
    effectiveSpatialInputUnits,
  };
}
