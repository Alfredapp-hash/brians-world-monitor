import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { trackNarratives, formatAge, type NarrativeStore, type NarrativeRecord } from '../src/utils/narrative-tracker';

function memStore(initial: Record<string, NarrativeRecord> = {}): NarrativeStore & { data: Record<string, NarrativeRecord> } {
  let data = initial;
  return {
    get data() { return data; },
    read: () => JSON.parse(JSON.stringify(data)),
    write: (d) => { data = d; },
  };
}

const HOUR = 60 * 60 * 1000;

describe('narrative-tracker', () => {
  it('records new phrases as non-recurring', () => {
    const store = memStore();
    const t0 = 1_000_000_000_000;
    const result = trackNarratives([{ phrase: 'unprecedented security threat', sources: ['A', 'B'] }], store, t0);
    const status = result.get('unprecedented security threat')!;
    assert.equal(status.recurring, false);
    assert.equal(status.record.runs, 1);
  });

  it('marks a phrase recurring after 3 runs spanning 6+ hours', () => {
    const store = memStore();
    const t0 = 1_000_000_000_000;
    const phrase = [{ phrase: 'grateful villages liberated', sources: ['State 1'] }];
    trackNarratives(phrase, store, t0);
    trackNarratives(phrase, store, t0 + 3 * HOUR);
    const result = trackNarratives(phrase, store, t0 + 7 * HOUR);
    const status = result.get('grateful villages liberated')!;
    assert.equal(status.record.runs, 3);
    assert.equal(status.recurring, true);
    assert.equal(status.age, '7h');
  });

  it('does not count rapid re-analyses as separate runs', () => {
    const store = memStore();
    const t0 = 1_000_000_000_000;
    const phrase = [{ phrase: 'emergency mandates only way', sources: ['A'] }];
    trackNarratives(phrase, store, t0);
    trackNarratives(phrase, store, t0 + 60_000); // 1 min later
    const result = trackNarratives(phrase, store, t0 + 120_000);
    assert.equal(result.get('emergency mandates only way')!.record.runs, 1);
  });

  it('unions sources across runs', () => {
    const store = memStore();
    const t0 = 1_000_000_000_000;
    trackNarratives([{ phrase: 'reckless escalation continues', sources: ['A', 'B'] }], store, t0);
    const result = trackNarratives([{ phrase: 'reckless escalation continues', sources: ['B', 'C'] }], store, t0 + HOUR);
    assert.deepEqual(result.get('reckless escalation continues')!.record.sources.sort(), ['A', 'B', 'C']);
  });

  it('evicts phrases older than retention', () => {
    const t0 = 1_000_000_000_000;
    const store = memStore({
      'stale old narrative': { first: t0 - 20 * 24 * HOUR, last: t0 - 15 * 24 * HOUR, runs: 5, sources: ['X'] },
    });
    trackNarratives([{ phrase: 'fresh phrase here', sources: ['A'] }], store, t0);
    assert.equal(store.data['stale old narrative'], undefined);
    assert.ok(store.data['fresh phrase here']);
  });

  it('formats ages sensibly', () => {
    assert.equal(formatAge(30_000), 'just now');
    assert.equal(formatAge(5 * 60_000), '5m');
    assert.equal(formatAge(3 * HOUR), '3h');
    assert.equal(formatAge(50 * HOUR), '2d');
  });
});
