import type { OsintCatalog, OsintDetailsShard, OsintTool, OsintToolDetails } from './catalog.types';

export const OSINT_CATALOG_URL = '/osint/catalog.json';

export const OSINT_DETAILS_SHARD_URLS = [
  '/osint/catalog.details-0.json',
  '/osint/catalog.details-1.json',
  '/osint/catalog.details-2.json',
] as const;

export class OsintCatalogLoadError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'OsintCatalogLoadError';
    this.status = status;
  }
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
      `WAITING ON catalog.json — ${url} returned HTTP ${response.status}.`,
      response.status,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new OsintCatalogLoadError(
      `WAITING ON catalog.json — ${url} is not parseable JSON.`,
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
 * Load the portable catalog from `/osint/catalog.json`.
 * Do not invent tools when the file is missing.
 */
export async function loadOsintCatalog(
  fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init),
): Promise<OsintCatalog> {
  const data = await fetchJson(fetchImpl, OSINT_CATALOG_URL);
  if (!isOsintCatalog(data)) {
    throw new OsintCatalogLoadError(
      `WAITING ON catalog.json — ${OSINT_CATALOG_URL} is not a valid OsintCatalog v2 object.`,
    );
  }
  return data;
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
