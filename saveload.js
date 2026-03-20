// ===== SAVE / LOAD =====
const PROJECT_STORAGE_KEY = 'pp2_island_layout_v1';

function normalizeSlotName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim();
}

function createEmptyProjectSlot(type) {
  return {
    type,
    name: '',
    island: null,
    activeFertilities: getDefaultFertilityIdsForArchetype(type),
  };
}

/** Build slot array: temperate first, then tropical; merge from previousSlots by index when types match. */
function rebuildProjectSlots(temperateCount, tropicalCount, previousSlots) {
  const prev = previousSlots || [];
  const slots = [];
  for (let i = 0; i < temperateCount; i++) {
    const old = prev[i] && prev[i].type === 'temperate' ? prev[i] : null;
    if (old) {
      slots.push({
        type: 'temperate',
        name: normalizeSlotName(old.name),
        island: old.island ? deepCloneIsland(old.island) : null,
        activeFertilities: Array.isArray(old.activeFertilities)
          ? old.activeFertilities.slice()
          : getDefaultFertilityIdsForArchetype('temperate'),
      });
    } else {
      slots.push(createEmptyProjectSlot('temperate'));
    }
  }
  for (let j = 0; j < tropicalCount; j++) {
    const idx = temperateCount + j;
    const old = prev[idx] && prev[idx].type === 'tropical' ? prev[idx] : null;
    if (old) {
      slots.push({
        type: 'tropical',
        name: normalizeSlotName(old.name),
        island: old.island ? deepCloneIsland(old.island) : null,
        activeFertilities: Array.isArray(old.activeFertilities)
          ? old.activeFertilities.slice()
          : getDefaultFertilityIdsForArchetype('tropical'),
      });
    } else {
      slots.push(createEmptyProjectSlot('tropical'));
    }
  }
  return slots;
}

/** Slots removed when shrinking counts (for data-loss confirm). */
function applyProjectShipCountsFromPayload(raw) {
  state.projectShipCounts = {};
  if (typeof getAllShipTypeIds !== 'function') return;
  const valid = new Set(getAllShipTypeIds());
  if (!raw || typeof raw !== 'object') return;
  for (const id of valid) {
    if (!Object.prototype.hasOwnProperty.call(raw, id)) continue;
    const n = parseInt(raw[id], 10);
    if (Number.isFinite(n) && n >= 0) state.projectShipCounts[id] = Math.min(9999, Math.floor(n));
  }
}

function shipCountsForProjectSave() {
  if (typeof getAllShipTypeIds !== 'function') return {};
  const out = {};
  for (const id of getAllShipTypeIds()) {
    const n = state.projectShipCounts[id];
    if (Number.isFinite(n) && n > 0) out[id] = Math.floor(n);
  }
  return out;
}

function getDroppedSlotsWhenResizingCounts(oldSlots, oldTemperate, oldTropical, newTemperate, newTropical) {
  const dropped = [];
  for (let i = 0; i < oldSlots.length; i++) {
    let keep = false;
    if (i < oldTemperate) keep = i < newTemperate;
    else keep = i - oldTemperate < newTropical;
    if (!keep) dropped.push(oldSlots[i]);
  }
  return dropped;
}

function saveProjectToStorage() {
  if (!isMultiIslandProject()) return;
  const payload = {
    version: PROJECT_LAYOUT_VERSION,
    temperateCount: state.projectTemperateCount,
    tropicalCount: state.projectTropicalCount,
    activeSlotIndex: state.activeSlotIndex,
    slots: state.projectSlots.map(s => ({
      type: s.type,
      name: normalizeSlotName(s.name),
      island: s.island,
      activeFertilities: s.activeFertilities,
    })),
    shipCounts: shipCountsForProjectSave(),
  };
  localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(payload));
}

function loadProjectFromStorage() {
  const raw = localStorage.getItem(PROJECT_STORAGE_KEY);
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    if (!data || data.version !== PROJECT_LAYOUT_VERSION || !Array.isArray(data.slots)) return false;
    const t = Math.max(0, parseInt(data.temperateCount, 10) || 0);
    const tr = Math.max(0, parseInt(data.tropicalCount, 10) || 0);
    if (t + tr < 1) return false;
    state.projectTemperateCount = t;
    state.projectTropicalCount = tr;
    state.projectSlots = data.slots.map(s => ({
      type: s.type === 'tropical' ? 'tropical' : 'temperate',
      name: normalizeSlotName(s.name),
      island: s.island || null,
      activeFertilities: Array.isArray(s.activeFertilities)
        ? s.activeFertilities
        : getDefaultFertilityIdsForArchetype(s.type === 'tropical' ? 'tropical' : 'temperate'),
    }));
    if (state.projectSlots.length !== t + tr) {
      state.projectSlots = rebuildProjectSlots(t, tr, data.slots);
    }
    state.activeSlotIndex = Math.min(
      Math.max(0, parseInt(data.activeSlotIndex, 10) || 0),
      state.projectSlots.length - 1
    );
    applyProjectShipCountsFromPayload(data.shipCounts);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Switch active island slot (multi-project mode). Commits current grid/fertilities to the previous slot unless skipCommit.
 */
function setActiveSlot(index, opts) {
  const opt = opts || {};
  if (!isMultiIslandProject()) return;
  if (index < 0 || index >= state.projectSlots.length) return;

  if (!opt.skipCommit && state.projectSlots[state.activeSlotIndex]) {
    const cur = state.projectSlots[state.activeSlotIndex];
    const nameInp = document.getElementById('island-slot-name');
    if (nameInp) {
      cur.name = normalizeSlotName(nameInp.value);
    }
    cur.island = deepCloneIsland(state.island);
    cur.activeFertilities = state.activeFertilities ? [...state.activeFertilities] : [];
  }

  state.activeSlotIndex = index;
  const slot = state.projectSlots[index];
  state.islandType = slot.type;
  state.island = deepCloneIsland(slot.island);
  state.activeFertilities = new Set(
    Array.isArray(slot.activeFertilities) && slot.activeFertilities.length
      ? slot.activeFertilities
      : getDefaultFertilityIdsForArchetype(slot.type)
  );
  state.undoStack = [];
  state.redoStack = [];
  state.selectedBuilding = null;
  saveIslandType();
  saveFertilities();
  saveProjectToStorage();
  if (typeof refreshIslandTypeDependentUI === 'function') refreshIslandTypeDependentUI();

  if (state.island) {
    centerView();
    updateStats();
    validateIsland();
    render();
  } else {
    updateStats();
    validateIsland();
    render();
  }
}

/** Persist current editor island into the active slot without switching. */
function commitActiveSlotFromState() {
  if (!isMultiIslandProject() || !state.projectSlots[state.activeSlotIndex]) return;
  const cur = state.projectSlots[state.activeSlotIndex];
  const nameInp = document.getElementById('island-slot-name');
  if (nameInp) {
    cur.name = normalizeSlotName(nameInp.value);
  }
  cur.island = deepCloneIsland(state.island);
  cur.activeFertilities = state.activeFertilities ? [...state.activeFertilities] : [];
  saveProjectToStorage();
}

/** Snapshot island type + fertilities from a save entry onto global state and refresh UI. */
function applySaveArchetypeMetadata(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  let typeApplied = false;

  if (typeof snapshot.islandType === 'string' && VALID_ISLAND_TYPES.has(snapshot.islandType)) {
    state.islandType = snapshot.islandType === 'magical' ? 'temperate' : snapshot.islandType;
    typeApplied = true;
  }

  if (Array.isArray(snapshot.activeFertilities)) {
    const list = FERTILITY_RESOURCES[state.islandType] || [];
    const validIds = new Set(list.map(f => f.id));
    if (validIds.size === 0) {
      state.activeFertilities = new Set();
    } else {
      const filt = snapshot.activeFertilities.filter(id => validIds.has(id));
      state.activeFertilities =
        filt.length > 0 ? new Set(filt) : new Set(list.map(f => f.id));
    }
  } else if (typeApplied) {
    resetActiveFertilitiesToDefaults();
  }

  if (typeof refreshIslandTypeDependentUI === 'function') refreshIslandTypeDependentUI();
}

function saveToLocalStorage() {
  if (!isMultiIslandProject()) {
    if (!state.island) return;
  } else {
    commitActiveSlotFromState();
  }
  const saves = JSON.parse(localStorage.getItem('pp2_island_saves') || '[]');
  const name = prompt('Save name:', `Layout ${saves.length + 1}`);
  if (!name) return;
  const entry = {
    name,
    date: new Date().toISOString(),
    island: state.island,
    islandType: state.islandType,
    activeFertilities: state.activeFertilities ? [...state.activeFertilities] : [],
  };
  if (isMultiIslandProject()) {
    entry.projectVersion = PROJECT_LAYOUT_VERSION;
    entry.temperateCount = state.projectTemperateCount;
    entry.tropicalCount = state.projectTropicalCount;
    entry.activeSlotIndex = state.activeSlotIndex;
    entry.projectSlots = state.projectSlots.map(s => ({
      type: s.type,
      name: normalizeSlotName(s.name),
      island: s.island,
      activeFertilities: s.activeFertilities,
    }));
    entry.shipCounts = shipCountsForProjectSave();
  }
  saves.push(entry);
  localStorage.setItem('pp2_island_saves', JSON.stringify(saves));
  alert('Saved!');
}

function loadFromLocalStorage() {
  const saves = JSON.parse(localStorage.getItem('pp2_island_saves') || '[]');
  if (saves.length === 0) { alert('No saves found.'); return; }

  const choice = prompt(
    'Enter save number to load:\n' +
    saves.map((s, i) => `${i + 1}. ${s.name} (${new Date(s.date).toLocaleDateString()})`).join('\n')
  );
  const idx = parseInt(choice) - 1;
  if (isNaN(idx) || idx < 0 || idx >= saves.length) return;

  const snap = saves[idx];
  if (snap.projectVersion === PROJECT_LAYOUT_VERSION && Array.isArray(snap.projectSlots)) {
    const t = Math.max(0, parseInt(snap.temperateCount, 10) || 0);
    const tr = Math.max(0, parseInt(snap.tropicalCount, 10) || 0);
    if (t + tr >= 1) {
      state.projectTemperateCount = t;
      state.projectTropicalCount = tr;
      state.projectSlots = snap.projectSlots.map(s => ({
        type: s.type === 'tropical' ? 'tropical' : 'temperate',
        name: normalizeSlotName(s.name),
        island: s.island || null,
        activeFertilities: Array.isArray(s.activeFertilities)
          ? s.activeFertilities
          : getDefaultFertilityIdsForArchetype(s.type === 'tropical' ? 'tropical' : 'temperate'),
      }));
      if (state.projectSlots.length !== t + tr) {
        state.projectSlots = rebuildProjectSlots(t, tr, snap.projectSlots);
      }
      state.activeSlotIndex = Math.min(
        Math.max(0, parseInt(snap.activeSlotIndex, 10) || 0),
        state.projectSlots.length - 1
      );
      applyProjectShipCountsFromPayload(snap.shipCounts);
      saveProjectToStorage();
      setActiveSlot(state.activeSlotIndex, { skipCommit: true });
      return;
    }
  }
  // Legacy named save (single island): migrate into one-slot project
  state.undoStack = [];
  state.redoStack = [];
  state.selectedBuilding = null;
  let legType = 'temperate';
  if (typeof snap.islandType === 'string' && snap.islandType === 'tropical') legType = 'tropical';
  state.projectTemperateCount = legType === 'temperate' ? 1 : 0;
  state.projectTropicalCount = legType === 'tropical' ? 1 : 0;
  state.projectSlots = rebuildProjectSlots(state.projectTemperateCount, state.projectTropicalCount, []);
  state.projectSlots[0].island = deepCloneIsland(snap.island);
  if (Array.isArray(snap.activeFertilities)) {
    state.projectSlots[0].activeFertilities = snap.activeFertilities.slice();
  }
  state.activeSlotIndex = 0;
  state.projectShipCounts = {};
  saveProjectToStorage();
  setActiveSlot(0, { skipCommit: true });
}

document.getElementById('btn-save').addEventListener('click', saveToLocalStorage);
document.getElementById('btn-load').addEventListener('click', loadFromLocalStorage);

function saveUnlocks() {
  localStorage.setItem('pp2_unlocked_buildings', JSON.stringify([...state.unlockedBuildings]));
}

function loadUnlocks() {
  const data = localStorage.getItem('pp2_unlocked_buildings');
  if (data) {
    state.unlockedBuildings = new Set(JSON.parse(data));
  } else {
    // Default: unlock all Pioneer + population buildings
    PP2DATA.buildings.filter(b => b.tier === 'Pioneers' || b.isPopulation).forEach(b => {
      state.unlockedBuildings.add(b.id);
    });
  }
}

const ISLAND_TYPE_STORAGE_KEY = 'pp2_island_type';

function loadIslandType() {
  const raw = localStorage.getItem(ISLAND_TYPE_STORAGE_KEY);
  if (raw && VALID_ISLAND_TYPES.has(raw)) {
    state.islandType = raw;
    // Magical has no data yet — treat as temperate for behaviour; UI keeps button disabled
    if (raw === 'magical') state.islandType = 'temperate';
  } else {
    state.islandType = 'temperate';
  }
}

function saveIslandType() {
  localStorage.setItem(ISLAND_TYPE_STORAGE_KEY, state.islandType);
}

const FERTILITY_STORAGE_KEY = 'pp2_island_fertilities';

function saveFertilities() {
  if (!state.activeFertilities) return;
  localStorage.setItem(FERTILITY_STORAGE_KEY, JSON.stringify([...state.activeFertilities]));
}

function loadFertilities() {
  const validIds = new Set(getDefaultFertilityIds());
  const raw = localStorage.getItem(FERTILITY_STORAGE_KEY);
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        if (validIds.size === 0) state.activeFertilities = new Set();
        else state.activeFertilities = new Set(arr.filter(id => validIds.has(id)));
        return;
      }
    } catch (_) { /* use defaults */ }
  }
  resetActiveFertilitiesToDefaults();
}

// ===== ISLAND SETUP & GRID SIZE MODALS =====

function showIslandSetupModal(options) {
  const {
    isFirstRun = false,
    initialTemperate = 1,
    initialTropical = 0,
    onComplete,
    onCancel,
  } = options || {};

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2>Island layout</h2>
      <p style="font-size:0.85rem;color:#a0a0a0;margin-bottom:12px;">How many islands of each type? You can change this later; removing a slot may delete its map.</p>
      <label>Temperate island count</label>
      <input type="number" id="setup-temperate" min="0" max="99" value="${initialTemperate}">
      <label>Tropical island count</label>
      <input type="number" id="setup-tropical" min="0" max="99" value="${initialTropical}">
      <div class="modal-actions">
        ${isFirstRun ? '' : '<button type="button" class="header-btn" id="setup-cancel">Cancel</button>'}
        <button type="button" class="header-btn" id="setup-continue" style="background:#e94560;border-color:#e94560;">Continue</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  function remove() {
    overlay.remove();
  }

  const cancelBtn = overlay.querySelector('#setup-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      remove();
      if (onCancel) onCancel();
    });
  }

  overlay.querySelector('#setup-continue').addEventListener('click', () => {
    const t = Math.max(0, parseInt(overlay.querySelector('#setup-temperate').value, 10) || 0);
    const tr = Math.max(0, parseInt(overlay.querySelector('#setup-tropical').value, 10) || 0);
    if (t + tr < 1) {
      alert('Need at least one island (temperate and/or tropical count).');
      return;
    }

    if (isMultiIslandProject()) {
      const oldT = state.projectTemperateCount;
      const oldTr = state.projectTropicalCount;
      const dropped = getDroppedSlotsWhenResizingCounts(state.projectSlots, oldT, oldTr, t, tr);
      const hasLoss = dropped.some(s => islandLayoutHasContent(s.island));
      if (hasLoss && !confirm('Reducing counts will remove at least one island that has terrain, deposits, or buildings. Continue?')) {
        return;
      }
    }

    const prevSlots = isMultiIslandProject() ? state.projectSlots : null;
    state.projectTemperateCount = t;
    state.projectTropicalCount = tr;
    state.projectSlots = rebuildProjectSlots(t, tr, prevSlots);
    if (state.activeSlotIndex >= state.projectSlots.length) {
      state.activeSlotIndex = Math.max(0, state.projectSlots.length - 1);
    }
    saveProjectToStorage();
    remove();
    if (onComplete) onComplete(t, tr);
  });
}

/** Create or replace the grid for the active slot. */
function showIslandGridModal(opts) {
  const options = opts || {};
  const title = options.title || 'Island size';
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2>${title}</h2>
      <label>Width</label>
      <input type="number" id="modal-width" value="21" min="5" max="50">
      <label>Height</label>
      <input type="number" id="modal-height" value="21" min="5" max="50">
      <label>Default terrain</label>
      <select id="modal-terrain">
        <option value="grass">Grass</option>
        <option value="water">Water (blank slate)</option>
      </select>
      <div class="modal-actions">
        <button type="button" class="header-btn" id="modal-cancel">Cancel</button>
        <button type="button" class="header-btn" id="modal-create" style="background:#e94560;border-color:#e94560;">Create</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#modal-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#modal-create').addEventListener('click', () => {
    if (
      isMultiIslandProject() &&
      state.island &&
      islandLayoutHasContent(state.island) &&
      !confirm('Replace the current island map? This cannot be undone.')
    ) {
      return;
    }
    const w = parseInt(overlay.querySelector('#modal-width').value, 10) || 21;
    const h = parseInt(overlay.querySelector('#modal-height').value, 10) || 21;
    const terrain = overlay.querySelector('#modal-terrain').value;
    const isl = createIsland(Math.max(5, Math.min(50, w)), Math.max(5, Math.min(50, h)));
    if (terrain === 'water') {
      isl.cells.forEach(row => row.forEach(c => { c.terrain = 'water'; }));
    }
    state.island = isl;
    state.undoStack = [];
    state.redoStack = [];
    state.selectedBuilding = null;
    commitActiveSlotFromState();
    centerView();
    updateStats();
    validateIsland();
    overlay.remove();
    render();
  });
}

function showNewIslandModal() {
  showIslandGridModal({ title: 'New / resize island grid' });
}

document.getElementById('btn-new-island').addEventListener('click', showNewIslandModal);

const btnLayout = document.getElementById('btn-island-layout');
if (btnLayout) {
  btnLayout.addEventListener('click', () => {
    if (!isMultiIslandProject()) return;
    showIslandSetupModal({
      isFirstRun: false,
      initialTemperate: state.projectTemperateCount,
      initialTropical: state.projectTropicalCount,
      onComplete: () => {
        setActiveSlot(state.activeSlotIndex, { skipCommit: true });
        if (!state.island) showIslandGridModal({ title: 'Set island size' });
      },
    });
  });
}

window.addEventListener('beforeunload', () => {
  try {
    if (!isMultiIslandProject()) return;
    commitActiveSlotFromState();
  } catch (_) { /* ignore */ }
});

function centerView() {
  if (!state.island) return;
  const area = document.getElementById('canvas-area');
  const totalW = state.island.width * state.zoom;
  const totalH = state.island.height * state.zoom;
  state.panX = (area.clientWidth - totalW) / 2;
  state.panY = (area.clientHeight - totalH) / 2;
}

// ===== INITIALIZATION =====
function finishInitAfterProject() {
  setActiveSlot(state.activeSlotIndex, { skipCommit: true });
  initIslandTypeBar();
  resizeCanvas();

  if (!state.island) {
    showIslandGridModal({ title: 'Set island size' });
  } else {
    render();
  }
}

function init() {
  loadUnlocks();
  if (!loadProjectFromStorage()) {
    showIslandSetupModal({
      isFirstRun: true,
      initialTemperate: 1,
      initialTropical: 0,
      onComplete: () => finishInitAfterProject(),
    });
    return;
  }
  finishInitAfterProject();
}

window.addEventListener('resize', resizeCanvas);
window.addEventListener('load', init);

// ===== MOBILE DRAWER TOGGLES =====
(function() {
  const left = document.getElementById('left-panel');
  const right = document.getElementById('right-panel');
  const backdrop = document.getElementById('drawer-backdrop');
  const toggleLeft = document.getElementById('toggle-left');
  const toggleRight = document.getElementById('toggle-right');
  function closeAll() {
    left.classList.remove('open');
    right.classList.remove('open');
    backdrop.classList.remove('show');
  }
  toggleLeft.addEventListener('click', () => {
    const opening = !left.classList.contains('open');
    closeAll();
    if (opening) { left.classList.add('open'); backdrop.classList.add('show'); }
  });
  toggleRight.addEventListener('click', () => {
    const opening = !right.classList.contains('open');
    closeAll();
    if (opening) { right.classList.add('open'); backdrop.classList.add('show'); }
  });
  backdrop.addEventListener('click', closeAll);
})();
