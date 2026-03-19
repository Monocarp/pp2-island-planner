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
