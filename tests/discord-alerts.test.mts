import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectAlertable, buildAlertPayload, isValidWebhookUrl, type AlertStory } from '../src/services/discord-alerts';

const story = (over: Partial<AlertStory> = {}): AlertStory => ({
  key: 'k1', title: 'Test story', nci: 30, tierLabel: 'Some techniques', tierLevel: 1,
  talkingPoint: false, recurring: false, sourceCount: 4, flags: [], phrases: [], ...over,
});

const HOUR = 3600_000;

describe('discord-alerts', () => {
  it('validates webhook URLs strictly', () => {
    assert.ok(isValidWebhookUrl('https://discord.com/api/webhooks/123/abc'));
    assert.ok(isValidWebhookUrl('https://discordapp.com/api/webhooks/123/abc'));
    assert.ok(!isValidWebhookUrl('https://evil.com/api/webhooks/123/abc'));
    assert.ok(!isValidWebhookUrl('http://discord.com/api/webhooks/123/abc'));
    assert.ok(!isValidWebhookUrl('https://discord.com/other/path'));
    assert.ok(!isValidWebhookUrl('not a url'));
  });

  it('selects talking-point, recurring, and high-NCI stories only', () => {
    const stories = [
      story({ key: 'tp', talkingPoint: true }),
      story({ key: 'rec', recurring: true }),
      story({ key: 'high', nci: 65 }),
      story({ key: 'calm', nci: 20 }),
    ];
    const picked = selectAlertable(stories, {}, 0).map(s => s.key);
    assert.deepEqual(new Set(picked), new Set(['tp', 'rec', 'high']));
  });

  it('dedupes stories alerted within 24h and re-alerts after', () => {
    const s = [story({ key: 'tp', talkingPoint: true })];
    const now = 100 * HOUR;
    assert.equal(selectAlertable(s, { tp: now - 2 * HOUR }, now).length, 0);
    assert.equal(selectAlertable(s, { tp: now - 25 * HOUR }, now).length, 1);
  });

  it('caps alerts per run at 3, talking points first', () => {
    const stories = [
      story({ key: 'a', nci: 62 }), story({ key: 'b', nci: 70 }),
      story({ key: 'c', nci: 90 }), story({ key: 'tp', talkingPoint: true, nci: 40 }),
    ];
    const picked = selectAlertable(stories, {}, 0);
    assert.equal(picked.length, 3);
    assert.equal(picked[0]!.key, 'tp');
    assert.equal(picked[1]!.key, 'c');
  });

  it('builds a well-formed embed payload', () => {
    const payload = buildAlertPayload(story({
      talkingPoint: true, nci: 55, tierLevel: 2, tierLabel: 'Significant manipulation indicators',
      phrases: [{ phrase: 'unprecedented security threat', kind: 'coordinated', sources: ['A', 'B', 'C'] }],
      flags: ['⚠ TALKING POINT — synchronized phrasing'],
    })) as { username: string; embeds: Array<{ title: string; fields: Array<{ name: string; value: string }> }> };
    assert.equal(payload.username, "JSA's Monitor");
    assert.ok(payload.embeds[0]!.title.includes('TALKING POINT'));
    const phraseField = payload.embeds[0]!.fields.find(f => f.name === 'Synchronized phrasing');
    assert.ok(phraseField!.value.includes('unprecedented security threat'));
  });
});

describe('daily digest', () => {
  it('is due once per day after 08:00 local', async () => {
    const { digestDue } = await import('../src/services/discord-alerts');
    const at = (h: number) => { const d = new Date('2026-07-23T00:00:00'); d.setHours(h); return d.getTime(); };
    assert.equal(digestDue(null, at(9)), true);
    assert.equal(digestDue('2026-07-23', at(9)), false);   // already sent today
    assert.equal(digestDue('2026-07-22', at(9)), true);    // sent yesterday
    assert.equal(digestDue('2026-07-22', at(6)), false);   // too early
  });

  it('builds a digest with top-5 stories by NCI', async () => {
    const { buildDigestPayload } = await import('../src/services/discord-alerts');
    const stories = [10, 80, 30, 60, 20, 90].map((n, i) => story({ key: `s${i}`, nci: n, title: `Story ${n}` }));
    const payload = buildDigestPayload({ stories, headlineCount: 500, alerts: 2, avgNci: 33, peakNci: 90 }, Date.parse('2026-07-23T12:00:00Z')) as { embeds: Array<{ description: string }> };
    const desc = payload.embeds[0]!.description;
    assert.ok(desc.startsWith('**1.** [NCI 90]'));
    assert.ok(desc.includes('[NCI 80]'));
    assert.ok(!desc.includes('[NCI 10]')); // only top 5
  });
});
