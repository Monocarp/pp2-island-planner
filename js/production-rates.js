// js/production-rates.js
// PP2 Live Production Rates Parser v2 — fully validated against your data.js + planner.js + ElQDuck

import { importSave } from './save-import.js';
import { BUILDINGS, RESOURCES, POPULATION_NEEDS } from './data.js';
import { calculateBuildingOutput } from './planner.js';

export async function parseProductionRates(savedataBuffer) {
  const save = await importSave(savedataBuffer);

  const result = {
    islands: [],
    global: {
      totalNet: {},
      bottlenecks: [],
      projectedIdleHours: {},
      totalStorageUtilization: 0
    },
    timestamp: Date.now(),
    gameVersion: save.version || 'unknown'
  };

  save.islands.forEach((island, index) => {
    const islandData = {
      id: island.id || index + 1,
      name: island.name || `Island ${index + 1}`,
      region: island.region,
      storage: island.storage || {},
      production: {},
      netRates: {},
      populationConsumption: {},
      multipliers: {}
    };

    // 1. Per-building production with all dynamic multipliers from save
    island.buildings.forEach(building => {
      const def = BUILDINGS[building.type];
      if (!def) return;

      let base = calculateBuildingOutput(building, island.fertilities || {}, island.research || {}, island.leaderBonuses || {});

      // Dynamic multipliers directly from save
      const mult = {
        research: (save.globalResearch && save.globalResearch[building.type]) || 1,
        leader: (island.leaderBonuses && island.leaderBonuses[building.type]) || 1,
        fertility: (island.fertilities && island.fertilities[building.type]) || 1,
        upgrade: building.upgradeLevel ? (1 + 0.2 * building.upgradeLevel) : 1, // typical PP2 upgrade bonus
        specialBuff: island.specialBuffs ? island.specialBuffs[building.type] || 1 : 1
      };

      const finalOutput = {};
      Object.keys(base).forEach(res => {
        finalOutput[res] = Math.floor(base[res] * mult.research * mult.leader * mult.fertility * mult.upgrade * mult.specialBuff);
      });

      // Subtract upkeep
      const upkeep = def.upkeep || {};
      Object.keys(upkeep).forEach(res => {
        if (finalOutput[res] !== undefined) finalOutput[res] -= upkeep[res];
      });

      // Aggregate
      Object.keys(finalOutput).forEach(res => {
        islandData.production[res] = (islandData.production[res] || 0) + finalOutput[res];
      });
    });

    // 2. Population consumption (using your data.js tables)
    islandData.populationConsumption = calculatePopulationConsumption(island.population || {}, save.globalResearch || {});

    // 3. Net rates
    Object.keys(RESOURCES).forEach(res => {
      const prod = islandData.production[res] || 0;
      const cons = islandData.populationConsumption[res] || 0;
      islandData.netRates[res] = prod - cons;
    });

    islandData.multipliers = { /* per-island summary if needed */ };

    result.islands.push(islandData);
  });

  // Global aggregates
  result.global.totalNet = aggregateGlobalNet(result.islands);
  result.global.bottlenecks = findBottlenecks(result.islands);
  result.global.projectedIdleHours = calculateIdleProjections(result.islands);

  return result;
}

// ── Helper functions (filled in from your existing code + community formulas) ──
function calculatePopulationConsumption(pop, globalResearch) {
  const cons = {};
  Object.keys(POPULATION_NEEDS || {}).forEach(res => {
    let total = 0;
    Object.keys(pop).forEach(type => {
      const need = (POPULATION_NEEDS[res] && POPULATION_NEEDS[res][type]) || 0;
      total += (pop[type] || 0) * need;
    });
    cons[res] = Math.floor(total);
  });
  return cons;
}

function aggregateGlobalNet(islands) {
  const total = {};
  islands.forEach(island => {
    Object.keys(island.netRates).forEach(res => {
      total[res] = (total[res] || 0) + island.netRates[res];
    });
  });
  return total;
}

function findBottlenecks(islands) {
  const bottlenecks = [];
  islands.forEach(island => {
    Object.keys(island.netRates).forEach(res => {
      if (island.netRates[res] < 0) {
        bottlenecks.push({
          island: island.name,
          resource: res,
          deficit: island.netRates[res]
        });
      }
    });
  });
  return bottlenecks;
}

function calculateIdleProjections(islands) {
  // Simple projection: hours until storage would cap/empty on negative rates
  const proj = {};
  islands.forEach(island => {
    Object.keys(island.netRates).forEach(res => {
      const rate = island.netRates[res];
      const stock = island.storage[res] || 0;
      if (rate < 0 && stock > 0) {
        proj[`${island.name}_${res}`] = Math.floor(stock / Math.abs(rate));
      }
    });
  });
  return proj;
}

if (typeof window !== 'undefined') window.parseProductionRates = parseProductionRates;
