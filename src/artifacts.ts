import fs from 'node:fs';
import path from 'node:path';
import {
  FRONTIER_ANNOTATION_SUBMISSION_KIND,
  createFrontierAnnotation,
  createFrontierAnnotationCodexQueue,
  createFrontierAnnotationCodexTask,
  createFrontierAnnotationContext,
  createFrontierAnnotationSubmission,
  encodeFrontierAnnotationsJsonl,
  type FrontierAnnotation,
  type FrontierAnnotationCodexTask,
  type FrontierAnnotationInput,
  type FrontierAnnotationSourceRecordLike,
  type FrontierAnnotationSubmission,
  type FrontierAnnotationSubmissionInput
} from '@shapeshift-labs/frontier-annotations';
import {
  FRONTIER_ANNOTATION_HARNESS_ARTIFACTS_KIND,
  FRONTIER_ANNOTATION_HARNESS_ARTIFACTS_VERSION,
  FRONTIER_ANNOTATION_HARNESS_SWARM_MANIFEST_KIND,
  FRONTIER_ANNOTATION_HARNESS_SWARM_MANIFEST_VERSION,
  type FrontierAnnotationHarnessArtifacts,
  type FrontierAnnotationHarnessInput,
  type FrontierAnnotationHarnessPaths,
  type FrontierAnnotationHarnessPlanOptions,
  type FrontierAnnotationHarnessSwarmManifest,
  type FrontierAnnotationHarnessSwarmTask
} from './types.js';
import { loadFrontierAnnotationSourceRecords } from './source.js';
import { normalizePath, shellQuote, stableId, toJsonObject, uniqueStrings } from './internal.js';

export function planFrontierAnnotationHarness(
  input: FrontierAnnotationHarnessInput,
  options: FrontierAnnotationHarnessPlanOptions = {}
): FrontierAnnotationHarnessArtifacts {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const sourceRecords = loadFrontierAnnotationSourceRecords({ ...options, cwd });
  const submission = normalizeSubmission(input, options);
  const contexts = submission.annotations.map((annotation) =>
    createFrontierAnnotationContext(annotation, sourceRecords, {
      ...options.context,
      route: options.context?.route ?? annotation.route,
      verification: options.verification ?? submission.verification,
      requiredFiles: uniqueStrings([
        ...(options.context?.requiredFiles ?? []),
        ...submission.sourceRefs,
        ...(options.sourceRefs ?? []),
        ...annotation.sourceHints.map((hint) => hint.file)
      ]),
      allowedFilePatterns: uniqueStrings([
        ...(options.context?.allowedFilePatterns ?? []),
        ...submission.allowedWrites,
        ...(options.allowedWrites ?? [])
      ]),
      metadata: {
        ...toJsonObject(options.context?.metadata),
        submissionId: submission.id
      }
    })
  );
  const tasks = submission.annotations.map((annotation, index) =>
    createTask(annotation, contexts[index], submission, options)
  );
  const queue = createFrontierAnnotationCodexQueue(tasks, {
    id: options.runId ? options.runId + '-queue' : undefined
  });
  const manifest = createFrontierAnnotationSwarmManifest(submission, tasks, options);
  const swarmTasks = createFrontierAnnotationSwarmTasks(tasks, submission, manifest, options);
  const rootDir = path.resolve(options.outDir ? path.resolve(cwd, options.outDir) : path.join(cwd, 'agent-runs', submission.id));
  const paths = createPaths(rootDir);
  const runCommand = createFrontierAnnotationRunCommand(paths, options);
  return {
    kind: FRONTIER_ANNOTATION_HARNESS_ARTIFACTS_KIND,
    version: FRONTIER_ANNOTATION_HARNESS_ARTIFACTS_VERSION,
    id: options.runId ?? stableId('annotation-harness', submission.id + ':' + tasks.map((task) => task.id).join('|')),
    generatedAt: Date.now(),
    cwd,
    submission,
    contexts,
    tasks,
    queue,
    manifest,
    swarmTasks,
    sourceRecords,
    paths,
    runCommand,
    metadata: toJsonObject({
      ...toJsonObject(options.metadata),
      featureManifest: options.featureManifest
    }) as any
  };
}

export function writeFrontierAnnotationHarnessArtifacts(
  input: FrontierAnnotationHarnessInput,
  options: FrontierAnnotationHarnessPlanOptions = {}
) {
  const artifacts = planFrontierAnnotationHarness(input, options);
  writeArtifacts(artifacts);
  return artifacts;
}

export function createFrontierAnnotationSwarmManifest(
  submission: FrontierAnnotationSubmission,
  tasks: readonly FrontierAnnotationCodexTask[],
  options: FrontierAnnotationHarnessPlanOptions = {}
): FrontierAnnotationHarnessSwarmManifest {
  const compute = options.compute ?? submission.compute ?? 'codex.annotation';
  const laneIds = uniqueStrings(tasks.map((task) => task.lane));
  return {
    kind: FRONTIER_ANNOTATION_HARNESS_SWARM_MANIFEST_KIND,
    version: FRONTIER_ANNOTATION_HARNESS_SWARM_MANIFEST_VERSION,
    id: options.runId ?? 'frontier-annotations-' + submission.id,
    title: 'Browser annotations: ' + (submission.feature ?? submission.package ?? submission.id),
    description: submission.objective,
    defaultWorkspace: options.swarm?.workspace ?? 'copy',
    compute: [
      {
        id: compute,
        kind: compute.includes('codex') ? 'codex' : compute,
        model: options.model ?? tasks.find((task) => task.model)?.model,
        reasoningEffort: options.reasoningEffort ?? tasks.find((task) => task.reasoningEffort)?.reasoningEffort
      }
    ],
    policy: {
      defaultCompute: compute,
      defaultConcurrency: options.swarm?.concurrency ?? 1,
      requireCleanWorktree: false
    },
    lanes: laneIds.map((lane) => ({
      id: lane,
      title: titleCase(lane),
      maxConcurrency: 1,
      allowedWrites: uniqueStrings(tasks.filter((task) => task.lane === lane).flatMap((task) => task.allowedWrites))
    })),
    metadata: {
      submissionId: submission.id,
      annotationIds: submission.annotations.map((annotation) => annotation.id),
      feature: submission.feature,
      package: submission.package,
      actor: submission.actor,
      source: 'frontier-annotations-harness'
    } as any
  };
}

export function createFrontierAnnotationSwarmTasks(
  tasks: readonly FrontierAnnotationCodexTask[],
  submission: FrontierAnnotationSubmission,
  manifest: FrontierAnnotationHarnessSwarmManifest,
  _options: FrontierAnnotationHarnessPlanOptions = {}
): FrontierAnnotationHarnessSwarmTask[] {
  const compute = manifest.policy.defaultCompute;
  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    lane: task.lane,
    compute,
    workKind: task.workKind,
    objective: task.objective || submission.objective,
    sourceRefs: task.sourceRefs,
    targetRefs: task.targetRefs,
    allowedWrites: task.allowedWrites,
    acceptance: task.acceptance,
    verification: task.verification,
    prompt: task.prompt,
    metadata: {
      ...task.metadata,
      submissionId: submission.id,
      queueId: manifest.id
    }
  }));
}

export function createFrontierAnnotationRunCommand(
  paths: FrontierAnnotationHarnessPaths,
  options: FrontierAnnotationHarnessPlanOptions = {}
) {
  const loom = options.swarm?.loomCommand ?? 'loom';
  const planArgs = [
    'swarm',
    'plan',
    '--manifest',
    paths.manifestPath,
    '--tasks',
    paths.swarmTasksPath,
    '--outDir',
    path.join(paths.rootDir, 'plan'),
    ...(options.swarm?.extraPlanArgs ?? [])
  ];
  const runArgs = [
    'swarm',
    'run',
    '--manifest',
    paths.manifestPath,
    '--tasks',
    paths.swarmTasksPath,
    '--outDir',
    path.join(paths.rootDir, 'run'),
    '--workspace',
    options.swarm?.workspace ?? 'copy',
    ...(options.swarm?.replaceWorkspace === false ? [] : ['--replace-workspace', 'true']),
    ...workspaceIncludes(paths, options).flatMap((item) => ['--workspace-include', item]),
    ...workspaceExcludes(options).flatMap((item) => ['--workspace-exclude', item]),
    ...(options.swarm?.compactLogs === false ? [] : ['--compact-logs']),
    ...(options.swarm?.semanticImport ? ['--semantic-import'] : []),
    ...(options.swarm?.semanticImportMaxFiles ? ['--semantic-import-max-files', String(options.swarm.semanticImportMaxFiles)] : []),
    ...(options.swarm?.semanticImportMaxBytes ? ['--semantic-import-max-bytes', String(options.swarm.semanticImportMaxBytes)] : []),
    ...(options.swarm?.contextBudgetMode ? ['--context-budget-mode', options.swarm.contextBudgetMode] : ['--context-budget-mode', 'warn']),
    ...(options.swarm?.maxEstimatedInputTokens ? ['--max-estimated-input-tokens', String(options.swarm.maxEstimatedInputTokens)] : []),
    ...(options.swarm?.concurrency ? ['--concurrency', String(options.swarm.concurrency)] : []),
    ...(options.swarm?.extraRunArgs ?? [])
  ];
  return [loom, ...planArgs].map(shellQuote).join(' ') + ' && ' + [loom, ...runArgs].map(shellQuote).join(' ');
}

function writeArtifacts(artifacts: FrontierAnnotationHarnessArtifacts) {
  fs.mkdirSync(artifacts.paths.annotationsDir, { recursive: true });
  fs.mkdirSync(artifacts.paths.contextsDir, { recursive: true });
  fs.mkdirSync(artifacts.paths.tasksDir, { recursive: true });
  for (const annotation of artifacts.submission.annotations) {
    writeJson(path.join(artifacts.paths.annotationsDir, annotation.id + '.json'), annotation);
  }
  for (const context of artifacts.contexts) {
    writeJson(path.join(artifacts.paths.contextsDir, context.annotationId + '.json'), context);
  }
  for (const task of artifacts.tasks) {
    writeJson(path.join(artifacts.paths.tasksDir, task.id + '.json'), task);
  }
  writeJson(artifacts.paths.submissionPath, artifacts.submission);
  writeJson(artifacts.paths.queuePath, artifacts.queue);
  writeJson(artifacts.paths.manifestPath, artifacts.manifest);
  writeJson(artifacts.paths.swarmTasksPath, artifacts.swarmTasks);
  fs.writeFileSync(
    artifacts.paths.annotationsJsonlPath,
    encodeFrontierAnnotationsJsonl([artifacts.submission, ...artifacts.submission.annotations]),
    'utf8'
  );
  fs.writeFileSync(artifacts.paths.runCommandPath, artifacts.runCommand + '\n', { encoding: 'utf8', mode: 0o755 });
}

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function createPaths(rootDir: string): FrontierAnnotationHarnessPaths {
  return {
    rootDir,
    annotationsDir: path.join(rootDir, 'annotations'),
    contextsDir: path.join(rootDir, 'contexts'),
    tasksDir: path.join(rootDir, 'codex-tasks'),
    submissionPath: path.join(rootDir, 'submission.json'),
    queuePath: path.join(rootDir, 'queue.json'),
    manifestPath: path.join(rootDir, 'manifest.json'),
    swarmTasksPath: path.join(rootDir, 'tasks.json'),
    annotationsJsonlPath: path.join(rootDir, 'annotations.jsonl'),
    runCommandPath: path.join(rootDir, 'run-command.sh')
  };
}

function normalizeSubmission(
  input: FrontierAnnotationHarnessInput,
  options: FrontierAnnotationHarnessPlanOptions
): FrontierAnnotationSubmission {
  if ((input as FrontierAnnotationSubmission).kind === FRONTIER_ANNOTATION_SUBMISSION_KIND) return input as FrontierAnnotationSubmission;
  if (Array.isArray((input as FrontierAnnotationSubmissionInput).annotations)) {
    const draft = input as FrontierAnnotationSubmissionInput;
    return createFrontierAnnotationSubmission({
      ...draft,
      objective: options.objective ?? draft.objective,
      lane: options.lane ?? draft.lane,
      compute: options.compute ?? draft.compute,
      sourceRefs: uniqueStrings([...(draft.sourceRefs ?? []), ...(options.sourceRefs ?? [])]),
      targetRefs: uniqueStrings([...(draft.targetRefs ?? []), ...(options.targetRefs ?? [])]),
      allowedWrites: uniqueStrings([...(draft.allowedWrites ?? []), ...(options.allowedWrites ?? [])]),
      acceptance: options.acceptance ?? draft.acceptance,
      verification: options.verification ?? draft.verification,
      package: options.package ?? draft.package,
      feature: options.feature ?? draft.feature,
      actor: options.actor ?? draft.actor,
      metadata: {
        ...toJsonObject(draft.metadata),
        ...toJsonObject(options.metadata)
      }
    });
  }
  const annotation = createFrontierAnnotation(input as FrontierAnnotation | FrontierAnnotationInput);
  return createFrontierAnnotationSubmission({
    annotations: [annotation],
    objective: options.objective,
    lane: options.lane,
    compute: options.compute,
    sourceRefs: options.sourceRefs,
    targetRefs: options.targetRefs,
    allowedWrites: options.allowedWrites,
    acceptance: options.acceptance,
    verification: options.verification,
    package: options.package ?? annotation.package,
    feature: options.feature ?? annotation.feature,
    actor: options.actor ?? annotation.actor,
    metadata: options.metadata
  });
}

function createTask(
  annotation: FrontierAnnotation,
  context: ReturnType<typeof createFrontierAnnotationContext>,
  submission: FrontierAnnotationSubmission,
  options: FrontierAnnotationHarnessPlanOptions
) {
  const targetRefs = uniqueStrings([
    ...submission.targetRefs,
    ...(options.targetRefs ?? []),
    ...context.sourceRefs
  ]);
  const allowedWrites = uniqueStrings([
    ...submission.allowedWrites,
    ...(options.allowedWrites ?? []),
    ...context.allowedFiles,
    ...context.sourceRefs
  ]);
  return createFrontierAnnotationCodexTask(annotation, context, {
    title: undefined,
    lane: options.lane ?? submission.lane,
    objective: options.objective ?? submission.objective,
    targetRefs,
    allowedWrites,
    verification: options.verification ?? submission.verification,
    acceptance: options.acceptance ?? submission.acceptance,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    package: options.package ?? submission.package,
    feature: options.feature ?? submission.feature,
    includeAnnotationJson: options.includeAnnotationJson,
    metadata: {
      submissionId: submission.id,
      source: 'frontier-annotations-harness'
    }
  });
}

function workspaceIncludes(paths: FrontierAnnotationHarnessPaths, options: FrontierAnnotationHarnessPlanOptions) {
  return uniqueStrings([
    'AGENTS.md',
    'package.json',
    'config/release-train.json',
    options.featureManifest,
    ...pathsFromTasksFile(paths),
    ...(options.swarm?.include ?? [])
  ]);
}

function workspaceExcludes(options: FrontierAnnotationHarnessPlanOptions) {
  return uniqueStrings([
    'node_modules',
    'dist',
    'coverage',
    'agent-runs',
    'agent-worktrees',
    ...(options.swarm?.exclude ?? [])
  ]);
}

function pathsFromTasksFile(paths: FrontierAnnotationHarnessPaths) {
  if (!fs.existsSync(paths.swarmTasksPath)) return [];
  try {
    const tasks = JSON.parse(fs.readFileSync(paths.swarmTasksPath, 'utf8')) as FrontierAnnotationHarnessSwarmTask[];
    return tasks.flatMap((task) => [...task.sourceRefs, ...task.targetRefs, ...task.allowedWrites]).map(normalizePath);
  } catch {
    return [];
  }
}

function titleCase(value: string) {
  return value
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}
