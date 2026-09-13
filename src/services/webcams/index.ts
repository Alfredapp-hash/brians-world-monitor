import { getRpcBaseUrl } from '@/services/rpc-client';
import { ensureHydrated } from '@/services/bootstrap';
// Raw token constants (not var(--…)): consumers append hex alpha digits
// (e.g. `${color}33` in GlobeMap), which requires literal #rrggbb values.
import { CATEGORY, NEUTRAL } from '@/styles/tokens';
import type { WebcamEntry, WebcamCluster, ListWebcamsResponse, GetWebcamImageResponse } from '@/generated/client/worldmonitor/webcam/v1/service_client';
import { WebcamServiceClient } from '@/services/generated-rpc-clients';
import { classifyWebcamStreamUrl, type WebcamStream } from '@/services/webcams/stream-player';

const client = new WebcamServiceClient(getRpcBaseUrl(), {
  fetch: (...args) => globalThis.fetch(...args),
});

const emptyResponse: ListWebcamsResponse = { webcams: [], clusters: [], totalInView: 0 };

// Client-side image cache (9 min, under Windy's 10-min token expiry)
const IMAGE_CACHE_MS = 9 * 60 * 1000;
const IMAGE_CACHE_MAX = 200;
const imageCacheMap = new Map<string, { data: GetWebcamImageResponse; expires: number }>();

/**
 * Which openly published sources are currently answering, and what each asks to
 * be credited as. Seeded by `scripts/seed-public-cameras.mjs`.
 */
export interface PublicCameraCoverage {
  sources: Array<{ id: string; label: string; operator: string; attribution: string; cameraCount: number; available: boolean }>;
  totalCameras: number;
  availableSources: number;
  attributions: string[];
  fetchedAt: string;
}

let coverage: PublicCameraCoverage | null | undefined;

/**
 * Coverage manifest for the public camera sources.
 *
 * `publicCameras` is an on-demand bootstrap key, for the same reason
 * `cyberThreats` is: the webcam layer is off by default in every variant, so
 * putting this in a tier bundle would ship it to every visitor to describe a
 * layer most of them never turn on. Callers reach here only after the layer is
 * engaged, so the per-key CDN-shielded fetch happens then.
 *
 * Returns null when the manifest has not been seeded — coverage is unknown, not
 * zero, and the layer's markers do not depend on it either way.
 */
export async function getPublicCameraCoverage(): Promise<PublicCameraCoverage | null> {
  if (coverage !== undefined) return coverage;
  try {
    const hydrated = (await ensureHydrated('publicCameras')) as PublicCameraCoverage | undefined;
    coverage = hydrated?.sources?.length ? hydrated : null;
  } catch {
    coverage = null;
  }
  return coverage;
}

export async function fetchWebcams(
  zoom: number,
  bounds: { w: number; s: number; e: number; n: number },
): Promise<ListWebcamsResponse> {
  // Warm the coverage manifest alongside the first viewport read, so the layer
  // can report which agencies are answering without a second round trip later.
  void getPublicCameraCoverage();
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

/**
 * Where a camera comes from, for the popup's link label and credit line.
 *
 * Windy is one provider among several now: the layer also carries cameras that
 * transport authorities publish as open data with no credential at all (see
 * `server/worldmonitor/webcam/v1/public-cameras.ts`). Those arrive with a
 * `pub-<shard>-<id>` identifier, and crediting them to Windy would be wrong on
 * both the attribution and the "open at source" link.
 */
export interface WebcamSourceInfo {
  /** Text for the outbound link, e.g. 'Open on Windy'. */
  linkLabel: string;
  /** Credit line the operator asks for. */
  attribution: string;
  /** True when no API key is involved — the operator publishes this openly. */
  isPublicSource: boolean;
}

const WINDY_SOURCE: WebcamSourceInfo = {
  linkLabel: 'Open on Windy \u2197',
  attribution: 'Powered by Windy',
  isPublicSource: false,
};

/** Keyed by the shard segment of a public camera id. */
const PUBLIC_SOURCE_ATTRIBUTION: Record<string, string> = {
  tfllondon: 'Powered by TfL Open Data',
  nycdot: 'NYC DOT Traffic Management Center',
};

export function isPublicCameraId(webcamId: string | null | undefined): boolean {
  return typeof webcamId === 'string' && /^pub-[a-z0-9]+-/.test(webcamId);
}

export function getWebcamSource(webcamId: string | null | undefined): WebcamSourceInfo {
  if (!isPublicCameraId(webcamId)) return WINDY_SOURCE;
  const shard = webcamId!.split('-')[1] ?? '';
  const attribution = shard.startsWith('caltransd')
    ? `Caltrans District ${Number(shard.slice('caltransd'.length))} \u2014 California DOT open data`
    : PUBLIC_SOURCE_ATTRIBUTION[shard] ?? 'Public agency open data';
  return { linkLabel: 'Open at source \u2197', attribution, isPublicSource: true };
}

/**
 * The outbound link for a camera. Public cameras carry their operator's page in
 * the response; only Windy ids can be turned into a URL without one, because
 * their public page is a deterministic function of the id.
 */
export function getWebcamSourceUrl(webcamId: string, response?: { windyUrl?: string }): string {
  if (response?.windyUrl) return response.windyUrl;
  if (isPublicCameraId(webcamId)) return '';
  return `https://www.windy.com/webcams/${encodeURIComponent(webcamId)}`;
}

/**
 * The playable stream for a camera, or null when there isn't one.
 *
 * Two gates, both needed. The id must be a public-agency camera, because
 * `playerUrl` means different things per provider: the agencies put a media file
 * there, Windy puts an embeddable timelapse *page* there (and their cameras are
 * periodic stills, so there is no live feed to play in the first place). The URL
 * must then name a container a media element can decode — see
 * `classifyWebcamStreamUrl`.
 *
 * NYC DOT publishes stills only, so its cameras fall out here on the second
 * gate and keep the still-only popup they already had.
 */
export function getWebcamStream(
  webcamId: string,
  response: { playerUrl?: string } | null | undefined,
): WebcamStream | null {
  if (!isPublicCameraId(webcamId)) return null;
  return classifyWebcamStreamUrl(response?.playerUrl);
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
      // A failed lookup must not send a public-agency camera to a Windy page
      // that was never going to have it.
      windyUrl: getWebcamSourceUrl(webcamId),
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
export { createWebcamPlayer, classifyWebcamStreamUrl } from '@/services/webcams/stream-player';
export type { WebcamStream, WebcamPlayerHandle, WebcamPlaybackFailure } from '@/services/webcams/stream-player';
