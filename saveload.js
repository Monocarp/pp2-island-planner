// ===== SAVE / LOAD =====
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
  if (!state.island) return;
  const saves = JSON.parse(localStorage.getItem('pp2_island_saves') || '[]');
  const name = prompt('Save name:', `Island ${saves.length + 1}`);
  if (!name) return;
  saves.push({
    name,
    date: new Date().toISOString(),
    island: state.island,
    islandType: state.islandType,
    activeFertilities: state.activeFertilities ? [...state.activeFertilities] : [],
  });
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
  state.island = snap.island;
  state.undoStack = [];
  state.redoStack = [];
  state.selectedBuilding = null;
  applySaveArchetypeMetadata(snap);
  centerView();
  updateStats();
  validateIsland();
  render();
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

// ===== NEW ISLAND MODAL =====
document.getElementById('btn-new-island').addEventListener('click', showNewIslandModal);

function showNewIslandModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2>New Island</h2>
      <label>Width</label>
      <input type="number" id="modal-width" value="21" min="5" max="50">
      <label>Height</label>
      <input type="number" id="modal-height" value="21" min="5" max="50">
      <label>Default Terrain</label>
      <select id="modal-terrain">
        <option value="grass">Grass</option>
        <option value="water">Water (blank slate)</option>
      </select>
      <div class="modal-actions">
        <button class="header-btn" id="modal-cancel">Cancel</button>
        <button class="header-btn" id="modal-create" style="background:#e94560;border-color:#e94560;">Create</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#modal-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#modal-create').addEventListener('click', () => {
    const w = parseInt(overlay.querySelector('#modal-width').value) || 21;
    const h = parseInt(overlay.querySelector('#modal-height').value) || 21;
    const terrain = overlay.querySelector('#modal-terrain').value;
    state.island = createIsland(
      Math.max(5, Math.min(50, w)),
      Math.max(5, Math.min(50, h))
    );
    if (terrain === 'water') {
      // Set all cells to water initially (user will paint land)
      state.island.cells.forEach(row => row.forEach(c => c.terrain = 'water'));
    }
    state.undoStack = [];
    state.redoStack = [];
    state.selectedBuilding = null;
    centerView();
    updateStats();
    validateIsland();
    overlay.remove();
    render();
  });
}

function centerView() {
  if (!state.island) return;
  const area = document.getElementById('canvas-area');
  const totalW = state.island.width * state.zoom;
  const totalH = state.island.height * state.zoom;
  state.panX = (area.clientWidth - totalW) / 2;
  state.panY = (area.clientHeight - totalH) / 2;
}

// ===== INITIALIZATION =====
function init() {
  loadUnlocks();
  loadIslandType();
  loadFertilities();
  buildDepositTools();
  initIslandTypeBar();
  if (typeof buildFertilityPanel === 'function') buildFertilityPanel();
  buildBuildingList();
  buildPlannerInputs();
  resizeCanvas();

  // Show new island modal on first load if no island
  if (!state.island) {
    showNewIslandModal();
  }
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
