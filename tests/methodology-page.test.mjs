import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const nciSrc = readFileSync(root + 'src/utils/nci-score.ts', 'utf-8');

// The generated page must exist and stay in sync with the rubric it explains.
const pagePath = root + 'public/methodology.html';

test('methodology.html exists (run `npm run build:methodology`)', () => {
  assert.ok(existsSync(pagePath), 'public/methodology.html missing — run the generator');
});

test('methodology.html documents every one of the 20 NCI indicators', () => {
  const html = readFileSync(pagePath, 'utf-8');
  const indBlock = nciSrc.slice(
    nciSrc.indexOf('NCI_INDICATORS: NciIndicator[] = ['),
    nciSrc.indexOf('];', nciSrc.indexOf('NCI_INDICATORS')),
  );
  const labels = [...indBlock.matchAll(/label: '([^']+)'/g)].map(m => m[1]);
  assert.equal(labels.length, 20, 'expected 20 indicators in the rubric');
  for (const label of labels) {
    const esc = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    assert.ok(html.includes(esc), `methodology page missing indicator "${label}" — regenerate it`);
  }
});

test('methodology.html carries the indicators-not-proof disclaimer', () => {
  const html = readFileSync(pagePath, 'utf-8');
  assert.ok(/measures\s+.{0,20}indicators/i.test(html));
  assert.ok(/not[\s\S]{0,40}(prove|proof|verdict)/i.test(html));
});

test('methodology.html lists all five tier bands', () => {
  const html = readFileSync(pagePath, 'utf-8');
  const tierBlock = nciSrc.slice(
    nciSrc.indexOf('NCI_TIERS: NciTier[] = ['),
    nciSrc.indexOf('];', nciSrc.indexOf('NCI_TIERS')),
  );
  const labels = [...tierBlock.matchAll(/label: '([^']+)'/g)].map(m => m[1]);
  assert.equal(labels.length, 5);
  for (const label of labels) assert.ok(html.includes(label), `missing tier "${label}"`);
});
