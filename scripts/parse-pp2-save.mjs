#!/usr/bin/env node
/**
 * PP2 comprehensive save parser (decoded JSON).
 * Merges logic from js/*.txt prototypes + production-rates.js.
 *
 * Usage:
 *   node scripts/parse-pp2-save.mjs path/to/save.json
 *   node scripts/parse-pp2-save.mjs path/to/save.json --human
 *
 * Loads data/production_modifiers.json, data/ships.json, data/resource_names.json,
 * data/research.json, data/research_unlocks.json relative to repo root.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function loadJsonOptional(relPath, fallback = null) {
  const p = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function chebyshev(xyA, xyB) {
  if (!Array.isArray(xyA) || !Array.isArray(xyB) || xyA.length < 2 || xyB.length < 2) return Infinity;
  return Math.max(Math.abs(xyA[0] - xyB[0]), Math.abs(xyA[1] - xyB[1]));
}

function findProductionTimer(components, preferredKeys) {
  if (!components || typeof components !== 'object') return null;
  for (const k of preferredKeys) {
    const cd = components[k]?.Timer?.Cooldown;
    if (typeof cd === 'number' && cd > 0) return { componentKey: k, cooldown: cd };
  }
  for (const [k, v] of Object.entries(components)) {
    if (!v || typeof v !== 'object') continue;
    const cd = v.Timer?.Cooldown;
    if (typeof cd === 'number' && cd > 0) return { componentKey: k, cooldown: cd };
  }
  return null;
}

function shouldSkipEntityId(id, substrings) {
  if (!id || typeof id !== 'string') return true;
  return substrings.some(s => id.includes(s));
}

function parseOutputRates(internalstorage, cooldown) {
  const out = {};
  const resources = internalstorage?.OutputResources?.Resources;
  if (!Array.isArray(resources) || resources.length === 0) {
    const fallback = 60 / cooldown;
    out._fallback = fallback;
    return { byResourceId: out, totalPerMinute: fallback };
  }
  let total = 0;
  for (const r of resources) {
    const key = r.key;
    const bal = r.value?.balance;
    const batch = typeof bal === 'number' && bal > 0 ? bal : 1;
    const perMin = (batch * 60) / cooldown;
    const k = String(key);
    out[k] = (out[k] || 0) + perMin;
    total += perMin;
  }
  return { byResourceId: out, totalPerMinute: total };
}

function enrichResourceNames(byId, nameMap) {
  const o = {};
  for (const [k, v] of Object.entries(byId)) {
    o[k] = { perMinute: v, name: nameMap[k] || null };
  }
  return o;
}

export function parsePp2SaveJson(save, options = {}) {
  const modifiers = options.modifiers || loadJsonOptional('data/production_modifiers.json', {});
  const skipSubs = modifiers.skipEntityIdSubstrings || [];
  const preferred = modifiers.productionComponentKeysPreferred || ['harvester', 'factory', 'gatherer', 'miner', 'smelter'];
  const boostTable = modifiers.siloBoostMultipliers || {};
  const defaultBoost = modifiers.defaultSiloBoostMultiplier ?? 1;
  const siloDist = modifiers.siloProximityChebyshevDistance ?? 4;
  const siloNeedle = modifiers.siloEntityIdContains || 'Silo';

  let resourceNames;
  if (options.resourceNames && typeof options.resourceNames === 'object') {
    resourceNames = { ...options.resourceNames, ...(options.resourceNameOverrides || {}) };
  } else {
    const base = loadJsonOptional('data/resource_names.json', {})?.resource_names || {};
    const extra = loadJsonOptional('data/resource_names_extra.json', {})?.resource_names || {};
    resourceNames = { ...base, ...extra, ...(options.resourceNameOverrides || {}) };
  }
  const shipsCatalog = options.shipsCatalog || loadJsonOptional('data/ships.json', { ships: [] });
  const researchCatalog = options.researchCatalog || loadJsonOptional('data/research.json', { research: [] });
  const researchUnlocks = options.researchUnlocks || loadJsonOptional('data/research_unlocks.json', {});

  const researchById = {};
  for (const r of researchCatalog.research || []) researchById[r.id] = r;

  const shipByType = {};
  for (const s of shipsCatalog.ships || []) shipByType[s.type] = s;

  const warnings = [];

  const version = save.SaveFileVersion ?? null;
  if (version !== null && version !== 20) {
    warnings.push(`SaveFileVersion ${version} (parser tested mainly against v20)`);
  }

  const meta = {
    saveFileVersion: version,
    currentTick: save.GameTimeManager?.current_tick ?? null,
  };

  const stocks = {};
  for (const r of save.ResourceManager?.GlobalResources?.Resources || []) {
    const k = r.key;
    const bal = r.value?.balance;
    stocks[String(k)] = typeof bal === 'number' ? bal : 0;
  }

  const population = {
    maxPopulationCount: save.PopulationManager?.MaxPopulationCount || null,
    populationTiers: save.PopulationManager?.PopulationTiers || null,
  };

  const researchCompleted = (save.ResearchManager?.CompletedResearchTimes || []).map(x => ({
    researchId: x.key,
    value: x.value,
    name: researchById[x.key]?.name || null,
  }));

  const routes = {
    simple: save.RouteManager?.SimpleRoutes || [],
    complex: save.RouteManager?.ComplexRoutes || [],
  };

  const shipsOut = [];
  for (const sh of save.ShipManager?.Ships || []) {
    const typ = sh.Type;
    const catalog = shipByType[typ] || null;
    shipsOut.push({
      name: sh.Name,
      type: typ,
      shipClass: catalog?.description || null,
      baseSlots: catalog?.baseSlots ?? null,
      baseSlotSize: catalog?.baseSlotSize ?? null,
      islandUID: sh.IslandUID ?? null,
      hasRoute: sh.HasRoute ?? false,
      routeUID: sh.RouteUID ?? null,
      slots: sh.Slots || [],
    });
  }

  const islands = [];
  const globalProductionByResource = {};

  for (const island of save.IslandManager?.islands || []) {
    const name = island.Name || '';
    const uid = island.UID || '';
    const entities = island.GameEntities || [];

    const siloPositions = entities
      .filter(e => e.id && String(e.id).includes(siloNeedle))
      .map(e => e.xy)
      .filter(xy => Array.isArray(xy) && xy.length >= 2);

    const buildingSummaries = [];

    for (const ent of entities) {
      const bid = ent.id;
      if (shouldSkipEntityId(bid, skipSubs)) continue;

      const comps = ent.components;
      const timerInfo = findProductionTimer(comps, preferred);
      if (!timerInfo) continue;

      const cooldown = timerInfo.cooldown;
      const internal = comps.internalstorage;
      let boosted = false;
      const xy = ent.xy;
      if (Array.isArray(xy) && xy.length >= 2 && siloPositions.length > 0) {
        for (const sxy of siloPositions) {
          if (chebyshev(xy, sxy) <= siloDist) {
            boosted = true;
            break;
          }
        }
      }

      const mult = boosted ? (boostTable[bid] ?? defaultBoost) : 1.0;

      const { byResourceId, totalPerMinute } = parseOutputRates(internal, cooldown);
      const scaled = {};
      let scaledTotal = 0;
      for (const [rk, rv] of Object.entries(byResourceId)) {
        const v = rv * mult;
        scaled[rk] = v;
        scaledTotal += v;
        globalProductionByResource[rk] = (globalProductionByResource[rk] || 0) + v;
      }

      buildingSummaries.push({
        buildingId: bid,
        xy,
        componentKey: timerInfo.componentKey,
        cooldownSeconds: cooldown,
        siloBoosted: boosted,
        multiplier: mult,
        outputPerMinuteByResourceId: enrichResourceNames(scaled, resourceNames),
        totalOutputPerMinute: scaledTotal || (totalPerMinute * mult),
      });
    }

    islands.push({
      uid,
      name,
      entityCount: entities.length,
      siloCount: siloPositions.length,
      productionBuildings: buildingSummaries,
    });
  }

  return {
    meta,
    warnings,
    stocks,
    stocksWithNames: Object.fromEntries(
      Object.entries(stocks).map(([k, v]) => [k, { balance: v, name: resourceNames[k] || null }])
    ),
    population,
    researchCompleted,
    researchUnlocksCatalog: researchUnlocks?.researchIdToBuildingIds || {},
    routes: {
      simpleRouteCount: routes.simple.length,
      complexRouteCount: routes.complex.length,
      simpleRoutesSample: routes.simple.slice(0, 3),
    },
    ships: shipsOut,
    islands,
    globalProductionByResourceId: enrichResourceNames(globalProductionByResource, resourceNames),
  };
}

function main() {
  const args = process.argv.slice(2).filter(a => a !== '--human');
  const human = process.argv.includes('--human');
  const fileArg = args.find(a => !a.startsWith('-'));
  if (!fileArg) {
    console.error('Usage: node scripts/parse-pp2-save.mjs <save.json> [--human]');
    process.exit(1);
  }

  const abs = path.resolve(fileArg);
  if (!fs.existsSync(abs)) {
    console.error('File not found:', abs);
    process.exit(1);
  }

  const save = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const result = parsePp2SaveJson(save, {});

  if (human) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    process.stdout.write(JSON.stringify(result));
  }
}

try {
  if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
} catch {
  /* imported as module */
}
