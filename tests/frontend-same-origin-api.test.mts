import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PUBLIC_MCP_URL,
  PUBLIC_ORIGIN,
  PUBLIC_PRO_URL,
  isPublicWebHost,
} from '../src/config/brand.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FRONTEND_API_FILES = [
  'src/services/runtime.ts',
  'src/services/premium-fetch.ts',
  'src/app/desktop-updater.ts',
  'src/components/UnifiedSettings.ts',
  'src/components/Panel.ts',
  'src/components/ResilienceWidget.ts',
  'src/components/RuntimeConfigPanel.ts',
  'src/components/RouteExplorer/RouteExplorer.ts',
  'src/components/LiveNewsPanel.ts',
  'src/settings-main.ts',
  'src/services/notifications-settings.ts',
  'src/embed/embed-url.ts',
  'src/config/variant-meta.ts',
  'index.html',
];

describe('frontend same-origin API host', () => {
  it('publishes the paper origin for marketing URLs only', () => {
    assert.equal(PUBLIC_ORIGIN, 'https://thepublicdispatch.com');
    assert.equal(PUBLIC_PRO_URL, 'https://thepublicdispatch.com/pro');
    assert.equal(PUBLIC_MCP_URL, 'https://thepublicdispatch.com/mcp');
    assert.equal(isPublicWebHost('thepublicdispatch.com'), true);
    assert.equal(isPublicWebHost('www.thepublicdispatch.com'), true);
    assert.equal(isPublicWebHost('deploy-preview--paper.netlify.app'), true);
    assert.equal(isPublicWebHost('brians-world-monitor.vercel.app'), false);
    assert.equal(isPublicWebHost('worldmonitor.app'), false);
  });

  it('does not hardcode Vercel as an API or upgrade host in the SPA', () => {
    for (const rel of FRONTEND_API_FILES) {
      const source = readFileSync(resolve(ROOT, rel), 'utf8');
      assert.equal(
        source.includes('brians-world-monitor.vercel.app'),
        false,
        `${rel} still hardcodes the Vercel project host`,
      );
    }
  });

  it('keeps browser API calls relative unless an env base is set', () => {
    const runtime = readFileSync(resolve(ROOT, 'src/services/runtime.ts'), 'utf8');
    assert.match(runtime, /const DEFAULT_WEB_API_URL = '';/);
    assert.doesNotMatch(runtime, /DEFAULT_WEB_API_URL = 'https:\/\//);
  });

  it('canonicalizes the dashboard to the paper host', () => {
    const index = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
    const variantMeta = readFileSync(resolve(ROOT, 'src/config/variant-meta.ts'), 'utf8');
    assert.match(index, /href="https:\/\/thepublicdispatch\.com\/dashboard"/);
    assert.match(variantMeta, /url: 'https:\/\/thepublicdispatch\.com\/dashboard'/);
    assert.doesNotMatch(index, /vercel\.app/);
    assert.doesNotMatch(variantMeta, /vercel\.app/);
  });
});
