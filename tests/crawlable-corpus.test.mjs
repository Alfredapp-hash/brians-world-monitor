import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  buildCorpus,
  loadCorpusData,
} from '../scripts/build-crawlable-corpus.mjs';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

function read(outDir, path) {
  return readFileSync(join(outDir, path), 'utf8');
}

function jsonLdObjects(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map(([, raw]) => JSON.parse(raw));
}

describe('crawlable corpus generator', () => {
  it('builds a non-trivial static corpus with canonical raw HTML pages', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'wm-crawlable-corpus-'));
    try {
      const manifest = await buildCorpus({
        rootDir: repoRoot,
        outDir,
        baseUrl: 'https://www.worldmonitor.app',
      });

      assert.equal(manifest.sections.countries.count, 196);
      assert.equal(manifest.sections.chokepoints.count, 13);
      assert.ok(manifest.sections.changelog.count >= 1, `expected changelog pages, got ${manifest.sections.changelog.count}`);
      assert.equal(manifest.sections.glossary, undefined, 'glossary section was removed with the upstream blog');

      for (const path of [
        'countries/index.html',
        'countries/norway/index.html',
        'chokepoints/index.html',
        'chokepoints/strait-of-hormuz/index.html',
        'reference/changelog/index.html',
        'crawlable-corpus.json',
      ]) {
        assert.ok(existsSync(join(outDir, path)), `missing generated file ${path}`);
      }

      const norway = read(outDir, 'countries/norway/index.html');
      assert.match(norway, /<h1>Norway country risk and resilience<\/h1>/);
      assert.match(norway, /<link rel="canonical" href="https:\/\/www\.worldmonitor\.app\/countries\/norway\/">/);
      assert.match(norway, /<meta name="lastmod" content="2026-05-28">/);
      assert.match(norway, /Source: docs\/snapshots\/resilience-ranking-2026-05-28\.json/);
      assert.doesNotMatch(norway, /<script[^>]+type="module"|id="app"/, 'country page must be raw static HTML, not the SPA shell');
      // Deep-link CTA into the live map (opens the maximized country brief). `&` is HTML-escaped.
      assert.match(norway, /<a class="cta" href="https:\/\/www\.worldmonitor\.app\/\?country=NO&amp;expanded=1">Open Norway on the live map/);

      const norwayLd = jsonLdObjects(norway);
      assert.ok(norwayLd.some((entry) => entry['@type'] === 'WebPage' && entry.about?.['@type'] === 'Country' && entry.about?.name === 'Norway'));
      assert.ok(norwayLd.some((entry) => entry['@type'] === 'BreadcrumbList'));

      const chokepointsIndex = read(outDir, 'chokepoints/index.html');
      // The "N routes" / raw-id card subtitles are gone; cards now describe what each waterway connects.
      assert.doesNotMatch(chokepointsIndex, /\d+ routes?<\/span>/, 'chokepoint index must not expose raw "N routes" counts');
      assert.doesNotMatch(chokepointsIndex, /hormuz_strait &middot;/, 'chokepoint index must not expose raw canonical ids');
      assert.match(chokepointsIndex, /Persian Gulf ↔ Gulf of Oman/, 'chokepoint cards should show the human region');

      const hormuz = read(outDir, 'chokepoints/strait-of-hormuz/index.html');
      assert.match(hormuz, /<h1>Strait of Hormuz<\/h1>/);
      assert.match(hormuz, /<link rel="canonical" href="https:\/\/www\.worldmonitor\.app\/chokepoints\/strait-of-hormuz\/">/);
      // Deep-link CTA into the live map (pans to + opens the waterway popup).
      assert.match(hormuz, /<a class="cta" href="https:\/\/www\.worldmonitor\.app\/\?chokepoint=hormuz_strait">Open Strait of Hormuz on the live map/);
      // Human trade-route names replace the old raw route-id dump.
      assert.match(hormuz, /Persian Gulf → Europe \(Oil\)/);
      assert.doesNotMatch(hormuz, /Canonical ID|Energy baseline|Route IDs:/, 'chokepoint page must not dump raw registry fields');
      // The upstream blog (and its glossary) is gone — no /blog/ links may remain.
      assert.doesNotMatch(hormuz, /href="\/blog\//, 'chokepoint pages must not link into the removed blog');
      assert.doesNotMatch(hormuz, /<script[^>]+type="module"|id="app"/, 'chokepoint page must be raw static HTML, not the SPA shell');

      const hormuzLd = jsonLdObjects(hormuz);
      assert.ok(hormuzLd.some((entry) => entry['@type'] === 'WebPage' && entry.about?.['@type'] === 'Place' && entry.about?.name === 'Strait of Hormuz'));

      // A chokepoint with no modelled trade routes must degrade gracefully — never "0 routes".
      const dover = read(outDir, 'chokepoints/dover-strait/index.html');
      assert.doesNotMatch(dover, /0 routes?|none configured/);
      assert.match(dover, /tracked as a strategic waterway reference/);

      const changelogIndex = read(outDir, 'reference/changelog/index.html');
      assert.match(changelogIndex, /Hard fork identity/);
      assert.match(changelogIndex, /Coverage Compare \+ NCI engine/);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('loads deterministic source data without network access', async () => {
    const data = await loadCorpusData({ rootDir: repoRoot });
    assert.equal(data.sources.resilienceSnapshot, 'docs/snapshots/resilience-ranking-2026-05-28.json');
    assert.equal(data.resilience.capturedAt, '2026-05-28');
    assert.ok(data.countries.some((country) => country.slug === 'norway' && country.rank === 1));
    assert.ok(data.chokepoints.some((chokepoint) => chokepoint.slug === 'strait-of-hormuz' && chokepoint.id === 'hormuz_strait'));
    assert.equal(data.glossaryTerms, undefined, 'glossary data was removed with the upstream blog');
    assert.ok(data.changelog[0].bullets[0].includes('Hard fork identity'));
    assert.ok(data.changelog[0].bullets[0].includes('jsas-monitor'));
    assert.match(data.lastmod.chokepoints, /^\d{4}-\d{2}-\d{2}$/);
  });
});
