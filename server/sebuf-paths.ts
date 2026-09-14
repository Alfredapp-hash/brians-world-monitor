/** Path helpers for sebuf + Netlify dispatch. No handler imports. */

export const SEBUF_PATH_RE = /^\/api\/(?:[a-z][a-z0-9-]*\/v\d+|v\d+\/[a-z][a-z0-9-]*)\//;

export const V1_ALIASES: Record<string, string> = {
  '/api/scenario/v1/run': '/api/scenario/v1/run-scenario',
  '/api/scenario/v1/status': '/api/scenario/v1/get-scenario-status',
  '/api/scenario/v1/templates': '/api/scenario/v1/list-scenario-templates',
  '/api/supply-chain/v1/country-products': '/api/supply-chain/v1/get-country-products',
  '/api/supply-chain/v1/multi-sector-cost-shock': '/api/supply-chain/v1/get-multi-sector-cost-shock',
};

export function rewriteSebufAlias(pathname: string): string {
  return V1_ALIASES[pathname] ?? pathname;
}

export function isSebufApiPath(pathname: string): boolean {
  return SEBUF_PATH_RE.test(pathname);
}

export function normalizeApiPathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname || '/';
}

export function resolveDispatchPath(pathname: string): string {
  return rewriteSebufAlias(normalizeApiPathname(pathname));
}
