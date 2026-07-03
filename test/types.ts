import {
  collectFrontierAnnotationSourceRecords,
  captureFrontierAnnotationScreenshots,
  createFrontierAnnotationSourceRecord,
  planFrontierAnnotationHarness,
  runFrontierAnnotationSwarmArtifacts,
  startFrontierAnnotationBrowserHarness,
  startFrontierAnnotationHarnessServer,
  writeFrontierAnnotationHarnessArtifacts,
  type FrontierAnnotationHarnessArtifacts,
  type FrontierAnnotationHarnessPlanOptions,
  type FrontierAnnotationHarnessScreenshotPageLike,
  type FrontierAnnotationHarnessServerOptions,
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
const screenshotPage: FrontierAnnotationHarnessScreenshotPageLike = {
  locator() {
    return {
      first() {
        return this;
      },
      async boundingBox() {
        return { x: 0, y: 0, width: 100, height: 50 };
      },
      async screenshot() {}
    };
  },
  async screenshot() {},
  viewportSize() {
    return { width: 800, height: 600 };
  }
};
const serverOptions: FrontierAnnotationHarnessServerOptions = {
  ...options,
  screenshotPage,
  screenshots: { cropSize: 128 }
};
const planned: FrontierAnnotationHarnessArtifacts = planFrontierAnnotationHarness(annotation, options);
const enriched = await captureFrontierAnnotationScreenshots(annotation, serverOptions);
const written = writeFrontierAnnotationHarnessArtifacts(annotation, options);
const server = await startFrontierAnnotationHarnessServer(serverOptions);
const browser = await startFrontierAnnotationBrowserHarness({ ...serverOptions, url: 'http://localhost:5173', headless: true });
const run = await runFrontierAnnotationSwarmArtifacts(planned, { runSwarm: false });

void sources;
void planned;
void enriched;
void written;
void server;
void browser;
void run;
