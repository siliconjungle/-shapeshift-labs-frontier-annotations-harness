import {
  collectFrontierAnnotationSourceRecords,
  createFrontierAnnotationSourceRecord,
  planFrontierAnnotationHarness,
  runFrontierAnnotationSwarmArtifacts,
  startFrontierAnnotationBrowserHarness,
  startFrontierAnnotationHarnessServer,
  writeFrontierAnnotationHarnessArtifacts,
  type FrontierAnnotationHarnessArtifacts,
  type FrontierAnnotationHarnessPlanOptions,
  type FrontierAnnotationHarnessSourceScanOptions
} from '../dist/index.js';
import type { FrontierAnnotation } from '@shapeshift-labs/frontier-annotations';

const annotation = {} as FrontierAnnotation;
const scanOptions: FrontierAnnotationHarnessSourceScanOptions = { sourceRoots: ['src'], maxFiles: 20 };
const sources = collectFrontierAnnotationSourceRecords(scanOptions);
const source = createFrontierAnnotationSourceRecord('src/Button.tsx', scanOptions);
const options: FrontierAnnotationHarnessPlanOptions = {
  sourceRecords: [source],
  verification: ['npm test'],
  swarm: { semanticImport: true }
};
const planned: FrontierAnnotationHarnessArtifacts = planFrontierAnnotationHarness(annotation, options);
const written = writeFrontierAnnotationHarnessArtifacts(annotation, options);
const server = await startFrontierAnnotationHarnessServer(options);
const browser = await startFrontierAnnotationBrowserHarness({ ...options, url: 'http://localhost:5173', headless: true });
const run = await runFrontierAnnotationSwarmArtifacts(planned, { runSwarm: false });

void sources;
void planned;
void written;
void server;
void browser;
void run;
