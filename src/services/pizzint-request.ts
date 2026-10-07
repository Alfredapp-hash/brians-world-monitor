import { createLazyClient, getRpcBaseUrl } from '@/services/rpc-client';
import { createCircuitBreaker } from '@/utils/circuit-breaker';
import { getHydratedData } from '@/services/bootstrap';
import { oncePerPageLoad } from '@/services/page-load-once';
import type { GetPizzintStatusResponse } from '@/generated/client/worldmonitor/intelligence/v1/service_client';
import { IntelligenceServiceClient } from '@/services/generated-rpc-clients';

export const PIZZINT_EMPTY_MESSAGE = 'No PizzINT data';
export const PIZZINT_REQUEST_FAILED = 'PizzINT request failed';

const getClient = createLazyClient(() => new IntelligenceServiceClient(getRpcBaseUrl(), { fetch: (...args) => globalThis.fetch(...args) }));

export type PizzintSharedResult =
  | { kind: 'data'; resp: GetPizzintStatusResponse }
  | { kind: 'empty'; reason: string };

const pizzintBreaker = createCircuitBreaker<PizzintSharedResult>({
  name: 'PizzINT',
  maxFailures: 3,
  cooldownMs: 5 * 60 * 1000,
  cacheTtlMs: 30 * 60 * 1000,
  persistCache: true,
});

let hydratedMemo: GetPizzintStatusResponse | null | undefined;

function readHydratedPizzint(): GetPizzintStatusResponse | null {
  if (hydratedMemo !== undefined) return hydratedMemo;
  hydratedMemo = (getHydratedData('pizzint') as GetPizzintStatusResponse | undefined) ?? null;
  return hydratedMemo;
}

/**
 * One page-load read of PizzINT status and GDELT tensions.
 * `include_gdelt=true` is the same Redis seed as the plain status call; the
 * handler only chooses whether to keep tension pairs. A 200 with no pizzint
 * payload is an empty seed: record it and do not throw, or the breaker skips
 * its cache and the boot replay fetches again.
 */
export function fetchPizzintShared(): Promise<PizzintSharedResult> {
  const hydrated = readHydratedPizzint();
  if (hydrated?.pizzint) return Promise.resolve({ kind: 'data', resp: hydrated });

  return oncePerPageLoad('intelligence:get-pizzint-status', () => pizzintBreaker.execute(async () => {
    const resp = await getClient().getPizzintStatus({ includeGdelt: true });
    if (!resp.pizzint) {
      console.error(`[PizzINT] ${PIZZINT_EMPTY_MESSAGE}`);
      return { kind: 'empty', reason: PIZZINT_EMPTY_MESSAGE };
    }
    return { kind: 'data', resp };
  }, { kind: 'empty', reason: PIZZINT_REQUEST_FAILED }));
}

export function getPizzintBreakerStatus(): string {
  return pizzintBreaker.getStatus();
}

export function resetPizzintRequestForTests(): void {
  hydratedMemo = undefined;
  pizzintBreaker.clearMemoryCache();
}
