#!/usr/bin/env node
/**
 * Live-data smoke test: loads the dev dashboard in headless Chromium and
 * verifies that real feed data arrives — news panels populate, the new
 * science/archaeology panels have items, and Coverage Compare produces a
 * live analysis. Saves a screenshot for visual confirmation.
 */
import { chromium } from 'playwright-core';

const URL = process.env.SMOKE_URL || 'http://localhost:3000/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1720, height: 1100 } });

const consoleErrors = [];
page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

console.log(`Loading ${URL} …`);
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

// Let feeds load.
const WAIT_S = Number(process.env.SMOKE_WAIT || 75);
for (let i = 0; i < WAIT_S; i += 15) {
  await page.waitForTimeout(15_000);
  const items = await page.locator('.news-item, [class*="news-item"]').count();
  console.log(`  t+${i + 15}s: ${items} news items rendered`);
  if (items > 80) break;
}

const result = {};
result.title = await page.title();
result.newsItems = await page.locator('.news-item, [class*="news-item"]').count();
result.panels = await page.locator('.panel').count();

// Per-panel item counts for the panels Brian cares about.
for (const key of ['science', 'archaeology', 'politics', 'coverage-compare']) {
  const panel = page.locator(`[data-panel="${key}"]`);
  if (await panel.count() === 0) { result[key] = 'PANEL NOT FOUND'; continue; }
  await panel.first().scrollIntoViewIfNeeded().catch(() => {});
  if (key === 'coverage-compare') {
    result[key] = {
      status: (await panel.locator('.cc-status').textContent().catch(() => ''))?.trim(),
      stats: (await panel.locator('.cc-stats').textContent().catch(() => ''))?.trim(),
      stories: await panel.locator('.cc-details').count(),
    };
  } else {
    result[key] = { items: await panel.locator('.news-item, [class*="news-item"], a').count() };
  }
}

// Trigger Coverage Compare analysis explicitly if it hasn't run.
const ccBtn = page.locator('[data-panel="coverage-compare"] .cc-refresh-btn');
if (await ccBtn.count() > 0 && result['coverage-compare']?.stories === 0) {
  console.log('Triggering Coverage Compare analysis…');
  await ccBtn.click();
  await page.waitForTimeout(20_000);
  const panel = page.locator('[data-panel="coverage-compare"]');
  result['coverage-compare'] = {
    status: (await panel.locator('.cc-status').textContent().catch(() => ''))?.trim(),
    stats: (await panel.locator('.cc-stats').textContent().catch(() => ''))?.trim(),
    stories: await panel.locator('.cc-details').count(),
  };
}

await page.screenshot({ path: '/tmp/live-smoke-top.png' });
const cc = page.locator('[data-panel="coverage-compare"]');
if (await cc.count() > 0) {
  await cc.first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(1000);
  await cc.first().screenshot({ path: '/tmp/live-smoke-cc.png' }).catch(() => {});
}

console.log('\n=== RESULTS ===');
console.log(JSON.stringify(result, null, 2));
console.log(`\nConsole errors (${consoleErrors.length}):`);
for (const e of consoleErrors.slice(0, 10)) console.log(`  - ${e.slice(0, 200)}`);

await browser.close();
