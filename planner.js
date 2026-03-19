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

// Check if a building can be placed at (x, y) — all footprint cells must be valid and unoccupied
function canAutoPlace(buildingId, x, y) {
  const { width, height, cells } = state.island;
  const fp = FOOTPRINTS[buildingId] || [[0,0]];

  for (const [dx, dy] of fp) {
    const cx = x + dx, cy = y + dy;
    if (cx < 0 || cx >= width || cy < 0 || cy >= height) return false;
    const cell = cells[cy][cx];
    if (cell.building) return false;
    // Anchor cell terrain check
    if (dx === 0 && dy === 0) {
      if (!canPlaceOnTerrain(buildingId, cell.terrain)) return false;
    }
  }
  // Location requirements (river, ocean, etc.)
  const locCheck = checkLocationRequirement(buildingId, x, y);
  if (!locCheck.ok) return false;
  return true;
}

// Count how many tiles of a given resource type are in the footprint at (x,y)
function countTileResource(buildingId, x, y, resId) {
  const { width, height, cells } = state.island;
  const fp = FOOTPRINTS[buildingId] || [[0,0]];
  let count = 0;
  for (const [dx, dy] of fp) {
    const cx = x + dx, cy = y + dy;
    if (cx >= 0 && cx < width && cy >= 0 && cy < height) {
      if (matchesTileResource(cells[cy][cx], resId)) count++;
    } else if (resId === 'water_tile') {
      count++; // out-of-bounds = ocean
    }
  }
  return count;
}

// Score a position for a building — higher is better
// Prefers central positions and positions near already-placed buildings
function scorePosition(buildingId, x, y, building) {
  const { width, height } = state.island;
  let score = 0;

  // Prefer positions closer to center of island
  const cx = width / 2, cy = height / 2;
  const dist = Math.abs(x - cx) + Math.abs(y - cy);
  score -= dist * 0.1;

  // For buildings with tile resource inputs, prefer positions with more matching tiles
  if (building.inputs) {
    for (const [resId, needed] of Object.entries(building.inputs)) {
      if (!TILE_RESOURCE_IDS.has(resId)) continue;
      const available = countTileResource(buildingId, x, y, resId);
      // Bonus for having more than needed (less waste), penalty for exactly matching
      score += Math.min(available, needed) * 2;
    }
  }

  return score;
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

// Find all valid positions for a building, sorted by score
function findBestPositions(buildingId, building, requireWarehouse) {
  const { width, height } = state.island;
  const candidates = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!canAutoPlace(buildingId, x, y)) continue;
      if (requireWarehouse && !isInWarehouseRange(x, y)) continue;

      // Check tile resource inputs are satisfied
      let tileOk = true;
      if (building.inputs) {
        for (const [resId, needed] of Object.entries(building.inputs)) {
          if (!TILE_RESOURCE_IDS.has(resId)) continue;
          if (resId === 'river' && LOCATION_REQUIREMENTS[buildingId]) continue;
          if (countTileResource(buildingId, x, y, resId) < needed) {
            tileOk = false;
            break;
          }
        }
      }
      if (!tileOk) continue;

      candidates.push({ x, y, score: scorePosition(buildingId, x, y, building) });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

// Place building during auto-populate (marks footprint cells)
function autoPlaceBuilding(buildingId, x, y) {
  const { cells } = state.island;
  cells[y][x].building = buildingId;
  state.island.buildings.push({ id: buildingId, x, y, uid: nextBuildingUid++ });
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

// Map service resource to best provider building ID
// Uses EXTRA_BUILDINGS service entries + data.js service producers
function pickServiceProvider(serviceResId) {
  // Preferred service providers mapped by resource
  const preferred = {
    'water': 'Well',
    'community': 'Tavern',
    'education': 'School',
    'medical_care': 'Medicus',
    'sports': 'SportsGround',
    'administration': 'Townhall',
    'hygiene': 'Bathhouse',
    'trading': 'MarketHall',
    'cemetery': 'Cemetery',
    'entertainment': 'Theatre',
    'coiffeur': 'Coiffeur',
    'higher_education': 'University',
    'gambling': 'Fair',
    'heat': 'HeatingPlant',
  };
  return preferred[serviceResId] || null;
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

  // Build the placement list: [{ id, building, count }]
  const placementList = [];

  // Already-placed counts (don't double-place)
  const placedCounts = {};
  state.island.buildings.forEach(b => {
    placedCounts[b.id] = (placedCounts[b.id] || 0) + 1;
  });

  // 1. Gather production buildings from chain
  for (const [bId, entry] of Object.entries(chainBuildings)) {
    const needed = Math.ceil(entry.count);
    const already = placedCounts[bId] || 0;
    const remaining = needed - already;
    if (remaining > 0) {
      placementList.push({ id: bId, building: entry.building, count: remaining, category: 'production' });
    }
  }

  // 2. Gather population houses
  const popList = [];
  POP_BUILDINGS.forEach(pb => {
    const count = parseInt(document.getElementById(`planner-${pb.id}`).value) || 0;
    const already = placedCounts[pb.id] || 0;
    const remaining = count - already;
    if (remaining > 0) {
      const building = getBuildingData(pb.id);
      if (building) popList.push({ id: pb.id, building, count: remaining, category: 'population' });
    }
  });

  // 3. Gather service buildings needed
  const serviceList = [];
  const requiredServices = getRequiredServices();
  for (const svcRes of requiredServices) {
    const providerId = pickServiceProvider(svcRes);
    if (!providerId) continue;
    const already = placedCounts[providerId] || 0;
    if (already > 0) continue; // already have one
    const building = getBuildingData(providerId);
    if (building) serviceList.push({ id: providerId, building, count: 1, category: 'service' });
  }

  // 4. Check if we need a warehouse (if none placed)
  const warehouseIds = ['Warehouse1', 'Warehouse2', 'Warehouse3'];
  const hasWarehouse = state.island.buildings.some(b => warehouseIds.includes(b.id));

  // === PLACEMENT PHASE ===
  const placed = [];
  const failed = [];

  // Phase 0: Place a warehouse if none exists (central position)
  if (!hasWarehouse) {
    const whId = 'Warehouse1';
    const whBuilding = getBuildingData(whId);
    const positions = findBestPositions(whId, whBuilding || {}, false);
    if (positions.length > 0) {
      autoPlaceBuilding(whId, positions[0].x, positions[0].y);
      placed.push({ id: whId, x: positions[0].x, y: positions[0].y });
    } else {
      failed.push({ id: whId, reason: 'No valid position' });
    }
  }

  // Sort production buildings: most constrained first
  // Constraint score: deposit-bound > river-bound > high grass needs > unconstrained
  placementList.sort((a, b) => {
    const constraintScore = (item) => {
      let score = 0;
      const bld = item.building;
      // Location requirement = highly constrained
      if (LOCATION_REQUIREMENTS[item.id]) {
        const req = LOCATION_REQUIREMENTS[item.id];
        if (req.type === 'straight_river') score += 100;
        else if (req.type === 'in_water_coastal') score += 90;
        else if (req.type === 'ocean_adjacent') score += 80;
        else if (req.type === 'river_adjacent') score += 70;
      }
      // Deposit-dependent inputs
      if (bld.inputs) {
        for (const [resId, amt] of Object.entries(bld.inputs)) {
          if (!TILE_RESOURCE_IDS.has(resId)) continue;
          if (resId.includes('deposit') || resId === 'cliff') score += 200;
          else if (resId === 'grass') score += amt; // more grass = more constrained
        }
      }
      return score;
    };
    return constraintScore(b) - constraintScore(a);
  });

  // Phase 1: Place production buildings (most constrained first)
  for (const item of placementList) {
    for (let i = 0; i < item.count; i++) {
      const positions = findBestPositions(item.id, item.building, true);
      if (positions.length > 0) {
        autoPlaceBuilding(item.id, positions[0].x, positions[0].y);
        placed.push({ id: item.id, x: positions[0].x, y: positions[0].y });
      } else {
        // Try without warehouse constraint
        const anyPos = findBestPositions(item.id, item.building, false);
        if (anyPos.length > 0) {
          autoPlaceBuilding(item.id, anyPos[0].x, anyPos[0].y);
          placed.push({ id: item.id, x: anyPos[0].x, y: anyPos[0].y });
        } else {
          failed.push({ id: item.id, reason: 'No valid position' });
        }
      }
    }
  }

  // Phase 2: Place service buildings (central, to maximize house coverage later)
  for (const item of serviceList) {
    for (let i = 0; i < item.count; i++) {
      const positions = findBestPositions(item.id, item.building, false);
      if (positions.length > 0) {
        autoPlaceBuilding(item.id, positions[0].x, positions[0].y);
        placed.push({ id: item.id, x: positions[0].x, y: positions[0].y });
      } else {
        failed.push({ id: item.id, reason: 'No valid position' });
      }
    }
  }

  // Phase 3: Place population houses (prefer within service coverage)
  for (const item of popList) {
    for (let i = 0; i < item.count; i++) {
      // Find positions that are covered by all required services
      const building = item.building;
      const neededServices = [];
      if (building.consumePerMinute) {
        for (const resId of Object.keys(building.consumePerMinute)) {
          if (SERVICE_RESOURCES.has(resId)) neededServices.push(resId);
        }
      }

      const { width, height } = state.island;
      let bestPos = null;
      let bestScore = -Infinity;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (!canAutoPlace(item.id, x, y)) continue;
          // Score: prefer positions covered by more required services
          let svcCoverage = 0;
          for (const svcRes of neededServices) {
            const providerId = pickServiceProvider(svcRes);
            if (!providerId) continue;
            const svcBuildings = state.island.buildings.filter(b => b.id === providerId);
            for (const sb of svcBuildings) {
              const fp = FOOTPRINTS[sb.id];
              if (!fp) continue;
              if (fp.some(([dx, dy]) => sb.x + dx === x && sb.y + dy === y)) {
                svcCoverage++;
                break;
              }
            }
          }

          const cx = width / 2, cy = height / 2;
          const dist = Math.abs(x - cx) + Math.abs(y - cy);
          const score = svcCoverage * 10 - dist * 0.1;

          if (score > bestScore) {
            bestScore = score;
            bestPos = { x, y };
          }
        }
      }

      if (bestPos) {
        autoPlaceBuilding(item.id, bestPos.x, bestPos.y);
        placed.push({ id: item.id, x: bestPos.x, y: bestPos.y });
      } else {
        failed.push({ id: item.id, reason: 'No valid position' });
      }
    }
  }

  // Refresh everything
  updateStats();
  validateIsland();
  render();

  // Show summary
  let msg = `Placed ${placed.length} building${placed.length !== 1 ? 's' : ''}.`;
  if (failed.length > 0) {
    const failNames = failed.map(f => {
      const b = getBuildingData(f.id);
      return b ? b.name : f.id;
    });
    msg += `\nCould not place: ${failNames.join(', ')}`;
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
