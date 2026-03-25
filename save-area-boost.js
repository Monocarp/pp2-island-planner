// ===== SAVE ANALYSIS: RICKYARD (Silo) + PADDOCK AREA BOOST =====
// 5×5 centered footprint (Chebyshev ≤ 2), ×2, no stacking. Keep in sync with scripts/save-area-boost.mjs.

(function (g) {
  'use strict';

  var RICKYARD_LIVESTOCK_IDS = {
    PigRanch: true,
    CattleFarm: true,
    CattleRanch: true,
    SheepFarm: true,
    HorseFarm: true,
    HorseBreeder: true,
  };

  var BOOST_FOOTPRINT_CHEBYSHEV_RADIUS = 2;

  function chebyshevDistance(xyA, xyB) {
    if (!Array.isArray(xyA) || !Array.isArray(xyB) || xyA.length < 2 || xyB.length < 2) return Infinity;
    return Math.max(Math.abs(xyA[0] - xyB[0]), Math.abs(xyA[1] - xyB[1]));
  }

  function anchorInsideAnyBoostFootprint(xy, boostAnchors) {
    if (!Array.isArray(xy) || xy.length < 2 || !boostAnchors || !boostAnchors.length) return false;
    for (var i = 0; i < boostAnchors.length; i++) {
      var a = boostAnchors[i];
      if (!Array.isArray(a) || a.length < 2) continue;
      if (chebyshevDistance(xy, a) <= BOOST_FOOTPRINT_CHEBYSHEV_RADIUS) return true;
    }
    return false;
  }

  function isRickyardLivestockEligible(gameEntityId, plannerBuildingId) {
    if (gameEntityId && RICKYARD_LIVESTOCK_IDS[gameEntityId]) return true;
    if (plannerBuildingId && RICKYARD_LIVESTOCK_IDS[plannerBuildingId]) return true;
    return false;
  }

  function entityHasHarvesterComponent(components) {
    return !!(components && components.harvester && typeof components.harvester === 'object');
  }

  function computeAreaBoost(ent, resolved, siloAnchors, paddockAnchors) {
    var xy = ent.xy;
    var bid = ent.id;
    var plannerId = resolved && resolved.plannerBuildingId;
    var comps = ent.components;

    var inSilo = anchorInsideAnyBoostFootprint(xy, siloAnchors);
    var inPaddock = anchorInsideAnyBoostFootprint(xy, paddockAnchors);

    var rickyardApplies = inSilo && isRickyardLivestockEligible(bid, plannerId);
    var paddockApplies = inPaddock && entityHasHarvesterComponent(comps) && !rickyardApplies;

    var mult = rickyardApplies || paddockApplies ? 2 : 1;

    return {
      multiplier: mult,
      siloBoosted: rickyardApplies,
      paddockBoosted: paddockApplies,
    };
  }

  g.computeSaveAreaBoost = computeAreaBoost;
})(typeof globalThis !== 'undefined' ? globalThis : window);
