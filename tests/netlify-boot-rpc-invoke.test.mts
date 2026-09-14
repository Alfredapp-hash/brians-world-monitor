import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import conflict from '../netlify/functions/conflict-list-acled-events.js';
import displacement from '../netlify/functions/displacement-get-displacement-summary.js';
import forecast from '../netlify/functions/forecast-get-forecasts.js';
import seismology from '../netlify/functions/seismology-list-earthquakes.js';

function stripRedis() {
  for (const key of [
    'UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL', 'REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN', 'REDIS_REST_TOKEN',
  ]) delete process.env[key];
}

function get(url: string) {
  return new Request(url, {
    method: 'GET',
    headers: { origin: 'https://thepublicdispatch.com' },
  });
}

describe('Netlify boot RPC wrappers invoke existing domain gateways', () => {
  it('list-earthquakes is public and returns the seeded/empty envelope', async () => {
    stripRedis();
    const resp = await seismology(get('https://thepublicdispatch.com/api/seismology/v1/list-earthquakes'));
    assert.equal(resp.status, 200);
    const body = await resp.json() as { earthquakes: unknown[] };
    assert.ok(Array.isArray(body.earthquakes));
  });

  it('list-acled-events is public and returns the seeded/empty envelope', async () => {
    stripRedis();
    const resp = await conflict(get('https://thepublicdispatch.com/api/conflict/v1/list-acled-events'));
    assert.equal(resp.status, 200);
    const body = await resp.json() as { events: unknown[] };
    assert.ok(Array.isArray(body.events));
  });

  it('get-forecasts public=1 is served without an API key', async () => {
    stripRedis();
    const resp = await forecast(get('https://thepublicdispatch.com/api/forecast/v1/get-forecasts?public=1'));
    assert.equal(resp.status, 200);
    const body = await resp.json() as { forecasts: unknown[] };
    assert.ok(Array.isArray(body.forecasts));
  });

  it('get-displacement-summary?public=1 without flow_limit stays 401 (existing public shape)', async () => {
    stripRedis();
    const resp = await displacement(get(
      'https://thepublicdispatch.com/api/displacement/v1/get-displacement-summary?public=1',
    ));
    assert.equal(resp.status, 401);
    const body = await resp.json() as { error: string };
    assert.equal(body.error, 'API key required');
  });
});
