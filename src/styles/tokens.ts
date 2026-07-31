/**
 * JSA's Monitor — TypeScript design tokens.
 *
 * Single source of truth for color in draw contexts (canvas, WebGL,
 * globe.gl, deck.gl) that cannot read CSS custom properties. The BRAND
 * and STATUS values MIRROR the custom properties in
 * `src/styles/brians-theme.css` — a sync test
 * (`tests/tokens-css-sync.test.mts`) fails the build if they drift.
 *
 * Rules of use:
 *  - DOM-rendered inline styles (template-string HTML) should reference
 *    the CSS custom property (`var(--accent)`) via `CSS_VAR`, so themes
 *    keep working. Use the raw constants ONLY where CSS vars can't reach
 *    (canvas/WebGL/deck.gl/globe.gl material colors, share-image
 *    renderers, OG images).
 *  - Data encodings pick from SEVERITY (ordered threat/status scale) or
 *    CATEGORY (qualitative identity). Never invent a new hex in a
 *    component; add a named token here instead.
 *  - CATEGORY hues are a CVD-validated set for dark surfaces (worst
 *    adjacent ΔE 8.4, all ≥3:1 on --bg). Assign them in the declared
 *    order for arbitrary series; for semantic layers (e.g. country
 *    attribution) pick named hues but keep one meaning per hue within a
 *    layer.
 */

/** Mirrors `:root` in brians-theme.css — sync-tested, do not edit alone. */
export const BRAND = {
  bg: '#0a0c10',
  bgSecondary: '#0f1218',
  surface: '#12161e',
  surfaceHover: '#1a2029',
  surfaceActive: '#1d2430',
  border: '#262c38',
  borderStrong: '#3a4354',
  borderSubtle: '#1a1f28',
  text: '#e9e6df',
  textSecondary: '#c9c5bb',
  textDim: '#a9a49b',
  accent: '#f0a832',
} as const;

/** Mirrors the semantic status scale in brians-theme.css — sync-tested. */
export const STATUS = {
  /** Positive/up/safe (7.5:1 on --bg). Market-up, recovery, "all clear". */
  good: '#56b273',
  info: '#6da5c9',
  watch: '#d9b64a',
  warn: '#e08a3c',
  alert: '#e05252',
} as const;

/**
 * Map/data severity scale, calm → critical. s1–s4 are the CSS status
 * scale; s5 is a brighter critical step reserved for the worst tier
 * (extreme events, total outages, level-5 escalation). Severity on maps
 * is always paired with a secondary encoding (size, label, icon or
 * popup) — never color alone.
 */
export const SEVERITY = {
  s1: STATUS.info,
  s2: STATUS.watch,
  s3: STATUS.warn,
  s4: STATUS.alert,
  s5: '#ff6b7a',
} as const;

/** Ordered severity ramp for numeric lookups (index 0 = calm). */
export const SEVERITY_RAMP = [
  SEVERITY.s1, SEVERITY.s2, SEVERITY.s3, SEVERITY.s4, SEVERITY.s5,
] as const;

/**
 * Qualitative (categorical) data palette for dark surfaces. Validated
 * as a set: lightness band, chroma floor, CVD adjacent-pair separation
 * and ≥3:1 contrast on #0a0c10 all pass in this order.
 */
export const CATEGORY = {
  blue: '#3987e5',
  orange: '#d95926',
  aqua: '#199e70',
  gold: '#c98500',
  magenta: '#d55181',
  green: '#008300',
  violet: '#9085e9',
  red: '#e66767',
} as const;

/** Fixed assignment order for arbitrary series — never cycled past 8. */
export const CATEGORY_ORDER = [
  CATEGORY.blue, CATEGORY.orange, CATEGORY.aqua, CATEGORY.gold,
  CATEGORY.magenta, CATEGORY.green, CATEGORY.violet, CATEGORY.red,
] as const;

/** Neutral marks: unknown/other/disabled encodings that must recede. */
export const NEUTRAL = {
  slate: '#8a97a8',
  slateDim: '#5c6675',
} as const;

/**
 * CSS-var references for DOM-rendered inline styles. Prefer these over
 * raw hex in template-string HTML so the cascade stays authoritative.
 */
export const CSS_VAR = {
  bg: 'var(--bg)',
  surface: 'var(--surface)',
  border: 'var(--border)',
  text: 'var(--text)',
  textSecondary: 'var(--text-secondary)',
  textDim: 'var(--text-dim)',
  accent: 'var(--accent)',
  statusGood: 'var(--status-good)',
  statusInfo: 'var(--status-info)',
  statusWatch: 'var(--status-watch)',
  statusWarn: 'var(--status-warn)',
  statusAlert: 'var(--status-alert)',
} as const;

/** `#rrggbb` + alpha (0–1) → `#rrggbbaa`. */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

/** `#rrggbb` → `[r, g, b]` for deck.gl / WebGL material colors. */
export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
