import type { OsintCatalog } from './catalog.types';

/** Same-origin static file. Cody will commit the full v2 catalog here. */
export const OSINT_CATALOG_URL = '/osint/catalog.json';

export class OsintCatalogLoadError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'OsintCatalogLoadError';
    this.status = status;
  }
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

type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string> },
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

/**
 * Load the portable OSINT4ALL catalog from `/osint/catalog.json`.
 * TODO: commit `public/osint/catalog.json` (246 tools / 49 categories).
 * Do not invent tools when the file is missing.
 */
export async function loadOsintCatalog(
  fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init),
): Promise<OsintCatalog> {
  const response = await fetchImpl(OSINT_CATALOG_URL, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new OsintCatalogLoadError(
      `WAITING ON catalog.json commit — ${OSINT_CATALOG_URL} returned HTTP ${response.status}.`,
      response.status,
    );
  }
  const data: unknown = await response.json();
  if (!isOsintCatalog(data)) {
    throw new OsintCatalogLoadError(
      `OSINT catalog at ${OSINT_CATALOG_URL} is not a valid OsintCatalog v2 object.`,
    );
  }
  return data;
}
