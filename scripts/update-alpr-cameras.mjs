#!/usr/bin/env node
/**
 * Fetch ALPR (automatic license plate reader) camera positions from
 * OpenStreetMap via Overpass — the same public dataset DeFlock
 * (https://deflock.org) visualizes — and write a compact snapshot to
 * public/data/alpr-cameras.json.
 *
 * Rerun any time to refresh:  node scripts/update-alpr-cameras.mjs
 *
 * Output format (compact, ~2-3 MB for ~120k US cameras):
 *   { "updated": "<iso>", "count": N, "cameras": [[lat, lon, mfr], ...] }
 * where mfr is 0=unknown, 1=Flock Safety, 2=Motorola/Vigilant, 3=Genetec, 4=other-known
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const OVERPASS = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';

// Continental US + AK/HI in chunks to stay inside Overpass timeouts.
const BBOXES = [
  [24.0, -125.0, 37.0, -95.0],  // south-west
  [24.0, -95.0, 37.0, -66.0],   // south-east
  [37.0, -125.0, 49.5, -95.0],  // north-west
  [37.0, -95.0, 49.5, -66.0],   // north-east
  [51.0, -180.0, 72.0, -129.0], // Alaska
  [18.5, -161.0, 22.5, -154.0], // Hawaii
];

function mfrCode(tags) {
  const m = (tags?.manufacturer || tags?.brand || '').toLowerCase();
  if (!m) return 0;
  if (m.includes('flock')) return 1;
  if (m.includes('motorola') || m.includes('vigilant')) return 2;
  if (m.includes('genetec')) return 3;
  return 4;
}

const ENDPOINTS = [
  OVERPASS,
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
];

async function fetchBbox(bbox, attempt = 1) {
  const [s, w, n, e] = bbox;
  const query = `[out:json][timeout:120];node["man_made"="surveillance"]["surveillance:type"="ALPR"](${s},${w},${n},${e});out body;`;
  const endpoint = ENDPOINTS[(attempt - 1) % ENDPOINTS.length];
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'brians-world-monitor/1.0 (self-hosted dashboard; ALPR layer refresh)',
        'Accept': 'application/json',
      },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.elements || []).map(el => [
      Math.round(el.lat * 1e5) / 1e5,
      Math.round(el.lon * 1e5) / 1e5,
      mfrCode(el.tags),
    ]);
  } catch (err) {
    if (attempt < 6) {
      const wait = Math.min(60, attempt * 15);
      console.warn(`  bbox ${bbox.join(',')} via ${endpoint} -> ${err.message}; retry ${attempt}/6 in ${wait}s`);
      await new Promise(r => setTimeout(r, wait * 1000));
      return fetchBbox(bbox, attempt + 1);
    }
    // Last resort: split the bbox into quadrants and recurse.
    if (n - s > 2 && e - w > 2) {
      console.warn(`  splitting bbox ${bbox.join(',')} into quadrants`);
      const midLat = (s + n) / 2;
      const midLon = (w + e) / 2;
      const quads = [
        [s, w, midLat, midLon], [s, midLon, midLat, e],
        [midLat, w, n, midLon], [midLat, midLon, n, e],
      ];
      const out = [];
      for (const q of quads) {
        out.push(...await fetchBbox(q, 1));
        await new Promise(r => setTimeout(r, 3000));
      }
      return out;
    }
    throw new Error(`Overpass failed for bbox ${bbox.join(',')}: ${err.message}`);
  }
}

const all = [];
for (const bbox of BBOXES) {
  process.stdout.write(`Fetching bbox ${bbox.join(',')} … `);
  const cams = await fetchBbox(bbox);
  console.log(`${cams.length} cameras`);
  all.push(...cams);
  await new Promise(r => setTimeout(r, 3000)); // be polite to Overpass
}

// Dedupe (bbox edges can overlap).
const seen = new Set();
const cameras = all.filter(([lat, lon]) => {
  const k = `${lat},${lon}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

const out = { updated: new Date().toISOString(), count: cameras.length, cameras };
const dest = path.join(process.cwd(), 'public', 'data', 'alpr-cameras.json');
await mkdir(path.dirname(dest), { recursive: true });
await writeFile(dest, JSON.stringify(out));
console.log(`Wrote ${cameras.length} cameras -> ${dest} (${(JSON.stringify(out).length / 1e6).toFixed(1)} MB)`);
