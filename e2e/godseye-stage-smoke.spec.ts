/**
 * God's Eye stage smoke: enter, compose, and exit with exact restore.
 *
 * The stage is an orthogonal axis to reader mode: entering it snapshots the
 * three durable preferences it rewrites (reader mode, map dimension, mission
 * preset) and exiting must put all three back exactly as they were. These
 * tests assert that contract from both Everyday and Analyst, because a leak in
 * either direction silently rewrites a user's saved layout.
 *
 * Local note (Windows agents): requires Playwright Chromium
 * (`npx playwright install chromium`). If browsers are missing, this file
 * still documents the contract; CI Linux runners install browsers via the
 * usual Playwright setup.
 */
import { expect, test, type Page } from '@playwright/test';

const STAGE_MODE_KEY = 'jsam-stage-mode';
const STAGE_RESTORE_KEY = 'jsam-stage-restore-v1';
const MISSION_KEY = 'worldmonitor-mission-preset-v1';
const MAP_MODE_KEY = 'worldmonitor-map-mode';

const SEED_GUARD_KEY = '__wm_e2e_godseye_seeded';

/**
 * Quiet the first-run nags so the stage control is reachable immediately.
 *
 * Guarded, because init scripts re-run on every navigation and these tests
 * navigate by reload: an unguarded `localStorage.clear()` would wipe the very
 * stage preference the click under test just wrote.
 */
function seedStorage(page: Page, readerMode: 'everyday' | 'analyst'): Promise<void> {
  return page.addInitScript(
    ({ mode, guard }) => {
      try {
        if (localStorage.getItem(guard)) return;
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem(guard, '1');
      } catch {
        /* storage may be unavailable in some harnesses */
      }
      localStorage.setItem('worldmonitor-variant', 'full');
      localStorage.setItem('jsam-view-mode', mode);
      localStorage.setItem('jsam-everyday-seeded-v1', '1');
      localStorage.setItem('wm-layer-warning-dismissed', 'true');
      localStorage.setItem('wm-pro-banner-launched-dismissed', String(Date.now()));
      localStorage.setItem('worldmonitor-mission-preset-dismissed-v1', '1');
    },
    { mode: readerMode, guard: SEED_GUARD_KEY },
  );
}

async function waitForEventHandlers(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.wmEventHandlersReady === 'true', null, {
    timeout: 60_000,
  });
}

function readStorage(page: Page, key: string): Promise<string | null> {
  return page.evaluate((k) => localStorage.getItem(k), key);
}

/**
 * The header keeps reflowing while panels hydrate (mission control and the
 * freshness chips appear late and shift their neighbours), so Playwright's
 * stability check can spin indefinitely on a button that is perfectly
 * clickable. Same force-click workaround as e2e/everyday-reader-smoke.spec.ts.
 */
async function clickWhenPresent(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector);
  await expect(target).toBeVisible({ timeout: 45_000 });
  // Dispatched on the element itself rather than at its centre point: the
  // analyst header packs the stage control right next to the density toggle,
  // which also reloads, so a coordinate click that drifts by a few pixels
  // navigates and silently tests the wrong control.
  await target.evaluate((el) => (el as HTMLElement).click());
}

/**
 * Entering and leaving the stage both reload, because the boot path is what
 * reads the three durable preferences. Wait for the navigation to commit before
 * asserting anything — otherwise `wmEventHandlersReady` is still `true` from
 * the outgoing document and the assertions race the old DOM.
 */
async function clickAndAwaitStage(
  page: Page,
  selector: string,
  expected: 'godseye' | 'dashboard',
): Promise<void> {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60_000 }),
    clickWhenPresent(page, selector),
  ]);

  // index.html applies the stage pre-paint, so this settles before hydration.
  await page.waitForFunction(
    (want) =>
      (document.documentElement.dataset.stageMode ?? 'dashboard') === want,
    expected,
    { timeout: 60_000 },
  );
  await waitForEventHandlers(page);
}

test.describe("God's Eye stage smoke", () => {
  test('entering from Everyday forces the globe stage and exiting restores Everyday', async ({ page }) => {
    await seedStorage(page, 'everyday');
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForEventHandlers(page);

    await expect(page.locator('html')).toHaveAttribute('data-reader-mode', 'everyday');
    await expect(page.locator('html')).not.toHaveAttribute('data-stage-mode', 'godseye');

    await clickAndAwaitStage(page, '#godseyeEnterBtn', 'godseye');
    await expect(page.locator('html')).toHaveAttribute('data-stage-mode', 'godseye');
    await expect(page.locator('.godseye-hud')).toBeVisible({ timeout: 45_000 });

    // The stage forces analyst density, the globe renderer, and its own preset.
    await expect(page.locator('html')).toHaveAttribute('data-reader-mode', 'analyst');
    expect(await readStorage(page, MISSION_KEY)).toBe('gods-eye');
    expect(await readStorage(page, MAP_MODE_KEY)).toBe(JSON.stringify('globe'));

    // The pre-entry state is parked for exit, not thrown away.
    const restore = await readStorage(page, STAGE_RESTORE_KEY);
    expect(restore).toBeTruthy();
    expect(JSON.parse(restore!).readerMode).toBe('everyday');

    // The header control is suppressed inside the stage — the HUD owns exit.
    await expect(page.locator('#godseyeEnterBtn')).toHaveCount(0);

    await clickAndAwaitStage(page, '.godseye-hud__btn--exit', 'dashboard');
    await expect(page.locator('html')).toHaveAttribute('data-reader-mode', 'everyday');
    await expect(page.locator('html')).not.toHaveAttribute('data-stage-mode', 'godseye');
    await expect(page.locator('.godseye-hud')).toHaveCount(0);
    await expect(page.locator('#godseyeEnterBtn')).toBeVisible();

    // The stage must not leave its own preset or renderer behind.
    expect(await readStorage(page, MISSION_KEY)).not.toBe('gods-eye');
    expect(await readStorage(page, MAP_MODE_KEY)).toBeNull();
    expect(await readStorage(page, STAGE_RESTORE_KEY)).toBeNull();
    expect(await readStorage(page, STAGE_MODE_KEY)).toBe('dashboard');
  });

  test('exiting restores Analyst rather than defaulting to Everyday', async ({ page }) => {
    await seedStorage(page, 'analyst');
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForEventHandlers(page);

    await expect(page.locator('html')).toHaveAttribute('data-reader-mode', 'analyst');

    await clickAndAwaitStage(page, '#godseyeEnterBtn', 'godseye');
    await expect(page.locator('.godseye-hud')).toBeVisible({ timeout: 45_000 });

    const restore = await readStorage(page, STAGE_RESTORE_KEY);
    expect(JSON.parse(restore!).readerMode).toBe('analyst');

    await clickAndAwaitStage(page, '.godseye-hud__btn--exit', 'dashboard');

    await expect(page.locator('html')).toHaveAttribute('data-reader-mode', 'analyst');
    await expect(page.locator('html')).not.toHaveAttribute('data-stage-mode', 'godseye');
    // An analyst who had no preset must not inherit the stage's preset.
    expect(await readStorage(page, MISSION_KEY)).toBeNull();
  });

  test('the stage gives the globe the full frame and demotes panels to a rail', async ({ page }) => {
    await seedStorage(page, 'analyst');
    await page.goto('/?godseye=1', { waitUntil: 'domcontentloaded' });
    await waitForEventHandlers(page);

    await expect(page.locator('html')).toHaveAttribute('data-stage-mode', 'godseye');
    await expect(page.locator('.godseye-hud')).toBeVisible({ timeout: 45_000 });

    // Globe-as-protagonist: the map stage fills essentially the whole viewport.
    const coverage = await page.evaluate(() => {
      const section = document.querySelector('.map-section');
      if (!section) return null;
      const rect = section.getBoundingClientRect();
      return { widthRatio: rect.width / window.innerWidth, heightRatio: rect.height / window.innerHeight };
    });
    expect(coverage).not.toBeNull();
    expect(coverage!.widthRatio).toBeGreaterThan(0.98);
    expect(coverage!.heightRatio).toBeGreaterThan(0.85);

    // Dashboard chrome that would break the composition stays hidden.
    await expect(page.locator('.map-resize-handle')).toBeHidden();

    // The HUD's telemetry is real, not decorative: the bottom-left corner
    // carries the view centre and the named camera scale.
    const scaleReadout = page.locator('.godseye-hud__corner--bl .godseye-hud__readout').nth(1);
    await expect(scaleReadout).toHaveText(/ORBITAL|CONTINENTAL|REGIONAL|THEATRE|LOCAL/);

    // Panels are still present and toggleable — demoted, not deleted.
    const rail = page.locator('#panelsGrid');
    await expect(rail).toBeVisible();
    await page.locator('.godseye-hud__btn', { hasText: 'Panels' }).click({ force: true });
    await expect(page.locator('html')).toHaveClass(/ge-rail-hidden/);
    await expect(rail).toBeHidden();
  });

  test('the stage rail is the preset’s curated read, not the whole dashboard', async ({ page }) => {
    await seedStorage(page, 'analyst');
    await page.goto('/?godseye=1', { waitUntil: 'domcontentloaded' });
    await waitForEventHandlers(page);
    await expect(page.locator('.godseye-hud')).toBeVisible({ timeout: 45_000 });

    // The stage applies its own mission bundle transiently. Before that landed
    // the rail inherited every panel the reader had enabled — tens of thousands
    // of pixels of empty deferred shells stacked in a single column.
    const railItems = page.locator('#panelsGrid > [data-panel]:not(.hidden)');
    expect(await railItems.count()).toBeLessThanOrEqual(8);
    expect(await page.locator('#panelsGrid .panel-deferred-shell').count()).toBeLessThanOrEqual(4);

    // Whatever shells remain must not each carry a blur: `.panels-grid .panel`
    // matches `.panel-deferred-shell` too, so the glass rule was handing a
    // compositing surface to every unmounted placeholder.
    const shellBlur = await page.evaluate(() => {
      const shell = document.querySelector('#panelsGrid .panel-deferred-shell');
      if (!shell) return 'none';
      return getComputedStyle(shell).backdropFilter || 'none';
    });
    expect(shellBlur).toBe('none');

    // And the HUD's layer count describes the stage rather than the dashboard.
    const status = page.locator('.godseye-hud__corner--br .godseye-hud__readout').last();
    await expect(status).toHaveText(/(LIVE|OFFLINE) · \d+ LAYERS?|ACQUIRING SIGNAL/);

    // The bundle is transient: the reader's stored layout was never rewritten.
    expect(await readStorage(page, 'panel-order')).toBeNull();
  });

  test('the stage frames the whole Earth rather than inheriting a city zoom', async ({ page }) => {
    await seedStorage(page, 'analyst');
    // Land on a street-level camera first, then engage from there.
    await page.goto('/?lat=34.0522&lon=-118.2437&zoom=7', { waitUntil: 'domcontentloaded' });
    await waitForEventHandlers(page);

    await clickAndAwaitStage(page, '#godseyeEnterBtn', 'godseye');
    await expect(page.locator('.godseye-hud')).toBeVisible({ timeout: 45_000 });

    // The scale band is read straight off the camera altitude, so an inherited
    // city zoom would show as LOCAL/THEATRE instead of a whole-Earth view.
    const scaleReadout = page.locator('.godseye-hud__corner--bl .godseye-hud__readout').nth(1);
    await expect(scaleReadout).toHaveText(/ORBITAL|CONTINENTAL/, { timeout: 45_000 });
  });

  test('?godseye=1 survives the map’s URL sync so the address bar stays shareable', async ({ page }) => {
    await seedStorage(page, 'analyst');
    await page.goto('/?godseye=1', { waitUntil: 'domcontentloaded' });
    await waitForEventHandlers(page);
    await expect(page.locator('.godseye-hud')).toBeVisible({ timeout: 45_000 });

    // The debounced sync replaceStates the map's camera into the URL 250ms
    // after any movement. It used to rebuild the query from origin+pathname,
    // which deleted the stage parameter and made the address bar un-shareable.
    await page.waitForFunction(() => new URLSearchParams(location.search).has('lat'), null, {
      timeout: 45_000,
    });
    const search = new URLSearchParams(new URL(page.url()).search);
    expect(search.get('godseye')).toBe('1');
  });

  test('exit strips ?godseye so a reload cannot walk back into the stage', async ({ page }) => {
    await seedStorage(page, 'analyst');
    await page.goto('/?godseye=1', { waitUntil: 'domcontentloaded' });
    await waitForEventHandlers(page);
    await expect(page.locator('.godseye-hud')).toBeVisible({ timeout: 45_000 });

    await clickAndAwaitStage(page, '.godseye-hud__btn--exit', 'dashboard');

    // Exit used to be releaseGodsEyeStage() + reload(), which re-requested the
    // same `?godseye=1` URL — and the parameter outranks stored state, so the
    // stage re-engaged. That is the trap this assertion guards.
    expect(new URL(page.url()).searchParams.has('godseye')).toBe(false);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForEventHandlers(page);
    await expect(page.locator('html')).not.toHaveAttribute('data-stage-mode', 'godseye');
    await expect(page.locator('#godseyeEnterBtn')).toBeVisible();
  });

  test('exit gives the reader their camera back instead of the stage’s', async ({ page }) => {
    await seedStorage(page, 'analyst');
    await page.goto('/?lat=34.0522&lon=-118.2437&zoom=7&view=america', { waitUntil: 'domcontentloaded' });
    await waitForEventHandlers(page);

    await clickAndAwaitStage(page, '#godseyeEnterBtn', 'godseye');
    await expect(page.locator('.godseye-hud')).toBeVisible({ timeout: 45_000 });

    await clickAndAwaitStage(page, '.godseye-hud__btn--exit', 'dashboard');

    // The stage frames itself at the preset's global view (lon 0), so a camera
    // still in the western hemisphere is proof the reader's own position came
    // back rather than the stage's framing being handed to them.
    const search = new URL(page.url()).searchParams;
    expect(search.has('lat')).toBe(true);
    expect(Number(search.get('lon'))).toBeLessThan(0);
  });

  test('the ?godseye=0 override wins over a stored stage preference', async ({ page }) => {
    await seedStorage(page, 'analyst');
    await page.addInitScript(
      ({ key }) => {
        localStorage.setItem(key, 'godseye');
      },
      { key: STAGE_MODE_KEY },
    );

    await page.goto('/?godseye=0', { waitUntil: 'domcontentloaded' });
    await waitForEventHandlers(page);

    await expect(page.locator('html')).not.toHaveAttribute('data-stage-mode', 'godseye');
    await expect(page.locator('.godseye-hud')).toHaveCount(0);
    await expect(page.locator('#godseyeEnterBtn')).toBeVisible();
  });
});
