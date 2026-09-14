import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import {
  isSebufApiPath,
  resolveDispatchPath,
  NETLIFY_FLAT_API_PATHS,
  dispatchNetlifyApi,
} from '../server/netlify-dispatch.ts';

describe('Netlify independence — API stays on this site', () => {
  it('does not proxy /api to Vercel worldapp', async () => {
    const toml = await readFile(new URL('../netlify.toml', import.meta.url), 'utf8');
    assert.equal(
      /brians-world-monitor\.vercel\.app/.test(toml),
      false,
      'netlify.toml must not proxy to brians-world-monitor.vercel.app',
    );
    assert.equal(
      /worldmonitor\.app/.test(toml),
      false,
      'netlify.toml must not proxy to worldmonitor.app',
    );
    assert.match(toml, /netlify\/functions/);
  });

  it('routes sebuf domain paths through the gateway, not a missing-file 404', () => {
    assert.equal(isSebufApiPath('/api/news/v1/list-feed-digest'), true);
    assert.equal(isSebufApiPath('/api/webcam/v1/list-webcams'), true);
    assert.equal(isSebufApiPath('/api/v2/shipping/list-something'), true);
    assert.equal(isSebufApiPath('/api/bootstrap'), false);
    assert.equal(isSebufApiPath('/api/health'), false);
  });

  it('rewrites documented v1 aliases before dispatch', () => {
    assert.equal(
      resolveDispatchPath('/api/scenario/v1/run'),
      '/api/scenario/v1/run-scenario',
    );
    assert.equal(
      resolveDispatchPath('/api/supply-chain/v1/country-products/'),
      '/api/supply-chain/v1/get-country-products',
    );
  });

  it('keeps bootstrap and session on this host', () => {
    assert.ok(NETLIFY_FLAT_API_PATHS.includes('/api/bootstrap'));
    assert.ok(NETLIFY_FLAT_API_PATHS.includes('/api/wm-session'));
    assert.ok(NETLIFY_FLAT_API_PATHS.includes('/api/health'));
  });

  it('aliases apex oauth and discovery paths onto this host', () => {
    assert.ok(NETLIFY_FLAT_API_PATHS.includes('/oauth/authorize'));
    assert.ok(NETLIFY_FLAT_API_PATHS.includes('/oauth/token'));
    assert.ok(NETLIFY_FLAT_API_PATHS.includes('/.well-known/oauth-protected-resource'));
    assert.ok(NETLIFY_FLAT_API_PATHS.includes('/agent/auth'));
  });

  it('returns JSON 404 for unknown flat paths without throwing', async () => {
    const res = await dispatchNetlifyApi(
      new Request('https://thepublicdispatch.com/api/definitely-not-a-route'),
    );
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'Not found');
  });
});
