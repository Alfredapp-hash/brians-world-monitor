export const PIZZINT_SEED_KEY: 'intelligence:pizzint:seed:v1';
export const PIZZINT_SEED_META_KEY: 'seed-meta:intelligence:pizzint';
export const PIZZINT_LEGACY_BASE_KEY: 'intel:pizzint:v1:base';
export const PIZZINT_LEGACY_GDELT_KEY: 'intel:pizzint:v1:gdelt';

export function pizzintReadKeys(includeGdelt: boolean): string[];
