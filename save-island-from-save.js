// ===== RECONSTRUCT PLANNER ISLAND FROM SAVE JSON =====
// Shared by save-import.js (browser) and scripts/parse-pp2-save.mjs (Node via createRequire).
// Depends on: buildings.js getBuildingData, island.js FERTILITY_RESOURCES (browser only for fertilities).

/** Grid.Type 3 + DepositType integer → planner deposit string. */
const SAVE_DEPOSIT_TYPE_INT = {
  1: 'copper_deposit',
  2: 'iron_deposit',
  3: 'coal_deposit',
  4: 'clay_deposit',
  5: 'rock_salt_deposit',
  6: 'marble_deposit',
  7: 'gold_deposit',
  8: 'gemstone_deposit',
  9: 'lead_deposit',
  10: 'zinc_deposit',
  11: 'nitrate_field',
};

const SAVE_REGION_TO_TYPE = {
  1: 'temperate',
  2: 'tropical',
  3: 'northern',
  4: 'tropical',
};

const SAVE_ENTITY_TO_TERRAIN = {
  Forest: 'forest',
  ForestTropical: 'forest',
  ForestNorth: 'forest',
};

const SAVE_ENTITY_TO_DEPOSIT = {
  AppleTrees: 'apple_trees',
  WheatField: 'wheat_field',
  HopsField: 'hop_field',
  HoneyField: 'honey_field',
  PotatoField: 'potato_field',
  StrawberryField: 'strawberry_field',
  StrawberryBush: 'strawberry_field',
  GrapeVines: 'vineyard',
  GrapeVine: 'vineyard',
  Vineyard: 'vineyard',
  RoseField: 'rose_field',
  RoseBush: 'rose_field',
  LinseedField: 'linseed_field',
  TeaField: 'tea_field',
  SugarCaneField: 'sugar_cane_field',
  CoffeeField: 'coffee_bean_field',
  CoffeeBeanField: 'coffee_bean_field',
  TobaccoField: 'tobacco_field',
  CacaoField: 'cacao_field',
  CoconutPalm: 'coconut_palm',
  MahoganyTrees: 'mahogany_trees',
  MahoganyTree: 'mahogany_trees',
  IndigoField: 'indigo_field',
  MulberryBush: 'mulberry_trees',
  MulberryTrees: 'mulberry_trees',
  CopperDeposit: 'copper_deposit',
  IronDeposit: 'iron_deposit',
  CoalDeposit: 'coal_deposit',
  ClayDeposit: 'clay_deposit',
  RockSaltDeposit: 'rock_salt_deposit',
  MarbleDeposit: 'marble_deposit',
  GoldDeposit: 'gold_deposit',
  GemstoneDeposit: 'gemstone_deposit',
  LeadDeposit: 'lead_deposit',
  ZincDeposit: 'zinc_deposit',
  NitrateField: 'nitrate_field',
  HopField: 'hop_field',
  Weir: 'weir',
  SpermWhale: 'sperm_whale_swarm',
};

const SAVE_BUILDING_ID_REMAP = {
  House0Pioneers: 'PioneersHut',
  House1Colonists: null,
  House2Townsmen: null,
  House3Farmers: null,
  House4Merchants: null,
  House5Workers: null,
  House6Paragons: null,
  Fisherman: 'FishermansHut',
  BeachFisherman: 'BeachFishermansHut',
  SalmonFisherman: 'SalmonFishermansHut',
  CattleFarm: 'CattleRanch',
  HorseFarm: 'HorseBreeder',
  Garrison0: 'Garrison',
  Garrison1: 'Garrison',
  Kontor1: null,
  PortalIn0: null,
  PortalOut0: null,
  Garrison: null,
};

const SAVE_SKIP_ENTITY_IDS = new Set([
  'Kontor1',
  'Kontor2',
  'PortalIn0',
  'PortalOut0',
  'CopperDeposit',
  'IronDeposit',
  'CoalDeposit',
  'ClayDeposit',
  'RockSaltDeposit',
  'MarbleDeposit',
  'GoldDeposit',
  'GemstoneDeposit',
  'LeadDeposit',
  'ZincDeposit',
  'NitrateField',
]);

function inferFertilitiesFromIsland(island, islandType) {
  const fertList =
    typeof FERTILITY_RESOURCES !== 'undefined' ? FERTILITY_RESOURCES[islandType] || [] : [];

  const presentTileRes = new Set();
  for (const row of island.cells) {
    for (const cell of row) {
      if (cell.deposit) presentTileRes.add(cell.deposit);
    }
  }

  const ids = [];
  for (const f of fertList) {
    if (f.tileResources.some(tr => presentTileRes.has(tr))) ids.push(f.id);
  }
  return ids;
}

/**
 * @param {object} si - Raw island object from save (Name, MapSettings, Grid, GameEntities)
 * @param {{ getBuildingData: function, warnings?: string[] }} options
 * @returns {{ name: string, type: string, island: object, activeFertilities: string[], summary: object, popCounts: object }}
 */
function buildPlannerIslandFromSaveIsland(si, options) {
  const getBuildingDataFn = options && options.getBuildingData;
  const warnings = (options && options.warnings) || [];

  const name = si.Name || '';
  const mapSettings = si.MapSettings || {};
  const regionInt = mapSettings.Region || 1;
  const type = SAVE_REGION_TO_TYPE[regionInt] || 'temperate';

  const [w, h] = Array.isArray(mapSettings.MapSize) ? mapSettings.MapSize : [20, 20];

  const island = { width: w, height: h, cells: [], buildings: [] };
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) row.push({ terrain: 'grass', deposit: null, building: null });
    island.cells.push(row);
  }

  const grid = Array.isArray(si.Grid) ? si.Grid : [];
  for (const tile of grid) {
    const [tx, ty] = Array.isArray(tile.Coordinate) ? tile.Coordinate : [-1, -1];
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
    const cell = island.cells[ty][tx];
    if (tile.Type === 2) {
      cell.terrain = 'water';
    } else if (tile.Type === 3) {
      if (tile.DepositType != null) {
        const depositId = SAVE_DEPOSIT_TYPE_INT[tile.DepositType];
        if (depositId) {
          cell.deposit = depositId;
        } else {
          warnings.push(`Unknown DepositType int ${tile.DepositType} on ${name}`);
        }
      }
    }
    if (tile.IsRiver === true && cell.terrain !== 'water') {
      cell.terrain = 'river';
    }
  }

  const entities = Array.isArray(si.GameEntities) ? si.GameEntities : [];
  const summary = { placed: 0, skippedInfra: 0, unknownIds: [] };
  const seenUnknown = new Set();
  const popCounts = {};

  const SAVE_HOUSE_TO_POP_ID = {
    House0Pioneers: 'PopulationPioneersHut',
    House1Colonists: 'PopulationColonistsHouse',
    House2Townsmen: 'PopulationTownsmenHouse',
    House3Farmers: 'PopulationFarmersShack',
    House4Merchants: 'PopulationMerchantsMansion',
    House5Workers: 'PopulationWorkersHouse',
    House6Paragons: 'PopulationParagonsResidence',
  };

  for (const entity of entities) {
    const id = entity.id;
    if (!id) continue;
    const [ex, ey] = Array.isArray(entity.xy) ? entity.xy : [-1, -1];

    if (Object.prototype.hasOwnProperty.call(SAVE_HOUSE_TO_POP_ID, id)) {
      const popId = SAVE_HOUSE_TO_POP_ID[id];
      popCounts[popId] = (popCounts[popId] || 0) + 1;
    }

    if (Object.prototype.hasOwnProperty.call(SAVE_ENTITY_TO_TERRAIN, id)) {
      if (ex >= 0 && ey >= 0 && ex < w && ey < h) {
        island.cells[ey][ex].terrain = SAVE_ENTITY_TO_TERRAIN[id];
        summary.placed++;
      }
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(SAVE_ENTITY_TO_DEPOSIT, id)) {
      if (ex >= 0 && ey >= 0 && ex < w && ey < h) {
        const c = island.cells[ey][ex];
        if (!c.deposit) c.deposit = SAVE_ENTITY_TO_DEPOSIT[id];
        summary.placed++;
      }
      continue;
    }

    if (SAVE_SKIP_ENTITY_IDS.has(id)) {
      summary.skippedInfra++;
      continue;
    }

    let buildingId;
    if (Object.prototype.hasOwnProperty.call(SAVE_BUILDING_ID_REMAP, id)) {
      buildingId = SAVE_BUILDING_ID_REMAP[id];
      if (buildingId === null) {
        summary.skippedInfra++;
        continue;
      }
    } else {
      buildingId = id;
    }

    const bData = typeof getBuildingDataFn === 'function' ? getBuildingDataFn(buildingId) : null;
    if (!bData) {
      if (!seenUnknown.has(id)) {
        seenUnknown.add(id);
        summary.unknownIds.push(id);
      }
      continue;
    }

    if (ex < 0 || ey < 0 || ex >= w || ey >= h) continue;
    island.cells[ey][ex].building = buildingId;
    island.buildings.push({ id: buildingId, x: ex, y: ey, uid: ex * 10000 + ey });
    summary.placed++;
  }

  const activeFertilities = inferFertilitiesFromIsland(island, type);

  return { name, type, island, activeFertilities, summary, popCounts };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildPlannerIslandFromSaveIsland,
    SAVE_DEPOSIT_TYPE_INT,
    SAVE_REGION_TO_TYPE,
  };
}
