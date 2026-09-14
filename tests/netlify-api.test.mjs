import { strict as assert } from 'node:assert';
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import bootstrap from '../netlify/functions/bootstrap.js';
import health from '../netlify/functions/health.js';
import productCatalog from '../netlify/functions/product-catalog.js';
import versionWrapper from '../netlify/functions/version.js';
import wmSession from '../netlify/functions/wm-session.js';
import versionHandler, { PACKAGE_VERSION } from '../api/version.js';
import { invokeEdgeHandler } from '../netlify/lib/invoke-edge-handler.js';

const toml = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8');
const functionsDir = new URL('../netlify/functions/', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const EXISTING_FUNCTIONS = ['bootstrap', 'health', 'wm-session'];

const BOOT_RPC_WRAPPERS = [
  {
    name: 'news-list-feed-digest',
    path: '/api/news/v1/list-feed-digest',
    edge: '../../api/news/v1/[rpc].ts',
  },
  {
    name: 'conflict-list-acled-events',
    path: '/api/conflict/v1/list-acled-events',
    edge: '../../api/conflict/v1/[rpc].ts',
  },
  {
    name: 'seismology-list-earthquakes',
    path: '/api/seismology/v1/list-earthquakes',
    edge: '../../api/seismology/v1/[rpc].ts',
  },
  {
    name: 'natural-list-natural-events',
    path: '/api/natural/v1/list-natural-events',
    edge: '../../api/natural/v1/[rpc].ts',
  },
  {
    name: 'unrest-list-unrest-events',
    path: '/api/unrest/v1/list-unrest-events',
    edge: '../../api/unrest/v1/[rpc].ts',
  },
  {
    name: 'forecast-get-forecasts',
    path: '/api/forecast/v1/get-forecasts',
    edge: '../../api/forecast/v1/[rpc].ts',
  },
  {
    name: 'displacement-get-displacement-summary',
    path: '/api/displacement/v1/get-displacement-summary',
    edge: '../../api/displacement/v1/[rpc].ts',
  },
  {
    name: 'version',
    path: '/api/version',
    edge: '../../api/version.js',
  },
  {
    name: 'product-catalog',
    path: '/api/product-catalog',
    edge: '../../api/product-catalog.js',
  },
];

const EXPECTED_FUNCTION_NAMES = [
  ...EXISTING_FUNCTIONS,
  ...BOOT_RPC_WRAPPERS.map((entry) => entry.name),
].sort();

const DEFERRED_TICKET_D = ['/mcp', '/a2a', '/ask', '/oauth/*'];

function redirectBlock(from) {
  const needle = `from = "${from}"`;
  const start = toml.indexOf(needle);
  assert.ok(start >= 0, `expected a redirect from ${from}`);
  const afterFrom = toml.slice(start);
  const next = afterFrom.indexOf('[[redirects]]');
  return next === -1 ? afterFrom : afterFrom.slice(0, next);
}

const functionsRoot = fileURLToPath(functionsDir);

function readFunctionSource(name) {
  return readFileSync(new URL(`../netlify/functions/${name}.js`, import.meta.url), 'utf8');
}

describe('Netlify same-origin API wrappers', () => {
  it('functions root contains only valid Netlify function entry names', () => {
    const entries = readdirSync(functionsDir);
    const names = entries.map((name) => name.replace(/\.(js|mjs|cjs|ts|mts)$/, ''));
    assert.deepEqual([...names].sort(), EXPECTED_FUNCTION_NAMES);
    for (const name of names) {
      assert.match(name, /^[A-Za-z0-9_-]+$/);
    }
    assert.ok(!entries.includes('_shared'), 'helpers must live in netlify/lib/, not netlify/functions/_shared');
    assert.ok(entries.every((name) => !name.includes('.test.')), 'tests must not live under netlify/functions/');
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

  it('boot RPC wrappers mount existing Edge/gateway handlers at their public paths', () => {
    for (const { name, path, edge } of BOOT_RPC_WRAPPERS) {
      const src = readFunctionSource(name);
      assert.ok(src.includes(`from '${edge}'`), `${name} should import ${edge}`);
      assert.ok(src.includes('invokeEdgeHandler'), `${name} should wrap via invokeEdgeHandler`);
      assert.match(src, new RegExp(`path:\\s*'${path.replace(/\//g, '\\/')}'`));
    }
  });

  it('boot RPC wrappers esbuild-bundle (Netlify node_bundler)', async () => {
    for (const { name } of BOOT_RPC_WRAPPERS) {
      const result = await build({
        entryPoints: [join(functionsRoot, `${name}.js`)],
        bundle: true,
        format: 'esm',
        platform: 'node',
        write: false,
        logLevel: 'silent',
      });
      assert.equal(result.errors.length, 0, `${name} should bundle without errors`);
      assert.ok(result.outputFiles[0].text.length > 0, `${name} should emit a bundle`);
    }
  });

  it('does not force-proxy /api/* to Vercel (functions would be shadowed)', () => {
    const apiBlock = toml.match(/\[\[redirects\]\][\s\S]*?from = "\/api\/\*"/);
    assert.ok(apiBlock, 'expected an /api/* redirect block');
    const thisRedirect = redirectBlock('/api/*');
    assert.match(thisRedirect, /brians-world-monitor\.vercel\.app\/api\/:splat/);
    assert.doesNotMatch(thisRedirect, /force\s*=\s*true/);
  });

  it('defers Ticket D agent surfaces to the forced Vercel rewrite', () => {
    for (const from of DEFERRED_TICKET_D) {
      const block = redirectBlock(from);
      assert.match(block, /brians-world-monitor\.vercel\.app/);
      assert.match(block, /force\s*=\s*true/);
    }
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

  it('product-catalog wrapper delegates GET to the existing Edge handler', async () => {
    for (const k of [
      'UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL', 'REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN', 'REDIS_REST_TOKEN',
      'DODO_API_KEY',
    ]) delete process.env[k];

    const resp = await productCatalog(new Request('https://thepublicdispatch.com/api/product-catalog', {
      method: 'GET',
      headers: { origin: 'https://thepublicdispatch.com' },
    }));
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.priceSource, 'fallback');
    assert.ok(Array.isArray(body.tiers));
    assert.equal(resp.headers.get('x-product-catalog-source'), 'fallback');
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

describe('GET /api/version fallback (no GitHub releases)', () => {
  it('PACKAGE_VERSION matches package.json', () => {
    assert.equal(PACKAGE_VERSION, pkg.version);
  });

  it('uses a GitHub release when one exists', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('/releases/latest')) {
        return new Response(JSON.stringify({
          tag_name: 'v2.3.4',
          html_url: 'https://github.com/Alfredapp-hash/brians-world-monitor/releases/tag/v2.3.4',
          prerelease: false,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    try {
      const resp = await versionHandler();
      assert.equal(resp.status, 200);
      assert.deepEqual(await resp.json(), {
        version: '2.3.4',
        tag: 'v2.3.4',
        url: 'https://github.com/Alfredapp-hash/brians-world-monitor/releases/tag/v2.3.4',
        prerelease: false,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('falls back to the newest git tag when releases/latest is empty', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('/releases/latest')) return new Response('Not Found', { status: 404 });
      if (url.includes('/tags')) {
        return new Response(JSON.stringify([{ name: 'v1.4.0' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    try {
      const resp = await versionWrapper(new Request('https://thepublicdispatch.com/api/version'));
      assert.equal(resp.status, 200);
      assert.deepEqual(await resp.json(), {
        version: '1.4.0',
        tag: 'v1.4.0',
        url: 'https://github.com/Alfredapp-hash/brians-world-monitor/tree/v1.4.0',
        prerelease: false,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('falls back to package.json instead of 502 when GitHub has no releases or tags', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('/releases/latest')) return new Response('Not Found', { status: 404 });
      if (url.includes('/tags')) {
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    try {
      const resp = await versionWrapper(new Request('https://thepublicdispatch.com/api/version'));
      assert.equal(resp.status, 200);
      assert.deepEqual(await resp.json(), {
        version: PACKAGE_VERSION,
        tag: `v${PACKAGE_VERSION}`,
        url: 'https://github.com/Alfredapp-hash/brians-world-monitor',
        prerelease: false,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
