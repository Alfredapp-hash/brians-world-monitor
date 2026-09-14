import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fixture from '../src/osint/catalog.fixture.json' with { type: 'json' };
import type { OsintCatalog } from '../src/osint/catalog.types.ts';
import {
  OSINT_CATALOG_URL,
  isOsintCatalog,
  loadOsintCatalog,
  OsintCatalogLoadError,
} from '../src/osint/load-catalog.ts';
import { expandSearchTerms, filterOsintCatalog } from '../src/osint/search-catalog.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalog = fixture as OsintCatalog;

describe('OSINT catalog fixture', () => {
  it('matches OsintCatalog v2 and stays a tiny test-only set', () => {
    assert.equal(isOsintCatalog(catalog), true);
    assert.equal(catalog.source, 'osint4all-native');
    assert.equal(catalog.version, 2);
    assert.equal(catalog.tools.length, 3);
    assert.equal(catalog.categories.length, 2);
    assert.ok(catalog.tools.length < 10, 'fixture must not pretend to be the 246-tool catalog');
  });

  it('does not reconstruct the production catalog or keep _parts', () => {
    const fixturePath = resolve(__dirname, '../src/osint/catalog.fixture.json');
    const publicCatalog = resolve(__dirname, '../public/osint/catalog.json');
    const partsDir = resolve(__dirname, '../public/osint/_parts');
    assert.equal(readFileSync(fixturePath, 'utf8').includes('"wayback"'), true);
    assert.equal(existsSync(partsDir), false);
    if (!existsSync(publicCatalog)) return;
    const parsed: unknown = JSON.parse(readFileSync(publicCatalog, 'utf8'));
    assert.equal(isOsintCatalog(parsed), true);
    if (isOsintCatalog(parsed)) {
      assert.equal(parsed.version, 2);
      assert.equal(parsed.toolCount, 246);
      assert.equal(parsed.tools.length, 246);
      assert.equal(parsed.categoryCount, 49);
    }
  });
});

describe('OSINT catalog search', () => {
  it('filters by category id', () => {
    const archives = filterOsintCatalog(catalog, { query: '', categoryId: 'archives' });
    assert.deepEqual(archives.map((tool) => tool.id).sort(), ['archive-today', 'wayback']);
  });

  it('matches name and summary text', () => {
    const hits = filterOsintCatalog(catalog, { query: 'certificate', categoryId: 'all' });
    assert.deepEqual(hits.map((tool) => tool.id), ['crtsh']);
  });

  it('expands synonyms so wayback is found via snapshot', () => {
    const terms = expandSearchTerms('snapshot', catalog);
    assert.ok(terms.includes('wayback'));
    const hits = filterOsintCatalog(catalog, { query: 'snapshot', categoryId: 'all' });
    assert.ok(hits.some((tool) => tool.id === 'wayback'));
  });

  it('uses searchHints without inventing extra tools', () => {
    const hits = filterOsintCatalog(catalog, { query: 'whois', categoryId: 'all' });
    assert.ok(hits.some((tool) => tool.id === 'crtsh'));
    assert.equal(hits.every((tool) => catalog.tools.some((known) => known.id === tool.id)), true);
  });
});

describe('OSINT catalog loader', () => {
  it('fetches /osint/catalog.json and validates v2 shape', async () => {
    const seen: string[] = [];
    const loaded = await loadOsintCatalog(async (input) => {
      seen.push(input);
      if (input === OSINT_CATALOG_URL) {
        return { ok: true, status: 200, json: async () => catalog };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    assert.deepEqual(seen, [OSINT_CATALOG_URL]);
    assert.equal(loaded.tools.length, 3);
    assert.equal(loaded.tools[0]?.name, 'Internet Archive Wayback Machine');
  });

  it('does not invent tools when catalog.json is missing', async () => {
    await assert.rejects(
      () => loadOsintCatalog(async () => ({ ok: false, status: 404, json: async () => ({}) })),
      (err: unknown) => {
        assert.ok(err instanceof OsintCatalogLoadError);
        assert.equal(err.status, 404);
        assert.match(err.message, /WAITING ON catalog\.json/);
        return true;
      },
    );
  });
});

describe('OSINT catalog panel wiring', () => {
  it('registers the panel in layout, category map, commands, and cluster', () => {
    const layout = readFileSync(resolve(__dirname, '../src/app/panel-layout.ts'), 'utf8');
    const panels = readFileSync(resolve(__dirname, '../src/config/panels.ts'), 'utf8');
    const commands = readFileSync(resolve(__dirname, '../src/config/commands.ts'), 'utf8');
    const vite = readFileSync(resolve(__dirname, '../vite.config.ts'), 'utf8');
    const component = readFileSync(resolve(__dirname, '../src/components/OsintCatalogPanel.ts'), 'utf8');

    assert.match(layout, /lazyDefaultPanel\('osint-catalog'/);
    assert.match(panels, /'osint-catalog':\s*\{\s*name:\s*'OSINT Tools'/);
    assert.match(panels, /'osint-catalog'/);
    assert.match(commands, /id:\s*'panel:osint-catalog'/);
    assert.match(vite, /OsintCatalog:\s*'panels-intel'/);
    assert.match(component, /loadOsintCatalog/);
    assert.match(component, /noopener noreferrer/);
    assert.match(component, /WAITING ON catalog\.json/);
    assert.doesNotMatch(component, /parchment|JSA|jsa-monitor/i);

    const loader = readFileSync(resolve(__dirname, '../src/osint/load-catalog.ts'), 'utf8');
    assert.match(loader, /\/osint\/catalog\.json/);
    assert.doesNotMatch(loader, /catalog\.json\.part/);
    assert.doesNotMatch(loader, /_parts/);
    assert.doesNotMatch(loader, /toolShardFiles/);

    assert.equal(existsSync(resolve(__dirname, '../public/osint/_parts')), false);
    assert.equal(existsSync(resolve(__dirname, '../public/osint/catalog.tools.a.json')), false);
    assert.equal(existsSync(resolve(__dirname, '../public/osint/catalog.tools.b.json')), false);
  });
});
