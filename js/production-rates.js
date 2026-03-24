// js/production-rates.js — LIVE PRODUCTION PARSER (v1)
// Works directly with your JSON save file. Run it on the planner page or in console.

window.parseProductionRates = function (saveJson) {
  const result = {
    stocks: {},               // current balance for every resource (global)
    islands: [],
    globalNetRates: {},
    bottlenecks: [],
    projectedIdleHours: {},
    researchCompleted: saveJson.ResearchManager?.CompletedResearchTimes?.length || 0,
    timestamp: Date.now()
  };

  // 1. Current stock levels (the "live" part everyone wants)
  (saveJson.ResourceManager?.GlobalResources?.Resources || []).forEach(r => {
    result.stocks[r.key] = r.value.balance;
  });

  // 2. Per-island overview + building counts (we'll expand to full rates next)
  const islands = saveJson.IslandManager?.islands || [];
  islands.forEach((island, idx) => {
    const islandData = {
      id: island.UID || idx + 1,
      name: island.Name || `Island ${idx + 1}`,
      buildingCount: (island.GameEntities || []).length,
      stocks: {},          // we can map per-island later if needed
      production: {},      // placeholder for calculated rates
      netRates: {}
    };

    // For now we log the stocks globally; in v2 we will calculate per-island production
    result.islands.push(islandData);
  });

  // 3. Basic global net rates stub (expand with planner.js in next version)
  // For now we just show total stock as a starting point
  console.log('✅ Production parser v1 complete — current stocks extracted for all resources');
  console.log('Islands:', result.islands.length);
  console.log('Research completed:', result.researchCompleted);
  console.log('Sample stocks (first 5):', Object.fromEntries(Object.entries(result.stocks).slice(0, 5)));

  return result;
};

// Auto-run example so you can test immediately in console
console.log('✅ production-rates.js loaded — type parseProductionRates(window.currentSave) after loading your save');
