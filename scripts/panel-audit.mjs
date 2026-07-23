#!/usr/bin/env node
/**
 * Full-app panel audit: walks every rendered panel, scrolls it into view to
 * trigger lazy hydration, waits, and classifies it as WORKING / EMPTY /
 * SKELETON. Prints a status table.
 */
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1720, height: 1100 } });
page.on('console', () => {});
await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
console.log('Initial feed load wait…');
await page.waitForTimeout(45_000);

const keys = await page.evaluate(() =>
  [...document.querySelectorAll('[data-panel]')].map(el => el.dataset.panel).filter((v, i, a) => a.indexOf(v) === i));
console.log(`${keys.length} panels found`);

const results = [];
for (const key of keys) {
  const loc = page.locator(`[data-panel="${key}"]`).first();
  try {
    await loc.scrollIntoViewIfNeeded({ timeout: 3000 });
  } catch { results.push({ key, status: 'NOT-VISIBLE' }); continue; }
  await page.waitForTimeout(2500);
  const info = await page.evaluate((k) => {
    const el = document.querySelector(`[data-panel="${k}"]`);
    if (!el) return null;
    const skeleton = Boolean(el.querySelector('.panel-deferred-skeleton'));
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    const links = el.querySelectorAll('a[href^="http"]').length;
    const canvases = el.querySelectorAll('canvas').length;
    const svgs = el.querySelectorAll('svg').length;
    const imgs = el.querySelectorAll('img, iframe, video').length;
    const rows = el.querySelectorAll('tr, li, [class*="item"], [class*="row"]').length;
    const emptyMsg = /no (items|data|results)|unavailable|failed to load|coming soon/i.test(text);
    return { skeleton, textLen: text.length, links, canvases, svgs, imgs, rows, emptyMsg, sample: text.slice(0, 90) };
  }, key);
  if (!info) { results.push({ key, status: 'MISSING' }); continue; }
  let status;
  if (info.skeleton) status = 'SKELETON';
  else if (info.links > 3 || info.canvases > 0 || info.imgs > 0 || info.rows > 6 || info.textLen > 600) status = 'WORKING';
  else if (info.emptyMsg || info.textLen < 120) status = 'EMPTY';
  else status = 'PARTIAL';
  results.push({ key, status, ...info });
}

const by = (s) => results.filter(r => r.status === s);
console.log(`\nWORKING: ${by('WORKING').length} | PARTIAL: ${by('PARTIAL').length} | EMPTY: ${by('EMPTY').length} | SKELETON: ${by('SKELETON').length} | OTHER: ${results.length - by('WORKING').length - by('PARTIAL').length - by('EMPTY').length - by('SKELETON').length}`);
for (const status of ['EMPTY', 'SKELETON', 'PARTIAL', 'NOT-VISIBLE', 'MISSING']) {
  const list = results.filter(r => r.status === status);
  if (!list.length) continue;
  console.log(`\n== ${status} ==`);
  for (const r of list) console.log(`  ${r.key}: links=${r.links ?? '-'} rows=${r.rows ?? '-'} text=${r.textLen ?? '-'} | ${r.sample ?? ''}`);
}
console.log('\n== WORKING ==');
console.log(by('WORKING').map(r => r.key).join(', '));
await browser.close();
