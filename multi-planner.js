// ===== MULTI-ISLAND DISTRIBUTION PLANNER =====
// Cross-slot production + shipping options; uses planner.js resolve helpers + ships.js fleet.

/**
 * Run fn with state.islandType / state.activeFertilities as for projectSlots[slotIndex].
 * @param {number} slotIndex
 * @param {function(): T} fn
 * @returns {T}
 */
function withProjectSlotContext(slotIndex, fn) {
  const slot = state.projectSlots[slotIndex];
  if (!slot) throw new Error('Invalid slot index');
  const prevType = state.islandType;
  const prevFert = state.activeFertilities;
  state.islandType = slot.type;
  state.activeFertilities = new Set(
    Array.isArray(slot.activeFertilities) && slot.activeFertilities.length
      ? slot.activeFertilities.slice()
      : getDefaultFertilityIdsForArchetype(slot.type)
  );
  try {
    return fn();
  } finally {
    state.islandType = prevType;
    state.activeFertilities = prevFert;
  }
}

/** True if tile resource can be grown on this slot (climate + fertility checkbox). */
function isTileResourceProducibleOnSlot(slot, tileResId) {
  if (!tileResId) return false;
  for (const [type, list] of Object.entries(FERTILITY_RESOURCES)) {
    if (!list) continue;
    for (const f of list) {
      if (!f.tileResources.includes(tileResId)) continue;
      if (type !== slot.type) return false;
      const set = new Set(slot.activeFertilities || []);
      return set.has(f.id);
    }
  }
  return true;
}

/**
 * True if the full chain for final resource resId at rate can be built on slotIndex
 * without fertility-blocked tile inputs.
 */
function canSlotProduceResourceFully(slotIndex, resId, rate) {
  return withProjectSlotContext(slotIndex, () => {
    const { buildings, tileNeeds } = resolveProductionChain({ [resId]: rate });
    // pickProducer can return null (e.g. cider on island without apple fertility) → empty chain;
    // without this guard we would vacuously return true and skip cross-island routing.
    if (
      rate > 0 &&
      Object.keys(buildings).length === 0 &&
      Object.keys(tileNeeds).length === 0
    ) {
      return false;
    }
    for (const tn of Object.values(tileNeeds)) {
      const tr = tn.producedResource;
      if (typeof isTileResourceFertilityBlocked === 'function' && isTileResourceFertilityBlocked(tr)) return false;
    }
    for (const entry of Object.values(buildings)) {
      const b = entry.building;
      if (!b.inputs) continue;
      for (const inputId of Object.keys(b.inputs)) {
        if (!TILE_RESOURCE_IDS.has(inputId)) continue;
        if (typeof isTileResourceFertilityBlocked === 'function' && isTileResourceFertilityBlocked(inputId)) return false;
      }
    }
    return true;
  });
}

/** Sum footprint tiles × fractional building counts. */
function sumChainFootprintTiles(chainBuildings) {
  let n = 0;
  for (const entry of Object.values(chainBuildings)) {
    const fp = FOOTPRINTS[entry.building.id];
    n += (fp ? fp.length : 1) * entry.count;
  }
  return n;
}

/** Per-cargo-slot throughput (goods/min) for round trips; one good type per slot per trip. */
function fleetSlotThroughputsSorted(shipCounts) {
  const slots = [];
  if (typeof getAllShipTypesFlat !== 'function') return slots;
  for (const def of getAllShipTypesFlat()) {
    const n = Math.max(0, Math.floor(shipCounts[def.id] || 0));
    if (n <= 0 || !def.inRegionTravelMinutes || def.inRegionTravelMinutes <= 0) continue;
    const perSlot = def.goodsPerSlotMax / (2 * def.inRegionTravelMinutes);
    const count = n * Math.max(1, def.cargoSlots);
    for (let i = 0; i < count; i++) {
      slots.push({
        throughput: perSlot,
        shipId: def.id,
        goodsPerSlotMax: def.goodsPerSlotMax,
      });
    }
  }
  slots.sort((a, b) => b.throughput - a.throughput);
  return slots;
}

/** Total fleet capacity (goods/min) — optimistic: sum of all slot throughputs. */
function totalFleetThroughputCapacity(shipCounts) {
  return fleetSlotThroughputsSorted(shipCounts).reduce((s, x) => s + x.throughput, 0);
}

/**
 * Trace building chain for a final good; return ship candidates from least processed to most
 * (e.g. wheat, flour, bread). Each: { good, rate, label }.
 */
function traceChainShipCandidates(finalResId, finalRate) {
  const spatialTileResources = new Set();
  PP2DATA.tiles.forEach(t => { if (t.iterationTime <= 1) spatialTileResources.add(t.produces); });
  const candidates = [];

  function walk(resId, rateNeeded) {
    if (rateNeeded <= 0 || SERVICE_RESOURCES.has(resId)) return;
    if (spatialTileResources.has(resId)) return;
    const producers = PP2DATA.getProducersOf(resId);
    if (!producers || producers.length === 0) return;

    if (TILE_RESOURCE_IDS.has(resId)) {
      const tile = producers.find(p => PP2DATA.getTile(p.id));
      if (tile && tile.iterationTime > 1) return;
      return;
    }

    const producer = pickProducer(resId, producers);
    if (!producer || !producer.producePerMinute) return;

    candidates.push({
      good: resId,
      rate: rateNeeded,
      label: PP2DATA.getResourceName(resId) || resId,
    });
    const count = rateNeeded / producer.producePerMinute;
    if (producer.consumePerMinute) {
      for (const [inp, ir] of Object.entries(producer.consumePerMinute)) {
        walk(inp, ir * count);
      }
    }
  }

  walk(finalResId, finalRate);
  return candidates.reverse();
}

function cartesianChoices(crossChains) {
  const arrays = crossChains.map(c => c.shipChoices.map(sc => ({ chain: c, cut: sc })));
  if (arrays.length === 0) return [[]];
  function prod(arr, i) {
    if (i >= arr.length) return [[]];
    const tail = prod(arr, i + 1);
    const out = [];
    for (const x of arr[i]) {
      for (const t of tail) out.push([x, ...t]);
    }
    return out;
  }
  return prod(arrays, 0);
}

function slotLabel(idx) {
  const slot = state.projectSlots[idx];
  if (!slot) return `Slot ${idx}`;
  const name = (slot.name || '').trim();
  const t = slot.type === 'tropical' ? 'Tropical' : 'Temperate';
  let ord = 0;
  for (let i = 0; i <= idx; i++) {
    if (state.projectSlots[i].type === slot.type) ord++;
  }
  const base = `${t} ${ord}`;
  return name ? `${name} (${base})` : base;
}

/**
 * @param {Object} houseCountsByPopId
 * @param {Object} shipCounts — state.projectShipCounts shape
 * @returns {{ options: object[], error?: string }}
 */
function analyzeMultiIslandPlan(houseCountsByPopId, shipCounts) {
  const sc = shipCounts || state.projectShipCounts || {};
  if (typeof isMultiIslandProject !== 'function' || !isMultiIslandProject()) {
    return { error: 'Enable a multi-island project first.', options: [] };
  }
  const slots = state.projectSlots;
  if (slots.length < 2) {
    return { error: 'Need at least two islands to analyze distribution.', options: [] };
  }

  const demand = getPopulationDemandFromHouseCounts(houseCountsByPopId);
  const demandKeys = Object.keys(demand).filter(k => (demand[k] || 0) > 0);
  if (demandKeys.length === 0) {
    return { error: 'Enter at least one house count above zero.', options: [] };
  }
  const totalCap = totalFleetThroughputCapacity(sc);

  const options = [];
  const slotIndices = slots.map((_, i) => i);

  for (const homeIdx of slotIndices) {
    const others = slotIndices.filter(i => i !== homeIdx);

    const crossChains = [];
    let impossible = false;

    for (const [resId, rate] of Object.entries(demand)) {
      if (SERVICE_RESOURCES.has(resId)) continue;
      if (rate <= 0) continue;

      if (canSlotProduceResourceFully(homeIdx, resId, rate)) continue;

      let sourceIdx = -1;
      for (const o of others) {
        if (canSlotProduceResourceFully(o, resId, rate)) {
          sourceIdx = o;
          break;
        }
      }
      if (sourceIdx < 0) {
        impossible = true;
        break;
      }

      const shipChoices = withProjectSlotContext(sourceIdx, () => traceChainShipCandidates(resId, rate));
      if (shipChoices.length === 0) {
        impossible = true;
        break;
      }
      crossChains.push({
        finalRes: resId,
        rate,
        sourceIdx,
        shipChoices,
      });
    }

    if (impossible) continue;

    const combos = cartesianChoices(crossChains);
    for (const combo of combos) {
      const importRates = {};
      const remoteDemandBySlot = {};
      const routes = [];

      for (const pick of combo) {
        const { chain, cut } = pick;
        importRates[cut.good] = (importRates[cut.good] || 0) + cut.rate;
        const sIdx = chain.sourceIdx;
        if (!remoteDemandBySlot[sIdx]) remoteDemandBySlot[sIdx] = {};
        remoteDemandBySlot[sIdx][cut.good] = (remoteDemandBySlot[sIdx][cut.good] || 0) + cut.rate;
        routes.push({
          good: cut.good,
          label: cut.label,
          ratePerMin: cut.rate,
          from: sIdx,
          to: homeIdx,
          finalGood: chain.finalRes,
        });
      }

      const shipRateSum = routes.reduce((s, r) => s + r.ratePerMin, 0);
      const fleetFeasible = totalCap + 1e-9 >= shipRateSum;

      const homeChain = withProjectSlotContext(homeIdx, () =>
        resolveProductionChainWithImports(demand, importRates));

      const remoteFootprints = {};
      const remoteChains = {};
      for (const [sIdxStr, partDemand] of Object.entries(remoteDemandBySlot)) {
        const sIdx = parseInt(sIdxStr, 10);
        const chainPart = withProjectSlotContext(sIdx, () => resolveProductionChain(partDemand));
        remoteChains[sIdx] = chainPart;
        remoteFootprints[sIdx] = sumChainFootprintTiles(chainPart.buildings);
      }

      const homeFp = sumChainFootprintTiles(homeChain.buildings);
      let totalRemoteFp = Object.values(remoteFootprints).reduce((a, b) => a + b, 0);

      const margin = totalCap - shipRateSum;
      let score = 0;
      if (fleetFeasible) score += 1e6;
      score += margin * 100;
      score -= (homeFp + totalRemoteFp) * 0.001;

      options.push({
        homeIdx,
        homeLabel: slotLabel(homeIdx),
        routes,
        importRates,
        remoteDemandBySlot,
        homeChain: homeChain.buildings,
        remoteChains,
        homeFootprintTiles: homeFp,
        remoteFootprintTiles: remoteFootprints,
        totalFootprintTiles: homeFp + totalRemoteFp,
        shipRateSum,
        fleetCapacity: totalCap,
        fleetFeasible,
        margin,
        score,
        houseCountsByPopId: { ...houseCountsByPopId },
      });
    }
  }

  options.sort((a, b) => b.score - a.score);
  return { options, totalFleetCapacity: totalCap };
}

function buildPopListOverrideFromCounts(houseCountsByPopId) {
  const popList = [];
  for (const pb of POP_BUILDINGS) {
    const count = houseCountsByPopId[pb.id] || 0;
    if (count <= 0) continue;
    const building = getBuildingData(pb.id);
    if (building) popList.push({ id: pb.id, building, count });
  }
  return popList;
}

/**
 * Merge remote + home chain building maps for militia infer (home only in v1).
 */
function mergeRemoteChainBuildings(remoteChains) {
  const merged = {};
  for (const ch of Object.values(remoteChains)) {
    if (!ch || !ch.buildings) continue;
    for (const [bid, entry] of Object.entries(ch.buildings)) {
      if (merged[bid]) merged[bid].count += entry.count;
      else merged[bid] = { ...entry, count: entry.count };
    }
  }
  return merged;
}

/**
 * Execute ranked option: auto-place production on source slot(s), then houses + local chain on home.
 */
function executeMultiIslandPlan(option) {
  if (!option || option.homeIdx == null) return;
  const slots = state.projectSlots;
  if (!slots.length) return;

  const missingGrid = [];
  slots.forEach((s, i) => { if (!s.island) missingGrid.push(slotLabel(i)); });
  if (missingGrid.length) {
    alert('Create island grids first for: ' + missingGrid.join(', '));
    return;
  }

  const startActive = state.activeSlotIndex;
  if (typeof pushUndo === 'function') pushUndo();

  const remoteIndices = Object.keys(option.remoteDemandBySlot || {}).map(s => parseInt(s, 10));
  remoteIndices.sort((a, b) => a - b);

  try {
    for (const rIdx of remoteIndices) {
      if (typeof setActiveSlot === 'function') setActiveSlot(rIdx, { skipCommit: false });
      const chainPart = option.remoteChains[rIdx];
      const buildings = chainPart ? chainPart.buildings : {};
      if (typeof autoPopulateFromResolvedChain === 'function') {
        autoPopulateFromResolvedChain(buildings, {
          popListOverride: [],
          militiaInfo: null,
          inferredHutCount: 0,
        });
      }
      if (typeof commitActiveSlotFromState === 'function') commitActiveSlotFromState();
    }

    const homeIdx = option.homeIdx;
    if (typeof setActiveSlot === 'function') setActiveSlot(homeIdx, { skipCommit: false });

    // Use the same building map as Analyze — re-calling resolveProductionChainWithImports here can
    // diverge (pickProducer FlourMill vs FlourWindmill, float slop on import rates) and wrongly add
    // e.g. wheat farms on an apple-only home when bread was planned as imported.
    let homeBuildings = option.homeChain;
    if (!homeBuildings || typeof homeBuildings !== 'object') {
      homeBuildings = withProjectSlotContext(homeIdx, () =>
        resolveProductionChainWithImports(
          getPopulationDemandFromHouseCounts(option.houseCountsByPopId),
          option.importRates || {}
        ).buildings);
    }

    const popList = buildPopListOverrideFromCounts(option.houseCountsByPopId);

    if (typeof autoPopulateFromResolvedChain === 'function') {
      autoPopulateFromResolvedChain(homeBuildings, {
        popListOverride: popList,
        militiaInfo: null,
        inferredHutCount: 0,
      });
    }
    if (typeof commitActiveSlotFromState === 'function') commitActiveSlotFromState();

    if (typeof setActiveSlot === 'function') setActiveSlot(startActive, { skipCommit: true });

    alert('Multi-island placement complete. Switched back to your previous slot — check each island.');
  } catch (e) {
    console.error(e);
    alert('Multi-island execution failed: ' + (e && e.message));
    try {
      if (typeof setActiveSlot === 'function') setActiveSlot(startActive, { skipCommit: true });
    } catch (_) { /* ignore */ }
  }
}

function showMultiIslandPlannerModal() {
  if (typeof isMultiIslandProject !== 'function' || !isMultiIslandProject()) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:520px;max-height:90vh;display:flex;flex-direction:column;">
      <h2>Plan across islands</h2>
      <p style="font-size:0.8rem;color:#aaa;margin-bottom:10px;">
        Enter total population to place on <strong>one</strong> home island. Other islands may supply fertility‑gated chains (e.g. wheat vs apples). Production-only slots get no houses.
      </p>
      <div id="multi-planner-inputs" style="overflow-y:auto;flex:1;padding-right:4px;"></div>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="header-btn" id="multi-planner-analyze" style="background:#e94560;border-color:#e94560;">Analyze</button>
        <button type="button" class="header-btn" id="multi-planner-close">Close</button>
      </div>
      <div id="multi-planner-results" style="margin-top:12px;max-height:40vh;overflow-y:auto;font-size:0.78rem;"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const inputsEl = overlay.querySelector('#multi-planner-inputs');
  const resultsEl = overlay.querySelector('#multi-planner-results');

  const rows = POP_BUILDINGS.map(pb =>
    `<div class="planner-row" style="margin-bottom:6px;">
      <label style="min-width:140px;display:inline-block;">${pb.label}:</label>
      <input type="number" min="0" value="0" data-multi-pop="${pb.id}" style="width:64px;padding:4px;">
    </div>`
  ).join('');
  inputsEl.innerHTML = rows;
  POP_BUILDINGS.forEach(pb => {
    const domInp = document.getElementById(`planner-${pb.id}`);
    const v = domInp ? Math.max(0, parseInt(domInp.value, 10) || 0) : 0;
    const el = overlay.querySelector(`[data-multi-pop="${pb.id}"]`);
    if (el) el.value = v;
  });

  const close = () => overlay.remove();
  overlay.querySelector('#multi-planner-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  function readHouseCounts() {
    const m = {};
    overlay.querySelectorAll('[data-multi-pop]').forEach(inp => {
      const id = inp.getAttribute('data-multi-pop');
      m[id] = Math.max(0, parseInt(inp.value, 10) || 0);
    });
    return m;
  }

  overlay.querySelector('#multi-planner-analyze').addEventListener('click', () => {
    const counts = readHouseCounts();
    const shipCounts = state.projectShipCounts || {};
    const { options, error, totalFleetCapacity } = analyzeMultiIslandPlan(counts, shipCounts);
    if (error) {
      resultsEl.innerHTML = `<p style="color:#e74c3c;">${error}</p>`;
      return;
    }
    if (options.length === 0) {
      resultsEl.innerHTML = '<p style="color:#f39c12;">No valid options (check fertilities and demand).</p>';
      return;
    }

    let html = `<p style="color:#888;">Fleet capacity (sum of slot throughputs): <strong>${totalFleetCapacity.toFixed(3)}</strong> goods/min</p>`;
    html += '<div style="display:flex;flex-direction:column;gap:10px;">';

    options.slice(0, 12).forEach((opt, i) => {
      const routeStr = opt.routes.map(r =>
        `${r.label}: ${r.ratePerMin.toFixed(3)}/min → slot ${r.to + 1} (${slotLabel(r.from)} → home)`
      ).join('<br>');

      const fpStr = `Home ~${opt.homeFootprintTiles.toFixed(0)} tiles` +
        Object.entries(opt.remoteFootprintTiles || {}).map(([si, v]) =>
          ` · ${slotLabel(parseInt(si, 10))} ~${v.toFixed(0)}`
        ).join('');

      html += `
        <div style="border:1px solid #0f3460;border-radius:6px;padding:10px;background:#16213e;">
          <strong style="color:#e94560;">#${i + 1} Home: ${opt.homeLabel}</strong>
          <span style="color:${opt.fleetFeasible ? '#2ecc71' : '#e74c3c'};float:right;">
            Ship total ${opt.shipRateSum.toFixed(3)}/min ${opt.fleetFeasible ? '≤ fleet' : 'EXCEEDS fleet'}
          </span>
          <div style="margin-top:6px;color:#ccc;">${routeStr || 'No cross-island goods'}</div>
          <div style="margin-top:4px;color:#888;">${fpStr}</div>
          <button type="button" class="header-btn multi-opt-exec" data-opt-index="${i}" style="margin-top:8px;font-size:0.75rem;">
            Execute this plan
          </button>
        </div>
      `;
    });
    html += '</div>';

    resultsEl.innerHTML = html;
    overlay._multiOptions = options;

    resultsEl.querySelectorAll('.multi-opt-exec').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-opt-index'), 10);
        const opt = overlay._multiOptions && overlay._multiOptions[idx];
        if (!opt) return;
        if (!opt.fleetFeasible && !confirm('Fleet capacity may be insufficient. Execute anyway?')) return;
        executeMultiIslandPlan(opt);
        close();
      });
    });
  });
}

(function initMultiIslandPlannerButton() {
  const btn = document.getElementById('btn-multi-island-plan');
  if (!btn || btn.dataset.wired === '1') return;
  btn.dataset.wired = '1';
  btn.addEventListener('click', () => showMultiIslandPlannerModal());
})();
