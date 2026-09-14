import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fixture from '../src/osint/catalog.fixture.json' with { type: 'json' };
import type { OsintCatalog } from '../src/osint/catalog.types.ts';
import {
  OSINT_CATALOG_META_URL,
  OSINT_CATALOG_TOOL_SHARD_URLS,
  isOsintCatalog,
  loadOsintCatalog,
  mergeOsintCatalogShards,
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

  it('lives next to the types file, not as public/osint/catalog.json or _parts', () => {
    const fixturePath = resolve(__dirname, '../src/osint/catalog.fixture.json');
    const publicCatalog = resolve(__dirname, '../public/osint/catalog.json');
    const partsDir = resolve(__dirname, '../public/osint/_parts');
    assert.equal(readFileSync(fixturePath, 'utf8').includes('"wayback"'), true);
    assert.throws(() => readFileSync(publicCatalog, 'utf8'), /ENOENT/);
    assert.throws(() => readFileSync(partsDir, 'utf8'), /ENOENT/);
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
  const meta = {
    ...catalog,
    tools: [] as OsintCatalog['tools'],
    toolCount: catalog.tools.length,
    toolShardFiles: ['catalog.tools.a.json', 'catalog.tools.b.json'],
  };
  const shardA = { tools: catalog.tools.slice(0, 1) };
  const shardB = { tools: catalog.tools.slice(1) };

  it('merges meta + two tool shards in memory', () => {
    const merged = mergeOsintCatalogShards(meta, [shardA, shardB]);
    assert.equal(merged.tools.length, 3);
    assert.equal(merged.toolCount, 3);
    assert.equal(merged.categoryCount, 2);
    assert.deepEqual(merged.tools.map((tool) => tool.id), ['wayback', 'archive-today', 'crtsh']);
  });

  it('fetches catalog.meta.json plus tools.a/b and validates v2 shape', async () => {
    const seen: string[] = [];
    const loaded = await loadOsintCatalog(async (input) => {
      seen.push(input);
      if (input === OSINT_CATALOG_META_URL) {
        return { ok: true, status: 200, json: async () => meta };
      }
      if (input === '/osint/catalog.tools.a.json') {
        return { ok: true, status: 200, json: async () => shardA };
      }
      if (input === '/osint/catalog.tools.b.json') {
        return { ok: true, status: 200, json: async () => shardB };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    assert.deepEqual(seen, [
      OSINT_CATALOG_META_URL,
      '/osint/catalog.tools.a.json',
      '/osint/catalog.tools.b.json',
    ]);
    assert.deepEqual([...OSINT_CATALOG_TOOL_SHARD_URLS], [
      '/osint/catalog.tools.a.json',
      '/osint/catalog.tools.b.json',
    ]);
    assert.equal(loaded.toolCount, 3);
    assert.equal(loaded.tools[0]?.name, 'Internet Archive Wayback Machine');
  });

  it('does not invent tools when a shard is missing', async () => {
    await assert.rejects(
      () => loadOsintCatalog(async (input) => {
        if (input === OSINT_CATALOG_META_URL) {
          return { ok: true, status: 200, json: async () => meta };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }),
      (err: unknown) => {
        assert.ok(err instanceof OsintCatalogLoadError);
        assert.equal(err.status, 404);
        assert.match(err.message, /WAITING ON catalog shards/);
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
    assert.doesNotMatch(component, /parchment|JSA|jsa-monitor/i);

    const loader = readFileSync(resolve(__dirname, '../src/osint/load-catalog.ts'), 'utf8');
    assert.match(loader, /catalog\.meta\.json/);
    assert.match(loader, /catalog\.tools\.a\.json/);
    assert.match(loader, /catalog\.tools\.b\.json/);
    assert.doesNotMatch(loader, /catalog\.json\.part/);

    const meta = JSON.parse(
      readFileSync(resolve(__dirname, '../public/osint/catalog.meta.json'), 'utf8'),
    ) as OsintCatalog & { toolShardFiles?: string[] };
    assert.equal(meta.toolCount, 246);
    assert.equal(meta.categoryCount, 49);
    assert.equal(meta.categories.length, 49);
    assert.deepEqual(meta.tools, []);
    assert.deepEqual(meta.toolShardFiles, ['catalog.tools.a.json', 'catalog.tools.b.json']);
  });
});
