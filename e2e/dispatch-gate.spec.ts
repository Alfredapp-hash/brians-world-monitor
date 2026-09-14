/**
 * First-visit Dispatch gate: overlay on a visual God's Eye globe, then dashboard.
 *
 * Playwright's webServer sets VITE_E2E=1, which skips the gate for every other
 * spec. This file forces the overlay with `?tpd_gate=1` and does not seed
 * `tpd-dispatch-entered-v1`.
 *
 * Local note (Windows agents): requires Playwright Chromium
 * (`npx playwright install chromium`). If browsers are missing, this file
 * still documents the contract.
 */
import { expect, test, type Page } from '@playwright/test';

const ENTERED_KEY = 'tpd-dispatch-entered-v1';
const LOCATION_KEY = 'tpd-home-location-v1';
const STAGE_MODE_KEY = 'jsam-stage-mode';

async function seedFresh(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* storage may be unavailable in some harnesses */
    }
    localStorage.setItem('worldmonitor-variant', 'full');
    localStorage.setItem('wm-layer-warning-dismissed', 'true');
    localStorage.setItem('wm-pro-banner-launched-dismissed', String(Date.now()));
    localStorage.setItem('worldmonitor-mission-preset-dismissed-v1', '1');
  });
}

async function waitForEventHandlers(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.wmEventHandlersReady === 'true', null, {
    timeout: 60_000,
  });
}

function readStorage(page: Page, key: string): Promise<string | null> {
  return page.evaluate((k) => localStorage.getItem(k), key);
}

test.describe('Dispatch gate', () => {
  test('fresh storage shows the overlay on a visual God\'s Eye stage', async ({ page }) => {
    await seedFresh(page);
    await page.goto('/?tpd_gate=1', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('html')).toHaveAttribute('data-stage-mode', 'godseye');
    await expect(page.locator('html')).toHaveAttribute('data-dispatch-gate', 'open');
    await expect(page.locator('#dispatchGate')).toBeVisible({ timeout: 45_000 });
    await expect(page.locator('#dispatchGateEnterBtn')).toHaveText('Enter The Dispatch');
    expect(await readStorage(page, STAGE_MODE_KEY)).not.toBe('godseye');
  });

  test('guest without a postal code enters the dashboard', async ({ page }) => {
    await seedFresh(page);
    await page.goto('/?tpd_gate=1', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#dispatchGateEnterBtn')).toBeVisible({ timeout: 45_000 });

    await page.locator('#dispatchGateEnterBtn').click();

    await expect(page.locator('#dispatchGate')).toHaveCount(0, { timeout: 20_000 });
    await expect(page.locator('html')).not.toHaveAttribute('data-dispatch-gate', 'open');
    await expect(page.locator('html')).not.toHaveAttribute('data-stage-mode', 'godseye');
    expect(await readStorage(page, ENTERED_KEY)).toBe('1');
    expect(await readStorage(page, STAGE_MODE_KEY)).not.toBe('godseye');

    const stored = await readStorage(page, LOCATION_KEY);
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!).source).toBe('skipped');
  });

  test('guest with a known US ZIP proceeds after lookup', async ({ page }) => {
    await seedFresh(page);
    await page.route('**/api/postal-lookup**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          lat: 40.7506,
          lon: -73.9971,
          country: 'United States',
          code: 'US',
          postal: '10001',
          displayName: 'New York, NY 10001',
        }),
      });
    });

    await page.goto('/?tpd_gate=1', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#dispatchGatePostal')).toBeVisible({ timeout: 45_000 });
    await page.locator('#dispatchGatePostal').fill('10001');
    await page.locator('#dispatchGateEnterBtn').click();

    await expect(page.locator('#dispatchGate')).toHaveCount(0, { timeout: 20_000 });
    expect(await readStorage(page, ENTERED_KEY)).toBe('1');
    const stored = await readStorage(page, LOCATION_KEY);
    expect(stored).toBeTruthy();
    const location = JSON.parse(stored!);
    expect(location.source).toBe('postal');
    expect(location.postal).toBe('10001');
    expect(location.lat).toBeCloseTo(40.7506, 3);
    await waitForEventHandlers(page);
    await expect(page.locator('html')).not.toHaveAttribute('data-stage-mode', 'godseye');
  });
});
