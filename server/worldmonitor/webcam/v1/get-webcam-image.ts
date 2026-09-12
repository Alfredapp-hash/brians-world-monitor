import type { GetWebcamImageRequest, GetWebcamImageResponse, ServerContext } from '../../../../src/generated/server/worldmonitor/webcam/v1/service_server';
import { cachedFetchJson } from '../../../_shared/redis';
import { findPublicCamera, isPublicCameraId } from './public-cameras';

const WINDY_BASE = 'https://api.windy.com/webcams/api/v3/webcams';
const CACHE_TTL = 300;

const WEBCAM_ID_RE = /^[\w-]+$/;

/**
 * Resolve a keyless public camera.
 *
 * The operator already serves the still and the stream to the public web, so
 * this returns their URLs directly instead of proxying bytes through us. The
 * proto's `windyUrl` field carries the operator's own page — the response shape
 * predates there being more than one provider, and the client reads it as
 * "where this camera lives", which is exactly what it is here.
 */
async function getPublicCameraImage(webcamId: string): Promise<GetWebcamImageResponse> {
  const camera = await findPublicCamera(webcamId);
  if (!camera) {
    return { thumbnailUrl: '', playerUrl: '', title: '', windyUrl: '', lastUpdated: '', error: 'unavailable' };
  }
  return {
    thumbnailUrl: camera.stillUrl,
    playerUrl: camera.streamUrl,
    title: camera.title,
    windyUrl: camera.sourceUrl,
    // Stills are overwritten in place at the operator's own cadence and carry
    // no capture timestamp, so claiming one would be inventing freshness.
    lastUpdated: '',
    error: '',
  };
}

export async function getWebcamImage(_ctx: ServerContext, req: GetWebcamImageRequest): Promise<GetWebcamImageResponse> {
  const { webcamId } = req;
  const windyUrl = `https://www.windy.com/webcams/${encodeURIComponent(webcamId || '')}`;

  if (!webcamId || !WEBCAM_ID_RE.test(webcamId)) {
    return { thumbnailUrl: '', playerUrl: '', title: '', windyUrl, lastUpdated: '', error: 'missing webcam_id' };
  }

  if (isPublicCameraId(webcamId)) return getPublicCameraImage(webcamId);

  const apiKey = process.env.WINDY_API_KEY;
  if (!apiKey) {
    return { thumbnailUrl: '', playerUrl: '', title: '', windyUrl, lastUpdated: '', error: 'unavailable' };
  }

  const result = await cachedFetchJson<GetWebcamImageResponse>(
    `webcam:image:${webcamId}`,
    CACHE_TTL,
    async () => {
      const resp = await fetch(`${WINDY_BASE}/${encodeURIComponent(webcamId)}?include=images,urls`, {
        headers: { 'x-windy-api-key': apiKey },
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return null;

      const data = await resp.json();
      const wc = data.webcams?.[0] ?? data;
      const images = wc.images || wc.image || {};
      const urls = wc.urls || {};

      return {
        thumbnailUrl: images.current?.preview || images.current?.thumbnail || '',
        playerUrl: urls.player || '',
        title: wc.title || '',
        windyUrl,
        lastUpdated: wc.lastUpdatedOn ? new Date(wc.lastUpdatedOn).toISOString() : '',
        error: '',
      };
    },
  );

  return result ?? { thumbnailUrl: '', playerUrl: '', title: '', windyUrl, lastUpdated: '', error: 'unavailable' };
}
