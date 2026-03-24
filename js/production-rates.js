// js/production-rates.js — FULLY STANDALONE BROWSER VERSION
// Paste this, commit, then run the console test below

window.parseProductionRates = async function (savedataBuffer) {
  // Direct JSON parse (your save file is JSON, not binary .dat)
  const text = new TextDecoder().decode(savedataBuffer);
  const save = JSON.parse(text);

  const result = {
    islands: [],
    global: {
      totalNet: {},
      bottlenecks: [],
      projectedIdleHours: {}
    },
    timestamp: Date.now(),
    gameVersion: save.version || 'unknown'
  };

  save.islands.forEach((island, idx) => {
    const islandData = {
      id: island.id || idx + 1,
      name: island.name || `Island ${idx + 1}`,
      storage: island.storage || {},
      production: {},
      netRates: {},
      populationConsumption: {}
    };

    // Production from buildings + dynamic multipliers from save
    (island.buildings || []).forEach(building => {
      const base = {}; // placeholder — we’ll improve once we see real data
      // TODO: replace with real calculateBuildingOutput once we validate

      const mult = {
        research: (save.globalResearch && save.globalResearch[building.type]) || 1,
        leader: (island.leaderBonuses && island.leaderBonuses[building.type]) || 1,
        fertility: (island.fertilities && island.fertilities[building.type]) || 1,
        upgrade: building.upgradeLevel ? (1 + 0.2 * building.upgradeLevel) : 1
      };

      Object.keys(base).forEach(res => {
        islandData.production[res] = (islandData.production[res] || 0) + Math.floor(base[res] * mult.research * mult.leader * mult.fertility * mult.upgrade);
      });
    });

    // Net rates (for now using production only until we see real data)
    Object.keys(islandData.production).forEach(res => {
      islandData.netRates[res] = islandData.production[res];
    });

    result.islands.push(islandData);
  });

  // Global aggregates
  result.global.totalNet = aggregateGlobalNet(result.islands);
  result.global.bottlenecks = findBottlenecks(result.islands);
  result.global.projectedIdleHours = calculateIdleProjections(result.islands);

  return result;
};

function aggregateGlobalNet(islands) {
  const total = {};
  islands.forEach(i => Object.keys(i.netRates || {}).forEach(res => {
    total[res] = (total[res] || 0) + (i.netRates[res] || 0);
  }));
  return total;
}
function findBottlenecks(islands) {
  const b = [];
  islands.forEach(i => Object.keys(i.netRates || {}).forEach(res => {
    if ((i.netRates[res] || 0) < 0) b.push({ island: i.name, resource: res, deficit: i.netRates[res] });
  }));
  return b;
}
function calculateIdleProjections(islands) {
  const p = {};
  islands.forEach(i => Object.keys(i.netRates || {}).forEach(res => {
    const rate = i.netRates[res] || 0;
    const stock = i.storage[res] || 0;
    if (rate < 0 && stock > 0) p[`${i.name}_${res}`] = Math.floor(stock / Math.abs(rate));
  }));
  return p;
}

console.log('✅ production-rates.js is now ready for console testing');
