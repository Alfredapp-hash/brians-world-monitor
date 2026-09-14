/**
 * Openly accessible public cameras — the key-free half of the webcam layer.
 *
 * WHY THIS EXISTS. The webcam layer was built entirely on Windy, which needs a
 * `WINDY_API_KEY`. Without that key `seed-webcams.mjs` exits before writing
 * `webcam:cameras:active`, `listWebcams` finds no index, and the layer renders
 * nothing at all — a toggle that does nothing on every deployment that has not
 * bought a key. This module supplies cameras that need no credential of any
 * kind, so the layer has something real to show on its own.
 *
 * WHAT COUNTS AS PUBLIC HERE. Every source below is a transport authority that
 * publishes its own camera directory as open data over anonymous HTTPS, with
 * image and stream URLs the operator serves to the public web. Nothing is
 * scraped, nothing is proxied around an access control, and no feed is included
 * on the strength of being merely reachable. `docs/webcam-layer.mdx` already
 * rules out unsecured-camera aggregators such as Insecam for exactly this
 * reason, and that line is what this registry stays on the right side of.
 *
 * SHARDING. Sources are split into bounded shards (one per Caltrans district,
 * one per city elsewhere) because the directories are large — a single Caltrans
 * district is ~2MB of JSON. A viewport only loads the shards it overlaps, and
 * `loadPublicCameras` caps how many uncached shards a single request may pull
 * so that a whole-Earth view can never turn into a dozen multi-megabyte fetches.
 */

import { cachedFetchJson } from '../../../_shared/redis';

/** A camera this codebase is willing to put on the globe. */
export interface PublicCameraRecord {
  /** Namespaced id — `pub-<shardId>-<localId>`, safe for the RPC id charset. */
  id: string;
  title: string;
  lat: number;
  lng: number;
  /** Keys into the client's `WEBCAM_CATEGORIES` styling table. */
  category: string;
  country: string;
  /** Still image the operator publishes. Always present. */
  stillUrl: string;
  /** HLS/MP4 the operator publishes, or '' when it publishes only stills. */
  streamUrl: string;
  /** The operator's own public page, for "see it at the source". */
  sourceUrl: string;
  /** Credit line the operator asks for. Rendered in the popup. */
  attribution: string;
}

export interface CameraBounds {
  w: number;
  s: number;
  e: number;
  n: number;
}

interface PublicCameraShard {
  /** Must contain no `-`: the id scheme splits on it. */
  id: string;
  label: string;
  bounds: CameraBounds;
  url: string;
  parse: (raw: unknown) => PublicCameraRecord[];
}

const USER_AGENT = 'WorldMonitor/1.0 (+https://brians-world-monitor.vercel.app)';
const SHARD_TTL_SECONDS = 6 * 60 * 60;
const SHARD_FETCH_TIMEOUT_MS = 8000;

/**
 * How many shards a single request may pull from upstream when they are not
 * already warm. Cached shards are always served, however many overlap — the cap
 * exists to bound cold cost, not to hide data that is already in hand.
 */
const MAX_COLD_SHARDS_PER_REQUEST = 6;

/** In-process directory memo, so a keyless deployment still works between requests. */
const shardMemo = new Map<string, { records: PublicCameraRecord[]; expiresAt: number }>();
const MEMO_TTL_MS = SHARD_TTL_SECONDS * 1000;

// ─── id scheme ──────────────────────────────────────────────────────────────

export const PUBLIC_CAMERA_ID_PREFIX = 'pub';

/**
 * The server's `WEBCAM_ID_RE` only admits `[\w-]`, but operator ids carry dots
 * (TfL's `JamCams_00002.00865`) and spaces. Sanitising rather than encoding
 * keeps the id readable in a URL; it is never reversed, because lookup scans the
 * loaded shard for a matching generated id.
 */
function sanitizeIdPart(value: string): string {
  return value.replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '');
}

export function makePublicCameraId(shardId: string, localId: string): string {
  return `${PUBLIC_CAMERA_ID_PREFIX}-${shardId}-${sanitizeIdPart(localId)}`;
}

/** Split a namespaced id back into its shard, or null when it is not one of ours. */
export function parsePublicCameraId(id: string | undefined | null): { shardId: string } | null {
  if (!id) return null;
  const parts = id.split('-');
  if (parts.length < 3 || parts[0] !== PUBLIC_CAMERA_ID_PREFIX) return null;
  const shardId = parts[1];
  if (!shardId) return null;
  return { shardId };
}

export function isPublicCameraId(id: string | undefined | null): boolean {
  return parsePublicCameraId(id) !== null;
}

// ─── geometry ───────────────────────────────────────────────────────────────

function toFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Null Island is a parse failure, not a location: several of these directories
 * emit `0`/empty for cameras whose survey data is missing, and a cluster of
 * them off the coast of Ghana is the visible symptom.
 */
function isUsableCoordinate(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return Math.abs(lat) > 0.01 || Math.abs(lng) > 0.01;
}

/** Viewport overlap, splitting the request box when it wraps the antimeridian. */
export function boundsIntersect(shard: CameraBounds, view: CameraBounds): boolean {
  if (shard.n < view.s || shard.s > view.n) return false;
  if (view.w > view.e) {
    return !(shard.e < view.w && shard.w > view.e);
  }
  return !(shard.e < view.w || shard.w > view.e);
}

export function isInBounds(lat: number, lng: number, view: CameraBounds): boolean {
  if (lat < view.s || lat > view.n) return false;
  if (view.w > view.e) return lng >= view.w || lng <= view.e;
  return lng >= view.w && lng <= view.e;
}

// ─── parsers (pure — exported for unit tests) ───────────────────────────────

/**
 * Caltrans publishes one CCTV status document per district, each camera
 * carrying a still image and, for most, an HLS playlist. `inService` is honoured
 * so the layer does not advertise cameras the operator has already marked down.
 */
export function parseCaltransDistrict(raw: unknown, shardId: string, district: string): PublicCameraRecord[] {
  const rows = (raw as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(rows)) return [];

  const records: PublicCameraRecord[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const cctv = (row as { cctv?: Record<string, unknown> } | null)?.cctv;
    if (!cctv) continue;
    if (String(cctv.inService ?? 'true').toLowerCase() === 'false') continue;

    const location = (cctv.location ?? {}) as Record<string, unknown>;
    const lat = toFiniteNumber(location.latitude);
    const lng = toFiniteNumber(location.longitude);
    if (lat === null || lng === null || !isUsableCoordinate(lat, lng)) continue;

    const imageData = (cctv.imageData ?? {}) as Record<string, unknown>;
    const still = (imageData.static ?? {}) as Record<string, unknown>;
    const stillUrl = typeof still.currentImageURL === 'string' ? still.currentImageURL : '';
    if (!stillUrl) continue;

    // The image basename is the operator's own stable camera slug; the record
    // `index` is only stable within one publication of one district.
    const slug = stillUrl.split('/').pop()?.replace(/\.jpg$/i, '') || String(cctv.index ?? '');
    if (!slug) continue;

    const id = makePublicCameraId(shardId, slug);
    if (seen.has(id)) continue;
    seen.add(id);

    const locationName = typeof location.locationName === 'string' ? location.locationName : '';
    const nearbyPlace = typeof location.nearbyPlace === 'string' ? location.nearbyPlace : '';
    const streamUrl = typeof imageData.streamingVideoURL === 'string' ? imageData.streamingVideoURL : '';

    records.push({
      id,
      title: [locationName, nearbyPlace].filter(Boolean).join(' — ') || `Caltrans D${district}`,
      lat,
      lng,
      category: 'traffic',
      country: 'United States',
      stillUrl,
      streamUrl,
      sourceUrl: 'https://cwwp2.dot.ca.gov/vm/iframemap.htm',
      attribution: `Caltrans District ${district} — California DOT open data`,
    });
  }

  return records;
}

/**
 * TfL's Unified API returns JamCams as generic `Place` entities whose useful
 * fields live in an untyped `additionalProperties` bag keyed by name.
 */
export function parseTflJamCams(raw: unknown, shardId: string): PublicCameraRecord[] {
  if (!Array.isArray(raw)) return [];

  const records: PublicCameraRecord[] = [];
  const seen = new Set<string>();

  for (const place of raw) {
    const entity = place as Record<string, unknown> | null;
    if (!entity) continue;

    const lat = toFiniteNumber(entity.lat);
    const lng = toFiniteNumber(entity.lon);
    if (lat === null || lng === null || !isUsableCoordinate(lat, lng)) continue;

    const props = Array.isArray(entity.additionalProperties) ? entity.additionalProperties : [];
    const bag = new Map<string, string>();
    for (const prop of props) {
      const entry = prop as { key?: unknown; value?: unknown } | null;
      if (entry && typeof entry.key === 'string' && typeof entry.value === 'string') {
        bag.set(entry.key, entry.value);
      }
    }

    if ((bag.get('available') ?? 'true').toLowerCase() === 'false') continue;
    const stillUrl = bag.get('imageUrl') ?? '';
    if (!stillUrl) continue;

    const localId = typeof entity.id === 'string' ? entity.id : '';
    if (!localId) continue;
    const id = makePublicCameraId(shardId, localId);
    if (seen.has(id)) continue;
    seen.add(id);

    records.push({
      id,
      title: typeof entity.commonName === 'string' ? entity.commonName : 'TfL JamCam',
      lat,
      lng,
      category: 'traffic',
      country: 'United Kingdom',
      stillUrl,
      streamUrl: bag.get('videoUrl') ?? '',
      sourceUrl: 'https://api.tfl.gov.uk/Place/Type/JamCam',
      attribution: 'Powered by TfL Open Data',
    });
  }

  return records;
}

/** NYC DOT's traffic-camera directory — flat records, still images only. */
export function parseNycDotCameras(raw: unknown, shardId: string): PublicCameraRecord[] {
  if (!Array.isArray(raw)) return [];

  const records: PublicCameraRecord[] = [];
  const seen = new Set<string>();

  for (const row of raw) {
    const camera = row as Record<string, unknown> | null;
    if (!camera) continue;
    if (String(camera.isOnline ?? 'true').toLowerCase() === 'false') continue;

    const lat = toFiniteNumber(camera.latitude);
    const lng = toFiniteNumber(camera.longitude);
    if (lat === null || lng === null || !isUsableCoordinate(lat, lng)) continue;

    const stillUrl = typeof camera.imageUrl === 'string' ? camera.imageUrl : '';
    if (!stillUrl) continue;

    const localId = typeof camera.id === 'string' ? camera.id : '';
    if (!localId) continue;
    const id = makePublicCameraId(shardId, localId);
    if (seen.has(id)) continue;
    seen.add(id);

    const area = typeof camera.area === 'string' ? camera.area : '';
    const name = typeof camera.name === 'string' ? camera.name : 'NYC DOT camera';

    records.push({
      id,
      title: area ? `${name} (${area})` : name,
      lat,
      lng,
      category: 'traffic',
      country: 'United States',
      stillUrl,
      streamUrl: '',
      sourceUrl: 'https://webcams.nyctmc.org/map',
      attribution: 'NYC DOT Traffic Management Center',
    });
  }

  return records;
}

// ─── shard registry ─────────────────────────────────────────────────────────

/**
 * Caltrans district extents, padded outward. These decide only WHICH documents
 * a viewport downloads — every record is bounds-checked individually afterwards
 * — so a generous box costs a fetch while a tight one would lose cameras.
 */
const CALTRANS_DISTRICTS: Array<{ district: string; bounds: CameraBounds }> = [
  { district: '1',  bounds: { w: -124.8, s: 38.3, e: -122.3, n: 42.3 } },
  { district: '2',  bounds: { w: -123.8, s: 39.3, e: -119.7, n: 42.3 } },
  { district: '3',  bounds: { w: -123.2, s: 37.8, e: -119.7, n: 40.2 } },
  { district: '4',  bounds: { w: -123.3, s: 36.6, e: -121.0, n: 39.1 } },
  { district: '5',  bounds: { w: -122.5, s: 34.6, e: -119.3, n: 37.6 } },
  { district: '6',  bounds: { w: -120.9, s: 34.6, e: -117.7, n: 37.8 } },
  { district: '7',  bounds: { w: -119.7, s: 33.0, e: -117.4, n: 35.2 } },
  { district: '8',  bounds: { w: -118.2, s: 33.1, e: -113.9, n: 36.0 } },
  { district: '9',  bounds: { w: -119.8, s: 35.5, e: -116.8, n: 38.9 } },
  { district: '10', bounds: { w: -121.8, s: 36.8, e: -119.0, n: 39.0 } },
  { district: '11', bounds: { w: -117.8, s: 32.3, e: -114.2, n: 33.7 } },
  { district: '12', bounds: { w: -118.3, s: 33.1, e: -117.2, n: 34.1 } },
];

export const PUBLIC_CAMERA_SHARDS: PublicCameraShard[] = [
  ...CALTRANS_DISTRICTS.map(({ district, bounds }) => {
    const shardId = `caltransd${district.padStart(2, '0')}`;
    return {
      id: shardId,
      label: `Caltrans District ${district}`,
      bounds,
      url: `https://cwwp2.dot.ca.gov/data/d${district}/cctv/cctvStatusD${district.padStart(2, '0')}.json`,
      parse: (raw: unknown) => parseCaltransDistrict(raw, shardId, district),
    };
  }),
  {
    id: 'tfllondon',
    label: 'TfL JamCams (London)',
    bounds: { w: -0.62, s: 51.2, e: 0.35, n: 51.75 },
    url: 'https://api.tfl.gov.uk/Place/Type/JamCam',
    parse: (raw: unknown) => parseTflJamCams(raw, 'tfllondon'),
  },
  {
    id: 'nycdot',
    label: 'NYC DOT traffic cameras',
    bounds: { w: -74.30, s: 40.47, e: -73.68, n: 40.95 },
    url: 'https://webcams.nyctmc.org/api/cameras',
    parse: (raw: unknown) => parseNycDotCameras(raw, 'nycdot'),
  },
];

const shardsById = new Map(PUBLIC_CAMERA_SHARDS.map((shard) => [shard.id, shard]));

/** Every credit line the layer may need to render, for docs and attribution UI. */
export const PUBLIC_CAMERA_ATTRIBUTIONS: readonly string[] = [
  'California DOT (Caltrans) open data',
  'Powered by TfL Open Data',
  'NYC DOT Traffic Management Center',
];

// ─── loading ────────────────────────────────────────────────────────────────

function readMemo(shardId: string): PublicCameraRecord[] | null {
  const entry = shardMemo.get(shardId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    shardMemo.delete(shardId);
    return null;
  }
  return entry.records;
}

function writeMemo(shardId: string, records: PublicCameraRecord[]): void {
  shardMemo.set(shardId, { records, expiresAt: Date.now() + MEMO_TTL_MS });
}

/** Test seam — the memo is process-global and would leak between cases. */
export function __clearPublicCameraMemo(): void {
  shardMemo.clear();
}

async function loadShard(shard: PublicCameraShard): Promise<PublicCameraRecord[]> {
  const memoed = readMemo(shard.id);
  if (memoed) return memoed;

  const cached = await cachedFetchJson<{ cameras: PublicCameraRecord[] }>(
    `webcam:public:shard:${shard.id}:v1`,
    SHARD_TTL_SECONDS,
    async () => {
      const resp = await fetch(shard.url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(SHARD_FETCH_TIMEOUT_MS),
      });
      if (!resp.ok) return null;
      const raw = await resp.json();
      const cameras = shard.parse(raw);
      return cameras.length > 0 ? { cameras } : null;
    },
  );

  const records = cached?.cameras ?? [];
  if (records.length > 0) writeMemo(shard.id, records);
  return records;
}

/**
 * Public cameras inside a viewport.
 *
 * Warm shards are always returned; cold ones are capped so a whole-Earth view
 * pulls a bounded number of multi-megabyte directories and warms the rest on
 * later requests. A shard that fails is simply absent — a transport authority
 * having a bad afternoon degrades the layer's coverage, never the request.
 */
export async function loadPublicCameras(view: CameraBounds): Promise<PublicCameraRecord[]> {
  const overlapping = PUBLIC_CAMERA_SHARDS.filter((shard) => boundsIntersect(shard.bounds, view));
  if (overlapping.length === 0) return [];

  const warm: PublicCameraShard[] = [];
  const cold: PublicCameraShard[] = [];
  for (const shard of overlapping) {
    (readMemo(shard.id) ? warm : cold).push(shard);
  }

  // Nearest-first, so zooming toward a city warms that city rather than
  // whichever shard happens to sort first.
  const centerLat = (view.n + view.s) / 2;
  const centerLng = (view.w + view.e) / 2;
  cold.sort((a, b) => shardDistance(a, centerLat, centerLng) - shardDistance(b, centerLat, centerLng));

  const selected = [...warm, ...cold.slice(0, MAX_COLD_SHARDS_PER_REQUEST)];
  const settled = await Promise.allSettled(selected.map((shard) => loadShard(shard)));

  const records: PublicCameraRecord[] = [];
  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i]!;
    if (outcome.status !== 'fulfilled') {
      console.warn(`[webcam] public shard ${selected[i]!.id} failed:`, outcome.reason);
      continue;
    }
    for (const record of outcome.value) {
      if (isInBounds(record.lat, record.lng, view)) records.push(record);
    }
  }

  return records;
}

function shardDistance(shard: PublicCameraShard, lat: number, lng: number): number {
  const shardLat = (shard.bounds.n + shard.bounds.s) / 2;
  const shardLng = (shard.bounds.w + shard.bounds.e) / 2;
  return Math.hypot(shardLat - lat, shardLng - lng);
}

/**
 * Resolve one camera by its namespaced id. The shard is named in the id, so this
 * loads exactly one directory rather than searching every source.
 */
export async function findPublicCamera(id: string): Promise<PublicCameraRecord | null> {
  const parsed = parsePublicCameraId(id);
  if (!parsed) return null;
  const shard = shardsById.get(parsed.shardId);
  if (!shard) return null;

  try {
    const records = await loadShard(shard);
    return records.find((record) => record.id === id) ?? null;
  } catch (err) {
    console.warn(`[webcam] public camera lookup failed for ${id}:`, err);
    return null;
  }
}
