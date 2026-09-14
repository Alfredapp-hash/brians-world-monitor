#!/usr/bin/env node
/**
 * Seed the public-camera coverage summary.
 *
 * WHAT THIS IS NOT. It does not seed camera positions. Markers are viewport
 * reads against WebcamService, exactly as the Windy half works, and the server
 * builds them from the source directories on demand. Mirroring several thousand
 * camera rows into the bootstrap payload would bloat first paint to serve a
 * layer that is off by default.
 *
 * WHAT IT IS. A small manifest — which openly published sources answered, how
 * many usable cameras each had, and the credit line each operator asks for. It
 * is what lets the layer say "1,842 public cameras across 3 agencies" before a
 * single viewport request, and what makes a source going dark visible to
 * /api/health rather than silently shrinking the map.
 *
 * Every source is a transport authority publishing its own directory as open
 * data over anonymous HTTPS. No credential is used, and none should ever be
 * added here — a source that needs one does not belong in this file.
 *
 * Usage: node scripts/seed-public-cameras.mjs
 * Env:   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 */

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!REDIS_URL || !REDIS_TOKEN) {
  console.error('Redis credentials not set');
  process.exit(1);
}

const PREFIX = process.env.KEY_PREFIX || '';
const CACHE_KEY = `${PREFIX}webcam:public-cameras:v1`;
const SEED_META_KEY = `${PREFIX}seed-meta:webcam:public-cameras:v1`;
const TTL_SECONDS = 7 * 24 * 60 * 60;
const USER_AGENT = 'WorldMonitor/1.0 (+https://brians-world-monitor.vercel.app)';
const FETCH_TIMEOUT_MS = 20000;

const CALTRANS_DISTRICTS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

const SOURCES = [
  ...CALTRANS_DISTRICTS.map((district) => ({
    id: `caltransd${district.padStart(2, '0')}`,
    label: `Caltrans District ${district}`,
    operator: 'California Department of Transportation',
    attribution: `Caltrans District ${district} — California DOT open data`,
    url: `https://cwwp2.dot.ca.gov/data/d${district}/cctv/cctvStatusD${district.padStart(2, '0')}.json`,
    count: countCaltrans,
  })),
  {
    id: 'tfllondon',
    label: 'TfL JamCams (London)',
    operator: 'Transport for London',
    attribution: 'Powered by TfL Open Data',
    url: 'https://api.tfl.gov.uk/Place/Type/JamCam',
    count: countTfl,
  },
  {
    id: 'nycdot',
    label: 'NYC DOT traffic cameras',
    operator: 'New York City Department of Transportation',
    attribution: 'NYC DOT Traffic Management Center',
    url: 'https://webcams.nyctmc.org/api/cameras',
    count: countNyc,
  },
];

/**
 * Counting mirrors the server parsers' acceptance rules — coordinates present
 * and usable, a still image published, the operator not already reporting the
 * camera as down. A looser count here would advertise coverage the layer cannot
 * actually render.
 */
const usable = (lat, lon) => (
  Number.isFinite(lat) && Number.isFinite(lon)
  && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
  && (Math.abs(lat) > 0.01 || Math.abs(lon) > 0.01)
);

function countCaltrans(raw) {
  if (!Array.isArray(raw?.data)) return 0;
  let total = 0;
  for (const row of raw.data) {
    const cctv = row?.cctv;
    if (!cctv) continue;
    if (String(cctv.inService ?? 'true').toLowerCase() === 'false') continue;
    const lat = Number.parseFloat(cctv.location?.latitude);
    const lon = Number.parseFloat(cctv.location?.longitude);
    if (!usable(lat, lon)) continue;
    if (!cctv.imageData?.static?.currentImageURL) continue;
    total++;
  }
  return total;
}

function countTfl(raw) {
  if (!Array.isArray(raw)) return 0;
  let total = 0;
  for (const place of raw) {
    if (!usable(place?.lat, place?.lon)) continue;
    const props = Array.isArray(place.additionalProperties) ? place.additionalProperties : [];
    const available = props.find((p) => p?.key === 'available')?.value ?? 'true';
    if (String(available).toLowerCase() === 'false') continue;
    if (!props.find((p) => p?.key === 'imageUrl')?.value) continue;
    total++;
  }
  return total;
}

function countNyc(raw) {
  if (!Array.isArray(raw)) return 0;
  let total = 0;
  for (const camera of raw) {
    if (String(camera?.isOnline ?? 'true').toLowerCase() === 'false') continue;
    if (!usable(Number.parseFloat(camera?.latitude), Number.parseFloat(camera?.longitude))) continue;
    if (!camera?.imageUrl) continue;
    total++;
  }
  return total;
}

async function redisCommand(command) {
  const resp = await fetch(`${REDIS_URL}/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!resp.ok) throw new Error(`Redis command failed: ${resp.status}`);
  return resp.json();
}

async function probeSource(source) {
  try {
    const resp = await fetch(source.url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      console.warn(`  [${source.id}] HTTP ${resp.status}`);
      return { id: source.id, label: source.label, operator: source.operator, attribution: source.attribution, cameraCount: 0, available: false };
    }
    const cameraCount = source.count(await resp.json());
    console.log(`  [${source.id}] ${cameraCount} cameras`);
    return { id: source.id, label: source.label, operator: source.operator, attribution: source.attribution, cameraCount, available: cameraCount > 0 };
  } catch (err) {
    console.warn(`  [${source.id}] failed: ${err.message}`);
    return { id: source.id, label: source.label, operator: source.operator, attribution: source.attribution, cameraCount: 0, available: false };
  }
}

async function main() {
  console.log('seed-public-cameras: starting...');

  const sources = [];
  // Sequential rather than parallel: these are multi-megabyte documents from
  // public agencies, and a seeder is never in enough of a hurry to justify
  // opening twelve of them at once against someone else's infrastructure.
  for (const source of SOURCES) {
    sources.push(await probeSource(source));
  }

  const available = sources.filter((s) => s.available);
  const totalCameras = available.reduce((sum, s) => sum + s.cameraCount, 0);

  if (totalCameras === 0) {
    console.warn('seed-public-cameras: no sources answered, leaving previous payload in place');
    process.exit(0);
  }

  const payload = {
    sources,
    totalCameras,
    availableSources: available.length,
    attributions: [...new Set(available.map((s) => s.attribution))],
    fetchedAt: new Date().toISOString(),
  };

  await redisCommand(['SET', CACHE_KEY, JSON.stringify(payload), 'EX', String(TTL_SECONDS)]);
  await redisCommand([
    'SET', SEED_META_KEY,
    JSON.stringify({ fetchedAt: Date.now(), recordCount: totalCameras }),
    'EX', String(TTL_SECONDS),
  ]);

  console.log(`seed-public-cameras: done (${totalCameras} cameras across ${available.length}/${sources.length} sources)`);
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('seed-public-cameras: fatal error:', err.message);
  process.exit(1);
});
