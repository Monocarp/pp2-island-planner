// js/production-rates.js — FINAL LIVE PRODUCTION PARSER FOR COMPANION APP
// Extracts current stocks + island overview from your JSON save.
// Ready for Android companion (stocks = "live" numbers you wanted).

window.parseProductionRates = function (save) {
  const result = {
    stocks: {},                    // current balance for every resource (global)
    islands: [],
    researchCompleted: save.ResearchManager?.CompletedResearchTimes?.length || 0,
    timestamp: Date.now(),
    // Net rates will be added in the next step once we hook planner.js
    globalNetRates: {},
    bottlenecks: [],
    projectedIdleHours: {}
  };

  // 1. Current stock levels (the most important "live" data)
  (save.ResourceManager?.GlobalResources?.Resources || []).forEach(r => {
    result.stocks[r.key] = r.value.balance;
  });

  // 2. Island overview
  const islands = save.IslandManager?.islands || [];
  islands.forEach((island, idx) => {
    result.islands.push({
      id: island.UID || idx + 1,
      name: island.Name || `Island ${idx + 1}`,
      buildingCount: (island.GameEntities || []).length
    });
  });

  console.log('✅ parseProductionRates FINAL complete');
  console.log('Islands:', result.islands.length);
  console.log('Research completed:', result.researchCompleted);
  console.table(result.stocks);

  return result;
};

console.log('✅ production-rates.js FINAL loaded — ready for companion app');
