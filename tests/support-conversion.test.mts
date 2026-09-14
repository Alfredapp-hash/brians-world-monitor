// Product-invariant tests for the conversion surface (src/config/support.ts).
//
// This file is the "we did not build a paywall" guard. The fork self-hosts its
// own backend, so the map, layers, globe, God's Eye, public cameras and reader
// mode are free and must stay free. The only metered resource is OUR hosted
// LLM spend on on-demand brief regeneration.
//
// Several assertions read source files directly (the established pattern in
// tests/cii-scoring.test.mts) because the invariant is structural: a core
// rendering module must not even be able to ask "is this person paying?".

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync as nodeReadFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FREE_BRIEFING_RUNS_PER_DAY,
  FREE_INCLUDES,
  PRO_ADDS,
  PRO_BRIEFING_RUNS_PER_DAY,
  getDonateUrl,
} from '../src/config/support.ts';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

function readRepoFile(relPath: string): string {
  return nodeReadFileSync(resolve(REPO_ROOT, relPath), 'utf8').replace(/\r\n/g, '\n');
}

// The copy uses a typographic apostrophe (God\u2019s Eye), so both forms match.
const GODS_EYE = /god['\u2019]?s\s+eye/i;
/** Anything here appearing in PRO_ADDS would mean a core surface was withheld. */
const CORE_SURFACE = /god['\u2019]?s\s+eye|camera|reader mode|globe|watermark/i;

describe('donate link', () => {
  it('is a parseable https URL', () => {
    const href = getDonateUrl();
    assert.equal(typeof href, 'string');
    const url = new URL(href); // throws if unparseable
    assert.equal(url.protocol, 'https:', 'a donate link must never be plain http');
    assert.ok(url.hostname.length > 0);
  });

  it('falls back to the default when import.meta.env is absent (node)', () => {
    // Under node:test there is no Vite env at all; the module must degrade to
    // its default rather than rendering a broken/empty href.
    assert.match(getDonateUrl(), /^https:\/\/\S+$/);
    assert.ok(!getDonateUrl().includes('undefined'));
  });
});

describe('feature accounting', () => {
  it('FREE_INCLUDES is a non-empty list of non-empty strings', () => {
    assert.ok(Array.isArray(FREE_INCLUDES));
    assert.ok(FREE_INCLUDES.length > 0);
    for (const entry of FREE_INCLUDES) {
      assert.equal(typeof entry, 'string');
      assert.ok(entry.trim().length > 0);
    }
  });

  it('PRO_ADDS is a non-empty list of non-empty strings', () => {
    assert.ok(Array.isArray(PRO_ADDS));
    assert.ok(PRO_ADDS.length > 0);
    for (const entry of PRO_ADDS) {
      assert.equal(typeof entry, 'string');
      assert.ok(entry.trim().length > 0);
    }
  });

  it('PRO_ADDS never implies a core dashboard surface is withheld', () => {
    const offenders = PRO_ADDS.filter((entry) => CORE_SURFACE.test(entry));
    assert.deepEqual(
      offenders,
      [],
      'Pro may only add things that genuinely exist on top of a complete free product — ' +
        'the map, globe, God\u2019s Eye, cameras, reader mode and unwatermarked overlays are free.',
    );
  });

  it('FREE_INCLUDES describes the free tier as a complete product', () => {
    const mentions = (pattern: RegExp): boolean => FREE_INCLUDES.some((e) => pattern.test(e));
    assert.ok(mentions(GODS_EYE), 'free tier must advertise the God\u2019s Eye');
    assert.ok(mentions(/camera/i), 'free tier must advertise the camera layer');
    assert.ok(mentions(/map/i), 'free tier must advertise the map');
  });

  it('FREE_INCLUDES advertises the bring-your-own-key escape hatch', () => {
    assert.ok(
      FREE_INCLUDES.some((e) => /own .*key/i.test(e)),
      'the unmetered BYOK path is the reason the allowance is defensible; say so',
    );
  });
});

describe('briefing allowance constants', () => {
  it('both caps are positive integers', () => {
    for (const [label, value] of [
      ['FREE_BRIEFING_RUNS_PER_DAY', FREE_BRIEFING_RUNS_PER_DAY],
      ['PRO_BRIEFING_RUNS_PER_DAY', PRO_BRIEFING_RUNS_PER_DAY],
    ] as const) {
      assert.equal(Number.isInteger(value), true, `${label} must be an integer`);
      assert.ok(value > 0, `${label} must be positive — a zero allowance is a paywall`);
    }
  });

  it('Pro lifts the allowance rather than matching it', () => {
    assert.ok(
      PRO_BRIEFING_RUNS_PER_DAY > FREE_BRIEFING_RUNS_PER_DAY,
      'if Pro does not raise the cap there is nothing to sell',
    );
  });

  it('the copy quotes the real numbers', () => {
    assert.ok(FREE_INCLUDES.some((e) => e.includes(String(FREE_BRIEFING_RUNS_PER_DAY))));
    assert.ok(PRO_ADDS.some((e) => e.includes(String(PRO_BRIEFING_RUNS_PER_DAY))));
  });
});

describe('source-level guards', () => {
  it('panel-gating.hasPremiumAccess still returns true (core stays ungated)', () => {
    const source = readRepoFile('src/services/panel-gating.ts');
    const body = /export function hasPremiumAccess\([\s\S]*?\n\}/.exec(source)?.[0];
    assert.ok(body, 'hasPremiumAccess must exist in src/services/panel-gating.ts');
    assert.match(
      body,
      /\breturn true;/,
      'hasPremiumAccess must keep returning true — this fork unlocks every panel.',
    );
    assert.doesNotMatch(
      body,
      /isSupporter|getSubscription/,
      'panel rendering must never consult the billing signal',
    );
  });

  it('core map/layer/camera/reader modules do not import supporter-status', () => {
    const coreModules = [
      'src/components/GlobeMap.ts',
      'src/components/Map.ts',
      'src/services/webcams/index.ts',
      'src/services/reader-mode.ts',
    ];

    const checked: string[] = [];
    const offenders: string[] = [];
    for (const relPath of coreModules) {
      if (!existsSync(resolve(REPO_ROOT, relPath))) continue;
      checked.push(relPath);
      if (readRepoFile(relPath).includes('supporter-status')) offenders.push(relPath);
    }

    assert.ok(
      checked.length >= 2,
      `expected to check at least two core modules, only found: ${checked.join(', ')}`,
    );
    assert.deepEqual(
      offenders,
      [],
      'a rendering module that knows whether you pay is one refactor away from a paywall',
    );
  });

  it('byok-keys.ts never logs (a key must not reach the console or Sentry)', () => {
    const source = readRepoFile('src/services/byok-keys.ts');
    assert.doesNotMatch(source, /console\./, 'no console call may exist in the key module');
  });

  it('byok-keys.ts sends keys only to provider URLs from config', () => {
    const source = readRepoFile('src/services/byok-keys.ts');
    assert.doesNotMatch(
      source,
      /worldmonitor\.app|vercel\.app|\/api\//,
      'a user-supplied key must never traverse our own infrastructure',
    );
  });
});

// The allowance is only defensible if a spent run means tokens were actually
// burned on our account. `generateSummary` wraps the whole provider chain in
// `summaryResultBreaker`, a 2h *persisted* result memo — and a memo hit still
// reports `cached: false`. Without the forceFresh eviction below, clicking
// "Regenerate brief" would decrement the user's allowance while handing back
// byte-identical text that cost nothing. These are source-level assertions
// because the behaviour spans a component and a service that cannot be
// imported under node:test (Vite aliases, workers, DOM).
describe('honest metering', () => {
  it('SummarizeOptions exposes forceFresh', () => {
    const source = readRepoFile('src/services/summarization.ts');
    assert.match(
      source,
      /interface SummarizeOptions\s*\{[\s\S]*?forceFresh\?: boolean;[\s\S]*?\n\}/,
      'forceFresh must be part of the options contract',
    );
  });

  it('generateSummary evicts the memo when forceFresh is set', () => {
    const source = readRepoFile('src/services/summarization.ts');
    assert.match(
      source,
      /if \(options\?\.forceFresh\) \{\s*\n\s*summaryResultBreaker\.clearCache\(cacheKey\);/,
      'a forced regeneration must clear the cache entry for THIS cacheKey before executing',
    );
    // Guard the blast radius: a bare clearCache() would wipe every cached
    // brief for every user of the breaker.
    assert.doesNotMatch(
      source,
      /summaryResultBreaker\.clearCache\(\s*\)/,
      'never clear the entire summary cache — evict only the key being regenerated',
    );
  });

  it('regenerateBrief asks for a forced-fresh synthesis', () => {
    const source = readRepoFile('src/components/InsightsPanel.ts');
    const body = /public async regenerateBrief\(\)[\s\S]*?\n  \}/.exec(source)?.[0];
    assert.ok(body, 'regenerateBrief must exist in InsightsPanel');
    assert.match(
      body,
      /this\.updateFromClient\(this\.lastClusters, this\.updateGeneration, true\)/,
      'the regenerate path must pass forceFresh=true or it can charge for a memoized brief',
    );
  });

  it('the forceFresh flag reaches the summarize options', () => {
    const source = readRepoFile('src/components/InsightsPanel.ts');
    assert.match(
      source,
      /const summarizeOpts: SummarizeOptions = \{[\s\S]*?forceFresh,[\s\S]*?\};/,
      'updateFromClient must forward forceFresh into SummarizeOptions',
    );
  });

  it('only runs that spent OUR tokens are counted', () => {
    const source = readRepoFile('src/components/InsightsPanel.ts');
    const predicate = /const spentOurTokens = [\s\S]*?;/.exec(source)?.[0];
    assert.ok(predicate, 'InsightsPanel must compute a spentOurTokens predicate');

    for (const [label, pattern] of [
      ['a server cache hit', /!result\.cached/],
      ["the user's own key", /!result\.byok/],
      ['the cache provider', /result\.provider !== 'cache'/],
      ['the on-device model', /result\.provider !== 'browser'/],
    ] as const) {
      assert.match(predicate, pattern, `${label} must not consume the allowance`);
    }
  });

  it('an exhausted allowance never blanks the brief', () => {
    const source = readRepoFile('src/components/InsightsPanel.ts');
    assert.match(
      source,
      /const allowanceBlocksRefresh = hasBrief && allowanceSpent;/,
      'the cap may only pause a refresh of a brief the user can already read',
    );
  });
});
