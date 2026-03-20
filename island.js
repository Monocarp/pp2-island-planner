// ===== TERRAIN TYPES =====
const TERRAIN_COLORS = {
  grass:    '#3a7d44',
  water:    '#1a6eb0',
  river:    '#2e86c1',
  coastal:  '#4db8c9',
  forest:   '#1e5631',
  empty:    '#0d1117',
};

const DEPOSIT_TYPES = [
  { id: 'copper_deposit', name: 'Copper', color: '#c87533' },
  { id: 'coal_deposit', name: 'Coal', color: '#2c2c2c' },
  { id: 'iron_deposit', name: 'Iron', color: '#8b4513' },
  { id: 'rock_salt_deposit', name: 'Rock Salt', color: '#d4c5a9' },
  { id: 'clay_deposit', name: 'Clay', color: '#b87040' },
  { id: 'cliff', name: 'Cliff', color: '#9e9e9e' },
  { id: 'marble_deposit', name: 'Marble', color: '#d0d0d0' },
  { id: 'gold_deposit', name: 'Gold', color: '#ffd700' },
  { id: 'gemstone_deposit', name: 'Gemstone', color: '#9b59b6' },
  { id: 'lead_deposit', name: 'Lead', color: '#708090' },
  { id: 'zinc_deposit', name: 'Zinc', color: '#a0b0c0' },
  { id: 'nitrate_field', name: 'Nitrate', color: '#c8e6c9' },
  { id: 'hop_field', name: 'Hop Field', color: '#7cb342' },
  { id: 'honey_field', name: 'Honey Field', color: '#ffc107' },
  { id: 'wheat_field', name: 'Wheat Field', color: '#fdd835' },
  { id: 'potato_field', name: 'Potato Field', color: '#d4a574' },
  { id: 'linseed_field', name: 'Linseed Field', color: '#81d4fa' },
  { id: 'strawberry_field', name: 'Strawberry', color: '#ef5350' },
  { id: 'apple_trees', name: 'Apple Trees', color: '#66bb6a' },
  { id: 'vineyard', name: 'Vineyard', color: '#8e24aa' },
  { id: 'rose_field', name: 'Rose Field', color: '#f06292' },
  { id: 'sugar_beet_field', name: 'Sugar Beet', color: '#8d6e63' },
  { id: 'sperm_whale_swarm', name: 'Whale Swarm', color: '#4a697b' },
  { id: 'weir', name: 'Weir', color: '#00897b' },
  // Tropical field / tree tiles (fertility-gated on tropical islands)
  { id: 'tea_field', name: 'Tea Field', color: '#558b2f' },
  { id: 'sugar_cane_field', name: 'Sugar Cane Field', color: '#9ccc65' },
  { id: 'coffee_bean_field', name: 'Coffee Bean Field', color: '#6d4c41' },
  { id: 'tobacco_field', name: 'Tobacco Field', color: '#bcaaa4' },
  { id: 'cacao_field', name: 'Cacao Field', color: '#5d4037' },
  { id: 'coconut_palm', name: 'Coconut Palm', color: '#2e7d32' },
  { id: 'mahogany_trees', name: 'Mahogany Trees', color: '#8d4a3c' },
  { id: 'indigo_field', name: 'Indigo Field', color: '#283593' },
  { id: 'mulberry_trees', name: 'Mulberry Trees', color: '#ad1457' },
  // Regional mine / geology variants (PP2DATA tiles — paintable; fertility rules still apply if gated)
  { id: 'coal_deposit_tropical', name: 'Coal (tropical)', color: '#1a1a1a' },
  { id: 'coal_deposit_north', name: 'Coal (north)', color: '#252525' },
  { id: 'gold_deposit_tropical', name: 'Gold (tropical)', color: '#e6c200' },
  { id: 'gold_deposit_north', name: 'Gold (north)', color: '#f0d030' },
  { id: 'ironstone_deposit', name: 'Ironstone', color: '#5d4037' },
  { id: 'river_tropical', name: 'River (tropical tile)', color: '#2874a6' },
  { id: 'river_north', name: 'River (north tile)', color: '#5dade2' },
  { id: 'coastal_tropical', name: 'Coastal (tropical tile)', color: '#48c9b0' },
  { id: 'coastal_north', name: 'Coastal (north tile)', color: '#76d7c4' },
  { id: 'grass_north', name: 'Grass (north tile)', color: '#2e7d32' },
];

/** Label + color for map/stats; unknown ids fall back to PP2DATA name + neutral color. */
function getDepositPaintStyle(depId) {
  if (!depId) return null;
  const known = DEPOSIT_TYPES.find(d => d.id === depId);
  if (known) return { name: known.name, color: known.color };
  const name =
    typeof PP2DATA !== 'undefined' && typeof PP2DATA.getResourceName === 'function'
      ? PP2DATA.getResourceName(depId)
      : depId;
  return { name, color: '#5c5c6e' };
}

// ===== TILE RESOURCE IDs (terrain tiles that buildings need within footprint) =====
const TILE_RESOURCE_IDS = new Set();
PP2DATA.tiles.forEach(t => TILE_RESOURCE_IDS.add(t.produces));

/**
 * Per-island-type fertilities: each gates tile resources that cannot be grown / auto-painted when off.
 * See `fertilities` on ISLAND_TYPE_TIERS for default id lists.
 */
const FERTILITY_RESOURCES = {
  temperate: [
    { id: 'apples', label: 'Apples', tileResources: ['apple_trees'] },
    { id: 'wheat', label: 'Wheat', tileResources: ['wheat_field'] },
    { id: 'hops', label: 'Hops', tileResources: ['hop_field'] },
    { id: 'potatoes', label: 'Potatoes', tileResources: ['potato_field'] },
    { id: 'strawberries', label: 'Strawberries', tileResources: ['strawberry_field'] },
    { id: 'honey', label: 'Honey', tileResources: ['honey_field'] },
    { id: 'roses', label: 'Roses', tileResources: ['rose_field'] },
    { id: 'grapes', label: 'Grapes', tileResources: ['vineyard'] },
  ],
  tropical: [
    { id: 'tea', label: 'Tea', tileResources: ['tea_field'] },
    { id: 'sugar_cane', label: 'Sugar cane', tileResources: ['sugar_cane_field'] },
    { id: 'coffee', label: 'Coffee', tileResources: ['coffee_bean_field'] },
    { id: 'tobacco', label: 'Tobacco', tileResources: ['tobacco_field'] },
    { id: 'cocoa', label: 'Cocoa', tileResources: ['cacao_field'] },
    { id: 'coconuts', label: 'Coconuts', tileResources: ['coconut_palm'] },
    { id: 'mahogany', label: 'Mahogany', tileResources: ['mahogany_trees'] },
    { id: 'indigo', label: 'Indigo', tileResources: ['indigo_field'] },
    { id: 'silk', label: 'Silk', tileResources: ['mulberry_trees'] },
  ],
  northern: [],
  magical: [],
};

/**
 * True if this tile resource cannot be grown/placed on the current island:
 * not listed in any fertility set → allowed; listed for current type and active → allowed;
 * otherwise blocked (inactive fertility on this type, or wrong climate / other island type only).
 */
function isTileResourceFertilityBlocked(tileResId) {
  let gatedAnywhere = false;
  for (const [type, list] of Object.entries(FERTILITY_RESOURCES)) {
    if (!list) continue;
    for (const f of list) {
      if (!f.tileResources.includes(tileResId)) continue;
      gatedAnywhere = true;
      if (type === state.islandType && state.activeFertilities.has(f.id)) return false;
    }
  }
  return gatedAnywhere;
}

/** Default fertility IDs for the effective island type config. */
function getDefaultFertilityIds() {
  const cfg = getIslandTypeConfig();
  if (cfg.fertilities && cfg.fertilities.length > 0) return cfg.fertilities.slice();
  const list = FERTILITY_RESOURCES[state.islandType];
  return (list || []).map(f => f.id);
}

/** Reset active fertilities to all enabled for current island type (e.g. after switching type). */
function resetActiveFertilitiesToDefaults() {
  state.activeFertilities = new Set(getDefaultFertilityIds());
}

/** Default fertility id list for a fixed archetype (temperate / tropical), ignoring current state. */
function getDefaultFertilityIdsForArchetype(archetype) {
  const cfg = ISLAND_TYPE_TIERS[archetype];
  if (cfg && cfg.fertilities && cfg.fertilities.length > 0) return cfg.fertilities.slice();
  const list = FERTILITY_RESOURCES[archetype];
  return (list || []).map(f => f.id);
}

/**
 * Active fertilities for a project slot as a Set (chain + placement logic).
 * - Non-empty array: use exactly those ids (user configuration).
 * - Empty array: none active — do NOT substitute archetype defaults (avoids "both islands self-sufficient"
 *   in multi-island analyze when [] was stored or all unchecked).
 * - Missing / non-array: full defaults for that slot type (new slot or legacy payload).
 */
function effectiveSlotFertilitySet(slot) {
  if (!slot) return new Set();
  const archetype = slot.type === 'tropical' ? 'tropical' : 'temperate';
  let raw = slot.activeFertilities;
  if (raw instanceof Set) raw = [...raw];
  if (Array.isArray(raw)) {
    if (raw.length > 0) return new Set(raw);
    return new Set();
  }
  return new Set(getDefaultFertilityIdsForArchetype(archetype));
}

const PROJECT_LAYOUT_VERSION = 1;

function deepCloneIsland(island) {
  return island ? JSON.parse(JSON.stringify(island)) : null;
}

/** True when using multi-island project mode (counts + slots from localStorage). */
function isMultiIslandProject() {
  return Array.isArray(state.projectSlots) && state.projectSlots.length > 0;
}

/** Whether a slot’s grid has anything worth confirming before delete. */
function islandLayoutHasContent(island) {
  if (!island || !island.cells) return false;
  if (island.buildings && island.buildings.length > 0) return true;
  for (const row of island.cells) {
    for (const cell of row) {
      if (cell.building || cell.deposit) return true;
      if (cell.terrain && cell.terrain !== 'grass') return true;
    }
  }
  return false;
}

/** Production / population tier sets allowed per island archetype. `magical` is reserved (null). */
const ISLAND_TYPE_TIERS = {
  temperate: {
    prodTiers: ['Pioneers', 'Colonists', 'Townsmen', 'Merchants', 'Paragons'],
    popTiers: ['Pioneers', 'Colonists', 'Townsmen', 'Merchants', 'Paragons'],
    fertilities: ['apples', 'wheat', 'hops', 'potatoes', 'strawberries', 'honey', 'roses', 'grapes'],
  },
  tropical: {
    prodTiers: ['Farmers', 'Workers'],
    popTiers: ['Farmers', 'Workers'],
    fertilities: [
      'tea', 'sugar_cane', 'coffee', 'tobacco', 'cocoa', 'coconuts', 'mahogany', 'indigo', 'silk',
    ],
  },
  northern: {
    prodTiers: ['Northern Islands'],
    popTiers: [],
    fertilities: [],
  },
  magical: null,
};

const VALID_ISLAND_TYPES = new Set(['temperate', 'tropical', 'northern', 'magical']);

/** Effective config for planner + palette; invalid or unfinished types fall back to temperate. */
function getIslandTypeConfig() {
  const key = state.islandType;
  const c = ISLAND_TYPE_TIERS[key];
  if (c && Array.isArray(c.prodTiers)) return c;
  return ISLAND_TYPE_TIERS.temperate;
}

// ===== APPLICATION STATE =====
const state = {
  island: null,     // { width, height, cells: 2D array }
  /** temperate | tropical | northern | magical (magical stub — use temperate behaviour until data exists) */
  islandType: 'temperate',
  tool: 'select',   // current tool
  terrainType: null, // if tool=terrain
  depositType: null, // if tool=deposit
  buildingId: null,  // if placing a building
  zoom: 30,
  panX: 0, panY: 0,
  isPanning: false,
  dragStart: null,
  undoStack: [],
  redoStack: [],
  hoveredCell: null,
  unlockedBuildings: new Set(), // building IDs the user has unlocked
  savedIslands: [],  // localStorage saves
  plannerActive: false, // auto-refresh planner on stats update
  producerOverrides: {}, // resourceId -> preferred producerId
  /** { id, count }[] — extra production buildings to include in chain + auto-place */
  customBuildingEntries: [],
  /** { unitResId, ratePerHour }[] — military unit production targets for chain + auto-place */
  militaryEntries: [],
  /** Set of fertility IDs active for the current island (temperate: apples, wheat, …). */
  activeFertilities: new Set([
    'apples', 'wheat', 'hops', 'potatoes', 'strawberries', 'honey', 'roses', 'grapes',
  ]),
  /** Multi-island project: counts from setup modal (redundant with slots.length but stored for UI). */
  projectTemperateCount: 0,
  projectTropicalCount: 0,
  /** { type: 'temperate'|'tropical', island: object|null, activeFertilities: string[] }[] — temperate slots first. */
  projectSlots: [],
  activeSlotIndex: 0,
  /** Regional fleet: ship id -> count (project-wide, not per slot). */
  projectShipCounts: {},
};

// Cell data: { terrain, deposit, building, buildingId (for placed buildings back-ref) }
function createCell(terrain = 'grass') {
  return { terrain, deposit: null, building: null };
}

// ===== ISLAND CREATION =====
function createIsland(width, height) {
  const cells = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      row.push(createCell('grass'));
    }
    cells.push(row);
  }
  return { width, height, cells, buildings: [] };
}

// buildings array entry: { id: buildingId, x, y, uniqueId }
let nextBuildingUid = 1;
