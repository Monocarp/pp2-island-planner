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
  buildCustomBuildingUI();
  buildMilitaryUI();
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

/** Merge any number of demand maps (resourceId → rate per minute). */
function mergeDemand(...parts) {
  const o = {};
  for (const p of parts) {
    if (!p) continue;
    for (const [k, v] of Object.entries(p)) {
      o[k] = (o[k] || 0) + v;
    }
  }
  return o;
}

/** True if any population house count in the planner is greater than 0. */
function hasAnyPopulationHouseRequested() {
  return POP_BUILDINGS.some(pb => {
    const input = document.getElementById(`planner-${pb.id}`);
    return input && (parseInt(input.value) || 0) > 0;
  });
}

/**
 * Demand (resource → rate/min) from extra auto-place building entries.
 * Each building adds demand for its output at count × producePerMinute.
 */
function getCustomBuildingExtraDemand() {
  const demand = {};
  const entries = state.customBuildingEntries || [];
  for (const { id, count } of entries) {
    if (!id || (count || 0) <= 0) continue;
    const b = PP2DATA.getBuilding(id);
    if (!b || !b.produces) continue;
    const ppm = b.producePerMinute;
    if (ppm == null || ppm <= 0) continue;
    demand[b.produces] = (demand[b.produces] || 0) + ppm * count;
  }
  return demand;
}

/** Demand (resource → rate/min) from military targets (rates are per hour in UI). */
function getMilitaryDemand() {
  const demand = {};
  for (const e of state.militaryEntries || []) {
    if (!e || !e.unitResId) continue;
    const r = parseFloat(e.ratePerHour);
    if (!Number.isFinite(r) || r <= 0) continue;
    demand[e.unitResId] = (demand[e.unitResId] || 0) + r / 60;
  }
  return demand;
}

function hasAnyMilitaryRequested() {
  return (state.militaryEntries || []).some(e => {
    if (!e || !e.unitResId) return false;
    const r = parseFloat(e.ratePerHour);
    return Number.isFinite(r) && r > 0;
  });
}

// 10 pioneers/hut × 0.36 militia/hr/person ÷ 60 = 0.06 militia/min/hut
const MILITIA_PER_MIN_PER_HUT = 0.06;

// Deposits that represent natural mineral veins / geological features and
// must pre-exist on the island (cannot be auto-painted in Phase 1.5).
const NATURAL_DEPOSIT_IDS = new Set([
  'copper_deposit', 'copper_deposit_tropical', 'copper_pyrite_deposit',
  'coal_deposit', 'iron_deposit',
  'rock_salt_deposit', 'rock_salt_deposit_north',
  'clay_deposit', 'cliff', 'cliff_tropical', 'marble_deposit', 'marble_deposit_north',
  'gold_deposit', 'gemstone_deposit', 'lead_deposit', 'zinc_deposit',
]);

/**
 * After resolveProductionChain, compute militia demand from BootCamp count
 * and infer Pioneer Huts needed to supply that militia.
 * Returns null when no militia is needed.
 */
function inferMilitiaHuts(chainBuildings) {
  const bootCampEntry = chainBuildings['BootCamp'];
  if (!bootCampEntry) return null;
  const militiaPerMin = bootCampEntry.count *
    ((bootCampEntry.building.consumePerMinute || {}).militia || 0.2);
  if (militiaPerMin <= 0) return null;
  const hutsNeeded = militiaPerMin / MILITIA_PER_MIN_PER_HUT;
  const hutBuilding = PP2DATA.getBuilding('PopulationPioneersHut');
  if (!hutBuilding || !hutBuilding.consumePerMinute) return null;
  const hutDemand = {};
  for (const [resId, rate] of Object.entries(hutBuilding.consumePerMinute)) {
    if (SERVICE_RESOURCES.has(resId)) continue;
    hutDemand[resId] = rate * hutsNeeded;
  }
  return { hutsNeeded, militiaPerMin, hutDemand };
}

/** Merge a secondary chain result into the primary one (mutates target). */
function mergeChainResults(target, source) {
  for (const [bId, entry] of Object.entries(source.buildings)) {
    if (target.buildings[bId]) {
      target.buildings[bId].count += entry.count;
    } else {
      target.buildings[bId] = { ...entry };
    }
  }
  for (const [tId, entry] of Object.entries(source.tileNeeds)) {
    if (target.tileNeeds[tId]) {
      target.tileNeeds[tId].count += entry.count;
    } else {
      target.tileNeeds[tId] = { ...entry };
    }
  }
}

/** Collect natural deposit types required by buildings in the resolved chain. */
function getRequiredNaturalDeposits(chainBuildings) {
  const needed = new Set();
  for (const entry of Object.values(chainBuildings)) {
    const b = entry.building;
    if (!b.inputs) continue;
    for (const resId of Object.keys(b.inputs)) {
      if (NATURAL_DEPOSIT_IDS.has(resId)) needed.add(resId);
    }
  }
  return needed;
}

/** Scan island cells and return a map of depositId → tile count. */
function getIslandDepositCounts() {
  if (!state.island) return {};
  const counts = {};
  for (let y = 0; y < state.island.height; y++) {
    for (let x = 0; x < state.island.width; x++) {
      const d = state.island.cells[y][x].deposit;
      if (d) counts[d] = (counts[d] || 0) + 1;
    }
  }
  return counts;
}

/**
 * Return array of deposit problem objects:
 *   { depId, needed, available, buildingId, buildingName }
 * Covers both fully-absent deposits and deposits with insufficient tile count.
 */
function checkMissingDeposits(chainBuildings) {
  const depositCounts = getIslandDepositCounts();
  const problems = [];

  for (const [bId, entry] of Object.entries(chainBuildings)) {
    const b = entry.building;
    if (!b.inputs) continue;
    for (const [resId, inputAmt] of Object.entries(b.inputs)) {
      if (!NATURAL_DEPOSIT_IDS.has(resId)) continue;
      const tilesNeeded = Math.ceil(entry.count * inputAmt);
      const available = COPPER_MINE_DEPOSIT_IDS.has(resId)
        ? copperMineFamilyTileCount(depositCounts)
        : (depositCounts[resId] || 0);
      if (available < tilesNeeded) {
        // Avoid duplicates for same deposit type
        const existing = problems.find(p => p.depId === resId);
        if (existing) {
          existing.needed = Math.max(existing.needed, tilesNeeded);
        } else {
          problems.push({
            depId: resId,
            needed: tilesNeeded,
            available,
            buildingId: bId,
            buildingName: b.name || bId,
          });
        }
      }
    }
  }
  return problems;
}

function populateCustomBuildingSelect(filterText) {
  const sel = document.getElementById('planner-custom-select');
  if (!sel) return;
  const f = (filterText || '').trim().toLowerCase();
  const list = getCustomBuildingPickerList().filter(b => {
    if (!f) return true;
    return b.name.toLowerCase().includes(f) || b.id.toLowerCase().includes(f);
  });
  const prev = sel.value;
  sel.innerHTML = list.length === 0
    ? '<option value="">(no matches)</option>'
    : list.map(b => `<option value="${b.id}">${b.name} · ${b.tier}</option>`).join('');
  if (prev && list.some(b => b.id === prev)) sel.value = prev;
}

function renderCustomBuildingEntryList() {
  const el = document.getElementById('planner-custom-list');
  if (!el) return;
  const entries = state.customBuildingEntries || [];
  if (entries.length === 0) {
    el.innerHTML = '<span style="color:#666;font-size:0.65rem;">No extra buildings — chain is houses only.</span>';
    return;
  }
  el.innerHTML = entries.map((e, i) => {
    const b = PP2DATA.getBuilding(e.id);
    const name = b ? b.name : e.id;
    return `<div class="planner-row planner-custom-entry" style="font-size:0.72rem;">
      <span>${name}</span>
      <span style="display:flex;align-items:center;gap:4px;">
        <input type="number" min="1" value="${e.count}" data-custom-idx="${i}" class="planner-custom-count-edit" style="width:40px;font-size:0.7rem;padding:2px;">
        <button type="button" data-custom-remove="${i}" title="Remove" style="padding:0 6px;cursor:pointer;background:transparent;border:1px solid #888;color:#ccc;border-radius:2px;font-size:0.85rem;line-height:1.2;">×</button>
      </span>
    </div>`;
  }).join('');
}

let _customBuildingUiInitialized = false;

function buildCustomBuildingUI() {
  if (!Array.isArray(state.customBuildingEntries)) state.customBuildingEntries = [];
  const filterEl = document.getElementById('planner-custom-filter');
  populateCustomBuildingSelect(filterEl ? filterEl.value : '');
  renderCustomBuildingEntryList();
  if (_customBuildingUiInitialized) return;
  _customBuildingUiInitialized = true;

  const listEl = document.getElementById('planner-custom-list');
  if (filterEl) {
    filterEl.addEventListener('input', () => {
      populateCustomBuildingSelect(filterEl.value);
    });
  }
  document.getElementById('planner-custom-add')?.addEventListener('click', () => {
    const sel = document.getElementById('planner-custom-select');
    const id = sel && sel.value;
    const count = Math.max(1, parseInt(document.getElementById('planner-custom-count')?.value) || 1);
    if (!id) return;
    const existing = state.customBuildingEntries.find(e => e.id === id);
    if (existing) existing.count += count;
    else state.customBuildingEntries.push({ id, count });
    renderCustomBuildingEntryList();
    calculateProduction();
  });
  if (listEl) {
    listEl.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-custom-remove]');
      if (!btn) return;
      const i = parseInt(btn.getAttribute('data-custom-remove'), 10);
      if (Number.isNaN(i)) return;
      state.customBuildingEntries.splice(i, 1);
      renderCustomBuildingEntryList();
      calculateProduction();
    });
    listEl.addEventListener('change', (ev) => {
      const inp = ev.target.closest('.planner-custom-count-edit');
      if (!inp) return;
      const i = parseInt(inp.getAttribute('data-custom-idx'), 10);
      if (Number.isNaN(i) || !state.customBuildingEntries[i]) return;
      const v = Math.max(1, parseInt(inp.value) || 1);
      state.customBuildingEntries[i].count = v;
      inp.value = v;
      calculateProduction();
    });
  }
}

// Recursively resolve production chains.
// Tiles with iterationTime=1 are spatial (grass, water, deposits) - counted per building footprint.
// Tiles with real iteration times (apple trees, forests, fields) - counted by production rate.

// Tier priority for default producer selection (lower index = preferred)
const TIER_PRIORITY = ['Pioneers', 'Colonists', 'Townsmen', 'Farmers', 'Merchants', 'Workers', 'Paragons', 'Northern Islands'];

/** Production buildings the user may add for auto-place (unlocked, plannable). */
function getCustomBuildingPickerList() {
  const popIds = new Set(POP_BUILDINGS.map(pb => pb.id));
  return PP2DATA.buildings.filter(b => {
    if (popIds.has(b.id)) return false;
    const bd = getBuildingData(b.id);
    if (!bd || bd.isPopulation) return false;
    if (bd.isInfrastructure || bd.isService) return false;
    if (!FOOTPRINTS[b.id]) return false;
    if (!state.unlockedBuildings.has(b.id)) return false;
    return true;
  }).sort((a, b) => {
    const ta = TIER_PRIORITY.indexOf(a.tier);
    const tb = TIER_PRIORITY.indexOf(b.tier);
    if (ta !== tb) return (ta === -1 ? 99 : ta) - (tb === -1 ? 99 : tb);
    return a.name.localeCompare(b.name);
  });
}

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

/** Boot camp + training halls: consume recruits (or produce recruits only at BootCamp). */
function isMilitaryTrainingBuilding(b) {
  const bd = getBuildingData(b.id);
  if (!bd || bd.isPopulation || !b.produces || !FOOTPRINTS[b.id]) return false;
  if (SERVICE_RESOURCES.has(b.produces)) return false;
  if (!b.consumePerMinute) return b.produces === 'recruits';
  return Object.prototype.hasOwnProperty.call(b.consumePerMinute, 'recruits');
}

/** Unit types available in the military dropdown (default chain producer unlocked). */
function getMilitaryUnitSelectOptions() {
  const resIds = new Set();
  for (const b of PP2DATA.buildings) {
    if (!isMilitaryTrainingBuilding(b)) continue;
    resIds.add(b.produces);
  }
  const out = [];
  for (const resId of resIds) {
    const producers = PP2DATA.getProducersOf(resId) || [];
    if (!producers.some(p => PP2DATA.getBuilding(p.id))) continue;
    const chosen = pickProducer(resId, producers);
    if (!chosen || !PP2DATA.getBuilding(chosen.id)) continue;
    if (!state.unlockedBuildings.has(chosen.id)) continue;
    out.push({ resId, label: PP2DATA.getResourceName(resId) });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

function populateMilitarySelect() {
  const sel = document.getElementById('planner-military-select');
  if (!sel) return;
  const prev = sel.value;
  const opts = getMilitaryUnitSelectOptions();
  sel.innerHTML = opts.length === 0
    ? '<option value="">(unlock training buildings)</option>'
    : opts.map(o => `<option value="${o.resId}">${o.label}</option>`).join('');
  if (prev && opts.some(o => o.resId === prev)) sel.value = prev;
}

function renderMilitaryEntryList() {
  const el = document.getElementById('planner-military-list');
  if (!el) return;
  const entries = state.militaryEntries || [];
  if (entries.length === 0) {
    el.innerHTML = '<span style="color:#666;font-size:0.65rem;">No military targets.</span>';
    return;
  }
  el.innerHTML = entries.map((e, i) => {
    const label = PP2DATA.getResourceName(e.unitResId) || e.unitResId;
    const rate = Number.isFinite(parseFloat(e.ratePerHour)) ? e.ratePerHour : 0;
    return `<div class="planner-row" style="font-size:0.72rem;">
      <span>${label}</span>
      <span style="display:flex;align-items:center;gap:4px;">
        <input type="number" min="0" step="0.1" value="${rate}" data-mil-idx="${i}" class="planner-military-rate-edit" style="width:52px;font-size:0.7rem;padding:2px;" title="Per hour">
        <span style="color:#666;font-size:0.65rem">/hr</span>
        <button type="button" data-mil-remove="${i}" title="Remove" style="padding:0 6px;cursor:pointer;background:transparent;border:1px solid #888;color:#ccc;border-radius:2px;font-size:0.85rem;line-height:1.2;">×</button>
      </span>
    </div>`;
  }).join('');
}

let _militaryUiInitialized = false;

function buildMilitaryUI() {
  if (!Array.isArray(state.militaryEntries)) state.militaryEntries = [];
  populateMilitarySelect();
  renderMilitaryEntryList();
  if (_militaryUiInitialized) return;
  _militaryUiInitialized = true;

  document.getElementById('planner-military-add')?.addEventListener('click', () => {
    const sel = document.getElementById('planner-military-select');
    const unitResId = sel && sel.value;
    const rate = Math.max(0, parseFloat(document.getElementById('planner-military-rate')?.value) || 0);
    if (!unitResId || rate <= 0) return;
    state.militaryEntries.push({ unitResId, ratePerHour: rate });
    renderMilitaryEntryList();
    calculateProduction();
  });
  document.getElementById('planner-military-clear')?.addEventListener('click', () => {
    state.militaryEntries = [];
    renderMilitaryEntryList();
    calculateProduction();
  });
  const listEl = document.getElementById('planner-military-list');
  if (listEl) {
    listEl.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-mil-remove]');
      if (!btn) return;
      const i = parseInt(btn.getAttribute('data-mil-remove'), 10);
      if (Number.isNaN(i)) return;
      state.militaryEntries.splice(i, 1);
      renderMilitaryEntryList();
      calculateProduction();
    });
    listEl.addEventListener('change', (ev) => {
      const inp = ev.target.closest('.planner-military-rate-edit');
      if (!inp) return;
      const i = parseInt(inp.getAttribute('data-mil-idx'), 10);
      if (Number.isNaN(i) || !state.militaryEntries[i]) return;
      const v = Math.max(0, parseFloat(inp.value) || 0);
      state.militaryEntries[i].ratePerHour = v;
      inp.value = v;
      calculateProduction();
    });
  }
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
  const popDemand = getPopulationDemand();
  const extraDemand = getCustomBuildingExtraDemand();
  const militaryDemand = getMilitaryDemand();
  const demand = mergeDemand(popDemand, extraDemand, militaryDemand);
  const el = document.getElementById('planner-results');
  const hasHouses = hasAnyPopulationHouseRequested();
  const hasCustom = (state.customBuildingEntries || []).some(e => (e.count || 0) > 0);
  const hasMilitary = hasAnyMilitaryRequested();

  if (!hasHouses && !hasCustom && !hasMilitary) {
    el.innerHTML = '<span style="color:#666">Set houses, extra production, and/or military targets</span>';
    state.plannerActive = false;
    return;
  }

  state.plannerActive = true;
  const chainResult = resolveProductionChain(demand);
  const { buildings, tileNeeds } = chainResult;

  // Militia inference: BootCamp → militia → Pioneer Huts
  const militiaInfo = inferMilitiaHuts(buildings);
  let inferredHutCount = 0;
  if (militiaInfo) {
    inferredHutCount = Math.ceil(militiaInfo.hutsNeeded);
    const hutChain = resolveProductionChain(militiaInfo.hutDemand);
    mergeChainResults(chainResult, hutChain);
  }

  // Missing deposit check
  const missingDeposits = checkMissingDeposits(buildings);

  // Compare with placed buildings on island
  const placedCounts = {};
  if (state.island) {
    state.island.buildings.forEach(b => {
      placedCounts[b.id] = (placedCounts[b.id] || 0) + 1;
    });
  }

  let html = '';

  // === Missing / insufficient deposits warning ===
  if (missingDeposits.length > 0) {
    html += '<div class="planner-section" style="border:1px solid #e74c3c;padding:6px;border-radius:4px;margin-bottom:6px;">';
    html += '<h5 style="color:#e74c3c;">Deposit Problems</h5>';
    html += '<div style="font-size:0.7rem;color:#e74c3c;margin-bottom:4px;">Add these deposits manually or the relevant buildings will fail to place:</div>';
    for (const p of missingDeposits) {
      const label = p.available === 0
        ? `${PP2DATA.getResourceName(p.depId)} — missing (need ${p.needed} tiles)`
        : `${PP2DATA.getResourceName(p.depId)} — only ${p.available} tile${p.available !== 1 ? 's' : ''}, need ${p.needed}`;
      html += `<div class="planner-summary-row" style="color:#e74c3c;">
        <span>${label}</span>
      </div>`;
    }
    html += '</div>';
  }

  // === Extra production targets ===
  if (hasCustom) {
    html += '<div class="planner-section"><h5>Extra production (targets)</h5>';
    for (const e of state.customBuildingEntries) {
      if ((e.count || 0) <= 0) continue;
      const b = PP2DATA.getBuilding(e.id);
      const name = b ? b.name : e.id;
      const out = b && b.produces ? PP2DATA.getResourceName(b.produces) : '—';
      html += `<div class="planner-summary-row">
        <span>${name} ×${e.count}</span>
        <span style="color:#666;font-size:0.65rem">${out}/min</span>
      </div>`;
    }
    html += '</div>';
  }

  // === Militia inference display ===
  if (militiaInfo) {
    html += '<div class="planner-section"><h5>Militia Inference</h5>';
    html += `<div class="planner-summary-row">
      <span>Militia demand</span><span>${militiaInfo.militiaPerMin.toFixed(3)}/min</span>
    </div>`;
    html += `<div class="planner-summary-row">
      <span>Pioneer Huts needed (inferred)</span><span>${inferredHutCount} <span style="color:#666;font-size:0.6rem">(${militiaInfo.hutsNeeded.toFixed(2)})</span></span>
    </div>`;
    html += '</div>';
  }

  // === Resource demand summary ===
  const fullDemand = militiaInfo ? mergeDemand(demand, militiaInfo.hutDemand) : demand;
  html += '<div class="planner-section"><h5>Resource Demand (per min)</h5>';
  if (Object.keys(fullDemand).length === 0) {
    html += '<div class="planner-summary-row"><span style="color:#888">(no goods demand — service-only houses)</span></div>';
  }
  const sortedDemand = Object.entries(fullDemand).sort((a, b) => b[1] - a[1]);
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
    const extra = (pb.id === 'PopulationPioneersHut') ? inferredHutCount : 0;
    const total = count + extra;
    if (total > 0) {
      const placed = placedCounts[pb.id] || 0;
      const statusColor = placed >= total ? '#2ecc71' : placed > 0 ? '#f39c12' : '#e74c3c';
      const extraLabel = extra > 0 ? ` <span style="color:#3498db;font-size:0.6rem">(+${extra} militia)</span>` : '';
      html += `<div class="planner-building-row">
        <span>${pb.label}${extraLabel}</span>
        <span><span style="color:${statusColor}">${placed}</span>/<span class="count">${total}</span></span>
      </div>`;
    }
  });
  html += '</div>';

  el.innerHTML = html;
}

// ===== AUTO-POPULATE =====

// Map spatial inputs that use terrain (not deposit) — Phase 1.5 paints these via cell.terrain.
const TERRAIN_PAINT_RESOURCES = {
  forest: 'forest',
  conifer_forest: 'forest',
};

/** Deposit / auto-painted spatial inputs must sort before other production so Phase 2 does not steal their prepared anchor. */
const DEPOSIT_TYPE_ID_SET = new Set(DEPOSIT_TYPES.map(d => d.id));

function isHighPrioritySpatialInput(resId) {
  if (!TILE_RESOURCE_IDS.has(resId)) return false;
  if (TERRAIN_PAINT_RESOURCES[resId]) return true;
  if (DEPOSIT_TYPE_ID_SET.has(resId)) return true;
  if (resId.includes('deposit') || resId === 'cliff') return true;
  return false;
}

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
          if (isHighPrioritySpatialInput(resId)) score += 200;
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
    if (cx < 0 || cx >= width || cy < 0 || cy >= height) {
      if (!acceptsWaterInFootprint) return false;
      continue; // OOB = ocean, valid water tile for water-accepting buildings
    }
    const cell = cells[cy][cx];
    if (dx === 0 && dy === 0) {
      if (cell.building) return false;
      if (!canPlaceOnTerrain(buildingId, cell.terrain)) return false;
      // Reject anchor on a natural deposit unless this building gathers that deposit (copper variants are cross-validated)
      if (cell.deposit && NATURAL_DEPOSIT_IDS.has(cell.deposit)) {
        if (!buildingGatheringUsesDeposit(building, cell.deposit)) return false;
      }
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

// Mark spatial tile resource cells in a building's footprint as claimed, up to each input's cap.
// Called after auto-placing a building so subsequent buildings won't overlap on grass/deposits.
function claimTileResourceCells(buildingId, x, y, claimedCells) {
  const { width, height, cells } = state.island;
  const fp = FOOTPRINTS[buildingId] || [[0,0]];
  const building = getBuildingData(buildingId);
  if (!building || !building.inputs) return;
  const spatialResources = Object.keys(building.inputs).filter(r => TILE_RESOURCE_IDS.has(r));
  if (spatialResources.length === 0) return;
  const claimedCount = {};
  for (const resId of spatialResources) {
    claimedCount[resId] = 0;
  }
  for (const [dx, dy] of fp) {
    const cx = x + dx, cy = y + dy;
    if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
    const cell = cells[cy][cx];
    for (const resId of spatialResources) {
      const raw = building.inputs[resId];
      const cap = raw != null ? Math.ceil(raw) : Infinity;
      if (claimedCount[resId] >= cap) continue;
      if (footprintCellCountsForGathering(cell, cx, cy, resId, x, y, width, height)) {
        claimedCells.add(`${cx},${cy}`);
        claimedCount[resId]++;
        break;
      }
    }
  }
}

const WAREHOUSE_IDS = ['Warehouse1', 'Warehouse2', 'Warehouse3'];

/** All cells ("x,y") covered by warehouse footprints — rebuilt during auto-populate for O(1) checks. */
function buildWarehouseCoverageSet() {
  const set = new Set();
  if (!state.island) return set;
  for (const b of state.island.buildings) {
    if (!WAREHOUSE_IDS.includes(b.id)) continue;
    const fp = FOOTPRINTS[b.id];
    if (!fp) continue;
    for (const [dx, dy] of fp) set.add(`${b.x + dx},${b.y + dy}`);
  }
  return set;
}

/** serviceResId -> Set of "x,y" cells in service building footprints — rebuilt during auto-populate. */
function buildServiceCoverageMap() {
  const map = new Map();
  if (!state.island) return map;
  for (const b of state.island.buildings) {
    const bld = getBuildingData(b.id);
    if (!bld || bld.isPopulation) continue;
    const res = bld.produces;
    if (!res) continue;
    const fp = FOOTPRINTS[b.id];
    if (!fp) continue;
    if (!map.has(res)) map.set(res, new Set());
    const cells = map.get(res);
    for (const [dx, dy] of fp) cells.add(`${b.x + dx},${b.y + dy}`);
  }
  return map;
}

// During autoPopulate these are non-null for O(1) range/coverage checks; cleared at end.
let _apWarehouseCov = null;
let _apServiceCov = null;

function refreshApWarehouseCov() {
  _apWarehouseCov = state.island ? buildWarehouseCoverageSet() : null;
}

function refreshApServiceCov() {
  _apServiceCov = state.island ? buildServiceCoverageMap() : null;
}

function beginAutoPopulateCoverage() {
  refreshApWarehouseCov();
  _apServiceCov = null;
}

function endAutoPopulateCoverage() {
  _apWarehouseCov = null;
  _apServiceCov = null;
}

/** Remove auto-painted field deposits not under any building footprint (Phase 1.5 orphans).
 * Never removes natural geology (cliff, ore veins, etc.) — those are not "painted" in 1.5. */
function cleanupOrphanDepositsAfterPhase2(width, height) {
  const depositIds = new Set(DEPOSIT_TYPES.map(d => d.id));
  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const cell = state.island.cells[cy][cx];
      if (!cell.deposit || !depositIds.has(cell.deposit)) continue;
      if (NATURAL_DEPOSIT_IDS.has(cell.deposit)) continue;
      let covered = false;
      for (const b of state.island.buildings) {
        const fp = FOOTPRINTS[b.id] || [[0, 0]];
        for (const [dx, dy] of fp) {
          if (b.x + dx === cx && b.y + dy === cy) {
            covered = true;
            break;
          }
        }
        if (covered) break;
      }
      if (!covered) cell.deposit = null;
    }
  }
}

// Check if position (x,y) is within any warehouse's footprint
function isInWarehouseRange(x, y) {
  if (_apWarehouseCov) return _apWarehouseCov.has(`${x},${y}`);
  for (const b of state.island.buildings) {
    if (!WAREHOUSE_IDS.includes(b.id)) continue;
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
  if (_apServiceCov) return !!(_apServiceCov.get(serviceResId)?.has(`${x},${y}`));
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

// Count uncovered coastal cells (within 1 row/col of map edge) a warehouse at (wx,wy) would newly cover.
// Used to find the best position for a dedicated coastal warehouse when water-tile buildings are needed.
function countNewCoastalCoverage(whId, wx, wy) {
  const { width, height, cells } = state.island;
  const fp = FOOTPRINTS[whId];
  if (!fp) return 0;
  let count = 0;
  for (const [dx, dy] of fp) {
    const cx = wx + dx, cy = wy + dy;
    if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
    const cell = cells[cy][cx];
    if (cell.terrain === 'water') continue;
    if (isInWarehouseRange(cx, cy)) continue;
    if (Math.min(cx, width - 1 - cx, cy, height - 1 - cy) <= 1) count++;
  }
  return count;
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

/** True if (x,y) is in any existing warehouse footprint or in the optional planned warehouse at (wx,wy). */
function isInWarehouseRangeConsidering(x, y, optWhId, optWx, optWy) {
  if (isInWarehouseRange(x, y)) return true;
  if (optWhId == null) return false;
  const fp = FOOTPRINTS[optWhId];
  if (!fp) return false;
  for (const [dx, dy] of fp) {
    if (optWx + dx === x && optWy + dy === y) return true;
  }
  return false;
}

/** Count island positions that can host a fisher (water_tile building) with warehouse delivery. */
function countFishAnchorsInRange(fisherId, waterNeeded, optWhId, optWx, optWy) {
  const { width, height } = state.island;
  let n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isInWarehouseRangeConsidering(x, y, optWhId, optWx, optWy)) continue;
      if (!canAutoPlace(fisherId, x, y)) continue;
      if (countTileResource(fisherId, x, y, 'water_tile', null) < waterNeeded) continue;
      n++;
    }
  }
  return n;
}

/** How many new fishable anchors a warehouse at (wx,wy) would enable vs current coverage only. */
function countNewFishAnchorsForWarehouse(whId, wx, wy, fisherId, waterNeeded) {
  const before = countFishAnchorsInRange(fisherId, waterNeeded, null, 0, 0);
  const after = countFishAnchorsInRange(fisherId, waterNeeded, whId, wx, wy);
  return Math.max(0, after - before);
}

// Find best position for a building (single top-scoring cell). Returns [ { x, y, score } ] or [].
// opts.claimedCells: Set of "cx,cy" strings — spatial tiles already used by prior buildings.
// opts.ignoreTileResources: Set of resIds to skip when checking tile requirements.
// opts.reservedCells: Set of "cx,cy" — cells reserved for other footprints (Phase 1.5).
// opts.penalizeServiceHotspots + opts.serviceHotspotSvcs: lower score where many services cover (save for houses).
// opts.preferNearAnchors: [{x,y}] — bonus toward same-type anchors (deposit sharing).
function findBestPositions(buildingId, building, opts) {
  const { width, height } = state.island;
  const requireWarehouse = opts && opts.requireWarehouse;
  const claimedCells = (opts && opts.claimedCells) || null;
  const ignoreTileResources = (opts && opts.ignoreTileResources) || null;
  const reservedCells = (opts && opts.reservedCells) || null;
  const penalizeHotspots = opts && opts.penalizeServiceHotspots;
  const hotspotSvcs = (opts && opts.serviceHotspotSvcs) || [];
  const preferNear = (opts && opts.preferNearAnchors) || [];
  const fp = FOOTPRINTS[buildingId] || [[0, 0]];
  let best = null;
  const gcX = width / 2, gcY = height / 2;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!canAutoPlace(buildingId, x, y)) continue;
      if (requireWarehouse && !isInWarehouseRange(x, y)) continue;
      if (reservedCells) {
        let overlapR = false;
        for (const [dx, dy] of fp) {
          if (reservedCells.has(`${x + dx},${y + dy}`)) { overlapR = true; break; }
        }
        if (overlapR) continue;
      }

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

      const dist = Math.abs(x - gcX) + Math.abs(y - gcY);
      let score = -dist * 0.1;
      if (building.inputs) {
        for (const [resId, needed] of Object.entries(building.inputs)) {
          if (!TILE_RESOURCE_IDS.has(resId)) continue;
          score += Math.min(countTileResource(buildingId, x, y, resId, claimedCells), needed) * 2;
        }
      }

      if (penalizeHotspots && _apServiceCov && hotspotSvcs.length > 0) {
        let nSvc = 0;
        for (const srv of hotspotSvcs) {
          if (_apServiceCov.get(srv)?.has(`${x},${y}`)) nSvc++;
        }
        score -= nSvc * 12;
      }

      if (preferNear.length > 0) {
        let md = Infinity;
        for (const a of preferNear) {
          md = Math.min(md, Math.abs(x - a.x) + Math.abs(y - a.y));
        }
        score += Math.max(0, 10 - md) * 0.35;
      }

      if (!best || score > best.score || (score === best.score && (x < best.x || (x === best.x && y < best.y)))) {
        best = { x, y, score };
      }
    }
  }
  return best ? [best] : [];
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

/**
 * Count distinct valid anchors for svcRes whose footprint contains (hx, hy).
 * occupiedHouseAnchors: Set of "x,y" for population building anchors already placed in Phase 3
 * (those cells can never host a service building anchor).
 * Skips anchor === (hx, hy): the hut will occupy that cell, so it cannot also be the tavern/cistern anchor.
 */
function countValidServiceAnchorsForCell(hx, hy, svcRes, occupiedHouseAnchors) {
  const occ = occupiedHouseAnchors || new Set();
  const providerId = pickServiceProvider(svcRes);
  if (!providerId) return 0;
  const fp = FOOTPRINTS[providerId];
  if (!fp || fp.length === 0) return 0;
  const seen = new Set();
  let n = 0;
  for (const [dx, dy] of fp) {
    const ax = hx - dx;
    const ay = hy - dy;
    if (ax === hx && ay === hy) continue;
    const key = `${ax},${ay}`;
    if (occ.has(key)) continue;
    if (seen.has(key)) continue;
    if (!canAutoPlace(providerId, ax, ay)) continue;
    seen.add(key);
    n++;
  }
  return n;
}

/** True if at least one valid service anchor exists (see countValidServiceAnchorsForCell). */
function canBeCoveredBySvc(hx, hy, svcRes, occupiedHouseAnchors) {
  return countValidServiceAnchorsForCell(hx, hy, svcRes, occupiedHouseAnchors) > 0;
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
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          if (!acceptsWater) { canPlace = false; break; }
          continue; // OOB = ocean, valid water tile
        }
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
  const { islandSize, phases, coverage, militiaInfo, missingDeposits } = log;
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

  if (militiaInfo) {
    console.log(
      `%cMilitia: ${militiaInfo.militiaPerMin.toFixed(3)}/min → ${militiaInfo.inferredHuts} Pioneer Huts inferred`,
      'color:#3498db'
    );
  }

  if (missingDeposits && missingDeposits.length > 0) {
    const depDesc = missingDeposits.map(p =>
      p.available === 0
        ? `${PP2DATA.getResourceName(p.depId)} (missing)`
        : `${PP2DATA.getResourceName(p.depId)} (${p.available}/${p.needed} tiles)`
    ).join(', ');
    console.warn(`%c⚠ Deposit problems: ${depDesc}`, 'color:#e74c3c;font-weight:bold');
  }

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
    console.group(`Phase 1.5 — Deposits & terrain (${phases.deposits.length} auto-placed)`);
    phases.deposits.forEach(d => {
      const k = d.kind || 'deposit';
      if (k === 'terrain') console.log(`+ ${d.name} terrain at (${d.x},${d.y})`);
      else console.log(`+ ${d.name} deposit at (${d.x},${d.y})`);
    });
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

  const popDemand = getPopulationDemand();
  const extraDemand = getCustomBuildingExtraDemand();
  const militaryDemand = getMilitaryDemand();
  const demand = mergeDemand(popDemand, extraDemand, militaryDemand);
  const hasHouses = hasAnyPopulationHouseRequested();
  const hasCustom = (state.customBuildingEntries || []).some(e => (e.count || 0) > 0);
  const hasMilitary = hasAnyMilitaryRequested();

  if (!hasHouses && !hasCustom && !hasMilitary) {
    alert('Set house counts, extra production buildings, and/or military targets before auto-populating.');
    return;
  }
  if (Object.keys(demand).length === 0 && hasCustom) {
    alert('Extra buildings must produce a good (have producePerMinute) to resolve a chain.');
    return;
  }
  if (Object.keys(demand).length === 0 && hasMilitary) {
    alert('Military targets need a positive rate per hour.');
    return;
  }

  // Save undo state
  pushUndo();

  const chainResult = resolveProductionChain(demand);
  let chainBuildings = chainResult.buildings;
  const { width, height } = state.island;

  // Militia inference: BootCamp → militia → Pioneer Huts
  const militiaInfo = inferMilitiaHuts(chainBuildings);
  let inferredHutCount = 0;
  if (militiaInfo) {
    inferredHutCount = Math.ceil(militiaInfo.hutsNeeded);
    const hutChain = resolveProductionChain(militiaInfo.hutDemand);
    mergeChainResults(chainResult, hutChain);
    chainBuildings = chainResult.buildings;
  }

  // Missing deposit check
  const missingDeposits = checkMissingDeposits(chainBuildings);

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
    militiaInfo: militiaInfo ? {
      militiaPerMin: militiaInfo.militiaPerMin,
      inferredHuts: inferredHutCount,
    } : null,
    missingDeposits,
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

  beginAutoPopulateCoverage();

  // === Gather what we need to place ===

  // Production buildings from chain
  const productionList = [];
  for (const [bId, entry] of Object.entries(chainBuildings)) {
    const needed = Math.ceil(entry.count);
    const already = placedCounts[bId] || 0;
    const remaining = needed - already;
    if (remaining > 0) {
      productionList.push({
        id: bId,
        building: entry.building,
        count: remaining,
        chainFraction: entry.count,
      });
    }
  }

  // Population houses (user-specified + militia-inferred)
  const popList = [];
  POP_BUILDINGS.forEach(pb => {
    let count = parseInt(document.getElementById(`planner-${pb.id}`).value) || 0;
    if (pb.id === 'PopulationPioneersHut') count += inferredHutCount;
    const already = placedCounts[pb.id] || 0;
    const remaining = count - already;
    if (remaining > 0) {
      const building = getBuildingData(pb.id);
      if (building) popList.push({ id: pb.id, building, count: remaining });
    }
  });

  // Service buildings — place exactly 1 of each required type in Phase 1 (near warehouse).
  // Phase 4 greedy top-up handles spreading additional services across the island.
  const totalPopHouses = popList.reduce((s, p) => s + p.count, 0);
  const serviceList = [];
  const requiredServices = getRequiredServices();
  if (inferredHutCount > 0) {
    const hutBuilding = PP2DATA.getBuilding('PopulationPioneersHut');
    if (hutBuilding && hutBuilding.consumePerMinute) {
      for (const resId of Object.keys(hutBuilding.consumePerMinute)) {
        if (SERVICE_RESOURCES.has(resId)) requiredServices.add(resId);
      }
    }
  }
  for (const svcRes of requiredServices) {
    const providerId = pickServiceProvider(svcRes);
    if (!providerId) continue;
    const already = placedCounts[providerId] || 0;
    if (already >= 1) continue;
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
      refreshApWarehouseCov();
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
    if (coverage >= 0.55 || totalProdNeeded <= 8) break;

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
      refreshApWarehouseCov();
      placed.push({ id: whId, x: bestWh.x, y: bestWh.y });
      runLog.phases.warehouses.placed.push({ name: whBuilding.name || whId, x: bestWh.x, y: bestWh.y });
    } else {
      break;
    }
  }

  // === PHASE 0.5: Coastal warehouse(s) ===
  // Fisher huts need warehouse range *and* enough water_tile cells; one Warehouse3 often covers
  // only two such anchors. Loop: add coastal warehouses until we have enough fishable anchors
  // or placements stop improving.
  {
    const fishItems = productionList.filter(
      item => item.building.inputs && 'water_tile' in item.building.inputs
    );
    if (fishItems.length > 0) {
      const fisherId = fishItems[0].id;
      const waterNeeded = Math.ceil(fishItems[0].building.inputs.water_tile);
      const totalFishNeeded = fishItems.reduce((s, it) => s + it.count, 0);
      const maxExtra = Math.min(8, Math.max(1, totalFishNeeded));
      for (let extra = 0; extra < maxExtra; extra++) {
        const viable = countFishAnchorsInRange(fisherId, waterNeeded, null, 0, 0);
        if (viable >= totalFishNeeded) break;
        const whId = pickWarehouseId();
        const whBuilding = getBuildingData(whId) || {};
        let bestWh = null;
        let bestNewFish = -1;
        let bestCoastal = -1;
        for (let cy = 0; cy < height; cy++) {
          for (let cx = 0; cx < width; cx++) {
            if (!canAutoPlace(whId, cx, cy)) continue;
            const newFish = countNewFishAnchorsForWarehouse(whId, cx, cy, fisherId, waterNeeded);
            const coastal = countNewCoastalCoverage(whId, cx, cy);
            if (newFish > bestNewFish || (newFish === bestNewFish && coastal > bestCoastal)) {
              bestNewFish = newFish;
              bestCoastal = coastal;
              bestWh = { x: cx, y: cy };
            }
          }
        }
        if (!bestWh || bestNewFish <= 0) break;
        autoPlaceBuilding(whId, bestWh.x, bestWh.y);
        refreshApWarehouseCov();
        placed.push({ id: whId, x: bestWh.x, y: bestWh.y });
        runLog.phases.warehouses.placed.push({ name: whBuilding.name || whId, x: bestWh.x, y: bestWh.y });
      }
    }
  }

  // === PHASE 1: Services (before houses, so houses can target coverage) ===
  // Place services centrally to maximize future house coverage; must stay in warehouse range.
  for (const item of serviceList) {
    for (let i = 0; i < item.count; i++) {
      const positions = findBestPositions(item.id, item.building, { requireWarehouse: true });
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

  refreshApServiceCov();

  // Same ordering as Phase 2 so deposit painting prioritizes constrained buildings first
  sortProductionListByConstraint(productionList);

  // === PHASE 1.5: Auto-place missing deposits & terrain in building footprints ===
  // For each production building that needs a deposit (apple_trees, hop_field, etc.) or
  // paintable terrain (forest for Lumberjack), find a valid position first (ignoring those
  // requirements), then paint so Phase 2 can place the building there.
  // Rate-based tiles use chainFraction × consumePerMinute / tile producePerMinute.
  // Cells painted here must NOT be used as house anchors in Phase 3.
  const paintedResourceCells = new Set();
  {
    const depositTypeSet = DEPOSIT_TYPE_ID_SET;
    const reservedCells = new Set();

    function tilesNeededPerBuilding(building, resId, chainFraction) {
      const inputMin = building.inputs[resId] || 1;
      const consumeRate = (building.consumePerMinute || {})[resId];
      if (!consumeRate) return inputMin;
      const producers = PP2DATA.getProducersOf(resId) || [];
      const tile = producers.find(p => PP2DATA.getTile(p.id));
      if (!tile || !tile.producePerMinute || tile.iterationTime <= 1) return inputMin;
      const frac = chainFraction != null ? chainFraction : 1;
      return Math.max(inputMin, Math.ceil(frac * consumeRate / tile.producePerMinute));
    }

    for (const item of productionList) {
      if (!item.building.inputs) continue;
      const depositInputs = Object.entries(item.building.inputs)
        .filter(([r]) => TILE_RESOURCE_IDS.has(r) && depositTypeSet.has(r) && !NATURAL_DEPOSIT_IDS.has(r));
      const terrainInputs = Object.entries(item.building.inputs)
        .filter(([r]) => TILE_RESOURCE_IDS.has(r) && TERRAIN_PAINT_RESOURCES[r]);
      if (depositInputs.length === 0 && terrainInputs.length === 0) continue;

      const sameTypeAnchors = [];
      const chainFrac = item.chainFraction != null ? item.chainFraction : item.count;

      for (let i = 0; i < item.count; i++) {
        const ignoreRes = new Set([
          ...depositInputs.map(([r]) => r),
          ...terrainInputs.map(([r]) => r),
        ]);
        const phase15Opts = {
          requireWarehouse: true,
          claimedCells,
          ignoreTileResources: ignoreRes,
          reservedCells,
        };
        if (sameTypeAnchors.length) phase15Opts.preferNearAnchors = sameTypeAnchors.slice();
        const positions = findBestPositions(item.id, item.building, phase15Opts);
        if (positions.length === 0) continue;

        const pos = positions[0];
        const fp = FOOTPRINTS[item.id] || [[0, 0]];
        // The game only places the building on the anchor cell; deposits/terrain must live on
        // other footprint cells. Painting on (0,0) looks correct until Phase 2 places the
        // building and the main tile covers the apple tree / field.
        const skipAnchorForPaint = fp.length > 1;
        for (const [resId] of depositInputs) {
          const needed = tilesNeededPerBuilding(item.building, resId, chainFrac);
          const have = countTileResource(item.id, pos.x, pos.y, resId, claimedCells);
          const deficit = needed - have;
          if (deficit <= 0) continue;

          let placedCount = 0;
          for (const [dx, dy] of fp) {
            if (skipAnchorForPaint && dx === 0 && dy === 0) continue;
            if (placedCount >= deficit) break;
            const cx = pos.x + dx, cy = pos.y + dy;
            if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
            const cell = state.island.cells[cy][cx];
            if (cell.terrain !== 'grass') continue;
            if (cell.deposit) continue;
            if (cell.building) continue;
            if (claimedCells.has(`${cx},${cy}`)) continue;
            cell.deposit = resId;
            paintedResourceCells.add(`${cx},${cy}`);
            placedCount++;
            runLog.phases.deposits.push({ kind: 'deposit', resId, name: PP2DATA.getResourceName(resId), x: cx, y: cy });
          }
        }
        for (const [resId] of terrainInputs) {
          const ter = TERRAIN_PAINT_RESOURCES[resId];
          const needed = tilesNeededPerBuilding(item.building, resId, chainFrac);
          const have = countTileResource(item.id, pos.x, pos.y, resId, claimedCells);
          const deficit = needed - have;
          if (deficit <= 0) continue;

          let painted = 0;
          for (const [dx, dy] of fp) {
            if (skipAnchorForPaint && dx === 0 && dy === 0) continue;
            if (painted >= deficit) break;
            const cx = pos.x + dx, cy = pos.y + dy;
            if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
            const cell = state.island.cells[cy][cx];
            if (cell.terrain !== 'grass') continue;
            if (cell.building) continue;
            if (cell.deposit && NATURAL_DEPOSIT_IDS.has(cell.deposit)) {
              // #region agent log
              console.log(`[DBG Terrain] Skipped painting ${ter} over ${cell.deposit} at (${cx},${cy})`);
              // #endregion
              continue;
            }
            if (claimedCells.has(`${cx},${cy}`)) continue;
            cell.terrain = ter;
            paintedResourceCells.add(`${cx},${cy}`);
            painted++;
            runLog.phases.deposits.push({
              kind: 'terrain',
              resId,
              name: PP2DATA.getResourceName(resId),
              x: cx,
              y: cy,
            });
          }
        }
        sameTypeAnchors.push({ x: pos.x, y: pos.y });
        for (const [dx, dy] of fp) {
          reservedCells.add(`${pos.x + dx},${pos.y + dy}`);
        }
      }
    }
  }

  // === PHASE 2: Production buildings (most constrained first) ===
  sortProductionListByConstraint(productionList);

  for (const item of productionList) {
    for (let i = 0; i < item.count; i++) {
      const positions = findBestPositions(item.id, item.building, {
        requireWarehouse: true,
        claimedCells,
      });
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
            if (NATURAL_DEPOSIT_IDS.has(resId) && missingDeposits.some(p => p.depId === resId)) {
              const p = missingDeposits.find(p => p.depId === resId);
              reason = p.available === 0
                ? `missing ${PP2DATA.getResourceName(resId)} deposit on island`
                : `insufficient ${PP2DATA.getResourceName(resId)} tiles (${p.available}/${p.needed})`;
            } else {
              reason = `needs ${PP2DATA.getResourceName(resId)} tiles`;
            }
            break;
          }
        }
        if (LOCATION_REQUIREMENTS[item.id]) {
          reason = LOCATION_REQUIREMENTS[item.id].label;
        }
        failed.push({ id: item.id, reason });
        const diagnosis = diagnosePlacementFailure(item.id, item.building, {
          requireWarehouse: true,
          claimedCells,
        });
        runLog.phases.production.failed.push({ name: item.building.name || item.id, reason, diagnosis });
      }
    }
  }

  cleanupOrphanDepositsAfterPhase2(width, height);

  // === PHASE 2.5: Pre-house service spread ===
  // Greedily spread service buildings across all land tiles BEFORE houses are placed.
  // This ensures Tavern/Cistern anchors aren't blocked by houses in Phase 3.
  // Target: enough services so ~every land tile has coverage (1 per ~6 houses needed).
  {
    const spreadTarget = Math.max(2, Math.ceil(totalPopHouses / 6));
    for (const svcRes of requiredServices) {
      const providerId = pickServiceProvider(svcRes);
      if (!providerId) continue;
      const providerBuilding = getBuildingData(providerId);
      if (!providerBuilding) continue;
      const fp = FOOTPRINTS[providerId];
      if (!fp) continue;

      const alreadyPlaced = state.island.buildings.filter(b => b.id === providerId).length;

      for (let i = alreadyPlaced; i < spreadTarget; i++) {
        let bestPos = null, bestCount = 0;
        for (let sy = 0; sy < height; sy++) {
          for (let sx = 0; sx < width; sx++) {
            if (!canAutoPlace(providerId, sx, sy)) continue;
            // Count uncovered land tiles within this service building's footprint
            let count = 0;
            for (const [dx, dy] of fp) {
              const cx = sx + dx, cy = sy + dy;
              if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
              const cell = state.island.cells[cy][cx];
              if (cell.terrain === 'water') continue;
              if (cell.deposit && NATURAL_DEPOSIT_IDS.has(cell.deposit)) continue;
              if (!isInServiceCoverage(cx, cy, svcRes)) count++;
            }
            if (count > bestCount) { bestCount = count; bestPos = { sx, sy }; }
          }
        }
        if (!bestPos || bestCount === 0) break;
        autoPlaceBuilding(providerId, bestPos.sx, bestPos.sy);
        refreshApServiceCov();
        placed.push({ id: providerId, x: bestPos.sx, y: bestPos.sy });
        runLog.phases.services.placed.push({ name: providerBuilding.name || providerId, x: bestPos.sx, y: bestPos.sy, serviceRes: svcRes });
      }
    }
  }

  // === PHASE 3: Population houses (must be within service coverage) ===
  const houseAnchorOccupied = new Set(); // population anchors — block future service anchors here
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
          if (!isInWarehouseRange(x, y)) continue;
          if (claimedCells.has(`${x},${y}`)) continue; // don't place house anchor on claimed resource cell
          if (paintedResourceCells.has(`${x},${y}`)) continue; // don't place house on Phase 1.5 painted deposits/terrain

          // Count how many required services cover this position
          let svcCovered = 0;
          for (const svcRes of neededServices) {
            if (isInServiceCoverage(x, y, svcRes)) svcCovered++;
          }

          // Strongly prefer full service coverage
          let svcScore = neededServices.length > 0
            ? (svcCovered / neededServices.length) * 100
            : 0;
          // De-prioritize cells that cannot be covered after Phase 3: anchors blocked by houses already
          // placed, or only a single remaining anchor (likely clobbered by a later house on that cell).
          for (const svcRes of neededServices) {
            if (isInServiceCoverage(x, y, svcRes)) continue;
            const anchorCount = countValidServiceAnchorsForCell(x, y, svcRes, houseAnchorOccupied);
            if (anchorCount === 0) svcScore -= 500;
            else if (anchorCount === 1) svcScore -= 250;
          }

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
        houseAnchorOccupied.add(`${bestPos.x},${bestPos.y}`);
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
  // covered or no valid position improves coverage.
  // Attempt cap = total population houses (worst case: one service per house).
  const phase4Cap = Math.max(10, totalPopHouses);
  for (const svcRes of requiredServices) {
    const providerId = pickServiceProvider(svcRes);
    if (!providerId) continue;
    const providerBuilding = getBuildingData(providerId);
    if (!providerBuilding) continue;
    const fp = FOOTPRINTS[providerId];
    if (!fp) continue;

    for (let attempt = 0; attempt < phase4Cap; attempt++) {
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

      if (!bestPos || bestCount === 0) {
        // #region agent log
        console.log(`[DBG Phase4] ${svcRes}: no coverage found. ${uncovered.length} uncovered houses at:`, uncovered.map(h => `(${h.x},${h.y})`).join(', '));
        // #endregion
        break;
      }
      autoPlaceBuilding(providerId, bestPos.x, bestPos.y);
      refreshApServiceCov();
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

  endAutoPopulateCoverage();

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
  if (missingDeposits.length > 0) {
    const depDesc = missingDeposits.map(p =>
      p.available === 0
        ? `${PP2DATA.getResourceName(p.depId)} (missing)`
        : `${PP2DATA.getResourceName(p.depId)} (${p.available}/${p.needed} tiles)`
    ).join(', ');
    msg += `\nDeposit problems: ${depDesc}`;
  }
  if (militiaInfo) {
    msg += `\n${inferredHutCount} Pioneer Huts auto-added for militia (${militiaInfo.militiaPerMin.toFixed(2)}/min)`;
  }
  showAutoPopulateResult(msg, placed.length, failed.length + missingDeposits.length);
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
