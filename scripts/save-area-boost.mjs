/**
 * Rickyard (save entity id contains "Silo") and Paddock area boosts for save analysis.
 * Silo/Paddock are boost sources only — they are non-producers and never get a production row or ×2.
 * 5×5 footprint = Chebyshev distance ≤ 2 from boost source anchor. ×2, no stacking (max ×2 total).
 */

const RICKYARD_LIVESTOCK_IDS = new Set([
  'PigRanch',
  'CattleFarm',
  'CattleRanch',
  'SheepFarm',
  'HorseFarm',
  'HorseBreeder',
]);

/** 5×5 square centered on entity anchor */
const BOOST_FOOTPRINT_CHEBYSHEV_RADIUS = 2;

export function chebyshevDistance(xyA, xyB) {
  if (!Array.isArray(xyA) || !Array.isArray(xyB) || xyA.length < 2 || xyB.length < 2) return Infinity;
  return Math.max(Math.abs(xyA[0] - xyB[0]), Math.abs(xyA[1] - xyB[1]));
}

export function anchorInsideAnyBoostFootprint(xy, boostAnchors) {
  if (!Array.isArray(xy) || xy.length < 2 || !boostAnchors || !boostAnchors.length) return false;
  for (const a of boostAnchors) {
    if (!Array.isArray(a) || a.length < 2) continue;
    if (chebyshevDistance(xy, a) <= BOOST_FOOTPRINT_CHEBYSHEV_RADIUS) return true;
  }
  return false;
}

export function isRickyardLivestockEligible(gameEntityId, plannerBuildingId) {
  if (gameEntityId && RICKYARD_LIVESTOCK_IDS.has(gameEntityId)) return true;
  if (plannerBuildingId && RICKYARD_LIVESTOCK_IDS.has(plannerBuildingId)) return true;
  return false;
}

export function entityHasHarvesterComponent(components) {
  return !!(components && components.harvester && typeof components.harvester === 'object');
}

/**
 * @returns {{ multiplier: number, siloBoosted: boolean, paddockBoosted: boolean }}
 */
export function computeAreaBoost(ent, resolved, siloAnchors, paddockAnchors) {
  const xy = ent.xy;
  const bid = ent.id;
  const plannerId = resolved && resolved.plannerBuildingId;
  const comps = ent.components;

  const inSilo = anchorInsideAnyBoostFootprint(xy, siloAnchors);
  const inPaddock = anchorInsideAnyBoostFootprint(xy, paddockAnchors);

  const rickyardApplies = inSilo && isRickyardLivestockEligible(bid, plannerId);
  const paddockApplies =
    inPaddock && entityHasHarvesterComponent(comps) && !rickyardApplies;

  const mult = rickyardApplies || paddockApplies ? 2 : 1;

  return {
    multiplier: mult,
    siloBoosted: rickyardApplies,
    paddockBoosted: paddockApplies,
  };
}
