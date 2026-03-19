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
  { id: 'wheat_field', name: 'Wheat Field', color: '#fdd835' },
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

// ===== APPLICATION STATE =====
const state = {
  island: null,     // { width, height, cells: 2D array }
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
