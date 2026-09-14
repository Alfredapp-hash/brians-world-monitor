/**
 * God's Eye HUD reachability guardrails.
 *
 * The stage replaces the whole page with a globe and hides the site header, so
 * the HUD's Exit button is the only visible way out — and the only way at all
 * on a phone, which has no Escape key. These are source-shape assertions
 * because the behaviour is DOM wiring rather than a pure function: what has to
 * hold is that the HUD is inserted BEFORE the panel rail and that focus lands
 * on Exit, and both are single statements that a refactor can silently undo.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');

function readSrc(path: string): string {
  return readFileSync(resolve(root, path), 'utf-8');
}

describe("God's Eye HUD reachability", () => {
  it('inserts the HUD before the panel rail rather than appending it', () => {
    const src = readSrc('src/app/panel-layout.ts');
    const mount = src.slice(src.indexOf('private mountGodsEyeHud'));
    const body = mount.slice(0, mount.indexOf('\n  private mountReaderHero'));

    assert.match(
      body,
      /insertBefore\(hud\.element,\s*rail\)/,
      'the HUD must be inserted before #panelsGrid so Exit precedes the rail in tab order',
    );
    assert.match(
      body,
      /getElementById\('panelsGrid'\)/,
      'the insertion point must be the real rail element id',
    );
    assert.doesNotMatch(
      body,
      /appendChild\(hud\.element\)/,
      'appending the HUD puts Exit behind every focusable in the rail',
    );
  });

  it('moves focus to Exit on stage entry', () => {
    const src = readSrc('src/app/panel-layout.ts');
    assert.match(
      src,
      /hud\.focusExit\(\)/,
      'stage entry must land focus on the way out',
    );
  });

  it('gives the HUD a focusable Exit control to focus', () => {
    const src = readSrc('src/components/GodsEyeHud.ts');

    assert.match(src, /focusExit\(\)\s*:\s*void/, 'GodsEyeHud must expose focusExit()');
    assert.match(
      src,
      /this\.exitBtn\?\.focus\(\{\s*preventScroll:\s*true\s*\}\)/,
      'focus must not scroll the stage composition out of frame',
    );
    assert.match(
      src,
      /id:\s*'godseyeExitBtn'/,
      'the Exit button keeps a stable id for the e2e reachability check',
    );
    // A <button> is focusable and Enter/Space-activatable for free; a div with
    // a click handler would satisfy the selector above and none of that.
    assert.match(src, /'button',\s*\n\s*\{\s*\n\s*type:\s*'button',/);
  });

  it('keeps the HUD controls clickable through the overlay', () => {
    // The HUD itself is `pointer-events: none` so the globe stays draggable
    // underneath; the control rail must opt back in or Exit cannot be clicked
    // at all — the failure mode this whole item exists to prevent.
    const css = readSrc('src/styles/godseye-mode.css');
    const controls = css.slice(css.indexOf('.godseye-hud__controls {'));
    assert.match(
      controls.slice(0, controls.indexOf('}')),
      /pointer-events:\s*auto/,
      'the HUD control rail must accept pointer events',
    );
    assert.match(
      css,
      /\.godseye-hud__btn:focus-visible\s*\{[^}]*outline/,
      'a keyboard reader must be able to see which HUD control has focus',
    );
  });
});
