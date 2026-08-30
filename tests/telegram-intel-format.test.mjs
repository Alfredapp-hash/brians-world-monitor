import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';

const source = fs.readFileSync(new URL('../src/services/telegram-intel.ts', import.meta.url), 'utf8');
const relay = fs.readFileSync(new URL('../scripts/ais-relay.cjs', import.meta.url), 'utf8');
const channels = JSON.parse(fs.readFileSync(new URL('../data/telegram-channels.json', import.meta.url), 'utf8'));

describe('formatTelegramTime', () => {
  it('treats relay timestamp fallback as unknown instead of decades-old', () => {
    assert.match(source, /MISSING_TIMESTAMP_ISO\s*=\s*new Date\(0\)\.toISOString\(\)/);
    assert.match(source, /ts\s*===\s*MISSING_TIMESTAMP_ISO\)\s*return 'unknown'/);
  });

  it('treats malformed timestamps as unknown', () => {
    assert.match(source, /!Number\.isFinite\(time\)[\s\S]{0,80}return 'unknown'/);
  });
});

describe('telegram intel grab', () => {
  it('pulls the full 200-item Railway buffer, not the old 50-item slice', () => {
    assert.match(source, /fetchTelegramFeed\(limit = 200\)/);
  });

  it('folds every tech/cyber channel into the default full poll set', () => {
    const fullHandles = new Set(
      (channels.channels.full || []).filter((c) => c.enabled !== false).map((c) => c.handle),
    );
    const techHandles = (channels.channels.tech || []).filter((c) => c.enabled !== false).map((c) => c.handle);
    assert.ok(techHandles.length >= 8, `expected tech/cyber channels, got ${techHandles.length}`);
    for (const handle of techHandles) {
      assert.ok(fullHandles.has(handle), `full set missing tech channel ${handle}`);
    }
  });

  it('keeps media-only OSINT posts instead of dropping them', () => {
    assert.match(relay, /function telegramMediaCaption\(/);
    assert.match(relay, /if \(!msg\.message && !telegramMediaCaption\(msg\)\)/);
    assert.doesNotMatch(relay, /if \(!msg\.message\) \{ mediaSkipped\+\+; continue; \}/);
  });

  it('unions the tech set when TELEGRAM_CHANNEL_SET is full', () => {
    assert.match(relay, /set === 'full' && Array\.isArray\(buckets\.tech\)/);
  });
});
