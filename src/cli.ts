#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { writeFrontierAnnotationHarnessArtifacts } from './artifacts.js';
import { runFrontierAnnotationSwarmArtifacts } from './runner.js';
import {
  startFrontierAnnotationBrowserHarness,
  startFrontierAnnotationHarnessServer
} from './server.js';
import type {
  FrontierAnnotationHarnessInput,
  FrontierAnnotationHarnessPlanOptions,
  FrontierAnnotationHarnessServerOptions
} from './types.js';

const argv = process.argv.slice(2);
const command = argv.shift();

try {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
  } else if (command === 'plan') {
    await planCommand(parseArgs(argv));
  } else if (command === 'serve') {
    await serveCommand(parseArgs(argv));
  } else {
    throw new Error('unknown command: ' + command);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function planCommand(args: Record<string, string | boolean | string[]>) {
  const annotationPath = stringArg(args, 'annotation') ?? stringArg(args, 'input');
  if (!annotationPath) throw new Error('plan requires --annotation <json>');
  const input = JSON.parse(fs.readFileSync(path.resolve(String(annotationPath)), 'utf8')) as FrontierAnnotationHarnessInput;
  const options = planOptions(args);
  const artifacts = writeFrontierAnnotationHarnessArtifacts(input, options);
  if (booleanArg(args, 'run-swarm')) await runFrontierAnnotationSwarmArtifacts(artifacts, { ...options.swarm, runSwarm: true });
  console.log(JSON.stringify({
    submissionId: artifacts.submission.id,
    taskIds: artifacts.tasks.map((task) => task.id),
    manifestPath: artifacts.paths.manifestPath,
    tasksPath: artifacts.paths.swarmTasksPath,
    queuePath: artifacts.paths.queuePath,
    runCommand: artifacts.runCommand
  }, null, 2));
}

async function serveCommand(args: Record<string, string | boolean | string[]>) {
  const options: FrontierAnnotationHarnessServerOptions = {
    ...planOptions(args),
    host: stringArg(args, 'host') ?? '127.0.0.1',
    port: numberArg(args, 'port'),
    endpointPath: stringArg(args, 'endpoint') ?? '/__frontier/annotations',
    runSwarm: booleanArg(args, 'run-swarm')
  };
  const url = stringArg(args, 'url');
  const handle = url
    ? await startFrontierAnnotationBrowserHarness({ ...options, url, headless: booleanArg(args, 'headless') })
    : await startFrontierAnnotationHarnessServer(options);
  console.log(JSON.stringify({
    url: handle.url,
    endpoint: handle.endpoint,
    browser: Boolean(url)
  }, null, 2));
  await waitForShutdown(handle.close);
}

function planOptions(args: Record<string, string | boolean | string[]>): FrontierAnnotationHarnessPlanOptions {
  return {
    cwd: stringArg(args, 'cwd'),
    outDir: stringArg(args, 'out'),
    objective: stringArg(args, 'objective'),
    lane: stringArg(args, 'lane'),
    compute: stringArg(args, 'compute'),
    model: stringArg(args, 'model'),
    reasoningEffort: stringArg(args, 'reasoning-effort'),
    package: stringArg(args, 'package'),
    feature: stringArg(args, 'feature'),
    actor: stringArg(args, 'actor'),
    sourceRoots: arrayArg(args, 'source'),
    sourceRecordsPath: stringArg(args, 'sources-json'),
    targetRefs: arrayArg(args, 'target'),
    allowedWrites: arrayArg(args, 'allow-write'),
    acceptance: arrayArg(args, 'acceptance'),
    verification: arrayArg(args, 'verification'),
    featureManifest: stringArg(args, 'feature-manifest'),
    context: {
      maxFiles: numberArg(args, 'max-files'),
      maxPromptBytes: numberArg(args, 'max-prompt-bytes'),
      maxSnippetBytes: numberArg(args, 'max-snippet-bytes')
    },
    swarm: {
      loomCommand: stringArg(args, 'loom') ?? 'loom',
      workspace: stringArg(args, 'workspace') ?? 'copy',
      semanticImport: booleanArg(args, 'semantic-import'),
      compactLogs: !booleanArg(args, 'no-compact-logs'),
      maxEstimatedInputTokens: numberArg(args, 'max-estimated-input-tokens'),
      contextBudgetMode: stringArg(args, 'context-budget-mode') ?? 'warn',
      include: arrayArg(args, 'include'),
      exclude: arrayArg(args, 'exclude')
    }
  };
}

function parseArgs(values: string[]) {
  const out: Record<string, string | boolean | string[]> = {};
  for (let index = 0; index < values.length; index++) {
    const arg = values[index];
    if (!arg.startsWith('--')) throw new Error('unexpected positional argument: ' + arg);
    const eq = arg.indexOf('=');
    const key = arg.slice(2, eq === -1 ? undefined : eq);
    const value = eq === -1 ? values[index + 1] : arg.slice(eq + 1);
    if (eq === -1 && (value === undefined || value.startsWith('--'))) {
      out[key] = true;
      continue;
    }
    if (eq === -1) index++;
    const existing = out[key];
    if (existing === undefined) out[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else out[key] = [String(existing), value];
  }
  return out;
}

function stringArg(args: Record<string, string | boolean | string[]>, key: string) {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}

function arrayArg(args: Record<string, string | boolean | string[]>, key: string) {
  const value = args[key];
  if (value === undefined || value === true || value === false) return undefined;
  return Array.isArray(value) ? value : [value];
}

function numberArg(args: Record<string, string | boolean | string[]>, key: string) {
  const value = stringArg(args, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanArg(args: Record<string, string | boolean | string[]>, key: string) {
  return args[key] === true || args[key] === 'true';
}

function waitForShutdown(close: () => Promise<void>) {
  return new Promise<void>((resolve) => {
    const stop = async () => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      await close();
      resolve();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
}

function printHelp() {
  console.log(`frontier-annotations-harness

Usage:
  frontier-annotations-harness serve --url http://localhost:5173 --source src --out agent-runs/annotations --run-swarm
  frontier-annotations-harness serve --source src --out agent-runs/annotations
  frontier-annotations-harness plan --annotation annotation.json --source src --out agent-runs/annotation

Key options:
  --source <dir>              Source root to scan. Repeatable.
  --sources-json <file>       Prebuilt source records JSON.
  --verification <command>    Verification command for spawned tasks. Repeatable.
  --allow-write <path>        Allowed write path. Repeatable.
  --run-swarm                 Start Loom swarm after accepting an annotation.
  --semantic-import           Ask Loom/frontier-swarm to include semantic sidecars.
`);
}
