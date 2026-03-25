/**
 * Shared save production parsing (Node). Used by parse-pp2-save.mjs.
 * Browser copy lives in save-analysis.js (keep in sync).
 * Tile-input scaling and rickyard/paddock area ×2 are applied in parse-pp2-save.mjs / save-analysis.js, not here.
 */

const EXCLUDE_COMPONENT_KEYS = new Set(['internalstorage', 'portal']);

/**
 * @param {string} slug data.js produces slug e.g. 'planks', 'fish'
 * @param {Record<string,string>} resourceNames numeric id -> display name
 * @returns {string|null} numeric id if matched
 */
export function slugToResourceId(slug, resourceNames) {
  if (!slug || !resourceNames || typeof resourceNames !== 'object') return null;
  const words = slug.replace(/_/g, ' ').split(' ');
  const title = words.map(w => (w[0] ? w[0].toUpperCase() + w.slice(1).toLowerCase() : '')).join(' ');
  const lower = title.toLowerCase();
  for (const [id, name] of Object.entries(resourceNames)) {
    if (!name || name === 'Unknown') continue;
    const nl = String(name).toLowerCase();
    if (nl === lower) return id;
    if (nl === lower + 's' || nl + 's' === lower) return id;
    if (nl.replace(/s$/, '') === lower.replace(/s$/, '')) return id;
  }
  return null;
}

export function shouldSkipProductionEntity(id, modifiers) {
  if (!id || typeof id !== 'string') return true;
  const exact = modifiers.nonProducerExactIds;
  if (Array.isArray(exact) && exact.includes(id)) return true;
  const prefs = modifiers.nonProducerIdPrefixes || [];
  for (const p of prefs) {
    if (id === p || id.startsWith(p)) return true;
  }
  const subs = modifiers.skipEntityIdSubstrings || [];
  for (let i = 0; i < subs.length; i++) {
    if (id.includes(subs[i])) return true;
  }
  return false;
}

/**
 * Prefer harvester/factory/... when present; else first Timer on other keys (not internalstorage/portal).
 */
export function findProductionTimer(components, preferredKeys) {
  if (!components || typeof components !== 'object') return null;
  for (const k of preferredKeys || []) {
    if (EXCLUDE_COMPONENT_KEYS.has(k)) continue;
    const cd = components[k]?.Timer?.Cooldown;
    if (typeof cd === 'number' && cd > 0) return { componentKey: k, cooldown: cd };
  }
  for (const [k, v] of Object.entries(components)) {
    if (EXCLUDE_COMPONENT_KEYS.has(k)) continue;
    if (!v || typeof v !== 'object') continue;
    const cd = v.Timer?.Cooldown;
    if (typeof cd === 'number' && cd > 0) return { componentKey: k, cooldown: cd };
  }
  return null;
}

export function parseOutputRatesFromInternal(internalstorage, cooldown) {
  const out = {};
  const resources = internalstorage?.OutputResources?.Resources;
  if (!Array.isArray(resources) || resources.length === 0) {
    const fallback = 60 / cooldown;
    out._fallback = fallback;
    return { byResourceId: out, totalPerMinute: fallback };
  }
  let total = 0;
  for (const r of resources) {
    const key = String(r.key);
    const bal = r.value?.balance;
    const batch = typeof bal === 'number' && bal > 0 ? bal : 1;
    const perMin = (batch * 60) / cooldown;
    out[key] = (out[key] || 0) + perMin;
    total += perMin;
  }
  return { byResourceId: out, totalPerMinute: total };
}

/**
 * Rates from planner/calculator fallback (data/building_production_fallback.json).
 */
export function ratesFromPlannerFallback(buildingId, fallbackById, resourceNames) {
  const fb = fallbackById?.[buildingId];
  if (!fb || fb.produces == null) return null;
  const iter = fb.iterationTime;
  const pi = fb.producePerIteration;
  const pm = fb.producePerMinute;
  let rate =
    pm != null && typeof pm === 'number' && isFinite(pm)
      ? pm
      : typeof iter === 'number' &&
          iter > 0 &&
          typeof pi === 'number' &&
          pi > 0 &&
          isFinite(pi)
        ? (pi * 60) / iter
        : null;
  if (rate == null || !isFinite(rate)) return null;
  const rid = slugToResourceId(fb.produces, resourceNames);
  const key = rid != null ? rid : `_produce:${fb.produces}`;
  return { byResourceId: { [key]: rate }, totalPerMinute: rate };
}

/**
 * Resolve production rates for one GameEntity.
 * @returns {null | { byResourceId: Record<string,number>, totalPerMinute: number, timerInfo: object, rateSource: string }}
 */
export function resolveEntityProduction(ent, options) {
  const {
    preferredKeys,
    modifiers,
    fallbackById,
    resourceNames,
  } = options;

  const bid = ent.id;
  if (shouldSkipProductionEntity(bid, modifiers)) return null;

  const plannerBid =
    (modifiers.gameEntityBuildingIdRemap && modifiers.gameEntityBuildingIdRemap[bid]) || bid;
  const comps = ent.components || {};
  const internal = comps.internalstorage;
  const outRes = internal?.OutputResources?.Resources;
  const hasOutputs = Array.isArray(outRes) && outRes.length > 0;

  let timerInfo = findProductionTimer(comps, preferredKeys);
  const fb = fallbackById?.[plannerBid];
  if (!timerInfo && fb && typeof fb.iterationTime === 'number' && fb.iterationTime > 0) {
    timerInfo = { componentKey: 'plannerData', cooldown: fb.iterationTime };
  }
  if (!timerInfo) return null;

  const cooldown = timerInfo.cooldown;
  let rates;
  let rateSource;

  const fr = fb ? ratesFromPlannerFallback(plannerBid, fallbackById, resourceNames) : null;
  if (fr) {
    rates = { byResourceId: fr.byResourceId, totalPerMinute: fr.totalPerMinute };
    rateSource = 'plannerFallback';
  } else if (hasOutputs) {
    rates = parseOutputRatesFromInternal(internal, cooldown);
    rateSource = 'saveOutputs';
  } else {
    rates = { byResourceId: {}, totalPerMinute: 60 / cooldown };
    rateSource = 'saveFallback';
  }

  return {
    timerInfo,
    cooldownSeconds: cooldown,
    plannerBuildingId: plannerBid,
    ...rates,
    rateSource,
  };
}
