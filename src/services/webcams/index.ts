import { getRpcBaseUrl } from '@/services/rpc-client';
// Raw token constants (not var(--…)): consumers append hex alpha digits
// (e.g. `${color}33` in GlobeMap), which requires literal #rrggbb values.
import { CATEGORY, NEUTRAL } from '@/styles/tokens';
import type { WebcamEntry, WebcamCluster, ListWebcamsResponse, GetWebcamImageResponse } from '@/generated/client/worldmonitor/webcam/v1/service_client';
import { WebcamServiceClient } from '@/services/generated-rpc-clients';

const client = new WebcamServiceClient(getRpcBaseUrl(), {
  fetch: (...args) => globalThis.fetch(...args),
});

const emptyResponse: ListWebcamsResponse = { webcams: [], clusters: [], totalInView: 0 };

// Client-side image cache (9 min, under Windy's 10-min token expiry)
const IMAGE_CACHE_MS = 9 * 60 * 1000;
const IMAGE_CACHE_MAX = 200;
const imageCacheMap = new Map<string, { data: GetWebcamImageResponse; expires: number }>();

export async function fetchWebcams(
  zoom: number,
  bounds: { w: number; s: number; e: number; n: number },
): Promise<ListWebcamsResponse> {
  try {
    return await client.listWebcams({
      zoom,
      boundW: bounds.w,
      boundS: bounds.s,
      boundE: bounds.e,
      boundN: bounds.n,
    });
  } catch (err) {
    console.warn('[webcams] fetch failed:', err);
    return emptyResponse;
  }
}

export async function fetchWebcamImage(webcamId: string): Promise<GetWebcamImageResponse> {
  // Check client cache
  const cached = imageCacheMap.get(webcamId);
  if (cached && cached.expires > Date.now()) return cached.data;

  try {
    const result = await client.getWebcamImage({ webcamId });
    if (!result.error) {
      if (imageCacheMap.size >= IMAGE_CACHE_MAX) {
        const oldest = imageCacheMap.keys().next().value;
        if (oldest) imageCacheMap.delete(oldest);
      }
      imageCacheMap.set(webcamId, { data: result, expires: Date.now() + IMAGE_CACHE_MS });
    }
    return result;
  } catch (err) {
    console.warn('[webcams] image fetch failed:', err);
    return {
      thumbnailUrl: '', playerUrl: '', title: '',
      windyUrl: `https://www.windy.com/webcams/${webcamId}`,
      lastUpdated: '', error: 'unavailable',
    };
  }
}

// Category mapping for marker rendering
export const WEBCAM_CATEGORIES: Record<string, { color: string; emoji: string }> = {
  traffic:   { color: CATEGORY.gold, emoji: '\u{1F697}' },    // 🚗
  city:      { color: CATEGORY.blue, emoji: '\u{1F3D9}\uFE0F' }, // 🏙️
  landscape: { color: CATEGORY.aqua, emoji: '\u{1F3D4}\uFE0F' }, // 🏔️
  nature:    { color: CATEGORY.green, emoji: '\u{1F33F}' },    // 🌿
  beach:     { color: CATEGORY.orange, emoji: '\u{1F3D6}\uFE0F' }, // 🏖️
  water:     { color: CATEGORY.violet, emoji: '\u{1F30A}' },    // 🌊
  other:     { color: NEUTRAL.slate, emoji: '\u{1F4F7}' },    // 📷
};

export function getClusterCellSize(zoom: number): number {
  if (zoom < 3) return 8;
  if (zoom <= 4) return 5;
  if (zoom <= 6) return 2;
  if (zoom <= 8) return 0.5;
  return 0.5;
}

export function getCategoryStyle(category: string) {
  return WEBCAM_CATEGORIES[category] ?? WEBCAM_CATEGORIES.other!;
}

export type { WebcamEntry, WebcamCluster, GetWebcamImageResponse };
