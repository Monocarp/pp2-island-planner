import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parsePp2SaveJson } from '../scripts/parse-pp2-save.mjs';
import { computeAreaBoost } from '../scripts/save-area-boost.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'minimal-save.json');

test('minimal save: stock for resource 2', () => {
  const save = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const r = parsePp2SaveJson(save, {});
  assert.strictEqual(r.stocks['2'], 999);
});

test('minimal save: Fisherman uses planner fallback 1 fish / 90s (ignores OutputResources stock)', () => {
  const save = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const r = parsePp2SaveJson(save, {});
  const island = r.islands[0];
  assert.strictEqual(island.productionBuildings.length, 1);
  const row = island.productionBuildings[0];
  assert.strictEqual(row.rateSource, 'plannerFallback');
  const fish = row.outputPerMinuteByResourceId['2'];
  assert.ok(fish);
  assert.ok(Math.abs(fish.perMinute - 2 / 3) < 1e-5);
});

test('minimal save: ship joined to ships.json caravel', () => {
  const save = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const r = parsePp2SaveJson(save, {});
  assert.strictEqual(r.ships.length, 1);
  assert.strictEqual(r.ships[0].type, 2);
  assert.strictEqual(r.ships[0].shipClass, 'Caravel');
});

test('minimal save: research id 4 present', () => {
  const save = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const r = parsePp2SaveJson(save, {});
  assert.strictEqual(r.researchCompleted[0].researchId, 4);
});

test('rickyard: ×2 in silo 5×5 even when tile utilization is partial (boost × base)', () => {
  const ent = { id: 'PigRanch', xy: [1, 0], components: { gatherer: {} } };
  const resolved = { plannerBuildingId: 'PigRanch' };
  const siloAnchors = [[0, 0]];
  assert.strictEqual(
    computeAreaBoost(ent, resolved, siloAnchors, [], { tileUtilizationFactor: 1 }).multiplier,
    2
  );
  const partial = computeAreaBoost(ent, resolved, siloAnchors, [], { tileUtilizationFactor: 0.75 });
  assert.strictEqual(partial.multiplier, 2);
  assert.strictEqual(partial.insideSiloFootprint, true);
  assert.strictEqual(partial.siloBoosted, true);
});

test('rickyard: pig anchor inside Silo 5×5 gets ×2; outside Chebyshev 2 does not', () => {
  const p = path.join(__dirname, 'fixtures', 'rickyard-boost-save.json');
  const save = JSON.parse(fs.readFileSync(p, 'utf8'));
  const r = parsePp2SaveJson(save, { skipTileUtilization: true });
  const rows = r.islands[0].productionBuildings;
  assert.strictEqual(rows.length, 2);
  const boosted = rows.find(x => x.xy[0] === 5 && x.xy[1] === 6);
  const away = rows.find(x => x.xy[0] === 8);
  assert.ok(boosted.siloBoosted);
  assert.ok(Math.abs(boosted.totalOutputPerMinute - 4) < 1e-5);
  assert.ok(!away.siloBoosted);
  assert.ok(Math.abs(away.totalOutputPerMinute - 2) < 1e-5);
});

test('new_bursting_cay: cattle at (17,14) in silo 5×5 at (15,13) is siloBoosted with partial tile util', () => {
  const p = path.join(__dirname, '..', 'data', 'new_bursting_cay.json');
  const island = JSON.parse(fs.readFileSync(p, 'utf8'));
  const save = { SaveFileVersion: 20, IslandManager: { islands: [island] } };
  const r = parsePp2SaveJson(save, {});
  const row = r.islands[0].productionBuildings.find(
    b => b.buildingId === 'CattleFarm' && b.xy[0] === 17 && b.xy[1] === 14
  );
  assert.ok(row);
  assert.strictEqual(row.insideSiloFootprint, true);
  assert.strictEqual(row.siloBoosted, true);
  assert.ok(Math.abs(row.tileUtilizationFactor - 0.75) < 1e-5);
  assert.ok(Math.abs(row.multiplier - 1.5) < 1e-5);
});

test('tile overlap: adjacent 3×3 ranches split shared grass 50/50 (6 effective / 8 needed → 0.75)', () => {
  const p = path.join(__dirname, 'fixtures', 'tile-overlap-save.json');
  const save = JSON.parse(fs.readFileSync(p, 'utf8'));
  const r = parsePp2SaveJson(save, {});
  const island = r.islands[0];
  assert.strictEqual(island.productionBuildings.length, 2);
  const byPlanner = Object.fromEntries(
    island.productionBuildings.map(row => [row.plannerBuildingId, row])
  );
  assert.ok(Math.abs(byPlanner.PigRanch.tileUtilizationFactor - 0.75) < 1e-5);
  assert.ok(Math.abs(byPlanner.CattleRanch.tileUtilizationFactor - 0.75) < 1e-5);
  assert.ok(Math.abs(byPlanner.PigRanch.totalOutputPerMinute - 1.5) < 1e-5);
  assert.ok(Math.abs(byPlanner.CattleRanch.totalOutputPerMinute - 0.1875) < 1e-5);
});
