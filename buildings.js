// ===== FOOTPRINT DEFINITIONS =====
const FOOTPRINTS = {};

function makeSquare(size) {
  const cells = [];
  const half = Math.floor(size / 2);
  for (let dy = -half; dy <= half; dy++)
    for (let dx = -half; dx <= half; dx++)
      cells.push([dx, dy]);
  return cells;
}

function makeDiamond(rowWidths) {
  const cells = [];
  const halfH = Math.floor(rowWidths.length / 2);
  for (let i = 0; i < rowWidths.length; i++) {
    const dy = i - halfH;
    const w = rowWidths[i];
    const halfW = Math.floor(w / 2);
    for (let dx = -halfW; dx <= halfW; dx++)
      cells.push([dx, dy]);
  }
  return cells;
}

function makePlus() {
  // 3 tall center column + 1 left/right at middle
  return [[0,-1],[0,0],[0,1],[-1,0],[1,0]];
}

// 1x1
['CopperMine','Forest','Garrison','Garrison2','Garrison3',
 'HoneyField','HopField','LinseedField','PioneersHut','Portal','PotatoField',
 'StrawberryField','WheatField'].forEach(id => FOOTPRINTS[id] = [[0,0]]);

// 3x3
['Arboretum','Beekeeper','CattleRanch','CiderMaker','FishermansHut',
 'LinseedFarm','Lumberjack','PigRanch','PotatoFarm','Warehouse1','WheatFarm'].forEach(id => FOOTPRINTS[id] = makeSquare(3));

// 5x5
['AshHouse','Bakery','BoilerMaker','BoilingHouse','Bowyer','Brewery',
 'CloakTailoring','CopperArmory','CopperAxesmith','CopperSmelter',
 'FlourMill','FlourWindmill','Furriery','HopFarm','LimeKiln',
 'LinenWeaver','Longbowyer','Malthouse','Medicus','MortarBatchWorks',
 'RenderingWorks','Ropery','Sailmaker','SaltWorks','SausageMaker',
 'Sawmill','SawWorks','SoapMaker','StrawberryFarm','Tannery',
 'TextileFactory','Weaver'].forEach(id => FOOTPRINTS[id] = makeSquare(5));

// 9x9
FOOTPRINTS['Cistern'] = makeSquare(9);

// 11x11
FOOTPRINTS['HarborTavern'] = makeSquare(11);

// Plus shape
['AppleTrees','Piggery','SheepFarm','Stonecutter'].forEach(id => FOOTPRINTS[id] = makePlus());

// Diamond 3-5-5-5-3
['ArcheryRange','Barracks','BerserkerHall','BootCamp',
 'HorseBreeder','LongbowArcheryRange','RidingArena','Well'].forEach(id => FOOTPRINTS[id] = makeDiamond([3,5,5,5,3]));

// Diamond 1-3-5-3-1
FOOTPRINTS['Warehouse2'] = makeDiamond([1,3,5,3,1]);

// Diamond 3-5-7-7-7-5-3
['Forester','Tavern'].forEach(id => FOOTPRINTS[id] = makeDiamond([3,5,7,7,7,5,3]));

// Diamond 5-7-7-7-7-7-5
['Shipyard','SmallShipyard'].forEach(id => FOOTPRINTS[id] = makeDiamond([5,7,7,7,7,7,5]));

// Diamond 1-3-5-7-5-3-1
['School','Warehouse3'].forEach(id => FOOTPRINTS[id] = makeDiamond([1,3,5,7,5,3,1]));

// ===== NON-PRODUCTION BUILDINGS (not in data.js) =====
// These are infrastructure buildings that don't produce resources.
const EXTRA_BUILDINGS = [
  { id: 'Warehouse1', name: 'Small Warehouse', tier: 'Pioneers', produces: null, isInfrastructure: true },
  { id: 'Warehouse2', name: 'Warehouse', tier: 'Colonists', produces: null, isInfrastructure: true },
  { id: 'Warehouse3', name: 'Large Warehouse', tier: 'Townsmen', produces: null, isInfrastructure: true },
  { id: 'Well', name: 'Well', tier: 'Pioneers', produces: null, isService: true },
  { id: 'Cistern', name: 'Cistern', tier: 'Colonists', produces: null, isService: true },
  { id: 'School', name: 'School', tier: 'Townsmen', produces: null, isService: true },
  { id: 'Tavern', name: 'Tavern', tier: 'Pioneers', produces: null, isService: true },
  { id: 'HarborTavern', name: 'Harbor Tavern', tier: 'Colonists', produces: null, isService: true },
  { id: 'SmallShipyard', name: 'Small Shipyard', tier: 'Colonists', produces: null, isInfrastructure: true },
  { id: 'Shipyard', name: 'Shipyard', tier: 'Townsmen', produces: null, isInfrastructure: true },
];

// Combined lookup: merge PP2DATA building with EXTRA_BUILDINGS flags
function getBuildingData(id) {
  const b = PP2DATA.getBuilding(id);
  const extra = EXTRA_BUILDINGS.find(e => e.id === id);
  if (b && extra) {
    const merged = { ...b };
    if (extra.isService) merged.isService = true;
    if (extra.isInfrastructure) merged.isInfrastructure = true;
    return merged;
  }
  return b || extra || null;
}

// ===== TERRAIN PLACEMENT RULES =====
// Which terrains a building can be placed on.
// By default, buildings can only go on grass or forest.
// Special cases are handled via LOCATION_REQUIREMENTS.
const PLACEABLE_TERRAIN = new Set(['grass', 'forest']);

function canPlaceOnTerrain(buildingId, terrain) {
  const locReq = LOCATION_REQUIREMENTS[buildingId];
  // Water-wheel buildings go ON river
  if (locReq && locReq.type === 'straight_river') return terrain === 'river';
  // In-water buildings go on water/coastal
  if (locReq && locReq.type === 'in_water_coastal') return terrain === 'water' || terrain === 'coastal';
  // Default: only placeable terrain (excludes water and river)
  return PLACEABLE_TERRAIN.has(terrain);
}

// ===== BUILDING LOCATION REQUIREMENTS =====
// Requirement types:
//   ocean_adjacent  - at least one adjacent cell (4-dir) must be water terrain
//   straight_river  - building cell itself must be river terrain (water-wheel)
//   river_adjacent  - at least one adjacent cell (4-dir) must be river terrain
//   in_water_coastal - building must be placed on water, adjacent to non-water land
const LOCATION_REQUIREMENTS = {
  // === Ocean adjacency (trade/harbor buildings) ===
  HarborTavern:            { type: 'ocean_adjacent', label: 'Must be next to ocean' },
  SmallShipyard:           { type: 'ocean_adjacent', label: 'Must be next to ocean' },
  Shipyard:                { type: 'ocean_adjacent', label: 'Must be next to ocean' },

  // === Straight river / water-wheel buildings ===
  Sawmill:                 { type: 'straight_river', label: 'Needs straight river (water wheel)' },
  FlourMill:               { type: 'straight_river', label: 'Needs straight river (water wheel)' },
  MortarBatchWorks:        { type: 'straight_river', label: 'Needs straight river (water wheel)' },
  TextileFactory:          { type: 'straight_river', label: 'Needs straight river (water wheel)' },
  FeltmakingMill:          { type: 'straight_river', label: 'Needs straight river (water wheel)' },
  IronArmory:              { type: 'straight_river', label: 'Needs straight river (water wheel)' },
  CrossbowMaker:           { type: 'straight_river', label: 'Needs straight river (water wheel)' },
  SteelFurnace:            { type: 'straight_river', label: 'Needs straight river (water wheel)' },
  Armorsmith:              { type: 'straight_river', label: 'Needs straight river (water wheel)' },
  PaperMill:               { type: 'straight_river', label: 'Needs straight river (water wheel)' },
  PlaningMill:             { type: 'straight_river', label: 'Needs straight river (water wheel)' },
  PowderMill:              { type: 'straight_river', label: 'Needs straight river (water wheel)' },
  CannonFoundry:           { type: 'straight_river', label: 'Needs straight river (water wheel)' },
  Winepress:               { type: 'straight_river', label: 'Needs straight river (water wheel)' },
  BrocadeSpinningFactory:  { type: 'straight_river', label: 'Needs straight river (water wheel)' },
  MusketMaker:             { type: 'straight_river', label: 'Needs straight river (water wheel)' },
  SugarMill:               { type: 'straight_river', label: 'Needs straight river (water wheel)' },
  SpinningMill:            { type: 'straight_river', label: 'Needs straight river (water wheel)' },
  SilkTwineMill:           { type: 'straight_river', label: 'Needs straight river (water wheel)' },
  GoldPanner:              { type: 'straight_river', label: 'Needs straight river (water wheel)' },

  // === River adjacency (general, not water-wheel) ===
  Tannery:                 { type: 'river_adjacent', label: 'Must be next to a river' },

  // === In water next to beach ===
  SalmonFishermansHut:     { type: 'in_water_coastal', label: 'Must be in water next to beach' },

  // === Cannot be on mountain ===
  // (mountain terrain removed; cliff is now a deposit on grass)
};

// Helper: get terrain at a position, treating out-of-bounds as ocean water
function getTerrainAt(x, y) {
  if (!state.island) return 'water';
  const { width, height, cells } = state.island;
  if (x < 0 || x >= width || y < 0 || y >= height) return 'water';
  return cells[y][x].terrain;
}

// Helper: get 4-directional neighbors (includes out-of-bounds positions)
function getAdjacentCells(x, y, width, height) {
  return [
    { x: x-1, y },
    { x: x+1, y },
    { x, y: y-1 },
    { x, y: y+1 },
  ];
}

// ===== RIVER SHAPE DETECTION =====
// Returns: 'straight_h', 'straight_v', 'bend', 'junction', 'endpoint', 'isolated'
function getRiverShape(x, y) {
  if (!state.island) return 'isolated';
  const { width, height, cells } = state.island;
  if (x < 0 || x >= width || y < 0 || y >= height) return null;
  if (cells[y][x].terrain !== 'river') return null;

  const left  = getTerrainAt(x-1, y) === 'river';
  const right = getTerrainAt(x+1, y) === 'river';
  const up    = getTerrainAt(x, y-1) === 'river';
  const down  = getTerrainAt(x, y+1) === 'river';
  const count = (left?1:0) + (right?1:0) + (up?1:0) + (down?1:0);

  if (count === 0) return 'isolated';
  if (count === 1) return 'endpoint';
  if (count >= 3)  return 'junction';
  // count === 2
  if ((left && right) || (up && down)) {
    return (left && right) ? 'straight_h' : 'straight_v';
  }
  return 'bend';
}

function isRiverStraight(x, y) {
  const shape = getRiverShape(x, y);
  return shape === 'straight_h' || shape === 'straight_v' || shape === 'endpoint' || shape === 'isolated';
}

// Check if a building can be placed at (x, y) based on location requirements
// Returns { ok: true } or { ok: false, reason: string }
function checkLocationRequirement(buildingId, x, y) {
  const req = LOCATION_REQUIREMENTS[buildingId];
  if (!req) return { ok: true };

  if (!state.island) return { ok: false, reason: 'No island' };
  const { width, height, cells } = state.island;
  const cell = cells[y][x];
  const neighbors = getAdjacentCells(x, y, width, height);

  switch (req.type) {
    case 'ocean_adjacent': {
      const hasOcean = neighbors.some(n => {
        const t = getTerrainAt(n.x, n.y);
        return t === 'water' || t === 'coastal';
      });
      return hasOcean ? { ok: true } : { ok: false, reason: req.label };
    }
    case 'straight_river': {
      // Building must be placed on a straight river tile (water wheel)
      if (cell.terrain !== 'river') {
        return { ok: false, reason: req.label + ' (not a river tile)' };
      }
      if (!isRiverStraight(x, y)) {
        return { ok: false, reason: req.label + ' (river bends here)' };
      }
      return { ok: true };
    }
    case 'river_adjacent': {
      const hasRiver = neighbors.some(n => getTerrainAt(n.x, n.y) === 'river');
      return hasRiver ? { ok: true } : { ok: false, reason: req.label };
    }
    case 'in_water_coastal': {
      // Must be placed ON water AND adjacent to non-water land (beach/coastal)
      if (cell.terrain !== 'water' && cell.terrain !== 'coastal') {
        return { ok: false, reason: req.label + ' (must be on water)' };
      }
      const hasLand = neighbors.some(n => {
        const t = getTerrainAt(n.x, n.y);
        return t !== 'water';
      });
      return hasLand ? { ok: true } : { ok: false, reason: req.label + ' (no adjacent land)' };
    }
    default:
      return { ok: true };
  }
}
