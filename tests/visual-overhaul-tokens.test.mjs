import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'path';

const stylesDir = join(import.meta.dirname, '../src/styles');
const theme = readFileSync(join(stylesDir, 'brians-theme.css'), 'utf8');
const chrome = readFileSync(join(stylesDir, 'chrome.css'), 'utf8');
const panels = readFileSync(join(stylesDir, 'panels.css'), 'utf8');
const comparePanel = readFileSync(
  join(import.meta.dirname, '../src/components/CoverageComparePanel.ts'),
  'utf8',
);
const eventHandlers = readFileSync(
  join(import.meta.dirname, '../src/app/event-handlers.ts'),
  'utf8',
);

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function cssRootValue(name) {
  const m = theme.match(new RegExp(`--${name}:\\s*([^;]+);`));
  assert.ok(m, `brians-theme.css defines --${name}`);
  return m[1].trim();
}

function allStylesheetText() {
  return readdirSync(stylesDir)
    .filter((name) => name.endsWith('.css'))
    .map((name) => stripCssComments(readFileSync(join(stylesDir, name), 'utf8')))
    .join('\n');
}

describe('visual overhaul token foundation', () => {
  it('exposes --text-size-* aliases for the 9/10/11/12 steps', () => {
    assert.equal(cssRootValue('text-size-xs'), 'var(--text-xs)');
    assert.equal(cssRootValue('text-size-sm'), 'var(--text-sm)');
    assert.equal(cssRootValue('text-size-md'), 'var(--text-md)');
    assert.equal(cssRootValue('text-size-lg'), 'var(--text-lg)');
  });

  it('defines semantic warning aliases consumed by deep-dive / route explorer', () => {
    assert.equal(cssRootValue('semantic-warning'), 'var(--status-watch)');
    assert.equal(cssRootValue('warning'), 'var(--status-watch)');
  });

  it('keeps the overlay ladder: dropdown < modal < toast < palette < max', () => {
    const dropdown = Number.parseInt(cssRootValue('z-dropdown'), 10);
    const modal = Number.parseInt(cssRootValue('z-modal'), 10);
    const toast = Number.parseInt(cssRootValue('z-toast'), 10);
    const palette = Number.parseInt(cssRootValue('z-palette'), 10);
    const max = Number.parseInt(cssRootValue('z-max'), 10);
    assert.ok(dropdown < modal, `dropdown ${dropdown} < modal ${modal}`);
    assert.ok(modal < toast, `modal ${modal} < toast ${toast}`);
    assert.ok(toast < palette, `toast ${toast} < palette ${palette}`);
    assert.ok(palette < max, `palette ${palette} < max ${max}`);
    assert.ok(palette >= 10050, 'palette clears the 9999–10020 modal band');
  });

  it('has no impostor golds or leftover GitHub chrome hexes in CSS', () => {
    const css = allStylesheetText();
    for (const hex of ['#f59e0b', '#ffaa00', '#eab308', '#8b949e', '#58a6ff']) {
      assert.equal(
        css.toLowerCase().includes(hex),
        false,
        `${hex} should be remapped onto tokens`,
      );
    }
  });
});

describe('visual overhaul chrome + flagship hierarchy', () => {
  it('command palette and workspace picker adopt the z-token ladder', () => {
    assert.match(chrome, /\.search-overlay\s*\{[^}]*z-index:\s*var\(--z-palette\)/);
    assert.match(panels, /\.search-overlay\s*\{[^}]*z-index:\s*var\(--z-palette\)/);
    assert.match(chrome, /\.mission-preset-scrim\s*\{[^}]*z-index:\s*var\(--z-modal\)/);
    assert.match(chrome, /\.mission-preset-popover\s*\{[^}]*z-index:\s*calc\(var\(--z-modal\) \+ 1\)/);
    assert.match(panels, /\.cc-modal-overlay[\s\S]*?z-index:\s*var\(--z-modal/);
  });

  it('workspace picker mounts a scrim and yields to ⌘K', () => {
    assert.match(eventHandlers, /mission-preset-scrim/);
    assert.match(eventHandlers, /this\.missionPresetScrim/);
    assert.match(eventHandlers, /jsam:palette-open[\s\S]*closeMissionPresetPopover/);
  });

  it('flagship Coverage Compare actions use shared .btn variants', () => {
    assert.match(comparePanel, /btn btn-primary cc-refresh-btn/);
    assert.match(comparePanel, /btn btn-primary cc-ai-btn/);
    assert.match(comparePanel, /btn btn-ghost cc-local-btn/);
    assert.match(comparePanel, /btn btn-ghost cc-copy-btn/);
    assert.match(panels, /\.btn\.cc-refresh-btn/);
  });

  it('replaces the chrome bell glyph with a line icon', () => {
    assert.doesNotMatch(comparePanel, /🔔/);
    assert.match(comparePanel, /<svg[\s\S]*M6 8a6 6 0 0 1 12 0/);
  });
});
