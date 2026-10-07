import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeTalkingPoints, findSharedPhrases, phraseKindLabel, phraseKindTitle, type TitleForAnalysis } from '../src/utils/talking-points';
import { NCI_INDICATORS, NCI_TIERS } from '../src/utils/nci-score';

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

  it('user-facing phrase labels describe overlap, not a coordination verdict', () => {
    assert.equal(phraseKindLabel('syndication'), 'wire copy');
    assert.equal(phraseKindLabel('coordinated'), 'shared phrasing');
    assert.equal(/\bcoordinated\b/i.test(phraseKindLabel('coordinated')), false);
    assert.match(phraseKindTitle('coordinated'), /not proof/i);
    assert.match(phraseKindTitle('syndication'), /syndication/i);
  });

  it('three outlets sharing the same wire sentence do not set talkingPointAlert', () => {
    const sentence = 'Central bank raises interest rates amid inflation surge';
    const result = analyzeTalkingPoints([
      t('Reuters', sentence, { isWire: true }),
      t('Outlet A', sentence),
      t('Outlet B', sentence),
    ]);
    assert.equal(result.talkingPointAlert, false);
    assert.ok(result.phrases.length > 0);
    for (const phrase of result.phrases) {
      assert.equal(phrase.kind, 'syndication');
      const chip = `${phraseKindLabel(phrase.kind)} — ${phrase.sources.join(' · ')}`;
      assert.match(chip, /wire copy/i);
      assert.ok(phrase.sources.includes('Reuters'));
      assert.ok(phrase.sources.includes('Outlet A'));
      assert.equal(chip.includes('⚠ coordinated'), false);
      assert.equal(/\bcoordinated\b/i.test(chip), false);
      assert.equal(/talking point/i.test(chip), false);
    }
  });

  it('spin-filter UI strings do not say coordinated, talking point, or influence campaign without an adjacent not-proof qualifier', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const files = [
      'src/components/CoverageComparePanel.ts',
      'src/utils/nci-score.ts',
      'src/services/discord-alerts.ts',
      'src/services/share-card.ts',
      'scripts/build-methodology-page.mjs',
      'public/methodology.html',
    ];
    const failures: string[] = [];
    for (const rel of files) {
      const src = readFileSync(resolve(root, rel), 'utf8');
      const chunks = rel.endsWith('.html') ? [src] : stringLiterals(src);
      chunks.forEach((chunk, i) => {
        for (const hit of unqualifiedVerdicts(chunk)) {
          failures.push(`${rel}#${i}: "${hit.match}" lacks adjacent "not proof" near: ${hit.context}`);
        }
      });
    }
    for (const tier of NCI_TIERS) {
      for (const hit of unqualifiedVerdicts(tier.label)) {
        failures.push(`NCI tier ${tier.level}: "${hit.match}" in "${tier.label}"`);
      }
    }
    for (const ind of NCI_INDICATORS) {
      for (const hit of unqualifiedVerdicts(`${ind.label} ${ind.hint}`)) {
        failures.push(`NCI indicator ${ind.id}: "${hit.match}" in "${ind.label} / ${ind.hint}"`);
      }
    }
    assert.deepEqual(failures, []);

    const panel = readFileSync(resolve(root, 'src/components/CoverageComparePanel.ts'), 'utf8');
    assert.equal(panel.includes('⚠ coordinated'), false);
    assert.equal(panel.includes('(${p.kind}'), false);
    assert.match(panel, /phraseKindLabel\(p\.kind\)/);
    assert.match(panel, /not proof of coordination/);
  });
});

const VERDICT_RE = /\b(coordinated|talking[ -]?points?|influence campaigns?)\b/gi;
const QUALIFIER_WINDOW = 80;

function unqualifiedVerdicts(text: string): Array<{ match: string; context: string }> {
  const hits: Array<{ match: string; context: string }> = [];
  for (const m of text.matchAll(VERDICT_RE)) {
    const at = m.index ?? 0;
    const start = Math.max(0, at - QUALIFIER_WINDOW);
    const end = Math.min(text.length, at + m[0].length + QUALIFIER_WINDOW);
    const context = text.slice(start, end).replace(/\s+/g, ' ');
    if (!/not proof/i.test(context)) hits.push({ match: m[0], context });
  }
  return hits;
}

function stringLiterals(src: string): string[] {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
  const out: string[] = [];
  const re = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g;
  for (const m of code.matchAll(re)) {
    const raw = m[0]!;
    const body = raw.slice(1, -1);
    if (body === 'coordinated' || body === 'syndication') continue;
    // Import specifiers such as "@/utils/talking-points" are not UI copy.
    if (body.includes('/') && !/\s/.test(body)) continue;
    out.push(raw.startsWith('`') ? stripInterpolations(body) : body);
  }
  return out;
}

function stripInterpolations(body: string): string {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '$' && body[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < body.length && depth > 0) {
        if (body[i] === '{') depth++;
        else if (body[i] === '}') depth--;
        if (depth > 0) i++;
      }
      continue;
    }
    out += body[i];
  }
  return out;
}
