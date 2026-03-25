import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parsePp2SaveJson } from '../scripts/parse-pp2-save.mjs';

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

test('rickyard: pig on same cell as Silo anchor is not boosted (distinct anchors only)', () => {
  const save = {
    SaveFileVersion: 20,
    GameTimeManager: { current_tick: 1 },
    ResearchManager: { CompletedResearchTimes: [] },
    PopulationManager: { MaxPopulationCount: [] },
    RouteManager: { SimpleRoutes: [], ComplexRoutes: [] },
    ShipManager: { Ships: [] },
    ResourceManager: { GlobalResources: { Resources: [] } },
    IslandManager: {
      islands: [
        {
          UID: 'same-cell',
          Name: 'Same cell',
          MapSettings: { Region: 1, MapSize: [8, 8] },
          Grid: [],
          GameEntities: [
            { id: 'Silo', xy: [3, 3] },
            {
              id: 'PigRanch',
              xy: [3, 3],
              components: { gatherer: { Timer: { Cooldown: 30 } } },
            },
          ],
        },
      ],
    },
  };
  const r = parsePp2SaveJson(save, { skipTileUtilization: true });
  const row = r.islands[0].productionBuildings[0];
  assert.ok(!row.siloBoosted);
  assert.ok(Math.abs(row.totalOutputPerMinute - 2) < 1e-5);
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
