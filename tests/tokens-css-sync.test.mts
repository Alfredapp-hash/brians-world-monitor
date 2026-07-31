import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND, STATUS, SEVERITY, CATEGORY, CATEGORY_ORDER, withAlpha, hexToRgb } from '../src/styles/tokens';

const css = readFileSync(join(import.meta.dirname, '../src/styles/brians-theme.css'), 'utf8');

function cssVar(name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  assert.ok(m, `brians-theme.css defines --${name}`);
  return m[1].trim().toLowerCase();
}

describe('tokens.ts stays in sync with brians-theme.css', () => {
  const brandMap: Record<keyof typeof BRAND, string> = {
    bg: 'bg', bgSecondary: 'bg-secondary',
    surface: 'surface', surfaceHover: 'surface-hover', surfaceActive: 'surface-active',
    border: 'border', borderStrong: 'border-strong', borderSubtle: 'border-subtle',
    text: 'text', textSecondary: 'text-secondary', textDim: 'text-dim-safe',
    accent: 'accent',
  };

  for (const [tsKey, cssName] of Object.entries(brandMap)) {
    it(`BRAND.${tsKey} === var(--${cssName})`, () => {
      assert.equal(BRAND[tsKey as keyof typeof BRAND].toLowerCase(), cssVar(cssName));
    });
  }

  for (const key of ['good', 'info', 'watch', 'warn', 'alert'] as const) {
    it(`STATUS.${key} === var(--status-${key})`, () => {
      assert.equal(STATUS[key].toLowerCase(), cssVar(`status-${key}`));
    });
  }

  it('SEVERITY.s5 === var(--sev-critical)', () => {
    assert.equal(SEVERITY.s5.toLowerCase(), cssVar('sev-critical'));
  });

  for (const key of Object.keys(CATEGORY) as (keyof typeof CATEGORY)[]) {
    it(`CATEGORY.${key} === var(--cat-${key})`, () => {
      assert.equal(CATEGORY[key].toLowerCase(), cssVar(`cat-${key}`));
    });
  }

  it('severity s1–s4 ride the status scale', () => {
    assert.equal(SEVERITY.s1, STATUS.info);
    assert.equal(SEVERITY.s2, STATUS.watch);
    assert.equal(SEVERITY.s3, STATUS.warn);
    assert.equal(SEVERITY.s4, STATUS.alert);
  });

  it('all tokens are 6-digit lowercase hex', () => {
    const all = [
      ...Object.values(BRAND), ...Object.values(STATUS),
      ...Object.values(SEVERITY), ...CATEGORY_ORDER,
    ];
    for (const hex of all) assert.match(hex, /^#[0-9a-f]{6}$/);
  });

  it('categorical palette has 8 distinct hues', () => {
    assert.equal(new Set(CATEGORY_ORDER).size, 8);
  });
});

describe('token helpers', () => {
  it('withAlpha appends a clamped hex alpha byte', () => {
    assert.equal(withAlpha('#f0a832', 0.5), '#f0a83280');
    assert.equal(withAlpha('#f0a832', 0), '#f0a83200');
    assert.equal(withAlpha('#f0a832', 1.5), '#f0a832ff');
  });

  it('hexToRgb round-trips channel values', () => {
    assert.deepEqual(hexToRgb('#f0a832'), [0xf0, 0xa8, 0x32]);
    assert.deepEqual(hexToRgb('#000000'), [0, 0, 0]);
    assert.deepEqual(hexToRgb('#ffffff'), [255, 255, 255]);
  });
});
