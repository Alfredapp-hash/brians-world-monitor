import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeTalkingPoints, findSharedPhrases, phraseKindLabel, phraseKindTitle, type TitleForAnalysis } from '../src/utils/talking-points';

const t = (source: string, title: string, opts: Partial<TitleForAnalysis> = {}): TitleForAnalysis => ({
  source, title, isWire: false, isState: false, ...opts,
});

describe('talking-points', () => {
  it('flags identical distinctive phrasing across 3+ non-wire outlets as coordinated', () => {
    const titles = [
      t('Outlet A', 'Officials warn of unprecedented security threat at the border'),
      t('Outlet B', 'Nation faces unprecedented security threat, lawmakers say'),
      t('Outlet C', 'Why the unprecedented security threat changes everything'),
      t('Outlet D', 'Markets rally as tech stocks surge'),
    ];
    const result = analyzeTalkingPoints(titles);
    assert.equal(result.talkingPointAlert, true);
    const coord = result.phrases.find(p => p.kind === 'coordinated');
    assert.ok(coord !== undefined);
    assert.ok((coord!.phrase).includes('unprecedented security threat'));
    assert.equal(coord!.sources.length, 3);
  });

  it('labels shared phrasing as syndication when a wire service uses it', () => {
    const titles = [
      t('Reuters World', 'Central bank raises interest rates amid inflation surge', { isWire: true }),
      t('Outlet A', 'Central bank raises interest rates amid inflation surge'),
      t('Outlet B', 'Central bank raises interest rates amid inflation surge'),
    ];
    const result = analyzeTalkingPoints(titles);
    const hit = result.phrases[0];
    assert.ok(hit !== undefined);
    assert.equal(hit!.kind, 'syndication');
    // Wire copy alone should not trigger the talking-point alert.
    assert.equal(result.talkingPointAlert, false);
  });

  it('flags 2 state outlets sharing coordinated phrasing', () => {
    const titles = [
      t('State TV 1', 'Peacekeeping operation liberates grateful villages', { isState: true }),
      t('State TV 2', 'Grateful villages welcome peacekeeping operation troops', { isState: true }),
      t('Indie Outlet', 'Villages report shelling as troops advance'),
    ];
    const result = analyzeTalkingPoints(titles);
    assert.equal(result.talkingPointAlert, true);
  });

  it('detects loaded language with attribution', () => {
    const titles = [
      t('Outlet A', 'Senator slams baseless claims about election'),
      t('Outlet B', 'Experts say claims are baseless and debunked'),
    ];
    const result = analyzeTalkingPoints(titles);
    const terms = result.loadedTerms.map(l => l.term);
    assert.ok((terms).includes('baseless'));
    const baseless = result.loadedTerms.find(l => l.term === 'baseless')!;
    assert.deepEqual(baseless.sources, ['Outlet A', 'Outlet B']);
  });

  it('does not flag stopword-only or generic overlaps', () => {
    const titles = [
      t('Outlet A', 'What we know so far about the storm'),
      t('Outlet B', 'What we know so far about the election'),
      t('Outlet C', 'What we know so far about the merger'),
    ];
    const phrases = findSharedPhrases(titles, 2);
    // "what we know so far about the" is all stopwords/short words — no meaningful gram.
    assert.equal(phrases.length, 0);
  });

  it('gives higher sync scores to broader coordinated phrasing', () => {
    const broad = analyzeTalkingPoints([
      t('A', 'Leaders condemn reckless escalation by neighboring state'),
      t('B', 'World condemns reckless escalation by neighboring state'),
      t('C', 'Reckless escalation by neighboring state draws condemnation'),
    ]);
    const narrow = analyzeTalkingPoints([
      t('A', 'Leaders condemn reckless escalation by neighboring state'),
      t('B', 'Completely different framing of border incident today'),
      t('C', 'Another totally unrelated headline about weather patterns'),
    ]);
    assert.ok(broad.syncScore > narrow.syncScore);
  });

  it('dedupes repeat items from the same outlet', () => {
    const titles = [
      t('Outlet A', 'Massive corruption scandal rocks parliament'),
      t('Outlet A', 'Massive corruption scandal rocks parliament'),
      t('Outlet B', 'Parliament debates budget quietly'),
    ];
    const phrases = findSharedPhrases(titles, 2);
    assert.equal(phrases.length, 0);
  });

  it('user-facing phrase labels never claim coordination as a verdict', () => {
    assert.equal(phraseKindLabel('syndication'), 'wire copy');
    assert.equal(phraseKindLabel('coordinated'), 'shared phrasing');
    assert.equal(phraseKindLabel('coordinated').toLowerCase().includes('coordinat'), false);
    assert.match(phraseKindTitle('coordinated'), /not proof of coordination/i);
    assert.match(phraseKindTitle('syndication'), /syndication/i);
  });

  it('Coverage Compare renders phrase kinds through phraseKindLabel, not a "coordinated" verdict chip', () => {
    const panel = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../src/components/CoverageComparePanel.ts'),
      'utf8',
    );
    assert.match(panel, /phraseKindLabel/);
    assert.equal(panel.includes("'⚠ coordinated'"), false);
    assert.equal(panel.includes('"⚠ coordinated"'), false);
    assert.equal(panel.includes('from coordinated messaging'), false);
  });
});
