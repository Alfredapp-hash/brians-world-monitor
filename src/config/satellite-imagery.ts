/**
 * Satellite imagery policy — ONE source of truth for every map surface.
 *
 * WHY THIS FILE EXISTS. The app has four map renderers (DeckGLMap/MapLibre,
 * GlobeMap/globe.gl, the d3 SVG fallback, and the embed reusing MapContainer)
 * and each one used to choose its own basemap. The result was a dashboard whose
 * "map" was a near-black Protomaps vector rectangle while the God's Eye stage
 * showed a 4096x2048 texture — two different Earths in one product. Every
 * renderer now resolves its imagery through the helpers below, so the imagery
 * decision cannot drift per surface again.
 *
 * PURE CONFIG. No maplibre / three / globe.gl imports, so the preferences UI
 * can read the registry without pulling a renderer into the entry bundle
 * (same split `basemap.ts` already makes against `basemap-styles.ts`).
 *
 * SOURCE SELECTION. A keyed provider wins when its key is actually present in
 * the environment; otherwise the keyless Esri World Imagery service carries the
 * product, with NASA GIBS as the always-available open-data floor. Nothing here
 * invents a credential — a missing key simply drops that provider from the
 * ladder.
 */

export type SatelliteSourceId = 'mapbox' | 'maptiler' | 'esri' | 'nasa-gibs' | 'custom';

export interface SatelliteSource {
  id: SatelliteSourceId;
  label: string;
  /** Raster XYZ template(s) in `{z}/{x}/{y}` terms, for MapLibre raster sources. */
  tiles: string[];
  /** Deepest zoom the service actually serves imagery for. */
  maxZoom: number;
  /** 256 or 512 px tiles — MapLibre needs this to pick the right zoom level. */
  tileSize: 256 | 512;
  /** Required credit line, rendered into the map attribution element. */
  attribution: string;
  /**
   * True when the imagery is unambiguously open data (public domain or an
   * explicit open licence). Consulted by `getOpenDataSatelliteSource()`, which
   * is what the failure path falls back to.
   */
  openData: boolean;
}

const env = (key: string): string => {
  const raw = (import.meta.env as Record<string, unknown>)[key];
  return typeof raw === 'string' ? raw.trim() : '';
};

/**
 * Esri World Imagery — the keyless high-resolution basemap.
 *
 * Sub-metre in most populated areas and served to zoom 19, which is what makes
 * a city read as a city rather than as a coloured polygon. Requires the credit
 * line below. This is a third-party service with no contract behind it here, so
 * it is deliberately swappable: set `VITE_SATELLITE_TILE_URL` (or add a
 * Mapbox/MapTiler key) and the ladder below prefers that instead.
 */
const ESRI_IMAGERY: SatelliteSource = {
  id: 'esri',
  label: 'Satellite (Esri World Imagery)',
  tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
  maxZoom: 19,
  tileSize: 256,
  attribution: 'Imagery © <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics',
  openData: false,
};

/**
 * Esri's boundaries + place-names reference tiles.
 *
 * Imagery alone is beautiful and unreadable — an analyst needs to know which
 * coastline they are looking at. Drawn as a second raster layer over the
 * imagery (Esri's own "Imagery Hybrid" composition) rather than by grafting a
 * vector label style on top, because a raster overlay survives every
 * `setStyle(diff:false)` reload the basemap machinery already performs.
 */
export const ESRI_REFERENCE_TILES =
  'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

/**
 * NASA GIBS Blue Marble (shaded relief + bathymetry) — the open-data floor.
 *
 * Public domain, no key, no rate limit to negotiate, and it is a *static*
 * layer, so unlike the daily VIIRS bands it cannot 404 because a date has not
 * been published yet. Only 500 m/px (zoom 8), so it is the safety net rather
 * than the default: it keeps a failing map on a real Earth instead of dropping
 * it back to a dark vector rectangle.
 */
const NASA_GIBS: SatelliteSource = {
  id: 'nasa-gibs',
  label: 'Satellite (NASA GIBS Blue Marble)',
  tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg'],
  maxZoom: 8,
  tileSize: 256,
  attribution: 'Imagery: <a href="https://worldview.earthdata.nasa.gov" target="_blank" rel="noopener">NASA EOSDIS GIBS</a>',
  openData: true,
};

function mapboxSource(token: string): SatelliteSource {
  return {
    id: 'mapbox',
    label: 'Satellite (Mapbox)',
    tiles: [`https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${token}`],
    maxZoom: 22,
    tileSize: 512,
    attribution: '© <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener">Mapbox</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    openData: false,
  };
}

function maptilerSource(key: string): SatelliteSource {
  return {
    id: 'maptiler',
    label: 'Satellite (MapTiler)',
    tiles: [`https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${key}`],
    maxZoom: 20,
    tileSize: 512,
    attribution: '© <a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener">MapTiler</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    openData: false,
  };
}

function customSource(template: string): SatelliteSource {
  return {
    id: 'custom',
    label: 'Satellite (configured source)',
    tiles: [template],
    maxZoom: Number(env('VITE_SATELLITE_MAX_ZOOM')) || 19,
    tileSize: env('VITE_SATELLITE_TILE_SIZE') === '512' ? 512 : 256,
    attribution: env('VITE_SATELLITE_ATTRIBUTION') || 'Satellite imagery',
    openData: false,
  };
}

/**
 * The imagery this build actually serves, best available first.
 *
 * Order is "sharpest source we are licensed for": an explicitly configured
 * endpoint, then a keyed commercial provider, then keyless Esri, then the
 * open-data floor. Resolved once at module load — the environment cannot change
 * mid-session, and re-deriving it per map instance is exactly how two surfaces
 * end up on different Earths.
 */
export const SATELLITE_SOURCE_LADDER: readonly SatelliteSource[] = (() => {
  const ladder: SatelliteSource[] = [];
  const custom = env('VITE_SATELLITE_TILE_URL');
  const mapboxToken = env('VITE_MAPBOX_TOKEN') || env('VITE_MAPBOX_ACCESS_TOKEN');
  const maptilerKey = env('VITE_MAPTILER_KEY');
  if (custom) ladder.push(customSource(custom));
  if (mapboxToken) ladder.push(mapboxSource(mapboxToken));
  if (maptilerKey) ladder.push(maptilerSource(maptilerKey));
  ladder.push(ESRI_IMAGERY);
  ladder.push(NASA_GIBS);
  return ladder;
})();

/** The imagery every map surface should be showing right now. */
export function getSatelliteSource(): SatelliteSource {
  return SATELLITE_SOURCE_LADDER[0] as SatelliteSource;
}

/**
 * Where a failing imagery source retreats to.
 *
 * Deliberately the open-data entry rather than "the next rung down": a tile
 * failure is usually a network or CORS problem, and stepping from one keyed
 * commercial CDN to another rarely fixes that. NASA GIBS is a different origin
 * on different infrastructure, so it is a real second chance — and it is still
 * a photograph of Earth, which is the whole point of the fallback.
 */
export function getOpenDataSatelliteSource(): SatelliteSource {
  return SATELLITE_SOURCE_LADDER.find((s) => s.openData) ?? NASA_GIBS;
}

// ─── Imagery preference (satellite vs vector) ───────────────────────────────

export type BasemapImagery = 'satellite' | 'vector';

const IMAGERY_STORAGE_KEY = 'wm-basemap-imagery';

/**
 * Satellite is the DEFAULT, not an opt-in.
 *
 * The product is a global intelligence dashboard; its map should look like the
 * planet under observation on first paint, without a reader having to find a
 * setting. A stored 'vector' preference is still honoured — someone who
 * genuinely wants the flat cartographic read keeps it.
 */
export function getBasemapImagery(): BasemapImagery {
  try {
    const raw = localStorage.getItem(IMAGERY_STORAGE_KEY);
    if (raw === 'satellite' || raw === 'vector') return raw;
  } catch { /* privacy-restricted storage keeps the default */ }
  return 'satellite';
}

export function setBasemapImagery(mode: BasemapImagery): void {
  try { localStorage.setItem(IMAGERY_STORAGE_KEY, mode); } catch { /* ignore */ }
}

export function isSatelliteImageryActive(): boolean {
  return getBasemapImagery() === 'satellite';
}

// ─── Globe drape (three-slippy-map-globe tile engine) ───────────────────────

/**
 * Deepest tile level the globe drapes.
 *
 * Held below the source's own ceiling on purpose. The globe's tile engine keeps
 * every visible level resident as real geometry + textures, so the last two
 * zoom levels cost far more GPU memory than they add to a view that is, by
 * definition, being read as a planet. The flat map is the surface that goes all
 * the way in.
 */
const GLOBE_DRAPE_MAX_LEVEL_CAP = 13;

export function getGlobeDrapeMaxLevel(source: SatelliteSource = getSatelliteSource()): number {
  return Math.min(source.maxZoom, GLOBE_DRAPE_MAX_LEVEL_CAP);
}

/**
 * Tile-URL function in the shape `three-slippy-map-globe` wants: `(x, y, level)`
 * rather than a `{z}/{x}/{y}` template. Built from the same source registry the
 * flat map uses, so the globe and the 2D map are literally showing the same
 * pixels at the same place.
 */
export function buildGlobeTileUrlFn(
  source: SatelliteSource = getSatelliteSource(),
): (x: number, y: number, level: number) => string {
  const template = source.tiles[0] ?? '';
  return (x, y, level) => template
    .replace('{z}', String(level))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
}
