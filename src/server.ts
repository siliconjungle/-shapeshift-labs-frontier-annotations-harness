import http from 'node:http';
import path from 'node:path';
import {
  installFrontierAnnotationOverlay
} from '@shapeshift-labs/frontier-annotations/browser';
import type { FrontierAnnotationInstallOptions } from '@shapeshift-labs/frontier-annotations';
import {
  planFrontierAnnotationHarness,
  writeFrontierAnnotationHarnessArtifacts
} from './artifacts.js';
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
      const outDir = options.outDir
        ? path.join(path.resolve(options.cwd ?? process.cwd(), options.outDir), preview.submission.id)
        : undefined;
      const artifacts = writeFrontierAnnotationHarnessArtifacts(input, { ...options, outDir });
      const spawned = options.runSwarm ? spawnFrontierAnnotationSwarmArtifacts(artifacts, options.swarm) : undefined;
      writeJson(response, 200, {
        accepted: true,
        submissionId: artifacts.submission.id,
        taskIds: artifacts.tasks.map((task) => task.id),
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
  const server = await startFrontierAnnotationHarnessServer(options);
  let browser = options.browser as any;
  let page = options.page as any;
  if (!page) {
    const playwright = await loadPlaywright();
    browser = browser ?? await playwright.chromium.launch({ headless: options.headless ?? false });
    page = await browser.newPage();
    await page.goto(options.url);
  } else if (options.url && typeof page.goto === 'function') {
    await page.goto(options.url);
  }
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
  await installFrontierAnnotationOverlay(page, overlay);
  return {
    ...server,
    browser,
    page,
    async close() {
      await server.close();
      if (!options.page && browser && typeof browser.close === 'function') await browser.close();
    }
  };
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
