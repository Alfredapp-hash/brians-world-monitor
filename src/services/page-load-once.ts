import { isOperatorLiveTickPanel, OPERATOR_REFRESH_ON_LOAD_ONLY } from '@/config/panels';

const calls = new Map<string, Promise<unknown>>();
const bootSatisfied = new Set<string>();

/**
 * Operator dashboards pay for each intelligence read on the Upstash free tier.
 * Concurrent boot callers (prime + a second loader) and the one-shot scheduler
 * share one in-flight promise and then reuse the settled result — including a
 * visible empty or HTTP failure — so a replay does not issue another request.
 * `force` is the explicit user retry.
 */
export function oncePerPageLoad<T>(key: string, run: () => Promise<T>, force = false): Promise<T> {
  if (!OPERATOR_REFRESH_ON_LOAD_ONLY) return run();
  if (force) calls.delete(key);
  const existing = calls.get(key);
  if (existing) return existing as Promise<T>;
  const promise = Promise.resolve().then(run);
  calls.set(key, promise);
  return promise;
}

/** Boot already loaded this refresh name. The one-shot scheduler must not run it again. */
export function markBootRefreshSatisfied(name: string): void {
  if (!OPERATOR_REFRESH_ON_LOAD_ONLY || isOperatorLiveTickPanel(name)) return;
  bootSatisfied.add(name);
}

export function isBootRefreshSatisfied(name: string): boolean {
  return OPERATOR_REFRESH_ON_LOAD_ONLY && !isOperatorLiveTickPanel(name) && bootSatisfied.has(name);
}

export function resetPageLoadOnceForTests(): void {
  calls.clear();
  bootSatisfied.clear();
}
