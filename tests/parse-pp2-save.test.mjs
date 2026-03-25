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

test('minimal save: Fisherman output 5 fish / 90s => 10/3 per minute', () => {
  const save = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const r = parsePp2SaveJson(save, {});
  const island = r.islands[0];
  assert.strictEqual(island.productionBuildings.length, 1);
  const fish = island.productionBuildings[0].outputPerMinuteByResourceId['2'];
  assert.ok(fish);
  assert.ok(Math.abs(fish.perMinute - 10 / 3) < 1e-9);
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
