/**
 * Narrative tracker: persistence layer for talking-point phrases across
 * analysis runs. A phrase that keeps reappearing over hours or days is a
 * pushed narrative, not a news cycle — one-off synchronization can be
 * coincidence or wire copy, but persistence is the campaign signature.
 *
 * Storage-agnostic core (injectable store) so it's unit-testable; the
 * default store is localStorage.
 */

export interface NarrativeRecord {
  /** First time this phrase was observed (ms epoch). */
  first: number;
  /** Most recent observation (ms epoch). */
  last: number;
  /** Number of distinct analysis runs that observed it. */
  runs: number;
  /** Union of outlets seen using it (capped). */
  sources: string[];
}

export interface NarrativeStatus {
  phrase: string;
  record: NarrativeRecord;
  /** True when seen in >= 3 runs spanning >= 6 hours. */
  recurring: boolean;
  /** Human-readable age, e.g. "2d" / "7h" / "just now". */
  age: string;
}

export interface NarrativeStore {
  read(): Record<string, NarrativeRecord>;
  write(data: Record<string, NarrativeRecord>): void;
}

const STORE_KEY = 'bwm-narrative-history';
const MAX_PHRASES = 500;
const MAX_SOURCES_PER_PHRASE = 12;
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
export const RECURRING_MIN_RUNS = 3;
export const RECURRING_MIN_SPAN_MS = 6 * 60 * 60 * 1000; // 6 hours

export function localStorageNarrativeStore(): NarrativeStore {
  return {
    read() {
      try {
        return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') as Record<string, NarrativeRecord>;
      } catch {
        return {};
      }
    },
    write(data) {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(data));
      } catch { /* storage unavailable */ }
    },
  };
}

export function formatAge(spanMs: number): string {
  if (spanMs < 60_000) return 'just now';
  const mins = Math.floor(spanMs / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Record this run's coordinated phrases and return the tracking status of
 * each. Call once per analysis run with the coordinated (non-wire) phrases.
 */
export function trackNarratives(
  phrases: Array<{ phrase: string; sources: string[] }>,
  store: NarrativeStore,
  now: number = Date.now(),
): Map<string, NarrativeStatus> {
  const data = store.read();

  // Retention sweep + size cap (oldest-last first out).
  for (const [k, rec] of Object.entries(data)) {
    if (!rec || now - rec.last > RETENTION_MS) delete data[k];
  }
  const keys = Object.keys(data);
  if (keys.length > MAX_PHRASES) {
    keys.sort((a, b) => (data[a]?.last ?? 0) - (data[b]?.last ?? 0));
    for (const k of keys.slice(0, keys.length - MAX_PHRASES)) delete data[k];
  }

  const out = new Map<string, NarrativeStatus>();
  for (const p of phrases) {
    const existing = data[p.phrase];
    // Count as a new run only if the last observation was > 10 minutes ago,
    // so rapid re-analyses don't inflate run counts.
    if (existing) {
      const isNewRun = now - existing.last > 10 * 60_000;
      existing.last = now;
      if (isNewRun) existing.runs += 1;
      existing.sources = [...new Set([...existing.sources, ...p.sources])].slice(0, MAX_SOURCES_PER_PHRASE);
    } else {
      data[p.phrase] = { first: now, last: now, runs: 1, sources: p.sources.slice(0, MAX_SOURCES_PER_PHRASE) };
    }
    const rec = data[p.phrase]!;
    const span = rec.last - rec.first;
    out.set(p.phrase, {
      phrase: p.phrase,
      record: rec,
      recurring: rec.runs >= RECURRING_MIN_RUNS && span >= RECURRING_MIN_SPAN_MS,
      age: formatAge(span),
    });
  }

  store.write(data);
  return out;
}
