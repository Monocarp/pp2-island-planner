// ===== PRODUCTION PLANNER =====

// Population building IDs mapped to display tier names
const POP_BUILDINGS = [
  { id: 'PopulationPioneersHut',     label: 'Pioneer Huts',     tier: 'Pioneers' },
  { id: 'PopulationColonistsHouse',  label: 'Colonist Houses',  tier: 'Colonists' },
  { id: 'PopulationTownsmenHouse',   label: 'Townsmen Houses',  tier: 'Townsmen' },
  { id: 'PopulationFarmersShack',    label: 'Farmer Shacks',    tier: 'Farmers' },
  { id: 'PopulationMerchantsMansion',label: 'Merchant Mansions', tier: 'Merchants' },
  { id: 'PopulationWorkersHouse',    label: 'Worker Houses',    tier: 'Workers' },
  { id: 'PopulationParagonsResidence',label: 'Paragon Residences',tier: 'Paragons' },
];

function buildPlannerInputs() {
  const el = document.getElementById('planner-inputs');
  el.innerHTML = POP_BUILDINGS.map(pb =>
    `<div class="planner-row">
      <label>${pb.label}:</label>
      <input type="number" id="planner-${pb.id}" min="0" value="0" data-pop-id="${pb.id}">
    </div>`
  ).join('');
}

// Calculate total resource demand from population houses
function getPopulationDemand() {
  const demand = {}; // resourceId -> totalPerMinute
  POP_BUILDINGS.forEach(pb => {
    const input = document.getElementById(`planner-${pb.id}`);
    const count = parseInt(input.value) || 0;
    if (count === 0) return;
    const building = PP2DATA.getBuilding(pb.id);
    if (!building || !building.consumePerMinute) return;
    for (const [resId, rate] of Object.entries(building.consumePerMinute)) {
      if (SERVICE_RESOURCES.has(resId)) continue; // skip service needs
      demand[resId] = (demand[resId] || 0) + rate * count;
    }
  });
  return demand;
}

// Recursively resolve production chains.
// Tiles with iterationTime=1 are spatial (grass, water, deposits) - counted per building footprint.
// Tiles with real iteration times (apple trees, forests, fields) - counted by production rate.

// Tier priority for default producer selection (lower index = preferred)
const TIER_PRIORITY = ['Pioneers', 'Colonists', 'Townsmen', 'Farmers', 'Merchants', 'Workers', 'Paragons', 'Northern Islands'];

function pickProducer(resourceId, producers) {
  // Check user override first
  if (state.producerOverrides[resourceId]) {
    const override = producers.find(p => p.id === state.producerOverrides[resourceId]);
    if (override) return override;
  }
  // Filter to only buildings (not tiles)
  const buildings = producers.filter(p => PP2DATA.getBuilding(p.id));
  if (buildings.length === 0) return producers[0];
  if (buildings.length === 1) return buildings[0];
  // Prefer lowest tier
  buildings.sort((a, b) => {
    const ta = TIER_PRIORITY.indexOf(a.tier);
    const tb = TIER_PRIORITY.indexOf(b.tier);
    return (ta === -1 ? 99 : ta) - (tb === -1 ? 99 : tb);
  });
  return buildings[0];
}

function resolveProductionChain(demand) {
  const result = {};     // buildingId -> { building, count, producedResource, alternatives }
  const tileNeeds = {};  // tileId -> { tile, count, producedResource, isSpatial }
  const visited = new Set();

  // Identify spatial tiles (iterationTime=1, e.g. grass, water, deposits, river)
  const spatialTileResources = new Set();
  PP2DATA.tiles.forEach(t => { if (t.iterationTime <= 1) spatialTileResources.add(t.produces); });

  function resolve(resourceId, rateNeeded) {
    if (rateNeeded <= 0) return;
    if (SERVICE_RESOURCES.has(resourceId)) return;

    // Spatial tile resources — skip rate resolution, counted per-building below
    if (spatialTileResources.has(resourceId)) return;

    // Find producers for this resource
    const producers = PP2DATA.getProducersOf(resourceId);
    if (!producers || producers.length === 0) return;

    // Check if this is a regenerating tile resource (apple_trees, forest, fields)
    if (TILE_RESOURCE_IDS.has(resourceId)) {
      const tile = producers.find(p => PP2DATA.getTile(p.id)) || producers[0];
      if (!tile || !tile.producePerMinute) return;
      const countNeeded = rateNeeded / tile.producePerMinute;
      if (tileNeeds[tile.id]) {
        tileNeeds[tile.id].count += countNeeded;
      } else {
        tileNeeds[tile.id] = { tile, count: countNeeded, producedResource: resourceId, isSpatial: false };
      }
      return;
    }

    // Pick producer (user override or tier-based default)
    const allBuildings = producers.filter(p => PP2DATA.getBuilding(p.id));
    const producer = pickProducer(resourceId, producers);

    if (!producer || !producer.producePerMinute) return;

    const countNeeded = rateNeeded / producer.producePerMinute;

    if (result[producer.id]) {
      result[producer.id].count += countNeeded;
    } else {
      result[producer.id] = {
        building: producer,
        count: countNeeded,
        producedResource: resourceId,
        alternatives: allBuildings.length > 1 ? allBuildings : null,
      };
    }

    // Recurse into this producer's inputs
    if (producer.consumePerMinute && !visited.has(producer.id + ':' + resourceId)) {
      visited.add(producer.id + ':' + resourceId);
      for (const [inputRes, inputRate] of Object.entries(producer.consumePerMinute)) {
        resolve(inputRes, inputRate * countNeeded);
      }
    }
  }

  for (const [resId, rate] of Object.entries(demand)) {
    resolve(resId, rate);
  }

  // Collect spatial tile needs from building inputs (grass, water_tile, deposits, etc.)
  // Use fractional building count, not ceiled
  for (const entry of Object.values(result)) {
    const b = entry.building;
    if (!b.inputs) continue;
    for (const [resId, amountPerIter] of Object.entries(b.inputs)) {
      if (spatialTileResources.has(resId)) {
        const tile = (PP2DATA.getProducersOf(resId) || []).find(p => PP2DATA.getTile(p.id));
        if (!tile) continue;
        const totalTiles = entry.count * amountPerIter;
        if (tileNeeds[tile.id]) {
          tileNeeds[tile.id].count += totalTiles;
        } else {
          tileNeeds[tile.id] = { tile, count: totalTiles, producedResource: resId, isSpatial: true };
        }
      }
    }
  }

  return { buildings: result, tileNeeds };
}

function cycleProducer(resourceId, currentBuildingId) {
  const producers = (PP2DATA.getProducersOf(resourceId) || []).filter(p => PP2DATA.getBuilding(p.id));
  if (producers.length <= 1) return;
  const idx = producers.findIndex(p => p.id === currentBuildingId);
  const next = producers[(idx + 1) % producers.length];
  state.producerOverrides[resourceId] = next.id;
  calculateProduction();
}

function calculateProduction() {
  const demand = getPopulationDemand();
  const el = document.getElementById('planner-results');

  if (Object.keys(demand).length === 0) {
    el.innerHTML = '<span style="color:#666">Set at least one house count above 0</span>';
    state.plannerActive = false;
    return;
  }

  state.plannerActive = true;
  const { buildings, tileNeeds } = resolveProductionChain(demand);

  // Compare with placed buildings on island
  const placedCounts = {};
  if (state.island) {
    state.island.buildings.forEach(b => {
      placedCounts[b.id] = (placedCounts[b.id] || 0) + 1;
    });
  }

  // Group by the final consumed resource (what population needs)
  // For display, organize as: demand resource -> chain of buildings
  let html = '';

  // === Resource demand summary ===
  html += '<div class="planner-section"><h5>Resource Demand (per min)</h5>';
  const sortedDemand = Object.entries(demand).sort((a, b) => b[1] - a[1]);
  for (const [resId, rate] of sortedDemand) {
    html += `<div class="planner-summary-row">
      <span>${PP2DATA.getResourceName(resId)}</span>
      <span>${rate.toFixed(3)}/min</span>
    </div>`;
  }
  html += '</div>';

  // === Building requirements ===
  html += '<div class="planner-section"><h5>Buildings Needed</h5>';
  const sortedBuildings = Object.values(buildings).sort((a, b) => {
    const tierOrder = ['Pioneers', 'Colonists', 'Townsmen', 'Farmers', 'Merchants', 'Workers', 'Paragons', 'Northern Islands'];
    const ta = tierOrder.indexOf(a.building.tier);
    const tb = tierOrder.indexOf(b.building.tier);
    if (ta !== tb) return ta - tb;
    return a.building.name.localeCompare(b.building.name);
  });

  let totalBuildings = 0;
  let currentTier = '';
  for (const entry of sortedBuildings) {
    const { building, count, producedResource, alternatives } = entry;
    const rounded = Math.ceil(count);
    totalBuildings += rounded;
    const placed = placedCounts[building.id] || 0;
    const isFractional = count % 1 > 0.01 && count % 1 < 0.99;

    if (building.tier !== currentTier) {
      currentTier = building.tier;
      html += `<div class="planner-resource-header"><span>${currentTier}</span></div>`;
    }

    const statusColor = placed >= rounded ? '#2ecc71' : placed > 0 ? '#f39c12' : '#e74c3c';
    const altHtml = alternatives ? ` <span class="producer-switch" title="Click to change producer" onclick="cycleProducer('${producedResource}','${building.id}')">\u21C5</span>` : '';
    html += `<div class="planner-building-row${isFractional ? ' fractional' : ''}">
      <span>${building.name}${altHtml} <span style="color:#666;font-size:0.6rem">(${PP2DATA.getResourceName(producedResource)})</span></span>
      <span><span style="color:${statusColor}">${placed}</span>/<span class="count">${rounded}</span>${isFractional ? ` <span style="color:#666;font-size:0.6rem">(${count.toFixed(2)})</span>` : ''}</span>
    </div>`;
  }
  html += `<div class="planner-summary-row" style="font-weight:600;margin-top:4px;">
    <span>Total production buildings</span><span>${totalBuildings}</span>
  </div>`;
  html += '</div>';

  // === Tile resource needs ===
  if (Object.keys(tileNeeds).length > 0) {
    html += '<div class="planner-section"><h5>Tile Resources Needed</h5>';
    for (const [tileId, entry] of Object.entries(tileNeeds)) {
      const rounded = Math.ceil(entry.count);
      const isFractional = entry.count % 1 > 0.01 && entry.count % 1 < 0.99;
      const label = entry.isSpatial ? 'footprint' : 'regen';
      html += `<div class="planner-building-row${isFractional ? ' fractional' : ''}">
        <span>${entry.tile.name} <span style="color:#666;font-size:0.6rem">(${label})</span></span>
        <span class="count">${rounded}${isFractional ? ` <span style="color:#666;font-size:0.6rem">(${entry.count.toFixed(2)})</span>` : ''}</span>
      </div>`;
    }
    html += '</div>';
  }

  // === Population house summary ===
  html += '<div class="planner-section"><h5>Population Houses</h5>';
  POP_BUILDINGS.forEach(pb => {
    const count = parseInt(document.getElementById(`planner-${pb.id}`).value) || 0;
    if (count > 0) {
      const placed = placedCounts[pb.id] || 0;
      const statusColor = placed >= count ? '#2ecc71' : placed > 0 ? '#f39c12' : '#e74c3c';
      html += `<div class="planner-building-row">
        <span>${pb.label}</span>
        <span><span style="color:${statusColor}">${placed}</span>/<span class="count">${count}</span></span>
      </div>`;
    }
  });
  html += '</div>';

  el.innerHTML = html;
}

// ===== AUTO-POPULATE =====

function sortProductionListByConstraint(list) {
  list.sort((a, b) => {
    const constraintScore = (item) => {
      let score = 0;
      const bld = item.building;
      if (LOCATION_REQUIREMENTS[item.id]) {
        const req = LOCATION_REQUIREMENTS[item.id];
        if (req.type === 'straight_river') score += 100;
        else if (req.type === 'in_water_coastal') score += 90;
        else if (req.type === 'ocean_adjacent') score += 80;
        else if (req.type === 'river_adjacent') score += 70;
      }
      if (bld.inputs) {
        for (const [resId, amt] of Object.entries(bld.inputs)) {
          if (!TILE_RESOURCE_IDS.has(resId)) continue;
          if (resId.includes('deposit') || resId === 'cliff') score += 200;
          else if (resId === 'grass') score += amt;
        }
      }
      return score;
    };
    return constraintScore(b) - constraintScore(a);
  });
}

// Check if a building can be placed at (x, y) — footprint cells must be valid terrain;
// only the anchor cell must be free (other buildings may overlap coverage areas).
function canAutoPlace(buildingId, x, y) {
  const { width, height, cells } = state.island;
  const fp = FOOTPRINTS[buildingId] || [[0, 0]];
  const locReq = LOCATION_REQUIREMENTS[buildingId];
  const building = getBuildingData(buildingId);

  // Does this building legitimately need water/coastal tiles within its footprint?
  // If so, we must not reject positions where non-anchor cells fall on water.
  const acceptsWaterInFootprint =
    (locReq && locReq.type === 'in_water_coastal') ||
    (building && building.inputs && 'water_tile' in building.inputs);

  for (const [dx, dy] of fp) {
    const cx = x + dx, cy = y + dy;
    if (cx < 0 || cx >= width || cy < 0 || cy >= height) return false;
    const cell = cells[cy][cx];
    if (dx === 0 && dy === 0) {
      if (cell.building) return false;
      if (!canPlaceOnTerrain(buildingId, cell.terrain)) return false;
    } else {
      if (!acceptsWaterInFootprint && cell.terrain === 'water') return false;
    }
  }
  // Location requirements (river, ocean, etc.)
  const locCheck = checkLocationRequirement(buildingId, x, y);
  if (!locCheck.ok) return false;
  return true;
}

// Count how many tiles of a given resource type are in the footprint at (x,y).
// If claimedCells is provided (Set of "cx,cy" strings), those cells are skipped
// so that multiple buildings don't double-count the same spatial tiles (e.g. grass).
function countTileResource(buildingId, x, y, resId, claimedCells) {
  const { width, height, cells } = state.island;
  const fp = FOOTPRINTS[buildingId] || [[0,0]];
  let count = 0;
  for (const [dx, dy] of fp) {
    const cx = x + dx, cy = y + dy;
    if (cx >= 0 && cx < width && cy >= 0 && cy < height) {
      if (claimedCells && claimedCells.has(`${cx},${cy}`)) continue;
      const cell = cells[cy][cx];
      if (footprintCellCountsForGathering(cell, cx, cy, resId, x, y, width, height)) count++;
    } else if (resId === 'water_tile') {
      count++; // out-of-bounds = ocean (unused when canAutoPlace keeps footprint on-map)
    }
  }
  return count;
}

// Mark all spatial tile resource cells in a building's footprint as claimed.
// Called after auto-placing a building so subsequent buildings won't overlap on grass/deposits.
function claimTileResourceCells(buildingId, x, y, claimedCells) {
  const { width, height, cells } = state.island;
  const fp = FOOTPRINTS[buildingId] || [[0,0]];
  const building = getBuildingData(buildingId);
  if (!building || !building.inputs) return;
  const spatialResources = new Set(
    Object.keys(building.inputs).filter(r => TILE_RESOURCE_IDS.has(r))
  );
  if (spatialResources.size === 0) return;
  for (const [dx, dy] of fp) {
    const cx = x + dx, cy = y + dy;
    if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
    const cell = cells[cy][cx];
    for (const resId of spatialResources) {
      if (footprintCellCountsForGathering(cell, cx, cy, resId, x, y, width, height)) {
        claimedCells.add(`${cx},${cy}`);
        break;
      }
    }
  }
}

// Check if position (x,y) is within any warehouse's footprint
function isInWarehouseRange(x, y) {
  const warehouseIds = ['Warehouse1', 'Warehouse2', 'Warehouse3'];
  for (const b of state.island.buildings) {
    if (!warehouseIds.includes(b.id)) continue;
    const fp = FOOTPRINTS[b.id];
    if (!fp) continue;
    for (const [dx, dy] of fp) {
      if (b.x + dx === x && b.y + dy === y) return true;
    }
  }
  return false;
}

// Check if position (x,y) is covered by any placed building that provides
// the given service resource. Checks all providers (not just one canonical type)
// so that e.g. HarborTavern and Tavern both count for 'community'.
function isInServiceCoverage(x, y, serviceResId) {
  for (const b of state.island.buildings) {
    const bld = getBuildingData(b.id);
    if (!bld || bld.isPopulation) continue;
    if (bld.produces !== serviceResId) continue;
    const fp = FOOTPRINTS[b.id];
    if (!fp) continue;
    for (const [dx, dy] of fp) {
      if (b.x + dx === x && b.y + dy === y) return true;
    }
  }
  return false;
}

// Count uncovered land cells that a warehouse at (wx,wy) would newly cover
function countNewWarehouseCoverage(whId, wx, wy) {
  const { width, height, cells } = state.island;
  const fp = FOOTPRINTS[whId];
  if (!fp) return 0;
  let newCells = 0;
  for (const [dx, dy] of fp) {
    const cx = wx + dx, cy = wy + dy;
    if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
    const cell = cells[cy][cx];
    if (cell.terrain === 'water') continue;
    if (!isInWarehouseRange(cx, cy)) newCells++;
  }
  return newCells;
}

// Pick best warehouse tier based on what's unlocked
function pickWarehouseId() {
  if (state.unlockedBuildings.has('Warehouse3')) return 'Warehouse3';
  if (state.unlockedBuildings.has('Warehouse2')) return 'Warehouse2';
  return 'Warehouse1';
}

// Find all valid positions for a building, sorted by score.
// opts.claimedCells: Set of "cx,cy" strings — spatial tiles already used by prior buildings.
// opts.ignoreTileResources: Set of resIds to skip when checking tile requirements (e.g. to find
//   a position where we will paint deposits before placing).
// opts.reservedFootprints: [{x,y,id}] — positions reserved for upcoming placements (skip overlap).
function findBestPositions(buildingId, building, opts) {
  const { width, height } = state.island;
  const requireWarehouse = opts && opts.requireWarehouse;
  const claimedCells = (opts && opts.claimedCells) || null;
  const ignoreTileResources = (opts && opts.ignoreTileResources) || null;
  const reservedFootprints = (opts && opts.reservedFootprints) || [];
  const fp = FOOTPRINTS[buildingId] || [[0, 0]];
  const candidates = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!canAutoPlace(buildingId, x, y)) continue;
      if (requireWarehouse && !isInWarehouseRange(x, y)) continue;
      let overlapsReserved = false;
      for (const r of reservedFootprints) {
        const rfp = FOOTPRINTS[r.id] || [[0, 0]];
        for (const [dx, dy] of fp) {
          const cx = x + dx, cy = y + dy;
          for (const [rdx, rdy] of rfp) {
            if (r.x + rdx === cx && r.y + rdy === cy) { overlapsReserved = true; break; }
          }
          if (overlapsReserved) break;
        }
        if (overlapsReserved) break;
      }
      if (overlapsReserved) continue;

      // Check tile resource inputs are satisfied (accounting for already-claimed tiles)
      let tileOk = true;
      if (building.inputs) {
        for (const [resId, needed] of Object.entries(building.inputs)) {
          if (!TILE_RESOURCE_IDS.has(resId)) continue;
          if (resId === 'river' && LOCATION_REQUIREMENTS[buildingId]) continue;
          if (ignoreTileResources && ignoreTileResources.has(resId)) continue;
          if (countTileResource(buildingId, x, y, resId, claimedCells) < needed) {
            tileOk = false;
            break;
          }
        }
      }
      if (!tileOk) continue;

      // Score: prefer central + tile resource richness
      const cx = width / 2, cy = height / 2;
      const dist = Math.abs(x - cx) + Math.abs(y - cy);
      let score = -dist * 0.1;
      if (building.inputs) {
        for (const [resId, needed] of Object.entries(building.inputs)) {
          if (!TILE_RESOURCE_IDS.has(resId)) continue;
          score += Math.min(countTileResource(buildingId, x, y, resId, claimedCells), needed) * 2;
        }
      }

      candidates.push({ x, y, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

// Place building during auto-populate — same anchor-only marking as manual placement.
function autoPlaceBuilding(buildingId, x, y) {
  placeBuilding(buildingId, x, y);
}

// Determine which service buildings are needed for the requested population houses
function getRequiredServices() {
  const needed = new Set();
  POP_BUILDINGS.forEach(pb => {
    const count = parseInt(document.getElementById(`planner-${pb.id}`).value) || 0;
    if (count === 0) return;
    const building = PP2DATA.getBuilding(pb.id);
    if (!building || !building.consumePerMinute) return;
    for (const resId of Object.keys(building.consumePerMinute)) {
      if (SERVICE_RESOURCES.has(resId)) needed.add(resId);
    }
  });
  return needed;
}

// Six service resources are consumed by population houses but have no dedicated
// producer entry in data.js — the buildings that provide them are registered
// under 'community' or another umbrella resource instead. This fallback map
// bridges that data gap.
const SERVICE_PROVIDER_FALLBACK = {
  'sports':       'SportsGround',
  'hygiene':      'Bathhouse',
  'trading':      'MarketHall',
  'cemetery':     'Cemetery',
  'entertainment':'Theatre',
  'gambling':     'Fair',
};

// Map service resource to best available provider building ID.
// Uses data.js producers table where it exists (data-driven, respects tier and
// unlocks). Falls back to SERVICE_PROVIDER_FALLBACK for service resources the
// data doesn't model with dedicated producers.
function pickServiceProvider(serviceResId) {
  // getProducersOf returns building objects; extract IDs before getBuildingData
  const producers = PP2DATA.getProducersOf(serviceResId);
  const candidates = producers
    .map(p => getBuildingData(p.id))
    .filter(b => b && !b.isPopulation && FOOTPRINTS[b.id] && FOOTPRINTS[b.id].length > 1);

  if (candidates.length === 0) {
    return SERVICE_PROVIDER_FALLBACK[serviceResId] || null;
  }

  const byTier = (a, b) => {
    const ta = TIER_PRIORITY.indexOf(a.tier);
    const tb = TIER_PRIORITY.indexOf(b.tier);
    return (ta === -1 ? 99 : ta) - (tb === -1 ? 99 : tb);
  };

  // Prefer buildings the player has unlocked in the palette
  const unlocked = candidates.filter(b => state.unlockedBuildings.has(b.id));
  const pool = unlocked.length > 0 ? unlocked : candidates;
  pool.sort((a, b) => {
    const tierDiff = byTier(a, b);
    if (tierDiff !== 0) return tierDiff;
    const sizeA = (FOOTPRINTS[a.id]?.length || 0);
    const sizeB = (FOOTPRINTS[b.id]?.length || 0);
    return sizeB - sizeA;
  });
  return pool[0].id;
}

// ===== AUTO-POPULATE DIAGNOSTICS =====

// Finds the best physically valid position for a building while ignoring tile
// resource requirements, then reports actual tile counts there.
// Used to produce verbose failure diagnostics (e.g. "grass: 4/8 at (12,8)").
function diagnosePlacementFailure(buildingId, building, opts) {
  const { width, height, cells } = state.island;
  const fp = FOOTPRINTS[buildingId] || [[0, 0]];
  const requireWarehouse = opts && opts.requireWarehouse;
  const locReq = LOCATION_REQUIREMENTS[buildingId];
  const acceptsWater = (locReq && locReq.type === 'in_water_coastal') ||
    (building && building.inputs && 'water_tile' in building.inputs);
  const cx = width / 2, cy = height / 2;
  let bestPos = null, bestDist = Infinity;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (requireWarehouse && !isInWarehouseRange(x, y)) continue;
      let canPlace = true;
      for (const [dx, dy] of fp) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) { canPlace = false; break; }
        const cell = cells[ny][nx];
        if (dx === 0 && dy === 0) {
          if (cell.building) { canPlace = false; break; }
          if (!canPlaceOnTerrain(buildingId, cell.terrain)) { canPlace = false; break; }
        } else if (!acceptsWater && cell.terrain === 'water') {
          canPlace = false; break;
        }
      }
      if (!canPlace) continue;
      const locCheck = checkLocationRequirement(buildingId, x, y);
      if (!locCheck.ok) continue;
      const dist = Math.abs(x - cx) + Math.abs(y - cy);
      if (dist < bestDist) { bestDist = dist; bestPos = { x, y }; }
    }
  }

  if (!bestPos) return null;

  const claimedCells = (opts && opts.claimedCells) || null;
  const tileCounts = {};
  if (building.inputs) {
    for (const [resId, needed] of Object.entries(building.inputs)) {
      if (!TILE_RESOURCE_IDS.has(resId)) continue;
      if (resId === 'river' && LOCATION_REQUIREMENTS[buildingId]) continue;
      tileCounts[resId] = {
        available: countTileResource(buildingId, bestPos.x, bestPos.y, resId, claimedCells),
        needed,
      };
    }
  }
  return { pos: bestPos, tileCounts };
}

// Emits a structured, collapsible console.group log for an auto-populate run.
function emitAutoPopulateLog(log) {
  const { islandSize, phases, coverage } = log;
  const totalPlaced = phases.warehouses.placed.length +
    phases.services.placed.length +
    phases.production.placed.length +
    phases.houses.placed.length +
    phases.topup.length;
  const totalFailed = phases.services.failed.length +
    phases.production.failed.length +
    phases.houses.failed.length;

  console.group(
    `%c[PP2 Auto-Populate]%c ${islandSize} — ${totalPlaced} placed, ${totalFailed} failed`,
    'font-weight:bold;color:#e94560', 'font-weight:normal;color:inherit'
  );

  // Phase 0
  console.group('Phase 0 — Warehouses');
  if (phases.warehouses.placed.length === 0) {
    console.log('No warehouses placed (already existed or no valid position)');
  } else {
    phases.warehouses.placed.forEach(w =>
      console.log(`✓ ${w.name} at (${w.x},${w.y})`));
  }
  if (phases.warehouses.coverage !== null) {
    const pct = (phases.warehouses.coverage * 100).toFixed(1);
    const style = phases.warehouses.coverage >= 0.55 ? 'color:green' : 'color:orange';
    console.log(`%cLand coverage: ${pct}%`, style);
  }
  console.groupEnd();

  // Phase 1
  const svcNeed = phases.services.placed.length + phases.services.failed.length;
  console.group(`Phase 1 — Services (${phases.services.placed.length}/${svcNeed} placed)`);
  phases.services.placed.forEach(s =>
    console.log(`✓ ${s.name} at (${s.x},${s.y}) [${s.serviceRes}]`));
  phases.services.failed.forEach(f =>
    console.warn(`✗ ${f.name} — ${f.reason}`));
  console.groupEnd();

  // Phase 1.5
  if (phases.deposits.length > 0) {
    console.group(`Phase 1.5 — Deposits (${phases.deposits.length} auto-placed)`);
    phases.deposits.forEach(d =>
      console.log(`+ ${d.name} deposit at (${d.x},${d.y})`));
    console.groupEnd();
  }

  // Phase 2
  const prodNeed = phases.production.placed.length + phases.production.failed.length;
  console.group(`Phase 2 — Production (${phases.production.placed.length}/${prodNeed} placed)`);
  phases.production.placed.forEach(p =>
    console.log(`✓ ${p.name} at (${p.x},${p.y})`));
  phases.production.failed.forEach(f => {
    if (f.diagnosis) {
      const tileStr = Object.entries(f.diagnosis.tileCounts)
        .map(([r, v]) => `${PP2DATA.getResourceName(r)}: ${v.available}/${v.needed}`)
        .join(', ');
      console.warn(
        `✗ ${f.name} — ${f.reason}`,
        `[best pos (${f.diagnosis.pos.x},${f.diagnosis.pos.y}): ${tileStr || 'n/a'}]`
      );
    } else {
      console.warn(`✗ ${f.name} — ${f.reason} [no physically valid position exists]`);
    }
  });
  console.groupEnd();

  // Phase 3
  const houseNeed = phases.houses.placed.length + phases.houses.failed.length;
  console.group(`Phase 3 — Houses (${phases.houses.placed.length}/${houseNeed} placed)`);
  phases.houses.placed.forEach(h => {
    if (h.svcTotal > 0 && h.svcCovered < h.svcTotal) {
      console.warn(`△ ${h.name} at (${h.x},${h.y}) — ${h.svcCovered}/${h.svcTotal} services covered`);
    } else {
      console.log(`✓ ${h.name} at (${h.x},${h.y})`);
    }
  });
  phases.houses.failed.forEach(f =>
    console.warn(`✗ ${f.name} — ${f.reason}`));
  console.groupEnd();

  // Phase 4
  if (phases.topup.length > 0) {
    console.group(`Phase 4 — Service top-up (${phases.topup.length} additional buildings)`);
    phases.topup.forEach(t =>
      console.log(`✓ ${t.providerName} at (${t.x},${t.y}) — covered ${t.coveredCount} houses [${t.serviceRes}] (${t.uncoveredBefore} uncovered before)`));
    console.groupEnd();
  } else {
    console.log('Phase 4 — No service top-up needed');
  }

  // Coverage summary
  if (Object.keys(coverage).length > 0) {
    console.group('Coverage summary');
    for (const [svcRes, c] of Object.entries(coverage)) {
      const ok = c.covered >= c.total;
      console.log(
        `%c${ok ? '✓' : '✗'} ${PP2DATA.getResourceName(svcRes)}: ${c.covered}/${c.total}`,
        ok ? 'color:green' : 'color:red'
      );
    }
    console.groupEnd();
  }

  console.groupEnd(); // [PP2 Auto-Populate]
}

// Main auto-populate function
function autoPopulate() {
  if (!state.island) return;

  const demand = getPopulationDemand();
  if (Object.keys(demand).length === 0) {
    alert('Set at least one house count above 0 before auto-populating.');
    return;
  }

  // Save undo state
  pushUndo();

  const { buildings: chainBuildings } = resolveProductionChain(demand);
  const { width, height } = state.island;

  const runLog = {
    islandSize: `${width}×${height}`,
    phases: {
      warehouses: { placed: [], coverage: null },
      services:   { placed: [], failed: [] },
      deposits:   [],
      production: { placed: [], failed: [] },
      houses:     { placed: [], failed: [] },
      topup:      [],
    },
    coverage: {},
  };

  // Already-placed counts (don't double-place)
  const placedCounts = {};
  state.island.buildings.forEach(b => {
    placedCounts[b.id] = (placedCounts[b.id] || 0) + 1;
  });

  // Tracks which spatial tile resource cells (e.g. grass) are already claimed by a placed
  // building, so that subsequent buildings don't overlap on the same grass/deposit tiles.
  const claimedCells = new Set();
  for (const b of state.island.buildings) {
    claimTileResourceCells(b.id, b.x, b.y, claimedCells);
  }

  // === Gather what we need to place ===

  // Production buildings from chain
  const productionList = [];
  for (const [bId, entry] of Object.entries(chainBuildings)) {
    const needed = Math.ceil(entry.count);
    const already = placedCounts[bId] || 0;
    const remaining = needed - already;
    if (remaining > 0) {
      productionList.push({ id: bId, building: entry.building, count: remaining });
    }
  }

  // Population houses
  const popList = [];
  POP_BUILDINGS.forEach(pb => {
    const count = parseInt(document.getElementById(`planner-${pb.id}`).value) || 0;
    const already = placedCounts[pb.id] || 0;
    const remaining = count - already;
    if (remaining > 0) {
      const building = getBuildingData(pb.id);
      if (building) popList.push({ id: pb.id, building, count: remaining });
    }
  });

  // Service buildings
  const serviceList = [];
  const requiredServices = getRequiredServices();
  for (const svcRes of requiredServices) {
    const providerId = pickServiceProvider(svcRes);
    if (!providerId) continue;
    const already = placedCounts[providerId] || 0;
    if (already > 0) continue;
    const building = getBuildingData(providerId);
    if (building) serviceList.push({ id: providerId, building, count: 1, serviceRes: svcRes });
  }

  const placed = [];
  const failed = [];

  // === PHASE 0: Warehouses ===
  // Place warehouse(s) to cover the island. Start with one central, add more if needed.
  const warehouseIds = ['Warehouse1', 'Warehouse2', 'Warehouse3'];
  const hasWarehouse = state.island.buildings.some(b => warehouseIds.includes(b.id));

  if (!hasWarehouse) {
    const whId = pickWarehouseId();
    const whBuilding = getBuildingData(whId) || {};
    const positions = findBestPositions(whId, whBuilding, {});
    if (positions.length > 0) {
      autoPlaceBuilding(whId, positions[0].x, positions[0].y);
      placed.push({ id: whId, x: positions[0].x, y: positions[0].y });
      runLog.phases.warehouses.placed.push({ name: whBuilding.name || whId, x: positions[0].x, y: positions[0].y });
    }
  }

  // Count how many production buildings we need to place total
  const totalProdNeeded = productionList.reduce((s, p) => s + p.count, 0);
  // At most one extra warehouse after the first, and only while coverage is low
  for (let attempt = 0; attempt < 1; attempt++) {
    // Count covered land cells
    let coveredLand = 0, totalLand = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (state.island.cells[y][x].terrain === 'water') continue;
        totalLand++;
        if (isInWarehouseRange(x, y)) coveredLand++;
      }
    }
    const coverage = totalLand > 0 ? coveredLand / totalLand : 1;
    runLog.phases.warehouses.coverage = coverage;
    if (coverage >= 0.55 || totalProdNeeded <= 3) break;

    // Place another warehouse where it covers the most uncovered land
    const whId = pickWarehouseId();
    const whBuilding = getBuildingData(whId) || {};
    let bestWh = null, bestNew = 0;
    const minNewLandCells = Math.max(4, Math.floor(totalLand * 0.04));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!canAutoPlace(whId, x, y)) continue;
        const newCov = countNewWarehouseCoverage(whId, x, y);
        if (newCov > bestNew) { bestNew = newCov; bestWh = { x, y }; }
      }
    }
    if (bestWh && bestNew >= minNewLandCells) {
      autoPlaceBuilding(whId, bestWh.x, bestWh.y);
      placed.push({ id: whId, x: bestWh.x, y: bestWh.y });
      runLog.phases.warehouses.placed.push({ name: whBuilding.name || whId, x: bestWh.x, y: bestWh.y });
    } else {
      break;
    }
  }

  // === PHASE 1: Services (before houses, so houses can target coverage) ===
  // Place services centrally to maximize future house coverage
  for (const item of serviceList) {
    for (let i = 0; i < item.count; i++) {
      const positions = findBestPositions(item.id, item.building, {});
      if (positions.length > 0) {
        autoPlaceBuilding(item.id, positions[0].x, positions[0].y);
        placed.push({ id: item.id, x: positions[0].x, y: positions[0].y });
        runLog.phases.services.placed.push({ name: item.building.name || item.id, x: positions[0].x, y: positions[0].y, serviceRes: item.serviceRes });
      } else {
        failed.push({ id: item.id, reason: 'no valid position for service' });
        runLog.phases.services.failed.push({ name: item.building.name || item.id, reason: 'no valid position' });
      }
    }
  }

  // Same ordering as Phase 2 so deposit painting prioritizes constrained buildings first
  sortProductionListByConstraint(productionList);

  // === PHASE 1.5: Auto-place missing deposit tiles co-located with building footprints ===
  // For each production building that needs a deposit (apple_trees, hop_field, etc.), find a
  // valid position first (ignoring that deposit requirement), then paint the deficit deposits
  // on grass cells within that footprint so Phase 2 can place the building there.
  {
    const depositTypeSet = new Set(DEPOSIT_TYPES.map(d => d.id));
    const reservedFootprints = []; // {x, y, id} — positions reserved for upcoming placements
    for (const item of productionList) {
      if (!item.building.inputs) continue;
      const depositInputs = Object.entries(item.building.inputs)
        .filter(([r]) => TILE_RESOURCE_IDS.has(r) && depositTypeSet.has(r));
      if (depositInputs.length === 0) continue;

      for (let i = 0; i < item.count; i++) {
        const ignoreRes = new Set(depositInputs.map(([r]) => r));
        const positions = findBestPositions(item.id, item.building, {
          requireWarehouse: true,
          claimedCells,
          ignoreTileResources: ignoreRes,
          reservedFootprints,
        });
        if (positions.length === 0) continue;

        const pos = positions[0];
        const fp = FOOTPRINTS[item.id] || [[0, 0]];
        for (const [resId, neededPerBuilding] of depositInputs) {
          const needed = Math.ceil(neededPerBuilding);
          const have = countTileResource(item.id, pos.x, pos.y, resId, claimedCells);
          const deficit = needed - have;
          if (deficit <= 0) continue;

          let placedCount = 0;
          for (const [dx, dy] of fp) {
            if (placedCount >= deficit) break;
            const cx = pos.x + dx, cy = pos.y + dy;
            if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
            const cell = state.island.cells[cy][cx];
            if (cell.terrain !== 'grass') continue;
            if (cell.deposit) continue;
            if (cell.building) continue;
            if (claimedCells.has(`${cx},${cy}`)) continue;
            cell.deposit = resId;
            claimedCells.add(`${cx},${cy}`);
            placedCount++;
            runLog.phases.deposits.push({ resId, name: PP2DATA.getResourceName(resId), x: cx, y: cy });
          }
        }
        reservedFootprints.push({ x: pos.x, y: pos.y, id: item.id });
      }
    }
  }

  // === PHASE 2: Production buildings (most constrained first) ===
  sortProductionListByConstraint(productionList);

  for (const item of productionList) {
    for (let i = 0; i < item.count; i++) {
      const positions = findBestPositions(item.id, item.building, { requireWarehouse: true, claimedCells });
      if (positions.length > 0) {
        autoPlaceBuilding(item.id, positions[0].x, positions[0].y);
        claimTileResourceCells(item.id, positions[0].x, positions[0].y, claimedCells);
        placed.push({ id: item.id, x: positions[0].x, y: positions[0].y });
        runLog.phases.production.placed.push({ name: item.building.name || item.id, x: positions[0].x, y: positions[0].y });
      } else {
        // Diagnose why
        const bld = item.building;
        let reason = 'no space';
        if (bld.inputs) {
          for (const [resId] of Object.entries(bld.inputs)) {
            if (!TILE_RESOURCE_IDS.has(resId)) continue;
            reason = `needs ${PP2DATA.getResourceName(resId)} tiles`;
            break;
          }
        }
        if (LOCATION_REQUIREMENTS[item.id]) {
          reason = LOCATION_REQUIREMENTS[item.id].label;
        }
        failed.push({ id: item.id, reason });
        const diagnosis = diagnosePlacementFailure(item.id, item.building, { requireWarehouse: true, claimedCells });
        runLog.phases.production.failed.push({ name: item.building.name || item.id, reason, diagnosis });
      }
    }
  }

  // === PHASE 3: Population houses (must be within service coverage) ===
  for (const item of popList) {
    // Determine which services this house type needs
    const neededServices = [];
    if (item.building.consumePerMinute) {
      for (const resId of Object.keys(item.building.consumePerMinute)) {
        if (SERVICE_RESOURCES.has(resId)) neededServices.push(resId);
      }
    }

    for (let i = 0; i < item.count; i++) {
      let bestPos = null;
      let bestScore = -Infinity;
      let bestSvcCovered = 0;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (!canAutoPlace(item.id, x, y)) continue;

          // Count how many required services cover this position
          let svcCovered = 0;
          for (const svcRes of neededServices) {
            if (isInServiceCoverage(x, y, svcRes)) svcCovered++;
          }

          // Strongly prefer full service coverage
          const svcScore = neededServices.length > 0
            ? (svcCovered / neededServices.length) * 100
            : 0;

          const cx = width / 2, cy = height / 2;
          const dist = Math.abs(x - cx) + Math.abs(y - cy);
          const score = svcScore - dist * 0.1;

          if (score > bestScore) {
            bestScore = score;
            bestPos = { x, y };
            bestSvcCovered = svcCovered;
          }
        }
      }

      if (bestPos) {
        autoPlaceBuilding(item.id, bestPos.x, bestPos.y);
        placed.push({ id: item.id, x: bestPos.x, y: bestPos.y });
        runLog.phases.houses.placed.push({ name: item.building.name || item.id, x: bestPos.x, y: bestPos.y, svcCovered: bestSvcCovered, svcTotal: neededServices.length });
      } else {
        failed.push({ id: item.id, reason: 'no space' });
        runLog.phases.houses.failed.push({ name: item.building.name || item.id, reason: 'no space' });
      }
    }
  }

  // === PHASE 4: Service top-up — cover any houses left uncovered after Phase 3 ===
  // For each required service, greedily place additional service buildings at whichever
  // position covers the most currently-uncovered houses. Stops when all houses are
  // covered or no valid position improves coverage (max 10 placements per service).
  for (const svcRes of requiredServices) {
    const providerId = pickServiceProvider(svcRes);
    if (!providerId) continue;
    const providerBuilding = getBuildingData(providerId);
    if (!providerBuilding) continue;
    const fp = FOOTPRINTS[providerId];
    if (!fp) continue;

    for (let attempt = 0; attempt < 5; attempt++) {
      // Find all placed population houses that need this service but aren't covered
      const uncovered = state.island.buildings.filter(b => {
        const bld = getBuildingData(b.id);
        if (!bld || !bld.isPopulation) return false;
        if (!bld.consumePerMinute || !bld.consumePerMinute[svcRes]) return false;
        return !isInServiceCoverage(b.x, b.y, svcRes);
      });
      if (uncovered.length === 0) break;

      // Find position that covers the most uncovered houses
      let bestPos = null, bestCount = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (!canAutoPlace(providerId, x, y)) continue;
          let count = 0;
          for (const h of uncovered) {
            if (fp.some(([dx, dy]) => x + dx === h.x && y + dy === h.y)) count++;
          }
          if (count > bestCount) { bestCount = count; bestPos = { x, y }; }
        }
      }

      if (!bestPos || bestCount === 0) break;
      autoPlaceBuilding(providerId, bestPos.x, bestPos.y);
      placed.push({ id: providerId, x: bestPos.x, y: bestPos.y });
      runLog.phases.topup.push({ serviceRes: svcRes, providerName: providerBuilding.name || providerId, x: bestPos.x, y: bestPos.y, coveredCount: bestCount, uncoveredBefore: uncovered.length });
    }
  }

  // Build coverage summary for logging
  for (const svcRes of requiredServices) {
    const total = state.island.buildings.filter(b => {
      const bld = getBuildingData(b.id);
      return bld && bld.isPopulation && bld.consumePerMinute && bld.consumePerMinute[svcRes];
    }).length;
    if (total === 0) continue;
    const covered = state.island.buildings.filter(b => {
      const bld = getBuildingData(b.id);
      return bld && bld.isPopulation && bld.consumePerMinute && bld.consumePerMinute[svcRes] &&
        isInServiceCoverage(b.x, b.y, svcRes);
    }).length;
    runLog.coverage[svcRes] = { covered, total };
  }

  emitAutoPopulateLog(runLog);

  // Refresh everything
  updateStats();
  validateIsland();
  render();

  // Show summary
  let msg = `Placed ${placed.length} building${placed.length !== 1 ? 's' : ''}.`;
  if (failed.length > 0) {
    // Group failures by building name + reason
    const failGroups = {};
    for (const f of failed) {
      const b = getBuildingData(f.id);
      const name = b ? b.name : f.id;
      const key = `${name} (${f.reason})`;
      failGroups[key] = (failGroups[key] || 0) + 1;
    }
    const failParts = Object.entries(failGroups).map(([key, count]) =>
      count > 1 ? `${count}× ${key}` : key
    );
    msg += `\nCould not place: ${failParts.join(', ')}`;
  }
  showAutoPopulateResult(msg, placed.length, failed.length);
}

function showAutoPopulateResult(msg, placedCount, failedCount) {
  const el = document.getElementById('auto-populate-result');
  if (!el) return;
  if (failedCount > 0) {
    el.style.color = '#f39c12';
  } else if (placedCount > 0) {
    el.style.color = '#2ecc71';
  } else {
    el.style.color = '#666';
  }
  el.textContent = msg;
}
