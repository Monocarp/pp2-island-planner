// ===== SAVE ANALYSIS (browser tab) =====
// Parses PP2 .dat saves (UTF-8 JSON) and shows stocks, production, ships, routes.
// Logic aligned with scripts/parse-pp2-save.mjs; catalogs loaded from /data/*.json when possible.

(function () {
  'use strict';

  /** Embedded fallback when fetch fails (e.g. file://). Keep in sync with data/production_modifiers.json. */
  const DEFAULT_MODIFIERS = {
    siloEntityIdContains: 'Silo',
    paddockEntityIdContains: 'Paddock',
    skipEntityIdSubstrings: [],
    nonProducerIdPrefixes: ['Warehouse', 'Kontor', 'Portal', 'Garrison', 'House'],
    gameEntityBuildingIdRemap: {
      Fisherman: 'FishermansHut',
      BeachFisherman: 'BeachFishermansHut',
      SalmonFisherman: 'SalmonFishermansHut',
      CattleFarm: 'CattleRanch',
      HorseFarm: 'HorseBreeder',
    },
    productionComponentKeysPreferred: ['harvester', 'factory', 'gatherer', 'miner', 'smelter'],
    nonProducerExactIds: [
      'AppleTrees', 'CacaoField', 'ClayDeposit', 'CoalDeposit', 'CoconutPalm', 'CoffeeBeanField', 'CoffeeField',
      'CopperDeposit', 'Forest', 'ForestNorth', 'ForestTropical', 'GemstoneDeposit', 'GoldDeposit', 'GrapeVine',
      'GrapeVines', 'HoneyField', 'HopField', 'HopsField', 'IndigoField', 'IronDeposit', 'Kontor1', 'Kontor2',
      'LeadDeposit', 'LinseedField', 'MahoganyTree', 'MahoganyTrees', 'MarbleDeposit', 'MulberryBush', 'MulberryTrees',
      'NitrateField', 'PortalIn0', 'PortalOut0', 'PotatoField', 'RockSaltDeposit', 'RoseBush', 'RoseField', 'Silo',
      'SpermWhale', 'StrawberryBush', 'StrawberryField', 'SugarCaneField', 'TeaField', 'TobaccoField', 'Vineyard',
      'Weir', 'WheatField', 'ZincDeposit',
    ],
  };

  var EXCLUDE_COMPONENT_KEYS = { internalstorage: true, portal: true };

  let catalogsCache = null;

  function findProductionTimer(components, preferredKeys) {
    if (!components || typeof components !== 'object') return null;
    for (var i = 0; i < preferredKeys.length; i++) {
      var k = preferredKeys[i];
      if (EXCLUDE_COMPONENT_KEYS[k]) continue;
      var cd = components[k] && components[k].Timer && components[k].Timer.Cooldown;
      if (typeof cd === 'number' && cd > 0) return { componentKey: k, cooldown: cd };
    }
    for (var key in components) {
      if (!Object.prototype.hasOwnProperty.call(components, key)) continue;
      if (EXCLUDE_COMPONENT_KEYS[key]) continue;
      var v = components[key];
      if (!v || typeof v !== 'object') continue;
      var c2 = v.Timer && v.Timer.Cooldown;
      if (typeof c2 === 'number' && c2 > 0) return { componentKey: key, cooldown: c2 };
    }
    return null;
  }

  function shouldSkipProductionEntity(id, modifiers) {
    if (!id || typeof id !== 'string') return true;
    var exact = modifiers.nonProducerExactIds;
    if (Array.isArray(exact)) {
      for (var e = 0; e < exact.length; e++) {
        if (exact[e] === id) return true;
      }
    }
    var prefs = modifiers.nonProducerIdPrefixes || [];
    for (var p = 0; p < prefs.length; p++) {
      var pr = prefs[p];
      if (id === pr || id.indexOf(pr) === 0) return true;
    }
    var subs = modifiers.skipEntityIdSubstrings || [];
    for (var s = 0; s < subs.length; s++) {
      if (id.indexOf(subs[s]) !== -1) return true;
    }
    return false;
  }

  function slugToResourceId(slug, resourceNames) {
    if (!slug || !resourceNames) return null;
    var words = slug.replace(/_/g, ' ').split(' ');
    var title = words
      .map(function (w) {
        return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : '';
      })
      .join(' ');
    var lower = title.toLowerCase();
    for (var id in resourceNames) {
      if (!Object.prototype.hasOwnProperty.call(resourceNames, id)) continue;
      var name = resourceNames[id];
      if (!name || name === 'Unknown') continue;
      var nl = String(name).toLowerCase();
      if (nl === lower) return id;
      if (nl === lower + 's' || nl + 's' === lower) return id;
      var n2 = nl.replace(/s$/, '');
      var l2 = lower.replace(/s$/, '');
      if (n2 === l2) return id;
    }
    return null;
  }

  function ratesFromPlannerFallback(plannerBid, fallbackById, resourceNames) {
    var fb = fallbackById && fallbackById[plannerBid];
    if (!fb || fb.produces == null) return null;
    var iter = fb.iterationTime;
    var pi = fb.producePerIteration;
    var pm = fb.producePerMinute;
    var rate =
      pm != null && typeof pm === 'number' && isFinite(pm)
        ? pm
        : typeof iter === 'number' && iter > 0 && typeof pi === 'number' && pi > 0 && isFinite(pi)
          ? (pi * 60) / iter
          : null;
    if (rate == null || !isFinite(rate)) return null;
    var rid = slugToResourceId(fb.produces, resourceNames);
    var key = rid != null ? rid : '_produce:' + fb.produces;
    var br = {};
    br[key] = rate;
    return { byResourceId: br, totalPerMinute: rate };
  }

  function parseOutputRatesFromInternal(internalstorage, cooldown) {
    var out = {};
    var resources = internalstorage && internalstorage.OutputResources && internalstorage.OutputResources.Resources;
    if (!Array.isArray(resources) || resources.length === 0) {
      var fb = 60 / cooldown;
      out._fallback = fb;
      return { byResourceId: out, totalPerMinute: fb };
    }
    var total = 0;
    for (var j = 0; j < resources.length; j++) {
      var r = resources[j];
      var rk = String(r.key);
      var bal = r.value && r.value.balance;
      var batch = typeof bal === 'number' && bal > 0 ? bal : 1;
      var perMin = (batch * 60) / cooldown;
      out[rk] = (out[rk] || 0) + perMin;
      total += perMin;
    }
    return { byResourceId: out, totalPerMinute: total };
  }

  function enrichResourceNames(byId, nameMap) {
    var o = {};
    for (var k in byId) {
      if (!Object.prototype.hasOwnProperty.call(byId, k)) continue;
      var nm = nameMap[k] || nameMap[String(k)] || null;
      if (!nm && k.indexOf('_produce:') === 0) {
        nm = k
          .slice(10)
          .replace(/_/g, ' ')
          .replace(/\b\w/g, function (ch) {
            return ch.toUpperCase();
          });
      }
      o[k] = { perMinute: byId[k], name: nm };
    }
    return o;
  }

  function resolveEntityProduction(ent, options) {
    var preferredKeys = options.preferredKeys;
    var modifiers = options.modifiers;
    var fallbackById = options.fallbackById || {};
    var resourceNames = options.resourceNames || {};

    var bid = ent.id;
    if (shouldSkipProductionEntity(bid, modifiers)) return null;

    var remap = modifiers.gameEntityBuildingIdRemap || {};
    var plannerBid = remap[bid] || bid;
    var comps = ent.components || {};
    var internal = comps.internalstorage;
    var outRes = internal && internal.OutputResources && internal.OutputResources.Resources;
    var hasOutputs = Array.isArray(outRes) && outRes.length > 0;

    var timerInfo = findProductionTimer(comps, preferredKeys);
    var fb = fallbackById[plannerBid];

    if (!timerInfo && fb && typeof fb.iterationTime === 'number' && fb.iterationTime > 0) {
      timerInfo = { componentKey: 'plannerData', cooldown: fb.iterationTime };
    }
    if (!timerInfo) return null;

    var cooldown = timerInfo.cooldown;
    var rates;
    var rateSource;

    var fr = fb ? ratesFromPlannerFallback(plannerBid, fallbackById, resourceNames) : null;
    if (fr) {
      rates = fr;
      rateSource = 'plannerFallback';
    } else if (hasOutputs) {
      rates = parseOutputRatesFromInternal(internal, cooldown);
      rateSource = 'saveOutputs';
    } else {
      rates = { byResourceId: {}, totalPerMinute: 60 / cooldown };
      rateSource = 'saveFallback';
    }

    return {
      timerInfo: timerInfo,
      cooldownSeconds: cooldown,
      plannerBuildingId: plannerBid,
      byResourceId: rates.byResourceId,
      totalPerMinute: rates.totalPerMinute,
      rateSource: rateSource,
    };
  }

  function loadJsonUrl(url) {
    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error(r.statusText);
        return r.json();
      })
      .catch(function () {
        return null;
      });
  }

  function mergeResourceNameMaps(base, extra) {
    var out = {};
    if (base && base.resource_names) {
      for (var a in base.resource_names) {
        if (Object.prototype.hasOwnProperty.call(base.resource_names, a)) out[a] = base.resource_names[a];
      }
    }
    if (extra && extra.resource_names) {
      for (var b in extra.resource_names) {
        if (Object.prototype.hasOwnProperty.call(extra.resource_names, b)) out[b] = extra.resource_names[b];
      }
    }
    return out;
  }

  function ensureCatalogs() {
    if (catalogsCache) return Promise.resolve(catalogsCache);
    return Promise.all([
      loadJsonUrl('data/production_modifiers.json'),
      loadJsonUrl('data/ships.json'),
      loadJsonUrl('data/resource_names.json'),
      loadJsonUrl('data/resource_names_extra.json'),
      loadJsonUrl('data/research.json'),
      loadJsonUrl('data/research_unlocks.json'),
      loadJsonUrl('data/building_production_fallback.json'),
    ]).then(function (parts) {
      var modifiers = Object.assign({}, DEFAULT_MODIFIERS, parts[0] || {});
      var shipsCatalog = parts[1] || { ships: [] };
      var rn = mergeResourceNameMaps(parts[2], parts[3]);
      var researchCatalog = parts[4] || { research: [] };
      var researchUnlocks = parts[5] || {};

      var researchById = {};
      var arr = researchCatalog.research || [];
      for (var i = 0; i < arr.length; i++) {
        var rr = arr[i];
        researchById[rr.id] = rr;
        researchById[String(rr.id)] = rr;
      }

      var shipByType = {};
      var sh = shipsCatalog.ships || [];
      for (var s = 0; s < sh.length; s++) {
        var ship = sh[s];
        shipByType[ship.type] = ship;
      }

      var fbJson = parts[6] || {};
      var buildingFallbackById = fbJson.byBuildingId || {};

      catalogsCache = {
        modifiers: modifiers,
        resourceNames: rn,
        shipsCatalog: shipsCatalog,
        shipByType: shipByType,
        researchById: researchById,
        researchUnlocks: researchUnlocks.researchIdToBuildingIds || {},
        buildingFallbackById: buildingFallbackById,
        dataFilesOk: !!(parts[2] && parts[2].resource_names),
      };
      return catalogsCache;
    });
  }

  function parsePp2SaveJson(save, catalogs) {
    var modifiers = Object.assign({}, DEFAULT_MODIFIERS, catalogs.modifiers || {});
    var preferred = modifiers.productionComponentKeysPreferred || DEFAULT_MODIFIERS.productionComponentKeysPreferred;
    var fallbackById = catalogs.buildingFallbackById || {};
    var siloNeedle = modifiers.siloEntityIdContains || 'Silo';
    var paddockNeedle = modifiers.paddockEntityIdContains || 'Paddock';
    var resourceNames = catalogs.resourceNames || {};
    var shipByType = catalogs.shipByType || {};
    var researchById = catalogs.researchById || {};
    var researchUnlocks = catalogs.researchUnlocks || {};

    var warnings = [];
    var version = save.SaveFileVersion != null ? save.SaveFileVersion : null;
    if (version !== null && version !== 20) {
      warnings.push('SaveFileVersion ' + version + ' (parser tested mainly against v20)');
    }

    var meta = {
      saveFileVersion: version,
      currentTick: save.GameTimeManager && save.GameTimeManager.current_tick != null ? save.GameTimeManager.current_tick : null,
    };

    var stocks = {};
    var gr = save.ResourceManager && save.ResourceManager.GlobalResources && save.ResourceManager.GlobalResources.Resources;
    for (var ri = 0; ri < (gr || []).length; ri++) {
      var r0 = gr[ri];
      var bal = r0.value && r0.value.balance;
      stocks[String(r0.key)] = typeof bal === 'number' ? bal : 0;
    }

    var population = {
      maxPopulationCount: (save.PopulationManager && save.PopulationManager.MaxPopulationCount) || null,
      populationTiers: (save.PopulationManager && save.PopulationManager.PopulationTiers) || null,
    };

    var researchCompleted = [];
    var crt = save.ResearchManager && save.ResearchManager.CompletedResearchTimes;
    for (var ci = 0; ci < (crt || []).length; ci++) {
      var x = crt[ci];
      var rid = x.key;
      var rn0 = researchById[rid] || researchById[String(rid)];
      researchCompleted.push({
        researchId: rid,
        value: x.value,
        name: rn0 ? rn0.name : null,
      });
    }

    var routes = {
      simple: (save.RouteManager && save.RouteManager.SimpleRoutes) || [],
      complex: (save.RouteManager && save.RouteManager.ComplexRoutes) || [],
    };

    var shipsOut = [];
    var shList = save.ShipManager && save.ShipManager.Ships;
    for (var si = 0; si < (shList || []).length; si++) {
      var sh0 = shList[si];
      var typ = sh0.Type;
      var catalog = shipByType[typ] || null;
      shipsOut.push({
        name: sh0.Name,
        type: typ,
        shipClass: catalog ? catalog.description : null,
        baseSlots: catalog && catalog.baseSlots != null ? catalog.baseSlots : null,
        baseSlotSize: catalog && catalog.baseSlotSize != null ? catalog.baseSlotSize : null,
        islandUID: sh0.IslandUID != null ? sh0.IslandUID : null,
        hasRoute: sh0.HasRoute != null ? sh0.HasRoute : false,
        routeUID: sh0.RouteUID != null ? sh0.RouteUID : null,
        slots: sh0.Slots || [],
      });
    }

    var islands = [];
    var globalProductionByResource = {};
    var islList = save.IslandManager && save.IslandManager.islands;

    for (var ii = 0; ii < (islList || []).length; ii++) {
      var island = islList[ii];
      var name = island.Name || '';
      var uid = island.UID || '';
      var entities = island.GameEntities || [];

      var reconstructed = null;
      var tileClaimantsMap = null;
      if (typeof buildPlannerIslandFromSaveIsland === 'function') {
        var gridWarn = [];
        reconstructed = buildPlannerIslandFromSaveIsland(island, { getBuildingData: getBuildingData, warnings: gridWarn });
        for (var gw = 0; gw < gridWarn.length; gw++) warnings.push(gridWarn[gw]);
        if (
          reconstructed &&
          reconstructed.island &&
          typeof buildSpatialTileClaimantsMap === 'function' &&
          typeof computeTileUtilizationForProducer === 'function'
        ) {
          tileClaimantsMap = buildSpatialTileClaimantsMap(reconstructed.island, null);
        }
      }

      var siloPositions = [];
      for (var ei = 0; ei < entities.length; ei++) {
        var e0 = entities[ei];
        if (e0.id && String(e0.id).indexOf(siloNeedle) !== -1 && Array.isArray(e0.xy) && e0.xy.length >= 2) {
          siloPositions.push(e0.xy);
        }
      }

      var paddockPositions = [];
      for (var ep = 0; ep < entities.length; ep++) {
        var eP = entities[ep];
        if (eP.id && String(eP.id).indexOf(paddockNeedle) !== -1 && Array.isArray(eP.xy) && eP.xy.length >= 2) {
          paddockPositions.push(eP.xy);
        }
      }

      var buildingSummaries = [];
      for (var ej = 0; ej < entities.length; ej++) {
        var ent = entities[ej];
        var bid = ent.id;
        var resolved = resolveEntityProduction(ent, {
          preferredKeys: preferred,
          modifiers: modifiers,
          fallbackById: fallbackById,
          resourceNames: resourceNames,
        });
        if (!resolved) continue;

        var xy = ent.xy;
        var tileUtil = 1;
        var spatialBreakdown = null;
        if (reconstructed && reconstructed.island && tileClaimantsMap) {
          var tu = computeTileUtilizationForProducer(
            reconstructed.island,
            resolved.plannerBuildingId,
            xy,
            tileClaimantsMap,
            null
          );
          if (tu && typeof tu.tileUtilizationFactor === 'number' && isFinite(tu.tileUtilizationFactor)) {
            tileUtil = tu.tileUtilizationFactor;
            spatialBreakdown = tu.spatialBreakdown;
          }
        }
        var areaBoost =
          typeof computeSaveAreaBoost === 'function'
            ? computeSaveAreaBoost(ent, resolved, siloPositions, paddockPositions, {
                tileUtilizationFactor: tileUtil,
              })
            : { multiplier: 1, siloBoosted: false, paddockBoosted: false, insideSiloFootprint: false };
        var siloBoosted = areaBoost.siloBoosted;
        var paddockBoosted = areaBoost.paddockBoosted;
        var insideSiloFootprint = !!areaBoost.insideSiloFootprint;
        var areaMult = areaBoost.multiplier != null && isFinite(areaBoost.multiplier) ? areaBoost.multiplier : 1;
        var siloMult = siloBoosted ? 2 : 1;
        var paddockMult = paddockBoosted ? 2 : 1;
        var mult = areaMult * tileUtil;
        var byResourceId = resolved.byResourceId;
        var scaled = {};
        var scaledTotal = 0;
        for (var rk in byResourceId) {
          if (!Object.prototype.hasOwnProperty.call(byResourceId, rk)) continue;
          var rv = byResourceId[rk] * mult;
          scaled[rk] = rv;
          scaledTotal += rv;
          globalProductionByResource[rk] = (globalProductionByResource[rk] || 0) + rv;
        }

        buildingSummaries.push({
          buildingId: bid,
          plannerBuildingId: resolved.plannerBuildingId,
          gameEntityId: bid,
          xy: xy,
          componentKey: resolved.timerInfo.componentKey,
          cooldownSeconds: resolved.cooldownSeconds,
          siloBoosted: siloBoosted,
          insideSiloFootprint: insideSiloFootprint,
          siloMultiplier: siloMult,
          paddockBoosted: paddockBoosted,
          paddockMultiplier: paddockMult,
          tileUtilizationFactor: tileUtil,
          spatialInputBreakdown: spatialBreakdown,
          multiplier: mult,
          rateSource: resolved.rateSource,
          outputPerMinuteByResourceId: enrichResourceNames(scaled, resourceNames),
          totalOutputPerMinute: scaledTotal || resolved.totalPerMinute * mult,
        });
      }

      islands.push({
        uid: uid,
        name: name,
        entityCount: entities.length,
        siloCount: siloPositions.length,
        paddockCount: paddockPositions.length,
        productionBuildings: buildingSummaries,
      });
    }

    var stocksWithNames = {};
    for (var sk in stocks) {
      if (!Object.prototype.hasOwnProperty.call(stocks, sk)) continue;
      stocksWithNames[sk] = { balance: stocks[sk], name: resourceNames[sk] || null };
    }

    return {
      meta: meta,
      warnings: warnings,
      stocks: stocks,
      stocksWithNames: stocksWithNames,
      population: population,
      researchCompleted: researchCompleted,
      researchUnlocksCatalog: researchUnlocks,
      routes: {
        simpleRouteCount: routes.simple.length,
        complexRouteCount: routes.complex.length,
        simpleRoutesSample: routes.simple.slice(0, 5),
      },
      ships: shipsOut,
      islands: islands,
      globalProductionByResourceId: enrichResourceNames(globalProductionByResource, resourceNames),
    };
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function roundRate(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    if (Math.abs(n - Math.round(n)) < 1e-6) return String(Math.round(n));
    return n.toFixed(2);
  }

  /** PP2 temperate/tropical tier indices → labels (see data.js tiers). */
  var POPULATION_TIER_LABELS = [
    'Pioneers',
    'Colonists',
    'Townsmen',
    'Merchants',
    'Paragons',
    'Farmers',
    'Workers',
  ];

  function populationTierLabel(tierKey) {
    var n = typeof tierKey === 'number' ? tierKey : parseInt(String(tierKey), 10);
    if (!isNaN(n) && n >= 0 && n < POPULATION_TIER_LABELS.length) return POPULATION_TIER_LABELS[n];
    if (tierKey != null && tierKey !== '') return 'Tier ' + tierKey;
    return '—';
  }

  /**
   * Normalize MaxPopulationCount from save: array of { key, value } or legacy scalar.
   * @returns {{ rows: Array<{tierKey: *, tierLabel: string, cap: number}>, total: number } | null }
   */
  function normalizePopulationCaps(raw) {
    if (raw == null) return null;
    if (typeof raw === 'number' && isFinite(raw)) {
      return { rows: [{ tierKey: null, tierLabel: 'Total', cap: raw }], total: raw };
    }
    if (Array.isArray(raw)) {
      var rows = [];
      var total = 0;
      for (var i = 0; i < raw.length; i++) {
        var entry = raw[i];
        if (!entry || typeof entry !== 'object') continue;
        var k = entry.key != null ? entry.key : entry.tier != null ? entry.tier : i;
        var v = entry.value != null ? entry.value : entry.cap != null ? entry.cap : entry.balance;
        if (typeof v !== 'number' || !isFinite(v)) continue;
        rows.push({ tierKey: k, tierLabel: populationTierLabel(k), cap: v });
        total += v;
      }
      if (!rows.length) return null;
      rows.sort(function (a, b) {
        var ak = typeof a.tierKey === 'number' ? a.tierKey : 99;
        var bk = typeof b.tierKey === 'number' ? b.tierKey : 99;
        return ak - bk;
      });
      return { rows: rows, total: total };
    }
    return null;
  }

  /** One-line breakdown for card subtitle. */
  function formatPopulationCapsSummary(rows) {
    if (!rows || !rows.length) return '';
    var parts = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      parts.push(escapeHtml(r.tierLabel) + ': ' + escapeHtml(String(r.cap)));
    }
    return parts.join(' · ');
  }

  /** Legacy PopulationTiers object or array (plain text; escape when inserting into HTML). */
  function formatLegacyPopulationTiers(tiers) {
    if (tiers == null) return '';
    if (Array.isArray(tiers)) {
      if (!tiers.length) return '';
      var lines = [];
      for (var i = 0; i < tiers.length; i++) {
        var t = tiers[i];
        if (t && typeof t === 'object') {
          var norm = normalizePopulationCaps([t]);
          if (norm && norm.rows[0]) {
            lines.push(norm.rows[0].tierLabel + ': ' + norm.rows[0].cap);
          } else {
            try {
              lines.push(JSON.stringify(t));
            } catch (e) {
              lines.push(String(t));
            }
          }
        } else lines.push(String(t));
      }
      return lines.join(' · ');
    }
    if (typeof tiers === 'object') {
      var parts = [];
      for (var k in tiers) {
        if (!Object.prototype.hasOwnProperty.call(tiers, k)) continue;
        var val = tiers[k];
        if (val != null && typeof val === 'object') {
          try {
            parts.push(k + ': ' + JSON.stringify(val));
          } catch (e2) {
            parts.push(k + ': [object]');
          }
        } else {
          parts.push(k + ': ' + val);
        }
      }
      return parts.length ? parts.join(' · ') : '';
    }
    return '';
  }

  function formatBuildingOutputs(outputPerMinuteByResourceId, multiplier, buildingId, primaryOnly) {
    var o = outputPerMinuteByResourceId || {};
    if (
      primaryOnly &&
      typeof PP2DATA !== 'undefined' &&
      PP2DATA.getBuilding &&
      buildingId
    ) {
      var pb = PP2DATA.getBuilding(buildingId);
      if (pb && pb.produces) {
        var map = typeof window !== 'undefined' && window.__saResourceNames ? window.__saResourceNames : {};
        var wantId = slugToResourceId(pb.produces, map);
        var nf = {};
        if (wantId != null && o[wantId]) nf[wantId] = o[wantId];
        else if (o['_produce:' + pb.produces]) nf['_produce:' + pb.produces] = o['_produce:' + pb.produces];
        else {
          for (var qk in o) {
            if (!Object.prototype.hasOwnProperty.call(o, qk)) continue;
            if (qk === '_fallback') continue;
            nf[qk] = o[qk];
            break;
          }
        }
        if (Object.keys(nf).length) o = nf;
      }
    }
    var outs = [];
    var mult = multiplier != null && isFinite(multiplier) ? multiplier : 1;
    for (var ok in o) {
      if (!Object.prototype.hasOwnProperty.call(o, ok)) continue;
      if (ok === '_fallback') continue;
      var oi = o[ok];
      var on = oi && oi.name ? oi.name + ' ' : '';
      var pm = oi && typeof oi.perMinute === 'number' ? oi.perMinute : 0;
      outs.push(on + '(' + ok + '): ' + roundRate(pm));
    }
    if (!outs.length && o._fallback != null) {
      var fb = o._fallback;
      outs.push('combined: ' + roundRate((fb && fb.perMinute != null ? fb.perMinute : 0) * mult));
    }
    return outs.join(', ') || '—';
  }

  function combineGroupOutputs(instances) {
    var combined = {};
    for (var i = 0; i < instances.length; i++) {
      var b = instances[i];
      var o = b.outputPerMinuteByResourceId || {};
      for (var k in o) {
        if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
        var oi = o[k];
        var pm = oi && typeof oi.perMinute === 'number' ? oi.perMinute : 0;
        if (k === '_fallback') {
          combined._fallback = (combined._fallback || 0) + pm;
          continue;
        }
        if (!combined[k]) combined[k] = { perMinute: 0, name: oi ? oi.name : null };
        combined[k].perMinute += pm;
        if (!combined[k].name && oi && oi.name) combined[k].name = oi.name;
      }
    }
    var wrapped = {};
    for (var ck in combined) {
      if (!Object.prototype.hasOwnProperty.call(combined, ck)) continue;
      if (ck === '_fallback') {
        wrapped._fallback = { perMinute: combined._fallback, name: null };
      } else {
        wrapped[ck] = combined[ck];
      }
    }
    return wrapped;
  }

  function renderAnalysis(result, fileLabel, catalogsLoaded) {
    var el = document.getElementById('save-analysis-dashboard');
    if (!el) return;

    var primaryOnlyEl = document.getElementById('sa-primary-output-only');
    var primaryOnly = !!(primaryOnlyEl && primaryOnlyEl.checked);

    var meta = result.meta || {};
    var pop = result.population || {};
    var routeSimple = result.routes && result.routes.simpleRouteCount != null ? result.routes.simpleRouteCount : 0;
    var routeComplex = result.routes && result.routes.complexRouteCount != null ? result.routes.complexRouteCount : 0;
    var ships = result.ships || [];
    var research = result.researchCompleted || [];
    var islands = result.islands || [];

    var prodBuildingCount = 0;
    for (var i = 0; i < islands.length; i++) {
      prodBuildingCount += (islands[i].productionBuildings || []).length;
    }

    var popCapsNorm = normalizePopulationCaps(pop.maxPopulationCount);
    var popCapCardValue = popCapsNorm ? String(popCapsNorm.total) : '—';
    var popCapCardSub = popCapsNorm && popCapsNorm.rows.length ? formatPopulationCapsSummary(popCapsNorm.rows) : '';
    var legacyTiersText = formatLegacyPopulationTiers(pop.populationTiers);

    var html = '';

    if (result.warnings && result.warnings.length) {
      html += '<div class="save-analysis-warnings"><strong>Note</strong><ul style="margin:8px 0 0 18px;">';
      for (var w = 0; w < result.warnings.length; w++) {
        html += '<li>' + escapeHtml(result.warnings[w]) + '</li>';
      }
      html += '</ul></div>';
    }

    html += '<div class="save-analysis-cards">';
    html += '<div class="save-analysis-card"><div class="save-analysis-card-label">Population cap (total)</div><div class="save-analysis-card-value">';
    html += escapeHtml(popCapCardValue);
    html += '</div>';
    if (popCapCardSub) {
      html += '<div class="save-analysis-card-sub">' + popCapCardSub + '</div>';
    }
    html += '</div>';
    html +=
      '<div class="save-analysis-card"><div class="save-analysis-card-label">Research done</div><div class="save-analysis-card-value">' +
      research.length +
      '</div></div>';
    html +=
      '<div class="save-analysis-card"><div class="save-analysis-card-label">Routes</div><div class="save-analysis-card-value">' +
      (routeSimple + routeComplex) +
      '</div><div class="save-analysis-card-sub">' +
      routeSimple +
      ' simple · ' +
      routeComplex +
      ' complex</div></div>';
    html +=
      '<div class="save-analysis-card"><div class="save-analysis-card-label">Ships</div><div class="save-analysis-card-value">' +
      ships.length +
      '</div></div>';
    html +=
      '<div class="save-analysis-card"><div class="save-analysis-card-label">Production buildings</div><div class="save-analysis-card-value">' +
      prodBuildingCount +
      '</div><div class="save-analysis-card-sub">' +
      islands.length +
      ' islands</div></div>';
    html +=
      '<div class="save-analysis-card"><div class="save-analysis-card-label">Game tick</div><div class="save-analysis-card-value">' +
      escapeHtml(meta.currentTick != null ? meta.currentTick : '—') +
      '</div><div class="save-analysis-card-sub">v' +
      escapeHtml(meta.saveFileVersion != null ? meta.saveFileVersion : '?') +
      '</div></div>';
    html += '</div>';

    if (!catalogsLoaded) {
      html +=
        '<p class="warning-text" style="font-size:0.8rem;margin-bottom:16px;">Could not load <code>data/*.json</code> (try hosting over HTTP). Using embedded production rules; resource/ship/research names may be missing.</p>';
    }

    if (fileLabel) {
      html += '<p style="font-size:0.78rem;color:#888;margin:-8px 0 20px;">Loaded: <strong>' + escapeHtml(fileLabel) + '</strong></p>';
    }

    if (popCapsNorm && popCapsNorm.rows.length) {
      html += '<div class="save-analysis-section"><h3>Population caps</h3>';
      html += '<div class="save-analysis-table-wrap"><table class="save-analysis-table"><thead><tr>';
      html += '<th>Tier</th><th class="num">Cap</th></tr></thead><tbody>';
      for (var pc = 0; pc < popCapsNorm.rows.length; pc++) {
        var pr = popCapsNorm.rows[pc];
        html +=
          '<tr><td>' +
          escapeHtml(pr.tierLabel) +
          '</td><td class="num">' +
          escapeHtml(String(pr.cap)) +
          '</td></tr>';
      }
      html += '</tbody></table></div>';
      if (legacyTiersText) {
        html +=
          '<p style="font-size:0.78rem;color:#888;margin-top:12px;line-height:1.45;"><strong>Population tiers (extra)</strong> — ' +
          escapeHtml(legacyTiersText) +
          '</p>';
      }
      html += '</div>';
    } else if (legacyTiersText) {
      html += '<div class="save-analysis-section"><h3>Population tiers</h3>';
      html +=
        '<p style="font-size:0.85rem;color:#ccc;line-height:1.5;">' + escapeHtml(legacyTiersText) + '</p></div>';
    }

    html += '<div class="save-analysis-section"><h3>Global resource stocks</h3>';
    var stockEntries = [];
    for (var sk in result.stocksWithNames || {}) {
      if (Object.prototype.hasOwnProperty.call(result.stocksWithNames, sk)) {
        var sn = result.stocksWithNames[sk];
        stockEntries.push({ id: sk, balance: sn.balance, name: sn.name });
      }
    }
    stockEntries.sort(function (a, b) {
      return b.balance - a.balance;
    });
    html += '<div class="save-analysis-table-wrap"><table class="save-analysis-table"><thead><tr>';
    html += '<th>Resource</th><th>Id</th><th class="num">Stock</th></tr></thead><tbody>';
    for (var se = 0; se < stockEntries.length; se++) {
      var st = stockEntries[se];
      var label = st.name || '—';
      html +=
        '<tr><td>' +
        escapeHtml(label) +
        '</td><td>' +
        escapeHtml(st.id) +
        '</td><td class="num">' +
        escapeHtml(String(st.balance)) +
        '</td></tr>';
    }
    if (!stockEntries.length) html += '<tr><td colspan="3" style="color:#888;">No stock data</td></tr>';
    html += '</tbody></table></div></div>';

    html += '<div class="save-analysis-section"><h3>Global production (per minute)</h3>';
    var gentries = [];
    for (var gk in result.globalProductionByResourceId || {}) {
      if (Object.prototype.hasOwnProperty.call(result.globalProductionByResourceId, gk)) {
        var gv = result.globalProductionByResourceId[gk];
        gentries.push({ id: gk, perMinute: gv.perMinute, name: gv.name });
      }
    }
    gentries.sort(function (a, b) {
      return b.perMinute - a.perMinute;
    });
    html += '<div class="save-analysis-table-wrap"><table class="save-analysis-table"><thead><tr>';
    html += '<th>Resource</th><th>Id</th><th class="num">/ min</th></tr></thead><tbody>';
    for (var ge = 0; ge < gentries.length; ge++) {
      var g = gentries[ge];
      html +=
        '<tr><td>' +
        escapeHtml(g.name || '—') +
        '</td><td>' +
        escapeHtml(g.id) +
        '</td><td class="num">' +
        escapeHtml(roundRate(g.perMinute)) +
        '</td></tr>';
    }
    if (!gentries.length) html += '<tr><td colspan="3" style="color:#888;">No production parsed</td></tr>';
    html += '</tbody></table></div></div>';

    html += '<div class="save-analysis-section"><h3>Ships</h3>';
    html += '<div class="save-analysis-table-wrap"><table class="save-analysis-table"><thead><tr>';
    html += '<th>Name</th><th>Class</th><th>Type</th><th class="num">Slots</th><th class="num">Slot size</th><th>Route</th></tr></thead><tbody>';
    for (var shi = 0; shi < ships.length; shi++) {
      var ship = ships[shi];
      html +=
        '<tr><td>' +
        escapeHtml(ship.name || '—') +
        '</td><td>' +
        escapeHtml(ship.shipClass || '—') +
        '</td><td>' +
        escapeHtml(ship.type != null ? ship.type : '—') +
        '</td><td class="num">' +
        escapeHtml(ship.baseSlots != null ? ship.baseSlots : '—') +
        '</td><td class="num">' +
        escapeHtml(ship.baseSlotSize != null ? ship.baseSlotSize : '—') +
        '</td><td>' +
        (ship.hasRoute ? 'yes' : 'no') +
        '</td></tr>';
    }
    if (!ships.length) html += '<tr><td colspan="6" style="color:#888;">No ships</td></tr>';
    html += '</tbody></table></div></div>';

    html += '<div class="save-analysis-section"><h3>Completed research</h3>';
    html += '<div class="save-analysis-table-wrap"><table class="save-analysis-table"><thead><tr>';
    html += '<th>Name</th><th>Id</th></tr></thead><tbody>';
    for (var rsi = 0; rsi < research.length; rsi++) {
      var rs = research[rsi];
      html +=
        '<tr><td>' +
        escapeHtml(rs.name || '—') +
        '</td><td>' +
        escapeHtml(rs.researchId != null ? rs.researchId : '—') +
        '</td></tr>';
    }
    if (!research.length) html += '<tr><td colspan="2" style="color:#888;">None listed</td></tr>';
    html += '</tbody></table></div></div>';

    html += '<div class="save-analysis-section"><h3>Per-island production</h3>';
    for (var isi = 0; isi < islands.length; isi++) {
      var isl = islands[isi];
      var displayName = isl.name || isl.uid || 'Island ' + (isi + 1);
      var pb = isl.productionBuildings || [];
      html += '<details class="save-analysis-island"' + (isi < 3 ? ' open' : '') + '>';
      html +=
        '<summary><span>' +
        escapeHtml(displayName) +
        '</span><span style="font-size:0.75rem;color:#888;font-weight:500;">' +
        pb.length +
        ' producers · ' +
        isl.entityCount +
        ' entities · ' +
        isl.siloCount +
        ' silos · ' +
        (isl.paddockCount != null ? isl.paddockCount : 0) +
        ' paddocks</span></summary>';
      html += '<div class="save-analysis-island-body"><div class="save-analysis-table-wrap"><table class="save-analysis-table"><thead><tr>';
      html +=
        '<th style="width:40px;"></th><th>Building</th><th>Outputs (/min)</th><th>Cooldown</th><th>Notes</th></tr></thead><tbody>';
      if (!pb.length) {
        html += '<tr><td colspan="5" style="color:#888;">No production buildings detected</td></tr>';
      } else {
        var groupsMap = {};
        var groupOrder = [];
        for (var pbx = 0; pbx < pb.length; pbx++) {
          var bKey = pb[pbx].buildingId || '—';
          if (!groupsMap[bKey]) {
            groupsMap[bKey] = [];
            groupOrder.push(bKey);
          }
          groupsMap[bKey].push(pb[pbx]);
        }
        for (var gi = 0; gi < groupOrder.length; gi++) {
          var bid = groupOrder[gi];
          var instances = groupsMap[bid];
          var combinedOutMap = combineGroupOutputs(instances);
          var groupId = 'p-' + isi + '-' + gi;
          var icount = instances.length;
          var showToggle = icount > 1;
          var combinedOutStr = formatBuildingOutputs(combinedOutMap, null, bid, primaryOnly);
          var cd0 = instances[0].cooldownSeconds;
          var sameCd = true;
          for (var icd = 1; icd < instances.length; icd++) {
            if (instances[icd].cooldownSeconds !== cd0) sameCd = false;
          }
          var cdDisplay = sameCd && cd0 != null ? cd0 + 's' : 'varies';
          html += '<tr class="sa-prod-summary">';
          html += '<td>';
          if (showToggle) {
            html +=
              '<button type="button" class="sa-prod-toggle header-btn" style="padding:2px 8px;font-size:0.75rem;min-width:28px;" aria-expanded="false" data-sa-group="' +
              escapeHtml(groupId) +
              '" onclick="window.toggleSaveAnalysisProdDetail(this)">▸</button>';
          } else {
            html += '<span style="display:inline-block;width:28px"></span>';
          }
          html += '</td>';
          html +=
            '<td>' +
            escapeHtml(bid) +
            (icount > 1 ? ' <span class="save-analysis-badge">' + icount + '×</span>' : '') +
            '</td>';
          html += '<td>' + escapeHtml(combinedOutStr) + '</td>';
          html += '<td class="num">' + escapeHtml(cdDisplay) + '</td>';
          var boostedN = 0;
          var inSiloAreaN = 0;
          var paddockBoostedN = 0;
          for (var ib = 0; ib < instances.length; ib++) {
            if (instances[ib].siloBoosted) boostedN++;
            if (instances[ib].insideSiloFootprint) inSiloAreaN++;
            if (instances[ib].paddockBoosted) paddockBoostedN++;
          }
          var sumNotes = [];
          if (boostedN === icount && icount > 0) sumNotes.push('all silo boosted');
          else if (boostedN > 0) sumNotes.push(boostedN + '/' + icount + ' silo boosted');
          if (inSiloAreaN > 0 && inSiloAreaN !== boostedN) {
            sumNotes.push(inSiloAreaN + '/' + icount + ' in silo 5×5 (×2 only if tile util full)');
          }
          if (paddockBoostedN === icount && icount > 0) sumNotes.push('all paddock boosted');
          else if (paddockBoostedN > 0) sumNotes.push(paddockBoostedN + '/' + icount + ' paddock boosted');
          var tileMin = null;
          var tileMax = null;
          for (var it = 0; it < instances.length; it++) {
            var tf = instances[it].tileUtilizationFactor;
            if (typeof tf === 'number' && isFinite(tf)) {
              if (tileMin === null || tf < tileMin) tileMin = tf;
              if (tileMax === null || tf > tileMax) tileMax = tf;
            }
          }
          if (tileMin !== null && tileMin < 0.999) {
            if (icount > 1 && tileMax !== null && Math.abs(tileMax - tileMin) > 1e-6) {
              sumNotes.push('tile util ' + roundRate(tileMin) + '–' + roundRate(tileMax));
            } else {
              sumNotes.push('tile util ×' + roundRate(tileMin));
            }
          }
          html += '<td>' + escapeHtml(sumNotes.join(' · ') || '—') + '</td>';
          html += '</tr>';
          if (showToggle) {
            for (var ii3 = 0; ii3 < instances.length; ii3++) {
              var inst = instances[ii3];
              var instOut = formatBuildingOutputs(
                inst.outputPerMinuteByResourceId,
                inst.multiplier,
                inst.buildingId,
                primaryOnly
              );
              var n2 = [];
              if (inst.siloBoosted) n2.push('silo ×' + roundRate(inst.siloMultiplier || 1));
              else if (inst.insideSiloFootprint) n2.push('in silo 5×5 (no ×2: partial tile util)');
              if (inst.paddockBoosted) n2.push('paddock ×' + roundRate(inst.paddockMultiplier || 1));
              if (
                typeof inst.tileUtilizationFactor === 'number' &&
                isFinite(inst.tileUtilizationFactor) &&
                inst.tileUtilizationFactor < 0.999
              ) {
                n2.push('tile ×' + roundRate(inst.tileUtilizationFactor));
              }
              var xyStr =
                Array.isArray(inst.xy) && inst.xy.length >= 2 ? '(' + inst.xy[0] + ', ' + inst.xy[1] + ')' : '—';
              html +=
                '<tr class="sa-prod-detail" data-sa-detail-for="' +
                escapeHtml(groupId) +
                '" style="display:none;background:rgba(0,0,0,0.12)">';
              html += '<td></td>';
              html +=
                '<td style="padding-left:10px;font-size:0.78rem;color:#aaa;">' + escapeHtml(xyStr) + '</td>';
              html += '<td>' + escapeHtml(instOut) + '</td>';
              html +=
                '<td class="num">' +
                escapeHtml(inst.cooldownSeconds != null ? inst.cooldownSeconds + 's' : '—') +
                '</td>';
              html += '<td>' + escapeHtml(n2.join(' ') || '—') + '</td>';
              html += '</tr>';
            }
          }
        }
      }
      html += '</tbody></table></div></div></details>';
    }
    if (!islands.length) html += '<p class="save-analysis-empty-state">No islands in save.</p>';

    el.innerHTML = html;
  }

  window.toggleSaveAnalysisProdDetail = function (btn) {
    if (!btn) return;
    var id = btn.getAttribute('data-sa-group');
    if (!id) return;
    var expanded = btn.getAttribute('aria-expanded') === 'true';
    var next = !expanded;
    btn.setAttribute('aria-expanded', next ? 'true' : 'false');
    btn.textContent = next ? '▾' : '▸';
    var tbody = btn.closest('tbody');
    if (!tbody) return;
    var rows = tbody.querySelectorAll('tr.sa-prod-detail');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-sa-detail-for') === id) {
        rows[i].style.display = next ? 'table-row' : 'none';
      }
    }
  };

  function setStatus(msg, isError) {
    var st = document.getElementById('save-analysis-status');
    if (!st) return;
    st.textContent = msg || '';
    st.className = 'save-analysis-status' + (isError ? ' error-text' : msg ? ' ok-text' : '');
  }

  function openSaveAnalysis() {
    var app = document.getElementById('app');
    if (!app) return;
    app.classList.add('save-analysis-mode');
    var panel = document.getElementById('save-analysis-panel');
    if (panel) panel.setAttribute('aria-hidden', 'false');
  }

  function closeSaveAnalysis() {
    var app = document.getElementById('app');
    if (app) app.classList.remove('save-analysis-mode');
    var panel = document.getElementById('save-analysis-panel');
    if (panel) panel.setAttribute('aria-hidden', 'true');
  }

  function onFileSelected(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var text = reader.result;
        var json = JSON.parse(typeof text === 'string' ? text : String(text));
        ensureCatalogs().then(function (cats) {
          var catalogsLoaded = !!(cats && cats.dataFilesOk);
          try {
            if (typeof window !== 'undefined') {
              window.__saResourceNames = cats.resourceNames || {};
            }
            var result = parsePp2SaveJson(json, cats);
            setStatus('Parsed successfully.', false);
            if (typeof window !== 'undefined') {
              window.__saLastAnalysis = {
                result: result,
                fileLabel: file.name,
                catalogsLoaded: catalogsLoaded,
              };
            }
            renderAnalysis(result, file.name, catalogsLoaded);
          } catch (e2) {
            console.error(e2);
            setStatus('Parse error: ' + (e2 && e2.message ? e2.message : String(e2)), true);
            document.getElementById('save-analysis-dashboard').innerHTML =
              '<div class="save-analysis-empty-state">Could not interpret this file as a PP2 save JSON.</div>';
          }
        });
      } catch (e) {
        console.error(e);
        setStatus('Invalid JSON: ' + (e && e.message ? e.message : String(e)), true);
        document.getElementById('save-analysis-dashboard').innerHTML =
          '<div class="save-analysis-empty-state">File is not valid JSON.</div>';
      }
    };
    reader.onerror = function () {
      setStatus('Could not read file.', true);
    };
    reader.readAsText(file, 'UTF-8');
  }

  function initSaveAnalysis() {
    var btnOpen = document.getElementById('btn-save-analysis');
    var btnBack = document.getElementById('btn-save-analysis-back');
    var fileInput = document.getElementById('save-analysis-file');
    var dash = document.getElementById('save-analysis-dashboard');

    if (dash && !dash.innerHTML.trim()) {
      dash.innerHTML =
        '<div class="save-analysis-empty-state">Choose <strong>Load save file…</strong> to analyze a <code>.dat</code> export.</div>';
    }

    if (btnOpen) {
      btnOpen.addEventListener('click', function () {
        openSaveAnalysis();
      });
    }
    if (btnBack) {
      btnBack.addEventListener('click', function () {
        closeSaveAnalysis();
      });
    }
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        inputChange();
      });
    }

    var primaryChk = document.getElementById('sa-primary-output-only');
    if (primaryChk) {
      try {
        primaryChk.checked = localStorage.getItem('sa-primary-only') === '1';
      } catch (eLs) {
        /* ignore */
      }
      primaryChk.addEventListener('change', function () {
        try {
          localStorage.setItem('sa-primary-only', primaryChk.checked ? '1' : '0');
        } catch (eLs2) {
          /* ignore */
        }
        if (typeof window !== 'undefined' && window.__saLastAnalysis) {
          var la = window.__saLastAnalysis;
          renderAnalysis(la.result, la.fileLabel, la.catalogsLoaded);
        }
      });
    }

    function inputChange() {
      var f = fileInput.files && fileInput.files[0];
      if (f) onFileSelected(f);
      fileInput.value = '';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSaveAnalysis);
  } else {
    initSaveAnalysis();
  }
})();
