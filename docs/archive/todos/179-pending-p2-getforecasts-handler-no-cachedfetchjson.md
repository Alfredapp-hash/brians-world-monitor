---
status: done
priority: p2
issue_id: 179
tags: [code-review, phase-0, regional-intelligence, performance, redis, cache-stampede]
dependencies: []
---

# getForecasts RPC handler lacks cachedFetchJson coalescing (cache stampede risk)

## Problem Statement

`server/worldmonitor/forecast/v1/get-forecasts.ts:17` calls `getCachedJson(REDIS_KEY)` directly. Per CLAUDE.md ("Cache Stampede: Use cachedFetchJson"), RPC handlers with shared cache should use `cachedFetchJson` to coalesce concurrent misses. With 8 region pills and a user clicking quickly, multiple concurrent edge function invocations could each miss the in-process cache and hit Upstash with the same key.

## Findings

- `server/worldmonitor/forecast/v1/get-forecasts.ts:17` — uses `getCachedJson` directly without `cachedFetchJson` wrapper.
- CLAUDE.md "Cache Stampede: Use cachedFetchJson (Critical Pattern)" — established rule for all RPC handlers with shared cache.

## Proposed Solutions

### Option 1: Wrap in cachedFetchJson

Wrap the read in `cachedFetchJson` with a 30-60s in-process TTL keyed by `forecast:predictions:v2`.

**Pros:** Matches project convention; concurrent identical requests share one Redis round-trip; documented pattern; minimal diff.
**Cons:** None significant.
**Effort:** Small.
**Risk:** Low.

## Recommended Action

Option 1. Separate from PR #2942 scope but highlighted by it — the forecast panel's region pills (see #178) multiply concurrent reads, making the stampede window measurably hit.

## Technical Details

`cachedFetchJson` (in `server/_shared/redis.ts`) coalesces concurrent cache misses via an in-process `Map<key, Promise>`. The first request issues the Redis GET; parallel requests await the same promise. When the promise resolves, all waiters receive the result without additional Redis traffic.

Per CLAUDE.md:
1. Wrap in try-catch for stale/backup fallback.
2. Await stale/backup cache writes (Edge runtimes may terminate isolate).

Cache key: `forecast:predictions:v2` (match the Redis key). In-process TTL: 30-60s is the canonical window used by other handlers in this directory.

## Acceptance Criteria

- [ ] `get-forecasts.ts` uses `cachedFetchJson` per the CLAUDE.md cache stampede rule.
- [ ] Concurrent identical RPC requests share a single in-flight Redis read.
- [ ] Stale/backup fallback path is exercised via try-catch.
- [ ] Test: 10 parallel identical RPC calls produce 1 Redis GET.

## Work Log

- undefined: Fixed — `get-forecasts.ts` now wraps the `getRawJson(REDIS_KEY)` read in `cachedFetchJson(REDIS_KEY, 45, () => getRawJson(REDIS_KEY))`, so concurrent invocations coalesce onto a single in-flight promise via the existing in-process `Map<key, Promise>`, and the existing try/catch around the whole read still provides the degraded-response fallback.
- 2026-08-03: Adversarial verify caught a real bug in the above: `cachedFetchJson`'s cache key IS the Redis key it reads/writes via `readCachedJson`/`setCachedJson`, and `REDIS_KEY` (`forecast:predictions:v2`) here is the *exact same* canonical key `scripts/seed-forecasts.mjs` seeds directly with a 6h TTL. Two consequences, both confirmed by reproduction: (1) `readCachedJson` hits on that key almost immediately (it's the same already-populated seeded value), so the in-flight `Map` was never actually consulted on the common warm path — 5 concurrent calls produced 5 independent Redis GETs, i.e. **zero** real coalescing, failing the doc's own acceptance criterion; (2) on a genuine miss/race, `cachedFetchJson`'s `setCachedJson(key, result, 45)` would `SET` the canonical seed key with a 45s TTL, clobbering the seeder's deliberate 21600s (6h) buffer — a real production-data risk (forecast feed could silently empty ~45s after quiet traffic until the next hourly reseed).
  - **Re-fixed properly**: replaced the `cachedFetchJson` wrapper with a small, self-contained in-process `Map<string, Promise>` coalescer (`inFlight` + `readForecastsCoalesced()` in `get-forecasts.ts`), matching the existing bare-coalescing idiom already used elsewhere in this codebase for the same purpose (`server/_shared/entitlement-check.ts`'s `_inFlight` map, `server/_shared/llm-health.ts`'s `inFlight` map) rather than `cachedFetchJson`, which is designed for a genuinely different scenario — a value with no persistent canonical Redis key of its own. This coalescer never issues a Redis SET and can't affect the canonical key's TTL, while still genuinely coalescing concurrent calls regardless of whether the read is a cache-hit.
  - Added a regression test (`tests/forecast-get-forecasts.test.mts`, "coalesces concurrent invocations into a single Redis GET and never SETs the canonical key") that fires 5 concurrent `getForecasts()` calls and asserts exactly 1 upstream `fetch` (a GET, never a SET/write) occurs — directly covers the doc's "10 parallel identical RPC calls produce 1 Redis GET" criterion (scaled to 5, same assertion) and guards against the TTL-clobber regression.
  - Verified: `npx biome lint server/worldmonitor/forecast/v1/get-forecasts.ts tests/forecast-get-forecasts.test.mts` clean; `npx tsc --noEmit -p tsconfig.api.json` clean; `npx tsx --test tests/forecast-get-forecasts.test.mts` 7/7 pass (up from 6, new coalescing test added).

## Resources

- PR #2942
- Spec: `docs/internal/pro-regional-intelligence-upgrade.md`
- CLAUDE.md: "Cache Stampede: Use cachedFetchJson (Critical Pattern)"
