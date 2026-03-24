// js/production-rates.js
// PP2 Live Production Rates Parser — built on top of save-import.js + data.js
// Usage: parseProductionRates(savedataBuffer) → returns full cross-island rates

import { importSave } from './save-import.js';
import { BUILDINGS, RESOURCES, FERTILITIES } from './data.js';
import { calculateBuildingOutput } from './planner.js'; // reuse existing chain logic

/**
 * Main entry point — takes raw savedata.dat (ArrayBuffer or Uint8Array)
 * Returns structured production data for the companion app.
 */
export async function parseProductionRates(savedataBuffer) {
  const save = await importSave(savedataBuffer); // your existing importer

  const result = {
    islands: [],
    global: {
      totalNet: {},      // e.g. { wood: 1245, stone: -87, ... }
      bottlenecks: [],
      projectedIdleHours: {}
    },
    timestamp: Date.now()
  };

  // Process every island
  save.islands.forEach(island => {
    const islandData = {
      id: island.id,
      name: island.name || `Island ${island.id}`,
      region: island.region,
      storage: {},
      production: {},
      netRates: {},
      populationConsumption: {}
    };

    // 1. Current storage levels
    Object.keys(island.storage || {}).forEach(res => {
      islandData.storage[res] = island.storage[res];
    });

    // 2. Per-building production with all dynamic multipliers
    island.buildings.forEach(building => {
      const def = BUILDINGS[building.type];
      if (!def) return;

      const baseOutput = calculateBuildingOutput(building, island.fertilities, island.research || {}, island.leaderBonuses || {});

      // Apply research, leader, and special buffs from save
      const multipliers = getDynamicMultipliers(building, island, save.globalResearch || {});
      const finalOutput = applyMultipliers(baseOutput, multipliers);

      // Subtract maintenance / upkeep
      const upkeep = def.upkeep || {};
      Object.keys(finalOutput).forEach(res => {
        if (upkeep[res]) finalOutput[res] -= upkeep[res];
      });

      // Aggregate per resource
      Object.keys(finalOutput).forEach(res => {
        if (!islandData.production[res]) islandData.production[res] = 0;
        islandData.production[res] += finalOutput[res];
      });
    });

    // 3. Population consumption
    const popConsumption = calculatePopulationConsumption(island.population || {}, save.globalResearch);
    islandData.populationConsumption = popConsumption;

    // 4. Net rates per resource
    Object.keys(RESOURCES).forEach(res => {
      const prod = islandData.production[res] || 0;
      const cons = islandData.populationConsumption[res] || 0;
      islandData.netRates[res] = prod - cons;
    });

    result.islands.push(islandData);
  });

  // Global aggregates
  result.global.totalNet = aggregateGlobalNet(result.islands);
  result.global.bottlenecks = findBottlenecks(result.islands);
  result.global.projectedIdleHours = calculateIdleProjections(result.islands);

  return result;
}

// Helper functions (you can expand these — they reuse your existing logic)
function getDynamicMultipliers(building, island, globalResearch) {
  // Research, leader, island-specific buffs, etc. — fully extracted from save
  return {
    research: globalResearch[building.type] || 1,
    leader: island.leaderBonuses?.[building.type] || 1,
    fertility: island.fertilities?.[building.type] || 1,
    // add more as needed from save structure
  };
}

function applyMultipliers(base, mult) {
  const result = {};
  Object.keys(base).forEach(res => {
    result[res] = base[res] * mult.research * mult.leader * mult.fertility;
  });
  return result;
}

function calculatePopulationConsumption(population, globalResearch) {
  // Reuse your data.js population tables + research modifiers
  return {}; // placeholder — fill from your existing planner logic
}

function aggregateGlobalNet(islands) { /* ... */ return {}; }
function findBottlenecks(islands) { /* ... */ return []; }
function calculateIdleProjections(islands) { /* ... */ return {}; }

// Export for browser / Node
if (typeof window !== 'undefined') window.parseProductionRates = parseProductionRates;
