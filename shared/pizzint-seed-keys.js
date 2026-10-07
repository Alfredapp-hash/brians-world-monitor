/**
 * Canonical PizzINT Redis keys.
 *
 * The domain prefix matches the other intelligence seeds
 * (`intelligence:satellites:tle:v1`, `intelligence:wsb-tickers:v1`, …).
 * Readers, bootstrap hydration, /api/health, and the AIS relay already use
 * these strings. scripts/seed-conflict-intel.mjs used to write
 * `intel:pizzint:v1:*` instead, so the indicator never saw that seed.
 *
 * Legacy keys are a one-release read fallback only. Do not write them.
 */

export const PIZZINT_SEED_KEY = 'intelligence:pizzint:seed:v1';

/** Health and the relay heartbeat. Not the auto-stripped `seed-meta:<dataKey>`. */
export const PIZZINT_SEED_META_KEY = 'seed-meta:intelligence:pizzint';

export const PIZZINT_LEGACY_BASE_KEY = 'intel:pizzint:v1:base';
export const PIZZINT_LEGACY_GDELT_KEY = 'intel:pizzint:v1:gdelt';

/**
 * Canonical key first. Legacy keys cover Redis still holding a pre-fix
 * seed-conflict-intel write. The GDELT legacy key carries tension pairs;
 * the base key does not, so prefer it only when the caller did not ask
 * for GDELT.
 */
export function pizzintReadKeys(includeGdelt) {
  const legacy = includeGdelt
    ? [PIZZINT_LEGACY_GDELT_KEY, PIZZINT_LEGACY_BASE_KEY]
    : [PIZZINT_LEGACY_BASE_KEY, PIZZINT_LEGACY_GDELT_KEY];
  return [PIZZINT_SEED_KEY, ...legacy];
}
