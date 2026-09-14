/** Public product name and path for The Public Dispatch OSINT catalog. */
export const OSINT_DISPATCH_NAME = 'OSINTDispatch';
/** Canonical public path — keep this exact case (Brian / PM lock). */
export const OSINT_DISPATCH_PATH = '/OSINTDispatch';
export const OSINT_DISPATCH_HTML = '/OSINTDispatch.html';
/** Stable dashboard panel id — do not rename; settings persist by this key. */
export const OSINT_CATALOG_PANEL_ID = 'osint-catalog';

/** Brian's typed spelling — keep as a cheap redirect alias only. */
export const OSINT_DISPATCH_ALIASES = ['/ONSITDispatch'] as const;

export function normalizePublicPath(pathname: string): string {
  if (pathname.length > 1) return pathname.replace(/\/+$/, '');
  return pathname;
}

/**
 * True for the canonical path and Netlify's forced-lowercase static twin.
 * Netlify CDN 301s mixed-case *static* file URLs to lowercase (no opt-out).
 * Canonical advertised path stays `/OSINTDispatch`; do not ship a different slug.
 */
export function isOsintDispatchPath(pathname: string): boolean {
  const path = normalizePublicPath(pathname).toLowerCase();
  return path === '/osintdispatch' || path === '/osintdispatch.html';
}

export function canonicalOsintDispatchHref(search = '', hash = ''): string {
  return `${OSINT_DISPATCH_PATH}${search}${hash}`;
}
