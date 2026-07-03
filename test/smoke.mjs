import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectFrontierAnnotationSourceRecords,
  captureFrontierAnnotationScreenshots,
  planFrontierAnnotationHarness,
  startFrontierAnnotationHarnessServer,
  writeFrontierAnnotationHarnessArtifacts
} from '../dist/index.js';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'frontier-annotations-harness-'));
const appDir = path.join(temp, 'app');
fs.mkdirSync(path.join(appDir, 'src', 'components'), { recursive: true });
fs.writeFileSync(
  path.join(appDir, 'src', 'components', 'SaveButton.tsx'),
  'export function SaveButton() { return <button data-testid="save-button">Save draft</button>; }\n',
  'utf8'
);
fs.writeFileSync(path.join(appDir, 'package.json'), '{"type":"module"}\n', 'utf8');

const annotation = makeAnnotation();
const sources = collectFrontierAnnotationSourceRecords({
  cwd: appDir,
  sourceRoots: ['src'],
  package: '@app/web',
  feature: 'editor-save'
});
assert.strictEqual(sources.length, 1);
assert.strictEqual(sources[0].file, 'src/components/SaveButton.tsx');
assert.strictEqual(sources[0].declarations[0].name, 'SaveButton');

const artifacts = writeFrontierAnnotationHarnessArtifacts(annotation, {
  cwd: appDir,
  outDir: path.join(temp, 'agent-runs', 'save-button'),
  sourceRoots: ['src'],
  objective: 'Fix the annotated save button',
  verification: ['npm test'],
  acceptance: ['Save button annotation is addressed.'],
  package: '@app/web',
  feature: 'editor-save',
  swarm: {
    semanticImport: true,
    maxEstimatedInputTokens: 50000
  }
});
assert.strictEqual(artifacts.tasks.length, 1);
assert.strictEqual(artifacts.contexts[0].sourceRefs[0], 'src/components/SaveButton.tsx');
assert.ok(artifacts.tasks[0].prompt.includes('Annotation thread'));
assert.ok(artifacts.runCommand.includes('loom swarm plan'));
for (const file of [
  artifacts.paths.manifestPath,
  artifacts.paths.swarmTasksPath,
  artifacts.paths.queuePath,
  artifacts.paths.annotationsJsonlPath,
  artifacts.paths.runCommandPath
]) {
  assert.strictEqual(fs.existsSync(file), true, file);
}
const swarmTasks = JSON.parse(fs.readFileSync(artifacts.paths.swarmTasksPath, 'utf8'));
assert.strictEqual(swarmTasks[0].verification[0], 'npm test');

const screenshotWrites = [];
const fakePage = makeFakePage(screenshotWrites);
const canvasAnnotation = makeCanvasAnnotation();
const enrichedCanvas = await captureFrontierAnnotationScreenshots(canvasAnnotation, {
  cwd: appDir,
  rootDir: path.join(temp, 'canvas-run'),
  screenshotPage: fakePage,
  screenshots: { cropSize: 128 }
});
assert.strictEqual(enrichedCanvas.media.length, 2);
assert.strictEqual(enrichedCanvas.media[0].role, 'element-screenshot');
assert.strictEqual(enrichedCanvas.media[1].role, 'canvas-click-crop');
assert.strictEqual(fs.existsSync(enrichedCanvas.media[0].file), true);
assert.strictEqual(fs.existsSync(enrichedCanvas.media[1].file), true);
assert.deepStrictEqual(screenshotWrites.find((write) => write.kind === 'page').clip, {
  x: 176,
  y: 116,
  width: 128,
  height: 128
});

const planned = planFrontierAnnotationHarness(annotation, {
  cwd: appDir,
  sourceRecords: sources,
  outDir: path.join(temp, 'planned')
});
assert.strictEqual(planned.sourceRecords.length, 1);
assert.strictEqual(planned.manifest.policy.defaultCompute, 'codex.annotation');

const server = await startFrontierAnnotationHarnessServer({
  cwd: appDir,
  outDir: path.join(temp, 'server-runs'),
  sourceRoots: ['src'],
  verification: ['npm test'],
  screenshotPage: fakePage,
  port: 0
});
try {
  const response = await fetch(server.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(annotation)
  });
  assert.strictEqual(response.status, 200);
  const result = await response.json();
  assert.strictEqual(result.accepted, true);
  assert.strictEqual(result.taskIds.length, 1);
  assert.strictEqual(result.media.length, 1);
  assert.strictEqual(result.media[0].role, 'element-screenshot');
  assert.strictEqual(fs.existsSync(result.media[0].file), true);
  assert.strictEqual(fs.existsSync(result.manifestPath), true);
  const task = JSON.parse(fs.readFileSync(result.tasksPath, 'utf8'))[0];
  assert.ok(task.prompt.includes('Visual artifacts:'));
  assert.ok(task.prompt.includes(result.media[0].file));
} finally {
  await server.close();
}

const annotationPath = path.join(temp, 'annotation.json');
const cliOutDir = path.join(temp, 'cli-run');
fs.writeFileSync(annotationPath, JSON.stringify(annotation, null, 2), 'utf8');
const cliOutput = execFileSync('/bin/sh', ['-lc', [
  'node',
  shellQuote(path.join(packageDir, 'dist', 'cli.js')),
  'plan',
  '--annotation',
  shellQuote(annotationPath),
  '--cwd',
  shellQuote(appDir),
  '--source',
  'src',
  '--out',
  shellQuote(cliOutDir),
  '--verification',
  shellQuote('npm test')
].join(' ')], {
  cwd: packageDir,
  encoding: 'utf8'
});
const cliResult = JSON.parse(cliOutput);
assert.strictEqual(fs.existsSync(cliResult.tasksPath), true);

console.log('frontier annotations harness smoke passed');

function makeAnnotation() {
  return {
    kind: 'frontier.annotations.annotation',
    version: 1,
    id: 'annotation-save-button',
    note: 'Make this button clearer.\nWire it to the save flow.',
    thread: {
      id: 'thread-annotation-save-button',
      collapsed: false,
      messages: [
        {
          id: 'message-1',
          body: 'Make this button clearer.',
          actor: 'tester',
          createdAt: 1,
          status: 'submitted'
        },
        {
          id: 'message-2',
          body: 'Wire it to the save flow.',
          actor: 'tester',
          createdAt: 2,
          status: 'submitted'
        }
      ]
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
    css: [{ selector: '.primary', cssText: '.primary { color: red; }' }],
    sourceHints: [{ file: 'src/components/SaveButton.tsx', line: 1, symbol: 'SaveButton' }],
    route: '/editor',
    createdAt: 1,
    status: 'submitted'
  };
}

function makeCanvasAnnotation() {
  const annotation = makeAnnotation();
  return {
    ...annotation,
    id: 'annotation-canvas',
    note: 'Fix the selected canvas interaction.',
    target: {
      tagName: 'canvas',
      selector: '#game',
      cssPath: 'main > canvas#game',
      id: 'game',
      attributes: { id: 'game' },
      dataset: {},
      rect: { x: 20, y: 30, width: 400, height: 300, top: 30, right: 420, bottom: 330, left: 20 },
      click: {
        clientX: 240,
        clientY: 180,
        pageX: 240,
        pageY: 180,
        offsetX: 220,
        offsetY: 150,
        relativeX: 220,
        relativeY: 150,
        ratioX: 0.55,
        ratioY: 0.5
      },
      ancestry: [{ tagName: 'canvas', selector: '#game', id: 'game' }]
    },
    sourceHints: [{ file: 'src/components/SaveButton.tsx', line: 1, symbol: 'GameCanvas' }]
  };
}

function makeFakePage(writes) {
  return {
    locator(selector) {
      const box = selector === '#game'
        ? { x: 20, y: 30, width: 400, height: 300 }
        : { x: 0, y: 0, width: 120, height: 32 };
      return {
        first() {
          return this;
        },
        async boundingBox() {
          return box;
        },
        async screenshot(options) {
          writes.push({ kind: 'locator', selector, path: options.path });
          fs.mkdirSync(path.dirname(options.path), { recursive: true });
          fs.writeFileSync(options.path, 'fake-png', 'utf8');
        }
      };
    },
    async screenshot(options) {
      writes.push({ kind: 'page', path: options.path, clip: options.clip });
      fs.mkdirSync(path.dirname(options.path), { recursive: true });
      fs.writeFileSync(options.path, 'fake-crop-png', 'utf8');
    },
    viewportSize() {
      return { width: 800, height: 600 };
    }
  };
}

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}
