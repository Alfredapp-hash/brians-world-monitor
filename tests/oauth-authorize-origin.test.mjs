/**
 * Regression for PR #5009 review P1 — the consent POST origin gate.
 *
 * This fork does not control worldmonitor.app (a separate, unaffiliated live
 * product) and must never trust it — or any of its subdomains — as a
 * first-party origin. The allowlist trusts only this fork's own Vercel
 * deployment(s): the production alias plus preview-deployment aliases
 * (branch/hash variants), mirroring api/_cors.js. Foreign origins (including
 * worldmonitor.app itself) still 403. The CSRF nonce remains the real
 * protection.
 *
 * The origin check is the FIRST statement in the POST branch (before rate-limit
 * and Redis), so an allowed origin with no `_nonce` falls straight through to the
 * "Missing session token" 400 — a clean, Redis-free signal that the gate passed.
 */

import { strict as assert } from 'node:assert';
import { before, describe, it } from 'node:test';

// Force the rate limiter to no-op (getRatelimit returns null without env) so the
// handler never makes a network call — the origin gate runs before it anyway.
before(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

const { default: handler } = await import('../api/oauth/authorize.js');

const postWithOrigin = (origin) => {
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (origin !== undefined) headers.origin = origin;
  return handler(new Request('https://brians-world-monitor.vercel.app/oauth/authorize', {
    method: 'POST',
    headers,
    body: '', // no _nonce → 400 "Missing session token" once the origin gate passes
  }));
};

describe('OAuth authorize — consent POST origin gate (P1)', () => {
  const firstPartyOrigins = [
    'https://brians-world-monitor.vercel.app',           // production alias
    'https://brians-world-monitor-git-main.vercel.app',  // branch preview alias
    'https://brians-world-monitor-abc123.vercel.app',    // deployment-hash preview alias
  ];

  for (const origin of firstPartyOrigins) {
    it(`accepts first-party Origin ${origin} (passes gate → 400, not 403)`, async () => {
      const res = await postWithOrigin(origin);
      assert.notEqual(res.status, 403, `${origin} must not be rejected as cross-origin`);
      assert.equal(res.status, 400, 'should fall through to the missing-nonce 400');
    });
  }

  it('accepts an absent Origin (server/CLI clients)', async () => {
    const res = await postWithOrigin(undefined);
    assert.notEqual(res.status, 403);
    assert.equal(res.status, 400);
  });

  it("accepts the opaque 'null' Origin (sandboxed WebViews)", async () => {
    const res = await postWithOrigin('null');
    assert.notEqual(res.status, 403);
    assert.equal(res.status, 400);
  });

  const foreignOrigins = [
    'https://evil.example',
    'https://worldmonitor.app',                                   // this fork does not control worldmonitor.app — must not be trusted
    'https://www.worldmonitor.app',
    'https://api.worldmonitor.app',
    'https://brians-world-monitor.vercel.app.evil.example',       // suffix attack — must stay anchored
    'https://evilbrians-world-monitor.vercel.app',                // prefix attack — no subdomain dot
    'http://brians-world-monitor.vercel.app',                     // non-https
    'https://brians-world-monitor.vercel.app:8443',                // port smuggling
  ];

  for (const origin of foreignOrigins) {
    it(`rejects foreign/spoofed Origin ${origin} with 403`, async () => {
      const res = await postWithOrigin(origin);
      assert.equal(res.status, 403, `${origin} must be rejected`);
    });
  }
});
