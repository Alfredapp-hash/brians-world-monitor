/**
 * ALPR (automatic license plate reader) camera positions.
 *
 * Static snapshot generated from OpenStreetMap via
 * scripts/update-alpr-cameras.mjs — the same public dataset DeFlock
 * (https://deflock.org) visualizes. Lazily fetched the first time the map
 * layer is enabled (~120k points, a few MB, cached for the session).
 */

export interface AlprCamera {
  lat: number;
  lon: number;
  /** 0=unknown, 1=Flock Safety, 2=Motorola/Vigilant, 3=Genetec, 4=other */
  mfr: number;
}

export const ALPR_MANUFACTURERS: Record<number, string> = {
  0: 'Unknown operator',
  1: 'Flock Safety',
  2: 'Motorola / Vigilant',
  3: 'Genetec',
  4: 'Other',
};

interface AlprSnapshot {
  updated: string;
  count: number;
  cameras: Array<[number, number, number]>;
}

let cache: AlprCamera[] | null = null;
let inflight: Promise<AlprCamera[]> | null = null;
let snapshotUpdated: string | null = null;

export function getAlprSnapshotDate(): string | null {
  return snapshotUpdated;
}

export async function loadAlprCameras(): Promise<AlprCamera[]> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch('/data/alpr-cameras.json', { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) return [];
      const data = await res.json() as AlprSnapshot;
      snapshotUpdated = data.updated ?? null;
      cache = (data.cameras || []).map(([lat, lon, mfr]) => ({ lat, lon, mfr: mfr ?? 0 }));
      return cache;
    } catch {
      return [];
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Synchronous accessor for already-loaded data (empty until loaded). */
export function getLoadedAlprCameras(): AlprCamera[] {
  return cache ?? [];
}
