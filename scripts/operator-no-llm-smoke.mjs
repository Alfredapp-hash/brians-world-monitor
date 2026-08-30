#!/usr/bin/env node
/**
 * Production smoke for Redis/deterministic operator surfaces.
 * Does not click LLM panels or fire classify/deduct/chat/stock analysis.
 *
 *   SMOKE_URL=https://brians-world-monitor.vercel.app node scripts/operator-no-llm-smoke.mjs
 */
import { chromium } from 'playwright-core';

const URL = process.env.SMOKE_URL || 'https://brians-world-monitor.vercel.app/dashboard';
const BOOT_MS = Number(process.env.SMOKE_BOOT_MS || 25_000);

const REDIS_PANELS = [
  'regional-intelligence',
  'global-procurement',
  'trade-policy',
  'wsb-ticker-scanner',
  'national-debt',
  'sanctions-pressure',
  'supply-chain',
];

const LLM_PATHS = [
  '/api/intelligence/v1/classify-event',
  '/api/intelligence/v1/deduct-situation',
  '/api/intelligence/v1/list-market-implications',
  '/api/market/v1/analyze-stock',
  '/api/market/v1/backtest-stock',
  '/api/chat-analyst',
  '/api/scenario/v1/run-scenario',
  '/api/forecast/v1/trigger-simulation',
  '/api/mcp-proxy',
];

const REDIS_PATHS = [
  '/api/intelligence/v1/get-regional-snapshot',
  '/api/intelligence/v1/get-regime-history',
  '/api/intelligence/v1/get-regional-brief',
  '/api/economic/v1/list-global-tenders',
  '/api/economic/v1/get-national-debt',
  '/api/trade/v1/list-comtrade-flows',
  '/api/trade/v1/get-tariff-trends',
  '/api/sanctions/v1/list-sanctions-pressure',
  '/api/resilience/v1/get-resilience-score',
  '/api/resilience/v1/get-resilience-ranking',
  '/api/supply-chain/v1/get-country-chokepoint-index',
  '/api/supply-chain/v1/get-bypass-options',
];

function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

const launchOptions = {
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
};
if (process.env.CHROMIUM_PATH) launchOptions.executablePath = process.env.CHROMIUM_PATH;

const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1720, height: 1100 } });

const apiHits = [];
const allUrls = [];
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('request', (req) => {
  if (allUrls.length < 40) allUrls.push(`${req.method()} ${req.url()}`);
});
await page.route('**/api/**', async (route) => {
  const req = route.request();
  try {
    const response = await route.fetch();
    apiHits.push({
      path: pathOf(req.url()),
      status: response.status(),
      method: req.method(),
      url: req.url(),
    });
    await route.fulfill({ response });
  } catch (err) {
    apiHits.push({
      path: pathOf(req.url()),
      status: 0,
      method: req.method(),
      url: req.url(),
      failed: err instanceof Error ? err.message : String(err),
    });
    await route.abort();
  }
});

console.log(`Loading ${URL}`);
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForTimeout(BOOT_MS);

console.log('title:', await page.title());
console.log('url:', page.url());
console.log(`requests captured: ${allUrls.length}`);
for (const u of allUrls.slice(0, 40)) console.log('  ', u);
if (pageErrors.length) {
  console.log('pageerrors:');
  for (const e of pageErrors.slice(0, 8)) console.log('  ', e.slice(0, 200));
}
if (consoleErrors.length) {
  console.log('console errors:');
  for (const e of consoleErrors.slice(0, 8)) console.log('  ', e.slice(0, 200));
}

const foundKeys = await page.evaluate(() =>
  [...document.querySelectorAll('.panel[data-panel]')]
    .map((el) => el.dataset.panel)
    .filter((v, i, a) => v && a.indexOf(v) === i),
);
console.log(`\n${foundKeys.length} panels in DOM`);

const results = [];
for (const key of REDIS_PANELS) {
  const loc = page.locator(`.panel[data-panel="${key}"]`).first();
  if ((await loc.count()) === 0) {
    results.push({ key, status: 'MISSING' });
    continue;
  }
  await loc.scrollIntoViewIfNeeded({ timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(8_000);
  const info = await page.evaluate((k) => {
    const el = document.querySelector(`.panel[data-panel="${k}"]`);
    if (!el) return null;
    const locked = el.classList.contains('panel-is-locked');
    const lockText = el.querySelector('.panel-locked-desc')?.textContent?.trim() || '';
    const skeleton = Boolean(el.querySelector('.panel-deferred-skeleton'));
    const regime = Boolean(el.querySelector('.rib-regime-label'));
    const rows = el.querySelectorAll('tr, li, [class*="item"], [class*="row"]').length;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      locked,
      lockText,
      skeleton,
      regime,
      rows,
      textLen: text.length,
      sample: text.slice(0, 140),
    };
  }, key);
  if (!info) {
    results.push({ key, status: 'MISSING' });
    continue;
  }
  let status = 'PARTIAL';
  if (info.locked) status = 'LOCKED';
  else if (info.skeleton) status = 'SKELETON';
  else if (info.regime || info.rows > 4 || info.textLen > 500) status = 'WORKING';
  else if (info.textLen < 80) status = 'EMPTY';
  results.push({ key, status, ...info });
}

const redisHits = REDIS_PATHS.map((p) => {
  const hits = apiHits.filter((h) => h.path === p);
  return { path: p, statuses: hits.map((h) => h.status), count: hits.length };
});
const llmHits = LLM_PATHS.map((p) => {
  const hits = apiHits.filter((h) => h.path === p);
  return { path: p, statuses: hits.map((h) => h.status), count: hits.length };
}).filter((h) => h.count > 0);

console.log('\n== Redis panels ==');
for (const r of results) {
  console.log(`  ${r.status.padEnd(9)} ${r.key}${r.sample ? ` | ${r.sample}` : ''}`);
}

const uniqueApi = [...new Map(apiHits.map((h) => [`${h.method || 'GET'} ${h.status} ${h.path}`, h])).values()]
  .sort((a, b) => a.path.localeCompare(b.path));
console.log(`\n== All /api responses (${apiHits.length} hits, ${uniqueApi.length} unique) ==`);
for (const h of uniqueApi) {
  const extra = h.failed ? ` fail=${h.failed}` : '';
  console.log(`  ${h.status} ${h.method || 'GET'} ${h.path}${extra}`);
}

console.log('\n== Redis RPC hits ==');
for (const h of redisHits) {
  const label = h.count ? h.statuses.join(',') : 'not-called';
  console.log(`  ${String(h.count).padStart(2)}  ${h.path}  [${label}]`);
}

console.log('\n== LLM RPC hits (should be none, or 401) ==');
if (!llmHits.length) console.log('  none');
for (const h of llmHits) {
  console.log(`  ${h.path}  ${h.statuses.join(',')}`);
}

const badRedis = redisHits.filter((h) => h.statuses.some((s) => s === 401 || s === 403));
const locked = results.filter((r) => r.status === 'LOCKED' || r.status === 'MISSING');
const llmSpend = llmHits.filter((h) => h.statuses.some((s) => s >= 200 && s < 300));

await browser.close();

if (locked.length || badRedis.length || llmSpend.length) {
  console.log('\nFAIL');
  if (locked.length) console.log('  locked/missing:', locked.map((r) => r.key).join(', '));
  if (badRedis.length) console.log('  redis 401/403:', badRedis.map((h) => h.path).join(', '));
  if (llmSpend.length) console.log('  llm 2xx (unexpected spend):', llmSpend.map((h) => h.path).join(', '));
  process.exit(1);
}

console.log('\nPASS — Redis operator surfaces are visible and not spend-gated');
process.exit(0);
