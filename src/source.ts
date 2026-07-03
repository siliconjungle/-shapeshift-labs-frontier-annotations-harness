import fs from 'node:fs';
import path from 'node:path';
import type {
  FrontierAnnotationImportLike,
  FrontierAnnotationSourceRecordLike,
  FrontierAnnotationSourceSymbolLike
} from '@shapeshift-labs/frontier-annotations';
import type {
  FrontierAnnotationHarnessSourceLoadOptions,
  FrontierAnnotationHarnessSourceScanOptions
} from './types.js';
import { isRecord, normalizePath, readPositiveInt, relativeTo, uniqueStrings } from './internal.js';

const DEFAULT_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.scss',
  '.html',
  '.json',
  '.md'
];
const DEFAULT_IGNORE_DIRS = [
  '.git',
  '.hg',
  '.svn',
  '.loom',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  'agent-runs',
  'agent-worktrees'
];

export function loadFrontierAnnotationSourceRecords(
  options: FrontierAnnotationHarnessSourceLoadOptions = {}
): FrontierAnnotationSourceRecordLike[] {
  const provided = [...(options.sourceRecords ?? [])];
  const fromFile = options.sourceRecordsPath ? readSourceRecordsFile(options.sourceRecordsPath, options.cwd) : [];
  if (provided.length || fromFile.length) return [...provided, ...fromFile].map(normalizeSourceRecord);
  return collectFrontierAnnotationSourceRecords(options);
}

export function collectFrontierAnnotationSourceRecords(
  options: FrontierAnnotationHarnessSourceScanOptions = {}
): FrontierAnnotationSourceRecordLike[] {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const roots = (options.sourceRoots?.length ? options.sourceRoots : ['src']).map((root) =>
    path.resolve(cwd, root)
  );
  const extensions = new Set((options.extensions?.length ? options.extensions : DEFAULT_EXTENSIONS).map((item) =>
    item.startsWith('.') ? item : '.' + item
  ));
  const ignoreDirs = new Set([...(options.ignoreDirs ?? DEFAULT_IGNORE_DIRS)]);
  const maxFiles = readPositiveInt(options.maxFiles, 2000);
  const maxFileBytes = readPositiveInt(options.maxFileBytes, 96_000);
  const files: string[] = [];
  for (const root of roots) {
    walk(root, { cwd, extensions, ignoreDirs, maxFiles, files });
    if (files.length >= maxFiles) break;
  }
  return files.map((file) => createSourceRecord(file, { cwd, maxFileBytes, package: options.package, feature: options.feature }));
}

export function createFrontierAnnotationSourceRecord(
  file: string,
  options: FrontierAnnotationHarnessSourceScanOptions = {}
): FrontierAnnotationSourceRecordLike {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  return createSourceRecord(path.isAbsolute(file) ? file : path.resolve(cwd, file), {
    cwd,
    maxFileBytes: readPositiveInt(options.maxFileBytes, 96_000),
    package: options.package,
    feature: options.feature
  });
}

function walk(
  dir: string,
  options: {
    cwd: string;
    extensions: Set<string>;
    ignoreDirs: Set<string>;
    maxFiles: number;
    files: string[];
  }
) {
  if (options.files.length >= options.maxFiles) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (options.files.length >= options.maxFiles) return;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!options.ignoreDirs.has(entry.name)) walk(absolute, options);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!options.extensions.has(path.extname(entry.name))) continue;
    options.files.push(absolute);
  }
}

function createSourceRecord(
  absolute: string,
  options: {
    cwd: string;
    maxFileBytes: number;
    package?: string;
    feature?: string;
  }
): FrontierAnnotationSourceRecordLike {
  const file = relativeTo(options.cwd, absolute);
  const text = readTextFile(absolute, options.maxFileBytes);
  const declarations = extractDeclarations(text);
  const exports = declarations.filter((item) => item.exported);
  return {
    id: file,
    file,
    text,
    package: options.package,
    feature: options.feature,
    layer: inferLayer(file, text),
    tags: inferTags(file),
    imports: extractImports(text),
    exports,
    declarations,
    frontierPackages: extractFrontierPackages(text)
  };
}

function readTextFile(file: string, maxBytes: number) {
  const buffer = fs.readFileSync(file);
  const sliced = buffer.byteLength > maxBytes ? buffer.subarray(0, maxBytes) : buffer;
  return sliced.toString('utf8');
}

function readSourceRecordsFile(sourceRecordsPath: string, cwd?: string) {
  const absolute = path.resolve(cwd ?? process.cwd(), sourceRecordsPath);
  const parsed = JSON.parse(fs.readFileSync(absolute, 'utf8')) as unknown;
  if (Array.isArray(parsed)) return parsed.filter(isSourceRecord);
  if (isRecord(parsed) && Array.isArray(parsed.sources)) return parsed.sources.filter(isSourceRecord);
  if (isRecord(parsed) && Array.isArray(parsed.sourceRecords)) return parsed.sourceRecords.filter(isSourceRecord);
  throw new Error('source records file must contain an array or { sources: [] }: ' + sourceRecordsPath);
}

function normalizeSourceRecord(record: FrontierAnnotationSourceRecordLike): FrontierAnnotationSourceRecordLike {
  return {
    ...record,
    file: normalizePath(record.file)
  };
}

function isSourceRecord(value: unknown): value is FrontierAnnotationSourceRecordLike {
  return isRecord(value) && typeof value.file === 'string';
}

function inferLayer(file: string, text: string) {
  const lower = file.toLowerCase();
  if (/\.(css|scss)$/.test(lower)) return 'stylesheet';
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(lower)) return 'test';
  if (lower.includes('/routes/') || lower.includes('/pages/') || lower.includes('/app/')) return 'frontend-route';
  if (/\.[jt]sx$/.test(lower) || text.includes('data-testid=') || text.includes('className=')) return 'frontend-component';
  if (lower.endsWith('package.json') || lower.endsWith('.config.js') || lower.endsWith('.config.ts')) return 'config';
  return 'source';
}

function inferTags(file: string) {
  const ext = path.extname(file).replace('.', '');
  const parts = file.split('/').slice(0, -1);
  return uniqueStrings([ext ? 'ext:' + ext : undefined, ...parts.slice(-3).map((part) => 'dir:' + part)]);
}

function extractImports(text: string): FrontierAnnotationImportLike[] {
  const imports: FrontierAnnotationImportLike[] = [];
  const importPattern = /\bimport\s+(?:(.*?)\s+from\s+)?['"]([^'"]+)['"]/gs;
  let match: RegExpExecArray | null;
  while ((match = importPattern.exec(text))) {
    imports.push({
      specifier: match[2],
      localNames: extractImportNames(match[1] ?? ''),
      importedNames: extractImportedNames(match[1] ?? '')
    });
  }
  const requirePattern = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requirePattern.exec(text))) imports.push({ specifier: match[1] });
  return imports;
}

function extractDeclarations(text: string): FrontierAnnotationSourceSymbolLike[] {
  const out: FrontierAnnotationSourceSymbolLike[] = [];
  const patterns: Array<{ pattern: RegExp; kind: string; exported: boolean }> = [
    { pattern: /\bexport\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g, kind: 'function', exported: true },
    { pattern: /\bexport\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g, kind: 'class', exported: true },
    { pattern: /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g, kind: 'variable', exported: true },
    { pattern: /\bexport\s+(?:interface|type)\s+([A-Za-z_$][\w$]*)/g, kind: 'type', exported: true },
    { pattern: /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g, kind: 'function', exported: false },
    { pattern: /\b(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g, kind: 'class', exported: false },
    { pattern: /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g, kind: 'variable', exported: false },
    { pattern: /\b(?:interface|type)\s+([A-Za-z_$][\w$]*)/g, kind: 'type', exported: false }
  ];
  const seen = new Set<string>();
  for (const { pattern, kind, exported } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const name = match[1];
      const key = name + ':' + kind;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, kind, exported });
    }
  }
  const exportListPattern = /\bexport\s*{\s*([^}]+)\s*}/g;
  let match: RegExpExecArray | null;
  while ((match = exportListPattern.exec(text))) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/i).pop()?.trim();
      if (!name || seen.has(name + ':export')) continue;
      seen.add(name + ':export');
      out.push({ name, kind: 'export', exported: true });
    }
  }
  return out;
}

function extractFrontierPackages(text: string) {
  const out: string[] = [];
  const pattern = /@shapeshift-labs\/frontier[-a-z0-9]*/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) out.push(match[0]);
  return uniqueStrings(out);
}

function extractImportNames(value: string) {
  if (!value.trim()) return [];
  return uniqueStrings(value
    .replace(/[{}*]/g, ' ')
    .split(/[,\s]+/g)
    .filter((item) => item && item !== 'as' && item !== 'type'));
}

function extractImportedNames(value: string) {
  const named = /\{([^}]+)\}/.exec(value);
  if (!named) return [];
  return uniqueStrings(named[1].split(',').map((part) => part.trim().split(/\s+as\s+/i)[0]));
}
