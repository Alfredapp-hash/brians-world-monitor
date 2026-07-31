import { SEVERITY, hexToRgb } from '@/styles/tokens';

export type CiiLevel = 'low' | 'normal' | 'elevated' | 'high' | 'critical';

const level = (hex: string, alpha: number): [number, number, number, number] => {
  const [r, g, b] = hexToRgb(hex);
  return [r, g, b, alpha];
};

/**
 * CII choropleth fills ride the shared severity ladder (calm → critical)
 * with rising opacity, so the map, the CII legend gradient, and panel
 * badges all share one encoding.
 */
export const CII_LEVEL_COLORS: Record<CiiLevel, [number, number, number, number]> = {
  low: level(SEVERITY.s1, 130),
  normal: level(SEVERITY.s2, 135),
  elevated: level(SEVERITY.s3, 145),
  high: level(SEVERITY.s4, 155),
  critical: level(SEVERITY.s5, 170),
};
