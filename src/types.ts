import type {
  FrontierAnnotation,
  FrontierAnnotationContext,
  FrontierAnnotationContextOptions,
  FrontierAnnotationCodexQueue,
  FrontierAnnotationCodexTask,
  FrontierAnnotationInput,
  FrontierAnnotationJsonObject,
  FrontierAnnotationSourceRecordLike,
  FrontierAnnotationSubmission,
  FrontierAnnotationSubmissionInput
} from '@shapeshift-labs/frontier-annotations';

export const FRONTIER_ANNOTATION_HARNESS_ARTIFACTS_KIND = 'frontier.annotations-harness.artifacts';
export const FRONTIER_ANNOTATION_HARNESS_ARTIFACTS_VERSION = 1;
export const FRONTIER_ANNOTATION_HARNESS_SWARM_MANIFEST_KIND = 'frontier.swarm.manifest';
export const FRONTIER_ANNOTATION_HARNESS_SWARM_MANIFEST_VERSION = 1;

export type FrontierAnnotationHarnessInput =
  | FrontierAnnotation
  | FrontierAnnotationInput
  | FrontierAnnotationSubmission
  | FrontierAnnotationSubmissionInput;

export interface FrontierAnnotationHarnessSourceScanOptions {
  cwd?: string;
  sourceRoots?: readonly string[];
  extensions?: readonly string[];
  ignoreDirs?: readonly string[];
  maxFiles?: number;
  maxFileBytes?: number;
  package?: string;
  feature?: string;
}

export interface FrontierAnnotationHarnessSourceLoadOptions extends FrontierAnnotationHarnessSourceScanOptions {
  sourceRecords?: readonly FrontierAnnotationSourceRecordLike[];
  sourceRecordsPath?: string;
}

export interface FrontierAnnotationHarnessSwarmOptions {
  loomCommand?: string;
  workspace?: 'copy' | 'current' | 'snapshot' | string;
  replaceWorkspace?: boolean;
  include?: readonly string[];
  exclude?: readonly string[];
  compactLogs?: boolean;
  semanticImport?: boolean;
  semanticImportMaxFiles?: number;
  semanticImportMaxBytes?: number;
  maxEstimatedInputTokens?: number;
  contextBudgetMode?: 'warn' | 'error' | string;
  concurrency?: number;
  extraPlanArgs?: readonly string[];
  extraRunArgs?: readonly string[];
}

export interface FrontierAnnotationHarnessPlanOptions extends FrontierAnnotationHarnessSourceLoadOptions {
  cwd?: string;
  outDir?: string;
  runId?: string;
  objective?: string;
  lane?: string;
  compute?: string;
  model?: string;
  reasoningEffort?: string;
  sourceRefs?: readonly string[];
  targetRefs?: readonly string[];
  allowedWrites?: readonly string[];
  acceptance?: readonly string[];
  verification?: readonly string[];
  package?: string;
  feature?: string;
  actor?: string;
  context?: FrontierAnnotationContextOptions;
  includeAnnotationJson?: boolean;
  featureManifest?: string;
  metadata?: FrontierAnnotationJsonObject;
  swarm?: FrontierAnnotationHarnessSwarmOptions;
}

export interface FrontierAnnotationHarnessPaths {
  rootDir: string;
  annotationsDir: string;
  contextsDir: string;
  tasksDir: string;
  submissionPath: string;
  queuePath: string;
  manifestPath: string;
  swarmTasksPath: string;
  annotationsJsonlPath: string;
  runCommandPath: string;
}

export interface FrontierAnnotationHarnessSwarmManifest {
  kind: typeof FRONTIER_ANNOTATION_HARNESS_SWARM_MANIFEST_KIND;
  version: typeof FRONTIER_ANNOTATION_HARNESS_SWARM_MANIFEST_VERSION;
  id: string;
  title: string;
  description: string;
  defaultWorkspace: string;
  compute: Array<{
    id: string;
    kind: string;
    model?: string;
    reasoningEffort?: string;
  }>;
  policy: {
    defaultCompute: string;
    defaultConcurrency: number;
    requireCleanWorktree: boolean;
  };
  lanes: Array<{
    id: string;
    title: string;
    maxConcurrency: number;
    allowedWrites: string[];
  }>;
  metadata: FrontierAnnotationJsonObject;
}

export interface FrontierAnnotationHarnessSwarmTask {
  id: string;
  title: string;
  lane: string;
  compute: string;
  workKind: string;
  objective: string;
  sourceRefs: string[];
  targetRefs: string[];
  allowedWrites: string[];
  acceptance: string[];
  verification: string[];
  prompt: string;
  metadata?: FrontierAnnotationJsonObject;
}

export interface FrontierAnnotationHarnessArtifacts {
  kind: typeof FRONTIER_ANNOTATION_HARNESS_ARTIFACTS_KIND;
  version: typeof FRONTIER_ANNOTATION_HARNESS_ARTIFACTS_VERSION;
  id: string;
  generatedAt: number;
  cwd: string;
  submission: FrontierAnnotationSubmission;
  contexts: FrontierAnnotationContext[];
  tasks: FrontierAnnotationCodexTask[];
  queue: FrontierAnnotationCodexQueue;
  manifest: FrontierAnnotationHarnessSwarmManifest;
  swarmTasks: FrontierAnnotationHarnessSwarmTask[];
  sourceRecords: FrontierAnnotationSourceRecordLike[];
  paths: FrontierAnnotationHarnessPaths;
  runCommand: string;
  metadata?: FrontierAnnotationJsonObject;
}

export interface FrontierAnnotationHarnessCommand {
  command: string;
  args: string[];
  cwd: string;
  display: string;
}

export interface FrontierAnnotationHarnessRunResult {
  command: FrontierAnnotationHarnessCommand;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface FrontierAnnotationHarnessRunSummary {
  plan: FrontierAnnotationHarnessRunResult;
  run?: FrontierAnnotationHarnessRunResult;
}

export interface FrontierAnnotationHarnessSpawnResult {
  pid?: number;
  command: string;
  cwd: string;
  detached: boolean;
}

export interface FrontierAnnotationHarnessServerOptions extends FrontierAnnotationHarnessPlanOptions {
  host?: string;
  port?: number;
  endpointPath?: string;
  runSwarm?: boolean;
  maxBodyBytes?: number;
}

export interface FrontierAnnotationHarnessServerHandle {
  url: string;
  endpoint: string;
  close(): Promise<void>;
}

export interface FrontierAnnotationBrowserHarnessOptions extends FrontierAnnotationHarnessServerOptions {
  url: string;
  headless?: boolean;
  browser?: unknown;
  page?: unknown;
  overlay?: {
    buttonLabel?: string;
    placeholder?: string;
    submitOnCreate?: boolean;
    includeCss?: boolean;
    includeComputedStyle?: boolean;
    maxCssRules?: number;
    zIndex?: number;
    metadata?: unknown;
  };
}

export interface FrontierAnnotationBrowserHarnessHandle extends FrontierAnnotationHarnessServerHandle {
  browser?: unknown;
  page?: unknown;
}
