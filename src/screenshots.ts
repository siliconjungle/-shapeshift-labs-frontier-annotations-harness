import fs from 'node:fs';
import path from 'node:path';
import {
  FRONTIER_ANNOTATION_SUBMISSION_KIND,
  createFrontierAnnotation,
  type FrontierAnnotation,
  type FrontierAnnotationInput,
  type FrontierAnnotationMediaRef,
  type FrontierAnnotationSubmission,
  type FrontierAnnotationSubmissionInput,
  type FrontierAnnotationTargetClick
} from '@shapeshift-labs/frontier-annotations';
import type {
  FrontierAnnotationHarnessInput,
  FrontierAnnotationHarnessScreenshotOptions,
  FrontierAnnotationHarnessScreenshotPageLike,
  FrontierAnnotationHarnessServerOptions
} from './types.js';

interface NormalizedScreenshotOptions {
  enabled: boolean;
  captureElement: boolean;
  captureCanvasCrop: boolean;
  cropSize: number;
  dirName: string;
}

interface ScreenshotCaptureOptions extends FrontierAnnotationHarnessServerOptions {
  rootDir?: string;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function captureFrontierAnnotationScreenshots(
  input: FrontierAnnotationHarnessInput,
  options: ScreenshotCaptureOptions = {}
): Promise<FrontierAnnotationHarnessInput> {
  const page = options.screenshotPage;
  const settings = normalizeScreenshotOptions(options.screenshots);
  if (!page || !settings.enabled) return input;

  const annotations = getInputAnnotations(input);
  if (annotations.length === 0) return input;

  const rootDir = options.rootDir
    ? path.resolve(options.rootDir)
    : path.resolve(options.cwd ?? process.cwd(), options.outDir ?? path.join('agent-runs', 'frontier-annotations'));
  const screenshotsDir = path.join(rootDir, settings.dirName);
  const enriched = new Map<string, FrontierAnnotation>();

  for (const annotation of annotations) {
    const media = await captureAnnotationMedia(annotation, page, screenshotsDir, settings);
    if (media.length > 0) {
      enriched.set(annotation.id, {
        ...annotation,
        media: [...(annotation.media ?? []), ...media]
      });
    }
  }

  if (enriched.size === 0) return input;
  return replaceInputAnnotations(input, annotations.map((annotation) => enriched.get(annotation.id) ?? annotation));
}

async function captureAnnotationMedia(
  annotation: FrontierAnnotation,
  page: FrontierAnnotationHarnessScreenshotPageLike,
  screenshotsDir: string,
  settings: NormalizedScreenshotOptions
) {
  const media: FrontierAnnotationMediaRef[] = [];
  const selector = annotation.target.selector;
  if (!selector || typeof page.locator !== 'function') return media;

  const locator = firstLocator(page.locator(selector));
  const box = await safeBoundingBox(locator);
  fs.mkdirSync(screenshotsDir, { recursive: true });

  if (settings.captureElement && locator && typeof locator.screenshot === 'function') {
    const file = path.join(screenshotsDir, safeFilePart(annotation.id) + '-element.png');
    if (await safeScreenshot(() => locator.screenshot?.({ path: file }))) {
      media.push(createImageRef(annotation, 'element-screenshot', file, selector, box));
    }
  }

  if (settings.captureCanvasCrop && annotation.target.tagName.toLowerCase() === 'canvas' && annotation.target.click && box && typeof page.screenshot === 'function') {
    const clip = createCanvasClickClip(box, annotation.target.click, settings.cropSize, page.viewportSize?.() ?? undefined);
    if (clip) {
      const file = path.join(screenshotsDir, safeFilePart(annotation.id) + '-canvas-click-crop.png');
      if (await safeScreenshot(() => page.screenshot?.({ path: file, clip }))) {
        media.push(createImageRef(annotation, 'canvas-click-crop', file, selector, clip, {
          click: annotation.target.click as any,
          clip: clip as any
        } as any));
      }
    }
  }

  return media;
}

function createImageRef(
  annotation: FrontierAnnotation,
  role: FrontierAnnotationMediaRef['role'],
  file: string,
  selector: string,
  rect?: Rect | null,
  metadata?: FrontierAnnotationMediaRef['metadata']
): FrontierAnnotationMediaRef {
  return {
    kind: 'image',
    role,
    file,
    mimeType: 'image/png',
    width: rect ? Math.round(rect.width) : undefined,
    height: rect ? Math.round(rect.height) : undefined,
    selector,
    annotationId: annotation.id,
    createdAt: Date.now(),
    metadata: {
      source: 'frontier-annotations-harness',
      ...metadata
    } as any
  };
}

function createCanvasClickClip(
  box: Rect,
  click: FrontierAnnotationTargetClick,
  cropSize: number,
  viewport?: { width: number; height: number } | null
): Rect | undefined {
  const width = Math.max(1, Math.min(cropSize, box.width));
  const height = Math.max(1, Math.min(cropSize, box.height));
  const centerX = box.x + click.relativeX;
  const centerY = box.y + click.relativeY;
  let x = clamp(centerX - width / 2, box.x, box.x + box.width - width);
  let y = clamp(centerY - height / 2, box.y, box.y + box.height - height);
  if (viewport && viewport.width > 0 && viewport.height > 0) {
    x = clamp(x, 0, Math.max(0, viewport.width - width));
    y = clamp(y, 0, Math.max(0, viewport.height - height));
  }
  if (!Number.isFinite(x) || !Number.isFinite(y) || width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

function getInputAnnotations(input: FrontierAnnotationHarnessInput): FrontierAnnotation[] {
  if ((input as FrontierAnnotationSubmission).kind === FRONTIER_ANNOTATION_SUBMISSION_KIND) {
    return (input as FrontierAnnotationSubmission).annotations;
  }
  if (Array.isArray((input as FrontierAnnotationSubmissionInput).annotations)) {
    return (input as FrontierAnnotationSubmissionInput).annotations.map((annotation) =>
      createFrontierAnnotation(annotation as FrontierAnnotation | FrontierAnnotationInput)
    );
  }
  return [createFrontierAnnotation(input as FrontierAnnotation | FrontierAnnotationInput)];
}

function replaceInputAnnotations(
  input: FrontierAnnotationHarnessInput,
  annotations: FrontierAnnotation[]
): FrontierAnnotationHarnessInput {
  if ((input as FrontierAnnotationSubmission).kind === FRONTIER_ANNOTATION_SUBMISSION_KIND) {
    return { ...(input as FrontierAnnotationSubmission), annotations };
  }
  if (Array.isArray((input as FrontierAnnotationSubmissionInput).annotations)) {
    return { ...(input as FrontierAnnotationSubmissionInput), annotations };
  }
  return annotations[0] ?? input;
}

function normalizeScreenshotOptions(value: boolean | FrontierAnnotationHarnessScreenshotOptions | undefined): NormalizedScreenshotOptions {
  if (value === false || (typeof value === 'object' && value.enabled === false)) {
    return {
      enabled: false,
      captureElement: false,
      captureCanvasCrop: false,
      cropSize: 0,
      dirName: 'screenshots'
    };
  }
  const options = typeof value === 'object' ? value : {};
  return {
    enabled: true,
    captureElement: options.captureElement !== false,
    captureCanvasCrop: options.captureCanvasCrop !== false,
    cropSize: Math.max(32, Math.round(options.cropSize ?? 256)),
    dirName: options.dirName || 'screenshots'
  };
}

function firstLocator(locator: ReturnType<NonNullable<FrontierAnnotationHarnessScreenshotPageLike['locator']>> | undefined) {
  if (!locator) return undefined;
  return typeof locator.first === 'function' ? locator.first() : locator;
}

async function safeBoundingBox(locator: ReturnType<typeof firstLocator>) {
  if (!locator || typeof locator.boundingBox !== 'function') return undefined;
  try {
    return await locator.boundingBox();
  } catch {
    return undefined;
  }
}

async function safeScreenshot(fn: () => Promise<unknown> | unknown) {
  try {
    await fn();
    return true;
  } catch {
    return false;
  }
}

function safeFilePart(value: string) {
  return String(value || 'annotation')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'annotation';
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}
