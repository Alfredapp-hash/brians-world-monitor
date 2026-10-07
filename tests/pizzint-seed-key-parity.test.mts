/**
 * PizzINT writer/reader key parity.
 *
 * seed-conflict-intel used to publish `intel:pizzint:v1:base` and
 * `intel:pizzint:v1:gdelt`. The status handler, bootstrap hydration, health,
 * and the AIS relay all read `intelligence:pizzint:seed:v1` /
 * `seed-meta:intelligence:pizzint`. The panel never saw the conflict seeder's
 * payload. This locks every side to shared/pizzint-seed-keys.js.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PIZZINT_SEED_KEY,
  PIZZINT_SEED_META_KEY,
  PIZZINT_LEGACY_BASE_KEY,
  PIZZINT_LEGACY_GDELT_KEY,
  pizzintReadKeys,
} from '../shared/pizzint-seed-keys.js';
import { BOOTSTRAP_CACHE_KEYS } from '../shared/bootstrap-tier-keys.js';
import { BOOTSTRAP_CACHE_KEYS as API_BOOTSTRAP_CACHE_KEYS } from '../api/_bootstrap-tier-keys.js';
import {
  PIZZINT_SEED_KEY as SEEDER_KEY,
  PIZZINT_SEED_META_KEY as SEEDER_META_KEY,
  PIZZINT_TTL,
  publishPizzintSeed,
} from '../scripts/seed-conflict-intel.mjs';
import { PIZZINT_SEED_KEY as HANDLER_KEY, getPizzintStatus } from '../server/worldmonitor/intelligence/v1/get-pizzint-status.ts';
import { __testing__ } from '../api/health.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEED_INTERVAL_SECONDS = 12 * 60 * 60;

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENV = {
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  VERCEL_ENV: process.env.VERCEL_ENV,
};

describe('PizzINT seed key parity', () => {
  it('writer, reader, bootstrap, and the shared constant are one key', () => {
    assert.equal(SEEDER_KEY, PIZZINT_SEED_KEY);
    assert.equal(SEEDER_META_KEY, PIZZINT_SEED_META_KEY);
    assert.equal(HANDLER_KEY, PIZZINT_SEED_KEY);
    assert.equal(BOOTSTRAP_CACHE_KEYS.pizzint, PIZZINT_SEED_KEY);
    assert.equal(API_BOOTSTRAP_CACHE_KEYS.pizzint, PIZZINT_SEED_KEY);
    assert.equal(PIZZINT_SEED_KEY, 'intelligence:pizzint:seed:v1');
    assert.equal(PIZZINT_SEED_META_KEY, 'seed-meta:intelligence:pizzint');
  });

  it('health probes the canonical data key and seed-meta key', () => {
    const health = readFileSync(resolve(root, 'api/health.js'), 'utf8');
    assert.match(health, new RegExp(`pizzint:\\s+'${PIZZINT_SEED_KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
    assert.match(health, new RegExp(`key:\\s+'${PIZZINT_SEED_META_KEY}'`));
    assert.equal(__testing__.SEED_META.pizzint.key, PIZZINT_SEED_META_KEY);
    assert.equal(__testing__.STANDALONE_KEYS.pizzint, PIZZINT_SEED_KEY);
  });

  it('the AIS relay writes the same data key and seed-meta key', () => {
    const relay = readFileSync(resolve(root, 'scripts/ais-relay.cjs'), 'utf8');
    assert.match(relay, new RegExp(`const PIZZINT_REDIS_KEY = '${PIZZINT_SEED_KEY}'`));
    assert.match(relay, new RegExp(`upstashSet\\('${PIZZINT_SEED_META_KEY}'`));
  });

  it('the conflict seeder no longer publishes the legacy intel:pizzint keys', () => {
    const src = readFileSync(resolve(root, 'scripts/seed-conflict-intel.mjs'), 'utf8');
    assert.doesNotMatch(src, /intel:pizzint:v1:(?:base|gdelt)/);
    assert.match(src, /publishPizzintSeed\(\s*pi\s*,\s*gd\s*\)/);
  });

  it('read order is canonical, then the legacy key that matches includeGdelt', () => {
    assert.deepEqual(pizzintReadKeys(false), [
      PIZZINT_SEED_KEY,
      PIZZINT_LEGACY_BASE_KEY,
      PIZZINT_LEGACY_GDELT_KEY,
    ]);
    assert.deepEqual(pizzintReadKeys(true), [
      PIZZINT_SEED_KEY,
      PIZZINT_LEGACY_GDELT_KEY,
      PIZZINT_LEGACY_BASE_KEY,
    ]);
  });

  it('PizzINT TTL outlives the health gate and one missed twice-daily seed', () => {
    const maxStaleSeconds = __testing__.SEED_META.pizzint.maxStaleMin * 60;
    assert.ok(
      PIZZINT_TTL > maxStaleSeconds,
      `PIZZINT_TTL (${PIZZINT_TTL}s) must exceed health maxStaleMin (${maxStaleSeconds}s)`,
    );
    assert.equal(PIZZINT_TTL, SEED_INTERVAL_SECONDS * 3);
  });
});

describe('publishPizzintSeed', () => {
  let recorded: Array<{ body: unknown }>;

  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.example.com';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';
    process.env.VERCEL_ENV = 'production';
    recorded = [];
    globalThis.fetch = async (_url, opts: RequestInit = {}) => {
      const body = opts.body ? JSON.parse(String(opts.body)) : null;
      recorded.push({ body });
      return new Response(JSON.stringify({ result: 'OK' }), { status: 200 });
    };
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('writes the canonical data key and the health seed-meta key, with tension pairs', async () => {
    const pizzint = { defconLevel: 3, locationsMonitored: 4 };
    const pairs = [{ id: 'usa_russia', score: 1 }];
    assert.equal(await publishPizzintSeed(pizzint, pairs), true);

    const sets = recorded
      .map((call) => call.body)
      .filter((body): body is unknown[] => Array.isArray(body) && body[0] === 'SET');
    assert.deepEqual(sets.map((body) => body[1]), [PIZZINT_SEED_KEY, PIZZINT_SEED_META_KEY]);

    const payload = JSON.parse(String(sets[0]?.[2]));
    assert.equal(payload.pizzint.defconLevel, 3);
    assert.deepEqual(payload.tensionPairs, pairs);
    assert.equal(sets[0]?.[4], PIZZINT_TTL);

    const meta = JSON.parse(String(sets[1]?.[2]));
    assert.equal(meta.recordCount, 4);
    assert.equal(typeof meta.fetchedAt, 'number');
    assert.ok(!sets.some((body) => String(body[1]).startsWith('intel:pizzint')));
  });

  it('stores an empty tension-pair list when GDELT did not return pairs', async () => {
    await publishPizzintSeed({ defconLevel: 5, locationsMonitored: 1 }, null);
    const dataSet = recorded
      .map((call) => call.body)
      .find((body): body is unknown[] => Array.isArray(body) && body[1] === PIZZINT_SEED_KEY);
    assert.ok(dataSet);
    assert.deepEqual(JSON.parse(String(dataSet[2])).tensionPairs, []);
  });

  it('does not write when there is no pizzint payload', async () => {
    assert.equal(await publishPizzintSeed(null, []), false);
    assert.equal(recorded.length, 0);
  });
});

describe('getPizzintStatus seed read', () => {
  const cache = new Map<string, unknown>();

  beforeEach(() => {
    cache.clear();
    process.env.UPSTASH_REDIS_REST_URL = 'https://stub-upstash.test';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'stub-token';
    process.env.VERCEL_ENV = 'production';
    globalThis.fetch = async (url) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : String(url);
      const match = urlStr.match(/\/get\/([^/?#]+)$/);
      if (!match?.[1]) {
        return new Response(JSON.stringify({ result: null }), { status: 200 });
      }
      const key = decodeURIComponent(match[1]);
      const value = cache.get(key);
      return new Response(JSON.stringify({
        result: value == null ? null : JSON.stringify(value),
      }), { status: 200 });
    };
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const ctx = {} as never;

  it('serves the canonical key and keeps tension pairs only when requested', async () => {
    cache.set(PIZZINT_SEED_KEY, {
      pizzint: { defconLevel: 2, locationsMonitored: 8 },
      tensionPairs: [{ id: 'usa_china' }],
    });
    cache.set(PIZZINT_LEGACY_GDELT_KEY, {
      pizzint: { defconLevel: 1, locationsMonitored: 1 },
      tensionPairs: [{ id: 'legacy' }],
    });

    const withGdelt = await getPizzintStatus(ctx, { includeGdelt: true });
    assert.equal(withGdelt.pizzint?.defconLevel, 2);
    assert.equal(withGdelt.tensionPairs[0]?.id, 'usa_china');

    const statusOnly = await getPizzintStatus(ctx, { includeGdelt: false });
    assert.equal(statusOnly.pizzint?.defconLevel, 2);
    assert.deepEqual(statusOnly.tensionPairs, []);
  });

  it('unwraps a relay envelope on the canonical key', async () => {
    cache.set(PIZZINT_SEED_KEY, {
      _seed: { fetchedAt: 1, recordCount: 2, sourceVersion: 'pizzint', schemaVersion: 1, state: 'OK' },
      data: {
        pizzint: { defconLevel: 4, locationsMonitored: 2 },
        tensionPairs: [{ id: 'usa_iran' }],
      },
    });
    const resp = await getPizzintStatus(ctx, { includeGdelt: true });
    assert.equal(resp.pizzint?.defconLevel, 4);
    assert.equal(resp.tensionPairs[0]?.id, 'usa_iran');
  });

  it('falls back to the legacy GDELT key when the canonical key is empty', async () => {
    cache.set(PIZZINT_LEGACY_BASE_KEY, {
      pizzint: { defconLevel: 5, locationsMonitored: 3 },
      tensionPairs: [],
    });
    cache.set(PIZZINT_LEGACY_GDELT_KEY, {
      pizzint: { defconLevel: 5, locationsMonitored: 3 },
      tensionPairs: [{ id: 'russia_ukraine' }],
    });

    const withGdelt = await getPizzintStatus(ctx, { includeGdelt: true });
    assert.equal(withGdelt.tensionPairs[0]?.id, 'russia_ukraine');

    cache.delete(PIZZINT_LEGACY_GDELT_KEY);
    const statusOnly = await getPizzintStatus(ctx, { includeGdelt: false });
    assert.equal(statusOnly.pizzint?.locationsMonitored, 3);
    assert.deepEqual(statusOnly.tensionPairs, []);
  });

  it('returns an empty status when neither generation has a payload', async () => {
    const resp = await getPizzintStatus(ctx, { includeGdelt: true });
    assert.equal(resp.pizzint, undefined);
    assert.deepEqual(resp.tensionPairs, []);
  });
});
