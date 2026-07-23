import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTweetText, type ShareStory } from '../src/services/share-card';

const story = (over: Partial<ShareStory> = {}): ShareStory => ({
  title: 'Officials warn of unprecedented security threat at the border',
  nci: 55, tierLabel: 'Significant manipulation indicators',
  talkingPoint: false, recurring: false, sourceCount: 5, ...over,
});

describe('share-card', () => {
  it('leads with the talking-point signal when flagged', () => {
    const t = buildTweetText(story({ talkingPoint: true, topPhrase: 'unprecedented security threat', phraseSources: ['A', 'B', 'C'] }));
    assert.ok(t.startsWith('⚠ SYNCHRONIZED TALKING POINT'));
    assert.ok(t.includes('@JSAsmonitor'));
    assert.ok(t.includes('5 outlets'));
  });

  it('leads with recurring signal when recurring', () => {
    const t = buildTweetText(story({ recurring: true }));
    assert.ok(t.startsWith('↻ RECURRING NARRATIVE'));
  });

  it('falls back to NCI lead for unflagged high scores', () => {
    const t = buildTweetText(story({ nci: 62 }));
    assert.ok(t.includes('NCI 62/100'));
  });

  it('always stays within X 280-char limit, even with long titles/phrases', () => {
    const t = buildTweetText(story({
      talkingPoint: true,
      title: 'A'.repeat(400),
      topPhrase: 'B'.repeat(200),
      phraseSources: Array.from({ length: 20 }, (_, i) => `Outlet ${i}`),
    }));
    assert.ok(t.length <= 280, `tweet length ${t.length}`);
  });

  it('includes NCI and outlet count in the detail line', () => {
    const t = buildTweetText(story({ nci: 48, sourceCount: 7 }));
    assert.ok(t.includes('NCI 48/100'));
    assert.ok(t.includes('7 outlets'));
  });
});
