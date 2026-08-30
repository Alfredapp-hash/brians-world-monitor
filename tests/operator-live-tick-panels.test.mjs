import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';

const panels = fs.readFileSync(new URL('../src/config/panels.ts', import.meta.url), 'utf8');
const scheduler = fs.readFileSync(new URL('../src/app/refresh-scheduler.ts', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.ts', import.meta.url), 'utf8');
const telegram = fs.readFileSync(new URL('../src/services/telegram-intel.ts', import.meta.url), 'utf8');

describe('operator live-tick allowlist', () => {
  it('ticks telegram-intel only — Railway relay, not Redis', () => {
    assert.match(panels, /OPERATOR_LIVE_TICK_PANELS:\s*readonly string\[\]\s*=\s*\['telegram-intel'\]/);
    assert.doesNotMatch(panels, /OPERATOR_LIVE_TICK_PANELS[\s\S]{0,80}ais/i);
  });

  it('RefreshScheduler oneShot skips live-tick panels', () => {
    assert.match(
      scheduler,
      /const oneShot = OPERATOR_REFRESH_ON_LOAD_ONLY && !isOperatorLiveTickPanel\(name\);/,
    );
    assert.match(
      scheduler,
      /OPERATOR_REFRESH_ON_LOAD_ONLY && !isOperatorLiveTickPanel\(name\)/,
    );
  });

  it('App still schedules telegram-intel at the 60s interval', () => {
    assert.match(
      app,
      /scheduleRefresh\(\s*'telegram-intel',\s*\(\) => this\.dataLoader\.loadTelegramIntel\(\),\s*REFRESH_INTERVALS\.telegramIntel/,
    );
  });

  it('OSINT and Middle East are client filters on that same feed', () => {
    assert.match(telegram, /id:\s*'middleeast'/);
    assert.match(telegram, /id:\s*'osint'/);
  });
});
