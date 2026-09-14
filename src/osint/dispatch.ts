/** Public product name and path for The Public Dispatch OSINT catalog. */
export const OSINT_DISPATCH_NAME = 'OSINTDispatch';
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

export function isOsintDispatchPath(pathname: string): boolean {
  const path = normalizePublicPath(pathname);
  return path === OSINT_DISPATCH_PATH || path === OSINT_DISPATCH_HTML;
}
