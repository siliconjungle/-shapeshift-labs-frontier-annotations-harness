import http from 'node:http';
import path from 'node:path';
import {
  createFrontierAnnotationOverlayScript,
  installFrontierAnnotationOverlay
} from '@shapeshift-labs/frontier-annotations/browser';
import type { FrontierAnnotationInstallOptions } from '@shapeshift-labs/frontier-annotations';
import {
  planFrontierAnnotationHarness,
  writeFrontierAnnotationHarnessArtifacts
} from './artifacts.js';
import {
  captureFrontierAnnotationScreenshots
} from './screenshots.js';
import {
  spawnFrontierAnnotationSwarmArtifacts
} from './runner.js';
import type {
  FrontierAnnotationBrowserHarnessHandle,
  FrontierAnnotationBrowserHarnessOptions,
  FrontierAnnotationHarnessInput,
  FrontierAnnotationHarnessServerHandle,
  FrontierAnnotationHarnessServerOptions
} from './types.js';

export async function startFrontierAnnotationHarnessServer(
  options: FrontierAnnotationHarnessServerOptions = {}
): Promise<FrontierAnnotationHarnessServerHandle> {
  const host = options.host ?? '127.0.0.1';
  const endpointPath = normalizeEndpointPath(options.endpointPath ?? '/__frontier/annotations');
  const maxBodyBytes = options.maxBodyBytes ?? 2_000_000;
  const server = http.createServer(async (request, response) => {
    setCors(response);
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === 'GET' && request.url === '/healthz') {
      writeJson(response, 200, { ok: true, endpoint: endpointPath });
      return;
    }
    if (request.method !== 'POST' || !request.url?.startsWith(endpointPath)) {
      writeJson(response, 404, { error: 'not-found', endpoint: endpointPath });
      return;
    }
    try {
      const input = JSON.parse(await readBody(request, maxBodyBytes)) as FrontierAnnotationHarnessInput;
      const preview = planFrontierAnnotationHarness(input, options);
      const cwd = path.resolve(options.cwd ?? process.cwd());
      const outDir = options.outDir
        ? path.join(path.resolve(cwd, options.outDir), preview.submission.id)
        : undefined;
      const rootDir = outDir ?? path.join(cwd, 'agent-runs', preview.submission.id);
      const enrichedInput = await captureFrontierAnnotationScreenshots(input, { ...options, outDir, rootDir });
      const artifacts = writeFrontierAnnotationHarnessArtifacts(enrichedInput, { ...options, outDir });
      const spawned = options.runSwarm ? spawnFrontierAnnotationSwarmArtifacts(artifacts, options.swarm) : undefined;
      writeJson(response, 200, {
        accepted: true,
        submissionId: artifacts.submission.id,
        taskIds: artifacts.tasks.map((task) => task.id),
        media: artifacts.submission.annotations.flatMap((annotation) => annotation.media ?? []),
        manifestPath: artifacts.paths.manifestPath,
        tasksPath: artifacts.paths.swarmTasksPath,
        queuePath: artifacts.paths.queuePath,
        runCommand: artifacts.runCommand,
        swarm: spawned
      });
    } catch (error) {
      writeJson(response, 400, { accepted: false, error: String(error instanceof Error ? error.message : error) });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port ?? 0;
  const baseUrl = 'http://' + host + ':' + port;
  return {
    url: baseUrl,
    endpoint: baseUrl + endpointPath,
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  };
}

export async function startFrontierAnnotationBrowserHarness(
  options: FrontierAnnotationBrowserHarnessOptions
): Promise<FrontierAnnotationBrowserHarnessHandle> {
  let browser = options.browser as any;
  let page = options.page as any;
  let server: FrontierAnnotationHarnessServerHandle | undefined;
  let cleanupOverlayPages: (() => void) | undefined;
  try {
    if (!page) {
      const playwright = await loadPlaywright();
      browser = browser ?? await playwright.chromium.launch({ headless: options.headless ?? false });
      page = await browser.newPage();
      await page.goto(options.url);
    } else if (options.url && typeof page.goto === 'function') {
      await page.goto(options.url);
    }
    server = await startFrontierAnnotationHarnessServer({ ...options, screenshotPage: page });
    const overlay: FrontierAnnotationInstallOptions = {
      endpoint: server.endpoint,
      feature: options.feature,
      package: options.package,
      route: options.context?.route,
      actor: options.actor,
      buttonLabel: options.overlay?.buttonLabel,
      placeholder: options.overlay?.placeholder,
      submitOnCreate: options.overlay?.submitOnCreate,
      includeCss: options.overlay?.includeCss,
      includeComputedStyle: options.overlay?.includeComputedStyle,
      maxCssRules: options.overlay?.maxCssRules,
      zIndex: options.overlay?.zIndex,
      metadata: options.overlay?.metadata
    };
    cleanupOverlayPages = await installFrontierAnnotationOverlayAcrossContext(page, overlay);
    return {
      ...server,
      browser,
      page,
      async close() {
        cleanupOverlayPages?.();
        await server?.close();
        if (!options.page && browser && typeof browser.close === 'function') await browser.close();
      }
    };
  } catch (error) {
    cleanupOverlayPages?.();
    if (server) await server.close().catch(() => undefined);
    if (!options.page && browser && typeof browser.close === 'function') await browser.close().catch(() => undefined);
    throw error;
  }
}

async function installFrontierAnnotationOverlayAcrossContext(
  page: any,
  overlay: FrontierAnnotationInstallOptions
): Promise<() => void> {
  const context = typeof page?.context === 'function' ? page.context() : undefined;
  const content = createFrontierAnnotationOverlayScript(overlay);
  if (context && typeof context.addInitScript === 'function') {
    await context.addInitScript({ content });
  }
  await installFrontierAnnotationOverlay(page, overlay);
  if (!context || typeof context.on !== 'function') return () => undefined;

  const onPage = (nextPage: any) => installOverlayOnPage(nextPage, overlay);
  context.on('page', onPage);
  return () => {
    if (typeof context.off === 'function') context.off('page', onPage);
    else if (typeof context.removeListener === 'function') context.removeListener('page', onPage);
  };
}

async function installOverlayOnPage(page: any, overlay: FrontierAnnotationInstallOptions) {
  try {
    if (typeof page?.waitForLoadState === 'function') {
      await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined);
    }
    await installFrontierAnnotationOverlay(page, overlay);
  } catch {
    // New tabs can close before the first document is ready. The context init
    // script still covers future navigations, so there is nothing useful to do.
  }
}

async function loadPlaywright() {
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
    return await dynamicImport('playwright');
  } catch (error) {
    throw new Error('Playwright is required for --url browser launch. Install playwright in the host project or pass an existing page. ' + String(error));
  }
}

function readBody(request: http.IncomingMessage, maxBodyBytes: number) {
  return new Promise<string>((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxBodyBytes) {
        reject(new Error('request body exceeds maxBodyBytes'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function setCors(response: http.ServerResponse) {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type');
}

function writeJson(response: http.ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value, null, 2));
}

function normalizeEndpointPath(value: string) {
  return value.startsWith('/') ? value : '/' + value;
}
