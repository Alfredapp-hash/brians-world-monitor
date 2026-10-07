import { getHydratedData } from '@/services/bootstrap';
import { oncePerPageLoad } from '@/services/page-load-once';
import { createLazyClient, getRpcBaseUrl } from '@/services/rpc-client';
import type { GetFearGreedIndexResponse } from '@/generated/client/worldmonitor/market/v1/service_client';
import { MarketServiceClient } from '@/services/generated-rpc-clients';

const getClient = createLazyClient(() => new MarketServiceClient(getRpcBaseUrl(), { fetch: (...args) => globalThis.fetch(...args) }));

let hydratedMemo: Record<string, unknown> | null | undefined;

/** Consume bootstrap once, then hand the same payload to every boot reader. */
export function readFearGreedHydration(): Record<string, unknown> | null {
  if (hydratedMemo !== undefined) return hydratedMemo;
  hydratedMemo = (getHydratedData('fearGreedIndex') as Record<string, unknown> | undefined) ?? null;
  return hydratedMemo;
}

export function fetchFearGreedIndex(force = false): Promise<GetFearGreedIndexResponse> {
  return oncePerPageLoad('market:get-fear-greed-index', () => getClient().getFearGreedIndex({}), force);
}

export function resetFearGreedHydrationForTests(): void {
  hydratedMemo = undefined;
}
