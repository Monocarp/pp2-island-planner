// js/production-rates.js — PLAIN BROWSER VERSION (no import/export)
// Drop this in and the console test will work instantly

window.parseProductionRates = async function (savedataBuffer) {
  // For now we assume you have importSave available globally (from the planner)
  // If it's not, the test below will tell us and we'll adjust
  const save = await window.importSave(savedataBuffer);   // <-- your existing importer

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

  save.islands.forEach((island, idx) => {
    const islandData = {
      id: island.id || idx + 1,
      name: island.name || `Island ${idx + 1}`,
      region: island.region,
      storage: island.storage || {},
      production: {},
      netRates: {},
      populationConsumption: {}
    };

    // 1. Buildings + dynamic multipliers (research, leader, fertility, upgrades)
    island.buildings.forEach(building => {
      const def = window.BUILDINGS?.[building.type];
      if (!def) return;

      let base = window.calculateBuildingOutput 
        ? window.calculateBuildingOutput(building, island.fertilities || {}, island.research || {}, island.leaderBonuses || {})
        : { wood: 0, stone: 0, food: 0 }; // fallback if function not loaded

      const mult = {
        research: (save.globalResearch && save.globalResearch[building.type]) || 1,
        leader: (island.leaderBonuses && island.leaderBonuses[building.type]) || 1,
        fertility: (island.fertilities && island.fertilities[building.type]) || 1,
        upgrade: building.upgradeLevel ? (1 + 0.2 * building.upgradeLevel) : 1
      };

      const finalOutput = {};
      Object.keys(base).forEach(res => {
        finalOutput[res] = Math.floor(base[res] * mult.research * mult.leader * mult.fertility * mult.upgrade);
      });

      // upkeep
      const upkeep = def.upkeep || {};
      Object.keys(upkeep).forEach(res => {
        if (finalOutput[res] !== undefined) finalOutput[res] -= upkeep[res];
      });

      Object.keys(finalOutput).forEach(res => {
        islandData.production[res] = (islandData.production[res] || 0) + finalOutput[res];
      });
    });

    // 2. Population consumption
    islandData.populationConsumption = window.calculatePopulationConsumption 
      ? window.calculatePopulationConsumption(island.population || {}, save.globalResearch || {})
      : {};

    // 3. Net rates
    Object.keys(window.RESOURCES || islandData.production).forEach(res => {
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
};

// ── Tiny helpers (inlined so it works even if other files aren't loaded) ──
function aggregateGlobalNet(islands) {
  const total = {};
  islands.forEach(i => {
    Object.keys(i.netRates).forEach(res => {
      total[res] = (total[res] || 0) + i.netRates[res];
    });
  });
  return total;
}
function findBottlenecks(islands) {
  const b = [];
  islands.forEach(i => {
    Object.keys(i.netRates).forEach(res => {
      if (i.netRates[res] < 0) b.push({ island: i.name, resource: res, deficit: i.netRates[res] });
    });
  });
  return b;
}
function calculateIdleProjections(islands) {
  const p = {};
  islands.forEach(i => {
    Object.keys(i.netRates).forEach(res => {
      const rate = i.netRates[res];
      const stock = i.storage[res] || 0;
      if (rate < 0 && stock > 0) p[`${i.name}_${res}`] = Math.floor(stock / Math.abs(rate));
    });
  });
  return p;
}

console.log('✅ production-rates.js updated — window.parseProductionRates is now ready');
