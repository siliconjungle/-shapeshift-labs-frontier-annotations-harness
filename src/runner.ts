import { spawn } from 'node:child_process';
import path from 'node:path';
import type {
  FrontierAnnotationHarnessArtifacts,
  FrontierAnnotationHarnessCommand,
  FrontierAnnotationHarnessRunResult,
  FrontierAnnotationHarnessRunSummary,
  FrontierAnnotationHarnessSpawnResult,
  FrontierAnnotationHarnessSwarmOptions
} from './types.js';
import { commandDisplay } from './internal.js';

export function createFrontierAnnotationSwarmCommands(
  artifacts: FrontierAnnotationHarnessArtifacts,
  options: FrontierAnnotationHarnessSwarmOptions = {}
) {
  const command = options.loomCommand ?? 'loom';
  const plan: FrontierAnnotationHarnessCommand = {
    command,
    args: [
      'swarm',
      'plan',
      '--manifest',
      artifacts.paths.manifestPath,
      '--tasks',
      artifacts.paths.swarmTasksPath,
      '--outDir',
      path.join(artifacts.paths.rootDir, 'plan'),
      ...(options.extraPlanArgs ?? [])
    ],
    cwd: artifacts.cwd,
    display: ''
  };
  plan.display = commandDisplay(plan.command, plan.args);
  const run: FrontierAnnotationHarnessCommand = {
    command,
    args: [
      'swarm',
      'run',
      '--manifest',
      artifacts.paths.manifestPath,
      '--tasks',
      artifacts.paths.swarmTasksPath,
      '--outDir',
      path.join(artifacts.paths.rootDir, 'run'),
      '--workspace',
      options.workspace ?? 'copy',
      ...(options.replaceWorkspace === false ? [] : ['--replace-workspace', 'true']),
      ...workspaceIncludes(artifacts, options).flatMap((item) => ['--workspace-include', item]),
      ...workspaceExcludes(options).flatMap((item) => ['--workspace-exclude', item]),
      ...(options.compactLogs === false ? [] : ['--compact-logs']),
      ...(options.semanticImport ? ['--semantic-import'] : []),
      ...(options.semanticImportMaxFiles ? ['--semantic-import-max-files', String(options.semanticImportMaxFiles)] : []),
      ...(options.semanticImportMaxBytes ? ['--semantic-import-max-bytes', String(options.semanticImportMaxBytes)] : []),
      ...(options.contextBudgetMode ? ['--context-budget-mode', options.contextBudgetMode] : ['--context-budget-mode', 'warn']),
      ...(options.maxEstimatedInputTokens ? ['--max-estimated-input-tokens', String(options.maxEstimatedInputTokens)] : []),
      ...(options.concurrency ? ['--concurrency', String(options.concurrency)] : []),
      ...(options.extraRunArgs ?? [])
    ],
    cwd: artifacts.cwd,
    display: ''
  };
  run.display = commandDisplay(run.command, run.args);
  return { plan, run };
}

export async function runFrontierAnnotationSwarmArtifacts(
  artifacts: FrontierAnnotationHarnessArtifacts,
  options: FrontierAnnotationHarnessSwarmOptions & { runSwarm?: boolean } = {}
): Promise<FrontierAnnotationHarnessRunSummary> {
  const commands = createFrontierAnnotationSwarmCommands(artifacts, options);
  const plan = await runCommand(commands.plan);
  if (plan.exitCode !== 0 || options.runSwarm === false) return { plan };
  const run = await runCommand(commands.run);
  return { plan, run };
}

export function spawnFrontierAnnotationSwarmArtifacts(
  artifacts: FrontierAnnotationHarnessArtifacts,
  options: FrontierAnnotationHarnessSwarmOptions = {}
): FrontierAnnotationHarnessSpawnResult {
  const commands = createFrontierAnnotationSwarmCommands(artifacts, options);
  const script = commands.plan.display + ' && ' + commands.run.display;
  const child = spawn(process.platform === 'win32' ? 'cmd.exe' : 'sh', process.platform === 'win32' ? ['/d', '/s', '/c', script] : ['-lc', script], {
    cwd: artifacts.cwd,
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
  return {
    pid: child.pid,
    command: script,
    cwd: artifacts.cwd,
    detached: true
  };
}

function runCommand(command: FrontierAnnotationHarnessCommand) {
  return new Promise<FrontierAnnotationHarnessRunResult>((resolve) => {
    const child = spawn(command.command, command.args, { cwd: command.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (exitCode, signal) => {
      resolve({ command, exitCode, signal, stdout, stderr });
    });
  });
}

function workspaceIncludes(artifacts: FrontierAnnotationHarnessArtifacts, options: FrontierAnnotationHarnessSwarmOptions) {
  return [
    'AGENTS.md',
    'package.json',
    'config/release-train.json',
    ...artifacts.swarmTasks.flatMap((task) => [...task.sourceRefs, ...task.targetRefs, ...task.allowedWrites]),
    ...(options.include ?? [])
  ].filter(Boolean);
}

function workspaceExcludes(options: FrontierAnnotationHarnessSwarmOptions) {
  return [
    'node_modules',
    'dist',
    'coverage',
    'agent-runs',
    'agent-worktrees',
    ...(options.exclude ?? [])
  ].filter(Boolean);
}
