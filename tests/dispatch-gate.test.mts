import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DISPATCH_ENTERED_KEY,
  DISPATCH_HOME_LOCATION_KEY,
  hasFlyableLocation,
  isDispatchEntered,
  markDispatchEntered,
  parseHomeLocation,
  persistHomeLocation,
  readHomeLocation,
  shouldShowDispatchGate,
  type DispatchGateStore,
} from '../src/services/dispatch-gate.ts';
import { STAGE_MODE_KEY } from '../src/services/godseye-mode.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeStore(seed: Record<string, string> = {}): DispatchGateStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe('shouldShowDispatchGate', () => {
  it('shows the gate when the entered key is missing', () => {
    assert.equal(shouldShowDispatchGate({ store: makeStore() }), true);
  });

  it('hides the gate after the reader has entered', () => {
    const store = makeStore({ [DISPATCH_ENTERED_KEY]: '1' });
    assert.equal(shouldShowDispatchGate({ store }), false);
    assert.equal(isDispatchEntered(store), true);
  });

  it('hides the gate for God\'s Eye share links', () => {
    const store = makeStore();
    assert.equal(shouldShowDispatchGate({ store, search: '?godseye=1' }), false);
    assert.equal(shouldShowDispatchGate({ store, search: '?godseye=true' }), false);
  });

  it('hides the gate when the URL explicitly leaves the stage', () => {
    assert.equal(shouldShowDispatchGate({ store: makeStore(), search: '?godseye=0' }), false);
  });

  it('hides the gate on non-dashboard pages', () => {
    const store = makeStore();
    assert.equal(shouldShowDispatchGate({ store, pathname: '/embed.html' }), false);
    assert.equal(shouldShowDispatchGate({ store, pathname: '/settings' }), false);
    assert.equal(shouldShowDispatchGate({ store, pathname: '/about.html' }), false);
    assert.equal(shouldShowDispatchGate({ store, pathname: '/methodology.html' }), false);
  });

  it('hides the gate in Playwright unless forced', () => {
    const store = makeStore();
    assert.equal(shouldShowDispatchGate({ store, isE2E: true }), false);
    assert.equal(shouldShowDispatchGate({ store, isE2E: true, search: '?tpd_gate=1' }), true);
  });

  it('does not write the God\'s Eye stage key', () => {
    const store = makeStore({ [STAGE_MODE_KEY]: 'dashboard' });
    shouldShowDispatchGate({ store });
    assert.equal(store.getItem(STAGE_MODE_KEY), 'dashboard');
    assert.equal(store.getItem(DISPATCH_ENTERED_KEY), null);
  });
});

describe('home location persistence', () => {
  it('parses and persists a postal location', () => {
    const store = makeStore();
    persistHomeLocation({
      postal: '10001',
      countryCode: 'US',
      lat: 40.75,
      lon: -73.99,
      region: 'america',
      source: 'postal',
    }, store);
    const raw = store.getItem(DISPATCH_HOME_LOCATION_KEY);
    assert.ok(raw);
    const parsed = parseHomeLocation(raw);
    assert.deepEqual(parsed, {
      postal: '10001',
      countryCode: 'US',
      lat: 40.75,
      lon: -73.99,
      region: 'america',
      source: 'postal',
    });
    assert.equal(hasFlyableLocation(parsed), true);
    assert.deepEqual(readHomeLocation(store), parsed);
  });

  it('accepts a skipped location without coordinates', () => {
    const parsed = parseHomeLocation(JSON.stringify({ source: 'skipped' }));
    assert.deepEqual(parsed, { source: 'skipped' });
    assert.equal(hasFlyableLocation(parsed), false);
  });

  it('rejects corrupt JSON', () => {
    assert.equal(parseHomeLocation('{'), null);
    assert.equal(parseHomeLocation(JSON.stringify({ source: 'area-code' })), null);
    assert.equal(parseHomeLocation(''), null);
  });

  it('marks the reader as entered without touching the stage key', () => {
    const store = makeStore();
    markDispatchEntered(store);
    assert.equal(store.getItem(DISPATCH_ENTERED_KEY), '1');
    assert.equal(store.getItem(STAGE_MODE_KEY), null);
  });
});

describe('gate module isolation', () => {
  it('does not import or call engageGodsEyeStage', () => {
    const source = readFileSync(resolve(__dirname, '../src/services/dispatch-gate.ts'), 'utf8');
    assert.equal(source.includes('engageGodsEyeStage'), false);
    assert.equal(source.includes('godseye-mode'), false);
  });
});
