import type { OsintCatalog, OsintTool } from './catalog.types';

export const OSINT_CATALOG_META_URL = '/osint/catalog.meta.json';
export const OSINT_CATALOG_TOOL_SHARD_URLS = [
  '/osint/catalog.tools.a.json',
  '/osint/catalog.tools.b.json',
] as const;

/** @deprecated Single-file catalog is not the load path. Use the three shards. */
export const OSINT_CATALOG_URL = OSINT_CATALOG_META_URL;

export class OsintCatalogLoadError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'OsintCatalogLoadError';
    this.status = status;
  }
}

interface OsintCatalogMeta extends OsintCatalog {
  toolShardFiles?: string[];
}

export function isOsintCatalog(value: unknown): value is OsintCatalog {
  if (!value || typeof value !== 'object') return false;
  const catalog = value as Record<string, unknown>;
  return (
    catalog.source === 'osint4all-native' &&
    catalog.version === 2 &&
    typeof catalog.generatedAt === 'string' &&
    typeof catalog.toolCount === 'number' &&
    typeof catalog.categoryCount === 'number' &&
    Array.isArray(catalog.tags) &&
    Array.isArray(catalog.searchHints) &&
    Array.isArray(catalog.synonyms) &&
    Array.isArray(catalog.categories) &&
    Array.isArray(catalog.tools)
  );
}

function isOsintTool(value: unknown): value is OsintTool {
  if (!value || typeof value !== 'object') return false;
  const tool = value as Record<string, unknown>;
  return typeof tool.id === 'string' && typeof tool.name === 'string' && typeof tool.url === 'string';
}

export function extractToolShard(value: unknown): OsintTool[] {
  if (Array.isArray(value)) {
    if (!value.every(isOsintTool)) {
      throw new OsintCatalogLoadError('OSINT tool shard array contains an invalid tool.');
    }
    return value;
  }
  if (value && typeof value === 'object' && Array.isArray((value as { tools?: unknown }).tools)) {
    const tools = (value as { tools: unknown[] }).tools;
    if (!tools.every(isOsintTool)) {
      throw new OsintCatalogLoadError('OSINT tool shard { tools } contains an invalid tool.');
    }
    return tools;
  }
  throw new OsintCatalogLoadError('OSINT tool shard must be an array or { tools: OsintTool[] }.');
}

export function mergeOsintCatalogShards(meta: unknown, shards: unknown[]): OsintCatalog {
  if (!isOsintCatalog(meta)) {
    throw new OsintCatalogLoadError('OSINT catalog.meta.json is not a valid OsintCatalog v2 object.');
  }
  const tools = shards.flatMap((shard) => extractToolShard(shard));
  const merged: OsintCatalog = {
    source: meta.source,
    sourceFiles: meta.sourceFiles,
    generatedAt: meta.generatedAt,
    version: meta.version,
    toolCount: tools.length,
    categoryCount: meta.categories.length,
    tags: meta.tags,
    searchHints: meta.searchHints,
    synonyms: meta.synonyms,
    categories: meta.categories,
    tools,
  };
  if (!isOsintCatalog(merged)) {
    throw new OsintCatalogLoadError('Merged OSINT catalog is not a valid OsintCatalog v2 object.');
  }
  if (tools.length !== meta.toolCount) {
    throw new OsintCatalogLoadError(
      `Merged OSINT catalog has ${tools.length} tools, meta.toolCount is ${meta.toolCount}.`,
    );
  }
  if (meta.categories.length !== meta.categoryCount) {
    throw new OsintCatalogLoadError(
      `Merged OSINT catalog has ${meta.categories.length} categories, meta.categoryCount is ${meta.categoryCount}.`,
    );
  }
  return merged;
}

function shardUrl(fileName: string): string {
  return fileName.startsWith('/') ? fileName : `/osint/${fileName}`;
}

type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string> },
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

async function fetchJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new OsintCatalogLoadError(
      `WAITING ON catalog shards — ${url} returned HTTP ${response.status}.`,
      response.status,
    );
  }
  return response.json();
}

/**
 * Load catalog.meta.json plus catalog.tools.a.json / catalog.tools.b.json
 * and merge in memory. Do not invent tools when a shard is missing.
 */
export async function loadOsintCatalog(
  fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init),
): Promise<OsintCatalog> {
  const metaRaw = await fetchJson(fetchImpl, OSINT_CATALOG_META_URL);
  if (!isOsintCatalog(metaRaw)) {
    throw new OsintCatalogLoadError(
      `OSINT catalog at ${OSINT_CATALOG_META_URL} is not a valid OsintCatalog v2 object.`,
    );
  }
  const meta = metaRaw as OsintCatalogMeta;
  const shardFiles =
    Array.isArray(meta.toolShardFiles) && meta.toolShardFiles.length > 0
      ? meta.toolShardFiles
      : [...OSINT_CATALOG_TOOL_SHARD_URLS];
  const shards = [];
  for (const file of shardFiles) {
    shards.push(await fetchJson(fetchImpl, shardUrl(file)));
  }
  return mergeOsintCatalogShards(meta, shards);
}
