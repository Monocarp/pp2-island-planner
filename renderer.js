// ===== CANVAS RENDERING =====
const canvas = document.getElementById('grid-canvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  const area = document.getElementById('canvas-area');
  canvas.width = area.clientWidth;
  canvas.height = area.clientHeight;
  render();
}

function render() {
  if (!state.island) return;
  const { width, height, cells } = state.island;
  const z = state.zoom;
  const ox = state.panX;
  const oy = state.panY;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw grid cells
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = cells[y][x];
      const px = ox + x * z;
      const py = oy + y * z;

      // Skip offscreen
      if (px + z < 0 || py + z < 0 || px > canvas.width || py > canvas.height) continue;

      // Base terrain color
      let color = TERRAIN_COLORS[cell.terrain] || TERRAIN_COLORS.empty;
      ctx.fillStyle = color;
      ctx.fillRect(px, py, z, z);

      // River shape visualization
      if (cell.terrain === 'river' && z >= 8) {
        const shape = getRiverShape(x, y);
        const cx = px + z / 2;
        const cy = py + z / 2;
        const r = z * 0.35;

        if (shape === 'straight_h' || shape === 'straight_v') {
          // Draw a line through the cell
          ctx.strokeStyle = '#7ec8e3';
          ctx.lineWidth = Math.max(2, z * 0.18);
          ctx.beginPath();
          if (shape === 'straight_h') {
            ctx.moveTo(px, cy); ctx.lineTo(px + z, cy);
          } else {
            ctx.moveTo(cx, py); ctx.lineTo(cx, py + z);
          }
          ctx.stroke();
          ctx.lineWidth = 1;
        } else if (shape === 'bend') {
          // Draw an arc/corner marker
          const left  = x > 0              && cells[y][x-1].terrain === 'river';
          const right = x < width - 1      && cells[y][x+1].terrain === 'river';
          const up    = y > 0              && cells[y-1][x].terrain === 'river';
          const down  = y < height - 1     && cells[y+1][x].terrain === 'river';
          ctx.strokeStyle = '#f39c12';
          ctx.lineWidth = Math.max(2, z * 0.18);
          ctx.beginPath();
          // Draw two segments meeting at center from the neighbor directions
          if (left)  { ctx.moveTo(px, cy); ctx.lineTo(cx, cy); }
          if (right) { ctx.moveTo(cx, cy); ctx.lineTo(px + z, cy); }
          if (up)    { ctx.moveTo(cx, py); ctx.lineTo(cx, cy); }
          if (down)  { ctx.moveTo(cx, cy); ctx.lineTo(cx, py + z); }
          ctx.stroke();
          // Small dot at bend point
          ctx.fillStyle = '#f39c12';
          ctx.beginPath();
          ctx.arc(cx, cy, Math.max(2, z * 0.1), 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = 1;
        } else if (shape === 'junction') {
          // Junction: X mark
          ctx.strokeStyle = '#e74c3c';
          ctx.lineWidth = Math.max(2, z * 0.15);
          const m = z * 0.15;
          ctx.beginPath();
          ctx.moveTo(px + m, py + m); ctx.lineTo(px + z - m, py + z - m);
          ctx.moveTo(px + z - m, py + m); ctx.lineTo(px + m, py + z - m);
          ctx.stroke();
          ctx.lineWidth = 1;
        } else if (shape === 'endpoint') {
          // Single-direction stub line
          const left  = getTerrainAt(x-1, y) === 'river';
          const right = getTerrainAt(x+1, y) === 'river';
          const up    = getTerrainAt(x, y-1) === 'river';
          const down  = getTerrainAt(x, y+1) === 'river';
          ctx.strokeStyle = '#7ec8e3';
          ctx.lineWidth = Math.max(2, z * 0.18);
          ctx.beginPath();
          if (left)       { ctx.moveTo(px, cy); ctx.lineTo(cx, cy); }
          else if (right) { ctx.moveTo(cx, cy); ctx.lineTo(px + z, cy); }
          else if (up)    { ctx.moveTo(cx, py); ctx.lineTo(cx, cy); }
          else if (down)  { ctx.moveTo(cx, cy); ctx.lineTo(cx, py + z); }
          ctx.stroke();
          // Endpoint dot
          ctx.fillStyle = '#7ec8e3';
          ctx.beginPath();
          ctx.arc(cx, cy, Math.max(2, z * 0.08), 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = 1;
        }
        // isolated: no overlay needed, just the base river color
      }

      // Deposit overlay
      if (cell.deposit) {
        const dep = DEPOSIT_TYPES.find(d => d.id === cell.deposit);
        if (dep) {
          ctx.fillStyle = dep.color;
          ctx.globalAlpha = 0.7;
          ctx.fillRect(px + 2, py + 2, z - 4, z - 4);
          ctx.globalAlpha = 1;
        }
      }

      // Building (anchor cell only; selected-building footprint drawn below)
      if (cell.building) {
        ctx.fillStyle = '#e94560';
        ctx.globalAlpha = 0.85;
        ctx.fillRect(px + 1, py + 1, z - 2, z - 2);
        ctx.globalAlpha = 1;
        // Building letter
        if (z >= 16) {
          ctx.fillStyle = '#fff';
          ctx.font = `bold ${Math.max(8, z * 0.4)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const b = getBuildingData(cell.building);
          const letter = b ? b.name[0] : '?';
          ctx.fillText(letter, px + z/2, py + z/2);
        }
      }

      // Grid lines
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.strokeRect(px, py, z, z);
    }
  }

  // Highlight hovered cell
  if (state.hoveredCell) {
    const { x: hx, y: hy } = state.hoveredCell;
    if (hx >= 0 && hx < width && hy >= 0 && hy < height) {
      ctx.strokeStyle = '#e94560';
      ctx.lineWidth = 2;
      ctx.strokeRect(ox + hx * z, oy + hy * z, z, z);
      ctx.lineWidth = 1;

      // Show footprint preview when placing a building
      if (state.tool === 'building' && state.buildingId) {
        // Check location validity for color feedback
        const terrainOk = canPlaceOnTerrain(state.buildingId, cells[hy][hx].terrain);
        const locValid = checkLocationRequirement(state.buildingId, hx, hy);
        const cellOccupied = cells[hy][hx].building;
        const canPlace = terrainOk && locValid.ok && !cellOccupied;
        const fpColor = canPlace ? 'rgba(46,204,113,0.25)' : 'rgba(231,76,60,0.3)';
        const fpStroke = canPlace ? 'rgba(46,204,113,0.5)' : 'rgba(231,76,60,0.6)';
        // Highlight the building cell itself
        ctx.fillStyle = canPlace ? 'rgba(46,204,113,0.4)' : 'rgba(231,76,60,0.5)';
        ctx.fillRect(ox + hx * z, oy + hy * z, z, z);

        const fp = FOOTPRINTS[state.buildingId];
        if (fp) {
          ctx.fillStyle = fpColor;
          ctx.strokeStyle = fpStroke;
          fp.forEach(([dx, dy]) => {
            const fx = hx + dx, fy = hy + dy;
            if (fx >= 0 && fx < width && fy >= 0 && fy < height) {
              ctx.fillRect(ox + fx * z, oy + fy * z, z, z);
              ctx.strokeRect(ox + fx * z, oy + fy * z, z, z);
            }
          });
        }
      }
    }
  }

  // Draw footprint overlay for selected building on grid
  state.island.buildings.forEach(b => {
    if (b === state.selectedBuilding) {
      const fp = FOOTPRINTS[b.id];
      if (fp) {
        ctx.fillStyle = 'rgba(52,152,219,0.15)';
        ctx.strokeStyle = 'rgba(52,152,219,0.4)';
        fp.forEach(([dx, dy]) => {
          const fx = b.x + dx, fy = b.y + dy;
          if (fx >= 0 && fx < width && fy >= 0 && fy < height) {
            ctx.fillRect(ox + fx * z, oy + fy * z, z, z);
            ctx.strokeRect(ox + fx * z, oy + fy * z, z, z);
          }
        });
      }
    }
  });

  // Draw deposit labels if zoomed in enough
  if (z >= 24) {
    ctx.font = `${Math.max(7, z * 0.28)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = cells[y][x];
        if (cell.deposit && !cell.building) {
          const dep = DEPOSIT_TYPES.find(d => d.id === cell.deposit);
          if (dep) {
            const px = ox + x * z;
            const py = oy + y * z;
            ctx.fillStyle = '#fff';
            ctx.fillText(dep.name.substring(0, 3), px + z/2, py + z/2);
          }
        }
      }
    }
  }
}

// ===== PAN/ZOOM =====
function cellFromMouse(e) {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const x = Math.floor((mx - state.panX) / state.zoom);
  const y = Math.floor((my - state.panY) / state.zoom);
  return { x, y };
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const oldZoom = state.zoom;
  const delta = e.deltaY > 0 ? -2 : 2;
  state.zoom = Math.max(10, Math.min(60, state.zoom + delta));
  // Zoom toward cursor
  state.panX = mx - (mx - state.panX) * (state.zoom / oldZoom);
  state.panY = my - (my - state.panY) * (state.zoom / oldZoom);
  document.getElementById('zoom-slider').value = state.zoom;
  document.getElementById('zoom-label').textContent = state.zoom + 'px';
  render();
});

document.getElementById('zoom-slider').addEventListener('input', (e) => {
  state.zoom = parseInt(e.target.value);
  document.getElementById('zoom-label').textContent = state.zoom + 'px';
  render();
});

// ===== MOUSE INTERACTION =====
let isMouseDown = false;
let lastPaintedCell = null;

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    // Middle click or Alt+click = pan
    state.isPanning = true;
    state.dragStart = { x: e.clientX - state.panX, y: e.clientY - state.panY };
    canvas.style.cursor = 'grabbing';
    return;
  }
  if (e.button === 2) return; // handled by contextmenu

  isMouseDown = true;
  const cell = cellFromMouse(e);
  handleCellAction(cell.x, cell.y, e);
  lastPaintedCell = `${cell.x},${cell.y}`;
});

canvas.addEventListener('mousemove', (e) => {
  if (state.isPanning) {
    state.panX = e.clientX - state.dragStart.x;
    state.panY = e.clientY - state.dragStart.y;
    render();
    return;
  }

  const cell = cellFromMouse(e);
  state.hoveredCell = cell;

  // Paint while dragging for terrain/deposit/eraser
  if (isMouseDown && (state.tool === 'terrain' || state.tool === 'deposit' || state.tool === 'eraser')) {
    const key = `${cell.x},${cell.y}`;
    if (key !== lastPaintedCell) {
      handleCellAction(cell.x, cell.y, e);
      lastPaintedCell = key;
    }
  }

  updateCellInfo(cell.x, cell.y);
  render();
});

canvas.addEventListener('mouseup', (e) => {
  if (state.isPanning) {
    state.isPanning = false;
    canvas.style.cursor = '';
    return;
  }
  isMouseDown = false;
  lastPaintedCell = null;
});

canvas.addEventListener('mouseleave', () => {
  state.hoveredCell = null;
  isMouseDown = false;
  state.isPanning = false;
  render();
});

// ===== TOUCH SUPPORT =====
let touchState = { lastTouches: null, isPinching: false, lastTap: 0 };

function cellFromTouch(touch) {
  const rect = canvas.getBoundingClientRect();
  const mx = touch.clientX - rect.left;
  const my = touch.clientY - rect.top;
  const x = Math.floor((mx - state.panX) / state.zoom);
  const y = Math.floor((my - state.panY) / state.zoom);
  return { x, y };
}

function touchDist(t1, t2) {
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function touchMid(t1, t2) {
  return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
}

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const touches = e.touches;
  if (touches.length === 2) {
    // Pinch-zoom start
    touchState.isPinching = true;
    touchState.lastTouches = [touches[0], touches[1]];
    return;
  }
  if (touches.length === 1) {
    touchState.isPinching = false;
    const t = touches[0];
    // Double-tap detection for context menu
    const now = Date.now();
    if (now - touchState.lastTap < 300) {
      const cell = cellFromTouch(t);
      showContextMenu(t.clientX, t.clientY, cell.x, cell.y);
      touchState.lastTap = 0;
      return;
    }
    touchState.lastTap = now;

    if (state.tool === 'select' || state.tool === 'building') {
      // Single tap = action
      const cell = cellFromTouch(t);
      handleCellAction(cell.x, cell.y, {});
    } else {
      // For terrain/deposit/eraser, start painting
      state.isPanning = false;
      isMouseDown = true;
      const cell = cellFromTouch(t);
      handleCellAction(cell.x, cell.y, {});
      lastPaintedCell = `${cell.x},${cell.y}`;
    }
    touchState.lastTouches = [t];
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  const touches = e.touches;
  if (touches.length === 2 && touchState.isPinching && touchState.lastTouches) {
    // Pinch zoom
    const oldDist = touchDist(touchState.lastTouches[0], touchState.lastTouches[1]);
    const newDist = touchDist(touches[0], touches[1]);
    const mid = touchMid(touches[0], touches[1]);
    const rect = canvas.getBoundingClientRect();
    const mx = mid.x - rect.left;
    const my = mid.y - rect.top;
    const scale = newDist / oldDist;
    const oldZoom = state.zoom;
    state.zoom = Math.max(10, Math.min(60, Math.round(state.zoom * scale)));
    state.panX = mx - (mx - state.panX) * (state.zoom / oldZoom);
    state.panY = my - (my - state.panY) * (state.zoom / oldZoom);

    // Also pan with midpoint movement
    const oldMid = touchMid(touchState.lastTouches[0], touchState.lastTouches[1]);
    state.panX += mid.x - oldMid.x;
    state.panY += mid.y - oldMid.y;

    document.getElementById('zoom-slider').value = state.zoom;
    document.getElementById('zoom-label').textContent = state.zoom + 'px';
    touchState.lastTouches = [touches[0], touches[1]];
    render();
    return;
  }
  if (touches.length === 1) {
    const t = touches[0];
    if (touchState.isPinching) return;
    if (state.tool === 'select' || state.tool === 'building') {
      // Single-finger drag = pan
      if (touchState.lastTouches && touchState.lastTouches.length === 1) {
        state.panX += t.clientX - touchState.lastTouches[0].clientX;
        state.panY += t.clientY - touchState.lastTouches[0].clientY;
      }
      touchState.lastTouches = [t];
      render();
    } else {
      // Paint mode drag
      const cell = cellFromTouch(t);
      state.hoveredCell = cell;
      const key = `${cell.x},${cell.y}`;
      if (key !== lastPaintedCell) {
        handleCellAction(cell.x, cell.y, {});
        lastPaintedCell = key;
      }
      touchState.lastTouches = [t];
      render();
    }
  }
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  if (e.touches.length === 0) {
    touchState.isPinching = false;
    touchState.lastTouches = null;
    isMouseDown = false;
    lastPaintedCell = null;
  } else if (e.touches.length === 1) {
    touchState.isPinching = false;
    touchState.lastTouches = [e.touches[0]];
  }
}, { passive: false });

// Right-click context menu
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const cell = cellFromMouse(e);
  showContextMenu(e.clientX, e.clientY, cell.x, cell.y);
});
