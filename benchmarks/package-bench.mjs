import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  collectFrontierAnnotationSourceRecords,
  planFrontierAnnotationHarness
} from '../dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(packageDir, '..', '..');
const args = parseArgs(process.argv.slice(2));
const rounds = readPositiveInt(args.rounds, 9);
const sourceCount = readPositiveInt(args.sources, 250);
const outPath = args.out ? path.resolve(repoRoot, args.out) : null;
const fixtureDir = path.join(packageDir, 'benchmarks', '.tmp-source-fixture');

fs.rmSync(fixtureDir, { recursive: true, force: true });
fs.mkdirSync(path.join(fixtureDir, 'src', 'components'), { recursive: true });
for (let index = 0; index < sourceCount; index++) {
  const name = index === 0 ? 'SaveButton' : 'Component' + index;
  const testId = index === 0 ? 'save-button' : 'component-' + index;
  fs.writeFileSync(
    path.join(fixtureDir, 'src', 'components', name + '.tsx'),
    'export function ' + name + '() { return <button data-testid="' + testId + '">' + name + '</button>; }\n',
    'utf8'
  );
}

const scanSamples = [];
const planSamples = [];
for (let round = 0; round < rounds; round++) {
  let start = performance.now();
  const sources = collectFrontierAnnotationSourceRecords({ cwd: fixtureDir, sourceRoots: ['src'] });
  scanSamples.push((performance.now() - start) * 1000);
  start = performance.now();
  const artifacts = planFrontierAnnotationHarness(makeAnnotation(), {
    cwd: fixtureDir,
    sourceRecords: sources,
    verification: ['npm test'],
    outDir: 'agent-runs/bench'
  });
  planSamples.push((performance.now() - start) * 1000);
  if (artifacts.contexts[0].sourceRefs[0] !== 'src/components/SaveButton.tsx') throw new Error('planner fixture failed');
}

const rowsOut = [
  summarize('Scan source records', scanSamples, sourceCount),
  summarize('Plan swarm artifacts', planSamples, 1)
];
const report = {
  package: '@shapeshift-labs/frontier-annotations-harness',
  version: readPackageVersion(),
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform + ' ' + process.arch,
  sourceCount,
  rounds,
  rowsOut
};

if (outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
}

console.log(report.package + ' package benchmark');
console.log('Node ' + report.node + ' on ' + report.platform + ', sources=' + sourceCount + ', rounds=' + rounds);
console.log('These are Frontier-only package measurements, not competitor comparisons.');
console.log('');
console.log(padRight('Fixture', 30) + padLeft('Median', 12) + padLeft('p95', 12) + padLeft('Items', 10));
for (const row of rowsOut) {
  console.log(padRight(row.fixture, 30) + padLeft(formatUs(row.medianUs), 12) + padLeft(formatUs(row.p95Us), 12) + padLeft(String(row.items), 10));
}
if (outPath) console.log('\nwrote ' + path.relative(repoRoot, outPath));

fs.rmSync(fixtureDir, { recursive: true, force: true });

function makeAnnotation() {
  return {
    kind: 'frontier.annotations.annotation',
    version: 1,
    id: 'bench-annotation',
    note: 'Make the save button clearer.',
    thread: {
      id: 'bench-thread',
      messages: [{ id: 'message-1', body: 'Make the save button clearer.', createdAt: 1, status: 'submitted' }]
    },
    target: {
      tagName: 'button',
      selector: '[data-testid="save-button"]',
      cssPath: 'main > button.primary',
      attributes: { 'data-testid': 'save-button' },
      dataset: { testid: 'save-button' },
      rect: { x: 0, y: 0, width: 120, height: 32, top: 0, right: 120, bottom: 32, left: 0 },
      ancestry: [{ tagName: 'button', selector: '[data-testid="save-button"]', testId: 'save-button' }],
      text: 'Save draft'
    },
    css: [],
    sourceHints: [{ file: 'src/components/SaveButton.tsx', symbol: 'SaveButton' }],
    route: '/editor',
    createdAt: 1,
    status: 'submitted'
  };
}

function summarize(fixture, samples, items) {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    fixture,
    medianUs: percentile(sorted, 0.5),
    p95Us: percentile(sorted, 0.95),
    items
  };
}

function percentile(sorted, ratio) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))] ?? 0;
}

function formatUs(value) {
  return value >= 1000 ? (value / 1000).toFixed(2) + 'ms' : value.toFixed(1) + 'us';
}

function padRight(value, length) {
  return String(value).padEnd(length);
}

function padLeft(value, length) {
  return String(value).padStart(length);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--out') parsed.out = argv[++index];
    else if (arg.startsWith('--out=')) parsed.out = arg.slice('--out='.length);
    else if (arg === '--rounds') parsed.rounds = argv[++index];
    else if (arg.startsWith('--rounds=')) parsed.rounds = arg.slice('--rounds='.length);
    else if (arg === '--sources') parsed.sources = argv[++index];
    else if (arg.startsWith('--sources=')) parsed.sources = arg.slice('--sources='.length);
    else throw new Error('unknown argument: ' + arg);
  }
  return parsed;
}

function readPositiveInt(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function readPackageVersion() {
  return JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')).version;
}
