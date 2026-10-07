import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  heuristicNciScore, tierFor, scaleScore, buildNciPrompt, buildNciReport,
  parseAiNciResponse, mergeNci, NCI_INDICATORS, NCI_TIERS,
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

  it('tier labels describe indicator concentration, not a collusion verdict', () => {
    const labels = NCI_TIERS.map(tier => tier.label).join('\n');
    assert.equal(/likelihood of an organized influence campaign/i.test(labels), false);
    assert.equal(/engineered-reality environment/i.test(labels), false);
    assert.equal(/\bcoordinated\b/i.test(labels), false);
    assert.match(NCI_TIERS[0]!.label, /indicators/i);
    assert.match(NCI_TIERS[3]!.label, /indicators/i);
    assert.match(NCI_TIERS[4]!.label, /indicators/i);
    assert.equal(tierFor(70).label, NCI_TIERS[3]!.label);
    assert.equal(tierFor(90).label, NCI_TIERS[4]!.label);
  });

  it('heuristic evidence and exported reports do not label shared phrasing as coordinated', () => {
    const result = scoreCluster([
      t('Outlet A', 'Officials warn of unprecedented security threat at the border', 5),
      t('Outlet B', 'Nation faces unprecedented security threat, lawmakers say', 8),
      t('Outlet C', 'Why the unprecedented security threat changes everything', 6),
    ]);
    const syncEvidence = result.scores.get(3)!.evidence;
    assert.equal(/\bcoordinated\b/i.test(syncEvidence), false);
    assert.match(syncEvidence, /shared phrase/i);
    const framing = result.scores.get(18)!.evidence;
    assert.equal(/\bcoordinated\b/i.test(framing), false);
    const report = buildNciReport('Test story', result, {
      sources: ['Outlet A', 'Outlet B', 'Outlet C'],
      phrases: [{ phrase: 'unprecedented security threat', kind: 'coordinated', sources: ['Outlet A', 'Outlet B', 'Outlet C'] }],
    });
    assert.equal(/\(\s*coordinated\s*\)/i.test(report), false);
    assert.match(report, /shared phrasing/);
    assert.match(report, /not proof/i);
  });
});

describe('nci-score undated burst timing', () => {
  const now = Date.now();
  const dated = (source: string, title: string, offsetMin: number) => ({
    source,
    title,
    pubDate: new Date(now - offsetMin * 60_000),
    pubDateMissing: false,
    isWire: false,
    isState: false,
  });
  const undated = (source: string, title: string) => ({
    source,
    title,
    // Synthesized "now" stamp — the bug treated this as a real publish time.
    pubDate: new Date(now),
    pubDateMissing: true,
    isWire: false,
    isState: false,
  });

  it('does not score a burst from 2 dated headlines and 3 with no pubDate', () => {
    const titles = [
      dated('Outlet A', 'Parliament passes annual budget after committee review', 10),
      dated('Outlet B', 'Lawmakers finish the annual spending bill this afternoon', 20),
      undated('Outlet C', 'Budget vote concludes with bipartisan support in chamber'),
      undated('Outlet D', 'Annual budget approved with amendments to transit funding'),
      undated('Outlet E', 'Committee review ends as the spending package advances'),
    ];
    const result = heuristicNciScore({ titles, tp: analyzeTalkingPoints(titles) });
    const timing = result.scores.get(1)!;
    assert.equal(timing.evidence, 'Insufficient timing spread to assess.');
    assert.equal(timing.score, 1);
  });

  it('uses the full cluster as the burst denominator and leaves undated items outside the window', () => {
    const titles = [
      dated('Outlet A', 'Quiet local story about a bridge repair downtown', 4),
      dated('Outlet B', 'City crews finish overnight repairs on the main bridge', 6),
      dated('Outlet C', 'Bridge reopens after overnight maintenance work ends', 8),
      undated('Outlet D', 'Regional paper covers the same bridge repair without a date'),
      undated('Outlet E', 'Another undated brief on the overnight bridge work'),
    ];
    const result = heuristicNciScore({ titles, tp: analyzeTalkingPoints(titles) });
    const timing = result.scores.get(1)!;
    // 3 dated inside 2 hours / 5 headlines = 60%, not 3/3 or 5/5.
    assert.equal(timing.evidence, '60% of items published within a 2-hour window');
  });

  it('does not mark undated Coverage Compare items LIVE', () => {
    const panel = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../src/components/CoverageComparePanel.ts'),
      'utf8',
    );
    assert.match(panel, /effectivePubDateMs\(i\.item\)/);
    assert.equal(/\.pubDate\.getTime\s*\(/.test(panel), false);
    assert.match(panel, /\$\{undatedCount\} undated/);
    assert.match(panel, /pubDateMissing/);
  });
});
