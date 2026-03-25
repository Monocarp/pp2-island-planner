#!/usr/bin/env node
/**
 * Reads data.js via vm (var PP2DATA) and writes data/building_production_fallback.json
 * for save parsers when Timer or OutputResources is missing in saves.
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const dataJs = fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8');
const code = dataJs.replace('const PP2DATA =', 'var PP2DATA =');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(code, ctx);
const PP2 = ctx.PP2DATA;
if (!PP2 || !Array.isArray(PP2.buildings)) {
  console.error('Could not load PP2DATA.buildings from data.js');
  process.exit(1);
}

const byBuildingId = {};
for (const b of PP2.buildings) {
  if (!b || !b.id || b.produces == null) continue;
  byBuildingId[b.id] = {
    iterationTime: b.iterationTime,
    producePerIteration: b.producePerIteration,
    producePerMinute: b.producePerMinute,
    produces: b.produces,
  };
}

const outPath = path.join(ROOT, 'data', 'building_production_fallback.json');
fs.writeFileSync(outPath, JSON.stringify({ version: 1, byBuildingId }, null, 2));
console.log('Wrote', outPath, Object.keys(byBuildingId).length, 'buildings');

/** Mirrors save-import.js terrain + deposit + mineral skip sets (not substring). */
const SAVE_ENTITY_TO_TERRAIN = ['Forest', 'ForestTropical', 'ForestNorth'];
const SAVE_ENTITY_TO_DEPOSIT = [
  'AppleTrees', 'WheatField', 'HopsField', 'HoneyField', 'PotatoField', 'StrawberryField', 'StrawberryBush',
  'GrapeVines', 'GrapeVine', 'Vineyard', 'RoseField', 'RoseBush', 'LinseedField', 'TeaField', 'SugarCaneField',
  'CoffeeField', 'CoffeeBeanField', 'TobaccoField', 'CacaoField', 'CoconutPalm', 'MahoganyTrees', 'MahoganyTree',
  'IndigoField', 'MulberryBush', 'MulberryTrees', 'CopperDeposit', 'IronDeposit', 'CoalDeposit', 'ClayDeposit',
  'RockSaltDeposit', 'MarbleDeposit', 'GoldDeposit', 'GemstoneDeposit', 'LeadDeposit', 'ZincDeposit', 'NitrateField',
  'HopField', 'Weir', 'SpermWhale',
];
const SAVE_SKIP_ENTITY_IDS = [
  'Kontor1', 'Kontor2', 'PortalIn0', 'PortalOut0',
  'CopperDeposit', 'IronDeposit', 'CoalDeposit', 'ClayDeposit', 'RockSaltDeposit', 'MarbleDeposit', 'GoldDeposit',
  'GemstoneDeposit', 'LeadDeposit', 'ZincDeposit', 'NitrateField',
];
const EXTRA_NON_PRODUCER_EXACT = ['Silo'];
const nonProducerExactIds = [
  ...new Set([...SAVE_ENTITY_TO_TERRAIN, ...SAVE_ENTITY_TO_DEPOSIT, ...SAVE_SKIP_ENTITY_IDS, ...EXTRA_NON_PRODUCER_EXACT]),
].sort();

const modPath = path.join(ROOT, 'data', 'production_modifiers.json');
const mod = JSON.parse(fs.readFileSync(modPath, 'utf8'));
mod.nonProducerExactIds = nonProducerExactIds;
mod.nonProducerIdPrefixes = ['Warehouse', 'Kontor', 'Portal', 'Garrison', 'House'];
mod.skipEntityIdSubstrings = [];
mod.gameEntityBuildingIdRemap = {
  Fisherman: 'FishermansHut',
  BeachFisherman: 'BeachFishermansHut',
  SalmonFisherman: 'SalmonFishermansHut',
};
fs.writeFileSync(modPath, JSON.stringify(mod, null, 2));
console.log('Updated', modPath, 'nonProducerExactIds count', nonProducerExactIds.length);
