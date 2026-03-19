// ===== ISLAND STATS =====
function updateStats() {
  if (!state.island) return;
  const el = document.getElementById('stats-content');
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
      const dep = DEPOSIT_TYPES.find(dt => dt.id === d);
      html += `<div class="info-row"><span class="info-label">${dep ? dep.name : d}:</span><span class="info-value">${c}</span></div>`;
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

  el.innerHTML = html;

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
  if (!state.island) return;
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
    if (building.isService || (building.produces && SERVICE_RESOURCES.has(building.produces))) {
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
            // Match terrain or deposit to resource
            if (matchesTileResource(fc, resId)) tileCount++;
          } else {
            // Out-of-bounds counts as water
            if (resId === 'water_tile') tileCount++;
          }
        });
        if (tileCount === 0) {
          issues.push({ type: 'warning', msg: `${building.name} at (${b.x},${b.y}) needs ${PP2DATA.getResourceName(resId)} tiles in footprint` });
        }
      }
    }
  });

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
  return false;
}
