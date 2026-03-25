import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parsePp2SaveJson } from '../scripts/parse-pp2-save.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'production-accuracy-entities.json');

test('JamMaker: no OutputResources uses planner producePerMinute (~1/3)', () => {
  const save = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const r = parsePp2SaveJson(save, {});
  const island = r.islands[0];
  const jam = island.productionBuildings.find(b => b.buildingId === 'JamMaker');
  assert.ok(jam);
  assert.strictEqual(jam.rateSource, 'plannerFallback');
  assert.ok(Math.abs(jam.totalOutputPerMinute - 1 / 3) < 1e-4);
});

test('Sawmill: internalstorage-only uses planner rate (6 planks/min)', () => {
  const save = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const r = parsePp2SaveJson(save, {});
  const island = r.islands[0];
  const sm = island.productionBuildings.find(b => b.buildingId === 'Sawmill');
  assert.ok(sm);
  assert.strictEqual(sm.rateSource, 'plannerFallback');
  const planks = sm.outputPerMinuteByResourceId['4'];
  assert.ok(planks);
  assert.ok(Math.abs(planks.perMinute - 6) < 1e-6);
});
