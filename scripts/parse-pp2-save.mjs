#!/usr/bin/env node
/**
 * PP2 comprehensive save parser (decoded JSON).
 *
 * Usage:
 *   node scripts/parse-pp2-save.mjs path/to/save.json [--human] [--debug-production]
 *
 * Loads data/production_modifiers.json, data/building_production_fallback.json, data/ships.json, etc.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import { resolveEntityProduction } from './save-production-core.mjs';
import { computeAreaBoost } from './save-area-boost.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

let saveTilesHelpers = null;
function getSaveTilesHelpers() {
  if (!saveTilesHelpers) {
    saveTilesHelpers = require(path.join(REPO_ROOT, 'scripts', 'save-analysis-tiles-node.cjs'));
  }
  return saveTilesHelpers;
}

function loadJsonOptional(relPath, fallback = null) {
  const p = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function enrichResourceNames(byId, nameMap) {
  const o = {};
  for (const [k, v] of Object.entries(byId)) {
    let name = nameMap[k] || null;
    if (!name && k.startsWith('_produce:')) {
      name = k
        .slice(10)
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
    }
    o[k] = { perMinute: v, name };
  }
  return o;
}

export function parsePp2SaveJson(save, options = {}) {
  const modifiers = options.modifiers || loadJsonOptional('data/production_modifiers.json', {});
  const preferred = modifiers.productionComponentKeysPreferred || [
    'harvester',
    'factory',
    'gatherer',
    'miner',
    'smelter',
  ];
  const siloNeedle = modifiers.siloEntityIdContains || 'Silo';
  const paddockNeedle = modifiers.paddockEntityIdContains || 'Paddock';

  const fallbackJson = options.buildingProductionFallback || loadJsonOptional('data/building_production_fallback.json', {});
  const fallbackById = fallbackJson.byBuildingId || {};

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
  for (const r of researchCatalog.research || []) {
    researchById[r.id] = r;
    researchById[String(r.id)] = r;
  }

  const shipByType = {};
  for (const s of shipsCatalog.ships || []) shipByType[s.type] = s;

  const warnings = [];
  const debugProduction = options.debugProduction ? [] : null;

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
    name: (researchById[x.key] || researchById[String(x.key)])?.name || null,
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

  const tiles = options.skipTileUtilization ? null : getSaveTilesHelpers();

  for (const island of save.IslandManager?.islands || []) {
    const name = island.Name || '';
    const uid = island.UID || '';
    const entities = island.GameEntities || [];

    let reconstructed = null;
    let tileClaimantsMap = null;
    if (tiles) {
      const gridWarn = [];
      reconstructed = tiles.reconstructIslandFromSaveSlice(island, gridWarn);
      for (const w of gridWarn) warnings.push(w);
      tileClaimantsMap = tiles.tileClaimantsForReconstructedIsland(reconstructed.island);
    }

    let grassPoolRatios = null;
    if (reconstructed && typeof tiles.grassPoolRatiosForIsland === 'function') {
      grassPoolRatios = tiles.grassPoolRatiosForIsland(reconstructed.island);
    }

    const siloPositions = entities
      .filter(e => e.id && String(e.id).includes(siloNeedle))
      .map(e => e.xy)
      .filter(xy => Array.isArray(xy) && xy.length >= 2);

    const paddockPositions = entities
      .filter(e => e.id && String(e.id).includes(paddockNeedle))
      .map(e => e.xy)
      .filter(xy => Array.isArray(xy) && xy.length >= 2);

    const buildingSummaries = [];

    for (const ent of entities) {
      const bid = ent.id;
      const resolved = resolveEntityProduction(ent, {
        preferredKeys: preferred,
        modifiers,
        fallbackById,
        resourceNames,
      });
      if (!resolved) continue;

      const xy = ent.xy;
      let tileUtil = 1;
      let spatialBreakdown = null;
      if (reconstructed && tileClaimantsMap) {
        const tu = tiles.tileUtilizationForEntity(
          reconstructed.island,
          resolved.plannerBuildingId,
          xy,
          tileClaimantsMap,
          grassPoolRatios
        );
        if (tu && typeof tu.tileUtilizationFactor === 'number' && Number.isFinite(tu.tileUtilizationFactor)) {
          tileUtil = tu.tileUtilizationFactor;
          spatialBreakdown = tu.spatialBreakdown;
        }
      }
      const areaBoost = computeAreaBoost(ent, resolved, siloPositions, paddockPositions, {
        tileUtilizationFactor: tileUtil,
      });
      const siloBoosted = areaBoost.siloBoosted;
      const paddockBoosted = areaBoost.paddockBoosted;
      const areaMult = Number.isFinite(areaBoost.multiplier) ? areaBoost.multiplier : 1;
      const siloMult = siloBoosted ? 2 : 1;
      const paddockMult = paddockBoosted ? 2 : 1;
      const mult = areaMult * tileUtil;
      const byResourceId = resolved.byResourceId;
      const scaled = {};
      let scaledTotal = 0;
      for (const [rk, rv] of Object.entries(byResourceId)) {
        const v = rv * mult;
        scaled[rk] = v;
        scaledTotal += v;
        globalProductionByResource[rk] = (globalProductionByResource[rk] || 0) + v;
      }

      const row = {
        buildingId: bid,
        plannerBuildingId: resolved.plannerBuildingId,
        gameEntityId: bid,
        xy,
        componentKey: resolved.timerInfo.componentKey,
        cooldownSeconds: resolved.cooldownSeconds,
        siloBoosted,
        siloMultiplier: siloMult,
        paddockBoosted,
        paddockMultiplier: paddockMult,
        tileUtilizationFactor: tileUtil,
        spatialInputBreakdown: spatialBreakdown,
        multiplier: mult,
        rateSource: resolved.rateSource,
        outputPerMinuteByResourceId: enrichResourceNames(scaled, resourceNames),
        totalOutputPerMinute: scaledTotal || resolved.totalPerMinute * mult,
      };
      buildingSummaries.push(row);

      if (debugProduction) {
        debugProduction.push({
          island: name || uid,
          gameEntityId: bid,
          plannerBuildingId: resolved.plannerBuildingId,
          rateSource: resolved.rateSource,
          componentKey: resolved.timerInfo.componentKey,
          cooldown: resolved.cooldownSeconds,
          siloBoosted,
          paddockBoosted,
          areaMultiplier: areaMult,
          siloMultiplier: siloMult,
          paddockMultiplier: paddockMult,
          tileUtilizationFactor: tileUtil,
          spatialInputBreakdown: spatialBreakdown,
          multiplier: mult,
          outputs: scaled,
        });
      }
    }

    islands.push({
      uid,
      name,
      entityCount: entities.length,
      siloCount: siloPositions.length,
      paddockCount: paddockPositions.length,
      productionBuildings: buildingSummaries,
    });
  }

  const out = {
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

  if (debugProduction) out.debugProduction = debugProduction;
  return out;
}

function main() {
  const args = process.argv.slice(2).filter(a => a !== '--human' && a !== '--debug-production');
  const human = process.argv.includes('--human');
  const debugProduction = process.argv.includes('--debug-production');
  const fileArg = args.find(a => !a.startsWith('-'));
  if (!fileArg) {
    console.error('Usage: node scripts/parse-pp2-save.mjs <save.json> [--human] [--debug-production]');
    process.exit(1);
  }

  const abs = path.resolve(fileArg);
  if (!fs.existsSync(abs)) {
    console.error('File not found:', abs);
    process.exit(1);
  }

  const save = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const result = parsePp2SaveJson(save, { debugProduction });

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
