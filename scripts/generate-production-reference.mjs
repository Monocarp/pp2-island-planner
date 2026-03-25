#!/usr/bin/env node
/**
 * Parses ElQDuck paragon-pioneers-2-calculator production-chain TSX files
 * and writes data/production-reference*.json|csv|md
 *
 * Usage:
 *   node scripts/generate-production-reference.mjs
 *   node scripts/generate-production-reference.mjs --root "C:/path/to/production-chain"
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_CHAIN_ROOT = path.join(
  REPO_ROOT,
  'vendor/paragon-pioneers-2-calculator/src/pages/production-chain'
);

const SCHEMA_VERSION = 1;

function parseArgs() {
  const args = process.argv.slice(2);
  let root = process.env.PP2_PRODUCTION_CHAIN_ROOT || DEFAULT_CHAIN_ROOT;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) {
      root = path.resolve(args[++i]);
    }
  }
  return { root };
}

function safeEvalNumber(expr) {
  const s = String(expr).trim().replace(/;$/, '');
  if (!s) return NaN;
  const simple = /^-?[\d.]+$/;
  if (simple.test(s)) return parseFloat(s);
  if (!/^[-\d.+\-*/()\s]+$/.test(s)) return NaN;
  try {
    return Function(`"use strict"; return (${s})`)();
  } catch {
    return NaN;
  }
}

/** Extract balanced [...] content starting at first [ after idx */
function sliceBalancedBrackets(str, startIdx) {
  const i = str.indexOf('[', startIdx);
  if (i < 0) return null;
  let depth = 0;
  for (let j = i; j < str.length; j++) {
    const c = str[j];
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return { start: i, end: j + 1, inner: str.slice(i + 1, j) };
    }
  }
  return null;
}

/**
 * Parse Map body: new Map(...)([ ... ]) or new Map<...>([ ... ])
 */
function extractConsumeMapInner(source) {
  const marker = 'CONSUME_PER_ITERATION';
  const pos = source.indexOf(marker);
  if (pos < 0) return null;
  const after = source.slice(pos);
  const mapKw = after.indexOf('new Map');
  if (mapKw < 0) return null;
  const fromMap = after.slice(mapKw);
  const openParen = fromMap.indexOf('(');
  if (openParen < 0) return null;
  const bal = sliceBalancedBrackets(fromMap, openParen);
  if (!bal) return null;
  return bal.inner;
}

/** Parse ['Key', num] or ["Key", expr] entries from map array body */
function parseMapEntries(inner) {
  const out = [];
  if (!inner) return out;
  const trimmed = inner.trim();
  if (!trimmed) return out;

  let i = 0;
  while (i < trimmed.length) {
    while (i < trimmed.length && /\s|,/.test(trimmed[i])) i++;
    if (i >= trimmed.length) break;
    if (trimmed[i] !== '[') {
      i++;
      continue;
    }
    const pairStart = i;
    let depth = 0;
    let j = i;
    for (; j < trimmed.length; j++) {
      if (trimmed[j] === '[') depth++;
      else if (trimmed[j] === ']') {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
    }
    const segment = trimmed.slice(pairStart, j);
    const m = segment.match(/^\[\s*['"]([^'"]+)['"]\s*,\s*(.+)\s*\]$/s);
    if (m) {
      const key = m[1];
      const valRaw = m[2].trim();
      const val = safeEvalNumber(valRaw);
      out.push({ key, valuePerIteration: val, valueRaw: valRaw });
    }
    i = j;
  }
  return out;
}

function pascalToWords(name) {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .trim();
}

function walkTsxFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkTsxFiles(p, acc);
    else if (ent.name.endsWith('.tsx')) acc.push(p);
  }
  return acc;
}

function parseBuildingFile(filePath, source, tier) {
  const base = path.basename(filePath, '.tsx');
  const infoMatch = source.match(/export\s+const\s+(\w+_INFO)\s*:\s*Building/);
  if (!infoMatch) return null;

  const iterM = source.match(/const\s+ITERATION_TIME_IN_SECONDS\s*=\s*(\d+)/);
  const iterationSeconds = iterM ? parseInt(iterM[1], 10) : NaN;
  if (!Number.isFinite(iterationSeconds) || iterationSeconds <= 0) return null;

  const iterationDecimal = iterationSeconds / 60;

  const produceM = source.match(/const\s+PRODUCE_PER_ITERATION\s*=\s*([^;\n]+)/);
  let producePerIteration = NaN;
  if (produceM) {
    const raw = produceM[1].replace(/\r/g, '').replace(/\/\/[^\n]*/, '').trim();
    producePerIteration = safeEvalNumber(raw);
  }

  const mapInner = extractConsumeMapInner(source);
  const rawEntries = parseMapEntries(mapInner || '');
  const consumePerIteration = {};
  const consumePerMinute = {};
  for (const e of rawEntries) {
    if (!Number.isFinite(e.valuePerIteration)) continue;
    consumePerIteration[e.key] = e.valuePerIteration;
    consumePerMinute[e.key] = e.valuePerIteration / iterationDecimal;
  }

  const producePerMinute = Number.isFinite(producePerIteration)
    ? producePerIteration / iterationDecimal
    : null;

  return {
    kind: 'building',
    id: base,
    infoExport: infoMatch[1],
    tier,
    displayName: pascalToWords(base),
    iterationSeconds,
    consumePerIteration,
    consumePerMinute,
    producePerIteration: Number.isFinite(producePerIteration) ? producePerIteration : null,
    producePerMinute,
  };
}

function parseTileFile(filePath, source) {
  const base = path.basename(filePath, '.tsx');
  const infoMatch = source.match(/export\s+const\s+(\w+_INFO)\s*:\s*Tile/);
  if (!infoMatch) return null;

  const iterM = source.match(/const\s+ITERATION_TIME_IN_SECONDS\s*=\s*(\d+)/);
  const iterationSeconds = iterM ? parseInt(iterM[1], 10) : NaN;
  if (!Number.isFinite(iterationSeconds) || iterationSeconds <= 0) return null;

  const iterationDecimal = iterationSeconds / 60;

  const produceM = source.match(/const\s+PRODUCE_PER_ITERATION\s*=\s*([^;\n]+)/);
  let producePerIteration = NaN;
  if (produceM) {
    const raw = produceM[1].replace(/\r/g, '').replace(/\/\/[^\n]*/, '').trim();
    producePerIteration = safeEvalNumber(raw);
  }

  const producePerMinute = Number.isFinite(producePerIteration)
    ? producePerIteration / iterationDecimal
    : null;

  return {
    kind: 'tile',
    id: base,
    infoExport: infoMatch[1],
    displayName: pascalToWords(base),
    iterationSeconds,
    producePerIteration: Number.isFinite(producePerIteration) ? producePerIteration : null,
    producePerMinute,
  };
}

function csvEscape(s) {
  const t = String(s ?? '');
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

function getGitCommit(chainRoot) {
  try {
    const vendorRoot = path.resolve(chainRoot, '../../..');
    const out = execSync('git rev-parse HEAD', {
      cwd: vendorRoot,
      encoding: 'utf8',
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function main() {
  const { root } = parseArgs();
  const buildingsDir = path.join(root, 'buildings');
  const tilesDir = path.join(root, 'tiles');

  if (!fs.existsSync(root)) {
    console.error(`Missing production-chain root: ${root}`);
    console.error('Clone with: git clone --depth 1 https://github.com/ElQDuck/paragon-pioneers-2-calculator.git vendor/paragon-pioneers-2-calculator');
    process.exit(1);
  }

  const warnings = [];
  const buildings = [];
  const buildingFiles = walkTsxFiles(buildingsDir);

  for (const fp of buildingFiles) {
    const rel = path.relative(buildingsDir, fp);
    const tier = rel.split(path.sep)[0] || '';
    let src;
    try {
      src = fs.readFileSync(fp, 'utf8');
    } catch (e) {
      warnings.push(`read fail ${fp}: ${e.message}`);
      continue;
    }
    const row = parseBuildingFile(fp, src, tier);
    if (row) buildings.push(row);
    else if (/export\s+const\s+\w+_INFO\s*:\s*Building/.test(src)) {
      warnings.push(`parse failed (building): ${path.relative(REPO_ROOT, fp)}`);
    }
  }

  const tiles = [];
  const tileFiles = walkTsxFiles(tilesDir);
  for (const fp of tileFiles) {
    let src;
    try {
      src = fs.readFileSync(fp, 'utf8');
    } catch (e) {
      warnings.push(`read fail ${fp}: ${e.message}`);
      continue;
    }
    const row = parseTileFile(fp, src);
    if (row) tiles.push(row);
    else if (/export\s+const\s+\w+_INFO\s*:\s*Tile/.test(src)) {
      warnings.push(`parse failed (tile): ${path.relative(REPO_ROOT, fp)}`);
    }
  }

  buildings.sort((a, b) => (a.tier + a.id).localeCompare(b.tier + b.id));
  tiles.sort((a, b) => a.id.localeCompare(b.id));

  const generatedAt = new Date().toISOString();
  const sourceCommit = getGitCommit(root);

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    source: {
      repository: 'https://github.com/ElQDuck/paragon-pioneers-2-calculator',
      productionChainPath: 'src/pages/production-chain',
      commit: sourceCommit,
      localRoot: path.relative(REPO_ROOT, root).replace(/\\/g, '/'),
    },
    warnings,
    buildings,
    tiles,
  };

  const dataDir = path.join(REPO_ROOT, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const jsonPath = path.join(dataDir, 'production-reference.json');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Wrote ${jsonPath} (${buildings.length} buildings, ${tiles.length} tiles)`);

  const bCsvPath = path.join(dataDir, 'production-reference-buildings.csv');
  const bHeader = [
    'tier',
    'id',
    'displayName',
    'iterationSeconds',
    'consumePerIterationJson',
    'consumePerMinuteJson',
    'producePerIteration',
    'producePerMinute',
  ].join(',');
  const bLines = [bHeader];
  for (const b of buildings) {
    bLines.push(
      [
        csvEscape(b.tier),
        csvEscape(b.id),
        csvEscape(b.displayName),
        b.iterationSeconds,
        csvEscape(JSON.stringify(b.consumePerIteration)),
        csvEscape(JSON.stringify(b.consumePerMinute)),
        b.producePerIteration ?? '',
        b.producePerMinute ?? '',
      ].join(',')
    );
  }
  fs.writeFileSync(bCsvPath, bLines.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${bCsvPath}`);

  const tCsvPath = path.join(dataDir, 'production-reference-tiles.csv');
  const tHeader = ['id', 'displayName', 'iterationSeconds', 'producePerIteration', 'producePerMinute'].join(',');
  const tLines = [tHeader];
  for (const t of tiles) {
    tLines.push(
      [
        csvEscape(t.id),
        csvEscape(t.displayName),
        t.iterationSeconds,
        t.producePerIteration ?? '',
        t.producePerMinute ?? '',
      ].join(',')
    );
  }
  fs.writeFileSync(tCsvPath, tLines.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${tCsvPath}`);

  const md = [];
  md.push('# Production / consumption reference');
  md.push('');
  md.push(`Generated: **${generatedAt}**`);
  md.push(`Source: [ElQDuck/paragon-pioneers-2-calculator](https://github.com/ElQDuck/paragon-pioneers-2-calculator) (\`src/pages/production-chain\`)`);
  if (sourceCommit) md.push(`Vendor commit: \`${sourceCommit}\``);
  md.push('');
  md.push('Rates follow the calculator: **per minute = per iteration / (iterationSeconds / 60)**.');
  md.push('');
  md.push(`- **Buildings:** ${buildings.length} rows — see \`data/production-reference-buildings.csv\` or \`buildings\` in \`production-reference.json\`.`);
  md.push(`- **Tiles:** ${tiles.length} rows — see \`data/production-reference-tiles.csv\` or \`tiles\` in \`production-reference.json\`.`);
  md.push('');
  if (warnings.length) {
    md.push('## Generator warnings');
    md.push('');
    for (const w of warnings) md.push(`- ${w}`);
    md.push('');
  }
  md.push('## Buildings by tier (summary)');
  md.push('');
  md.push('| Tier | Count |');
  md.push('|------|-------|');
  const byTier = {};
  for (const b of buildings) {
    byTier[b.tier] = (byTier[b.tier] || 0) + 1;
  }
  for (const tier of Object.keys(byTier).sort()) {
    md.push(`| ${tier} | ${byTier[tier]} |`);
  }
  md.push('');

  const mdPath = path.join(dataDir, 'production-reference.md');
  fs.writeFileSync(mdPath, md.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${mdPath}`);

  if (warnings.length) {
    console.warn('Warnings:', warnings.length);
    for (const w of warnings) console.warn(' ', w);
  }
}

main();
