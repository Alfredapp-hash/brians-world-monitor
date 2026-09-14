/**
 * Everyday first-paint + deepen-path smoke.
 * Seeds a fresh Everyday install, asserts hero/brief chrome, then opens
 * progressive disclosure (coverage framing) without requiring live APIs.
 *
 * Local note (Windows agents): requires Playwright Chromium
 * (`npx playwright install chromium`). If browsers are missing, this file
 * still documents the contract; CI Linux runners install browsers via the
 * usual Playwright setup.
 */
import { expect, test, type Page } from '@playwright/test';

async function seedEverydayFresh(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* storage may be unavailable in some harnesses */
    }
    localStorage.setItem('worldmonitor-variant', 'full');
    localStorage.setItem('tpd-dispatch-entered-v1', '1');
    localStorage.setItem('jsam-view-mode', 'everyday');
    localStorage.setItem('jsam-everyday-seeded-v1', '1');
    localStorage.setItem('wm-layer-warning-dismissed', 'true');
    localStorage.setItem('wm-pro-banner-launched-dismissed', String(Date.now()));
    localStorage.setItem('worldmonitor-mission-preset-dismissed-v1', '1');
  });
}

async function seedAnalystCustom(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
    localStorage.setItem('worldmonitor-variant', 'full');
    localStorage.setItem('tpd-dispatch-entered-v1', '1');
    localStorage.setItem('jsam-view-mode', 'analyst');
    localStorage.setItem('jsam-everyday-seeded-v1', '1');
    localStorage.setItem('panel-order', '["insights","politics"]');
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

test.describe('Everyday reader smoke', () => {
  test('Analyst boot shell does not flash Everyday brief copy', async ({ page }) => {
    await seedAnalystCustom(page);
    // Hold the dashboard bundle so the pre-hydration skeleton stays observable
    // (same pattern as e2e/prehydration-shell.spec.ts).
    let releaseMain!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseMain = resolve;
    });
    await page.route('**/src/main.ts', async (route) => {
      await hold;
      await route.continue();
    });

    await page.goto('/', { waitUntil: 'commit' });
    await expect(page.locator('html')).toHaveAttribute('data-reader-mode', 'analyst');
    await expect(page.locator('.skeleton-shell')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.skeleton-shell .shell-copy--everyday.skeleton-map-title')).toBeHidden();
    await expect(page.locator('.skeleton-shell .shell-copy--analyst.skeleton-map-title')).toBeVisible();
    await expect(page.locator('.skeleton-shell .shell-copy--analyst.skeleton-map-title')).toContainText(/dashboard/i);
    await expect(page.locator('.skeleton-shell .shell-mode-chip--everyday')).toBeHidden();
    await expect(page.locator('.skeleton-shell .shell-mode-chip--analyst')).toBeVisible();
    await expect(page.locator('.skeleton-shell .shell-copy--everyday.skeleton-kicker')).toBeHidden();
    await expect(page.locator('.skeleton-shell .shell-copy--analyst.skeleton-kicker')).toHaveText(/Dashboard loading/i);
    releaseMain();
  });

  test('Everyday first paint: hero, More overflow, core panels', async ({ page }) => {
    await seedEverydayFresh(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForEventHandlers(page);

    await expect(page.locator('html')).toHaveAttribute('data-reader-mode', 'everyday');
    await expect(page.locator('.reader-hero')).toBeVisible({ timeout: 45_000 });
    await expect(page.locator('.header .logo')).toHaveText('TPD');
    await expect(page.locator('.header .logo-full')).toHaveText('The Public Dispatch');
    await expect(page.locator('.site-footer .logo')).toHaveText('TPD');
    await expect(page.locator('.reader-hero__brand')).toHaveCount(1);
    await expect(page.locator('#hamburgerBtn')).toBeVisible();
    await expect(page.locator('#hamburgerBtn')).toHaveAttribute('aria-label', 'More');
    await expect(page.locator('#hamburgerBtn .hamburger-btn__label')).toHaveText('More');
    await expect(page.locator('#readerDisclose')).toBeVisible();
    await expect(page.locator('#panelsGrid .panel[data-panel="insights"]')).toBeVisible({ timeout: 45_000 });
  });

  test('deepen path: How outlets frame this hides AI/Discord on toolbar', async ({ page }) => {
    await seedEverydayFresh(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForEventHandlers(page);

    await expect(page.locator('html')).toHaveAttribute('data-reader-mode', 'everyday');

    const framingBtn = page.locator('#readerDiscloseFraming, [data-reader-disclose="coverage-compare"]').first();
    await expect(framingBtn).toBeVisible({ timeout: 30_000 });
    await framingBtn.scrollIntoViewIfNeeded();
    // Panels grid loaders can sit above the disclose bar in the hit-test order.
    await framingBtn.click({ force: true });

    await expect(page.locator('html')).toHaveClass(/reader-analyst-open/);
    await expect(page.locator('#panelsGrid .panel[data-panel="coverage-compare"]')).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.locator('.panel[data-panel="coverage-compare"] .panel-title')).toContainText(
      /How outlets frame this/i,
    );

    const cc = page.locator('.cc-content--everyday');
    await expect(cc).toBeVisible({ timeout: 30_000 });
    await expect(cc.locator('> .cc-toolbar .cc-ai-status')).toHaveCount(0);
    await expect(cc.locator('> .cc-toolbar .cc-alerts-btn')).toHaveCount(0);
    await expect(cc.locator('.cc-method-summary')).toContainText(/Scoring, AI & alerts/i);
  });
});
