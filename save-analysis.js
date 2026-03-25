// ===== SAVE ANALYSIS (browser tab) =====
// Parses PP2 .dat saves (UTF-8 JSON) and shows stocks, production, ships, routes.
// Logic aligned with scripts/parse-pp2-save.mjs; catalogs loaded from /data/*.json when possible.

(function () {
  'use strict';

  /** Embedded fallback when fetch fails (e.g. file://). */
  const DEFAULT_MODIFIERS = {
    siloProximityChebyshevDistance: 4,
    siloEntityIdContains: 'Silo',
    siloBoostMultipliers: {
      StrawberryFarm: 2.5,
      SheepFarm: 1.2,
      PigRanch: 1.2,
      CattleFarm: 1.2,
      HorseFarm: 1.2,
      CrocodileRanch: 1.2,
      GoatFarm: 1.2,
    },
    defaultSiloBoostMultiplier: 1.0,
    skipEntityIdSubstrings: ['Warehouse', 'Kontor', 'Portal', 'Silo', 'Forest', 'Field', 'Pasture'],
    productionComponentKeysPreferred: ['harvester', 'factory', 'gatherer', 'miner', 'smelter'],
  };

  let catalogsCache = null;

  function chebyshev(xyA, xyB) {
    if (!Array.isArray(xyA) || !Array.isArray(xyB) || xyA.length < 2 || xyB.length < 2) return Infinity;
    return Math.max(Math.abs(xyA[0] - xyB[0]), Math.abs(xyA[1] - xyB[1]));
  }

  function findProductionTimer(components, preferredKeys) {
    if (!components || typeof components !== 'object') return null;
    for (var i = 0; i < preferredKeys.length; i++) {
      var k = preferredKeys[i];
      var cd = components[k] && components[k].Timer && components[k].Timer.Cooldown;
      if (typeof cd === 'number' && cd > 0) return { componentKey: k, cooldown: cd };
    }
    for (var key in components) {
      if (!Object.prototype.hasOwnProperty.call(components, key)) continue;
      var v = components[key];
      if (!v || typeof v !== 'object') continue;
      var c2 = v.Timer && v.Timer.Cooldown;
      if (typeof c2 === 'number' && c2 > 0) return { componentKey: key, cooldown: c2 };
    }
    return null;
  }

  function shouldSkipEntityId(id, substrings) {
    if (!id || typeof id !== 'string') return true;
    for (var i = 0; i < substrings.length; i++) {
      if (id.indexOf(substrings[i]) !== -1) return true;
    }
    return false;
  }

  function parseOutputRates(internalstorage, cooldown) {
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
      o[k] = { perMinute: byId[k], name: nameMap[k] || nameMap[String(k)] || null };
    }
    return o;
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
    ]).then(function (parts) {
      var modifiers = parts[0] || DEFAULT_MODIFIERS;
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

      catalogsCache = {
        modifiers: modifiers,
        resourceNames: rn,
        shipsCatalog: shipsCatalog,
        shipByType: shipByType,
        researchById: researchById,
        researchUnlocks: researchUnlocks.researchIdToBuildingIds || {},
        dataFilesOk: !!(parts[2] && parts[2].resource_names),
      };
      return catalogsCache;
    });
  }

  function parsePp2SaveJson(save, catalogs) {
    var modifiers = catalogs.modifiers || DEFAULT_MODIFIERS;
    var skipSubs = modifiers.skipEntityIdSubstrings || DEFAULT_MODIFIERS.skipEntityIdSubstrings;
    var preferred = modifiers.productionComponentKeysPreferred || DEFAULT_MODIFIERS.productionComponentKeysPreferred;
    var boostTable = modifiers.siloBoostMultipliers || {};
    var defaultBoost = modifiers.defaultSiloBoostMultiplier != null ? modifiers.defaultSiloBoostMultiplier : 1;
    var siloDist = modifiers.siloProximityChebyshevDistance != null ? modifiers.siloProximityChebyshevDistance : 4;
    var siloNeedle = modifiers.siloEntityIdContains || 'Silo';
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

      var siloPositions = [];
      for (var ei = 0; ei < entities.length; ei++) {
        var e0 = entities[ei];
        if (e0.id && String(e0.id).indexOf(siloNeedle) !== -1 && Array.isArray(e0.xy) && e0.xy.length >= 2) {
          siloPositions.push(e0.xy);
        }
      }

      var buildingSummaries = [];
      for (var ej = 0; ej < entities.length; ej++) {
        var ent = entities[ej];
        var bid = ent.id;
        if (shouldSkipEntityId(bid, skipSubs)) continue;

        var comps = ent.components;
        var timerInfo = findProductionTimer(comps, preferred);
        if (!timerInfo) continue;

        var cooldown = timerInfo.cooldown;
        var internal = comps.internalstorage;
        var boosted = false;
        var xy = ent.xy;
        if (Array.isArray(xy) && xy.length >= 2 && siloPositions.length > 0) {
          for (var sp = 0; sp < siloPositions.length; sp++) {
            if (chebyshev(xy, siloPositions[sp]) <= siloDist) {
              boosted = true;
              break;
            }
          }
        }

        var mult = boosted ? (boostTable[bid] != null ? boostTable[bid] : defaultBoost) : 1.0;
        var rates = parseOutputRates(internal, cooldown);
        var byResourceId = rates.byResourceId;
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
          xy: xy,
          componentKey: timerInfo.componentKey,
          cooldownSeconds: cooldown,
          siloBoosted: boosted,
          multiplier: mult,
          outputPerMinuteByResourceId: enrichResourceNames(scaled, resourceNames),
          totalOutputPerMinute: scaledTotal || rates.totalPerMinute * mult,
        });
      }

      islands.push({
        uid: uid,
        name: name,
        entityCount: entities.length,
        siloCount: siloPositions.length,
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

  function formatPopulationTiers(tiers) {
    if (!tiers || typeof tiers !== 'object') return '—';
    var parts = [];
    for (var k in tiers) {
      if (Object.prototype.hasOwnProperty.call(tiers, k)) parts.push(escapeHtml(k) + ': ' + escapeHtml(tiers[k]));
    }
    return parts.length ? parts.join(' · ') : '—';
  }

  function renderAnalysis(result, fileLabel, catalogsLoaded) {
    var el = document.getElementById('save-analysis-dashboard');
    if (!el) return;

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

    var html = '';

    if (result.warnings && result.warnings.length) {
      html += '<div class="save-analysis-warnings"><strong>Note</strong><ul style="margin:8px 0 0 18px;">';
      for (var w = 0; w < result.warnings.length; w++) {
        html += '<li>' + escapeHtml(result.warnings[w]) + '</li>';
      }
      html += '</ul></div>';
    }

    html += '<div class="save-analysis-cards">';
    html +=
      '<div class="save-analysis-card"><div class="save-analysis-card-label">Population cap</div><div class="save-analysis-card-value">' +
      escapeHtml(pop.maxPopulationCount != null ? pop.maxPopulationCount : '—') +
      '</div></div>';
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

    html += '<div class="save-analysis-section"><h3>Population tiers</h3>';
    html += '<p style="font-size:0.85rem;color:#ccc;line-height:1.5;">' + formatPopulationTiers(pop.populationTiers) + '</p></div>';

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
        ' silos</span></summary>';
      html += '<div class="save-analysis-island-body"><div class="save-analysis-table-wrap"><table class="save-analysis-table"><thead><tr>';
      html += '<th>Building</th><th>Outputs (/min)</th><th>Cooldown</th><th>Notes</th></tr></thead><tbody>';
      for (var pbi = 0; pbi < pb.length; pbi++) {
        var b = pb[pbi];
        var outs = [];
        for (var ok in b.outputPerMinuteByResourceId) {
          if (!Object.prototype.hasOwnProperty.call(b.outputPerMinuteByResourceId, ok)) continue;
          if (ok === '_fallback') continue;
          var oi = b.outputPerMinuteByResourceId[ok];
          var on = oi.name ? oi.name + ' ' : '';
          outs.push(on + '(' + ok + '): ' + roundRate(oi.perMinute));
        }
        if (!outs.length && b.outputPerMinuteByResourceId._fallback != null) {
          outs.push('combined: ' + roundRate(b.outputPerMinuteByResourceId._fallback.perMinute * (b.multiplier || 1)));
        }
        var notes = [];
        if (b.siloBoosted) notes.push('silo ×' + roundRate(b.multiplier || 1));
        html +=
          '<tr><td>' +
          escapeHtml(b.buildingId || '—') +
          '</td><td>' +
          escapeHtml(outs.join(', ') || '—') +
          '</td><td class="num">' +
          escapeHtml(b.cooldownSeconds != null ? b.cooldownSeconds + 's' : '—') +
          '</td><td>' +
          escapeHtml(notes.join(' ') || '—') +
          '</td></tr>';
      }
      if (!pb.length) html += '<tr><td colspan="4" style="color:#888;">No production buildings detected</td></tr>';
      html += '</tbody></table></div></div></details>';
    }
    if (!islands.length) html += '<p class="save-analysis-empty-state">No islands in save.</p>';

    el.innerHTML = html;
  }

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
            var result = parsePp2SaveJson(json, cats);
            setStatus('Parsed successfully.', false);
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
