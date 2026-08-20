import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  heuristicNciScore, tierFor, scaleScore, buildNciPrompt,
  parseAiNciResponse, mergeNci, NCI_INDICATORS,
} from '../src/utils/nci-score';
import { analyzeTalkingPoints, type TitleForAnalysis } from '../src/utils/talking-points';

const t = (source: string, title: string, minsAgo = 0): { source: string; title: string; pubDate: Date } & TitleForAnalysis => ({
  source, title, pubDate: new Date(Date.now() - minsAgo * 60_000), isWire: false, isState: false,
});

function scoreCluster(titles: ReturnType<typeof t>[]) {
  const tp = analyzeTalkingPoints(titles);
  return heuristicNciScore({ titles, tp });
}

describe('nci-score', () => {
  it('has exactly 20 indicators with unique ids 1-20', () => {
    assert.equal(NCI_INDICATORS.length, 20);
    const ids = new Set(NCI_INDICATORS.map(i => i.id));
    assert.equal(ids.size, 20);
    for (let i = 1; i <= 20; i++) assert.ok(ids.has(i));
  });

  it('maps tiers to the agreed bands', () => {
    assert.equal(tierFor(10).level, 0);
    assert.equal(tierFor(21).level, 1);
    assert.equal(tierFor(45).level, 2);
    assert.equal(tierFor(61).level, 3);
    assert.equal(tierFor(95).level, 4);
  });

  it('scaleScore maps fractions to 1-5', () => {
    assert.equal(scaleScore(0), 1);
    assert.equal(scaleScore(0.1), 2);
    assert.equal(scaleScore(0.25), 3);
    assert.equal(scaleScore(0.5), 4);
    assert.equal(scaleScore(0.9), 5);
  });

  it('scores neutral coverage low', () => {
    const result = scoreCluster([
      t('Outlet A', 'Parliament passes annual budget after committee review', 300),
      t('Outlet B', 'Annual budget approved with amendments to transit funding', 90),
      t('Outlet C', 'Budget vote concludes with bipartisan support in chamber', 10),
    ]);
    assert.ok(result.normalized <= 20, `expected low tier, got ${result.normalized}`);
    assert.equal(result.tier.level, 0);
  });

  it('scores heavily manipulated coverage substantially higher than neutral', () => {
    const manipulated = scoreCluster([
      t('Outlet A', 'Experts warn unprecedented emergency demands citizens comply immediately', 5),
      t('Outlet B', 'Officials say unprecedented emergency demands citizens comply immediately', 8),
      t('Outlet C', 'Unprecedented emergency demands citizens comply, authorities urge — traitors silenced', 6),
      t('Outlet D', 'Outrage erupts as majority agree emergency mandates are the only way', 4),
    ]);
    const neutral = scoreCluster([
      t('Outlet A', 'Parliament passes annual budget after committee review', 300),
      t('Outlet B', 'Annual budget approved with amendments to transit funding', 90),
    ]);
    assert.ok(manipulated.normalized > neutral.normalized + 15,
      `manipulated=${manipulated.normalized} neutral=${neutral.normalized}`);
    assert.ok(manipulated.tier.level >= 1);
  });

  it('total is always in [20,100] and normalized in [0,100]', () => {
    const result = scoreCluster([t('A', 'Quiet local story about a bridge repair')]);
    assert.ok(result.total >= 20 && result.total <= 100);
    assert.ok(result.normalized >= 0 && result.normalized <= 100);
  });

  it('builds a prompt containing rubric and headlines', () => {
    const result = scoreCluster([t('A', 'Some headline about events'), t('B', 'Some other headline about events')]);
    const prompt = buildNciPrompt('Some story', ['- A: "Some headline"'], result);
    assert.ok(prompt.includes('Suspicious timing'));
    assert.ok(prompt.includes('Historical propaganda parallels'));
    assert.ok(prompt.includes('ONLY a JSON object'));
  });

  it('parses AI JSON responses and merges over heuristics', () => {
    const base = scoreCluster([t('A', 'Neutral headline about a topic'), t('B', 'Second neutral headline about a topic')]);
    const ai = parseAiNciResponse('Here you go: {"scores":[{"id":10,"score":5,"evidence":"Defense contractors gain"},{"id":4,"score":4,"evidence":"No mention of prior report"}],"summary":"Moderate indicators."}');
    assert.ok(ai);
    const merged = mergeNci(base, ai!);
    assert.equal(merged.scores.get(10)!.score, 5);
    assert.equal(merged.scores.get(10)!.source, 'ai');
    assert.equal(merged.scores.get(4)!.score, 4);
    assert.ok(merged.normalized > base.normalized);
  });

  it('rejects malformed AI responses', () => {
    assert.equal(parseAiNciResponse('no json here'), null);
    assert.equal(parseAiNciResponse('{"scores":"nope"}'), null);
    assert.equal(parseAiNciResponse('{"scores":[{"id":99,"score":3}]}'), null);
  });

  it('clamps out-of-range AI scores', () => {
    const ai = parseAiNciResponse('{"scores":[{"id":1,"score":17,"evidence":"x"},{"id":2,"score":-3,"evidence":"y"}],"summary":""}');
    assert.ok(ai);
    assert.equal(ai!.scores.get(1)!.score, 5);
    assert.equal(ai!.scores.get(2)!.score, 1);
  });
});

describe('nci-score pubDateMissing timing', () => {
  const undated = (source: string, title: string) => ({
    source,
    title,
    pubDate: new Date(),
    pubDateMissing: true as boolean,
    isWire: false,
    isState: false,
  });

  it('does not treat synthesized missing pubDates as a simultaneous burst', () => {
    const result = scoreCluster([
      undated('Outlet A', 'Parliament passes annual budget after committee review'),
      undated('Outlet B', 'Annual budget approved with amendments to transit funding'),
      undated('Outlet C', 'Budget vote concludes with bipartisan support in chamber'),
      undated('Outlet D', 'Lawmakers complete the annual spending bill for the year'),
    ]);
    const timing = result.scores.get(1)!;
    assert.equal(timing.score, 1, `undated items must not raise suspicious-timing (got ${timing.score})`);
    assert.match(timing.evidence, /missing pubDate/i);
  });

  it('still scores a real dated burst and discloses undated exclusions', () => {
    const base = Date.now();
    const dated = (source: string, title: string, offsetMin: number) => ({
      source,
      title,
      pubDate: new Date(base - offsetMin * 60_000),
      pubDateMissing: false,
      isWire: false,
      isState: false,
    });
    const result = heuristicNciScore({
      titles: [
        dated('Outlet A', 'Quiet local story about a bridge repair downtown', 4),
        dated('Outlet B', 'City crews finish overnight repairs on the main bridge', 6),
        dated('Outlet C', 'Bridge reopens after overnight maintenance work ends', 8),
        dated('Outlet D', 'Traffic returns to normal after the overnight bridge work', 10),
        undated('Outlet E', 'Regional paper covers the same bridge repair without a date'),
      ],
      tp: analyzeTalkingPoints([
        t('Outlet A', 'Quiet local story about a bridge repair downtown'),
        t('Outlet B', 'City crews finish overnight repairs on the main bridge'),
        t('Outlet C', 'Bridge reopens after overnight maintenance work ends'),
        t('Outlet D', 'Traffic returns to normal after the overnight bridge work'),
        t('Outlet E', 'Regional paper covers the same bridge repair without a date'),
      ]),
    });
    const timing = result.scores.get(1)!;
    assert.ok(timing.score >= 3, `dated 2-hour cluster should still score bursty (got ${timing.score})`);
    assert.match(timing.evidence, /dated items published within a 2-hour window/);
    assert.match(timing.evidence, /1 undated excluded/);
  });
});
