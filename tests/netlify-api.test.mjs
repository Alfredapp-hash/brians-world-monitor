import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import bootstrap from '../netlify/functions/bootstrap.js';
import health from '../netlify/functions/health.js';
import wmSession from '../netlify/functions/wm-session.js';
import { invokeEdgeHandler } from '../netlify/lib/invoke-edge-handler.js';

const toml = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8');
const functionsDir = new URL('../netlify/functions/', import.meta.url);

describe('Netlify same-origin API wrappers', () => {
  it('functions root contains only valid Netlify function entry names', () => {
    const entries = readdirSync(functionsDir);
    const names = entries.map((name) => name.replace(/\.(js|mjs|cjs|ts|mts)$/, ''));
    assert.deepEqual([...names].sort(), ['bootstrap', 'health', 'wm-session']);
    for (const name of names) {
      assert.match(name, /^[A-Za-z0-9_-]+$/);
    }
  });

  it('health wrapper is mounted at /api/health', async () => {
    const { config } = await import('../netlify/functions/health.js');
    assert.equal(config.path, '/api/health');
  });

  it('wm-session wrapper is mounted at /api/wm-session', async () => {
    const { config } = await import('../netlify/functions/wm-session.js');
    assert.equal(config.path, '/api/wm-session');
  });

  it('bootstrap wrapper is mounted at /api/bootstrap', async () => {
    const { config } = await import('../netlify/functions/bootstrap.js');
    assert.equal(config.path, '/api/bootstrap');
  });

  it('does not force-proxy /api/* to Vercel (functions would be shadowed)', () => {
    const apiBlock = toml.match(/\[\[redirects\]\][\s\S]*?from = "\/api\/\*"/);
    assert.ok(apiBlock, 'expected an /api/* redirect block');
    const afterFrom = toml.slice(toml.indexOf('from = "/api/*"'));
    const thisRedirect = afterFrom.slice(0, afterFrom.indexOf('[[redirects]]'));
    assert.match(thisRedirect, /brians-world-monitor\.vercel\.app\/api\/:splat/);
    assert.doesNotMatch(thisRedirect, /force\s*=\s*true/);
  });

  it('health wrapper delegates compact GET to the existing Edge handler', async () => {
    for (const k of [
      'UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL', 'REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN', 'REDIS_REST_TOKEN',
    ]) delete process.env[k];

    const resp = await health(new Request('https://thepublicdispatch.com/api/health?compact=1', {
      method: 'GET',
      headers: { origin: 'https://thepublicdispatch.com' },
    }));
    assert.equal(resp.status, 503);
    const body = await resp.json();
    assert.equal(body.status, 'REDIS_DOWN');
    assert.equal(resp.headers.get('access-control-allow-origin'), 'https://thepublicdispatch.com');
  });

  it('bootstrap wrapper delegates public fast GET to the existing Edge handler', async () => {
    for (const k of [
      'UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL', 'REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN', 'REDIS_REST_TOKEN',
    ]) delete process.env[k];

    const resp = await bootstrap(new Request('https://thepublicdispatch.com/api/bootstrap?tier=fast&public=1', {
      method: 'GET',
      headers: { origin: 'https://thepublicdispatch.com' },
    }));
    assert.equal(resp.status, 503);
    const body = await resp.json();
    assert.equal(body.error, 'Bootstrap service temporarily unavailable');
    assert.equal(resp.headers.get('retry-after'), '5');
    assert.equal(resp.headers.get('cache-control'), 'no-store');
  });

  it('bootstrap wrapper rejects the separately-owned worldmonitor.app origin', async () => {
    const resp = await bootstrap(new Request('https://thepublicdispatch.com/api/bootstrap?tier=fast&public=1', {
      method: 'GET',
      headers: { origin: 'https://worldmonitor.app' },
    }));
    assert.equal(resp.status, 403);
  });

  it('wm-session wrapper rejects disallowed origins without minting', async () => {
    const resp = await wmSession(new Request('https://thepublicdispatch.com/api/wm-session', {
      method: 'POST',
      headers: { origin: 'https://evil.example.com' },
    }));
    assert.equal(resp.status, 403);
  });

  it('invokeEdgeHandler forwards waitUntil onto the Netlify context', async () => {
    const pending = [];
    const context = { waitUntil: (promise) => pending.push(promise) };
    const done = Promise.resolve('ok');
    const resp = await invokeEdgeHandler(async (_req, ctx) => {
      ctx.waitUntil(done);
      return new Response('ok');
    }, new Request('https://thepublicdispatch.com/api/health'), context);
    assert.equal(resp.status, 200);
    assert.equal(pending[0], done);
  });
});
