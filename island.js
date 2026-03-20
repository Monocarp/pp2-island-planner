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
];

// ===== TILE RESOURCE IDs (terrain tiles that buildings need within footprint) =====
const TILE_RESOURCE_IDS = new Set();
PP2DATA.tiles.forEach(t => TILE_RESOURCE_IDS.add(t.produces));

/**
 * Temperate island fertilities: each gates tile resources that cannot be grown / auto-painted when off.
 * Other island types: populate when tier data is added (see `fertilities` on ISLAND_TYPE_TIERS).
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
  tropical: [],
  northern: [],
  magical: [],
};

/** @returns {boolean} True if this regenerating tile resource cannot be used on the current island (fertility off). */
function isTileResourceFertilityBlocked(tileResId) {
  const list = FERTILITY_RESOURCES[state.islandType];
  if (!list || list.length === 0) return false;
  for (const f of list) {
    if (f.tileResources.includes(tileResId) && !state.activeFertilities.has(f.id)) return true;
  }
  return false;
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
    fertilities: [],
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
