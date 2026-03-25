// ===== SAVE ANALYSIS: TILE INPUT UTILIZATION =====
// HorseBreeder: linear grass — output scales as producePerMinute × (utilizedGrassCells / grassNeed);
//   rickyard ×2 applied separately in save-analysis (not folded into tileUtil).
// Cattle/pig/sheep grass pools: connected overlap components; cattle also island-wide merge (see below).
// Non-grass spatial inputs + water_tile: count matching cells per building only (matches in-game footprint
// UI — overlapping same-type harvesters each get full credit per cell). Grass for pig/sheep/cattle: pool + 1/m in union.

/** Planner ids that use aggregate grass pools (not linear per-building horse math). */
const GRASS_POOL_PLANNER_IDS = {
  CattleRanch: true,
  PigRanch: true,
  SheepFarm: true,
};

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

function anchorKey(x, y) {
  return `${x},${y}`;
}

function footprintCellKeys(plannerBuildingId, ax, ay, deps) {
  const d = deps || defaultTileUtilDeps();
  const fp = d.FOOTPRINTS && d.FOOTPRINTS[plannerBuildingId];
  if (!fp) return new Set();
  const keys = new Set();
  for (let i = 0; i < fp.length; i++) {
    keys.add(anchorKey(ax + fp[i][0], ay + fp[i][1]));
  }
  return keys;
}

function footprintsIntersect(keysA, keysB) {
  for (const k of keysA) {
    if (keysB.has(k)) return true;
  }
  return false;
}

/**
 * @returns {Map<string, number>} anchorKey "x,y" -> grass tile utilization for that producer
 */
function buildGrassPoolRatiosByAnchor(island, deps) {
  const d = deps || defaultTileUtilDeps();
  const out = new Map();
  if (!island || !island.buildings || !d.getBuildingData || !d.FOOTPRINTS) return out;

  const members = [];
  for (let i = 0; i < island.buildings.length; i++) {
    const b = island.buildings[i];
    const plannerId = b.id;
    if (!GRASS_POOL_PLANNER_IDS[plannerId]) continue; // HorseBreeder: per-building linear, not pooled
    const building = d.getBuildingData(plannerId);
    if (!building || !building.inputs || !building.inputs.grass) continue;
    const need = building.inputs.grass;
    if (!(need > 0)) continue;
    const cellKeys = footprintCellKeys(plannerId, b.x, b.y, d);
    if (!cellKeys.size) continue;
    members.push({
      plannerId: plannerId,
      ax: b.x,
      ay: b.y,
      grassNeed: need,
      cellKeys: cellKeys,
    });
  }

  if (!members.length) return out;

  const n = members.length;
  const adj = [];
  for (let i = 0; i < n; i++) adj.push([]);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (footprintsIntersect(members[i].cellKeys, members[j].cellKeys)) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }

  /** Cattle ranches: one aggregate grass pool per island (sum of needs capped by union). */
  const ISLAND_WIDE_GRASS_POOL_TYPES = { CattleRanch: true };
  const byType = new Map();
  for (let i = 0; i < n; i++) {
    const pid = members[i].plannerId;
    if (!ISLAND_WIDE_GRASS_POOL_TYPES[pid]) continue;
    if (!byType.has(pid)) byType.set(pid, []);
    byType.get(pid).push(i);
  }
  for (const idxList of byType.values()) {
    if (idxList.length < 2) continue;
    for (let a = 0; a < idxList.length; a++) {
      for (let b = a + 1; b < idxList.length; b++) {
        const i = idxList[a];
        const j = idxList[b];
        if (!adj[i].includes(j)) {
          adj[i].push(j);
          adj[j].push(i);
        }
      }
    }
  }

  const visited = new Array(n).fill(false);
  const { width, height, cells } = island;
  const gopts = geomOptsFromDeps(d);
  const fcg = d.footprintCellCountsForGathering;

  for (let s = 0; s < n; s++) {
    if (visited[s]) continue;
    const stack = [s];
    visited[s] = true;
    const compIdx = [];
    while (stack.length) {
      const u = stack.pop();
      compIdx.push(u);
      for (let k = 0; k < adj[u].length; k++) {
        const v = adj[u][k];
        if (!visited[v]) {
          visited[v] = true;
          stack.push(v);
        }
      }
    }

    const union = new Set();
    let maxCap = 0;
    for (let c = 0; c < compIdx.length; c++) {
      const m = members[compIdx[c]];
      maxCap += m.grassNeed;
      m.cellKeys.forEach(function (key) {
        union.add(key);
      });
    }
    const groupMax = Math.min(union.size, maxCap);
    let usedGrass = 0;
    if (groupMax > 0 && fcg) {
      union.forEach(function (key) {
        const parts = key.split(',');
        const fx = parseInt(parts[0], 10);
        const fy = parseInt(parts[1], 10);
        if (fx < 0 || fx >= width || fy < 0 || fy >= height) return;
        const cell = cells[fy][fx];
        let footprintMembers = 0;
        let anyGather = false;
        for (let c = 0; c < compIdx.length; c++) {
          const m = members[compIdx[c]];
          if (!m.cellKeys.has(key)) continue;
          footprintMembers++;
          if (fcg(cell, fx, fy, 'grass', m.ax, m.ay, width, height, gopts)) anyGather = true;
        }
        if (anyGather && footprintMembers > 0) usedGrass += 1 / footprintMembers;
      });
    }

    const ratio = groupMax > 0 ? Math.min(1, usedGrass / groupMax) : 1;
    for (let c = 0; c < compIdx.length; c++) {
      const m = members[compIdx[c]];
      out.set(anchorKey(m.ax, m.ay), ratio);
    }
  }

  return out;
}

/** Raw count of gatherable grass cells in this building's footprint (no 1/n split). */
function countGatherableGrassCellsInFootprint(island, plannerBuildingId, anchorX, anchorY, deps) {
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
    if (fx < 0 || fx >= width || fy < 0 || fy >= height) continue;
    const cell = cells[fy][fx];
    if (fcg(cell, fx, fy, 'grass', anchorX, anchorY, width, height, gopts)) n++;
  }
  return n;
}

/**
 * Per-building count of footprint cells that match resId (game UI style: no 1/n split between buildings).
 * Out-of-bounds water_tile still counts via cellProvidesWaterTile rules.
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

/** Grass livestock overlap: 1/n per cell (claimants map). */
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
 * @param {Map<string, number>} [grassPoolRatios] from buildGrassPoolRatiosByAnchor
 * @returns {{ tileUtilizationFactor: number, spatialBreakdown: object[] | null }}
 */
function computeTileUtilizationForProducer(island, plannerBuildingId, xy, claimantsMap, deps, grassPoolRatios) {
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
  const poolRatio =
    grassPoolRatios && grassPoolRatios.get
      ? grassPoolRatios.get(anchorKey(bx, by))
      : undefined;
  const useGrassPool =
    poolRatio != null &&
    GRASS_POOL_PLANNER_IDS[plannerBuildingId] &&
    building.inputs.grass > 0;

  const spatialRatios = [];
  const breakdown = [];

  for (const [resId, needed] of Object.entries(building.inputs)) {
    if (!d.TILE_RESOURCE_IDS || !d.TILE_RESOURCE_IDS.has(resId)) continue;
    if (!needed || needed <= 0) continue;
    if (resId === 'river' && d.LOCATION_REQUIREMENTS && d.LOCATION_REQUIREMENTS[plannerBuildingId]) continue;

    let cappedRatio;
    let effective;
    if (resId === 'grass' && plannerBuildingId === 'HorseBreeder') {
      const raw = countGatherableGrassCellsInFootprint(island, plannerBuildingId, bx, by, d);
      cappedRatio = needed > 0 ? Math.min(1, raw / needed) : 1;
      effective = raw;
    } else if (resId === 'grass' && useGrassPool) {
      cappedRatio = poolRatio;
      effective = cappedRatio * needed;
    } else if (resId === 'grass') {
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

if (typeof globalThis !== 'undefined') {
  globalThis.buildGrassPoolRatiosByAnchor = buildGrassPoolRatiosByAnchor;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildSpatialTileClaimantsMap,
    buildGrassPoolRatiosByAnchor,
    computeTileUtilizationForProducer,
    countGatherableGrassCellsInFootprint,
    countIndependentSpatialCells,
    defaultTileUtilDeps,
    GRASS_POOL_PLANNER_IDS,
  };
}
