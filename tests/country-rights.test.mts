import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  constituteSearchUrl,
  getCountryRights,
  indexedRightsIso2,
} from '../src/data/country-rights.ts';
import { OSINT_TOOLS, filterOsintTools } from '../src/data/osint-tools.ts';

describe('country rights desk', () => {
  it('indexes the U.S. Bill of Rights as ten amendments', () => {
    const us = getCountryRights('us', 'United States');
    assert.equal(us.coverage, 'indexed');
    assert.match(us.instrument.name, /Bill of Rights/);
    assert.equal(us.citizens.length, 10);
    assert.equal(us.citizens[0]?.id, 'I');
    assert.match(us.citizens[0]?.title ?? '', /Amendment I/);
    assert.ok(us.persons.some((c) => /persons/i.test(c.title)));
    assert.ok(us.travel.length >= 1);
    assert.ok(us.sources.some((s) => s.url.includes('archives.gov')));
  });

  it('never invents a charter for an unindexed country — links only', () => {
    const xx = getCountryRights('IS', 'Iceland');
    assert.equal(xx.coverage, 'links-only');
    assert.equal(xx.citizens.length, 0);
    assert.ok(xx.sources.some((s) => s.url.startsWith('https://www.constituteproject.org/')));
    assert.ok(xx.travel.length >= 1);
    assert.equal(constituteSearchUrl('Iceland'), xx.sources.find((s) => s.label.includes('Constitute'))?.url);
  });

  it('every travel clause that is country-specific can carry a source, and every source URL is https', () => {
    for (const iso2 of indexedRightsIso2()) {
      const rec = getCountryRights(iso2, iso2);
      for (const s of rec.sources) {
        assert.match(s.url, /^https:\/\//, `${iso2} source ${s.label}`);
      }
      for (const clause of rec.travel) {
        if (clause.sourceUrl) assert.match(clause.sourceUrl, /^https:\/\//, `${iso2} travel ${clause.id}`);
      }
    }
  });
});

describe('OSINT4ALL catalog', () => {
  it('has unique ids and official https URLs', () => {
    const ids = OSINT_TOOLS.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const tool of OSINT_TOOLS) {
      assert.match(tool.url, /^https:\/\//, tool.id);
    }
  });

  it('filters by category and query without changing catalog order of survivors', () => {
    const archives = filterOsintTools({ category: 'Archives' });
    assert.ok(archives.length >= 2);
    assert.ok(archives.every((t) => t.category === 'Archives'));
    const wayback = filterOsintTools({ query: 'wayback' });
    assert.equal(wayback[0]?.id, 'wayback');
  });
});
