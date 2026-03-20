// ===== ISLAND STATS =====
function updateStats() {
  const el = document.getElementById('stats-content');
  if (!state.island) {
    if (el) el.innerHTML = '<span style="color:#888">No island grid — pick a slot and use <strong>New Island</strong> if needed.</span>';
    return;
  }
  const { width, height, cells, buildings } = state.island;

  // Count terrain types
  const terrainCounts = {};
  const depositCounts = {};
  let buildingCount = buildings.length;
  let totalCells = 0;
  let landCells = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      totalCells++;
      const cell = cells[y][x];
      terrainCounts[cell.terrain] = (terrainCounts[cell.terrain] || 0) + 1;
      if (cell.terrain !== 'water') landCells++;
      if (cell.deposit) depositCounts[cell.deposit] = (depositCounts[cell.deposit] || 0) + 1;
    }
  }

  let html = `<div class="info-row"><span class="info-label">Size:</span><span class="info-value">${width}×${height}</span></div>`;
  html += `<div class="info-row"><span class="info-label">Land:</span><span class="info-value">${landCells}/${totalCells}</span></div>`;
  html += `<div class="info-row"><span class="info-label">Buildings:</span><span class="info-value">${buildingCount}</span></div>`;
  html += `<div class="info-row"><span class="info-label">Free land:</span><span class="info-value">${landCells - buildingCount}</span></div>`;
  html += '<h4 style="margin-top:6px">Terrain</h4>';
  for (const [t, c] of Object.entries(terrainCounts)) {
    html += `<div class="info-row"><span class="info-label">${t}:</span><span class="info-value">${c}</span></div>`;
  }
  if (Object.keys(depositCounts).length > 0) {
    html += '<h4 style="margin-top:6px">Deposits</h4>';
    for (const [d, c] of Object.entries(depositCounts)) {
      const dep = typeof getDepositPaintStyle === 'function' ? getDepositPaintStyle(d) : null;
      const label = dep ? dep.name : d;
      html += `<div class="info-row"><span class="info-label">${label}:</span><span class="info-value">${c}</span></div>`;
    }
  }

  // Population supply vs nameplate production (placed houses / buildings only)
  if (typeof countPlacedPopulationHousesByType === 'function' &&
      typeof getPopulationDemandFromPlacedHouses === 'function' &&
      typeof getPopulationChainGoodDemandFromPlacedHouses === 'function' &&
      typeof aggregatePlacedProducerOutputRates === 'function') {
    const popCounts = countPlacedPopulationHousesByType();
    const placedPopN = Object.values(popCounts).reduce((a, n) => a + n, 0);
    if (placedPopN === 0) {
      html += '<h4 style="margin-top:8px;font-size:0.85rem">Population supply</h4>';
      html += '<p style="color:#888;font-size:0.72rem;margin:4px 0 0;line-height:1.35;">Place population houses to see goods demand vs production.</p>';
    } else {
      const chainNeed = getPopulationChainGoodDemandFromPlacedHouses();
      const produced = aggregatePlacedProducerOutputRates();
      const resIds = new Set([...Object.keys(chainNeed), ...Object.keys(produced)]);
      const rows = [...resIds].map(resId => ({
        resId,
        need: chainNeed[resId] || 0,
        prod: produced[resId] || 0,
      }));
      rows.sort((a, b) => {
        if (b.need !== a.need) return b.need - a.need;
        const na = typeof PP2DATA.getResourceName === 'function' ? PP2DATA.getResourceName(a.resId) : a.resId;
        const nb = typeof PP2DATA.getResourceName === 'function' ? PP2DATA.getResourceName(b.resId) : b.resId;
        return String(na).localeCompare(String(nb));
      });
      const eps = typeof ISLAND_STATS_RATE_EPS === 'number' ? ISLAND_STATS_RATE_EPS : 1e-5;
      html += '<h4 style="margin-top:8px;font-size:0.85rem">Population supply (goods/min)</h4>';
      html += '<p style="color:#666;font-size:0.65rem;margin:2px 0 6px;line-height:1.35;"><strong>Need</strong> = direct goods from <strong>placed</strong> houses + upstream inputs from the same chain solver as the Production Planner (tiers, fertilities, producer picks). <strong>Produced</strong> = nameplate rates from placed buildings only; regen map tiles not counted—tile-only goods (e.g. apple trees) may show Short.</p>';
      html += '<table style="width:100%;border-collapse:collapse;font-size:0.72rem;"><thead><tr style="color:#888;">'
        + '<th align="left" style="font-weight:600;padding:2px 4px 2px 0;">Resource</th>'
        + '<th align="right" style="font-weight:600;padding:2px 4px;">Need</th>'
        + '<th align="right" style="font-weight:600;padding:2px 4px;">Produced</th>'
        + '<th align="left" style="font-weight:600;padding:2px 0 2px 6px;">Status</th>'
        + '</tr></thead><tbody>';
      for (const { resId, need, prod } of rows) {
        const ok = prod + eps >= need;
        const st = ok ? '<span style="color:#2ecc71">OK</span>' : '<span style="color:#e74c3c">Short</span>';
        const name = typeof PP2DATA.getResourceName === 'function' ? PP2DATA.getResourceName(resId) : resId;
        html += `<tr>
          <td style="padding:2px 6px 2px 0;">${name}</td>
          <td style="padding:2px 4px;text-align:right;">${need.toFixed(3)}</td>
          <td style="padding:2px 4px;text-align:right;">${prod.toFixed(3)}</td>
          <td style="padding:2px 0 2px 6px;">${st}</td>
        </tr>`;
      }
      html += '</tbody></table>';
    }
  }

  // Building summary
  if (buildings.length > 0) {
    html += '<h4 style="margin-top:6px">Buildings</h4>';
    const bCounts = {};
    buildings.forEach(b => { bCounts[b.id] = (bCounts[b.id] || 0) + 1; });
    for (const [id, count] of Object.entries(bCounts)) {
      const b = getBuildingData(id);
      html += `<div class="info-row"><span class="info-label">${b ? b.name : id}:</span><span class="info-value">${count}</span></div>`;
    }
  }

  if (el) el.innerHTML = html;

  // Auto-refresh planner if it has results
  if (state.plannerActive) calculateProduction();
}

// ===== VALIDATION =====
// Service resource IDs — used for validation (coverage-based, not production-based)
const SERVICE_RESOURCES = new Set([
  'water', 'community', 'education', 'medical_care', 'sports',
  'administration', 'hygiene', 'trading', 'cemetery', 'entertainment',
  'coiffeur', 'higher_education', 'gambling', 'heat',
]);

function validateIsland() {
  if (!state.island) {
    const vel = document.getElementById('validation-content');
    if (vel) vel.innerHTML = '<span style="color:#888;font-size:0.75rem">No grid for this slot.</span>';
    return;
  }
  const issues = [];
  const { width, height, cells, buildings } = state.island;

  const warehouseIds = ['Warehouse1', 'Warehouse2', 'Warehouse3'];
  const warehouses = buildings.filter(w => warehouseIds.includes(w.id));

  // Collect placed pop houses and service buildings
  const popHouses = [];
  const serviceProviders = [];

  buildings.forEach(b => {
    const building = getBuildingData(b.id);
    if (!building) return;
    if (building.isPopulation) {
      popHouses.push({ x: b.x, y: b.y, building });
    }
    // Only classify as a spatial service provider if it is explicitly a service building.
    // Population buildings (PioneersHut, FarmersShack, etc.) produce service resource IDs
    // in the raw data but are NOT coverage providers — they only serve themselves.
    if (!building.isPopulation && (building.isService || (building.produces && SERVICE_RESOURCES.has(building.produces)))) {
      const fp = FOOTPRINTS[b.id];
      if (fp) serviceProviders.push({ x: b.x, y: b.y, building, serviceResource: building.produces, fp });
    }
  });

  // Check each building
  buildings.forEach(b => {
    const building = getBuildingData(b.id);
    if (!building) return;

    const isWarehouse = warehouseIds.includes(b.id);
    const isService = building.isService || (building.produces && SERVICE_RESOURCES.has(building.produces));
    const isInfra = building.isInfrastructure;
    const isPop = building.isPopulation;

    // --- Warehouse coverage (production buildings only) ---
    if (!isWarehouse && !isService && !isInfra && !isPop) {
      let inWarehouseRange = false;
      warehouses.forEach(wh => {
        const fp = FOOTPRINTS[wh.id];
        if (fp) {
          fp.forEach(([dx, dy]) => {
            if (wh.x + dx === b.x && wh.y + dy === b.y) inWarehouseRange = true;
          });
        }
      });
      if (!inWarehouseRange) {
        if (warehouses.length === 0) {
          issues.push({ type: 'warning', msg: `${building.name} at (${b.x},${b.y}): no warehouses on island` });
        } else {
          issues.push({ type: 'error', msg: `${building.name} at (${b.x},${b.y}) outside warehouse range` });
        }
      }
    }

    // --- Service building: check it covers at least one pop house ---
    if (isService && !isPop) {
      const fp = FOOTPRINTS[b.id];
      if (fp) {
        const coversAnyHouse = popHouses.some(h =>
          fp.some(([dx, dy]) => b.x + dx === h.x && b.y + dy === h.y)
        );
        if (!coversAnyHouse && popHouses.length > 0) {
          issues.push({ type: 'warning', msg: `${building.name} at (${b.x},${b.y}) not covering any houses` });
        }
      }
    }

    // --- Population house: check needed services cover it ---
    if (isPop && building.consumePerMinute) {
      for (const [resId, rate] of Object.entries(building.consumePerMinute)) {
        if (!SERVICE_RESOURCES.has(resId)) continue;
        // Check if any placed provider of this service covers this house
        const covered = serviceProviders.some(sp =>
          sp.serviceResource === resId &&
          sp.fp.some(([dx, dy]) => sp.x + dx === b.x && sp.y + dy === b.y)
        );
        if (!covered) {
          const resName = PP2DATA.getResourceName(resId);
          issues.push({ type: 'warning', msg: `${building.name} at (${b.x},${b.y}) not covered by ${resName} service` });
        }
      }
    }

    // Check location requirements
    const locReq = LOCATION_REQUIREMENTS[b.id];
    if (locReq) {
      const locCheck = checkLocationRequirement(b.id, b.x, b.y);
      if (!locCheck.ok) {
        issues.push({ type: 'error', msg: `${building.name} at (${b.x},${b.y}): ${locCheck.reason}` });
      }
    }

    // Check tile resource requirements within footprint
    if (building.inputs) {
      const fp = FOOTPRINTS[b.id] || [[0,0]];
      for (const [resId, amount] of Object.entries(building.inputs)) {
        if (!TILE_RESOURCE_IDS.has(resId)) continue;
        // Skip river check for water-wheel buildings (handled by location requirement)
        if (resId === 'river' && LOCATION_REQUIREMENTS[b.id] && 
            (LOCATION_REQUIREMENTS[b.id].type === 'straight_river' || LOCATION_REQUIREMENTS[b.id].type === 'river_adjacent')) continue;
        // Count matching tiles in footprint
        let tileCount = 0;
        fp.forEach(([dx, dy]) => {
          const fx = b.x + dx, fy = b.y + dy;
          if (fx >= 0 && fx < width && fy >= 0 && fy < height) {
            const fc = cells[fy][fx];
            if (footprintCellCountsForGathering(fc, fx, fy, resId, b.x, b.y, width, height)) tileCount++;
          } else {
            if (resId === 'water_tile') tileCount++;
          }
        });
        if (tileCount === 0) {
          issues.push({ type: 'error', msg: `${building.name} at (${b.x},${b.y}) needs ${PP2DATA.getResourceName(resId)} tiles in footprint` });
        } else if (tileCount < amount) {
          issues.push({ type: 'warning', msg: `${building.name} at (${b.x},${b.y}) has ${tileCount}/${amount} ${PP2DATA.getResourceName(resId)} tiles (needs ${amount})` });
        }
      }
    }
  });

  // --- Detect overlapping spatial tile claims between buildings ---
  // tileClaims: "x,y,resId" -> [{ building, bx, by, needed }]
  const tileClaims = {};
  buildings.forEach(b => {
    const building = getBuildingData(b.id);
    if (!building || !building.inputs) return;
    const fp = FOOTPRINTS[b.id] || [[0,0]];
    for (const [resId, amount] of Object.entries(building.inputs)) {
      if (!TILE_RESOURCE_IDS.has(resId)) continue;
      // Skip river (handled by location requirements)
      if (resId === 'river' && LOCATION_REQUIREMENTS[b.id]) continue;
      // Collect matching tiles in this building's footprint
      const matching = [];
      fp.forEach(([dx, dy]) => {
        const fx = b.x + dx, fy = b.y + dy;
        if (fx >= 0 && fx < width && fy >= 0 && fy < height) {
          const c = cells[fy][fx];
          if (footprintCellCountsForGathering(c, fx, fy, resId, b.x, b.y, width, height)) matching.push(`${fx},${fy}`);
        }
      });
      matching.forEach(key => {
        const ck = key + ',' + resId;
        if (!tileClaims[ck]) tileClaims[ck] = [];
        tileClaims[ck].push({ name: building.name, x: b.x, y: b.y });
      });
    }
  });

  // Find buildings that share tiles and might be short
  // Group overlaps by pairs of buildings
  const overlapPairs = {};
  for (const [ck, claimants] of Object.entries(tileClaims)) {
    if (claimants.length < 2) continue;
    const resId = ck.split(',')[2];
    for (let i = 0; i < claimants.length; i++) {
      for (let j = i + 1; j < claimants.length; j++) {
        const a = claimants[i], b = claimants[j];
        const pairKey = `${a.name}@${a.x},${a.y}|${b.name}@${b.x},${b.y}|${resId}`;
        overlapPairs[pairKey] = (overlapPairs[pairKey] || 0) + 1;
      }
    }
  }
  for (const [pairKey, sharedCount] of Object.entries(overlapPairs)) {
    const [aStr, bStr, resId] = pairKey.split('|');
    const [aName, aCoord] = aStr.split('@');
    const [bName, bCoord] = bStr.split('@');
    const resName = PP2DATA.getResourceName(resId);
    issues.push({ type: 'warning', msg: `${aName} at (${aCoord}) and ${bName} at (${bCoord}) share ${sharedCount} ${resName} tile${sharedCount > 1 ? 's' : ''}` });
  }

  // Display
  const el = document.getElementById('validation-content');
  if (issues.length === 0) {
    el.innerHTML = '<span class="ok-text">No issues found</span>';
  } else {
    el.innerHTML = issues.map(i =>
      `<div class="${i.type === 'error' ? 'error-text' : 'warning-text'}" style="margin-bottom:4px;font-size:0.75rem">${i.msg}</div>`
    ).join('');
  }
}

/** Copper vein tiles — any member counts as satisfying spatial inputs of any other member (mine chain). */
const COPPER_MINE_DEPOSIT_IDS = new Set([
  'copper_deposit', 'copper_deposit_tropical', 'copper_pyrite_deposit',
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
  // Map resource IDs to terrain/deposit types
  // Some resource IDs can match multiple terrain types
  const terrainMultiMap = {
    'water_tile': ['water', 'coastal'],
  };
  const terrainMap = {
    'grass': 'grass',
    'grass_north': 'grass',
    'forest': 'forest',
    'conifer_forest': 'forest',
    'river': 'river',
    'river_north': 'river',
    'river_tropical': 'river',
    'coastal': 'coastal',
    'coastal_north': 'coastal',
    'coastal_tropical': 'coastal',
  };
  if (terrainMultiMap[resId] && terrainMultiMap[resId].includes(cell.terrain)) return true;
  if (terrainMap[resId] && cell.terrain === terrainMap[resId]) return true;
  if (cell.deposit === resId) return true;
  if (cell.deposit && COPPER_MINE_DEPOSIT_IDS.has(resId) && COPPER_MINE_DEPOSIT_IDS.has(cell.deposit)) return true;
  return false;
}

/** Open water / coastal terrain, or shoreline grass|forest (map edge = ocean) — fishable for water_tile counts. */
function cellProvidesWaterTile(cell, cx, cy, width, height) {
  if (!cell) return false;
  if (matchesTileResource(cell, 'water_tile')) return true;
  const onBorder = cx === 0 || cy === 0 || cx === width - 1 || cy === height - 1;
  if (onBorder && typeof PLACEABLE_TERRAIN !== 'undefined' && PLACEABLE_TERRAIN.has(cell.terrain)) return true;
  return false;
}

/**
 * Whether (cx,cy) counts toward spatial resource resId for a building anchored at (ax,ay).
 * Cells occupied by another building's anchor are excluded from gathering.
 */
function footprintCellCountsForGathering(cell, cx, cy, resId, ax, ay, width, height) {
  if (!cell) return false;
  if (cell.building && (cx !== ax || cy !== ay)) return false;
  if (resId === 'water_tile') return cellProvidesWaterTile(cell, cx, cy, width, height);
  return matchesTileResource(cell, resId);
}
