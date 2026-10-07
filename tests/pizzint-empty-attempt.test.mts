import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RefreshScheduler } from '../src/app/refresh-scheduler.ts';
import { fetchEarningsCalendar } from '../src/services/earnings-calendar.ts';
import { fetchFearGreedIndex, resetFearGreedHydrationForTests } from '../src/services/fear-greed.ts';
import { fetchMarketImplications } from '../src/services/market-implications.ts';
import { markBootRefreshSatisfied, resetPageLoadOnceForTests } from '../src/services/page-load-once.ts';
import {
  fetchPizzintShared,
  PIZZINT_EMPTY_MESSAGE,
  PIZZINT_REQUEST_FAILED,
  resetPizzintRequestForTests,
} from '../src/services/pizzint-request.ts';

const originalFetch = globalThis.fetch;

function installFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): { urls: string[] } {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    urls.push(url);
    return handler(url, init);
  }) as typeof fetch;
  return { urls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetPageLoadOnceForTests();
  resetPizzintRequestForTests();
  resetFearGreedHydrationForTests();
});

describe('PizzINT empty body', () => {
  it('makes one attempt and returns one empty state', async () => {
    const { urls } = installFetch(() => jsonResponse({ tensionPairs: [] }));

    const results = await Promise.all([
      fetchPizzintShared(),
      fetchPizzintShared(),
      fetchPizzintShared(),
    ]);
    await fetchPizzintShared();

    const statusCalls = urls.filter((url) => url.includes('/api/intelligence/v1/get-pizzint-status'));
    assert.equal(statusCalls.length, 1);
    assert.equal(statusCalls[0]?.includes('include_gdelt=true'), true);
    for (const result of results) {
      assert.equal(result.kind, 'empty');
      if (result.kind === 'empty') assert.equal(result.reason, PIZZINT_EMPTY_MESSAGE);
    }
  });

  it('makes one attempt when the request fails', async () => {
    const { urls } = installFetch(() => {
      throw new Error('network down');
    });

    const results = await Promise.all([
      fetchPizzintShared(),
      fetchPizzintShared(),
      fetchPizzintShared(),
    ]);

    const statusCalls = urls.filter((url) => url.includes('/api/intelligence/v1/get-pizzint-status'));
    assert.equal(statusCalls.length, 1);
    for (const result of results) {
      assert.equal(result.kind, 'empty');
      if (result.kind === 'empty') assert.equal(result.reason, PIZZINT_REQUEST_FAILED);
    }
  });
});

describe('boot fetch dedupe', () => {
  it('does not start a one-shot refresh the boot loader already satisfied', async () => {
    let calls = 0;
    const scheduler = new RefreshScheduler({
      isDestroyed: false,
      inFlight: new Set<string>(),
    } as never);
    markBootRefreshSatisfied('news');
    scheduler.scheduleRefresh('news', async () => {
      calls += 1;
    }, 60_000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(calls, 0);
    scheduler.destroy();
  });

  it('shares one fear-and-greed GET across callers', async () => {
    const { urls } = installFetch(() => jsonResponse({
      compositeScore: 40,
      compositeLabel: 'Fear',
      unavailable: false,
    }));
    await Promise.all([fetchFearGreedIndex(), fetchFearGreedIndex()]);
    const calls = urls.filter((url) => url.includes('/api/market/v1/get-fear-greed-index'));
    assert.equal(calls.length, 1);
  });

  it('shares one earnings calendar GET across date windows', async () => {
    const { urls } = installFetch(() => jsonResponse({ earnings: [], unavailable: false }));
    await Promise.all([
      fetchEarningsCalendar('2026-09-30', '2026-10-21'),
      fetchEarningsCalendar('2026-10-07', '2026-10-21'),
    ]);
    const calls = urls.filter((url) => url.includes('/api/market/v1/list-earnings-calendar'));
    assert.equal(calls.length, 1);
  });

  it('shares one market-implications GET and surfaces HTTP 401', async () => {
    const { urls } = installFetch(() => jsonResponse({ error: 'API key required' }, 401));
    const results = await Promise.allSettled([
      fetchMarketImplications(),
      fetchMarketImplications(),
    ]);
    const calls = urls.filter((url) => url.includes('/api/intelligence/v1/list-market-implications'));
    assert.equal(calls.length, 1);
    assert.equal(results.length, 2);
    for (const result of results) {
      assert.equal(result.status, 'rejected');
      if (result.status === 'rejected') {
        assert.match(String(result.reason?.message ?? result.reason), /HTTP 401/);
      }
    }
  });
});
