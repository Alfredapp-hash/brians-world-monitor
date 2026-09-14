import type { OsintCatalog, OsintDetailsShard, OsintTool, OsintToolDetails } from './catalog.types';

export const OSINT_CATALOG_META_URL = '/osint/catalog.meta.json';

/** @deprecated Not the load path. Loader reads catalog.meta.json + toolShardFiles. */
export const OSINT_CATALOG_URL = OSINT_CATALOG_META_URL;

export const OSINT_DETAILS_SHARD_URLS = [
  '/osint/catalog.details-0.json',
  '/osint/catalog.details-1.json',
  '/osint/catalog.details-2.json',
] as const;

const TOOL_SHARD_NAME = /^catalog\.tools\.[A-Za-z0-9_-]+\.json$/;

export class OsintCatalogLoadError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'OsintCatalogLoadError';
    this.status = status;
  }
}

export interface OsintCatalogMeta extends OsintCatalog {
  toolShardFiles: string[];
}

export function isOsintCatalog(value: unknown): value is OsintCatalog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
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

export function isOsintCatalogMeta(value: unknown): value is OsintCatalogMeta {
  if (!isOsintCatalog(value)) return false;
  return Array.isArray((value as { toolShardFiles?: unknown }).toolShardFiles);
}

function isOsintTool(value: unknown): value is OsintTool {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const tool = value as Record<string, unknown>;
  return typeof tool.id === 'string' && typeof tool.name === 'string' && typeof tool.url === 'string';
}

export function isOsintDetailsShard(value: unknown): value is OsintDetailsShard {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  for (const entry of Object.values(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  }
  return true;
}

export function applyToolDetails(tool: OsintTool, details: OsintToolDetails | undefined): OsintTool {
  if (!details) return tool;
  const howTo = Array.isArray(details.howTo) && details.howTo.length > 0 ? details.howTo : tool.howTo;
  const alternatives =
    Array.isArray(details.alternatives) && details.alternatives.length > 0
      ? details.alternatives
      : tool.alternatives;
  const detail = typeof details.detail === 'string' && details.detail.trim() ? details.detail : tool.detail;
  const proTip = details.proTip !== undefined ? details.proTip : tool.proTip;
  return { ...tool, detail, howTo, proTip, alternatives };
}

export function mergeDetailsShards(shards: unknown[]): Map<string, OsintToolDetails> {
  const merged = new Map<string, OsintToolDetails>();
  for (const shard of shards) {
    if (!isOsintDetailsShard(shard)) continue;
    for (const [toolId, details] of Object.entries(shard)) {
      const previous = merged.get(toolId) ?? {};
      merged.set(toolId, { ...previous, ...details });
    }
  }
  return merged;
}

/** Same-origin /osint/<basename> only. Never follow file:// or remote URLs. */
export function toolShardUrl(fileName: string): string {
  if (typeof fileName !== 'string' || fileName.includes('://') || fileName.includes('..')) {
    throw new OsintCatalogLoadError(`Invalid tool shard name: ${fileName}`);
  }
  const name = fileName.replace(/^\/osint\//, '').replace(/^.*\//, '');
  if (!TOOL_SHARD_NAME.test(name)) {
    throw new OsintCatalogLoadError(`Invalid tool shard name: ${fileName}`);
  }
  return `/osint/${name}`;
}

/**
 * Parse a tool shard. Must be a JSON array of tools.
 * Never treat string contents (file:// stubs) as paths to fetch.
 */
export function extractToolShard(value: unknown, label = 'tool shard'): OsintTool[] {
  if (typeof value === 'string') {
    throw new OsintCatalogLoadError(
      `WAITING ON catalog shards — ${label} is a path/stub, not a JSON array of tools.`,
    );
  }
  if (!Array.isArray(value)) {
    throw new OsintCatalogLoadError(
      `WAITING ON catalog shards — ${label} must be a JSON array of tools.`,
    );
  }
  if (!value.every(isOsintTool)) {
    throw new OsintCatalogLoadError(`OSINT ${label} array contains an invalid tool.`);
  }
  return value;
}

export function mergeOsintCatalogShards(meta: unknown, shards: unknown[]): OsintCatalog {
  if (!isOsintCatalog(meta)) {
    throw new OsintCatalogLoadError('OSINT catalog.meta.json is not a valid OsintCatalog v2 object.');
  }
  const tools = shards.flatMap((shard, index) => extractToolShard(shard, `shard ${index}`));
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
    toolShardFiles: 'toolShardFiles' in meta ? meta.toolShardFiles : undefined,
  };
  if (!isOsintCatalog(merged)) {
    throw new OsintCatalogLoadError('Merged OSINT catalog is not a valid OsintCatalog v2 object.');
  }
  if (tools.length !== meta.toolCount) {
    throw new OsintCatalogLoadError(
      `WAITING ON catalog shards — merged ${tools.length} tools, meta.toolCount is ${meta.toolCount}.`,
    );
  }
  if (meta.categories.length !== meta.categoryCount) {
    throw new OsintCatalogLoadError(
      `Merged OSINT catalog has ${meta.categories.length} categories, meta.categoryCount is ${meta.categoryCount}.`,
    );
  }
  return merged;
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
  try {
    return await response.json();
  } catch {
    throw new OsintCatalogLoadError(
      `WAITING ON catalog shards — ${url} is not parseable JSON.`,
      response.status,
    );
  }
}

async function fetchJsonOptional(fetchImpl: FetchLike, url: string): Promise<unknown | null> {
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Load `/osint/catalog.meta.json`, then fetch every file in `meta.toolShardFiles`.
 * Each shard must be a JSON array of tools. Do not invent tools when a shard is missing.
 * Never treat shard file contents as paths.
 */
export async function loadOsintCatalog(
  fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init),
): Promise<OsintCatalog> {
  const metaRaw = await fetchJson(fetchImpl, OSINT_CATALOG_META_URL);
  if (!isOsintCatalogMeta(metaRaw)) {
    throw new OsintCatalogLoadError(
      `OSINT catalog at ${OSINT_CATALOG_META_URL} is not a valid meta object with toolShardFiles.`,
    );
  }
  if (metaRaw.toolShardFiles.length === 0) {
    throw new OsintCatalogLoadError(
      'WAITING ON catalog shards — catalog.meta.json has an empty toolShardFiles list.',
    );
  }
  const shards: unknown[] = [];
  for (const file of metaRaw.toolShardFiles) {
    const url = toolShardUrl(file);
    shards.push(await fetchJson(fetchImpl, url));
  }
  return mergeOsintCatalogShards(metaRaw, shards);
}

/**
 * Optional expand overlays. Missing shards are ignored — cards still render.
 */
export async function loadOsintCatalogDetails(
  fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init),
): Promise<Map<string, OsintToolDetails>> {
  const shards = await Promise.all(
    OSINT_DETAILS_SHARD_URLS.map((url) => fetchJsonOptional(fetchImpl, url)),
  );
  return mergeDetailsShards(shards.filter((shard) => shard != null));
}
