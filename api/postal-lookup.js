import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { jsonResponse } from './_json-response.js';
// @ts-expect-error — JS module, no declaration file
import { readJsonFromUpstash, setCachedData } from './_upstash-json.js';

export const config = { runtime: 'edge' };

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const CHROME_UA = 'WorldMonitor/2.0 (https://brians-world-monitor.vercel.app)';
const POSTAL_RE = /^[A-Z0-9][A-Z0-9 \-]{1,11}$/i;
const COUNTRY_RE = /^[A-Z]{2}$/i;

function normalizePostal(raw) {
  return String(raw || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

export default async function handler(req, ctx) {
  if (isDisallowedOrigin(req))
    return new Response('Forbidden', { status: 403 });

  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: cors });

  const url = new URL(req.url);
  const postal = normalizePostal(url.searchParams.get('postal') || url.searchParams.get('q'));
  const countryRaw = (url.searchParams.get('country') || '').trim().toUpperCase();
  const country = COUNTRY_RE.test(countryRaw) ? countryRaw : '';

  if (!postal || !POSTAL_RE.test(postal)) {
    return jsonResponse({ error: 'valid postal / ZIP code required' }, 400, cors);
  }

  const cacheKey = `postal:${country || 'xx'}:${postal.replace(/\s+/g, '')}`;

  const cached = await readJsonFromUpstash(cacheKey, 1500);
  if (cached) {
    return new Response(JSON.stringify(cached), {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
      },
    });
  }

  const params = new URLSearchParams({
    postalcode: postal,
    format: 'json',
    addressdetails: '1',
    limit: '1',
  });
  if (country) params.set('countrycodes', country.toLowerCase());

  try {
    const resp = await fetch(
      `${NOMINATIM_BASE}?${params.toString()}`,
      {
        headers: { 'User-Agent': CHROME_UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      },
    );

    if (!resp.ok) {
      return jsonResponse({ error: `Nominatim ${resp.status}` }, 502, cors);
    }

    const data = await resp.json();
    const hit = Array.isArray(data) ? data[0] : null;
    const latN = Number(hit?.lat);
    const lonN = Number(hit?.lon);
    if (!hit || Number.isNaN(latN) || Number.isNaN(lonN)) {
      return jsonResponse({ error: 'not found' }, 404, cors);
    }

    const address = hit.address || {};
    const code = String(address.country_code || country || '').toUpperCase() || null;
    const result = {
      lat: latN,
      lon: lonN,
      country: address.country || null,
      code,
      postal: address.postcode || postal,
      displayName: hit.display_name || address.country || postal,
    };
    const body = JSON.stringify(result);

    ctx.waitUntil(setCachedData(cacheKey, result, 604800));

    return new Response(body, {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
      },
    });
  } catch (err) {
    return jsonResponse({ error: 'Nominatim request failed' }, 502, cors);
  }
}
