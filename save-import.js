// ===== PP2 SAVE FILE IMPORT =====
// Parses a decoded PP2 game save (.dat / JSON) and converts it to planner project slots.
//
// Save structure investigated:
//   IslandManager.islands[]  → per-island terrain, entities, and map settings
//   ShipManager.Ships[]      → regional fleet (Type 2/3/4 → caravel/hulk/pinnace)
//   House* entities          → per-island counts → planner population inputs (pre-fill)
//
// Grid tile types:
//   Type 2            = water / ocean border
//   Type 3 + Height   = mountain (impassable; planner has no mountain terrain, treated as grass)
//   Type 3 + DepositType = mineral deposit on land tile (integer → string mapping below)
//   absent / SectorID only = land (grass), buildable
//
// GameEntities:
//   Forest                  → cell terrain 'forest'
//   AppleTrees, WheatField, HopsField, etc. → cell deposit (field tile)
//   Known building IDs      → placed as anchor building
//   Unknown/infrastructure  → skipped (counted in import summary)
//
// Grid + GameEntities → planner island: save-island-from-save.js

/**
 * ShipManager.Ships[].Type integer → planner ship id (ships.js).
 * Unmapped types (e.g. portal Phoenix) are skipped with a warning.
 */
const SAVE_SHIP_TYPE_INT = {
  2: 'caravel',
  3: 'hulk',
  4: 'pinnace',
};

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse a PP2 save file (JSON string or already-parsed object).
 * Returns { islands, shipCounts, warnings, version }.
 *
 * ImportedIsland: {
 *   name, type, island, activeFertilities,
 *   summary: { placed, skippedInfra, unknownIds },
 *   popCounts: Record<plannerPopBuildingId, number>
 * }
 */
function parsePP2SaveFile(input) {
  let data;
  try {
    data = typeof input === 'string' ? JSON.parse(input) : input;
  } catch (e) {
    return { islands: [], shipCounts: {}, warnings: [`JSON parse error: ${e.message}`], version: null };
  }

  const warnings = [];
  const version = data.SaveFileVersion || null;
  const mgr = data.IslandManager;
  if (!mgr || !Array.isArray(mgr.islands)) {
    warnings.push('No IslandManager.islands found in save file.');
    return { islands: [], shipCounts: {}, warnings, version };
  }

  const imported = [];
  for (const si of mgr.islands) {
    try {
      const result = _convertSaveIsland(si, warnings);
      if (result) imported.push(result);
    } catch (err) {
      warnings.push(`Error importing island "${si.Name || '?'}": ${err.message}`);
    }
  }

  // Sort: temperate first, then tropical/northern (matches planner slot convention)
  imported.sort((a, b) => {
    const rank = t => t === 'temperate' ? 0 : t === 'northern' ? 1 : 2;
    return rank(a.type) - rank(b.type);
  });

  const shipCounts = {};
  const unknownShipTypes = new Map(); // type int → count
  const shipMgr = data.ShipManager;
  if (shipMgr && Array.isArray(shipMgr.Ships)) {
    for (const ship of shipMgr.Ships) {
      const t = ship.Type;
      const id = SAVE_SHIP_TYPE_INT[t];
      if (id) {
        shipCounts[id] = (shipCounts[id] || 0) + 1;
      } else {
        unknownShipTypes.set(t, (unknownShipTypes.get(t) || 0) + 1);
      }
    }
  }
  for (const [typeInt, n] of unknownShipTypes) {
    warnings.push(`Unknown ship Type ${typeInt} — ${n} ship(s) skipped (no planner mapping)`);
  }

  return { islands: imported, shipCounts, warnings, version };
}

function _convertSaveIsland(si, warnings) {
  return buildPlannerIslandFromSaveIsland(si, { getBuildingData, warnings });
}

/**
 * Fill main planner population inputs from a slot's imported house counts (after import / slot switch context).
 */
function prefillPlannerInputsFromSlot(slotIndex) {
  if (!state.projectSlots || !state.projectSlots[slotIndex]) return;
  const raw = state.projectSlots[slotIndex].importedPopCounts;
  if (!raw || typeof raw !== 'object') return;

  function setOne(id, n) {
    const el = document.getElementById('planner-' + id);
    if (!el) return;
    const v = Math.max(0, Math.min(9999, Math.floor(Number(n) || 0)));
    el.value = String(v);
  }

  if (typeof getVisiblePopBuildings === 'function') {
    getVisiblePopBuildings().forEach(pb => {
      const v = raw[pb.id];
      setOne(pb.id, Number.isFinite(v) ? v : 0);
    });
  } else if (typeof POP_BUILDINGS !== 'undefined' && Array.isArray(POP_BUILDINGS)) {
    POP_BUILDINGS.forEach(pb => {
      const v = raw[pb.id];
      setOne(pb.id, Number.isFinite(v) ? v : 0);
    });
  }
}

// ─── Apply import to project ──────────────────────────────────────────────────

/**
 * Replace the current multi-island project with islands from a parsed save.
 * Calls planner state mutation + saveProjectToStorage.
 */
function applyPP2SaveImport(parsedData) {
  const islands = parsedData.islands;
  const temperate = islands.filter(i => i.type === 'temperate' || i.type === 'northern');
  const tropical = islands.filter(i => i.type === 'tropical');

  state.projectTemperateCount = Math.max(1, temperate.length);
  state.projectTropicalCount = tropical.length;

  state.projectSlots = [
    ...temperate.map(i => ({
      type: 'temperate',
      name: i.name,
      island: i.island,
      activeFertilities: i.activeFertilities,
      importedPopCounts: i.popCounts && typeof i.popCounts === 'object'
        ? { ...i.popCounts }
        : {},
    })),
    ...tropical.map(i => ({
      type: 'tropical',
      name: i.name,
      island: i.island,
      activeFertilities: i.activeFertilities,
      importedPopCounts: i.popCounts && typeof i.popCounts === 'object'
        ? { ...i.popCounts }
        : {},
    })),
  ];

  if (parsedData.shipCounts && typeof applyProjectShipCountsFromPayload === 'function') {
    applyProjectShipCountsFromPayload(parsedData.shipCounts);
  }

  state.activeSlotIndex = 0;

  // Load first slot into the canvas
  if (typeof setActiveSlot === 'function') {
    setActiveSlot(0, { skipCommit: true });
  } else {
    const first = state.projectSlots[0];
    state.islandType = first.type;
    state.island = typeof deepCloneIsland === 'function'
      ? deepCloneIsland(first.island) : JSON.parse(JSON.stringify(first.island));
    state.activeFertilities = new Set(first.activeFertilities);
  }

  if (typeof saveProjectToStorage === 'function') saveProjectToStorage();
  if (typeof buildSlotSelectorUI === 'function') buildSlotSelectorUI();
  if (typeof syncMultiIslandUI === 'function') syncMultiIslandUI();
  if (typeof renderIsland === 'function') renderIsland();
  if (typeof updateStats === 'function') updateStats();

  prefillPlannerInputsFromSlot(0);
}

// ─── UI ───────────────────────────────────────────────────────────────────────

function _escSaveImportHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** HTML snippet: house counts from save entities (for modal). */
function _formatImportedPopCountsLine(popCounts) {
  if (!popCounts || typeof popCounts !== 'object') return '';
  const entries = Object.entries(popCounts).filter(([, n]) => (Number(n) || 0) > 0);
  if (entries.length === 0) {
    return '<span style="color:#666;">no houses counted</span>';
  }
  const labelFor = id => {
    if (typeof POP_BUILDINGS !== 'undefined' && Array.isArray(POP_BUILDINGS)) {
      const pb = POP_BUILDINGS.find(p => p.id === id);
      if (pb) return pb.label;
    }
    return id;
  };
  return entries.map(([id, n]) => `${_escSaveImportHtml(labelFor(id))}: ${n}`).join(' · ');
}

function showSaveImportModal(parsedData) {
  const existing = document.getElementById('pp2-save-import-modal');
  if (existing) existing.remove();

  const { islands, warnings, version, shipCounts } = parsedData;
  const tempCount = islands.filter(i => i.type === 'temperate' || i.type === 'northern').length;
  const tropCount = islands.filter(i => i.type === 'tropical').length;

  const overlay = document.createElement('div');
  overlay.id = 'pp2-save-import-modal';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:4000;background:rgba(0,0,0,.75);
    display:flex;align-items:center;justify-content:center;padding:16px;
  `;

  const sc = shipCounts || {};
  const shipEntries = Object.entries(sc).filter(([, n]) => (Number(n) || 0) > 0);
  const shipFleetHtml = shipEntries.length
    ? `<div style="font-size:0.78rem;color:#a0c4e8;margin:0 0 10px 0;line-height:1.35;">
        <strong style="color:#7ec8e3;">Fleet</strong> (mapped ship types): ${shipEntries.map(([id, n]) => `${_escSaveImportHtml(id)}: ${n}`).join(', ')}
      </div>`
    : `<div style="font-size:0.78rem;color:#888;margin:0 0 10px 0;">No mapped fleet ships (Type 2/3/4 only; others appear in warnings).</div>`;

  const islandRows = islands.map(isl => {
    const { placed, skippedInfra, unknownIds } = isl.summary;
    const unknown = unknownIds.length > 0
      ? `<span style="color:#f39c12;font-size:0.72rem;">${unknownIds.length} unknown entity IDs</span>`
      : '';
    const typeTag = `<span style="color:${isl.type === 'tropical' ? '#27ae60' : '#3498db'};font-size:0.72rem;">${isl.type}</span>`;
    const popLine = _formatImportedPopCountsLine(isl.popCounts);
    return `<div style="padding:4px 0;border-bottom:1px solid #1e3a5f;font-size:0.8rem;color:#ccc;">
      <strong style="color:#e0e0e0;">${_escSaveImportHtml(isl.name || '(unnamed)')}</strong>
      &nbsp;${typeTag}
      &nbsp;<span style="color:#888;">${isl.island.width}×${isl.island.height}</span>
      &nbsp;·&nbsp;${placed} entities placed, ${skippedInfra} skipped
      ${unknown ? '&nbsp;· ' + unknown : ''}
      <div style="font-size:0.72rem;color:#9aa;margin-top:4px;">Houses: ${popLine}</div>
    </div>`;
  }).join('');

  const warnHtml = warnings.length
    ? `<div style="margin:10px 0;padding:8px 10px;background:#2c1a0e;border-radius:4px;font-size:0.75rem;color:#f39c12;max-height:80px;overflow-y:auto;">
        ${warnings.map(w => `• ${w}`).join('<br>')}
      </div>`
    : '';

  const currentProject = isMultiIslandProject()
    ? `<p style="color:#e74c3c;font-size:0.8rem;margin:8px 0;">
        ⚠ This will replace your current project (${state.projectSlots.length} island slots).
      </p>`
    : '';

  overlay.innerHTML = `
    <div style="background:#0d1117;border:1px solid #1e3a5f;border-radius:8px;
                padding:20px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto;">
      <h2 style="margin:0 0 12px;color:#e94560;font-size:1.1rem;">Import from PP2 Save</h2>
      <p style="color:#888;font-size:0.8rem;margin:0 0 10px;">
        Save version ${version || '?'} ·
        <strong style="color:#ccc;">${islands.length} island${islands.length !== 1 ? 's' : ''}</strong>
        found
        (${tempCount} temperate, ${tropCount} tropical)
      </p>
      ${shipFleetHtml}
      <div style="max-height:260px;overflow-y:auto;margin-bottom:8px;">${islandRows}</div>
      ${warnHtml}
      ${currentProject}
      <p style="color:#888;font-size:0.73rem;margin:8px 0 14px;">
        Terrain, deposits, and buildings are imported; fleet (Type 2/3/4 → caravel/hulk/pinnace) and house counts fill planner inputs for the first island.
        Rivers and coastal tiles are not stored in the save — paint them manually if needed.
        Fertilities are inferred from field tiles present on each island.
      </p>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="save-import-cancel" class="header-btn" style="border-color:#555;color:#aaa;background:transparent;">Cancel</button>
        <button id="save-import-confirm" class="header-btn" style="background:#1e3a2f;border-color:#2ecc71;color:#2ecc71;">
          Import ${islands.length} island${islands.length !== 1 ? 's' : ''}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#save-import-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#save-import-confirm').addEventListener('click', () => {
    overlay.remove();
    applyPP2SaveImport(parsedData);
  });
}

function triggerSaveFileImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.dat,.json,.txt';
  input.style.display = 'none';
  document.body.appendChild(input);

  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    input.remove();
    if (!file) return;

    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target.result;
      const parsed = parsePP2SaveFile(text);
      if (!parsed.islands || parsed.islands.length === 0) {
        alert(
          'No importable islands found in this file.\n\n' +
          (parsed.warnings.length ? parsed.warnings.join('\n') : 'Unknown error.')
        );
        return;
      }
      showSaveImportModal(parsed);
    };
    reader.onerror = () => alert('Could not read file.');
    reader.readAsText(file);
  });

  input.click();
}

function initSaveImport() {
  const btn = document.getElementById('btn-import-save');
  if (btn) btn.addEventListener('click', triggerSaveFileImport);
}
