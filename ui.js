// ===== CELL ACTIONS =====
function handleCellAction(x, y, e) {
  if (!state.island) return;
  const { width, height, cells } = state.island;
  if (x < 0 || x >= width || y < 0 || y >= height) return;

  const cell = cells[y][x];

  if (state.tool === 'terrain' && state.terrainType) {
    pushUndo();
    // Remove any building whose footprint covers this cell before changing terrain
    const bFoundTerrain = findBuildingAtCell(x, y);
    if (bFoundTerrain) removeBuildingAt(bFoundTerrain.x, bFoundTerrain.y);
    cell.terrain = state.terrainType;
    cell.deposit = null;
    updateStats();
    render();
  } else if (state.tool === 'deposit' && state.depositType) {
    if (TILE_RESOURCE_IDS.has(state.depositType) &&
        typeof isTileResourceFertilityBlocked === 'function' &&
        isTileResourceFertilityBlocked(state.depositType)) {
      showTooltipMessage(x, y, 'Fertility off for this resource — enable it under Island Type or plan for imports.');
      return;
    }
    pushUndo();
    cell.deposit = state.depositType;
    updateStats();
    render();
  } else if (state.tool === 'eraser') {
    pushUndo();
    const bFoundEraser = findBuildingAtCell(x, y);
    if (bFoundEraser) removeBuildingAt(bFoundEraser.x, bFoundEraser.y);
    cell.deposit = null;
    cell.terrain = 'grass';
    updateStats();
    render();
  } else if (state.tool === 'building' && state.buildingId) {
    if (cell.building) return; // already occupied
    // Check terrain validity
    if (!canPlaceOnTerrain(state.buildingId, cell.terrain)) {
      showTooltipMessage(x, y, `Cannot place on ${cell.terrain}`);
      return;
    }
    // Check location requirements before placing
    const locCheck = checkLocationRequirement(state.buildingId, x, y);
    if (!locCheck.ok) {
      showTooltipMessage(x, y, locCheck.reason);
      return;
    }
    pushUndo();
    placeBuilding(state.buildingId, x, y);
    updateStats();
    validateIsland();
    render();
  } else if (state.tool === 'select') {
    // Select a building if there is one — check by footprint, not just anchor
    const b = findBuildingAtCell(x, y);
    state.selectedBuilding = b || null;
    updateBuildingInfo();
    render();
  }
}

/** @returns {{ anchor: object|null, coverage: object[] }} */
function getCellBuildingLayers(x, y) {
  if (!state.island) return { anchor: null, coverage: [] };
  const { width, height } = state.island;
  if (x < 0 || x >= width || y < 0 || y >= height) return { anchor: null, coverage: [] };
  const anchor = state.island.buildings.find(b => b.x === x && b.y === y) || null;
  const coverage = [];
  for (const b of state.island.buildings) {
    if (anchor && b.x === anchor.x && b.y === anchor.y) continue;
    const fp = FOOTPRINTS[b.id] || [[0, 0]];
    for (const [dx, dy] of fp) {
      if (b.x + dx === x && b.y + dy === y) {
        coverage.push(b);
        break;
      }
    }
  }
  return { anchor, coverage };
}

function buildingEntryLabel(b) {
  const d = getBuildingData(b.id);
  return d ? d.name : b.id;
}

// Prefer anchor on this cell so e.g. a house under a warehouse footprint resolves correctly.
function findBuildingAtCell(x, y) {
  if (!state.island) return null;
  const { width, height } = state.island;
  if (x < 0 || x >= width || y < 0 || y >= height) return null;
  const byAnchor = state.island.buildings.find(b => b.x === x && b.y === y);
  if (byAnchor) return byAnchor;
  for (const b of state.island.buildings) {
    const fp = FOOTPRINTS[b.id] || [[0, 0]];
    for (const [dx, dy] of fp) {
      if (b.x + dx === x && b.y + dy === y) return b;
    }
  }
  return null;
}

function hideBuildingHoverTooltip() {
  const tip = document.getElementById('building-hover-tip');
  if (tip) tip.style.display = 'none';
}

/** Follow-cursor tooltip listing anchor vs footprint coverage (mouse only). */
function updateBuildingHoverTooltip(clientX, clientY, cellX, cellY) {
  const tip = document.getElementById('building-hover-tip');
  if (!tip || !state.island) return;
  const { width, height } = state.island;
  if (cellX < 0 || cellX >= width || cellY < 0 || cellY >= height) {
    tip.style.display = 'none';
    return;
  }
  const { anchor, coverage } = getCellBuildingLayers(cellX, cellY);
  if (!anchor && coverage.length === 0) {
    tip.style.display = 'none';
    return;
  }
  const lines = [];
  if (anchor) lines.push(`${buildingEntryLabel(anchor)} · anchor`);
  for (const b of coverage) lines.push(`${buildingEntryLabel(b)} · footprint`);
  tip.textContent = lines.join('\n');
  tip.style.whiteSpace = 'pre-line';
  tip.style.left = (clientX + 14) + 'px';
  tip.style.top = (clientY + 14) + 'px';
  tip.style.display = 'block';
}

function placeBuilding(buildingId, x, y) {
  // Only the anchor cell is occupied; footprint is coverage / gathering only.
  state.island.cells[y][x].building = buildingId;
  state.island.buildings.push({ id: buildingId, x, y, uid: nextBuildingUid++ });
}

// Clears the anchor cell and removes the building from the buildings list.
function removeBuildingAt(ax, ay) {
  if (!state.island) return;
  if (ay >= 0 && ay < state.island.height && ax >= 0 && ax < state.island.width) {
    state.island.cells[ay][ax].building = null;
  }
  state.island.buildings = state.island.buildings.filter(b => !(b.x === ax && b.y === ay));
}

// ===== CONTEXT MENU =====
function showContextMenu(px, py, cellX, cellY) {
  const menu = document.getElementById('context-menu');
  menu.innerHTML = '';
  if (!state.island) return;
  const { width, height, cells } = state.island;
  if (cellX < 0 || cellX >= width || cellY < 0 || cellY >= height) return;
  const cell = cells[cellY][cellX];

  const ctxBuilding = findBuildingAtCell(cellX, cellY);
  if (ctxBuilding) {
    addMenuItem(menu, 'Remove Building', () => {
      pushUndo();
      removeBuildingAt(ctxBuilding.x, ctxBuilding.y);
      updateStats();
      validateIsland();
      render();
    });
    addMenuItem(menu, 'Show Footprint', () => {
      state.selectedBuilding = ctxBuilding;
      updateBuildingInfo();
      render();
    });
  }
  if (cell.deposit) {
    addMenuItem(menu, 'Remove Deposit', () => {
      pushUndo();
      cell.deposit = null;
      updateStats();
      render();
    });
  }
  addMenuItem(menu, 'Set to Water', () => {
    pushUndo();
    const bWater = findBuildingAtCell(cellX, cellY);
    if (bWater) removeBuildingAt(bWater.x, bWater.y);
    cell.terrain = 'water';
    cell.deposit = null;
    updateStats();
    render();
  });

  menu.style.left = px + 'px';
  menu.style.top = py + 'px';
  menu.style.display = 'block';
}

function addMenuItem(menu, text, callback) {
  const item = document.createElement('div');
  item.className = 'context-menu-item';
  item.textContent = text;
  item.addEventListener('click', () => {
    menu.style.display = 'none';
    callback();
  });
  menu.appendChild(item);
}

document.addEventListener('click', () => {
  document.getElementById('context-menu').style.display = 'none';
});

// ===== TOOLTIPS FOR PLACEMENT ERRORS =====
function showTooltipMessage(cellX, cellY, message) {
  const z = state.zoom;
  const px = state.panX + cellX * z;
  const py = state.panY + cellY * z;
  const area = document.getElementById('canvas-area');
  const rect = area.getBoundingClientRect();

  const tip = document.getElementById('tooltip');
  tip.textContent = '\u26A0 ' + message;
  tip.style.left = (rect.left + px + z) + 'px';
  tip.style.top = (rect.top + py) + 'px';
  tip.style.display = 'block';
  tip.style.color = '#e74c3c';
  tip.style.borderColor = '#e74c3c';
  clearTimeout(tip._hideTimer);
  tip._hideTimer = setTimeout(() => {
    tip.style.display = 'none';
    tip.style.color = '';
    tip.style.borderColor = '';
  }, 2500);
}

// ===== UNDO/REDO =====
function pushUndo() {
  if (!state.island) return;
  state.undoStack.push(JSON.stringify(state.island));
  state.redoStack = [];
  if (state.undoStack.length > 100) state.undoStack.shift();
}

document.getElementById('btn-undo').addEventListener('click', () => {
  if (state.undoStack.length === 0) return;
  state.redoStack.push(JSON.stringify(state.island));
  state.island = JSON.parse(state.undoStack.pop());
  updateStats();
  validateIsland();
  render();
});

document.getElementById('btn-redo').addEventListener('click', () => {
  if (state.redoStack.length === 0) return;
  state.undoStack.push(JSON.stringify(state.island));
  state.island = JSON.parse(state.redoStack.pop());
  updateStats();
  validateIsland();
  render();
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'z') { document.getElementById('btn-undo').click(); e.preventDefault(); }
  if (e.ctrlKey && e.key === 'y') { document.getElementById('btn-redo').click(); e.preventDefault(); }
  if (e.key === 'Escape') {
    state.tool = 'select';
    state.buildingId = null;
    clearToolSelection();
    render();
  }
  if (e.key === 'Delete' && state.selectedBuilding) {
    pushUndo();
    const b = state.selectedBuilding;
    removeBuildingAt(b.x, b.y);
    state.selectedBuilding = null;
    updateBuildingInfo();
    updateStats();
    validateIsland();
    render();
  }
});

// ===== TOOL SELECTION =====
function clearToolSelection() {
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.building-btn').forEach(b => b.classList.remove('active'));
}

// Terrain tools
document.getElementById('terrain-tools').addEventListener('click', (e) => {
  const btn = e.target.closest('.tool-btn');
  if (!btn) return;
  clearToolSelection();
  btn.classList.add('active');
  state.tool = 'terrain';
  state.terrainType = btn.dataset.terrain;
  state.buildingId = null;
});

// Deposit tools (built dynamically; rebuilt when island type / fertilities change)
function syncDepositToolSelectionAfterRebuild() {
  const container = document.getElementById('deposit-tools');
  if (!container) return;
  if (state.tool === 'deposit' && state.depositType) {
    const blocked = TILE_RESOURCE_IDS.has(state.depositType) &&
      typeof isTileResourceFertilityBlocked === 'function' &&
      isTileResourceFertilityBlocked(state.depositType);
    if (blocked) {
      state.depositType = null;
      state.tool = 'select';
      clearToolSelection();
      const selBtn = document.querySelector('#left-panel [data-tool="select"]');
      if (selBtn) selBtn.classList.add('active');
      return;
    }
    const btn = [...container.querySelectorAll('button.tool-btn[data-deposit-id]')].find(
      b => b.dataset.depositId === state.depositType
    );
    if (btn && !btn.disabled) {
      clearToolSelection();
      btn.classList.add('active');
    }
  }
}

function buildDepositTools() {
  const container = document.getElementById('deposit-tools');
  if (!container) return;
  container.innerHTML = '';
  DEPOSIT_TYPES.forEach(dep => {
    const btn = document.createElement('button');
    btn.className = 'tool-btn';
    btn.type = 'button';
    btn.dataset.depositId = dep.id;
    btn.textContent = dep.name;
    btn.style.borderLeft = `4px solid ${dep.color}`;
    const blocked = TILE_RESOURCE_IDS.has(dep.id) &&
      typeof isTileResourceFertilityBlocked === 'function' &&
      isTileResourceFertilityBlocked(dep.id);
    if (blocked) {
      btn.disabled = true;
      btn.title = 'This deposit requires an active island fertility — enable it under Island Type.';
      btn.style.opacity = '0.45';
      btn.style.cursor = 'not-allowed';
    }
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      clearToolSelection();
      btn.classList.add('active');
      state.tool = 'deposit';
      state.depositType = dep.id;
      state.buildingId = null;
    });
    container.appendChild(btn);
  });
  syncDepositToolSelectionAfterRebuild();
}

// Eraser / Select
document.querySelectorAll('[data-tool="eraser"],[data-tool="select"]').forEach(btn => {
  btn.addEventListener('click', () => {
    clearToolSelection();
    btn.classList.add('active');
    state.tool = btn.dataset.tool;
    state.buildingId = null;
  });
});

function syncIslandTypeBar() {
  const bar = document.getElementById('island-type-bar');
  if (!bar) return;
  bar.querySelectorAll('[data-type]').forEach(btn => {
    const active = btn.dataset.type === state.islandType && !btn.disabled;
    btn.classList.toggle('island-type-active', active);
  });
}

let _islandTypeBarInited = false;
function initIslandTypeBar() {
  const bar = document.getElementById('island-type-bar');
  if (!bar) return;
  if (_islandTypeBarInited) {
    syncIslandTypeBar();
    if (typeof buildFertilityPanel === 'function') buildFertilityPanel();
    buildDepositTools();
    return;
  }
  _islandTypeBarInited = true;
  bar.querySelectorAll('[data-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      if (typeof isMultiIslandProject === 'function' && isMultiIslandProject()) return;
      state.islandType = btn.dataset.type;
      if (typeof resetActiveFertilitiesToDefaults === 'function') resetActiveFertilitiesToDefaults();
      refreshIslandTypeDependentUI();
    });
  });
  syncIslandTypeBar();
  if (typeof buildFertilityPanel === 'function') buildFertilityPanel();
  buildDepositTools();
}

/** After load or programmatic island-type change: sync palette, planner, and global LS prefs. */
function refreshIslandTypeDependentUI() {
  syncIslandTypeBar();
  if (typeof buildFertilityPanel === 'function') buildFertilityPanel();
  if (typeof buildBuildingList === 'function') buildBuildingList();
  if (typeof buildPlannerInputs === 'function') buildPlannerInputs();
  buildDepositTools();
  if (typeof saveIslandType === 'function') saveIslandType();
  if (typeof saveFertilities === 'function') saveFertilities();
  if (typeof calculateProduction === 'function') calculateProduction();
  if (typeof syncMultiIslandUI === 'function') syncMultiIslandUI();
}

/** Trimmed optional display name on a project slot (no dependency on saveload parse order at call time). */
function getSlotDisplayName(slot) {
  if (!slot || typeof slot.name !== 'string') return '';
  return slot.name.trim();
}

/** Slot dropdown + show/hide type bar when using a multi-island project. */
function buildSlotSelectorUI() {
  const wrap = document.getElementById('slot-selector-wrap');
  const sel = document.getElementById('slot-select');
  if (!wrap || !sel) return;
  if (typeof isMultiIslandProject !== 'function' || !isMultiIslandProject()) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';
  let t = 0;
  let tr = 0;
  sel.innerHTML = '';
  state.projectSlots.forEach((slot, idx) => {
    let base;
    if (slot.type === 'temperate') {
      t += 1;
      base = `Temperate ${t}`;
    } else {
      tr += 1;
      base = `Tropical ${tr}`;
    }
    const custom = getSlotDisplayName(slot);
    let label = custom ? `${custom} (${base})` : base;
    if (!slot.island) label += ' — no grid';
    const opt = document.createElement('option');
    opt.value = String(idx);
    opt.textContent = label;
    sel.appendChild(opt);
  });
  sel.value = String(state.activeSlotIndex);
  if (!sel.dataset.wired) {
    sel.dataset.wired = '1';
    sel.addEventListener('change', () => {
      const i = parseInt(sel.value, 10);
      if (!isNaN(i) && typeof setActiveSlot === 'function') setActiveSlot(i);
    });
  }
}

function syncIslandNameInput() {
  const inp = document.getElementById('island-slot-name');
  if (!inp) return;
  if (typeof isMultiIslandProject !== 'function' || !isMultiIslandProject() || !state.projectSlots[state.activeSlotIndex]) {
    inp.value = '';
    return;
  }
  inp.value = getSlotDisplayName(state.projectSlots[state.activeSlotIndex]) || '';
}

function initIslandSlotNameField() {
  const inp = document.getElementById('island-slot-name');
  if (!inp || inp.dataset.wired === '1') return;
  inp.dataset.wired = '1';
  function applyName() {
    if (typeof isMultiIslandProject !== 'function' || !isMultiIslandProject()) return;
    const slot = state.projectSlots[state.activeSlotIndex];
    if (!slot) return;
    slot.name = typeof inp.value === 'string' ? inp.value.trim() : '';
    if (typeof saveProjectToStorage === 'function') saveProjectToStorage();
    if (typeof buildSlotSelectorUI === 'function') buildSlotSelectorUI();
  }
  inp.addEventListener('change', applyName);
  inp.addEventListener('blur', applyName);
}

function syncMultiIslandUI() {
  if (typeof buildSlotSelectorUI === 'function') buildSlotSelectorUI();
  initIslandSlotNameField();
  syncIslandNameInput();
  const bar = document.getElementById('island-type-bar');
  const fixedHint = document.getElementById('island-type-fixed-hint');
  const layoutBtn = document.getElementById('btn-island-layout');
  const multi = typeof isMultiIslandProject === 'function' && isMultiIslandProject();
  if (bar) bar.style.display = multi ? 'none' : '';
  if (fixedHint) fixedHint.style.display = multi ? 'block' : 'none';
  if (layoutBtn) layoutBtn.style.display = multi ? 'inline-block' : 'none';
  const shipsBtn = document.getElementById('btn-enter-ships');
  if (shipsBtn) shipsBtn.style.display = multi ? 'inline-block' : 'none';
  const planBtn = document.getElementById('btn-multi-island-plan');
  if (planBtn) planBtn.style.display = multi ? 'inline-block' : 'none';
  const delSlotBtn = document.getElementById('btn-delete-island-slot');
  if (delSlotBtn) {
    const canDel = multi && state.projectSlots.length > 1;
    delSlotBtn.disabled = !canDel;
    delSlotBtn.style.opacity = canDel ? '1' : '0.5';
    delSlotBtn.style.cursor = canDel ? 'pointer' : 'not-allowed';
  }
}

/** Modal: edit project-wide ship counts (multi-island only). */
function showShipFleetModal() {
  if (typeof isMultiIslandProject !== 'function' || !isMultiIslandProject()) return;
  if (typeof SHIP_TYPES_BY_ARCHETYPE === 'undefined') {
    alert('Ship data not loaded.');
    return;
  }
  if (!state.projectShipCounts) state.projectShipCounts = {};

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const sections = ['temperate', 'tropical'].map(arche => {
    const list = SHIP_TYPES_BY_ARCHETYPE[arche] || [];
    const title = arche === 'temperate' ? 'Temperate region' : 'Tropical region';
    const rows = list.map(s => {
      const v = state.projectShipCounts[s.id];
      const n = Number.isFinite(v) && v >= 0 ? Math.min(9999, Math.floor(v)) : 0;
      const sub = `${s.cargoSlots} slots × ${s.goodsPerSlotMax} goods · ${s.inRegionTravelLabel}`;
      return `<div class="ship-fleet-row" style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;">${esc(s.label)}</div>
          <div style="font-size:0.72rem;color:#888;">${esc(sub)}</div>
        </div>
        <input type="number" class="ship-fleet-count" data-ship-id="${esc(s.id)}" min="0" max="9999" step="1" value="${n}" style="width:72px;padding:4px 6px;border:1px solid #0f3460;border-radius:4px;background:#1a1a2e;color:#e0e0e0;">
      </div>`;
    }).join('');
    return `<h3 style="font-size:0.9rem;color:#e94560;margin:14px 0 8px 0;text-transform:uppercase;">${title}</h3>${rows}`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:440px;max-height:85vh;display:flex;flex-direction:column;">
      <h2>Regional fleet</h2>
      <p style="font-size:0.82rem;color:#a0a0a0;margin-bottom:10px;">Counts are shared for the whole project (all island slots). Cross-region travel is not modeled yet.</p>
      <div style="overflow-y:auto;flex:1;padding-right:4px;">${sections}</div>
      <div class="modal-actions" style="margin-top:12px;">
        <button type="button" class="header-btn" id="ship-fleet-cancel">Cancel</button>
        <button type="button" class="header-btn" id="ship-fleet-save" style="background:#e94560;border-color:#e94560;">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  function remove() {
    overlay.remove();
  }

  overlay.querySelector('#ship-fleet-cancel').addEventListener('click', remove);
  overlay.addEventListener('click', e => {
    if (e.target === overlay) remove();
  });
  overlay.querySelector('#ship-fleet-save').addEventListener('click', () => {
    if (typeof getAllShipTypeIds !== 'function' || typeof applyProjectShipCountsFromPayload !== 'function') {
      remove();
      return;
    }
    const valid = new Set(getAllShipTypeIds());
    const raw = {};
    overlay.querySelectorAll('input.ship-fleet-count[data-ship-id]').forEach(inp => {
      const id = inp.getAttribute('data-ship-id');
      if (!id || !valid.has(id)) return;
      let n = parseInt(inp.value, 10);
      if (!Number.isFinite(n) || n < 0) n = 0;
      raw[id] = Math.min(9999, Math.floor(n));
    });
    applyProjectShipCountsFromPayload(raw);
    if (typeof saveProjectToStorage === 'function') saveProjectToStorage();
    remove();
  });
}

(function initShipFleetHeaderButton() {
  const btn = document.getElementById('btn-enter-ships');
  if (!btn || btn.dataset.wired === '1') return;
  btn.dataset.wired = '1';
  btn.addEventListener('click', () => showShipFleetModal());
})();

/** Renders temperate (etc.) fertility checkboxes under Island Type. */
function buildFertilityPanel() {
  const el = document.getElementById('fertility-panel');
  if (!el) return;
  const list = typeof FERTILITY_RESOURCES !== 'undefined' ? FERTILITY_RESOURCES[state.islandType] : null;
  if (!list || list.length === 0) {
    el.innerHTML = '<span class="fertility-panel-empty">No fertility options for this island type.</span>';
    buildDepositTools();
    return;
  }
  el.innerHTML = list.map(f => {
    const id = `fertility-${f.id}`;
    const checked = state.activeFertilities && state.activeFertilities.has(f.id) ? ' checked' : '';
    return `<label class="fertility-item"><input type="checkbox" id="${id}" data-fertility="${f.id}"${checked}/> ${f.label}</label>`;
  }).join('');
  el.querySelectorAll('input[data-fertility]').forEach(inp => {
    inp.addEventListener('change', () => {
      if (!state.activeFertilities) state.activeFertilities = new Set();
      if (inp.checked) state.activeFertilities.add(inp.dataset.fertility);
      else state.activeFertilities.delete(inp.dataset.fertility);
      if (typeof saveFertilities === 'function') saveFertilities();
      if (typeof calculateProduction === 'function') calculateProduction();
      buildDepositTools();
    });
  });
  buildDepositTools();
}

// Stable order for production tiers in the palette (subset filtered by island type).
const PRODUCTION_TIER_DISPLAY_ORDER = ['Pioneers', 'Colonists', 'Townsmen', 'Merchants', 'Paragons',
  'Farmers', 'Workers', 'Northern Islands'];

// ===== BUILDING PALETTE =====
function buildBuildingList() {
  const container = document.getElementById('building-list');
  const openTiers = new Set();
  container.querySelectorAll('.tier-buildings.open').forEach(el => {
    if (el.dataset.tier) openTiers.add(el.dataset.tier);
  });
  container.innerHTML = '';
  const hint = document.createElement('div');
  hint.className = 'building-unlock-hint';
  hint.textContent = 'Double-click a building to toggle whether it is unlocked for the planner and auto-populate.';
  container.appendChild(hint);

  const allowedTierSet = new Set(getIslandTypeConfig().prodTiers);
  const tiers = PRODUCTION_TIER_DISPLAY_ORDER.filter(t => allowedTierSet.has(t));

  tiers.forEach(tier => {
    // Combine data.js buildings + extra infrastructure buildings for this tier
    // (dedupe IDs so Well/Cistern/Tavern/etc. don't appear twice)
    const extraBuildings = EXTRA_BUILDINGS.filter(b => b.tier === tier);
    const extraIds = new Set(extraBuildings.map(b => b.id));
    // Filter out zero-production buildings (e.g. PioneersHut, FarmersShack) – they produce nothing and confuse users
    const dataBuildings = PP2DATA.buildings.filter(b => b.tier === tier && !b.isPopulation && !extraIds.has(b.id) && b.producePerMinute !== 0);
    const buildings = [...extraBuildings, ...dataBuildings];
    if (buildings.length === 0) return;

    const group = document.createElement('div');
    group.className = 'tier-group';

    const header = document.createElement('div');
    header.className = 'tier-header';
    const tierBuildingIds = buildings.map(b => b.id);
    const nUnlocked = tierBuildingIds.filter(id => state.unlockedBuildings.has(id)).length;
    const nTotal = tierBuildingIds.length;
    const allUnlocked = nUnlocked === nTotal;
    const noneUnlocked = nUnlocked === 0;
    const btnGlyph = allUnlocked ? '\u2713' : noneUnlocked ? '\u2610' : '\u2013';
    const btnColor = allUnlocked ? '#2ecc71' : noneUnlocked ? '#666' : '#f1c40f';
    let tierBtnTitle = `Toggle all ${tier} buildings`;
    if (allUnlocked) tierBtnTitle = `All ${nTotal} unlocked — click to lock all`;
    else if (noneUnlocked) tierBtnTitle = `None unlocked — click to unlock all`;
    else tierBtnTitle = `${nUnlocked}/${nTotal} unlocked — click to unlock all, again to lock all`;

    header.innerHTML = `<span>${tier}</span><span style="display:flex;align-items:center;gap:6px;"><button type="button" class="tier-unlock-btn" style="background:none;border:1px solid #0f3460;color:${btnColor};border-radius:3px;padding:1px 6px;font-size:0.7rem;cursor:pointer;min-width:1.4em;line-height:1.2;">${btnGlyph}</button><span class="tier-unlock-count">${nUnlocked}/${nTotal}</span></span>`;
    const unlockBtn = header.querySelector('.tier-unlock-btn');
    unlockBtn.title = tierBtnTitle;
    unlockBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const shouldUnlock = !tierBuildingIds.every(id => state.unlockedBuildings.has(id));
      tierBuildingIds.forEach(id => {
        if (shouldUnlock) state.unlockedBuildings.add(id);
        else state.unlockedBuildings.delete(id);
      });
      saveUnlocks();
      buildBuildingList(); // rebuild to update visual state
    });
    header.addEventListener('click', () => {
      const list = group.querySelector('.tier-buildings');
      list.classList.toggle('open');
    });
    group.appendChild(header);

    const list = document.createElement('div');
    list.className = 'tier-buildings';
    list.dataset.tier = tier;
    if (openTiers.has(tier)) list.classList.add('open');

    buildings.forEach(b => {
      const btn = document.createElement('button');
      btn.className = 'building-btn';
      if (!state.unlockedBuildings.has(b.id)) btn.classList.add('locked');
      const lockPrefix = !state.unlockedBuildings.has(b.id) ? '\uD83D\uDD12 ' : '';
      // Mark infrastructure/service buildings
      const prefix = b.isInfrastructure ? '\uD83C\uDFE0 ' : b.isService ? '\u2764 ' : '';
      let displayName = b.name;
      btn.textContent = lockPrefix + prefix + displayName;
      btn.dataset.buildingId = b.id;
      btn.addEventListener('click', () => {
        clearToolSelection();
        btn.classList.add('active');
        state.tool = 'building';
        state.buildingId = b.id;
        const bData = getBuildingData(b.id);
        if (bData) showBuildingPreview(bData);
      });
      btn.addEventListener('dblclick', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (state.unlockedBuildings.has(b.id)) {
          state.unlockedBuildings.delete(b.id);
        } else {
          state.unlockedBuildings.add(b.id);
        }
        saveUnlocks();
        buildBuildingList();
      });
      list.appendChild(btn);
    });

    group.appendChild(list);
    container.appendChild(group);
  });

  // Also add population buildings allowed for this island type
  const popIds = new Set(
    (typeof getVisiblePopBuildings === 'function' ? getVisiblePopBuildings() : []).map(pb => pb.id)
  );
  const popBuildings = PP2DATA.buildings.filter(b => b.isPopulation && popIds.has(b.id));
  if (popBuildings.length > 0) {
    const group = document.createElement('div');
    group.className = 'tier-group';
    const header = document.createElement('div');
    header.className = 'tier-header';
    header.innerHTML = `<span>Population</span><span>${popBuildings.length}</span>`;
    header.addEventListener('click', () => {
      group.querySelector('.tier-buildings').classList.toggle('open');
    });
    group.appendChild(header);
    const list = document.createElement('div');
    list.className = 'tier-buildings';
    list.dataset.tier = 'Population';
    if (openTiers.has('Population')) list.classList.add('open');
    popBuildings.forEach(b => {
      const btn = document.createElement('button');
      btn.className = 'building-btn';
      btn.textContent = b.name.replace('Population ', '') + ' (Population)';
      btn.dataset.buildingId = b.id;
      btn.addEventListener('click', () => {
        clearToolSelection();
        btn.classList.add('active');
        state.tool = 'building';
        state.buildingId = b.id;
      });
      list.appendChild(btn);
    });
    group.appendChild(list);
    container.appendChild(group);
  }
}

// Filter
document.getElementById('building-filter').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  document.querySelectorAll('.building-btn').forEach(btn => {
    const match = btn.textContent.toLowerCase().includes(q);
    btn.style.display = match ? '' : 'none';
  });
  // Open all tier groups when filtering
  if (q.length > 0) {
    document.querySelectorAll('.tier-buildings').forEach(el => el.classList.add('open'));
  }
});

// ===== INFO PANELS =====
function updateCellInfo(x, y) {
  const el = document.getElementById('cell-info');
  if (!state.island) { el.innerHTML = '<h4>Cell Info</h4><p style="color:#666">No island</p>'; return; }
  const { width, height, cells } = state.island;
  if (x < 0 || x >= width || y < 0 || y >= height) {
    el.innerHTML = '<h4>Cell Info</h4><p style="color:#666">Out of bounds</p>';
    return;
  }
  const cell = cells[y][x];
  let html = `<h4>Cell (${x}, ${y})</h4>`;
  html += `<div class="info-row"><span class="info-label">Terrain:</span><span class="info-value">${cell.terrain}</span></div>`;
  if (cell.terrain === 'river') {
    const shape = getRiverShape(x, y);
    const shapeLabels = {
      straight_h: 'Straight (horizontal)',
      straight_v: 'Straight (vertical)',
      bend: 'Bend',
      junction: 'Junction',
      endpoint: 'Endpoint (straight)',
      isolated: 'Isolated',
    };
    const isStraight = isRiverStraight(x, y);
    html += `<div class="info-row"><span class="info-label">River:</span><span class="info-value ${isStraight ? 'ok-text' : 'warning-text'}">${shapeLabels[shape] || shape} ${isStraight ? '⚙' : '↱'}</span></div>`;
  }
  if (cell.deposit) {
    const dep = DEPOSIT_TYPES.find(d => d.id === cell.deposit);
    html += `<div class="info-row"><span class="info-label">Deposit:</span><span class="info-value">${dep ? dep.name : cell.deposit}</span></div>`;
  }
  const { anchor: infoAnchor, coverage: infoCov } = getCellBuildingLayers(x, y);
  if (infoAnchor) {
    const b = getBuildingData(infoAnchor.id);
    html += `<div class="info-row"><span class="info-label">Building:</span><span class="info-value">${b ? b.name : infoAnchor.id} <span class="info-sub">(anchor)</span></span></div>`;
    if (b && b.produces) html += `<div class="info-row"><span class="info-label">Produces:</span><span class="info-value">${PP2DATA.getResourceName(b.produces)}</span></div>`;
  }
  for (const cov of infoCov) {
    const b = getBuildingData(cov.id);
    html += `<div class="info-row"><span class="info-label">Footprint:</span><span class="info-value">${b ? b.name : cov.id}</span></div>`;
  }
  el.innerHTML = html;
}

function showBuildingPreview(building) {
  const el = document.getElementById('building-info');
  el.style.display = 'block';
  const fp = FOOTPRINTS[building.id];
  let html = `<h4>${building.name}</h4>`;
  html += `<div class="info-row"><span class="info-label">Tier:</span><span class="info-value">${building.tier}</span></div>`;
  if (building.produces) {
    html += `<div class="info-row"><span class="info-label">Produces:</span><span class="info-value">${PP2DATA.getResourceName(building.produces)}</span></div>`;
  }
  if (building.producePerMinute) {
    html += `<div class="info-row"><span class="info-label">Rate:</span><span class="info-value">${building.producePerMinute}/min</span></div>`;
  }
  if (building.isInfrastructure) {
    html += `<div class="info-row"><span class="info-label">Type:</span><span class="info-value">Warehouse</span></div>`;
  }
  if (building.isService) {
    html += `<div class="info-row"><span class="info-label">Type:</span><span class="info-value">Service</span></div>`;
  }
  html += `<div class="info-row"><span class="info-label">Footprint:</span><span class="info-value">${fp ? fp.length + ' cells' : 'unknown'}</span></div>`;

  // Location requirement
  const locReq = LOCATION_REQUIREMENTS[building.id];
  if (locReq) {
    html += `<div class="info-row"><span class="info-label">Placement:</span><span class="info-value warning-text">${locReq.label}</span></div>`;
  }

  // Inputs (tile requirements)
  if (building.inputs && Object.keys(building.inputs).length > 0) {
    html += '<h4 style="margin-top:6px">Inputs</h4>';
    for (const [resId, amount] of Object.entries(building.inputs)) {
      const isTile = TILE_RESOURCE_IDS.has(resId);
      html += `<div class="info-row">
        <span class="info-label">${PP2DATA.getResourceName(resId)}${isTile ? ' ⬡' : ''}</span>
        <span class="info-value">${amount}/cycle</span>
      </div>`;
    }
  }
  el.innerHTML = html;
}

function updateBuildingInfo() {
  const el = document.getElementById('building-info');
  if (!state.selectedBuilding) {
    el.style.display = 'none';
    return;
  }
  const b = getBuildingData(state.selectedBuilding.id);
  if (b) showBuildingPreview(b);
}
