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
  // Active slot: use live checkbox Set so analysis never lags behind projectSlots[active] (save/UI race).
  // Other slots: use persisted slot.activeFertilities via effectiveSlotFertilitySet.
  const useLiveFert =
    typeof isMultiIslandProject === 'function' &&
    isMultiIslandProject() &&
    slotIndex === state.activeSlotIndex &&
    state.activeFertilities instanceof Set;
  state.activeFertilities = useLiveFert
    ? new Set(state.activeFertilities)
    : effectiveSlotFertilitySet(slot);
  try {
    return fn();
  } finally {
    state.islandType = prevType;
    state.activeFertilities = prevFert;
  }
}

/**
 * Estimated max houses per tier for one project slot’s grid and fertilities.
 * Does not change state.island; uses slot.island for terrain scan.
 */
function computeIslandCapacityForProjectSlot(slotIndex, militaryEntries) {
  const slot = state.projectSlots && state.projectSlots[slotIndex];
  if (!slot || typeof computeIslandCapacity !== 'function') {
    return { terrainBudget: typeof computeTerrainBudget === 'function' ? computeTerrainBudget(null) : {}, tiers: [] };
  }
  return withProjectSlotContext(slotIndex, () =>
    computeIslandCapacity({
      island: slot.island || null,
      militaryEntries,
    })
  );
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
        if (TILE_RESOURCE_IDS.has(inputId)) {
          if (typeof isTileResourceFertilityBlocked === 'function' && isTileResourceFertilityBlocked(inputId)) return false;
        } else if (typeof isFertilityIdBlocked === 'function' && isFertilityIdBlocked(inputId)) {
          return false;
        }
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

/** Numeric tolerance for rate balance checks (goods/min). */
const MULTI_ISLAND_RATE_EPS = 1e-5;

const _MULTI_TIER_ORDER = ['Pioneers', 'Colonists', 'Townsmen', 'Farmers', 'Merchants', 'Workers', 'Paragons', 'Northern Islands'];

/**
 * Sum output rates (goods/min) from a resolved chain building map.
 * @param {Object} buildings chainBuildings from resolveProductionChain*
 * @returns {Record<string, number>}
 */
function aggregateOutputRatesFromChainBuildings(buildings) {
  const out = {};
  if (!buildings || typeof buildings !== 'object') return out;
  for (const entry of Object.values(buildings)) {
    const b = entry && entry.building;
    const resId = entry && entry.producedResource;
    if (!b || !resId || !b.producePerMinute) continue;
    const rate = (entry.count || 0) * b.producePerMinute;
    if (rate === 0) continue;
    out[resId] = (out[resId] || 0) + rate;
  }
  return out;
}

/**
 * Sum of max(0, local home output − population need) per non-service good (imports ignored).
 * Used to compare plans by on-island overproduction headroom.
 */
function computeHomeLocalSurplus(option, demand) {
  const homeAgg = aggregateOutputRatesFromChainBuildings(option && option.homeChain);
  let sum = 0;
  for (const [resId, need] of Object.entries(demand || {})) {
    if (!need || need <= 0 || SERVICE_RESOURCES.has(resId)) continue;
    const local = homeAgg[resId] || 0;
    const over = local - need;
    if (over > MULTI_ISLAND_RATE_EPS) sum += over;
  }
  return sum;
}

function _sortMultiChainEntries(chainBuildings) {
  return Object.values(chainBuildings || {}).sort((a, b) => {
    const ta = _MULTI_TIER_ORDER.indexOf(a.building.tier);
    const tb = _MULTI_TIER_ORDER.indexOf(b.building.tier);
    if (ta !== tb) return (ta < 0 ? 99 : ta) - (tb < 0 ? 99 : tb);
    return String(a.building.name).localeCompare(String(b.building.name));
  });
}

/**
 * HTML: supply vs population demand + remote output vs ship requirements.
 */
function formatMultiIslandSupplyVsDemandHtml(option, demand) {
  const homeAgg = aggregateOutputRatesFromChainBuildings(option.homeChain);
  const demandEntries = Object.entries(demand || {}).filter(
    ([resId, rate]) => rate > 0 && !SERVICE_RESOURCES.has(resId)
  ).sort((a, b) => b[1] - a[1]);

  let homeRows = '';
  for (const [resId, need] of demandEntries) {
    const imported = (option.importRates && option.importRates[resId]) || 0;
    const local = homeAgg[resId] || 0;
    const total = imported + local;
    const ok = total + MULTI_ISLAND_RATE_EPS >= need;
    const name = typeof PP2DATA.getResourceName === 'function' ? PP2DATA.getResourceName(resId) : resId;
    const st = ok ? '<span style="color:#2ecc71">OK</span>' : '<span style="color:#e74c3c">Short</span>';
    homeRows += `<tr>
      <td style="padding:2px 6px 2px 0;">${name}</td>
      <td style="padding:2px 4px;text-align:right;">${need.toFixed(3)}</td>
      <td style="padding:2px 4px;text-align:right;">${imported.toFixed(3)}</td>
      <td style="padding:2px 4px;text-align:right;">${local.toFixed(3)}</td>
      <td style="padding:2px 4px;text-align:right;">${total.toFixed(3)}</td>
      <td style="padding:2px 0 2px 6px;">${st}</td>
    </tr>`;
  }

  let remoteRows = '';
  for (const sIdxStr of Object.keys(option.remoteDemandBySlot || {})) {
    const sIdx = parseInt(sIdxStr, 10);
    const rd = option.remoteDemandBySlot[sIdx];
    const ch = option.remoteChains && option.remoteChains[sIdx];
    const agg = aggregateOutputRatesFromChainBuildings(ch && ch.buildings ? ch.buildings : {});
    const slotNm = slotLabel(sIdx);
    for (const [good, shipRate] of Object.entries(rd || {})) {
      const prod = agg[good] || 0;
      const ok = prod + MULTI_ISLAND_RATE_EPS >= shipRate;
      const gname = typeof PP2DATA.getResourceName === 'function' ? PP2DATA.getResourceName(good) : good;
      const st = ok ? '<span style="color:#2ecc71">OK</span>' : '<span style="color:#e74c3c">Short</span>';
      remoteRows += `<tr>
        <td style="padding:2px 6px 2px 0;">${slotNm} — ${gname}</td>
        <td style="padding:2px 4px;text-align:right;">${shipRate.toFixed(3)}</td>
        <td style="padding:2px 4px;text-align:right;">${prod.toFixed(3)}</td>
        <td style="padding:2px 0 2px 6px;">${st}</td>
      </tr>`;
    }
  }

  let html = '<div style="margin-top:8px;font-size:0.72rem;">';
  html += '<strong style="color:#85c1e9;">Supply vs need (home, goods/min)</strong>';
  html += '<div style="color:#666;font-size:0.65rem;margin:2px 0 4px;">Imported + produced on home should cover population need.</div>';
  if (demandEntries.length === 0) {
    html += '<div style="color:#888;">(no non-service goods demand)</div>';
  } else {
    html += '<table style="width:100%;border-collapse:collapse;"><thead><tr style="color:#888;">'
      + '<th align="left" style="font-weight:600;">Resource</th>'
      + '<th align="right" style="font-weight:600;">Need</th>'
      + '<th align="right" style="font-weight:600;">Import</th>'
      + '<th align="right" style="font-weight:600;">Local</th>'
      + '<th align="right" style="font-weight:600;">Total</th>'
      + '<th align="left" style="font-weight:600;"> </th>'
      + '</tr></thead><tbody>' + homeRows + '</tbody></table>';
  }

  if (remoteRows) {
    html += '<strong style="color:#85c1e9;display:block;margin-top:10px;">Remote production vs ship rate</strong>';
    html += '<div style="color:#666;font-size:0.65rem;margin:2px 0 4px;">Island output should meet each shipped good rate.</div>';
    html += '<table style="width:100%;border-collapse:collapse;"><thead><tr style="color:#888;">'
      + '<th align="left" style="font-weight:600;">Slot / good</th>'
      + '<th align="right" style="font-weight:600;">Ship</th>'
      + '<th align="right" style="font-weight:600;">Remote out</th>'
      + '<th align="left" style="font-weight:600;"> </th>'
      + '</tr></thead><tbody>' + remoteRows + '</tbody></table>';
  }
  html += '</div>';
  return html;
}

/** HTML: building rows with producer switch for multi-island modal. */
function formatMultiIslandChainBuildingsHtml(option) {
  let html = '<div style="margin-top:8px;font-size:0.72rem;">';

  const home = option.homeChain || {};
  if (Object.keys(home).length) {
    html += `<strong style="color:#aaa;">Home — ${option.homeLabel || 'home'}</strong>`;
    let currentTier = '';
    for (const entry of _sortMultiChainEntries(home)) {
      const { building, count, producedResource, alternatives } = entry;
      const rounded = Math.ceil(count);
      const isFractional = count % 1 > 0.01 && count % 1 < 0.99;
      if (building.tier !== currentTier) {
        currentTier = building.tier;
        html += `<div style="color:#3498db;font-size:0.68rem;margin-top:4px;">${currentTier}</div>`;
      }
      const resName = typeof PP2DATA.getResourceName === 'function' ? PP2DATA.getResourceName(producedResource) : producedResource;
      const lockedBadge = state.unlockedBuildings && !state.unlockedBuildings.has(building.id)
        ? ' <span style="color:#f39c12;font-size:0.6rem;font-weight:600;">(locked)</span>'
        : '';
      const altHtml = alternatives
        ? ` <span class="producer-switch multi-producer-switch" title="Change producer (re-analyze)" data-resource="${encodeURIComponent(producedResource)}" data-building="${encodeURIComponent(building.id)}">\u21C5</span>`
        : '';
      html += `<div class="planner-building-row${isFractional ? ' fractional' : ''}" style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <span>${building.name}${lockedBadge}${altHtml} <span style="color:#666;font-size:0.6rem;">(${resName})</span></span>
        <span><span class="count">${rounded}</span>${isFractional ? ` <span style="color:#666;font-size:0.6rem;">(${count.toFixed(2)})</span>` : ''}</span>
      </div>`;
    }
  }

  for (const sIdxStr of Object.keys(option.remoteChains || {}).sort((a, b) => parseInt(a, 10) - parseInt(b, 10))) {
    const sIdx = parseInt(sIdxStr, 10);
    const ch = option.remoteChains[sIdx];
    const bm = ch && ch.buildings ? ch.buildings : {};
    if (!Object.keys(bm).length) continue;
    html += `<strong style="color:#aaa;display:block;margin-top:8px;">${slotLabel(sIdx)} (supply)</strong>`;
    let currentTier = '';
    for (const entry of _sortMultiChainEntries(bm)) {
      const { building, count, producedResource, alternatives } = entry;
      const rounded = Math.ceil(count);
      const isFractional = count % 1 > 0.01 && count % 1 < 0.99;
      if (building.tier !== currentTier) {
        currentTier = building.tier;
        html += `<div style="color:#3498db;font-size:0.68rem;margin-top:4px;">${currentTier}</div>`;
      }
      const resName = typeof PP2DATA.getResourceName === 'function' ? PP2DATA.getResourceName(producedResource) : producedResource;
      const lockedBadge = state.unlockedBuildings && !state.unlockedBuildings.has(building.id)
        ? ' <span style="color:#f39c12;font-size:0.6rem;font-weight:600;">(locked)</span>'
        : '';
      const altHtml = alternatives
        ? ` <span class="producer-switch multi-producer-switch" title="Change producer (re-analyze)" data-resource="${encodeURIComponent(producedResource)}" data-building="${encodeURIComponent(building.id)}">\u21C5</span>`
        : '';
      html += `<div class="planner-building-row${isFractional ? ' fractional' : ''}" style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <span>${building.name}${lockedBadge}${altHtml} <span style="color:#666;font-size:0.6rem;">(${resName})</span></span>
        <span><span class="count">${rounded}</span>${isFractional ? ` <span style="color:#666;font-size:0.6rem;">(${count.toFixed(2)})</span>` : ''}</span>
      </div>`;
    }
  }

  html += '</div>';
  return html;
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
  const visited = new Set();

  function walk(resId, rateNeeded) {
    if (rateNeeded <= 0 || SERVICE_RESOURCES.has(resId)) return;
    if (spatialTileResources.has(resId)) return;
    if (visited.has(resId)) return;
    visited.add(resId);
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

  // Fertility checkboxes update state.activeFertilities; ensure projectSlots[active] matches before we read each slot.
  if (typeof commitActiveFertilitiesToActiveSlot === 'function') commitActiveFertilitiesToActiveSlot();

  const demand = getPopulationDemandFromHouseCounts(houseCountsByPopId);
  const demandKeys = Object.keys(demand).filter(k => (demand[k] || 0) > 0);
  if (demandKeys.length === 0) {
    return { error: 'Enter at least one house count above zero.', options: [] };
  }
  const totalCap = totalFleetThroughputCapacity(sc);

  const options = [];
  const slotIndices = slots.map((_, i) => i);

  // #region agent log
  const _dbgNonService = Object.entries(demand).filter(([k, v]) => v > 0 && !SERVICE_RESOURCES.has(k));
  console.warn('[PP2-MultiDebug] analyzeEntry', {
    demandGoods: _dbgNonService.map(([id, r]) => id),
    slotCount: slots.length,
    activeSlotIdx: state.activeSlotIndex,
    slotFerts: slots.map((s, i) => ({
      i, label: slotLabel(i),
      stored: Array.isArray(s.activeFertilities) ? s.activeFertilities.slice() : null,
      effective: [...effectiveSlotFertilitySet(s)],
    })),
    liveActiveFert: state.activeFertilities ? [...state.activeFertilities] : null,
    fleetCap: +totalCap.toFixed(6),
  });
  // #endregion

  for (const homeIdx of slotIndices) {
    const others = slotIndices.filter(i => i !== homeIdx);

    const crossChains = [];
    let impossible = false;
    let impossibleGood = null;

    // #region agent log
    const _dbgPerGood = [];
    // #endregion

    for (const [resId, rate] of Object.entries(demand)) {
      if (SERVICE_RESOURCES.has(resId)) continue;
      if (rate <= 0) continue;

      const homeCan = canSlotProduceResourceFully(homeIdx, resId, rate);
      // #region agent log
      const othersCan = others.map(o => ({ o, can: canSlotProduceResourceFully(o, resId, rate) }));
      _dbgPerGood.push({ resId, homeCan, othersCan });
      // #endregion

      if (homeCan) continue;

      let sourceIdx = -1;
      for (const o of others) {
        if (canSlotProduceResourceFully(o, resId, rate)) {
          sourceIdx = o;
          break;
        }
      }
      if (sourceIdx < 0) {
        impossible = true;
        impossibleGood = resId;
        break;
      }

      const shipChoices = withProjectSlotContext(sourceIdx, () => traceChainShipCandidates(resId, rate));
      if (shipChoices.length === 0) {
        impossible = true;
        impossibleGood = resId + ':noShipChoices';
        break;
      }
      crossChains.push({
        finalRes: resId,
        rate,
        sourceIdx,
        shipChoices,
      });
    }

    // #region agent log
    console.warn('[PP2-MultiDebug] homeCandidate', {
      homeIdx, homeLabel: slotLabel(homeIdx),
      crossCount: crossChains.length,
      crossGoods: crossChains.map(c => c.finalRes),
      impossible, impossibleGood,
      perGood: _dbgPerGood,
    });
    // #endregion

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

  if (typeof commitActiveFertilitiesToActiveSlot === 'function') commitActiveFertilitiesToActiveSlot();

  const startActive = state.activeSlotIndex;
  if (typeof pushUndo === 'function') pushUndo();

  const prodBackup = { ...state.producerOverrides };
  if (option._execProducerOverrides && typeof option._execProducerOverrides === 'object') {
    state.producerOverrides = { ...option._execProducerOverrides };
  }

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
  } finally {
    state.producerOverrides = prodBackup;
  }
}

function populateMultiPlannerMilitarySelect(overlay) {
  const sel = overlay.querySelector('#multi-planner-mil-sel');
  if (!sel) return;
  const opts = typeof getMilitaryUnitSelectOptions === 'function' ? getMilitaryUnitSelectOptions() : [];
  sel.innerHTML = opts.length === 0
    ? '<option value="">(unlock training buildings)</option>'
    : opts.map(o => `<option value="${o.resId}">${o.label}</option>`).join('');
}

function renderMultiPlannerMilitaryList(overlay) {
  const listEl = overlay.querySelector('#multi-planner-mil-list');
  if (!listEl) return;
  const entries = overlay._multiMilitaryEntries || [];
  if (entries.length === 0) {
    listEl.innerHTML = '<span style="color:#666;font-size:0.65rem;">No military targets — capacity ignores battalion overhead.</span>';
    return;
  }
  listEl.innerHTML = entries.map((e, i) => {
    const label = PP2DATA.getResourceName(e.unitResId) || e.unitResId;
    const rate = Number.isFinite(parseFloat(e.ratePerHour)) ? e.ratePerHour : 0;
    return `<div class="planner-row" style="font-size:0.72rem;margin-top:4px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <span>${label}</span>
      <span style="display:flex;align-items:center;gap:4px;">
        <input type="number" min="0" step="0.1" value="${rate}" data-multi-mil-idx="${i}" style="width:52px;font-size:0.7rem;padding:2px;">
        <span style="color:#666;font-size:0.65rem">/hr</span>
        <button type="button" data-multi-mil-remove="${i}" title="Remove" style="padding:0 6px;cursor:pointer;background:transparent;border:1px solid #888;color:#ccc;border-radius:2px;">×</button>
      </span>
    </div>`;
  }).join('');
}

/** Applies modal producer overrides while computing (same as Analyze). */
function renderMultiCapacityPanel(overlay) {
  const capEl = overlay.querySelector('#multi-planner-capacity');
  if (!capEl || typeof computeIslandCapacityForProjectSlot !== 'function') return;
  const backup = { ...state.producerOverrides };
  const effective = { ...backup, ...(overlay._multiProducerOverrides || {}) };
  state.producerOverrides = effective;
  try {
    let html = '<h3 style="font-size:0.85rem;margin:12px 0 4px;color:#ccc;">Per-island capacity (max houses / tier)</h3>';
    html += '<p style="font-size:0.62rem;color:#888;margin:0 0 8px;line-height:1.35;">Each slot’s <strong>saved</strong> grid + fertilities. One tier at a time (isolation). Military targets above reduce the budget (battalion chain + inferred Pioneer Huts).</p>';
    const entries = overlay._multiMilitaryEntries || [];
    for (let i = 0; i < state.projectSlots.length; i++) {
      const cap = computeIslandCapacityForProjectSlot(i, entries);
      const b = cap.terrainBudget || {};
      html += `<div style="margin-bottom:10px;border:1px solid #0f3460;border-radius:6px;padding:8px;background:#16213e;">`;
      html += `<strong style="color:#e94560;">${slotLabel(i)}</strong>`;
      html += `<div style="font-size:0.6rem;color:#888;margin:2px 0 4px;">Slots: river ${b.straight_river ?? 0} · ocean-adj ${b.ocean_adjacent ?? 0} · river-adj ${b.river_adjacent ?? 0} · water ${b.in_water_coastal ?? 0} · land ${b.land ?? 0}</div>`;
      html += '<table style="width:100%;border-collapse:collapse;font-size:0.68rem;"><thead><tr style="color:#888;">'
        + '<th align="left" style="padding:2px 4px 2px 0;">Tier</th>'
        + '<th align="right" style="padding:2px 4px;">Max</th>'
        + '<th align="left" style="padding:2px 0 2px 6px;">Bottleneck</th></tr></thead><tbody>';
      for (const t of cap.tiers || []) {
        const st = t.unlocked ? '' : 'color:#666;';
        const maxStr = t.unlocked && t.maxHouses != null ? String(t.maxHouses) : '—';
        const bot = (t.bottleneck || '—').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html += `<tr style="${st}"><td style="padding:2px 4px 2px 0;">${t.label}</td>`
          + `<td align="right" style="padding:2px 4px;">${maxStr}</td>`
          + `<td style="padding:2px 0 2px 6px;font-size:0.62rem;color:#aaa;">${bot}</td></tr>`;
      }
      html += '</tbody></table></div>';
    }
    capEl.innerHTML = html;
  } finally {
    state.producerOverrides = backup;
  }
}

function showMultiIslandPlannerModal() {
  if (typeof isMultiIslandProject !== 'function' || !isMultiIslandProject()) return;

  if (typeof commitActiveFertilitiesToActiveSlot === 'function') commitActiveFertilitiesToActiveSlot();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:720px;max-height:90vh;display:flex;flex-direction:column;">
      <h2>Plan across islands</h2>
      <p style="font-size:0.8rem;color:#aaa;margin-bottom:10px;">
        Enter total population to place on <strong>one</strong> home island. Other islands may supply fertility‑gated chains (e.g. wheat vs apples). Production-only slots get no houses.
        Use <strong>⇄</strong> on a building row to cycle producers (same as main planner); analysis refreshes.
      </p>
      <div style="overflow-y:auto;flex:1;min-height:0;padding-right:4px;display:flex;flex-direction:column;">
        <div id="multi-planner-military-wrap" style="margin-bottom:10px;padding:8px;border:1px solid #0f3460;border-radius:6px;background:#16213e;">
          <h3 style="font-size:0.85rem;margin:0 0 6px;color:#ccc;">Military (planning only)</h3>
          <p style="font-size:0.62rem;color:#888;margin:0 0 6px;line-height:1.35;">Adjusts <strong>capacity</strong> below. Does not sync to the main planner. <strong>Analyze</strong> still uses population counts only.</p>
          <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px;">
            <select id="multi-planner-mil-sel" style="flex:1;min-width:140px;font-size:0.75rem;padding:4px;"></select>
            <input type="number" id="multi-planner-mil-rate" min="0" step="0.1" value="1" style="width:52px;font-size:0.72rem;padding:4px;" title="Per hour">
            <span style="font-size:0.65rem;color:#888">/hr</span>
            <button type="button" class="header-btn" id="multi-planner-mil-add" style="font-size:0.72rem;padding:4px 8px;">Add</button>
            <button type="button" class="header-btn" id="multi-planner-mil-clear" style="font-size:0.72rem;padding:4px 8px;">Clear</button>
          </div>
          <div id="multi-planner-mil-list"></div>
        </div>
        <div id="multi-planner-capacity"></div>
        <h4 style="font-size:0.8rem;margin:8px 0 4px;color:#bbb;">Population targets</h4>
        <div id="multi-planner-inputs"></div>
      </div>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="header-btn" id="multi-planner-analyze" style="background:#e94560;border-color:#e94560;">Analyze</button>
        <button type="button" class="header-btn" id="multi-planner-close">Close</button>
      </div>
      <div id="multi-planner-results" style="margin-top:12px;max-height:45vh;overflow-y:auto;font-size:0.78rem;"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay._multiProducerOverrides = { ...state.producerOverrides };
  overlay._multiMilitaryEntries = (state.militaryEntries || []).map(e => ({
    unitResId: e.unitResId,
    ratePerHour: parseFloat(e.ratePerHour) || 0,
  }));
  window.__pp2MultiPlannerOverlayRef = overlay;

  populateMultiPlannerMilitarySelect(overlay);
  renderMultiPlannerMilitaryList(overlay);
  renderMultiCapacityPanel(overlay);

  overlay.addEventListener('click', e => {
    if (e.target.id === 'multi-planner-mil-add') {
      const sel = overlay.querySelector('#multi-planner-mil-sel');
      const rateInp = overlay.querySelector('#multi-planner-mil-rate');
      const unitResId = sel && sel.value;
      const rate = Math.max(0, parseFloat(rateInp && rateInp.value) || 0);
      if (!unitResId || rate <= 0) return;
      if (!overlay._multiMilitaryEntries) overlay._multiMilitaryEntries = [];
      overlay._multiMilitaryEntries.push({ unitResId, ratePerHour: rate });
      renderMultiPlannerMilitaryList(overlay);
      renderMultiCapacityPanel(overlay);
    }
    if (e.target.id === 'multi-planner-mil-clear') {
      overlay._multiMilitaryEntries = [];
      renderMultiPlannerMilitaryList(overlay);
      renderMultiCapacityPanel(overlay);
    }
    const rm = e.target.closest('[data-multi-mil-remove]');
    if (rm && overlay.contains(rm)) {
      const i = parseInt(rm.getAttribute('data-multi-mil-remove'), 10);
      if (!Number.isNaN(i) && overlay._multiMilitaryEntries && overlay._multiMilitaryEntries[i]) {
        overlay._multiMilitaryEntries.splice(i, 1);
        renderMultiPlannerMilitaryList(overlay);
        renderMultiCapacityPanel(overlay);
      }
    }
  });
  overlay.addEventListener('change', e => {
    const inp = e.target.closest && e.target.closest('[data-multi-mil-idx]');
    if (!inp || !overlay.contains(inp)) return;
    const i = parseInt(inp.getAttribute('data-multi-mil-idx'), 10);
    if (Number.isNaN(i) || !overlay._multiMilitaryEntries || !overlay._multiMilitaryEntries[i]) return;
    const v = Math.max(0, parseFloat(inp.value) || 0);
    overlay._multiMilitaryEntries[i].ratePerHour = v;
    inp.value = v;
    renderMultiCapacityPanel(overlay);
  });

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

  const close = () => {
    if (window.__pp2MultiPlannerOverlayRef === overlay) window.__pp2MultiPlannerOverlayRef = null;
    overlay.remove();
  };
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

  function renderMultiResults(counts, analyzeResult) {
    const options = analyzeResult.options;
    const error = analyzeResult.error;
    const totalFleetCapacity = analyzeResult.totalFleetCapacity;
    const demand = getPopulationDemandFromHouseCounts(counts);

    if (error) {
      resultsEl.innerHTML = `<p style="color:#e74c3c;">${error}</p>`;
      overlay._multiOptions = null;
      return;
    }
    if (!options || options.length === 0) {
      resultsEl.innerHTML = '<p style="color:#f39c12;">No valid options (check fertilities and demand).</p>';
      overlay._multiOptions = null;
      return;
    }

    let html = `<p style="color:#888;">Fleet capacity (sum of slot throughputs): <strong>${(totalFleetCapacity != null ? totalFleetCapacity : 0).toFixed(3)}</strong> goods/min</p>`;
    html += `<p style="color:#666;font-size:0.72rem;line-height:1.35;margin:6px 0 8px;">Plans are sorted by fleet feasibility, then spare fleet capacity, then slightly lower total footprint. <strong style="color:#aaa;">Badges</strong> mark the lowest total footprint and the highest home local surplus (sum of local output above need, imports ignored) among <em>fleet-feasible</em> plans; if none are feasible, badges use all plans.</p>`;

    const feasiblePool = options.filter(o => o.fleetFeasible);
    const badgePool = feasiblePool.length > 0 ? feasiblePool : options;
    const minTotalFp = Math.min(...badgePool.map(o => o.totalFootprintTiles));
    const surpluses = badgePool.map(o => computeHomeLocalSurplus(o, demand));
    const maxSurplus = surpluses.length ? Math.max(...surpluses) : 0;

    html += '<div style="display:flex;flex-direction:column;gap:10px;">';

    options.slice(0, 12).forEach((opt, i) => {
      const routeStr = opt.routes.map(r =>
        `${r.label}: ${r.ratePerMin.toFixed(3)}/min → slot ${r.to + 1} (${slotLabel(r.from)} → home)`
      ).join('<br>');

      const fpStr = `Home ~${opt.homeFootprintTiles.toFixed(0)} tiles` +
        Object.entries(opt.remoteFootprintTiles || {}).map(([si, v]) =>
          ` · ${slotLabel(parseInt(si, 10))} ~${v.toFixed(0)}`
        ).join('');

      const supplyHtml = formatMultiIslandSupplyVsDemandHtml(opt, demand);
      const chainHtml = formatMultiIslandChainBuildingsHtml(opt);

      const inBadgePool = feasiblePool.length > 0 ? opt.fleetFeasible : true;
      const optSurplus = computeHomeLocalSurplus(opt, demand);
      const badgeFootprint =
        inBadgePool && Math.abs(opt.totalFootprintTiles - minTotalFp) < 1e-3;
      const badgeSurplus =
        inBadgePool && Math.abs(optSurplus - maxSurplus) < 1e-4;
      const badgeStyle =
        'display:inline-block;margin-left:6px;padding:2px 6px;border-radius:4px;font-size:0.65rem;font-weight:600;vertical-align:middle;';
      const badgesHtml = [
        badgeFootprint
          ? `<span style="${badgeStyle}background:#1e3a2f;color:#2ecc71;" title="~${opt.totalFootprintTiles.toFixed(0)} total tiles (home + supply islands)">Lowest footprint</span>`
          : '',
        badgeSurplus
          ? `<span style="${badgeStyle}background:#3a2a1e;color:#f4d03f;" title="+${optSurplus.toFixed(3)} goods/min home local surplus vs need">Most local surplus</span>`
          : '',
      ].join('');

      html += `
        <div style="border:1px solid #0f3460;border-radius:6px;padding:10px;background:#16213e;">
          <strong style="color:#e94560;">#${i + 1} Home: ${opt.homeLabel}</strong>${badgesHtml}
          <span style="color:${opt.fleetFeasible ? '#2ecc71' : '#e74c3c'};float:right;">
            Ship total ${opt.shipRateSum.toFixed(3)}/min ${opt.fleetFeasible ? '≤ fleet' : 'EXCEEDS fleet'}
          </span>
          <div style="margin-top:6px;color:#ccc;">${routeStr || 'No cross-island goods'}</div>
          <div style="margin-top:4px;color:#888;">${fpStr}</div>
          ${supplyHtml}
          ${chainHtml}
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
  }

  overlay._runMultiAnalyze = function runMultiAnalyze() {
    const counts = readHouseCounts();
    const shipCounts = state.projectShipCounts || {};
    const backup = { ...state.producerOverrides };
    const effective = { ...backup, ...overlay._multiProducerOverrides };
    state.producerOverrides = effective;
    let analyzeResult;
    try {
      analyzeResult = analyzeMultiIslandPlan(counts, shipCounts);
    } finally {
      state.producerOverrides = backup;
    }
    if (analyzeResult.options && analyzeResult.options.length) {
      analyzeResult.options.forEach(o => {
        o._execProducerOverrides = { ...effective };
      });
    }
    renderMultiResults(counts, analyzeResult);
  };

  resultsEl.addEventListener('click', e => {
    const sw = e.target.closest('.multi-producer-switch');
    if (!sw || !resultsEl.contains(sw)) return;
    e.preventDefault();
    const resourceId = decodeURIComponent(sw.getAttribute('data-resource') || '');
    const buildingId = decodeURIComponent(sw.getAttribute('data-building') || '');
    cycleProducerMulti(resourceId, buildingId);
  });

  overlay.querySelector('#multi-planner-analyze').addEventListener('click', () => overlay._runMultiAnalyze());
}

/**
 * Cycle producer for multi-island modal (updates modal override map and re-runs Analyze).
 * Also available as window.cycleProducerMulti for parity with cycleProducer.
 */
function cycleProducerMulti(resourceId, currentBuildingId) {
  const overlay = window.__pp2MultiPlannerOverlayRef;
  if (!overlay || typeof overlay._runMultiAnalyze !== 'function') return;
  const producers = (PP2DATA.getProducersOf(resourceId) || []).filter(p => PP2DATA.getBuilding(p.id));
  if (producers.length <= 1) return;
  const idx = producers.findIndex(p => p.id === currentBuildingId);
  if (idx < 0) return;
  const next = producers[(idx + 1) % producers.length];
  if (!overlay._multiProducerOverrides) overlay._multiProducerOverrides = {};
  overlay._multiProducerOverrides[resourceId] = next.id;
  overlay._runMultiAnalyze();
  renderMultiCapacityPanel(overlay);
}
window.cycleProducerMulti = cycleProducerMulti;

(function initMultiIslandPlannerButton() {
  const btn = document.getElementById('btn-multi-island-plan');
  if (!btn || btn.dataset.wired === '1') return;
  btn.dataset.wired = '1';
  btn.addEventListener('click', () => showMultiIslandPlannerModal());
})();
