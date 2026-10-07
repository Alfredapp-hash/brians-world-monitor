import { oncePerPageLoad } from '@/services/page-load-once';
import { createLazyClient, getRpcBaseUrl } from '@/services/rpc-client';
import type { ListEarningsCalendarResponse } from '@/generated/client/worldmonitor/market/v1/service_client';
import { MarketServiceClient } from '@/services/generated-rpc-clients';

const getClient = createLazyClient(() => new MarketServiceClient(getRpcBaseUrl(), { fetch: (...args) => globalThis.fetch(...args) }));

/**
 * The handler ignores from/to and returns the seeded calendar. One page-load
 * read serves the panel and the daily-brief collector.
 */
export function fetchEarningsCalendar(fromDate: string, toDate: string, force = false): Promise<ListEarningsCalendarResponse> {
  return oncePerPageLoad(
    'market:list-earnings-calendar',
    () => getClient().listEarningsCalendar({ fromDate, toDate }),
    force,
  );
}
