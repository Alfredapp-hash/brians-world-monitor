import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dirname, '..');

const DEAD = [
  '@JSAsmonitor',
  'x.com/JSAsmonitor',
  'discord.gg/BCHZDq8Xt',
];

/** User-facing frontend + docs that must not advertise dead social. */
const SURFACES = [
  'src/config/brand.ts',
  'src/app/panel-layout.ts',
  'src/components/CommunityWidget.ts',
  'src/services/share-card.ts',
  'index.html',
  'public/about.html',
  'public/methodology.html',
  'scripts/build-methodology-page.mjs',
  'README.md',
];

function walkTsFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkTsFiles(full, acc);
    else if (/\.(ts|html|mjs|md)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

describe('dead social channels stay hidden', () => {
  it('brand config has empty social URLs (no invented replacements)', () => {
    const src = readFileSync(join(root, 'src/config/brand.ts'), 'utf8');
    assert.match(src, /discordInvite:\s*''/);
    assert.match(src, /x:\s*''/);
    for (const needle of DEAD) {
      assert.equal(src.includes(needle), false, `brand.ts still mentions ${needle}`);
    }
  });

  it('user-facing frontend/docs surfaces no longer advertise the dead channels', () => {
    for (const rel of SURFACES) {
      const src = readFileSync(join(root, rel), 'utf8');
      for (const needle of DEAD) {
        assert.equal(src.includes(needle), false, `${rel} still mentions ${needle}`);
      }
    }
  });

  it('src/ components and public HTML do not ship the dead invite or handle', () => {
    const files = [
      ...walkTsFiles(join(root, 'src')),
      ...walkTsFiles(join(root, 'public')).filter((p) => !p.includes('/pro/')),
      join(root, 'index.html'),
    ];
    const hits = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const needle of DEAD) {
        if (src.includes(needle)) hits.push(`${relative(root, file)}: ${needle}`);
      }
    }
    assert.deepEqual(hits, [], `dead social still surfaced:\n${hits.join('\n')}`);
  });
});
