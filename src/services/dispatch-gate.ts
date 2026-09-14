/**
 * First-visit entry ritual for The Public Dispatch.
 *
 * Storage + show/hide policy only. The overlay and the fly → flatten
 * sequence live in the component / app layer so this module stays
 * testable without a document.
 */

export const DISPATCH_ENTERED_KEY = 'tpd-dispatch-entered-v1';
export const DISPATCH_HOME_LOCATION_KEY = 'tpd-home-location-v1';
export const DISPATCH_GATE_FORCE_PARAM = 'tpd_gate';

/** Matches GlobeMap.setCenter rotation so the fly can finish before flatten. */
export const DISPATCH_FLY_MS = 1200;

export type DispatchLocationSource = 'postal' | 'geo' | 'ip' | 'skipped';

export interface DispatchHomeLocation {
  postal?: string;
  countryCode?: string;
  lat?: number;
  lon?: number;
  region?: string;
  source: DispatchLocationSource;
}

/** Minimal storage surface, so the pure logic is testable without a browser. */
export interface DispatchGateStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const SKIP_PATH_PREFIXES = [
  '/embed',
  '/settings',
  '/live-channels',
  '/mcp-grant',
  '/osint4all',
  '/about',
  '/methodology',
] as const;

const LOCATION_SOURCES = new Set<DispatchLocationSource>(['postal', 'geo', 'ip', 'skipped']);

function safeStore(store?: DispatchGateStore | null): DispatchGateStore | null {
  if (store !== undefined) return store;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function read(store: DispatchGateStore | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(store: DispatchGateStore | null, key: string, value: string): void {
  try {
    store?.setItem(key, value);
  } catch {
    // Best-effort: the gate still applies for this page load.
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizePathname(pathname: string | null | undefined): string {
  if (!pathname) return '/';
  const trimmed = pathname.split('?')[0]?.split('#')[0] ?? '/';
  if (trimmed.length > 1 && trimmed.endsWith('/')) return trimmed.slice(0, -1);
  return trimmed || '/';
}

function isSkippedDashboardPath(pathname: string | null | undefined): boolean {
  const path = normalizePathname(pathname).toLowerCase();
  return SKIP_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}.`));
}

function truthyParam(raw: string | null): boolean {
  return raw === '1' || raw === 'true';
}

function falsyParam(raw: string | null): boolean {
  return raw === '0' || raw === 'false';
}

export interface DispatchGateShowInput {
  store?: DispatchGateStore | null;
  search?: string | null;
  pathname?: string | null;
  isE2E?: boolean;
}

/**
 * Whether the first-visit overlay should run for this load.
 *
 * Does not read or write `jsam-stage-mode`. Visual God's Eye for the gate is
 * a presentation attribute, not a stored stage preference.
 */
export function shouldShowDispatchGate(input: DispatchGateShowInput = {}): boolean {
  const params = new URLSearchParams(input.search || '');
  const godseye = params.get('godseye');
  if (truthyParam(godseye) || falsyParam(godseye)) return false;
  if (isSkippedDashboardPath(input.pathname)) return false;

  const force = truthyParam(params.get(DISPATCH_GATE_FORCE_PARAM));
  if (input.isE2E && !force) return false;

  const entered = read(safeStore(input.store), DISPATCH_ENTERED_KEY);
  if (entered === '1' && !force) return false;
  return true;
}

export function isDispatchEntered(store?: DispatchGateStore | null): boolean {
  return read(safeStore(store), DISPATCH_ENTERED_KEY) === '1';
}

export function markDispatchEntered(store?: DispatchGateStore | null): void {
  write(safeStore(store), DISPATCH_ENTERED_KEY, '1');
}

export function parseHomeLocation(raw: string | null | undefined): DispatchHomeLocation | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DispatchHomeLocation>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!LOCATION_SOURCES.has(parsed.source as DispatchLocationSource)) return null;
    const location: DispatchHomeLocation = { source: parsed.source as DispatchLocationSource };
    if (typeof parsed.postal === 'string' && parsed.postal.trim()) {
      location.postal = parsed.postal.trim();
    }
    if (typeof parsed.countryCode === 'string' && parsed.countryCode.trim()) {
      location.countryCode = parsed.countryCode.trim().toUpperCase();
    }
    if (isFiniteNumber(parsed.lat)) location.lat = parsed.lat;
    if (isFiniteNumber(parsed.lon)) location.lon = parsed.lon;
    if (typeof parsed.region === 'string' && parsed.region.trim()) {
      location.region = parsed.region.trim();
    }
    return location;
  } catch {
    return null;
  }
}

export function readHomeLocation(store?: DispatchGateStore | null): DispatchHomeLocation | null {
  return parseHomeLocation(read(safeStore(store), DISPATCH_HOME_LOCATION_KEY));
}

export function persistHomeLocation(
  location: DispatchHomeLocation,
  store?: DispatchGateStore | null,
): void {
  write(safeStore(store), DISPATCH_HOME_LOCATION_KEY, JSON.stringify(location));
}

export function hasFlyableLocation(
  location: DispatchHomeLocation | null | undefined,
): location is DispatchHomeLocation & { lat: number; lon: number } {
  return !!location && isFiniteNumber(location.lat) && isFiniteNumber(location.lon);
}
