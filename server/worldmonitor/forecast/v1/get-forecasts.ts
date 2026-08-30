import type {
  Forecast,
  ForecastServiceHandler,
  ServerContext,
  GetForecastsRequest,
  GetForecastsResponse,
} from '../../../../src/generated/server/worldmonitor/forecast/v1/service_server';
import filterParamContracts from '../../../../shared/openapi-filter-param-contracts.json';
import { getRawJson } from '../../../_shared/redis';
import { markNoStoreFallbackResponse } from '../../../_shared/response-headers';

const REDIS_KEY = 'forecast:predictions:v2';
const FORECAST_DOMAINS = new Set(filterParamContracts.forecastDomains);

type ForecastPredictions = { predictions: Forecast[]; generatedAt: number };

// Request coalescing (#179): concurrent invocations (e.g. rapid region-pill
// clicks firing several edge invocations at once) share one in-flight
// `getRawJson` promise instead of each issuing its own Redis GET.
//
// This is deliberately NOT `cachedFetchJson` — that helper's cache key IS
// the Redis key it reads/writes, and `REDIS_KEY` here is the exact canonical
// key `scripts/seed-forecasts.mjs` seeds with a 6h TTL. Reusing it as
// `cachedFetchJson`'s cache key meant (a) `readCachedJson` almost always hit
// on the very first call — since the seeded value already lives under that
// same key — so the in-flight Map was never consulted and concurrent calls
// each did their own Redis GET (zero actual coalescing on the common warm
// path), and (b) on a genuine miss/race, `cachedFetchJson` would `SET` a
// 45s TTL onto the seeder's canonical key, clobbering its intentional 6h
// buffer. A plain in-process Map<key, Promise> avoids both: it never reads
// or writes Redis itself, so it can't affect the canonical key's TTL, and
// coalescing works regardless of whether the underlying value is a
// Redis cache-hit or not. See
// docs/archive/todos/179-pending-p2-getforecasts-handler-no-cachedfetchjson.md.
const inFlight = new Map<string, Promise<ForecastPredictions | null>>();

async function readForecastsCoalesced(): Promise<ForecastPredictions | null> {
  const existing = inFlight.get(REDIS_KEY);
  if (existing) return existing;

  const promise = getRawJson(REDIS_KEY) as Promise<ForecastPredictions | null>;
  inFlight.set(REDIS_KEY, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(REDIS_KEY);
  }
}

export const getForecasts: ForecastServiceHandler['getForecasts'] = async (
  ctx: ServerContext,
  req: GetForecastsRequest,
): Promise<GetForecastsResponse> => {
  try {
    const data = await readForecastsCoalesced();
    if (!data?.predictions) {
      return markNoStoreFallbackResponse(ctx.request, { forecasts: [], generatedAt: 0, degraded: false, stale: false, error: '' });
    }

    let forecasts = data.predictions;
    if (req.domain) {
      if (!FORECAST_DOMAINS.has(req.domain)) {
        return { forecasts: [], generatedAt: data.generatedAt || 0, degraded: false, stale: false, error: '' };
      }
      forecasts = forecasts.filter(f => f.domain === req.domain);
    }
    if (req.region) forecasts = forecasts.filter(f => f.region.toLowerCase().includes(req.region.toLowerCase()));

    return { forecasts, generatedAt: data.generatedAt || 0, degraded: false, stale: false, error: '' };
  } catch (err) {
    console.error('[forecast] getRawJson failed:', err instanceof Error ? err.message : String(err));
    return {
      forecasts: [],
      generatedAt: 0,
      degraded: true,
      stale: false,
      error: 'forecast_backend_unavailable',
    };
  }
};
