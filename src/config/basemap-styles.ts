// maplibre-using parts of basemap.ts.
// Split out so `preferences-content.ts` (which only needs the preference
// getters/setters) does NOT pull maplibre into the main bundle. Only
// imported by `DeckGLMap.ts`, which is itself dynamically imported when
// the map panel mounts — so maplibre + deck.gl now load lazily. PMTiles and
// Protomaps stay behind provider-specific dynamic imports below so CARTO /
// OpenFreeMap users do not download the self-hosted basemap stack.
import maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import {
  R2_BASE,
  hasPMTilesUrl,
  isLightMapTheme,
  asPMTilesTheme,
  FALLBACK_DARK_STYLE,
  FALLBACK_LIGHT_STYLE,
  type PMTilesTheme,
  type MapProvider,
} from '@/config/basemap';

let registered = false;
let registerPromise: Promise<void> | null = null;

export async function registerPMTilesProtocol(): Promise<void> {
  if (registered) return;
  registerPromise ??= (async () => {
    try {
      const { Protocol } = await import('pmtiles');
      if (registered) return;
      const protocol = new Protocol();
      maplibregl.addProtocol('pmtiles', protocol.tile);
      registered = true;
    } catch (err) {
      registerPromise = null;
      throw err;
    }
  })();
  await registerPromise;
}

export async function buildPMTilesStyle(flavor: PMTilesTheme): Promise<StyleSpecification | null> {
  if (!hasPMTilesUrl) return null;
  const { layers, namedFlavor } = await import('@protomaps/basemaps');
  const spriteName = ['light', 'white'].includes(flavor) ? 'light' : 'dark';
  return {
    version: 8,
    glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    sprite: `https://protomaps.github.io/basemaps-assets/sprites/v4/${spriteName}`,
    sources: {
      basemap: {
        type: 'vector',
        url: `pmtiles://${R2_BASE}`,
        attribution: '<a href="https://protomaps.com">Protomaps</a> | <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: layers('basemap', namedFlavor(flavor), { lang: 'en' }) as StyleSpecification['layers'],
  };
}

const CARTO_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const CARTO_VOYAGER = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';
const CARTO_POSITRON = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

const CARTO_STYLES: Record<string, string> = {
  'dark-matter': CARTO_DARK,
  'voyager': CARTO_VOYAGER,
  'positron': CARTO_POSITRON,
};

// ── Terrain mode (physical-geography overlay) ────────────────────────────────
// Approach chosen (Workstream 2): rather than shipping a separate TERRAIN_DARK
// StyleSpecification per provider, terrain is applied as a post-`style.load`
// mutation of whatever dark basemap is active. All three provider paths
// (OpenFreeMap /styles/dark, CARTO *-gl-style, PMTiles/Protomaps) are VECTOR
// styles, so we can (a) inject a raster-dem hillshade layer beneath the first
// symbol (label) layer, (b) restyle the basemap's own water / waterway vector
// layers into visible blue-gray waterways, and (c) un-hide + tint physical
// feature labels (water names, peaks). This survives the existing
// switchBasemap()/fallback machinery because those paths re-run the same hook
// after every setStyle(), and it keeps terrain sources fully lazy — nothing is
// fetched unless terrain mode is active.
//
// Elevation source: AWS/Mapzen Terrain Tiles (terrarium encoding), a free open
// dataset on S3 (no API key). Licensing: tiles are open data — attribution
// "Mapzen/AWS Terrain Tiles" (sources incl. USGS 3DEP, SRTM, GMTED, ETOPO1);
// credit is surfaced in the map attribution line while terrain mode is on.
// Hillshade only — maplibre setTerrain() 3D extrusion is deliberately NOT
// enabled on the flat map (perf).

export const TERRAIN_DEM_SOURCE_ID = 'wm-terrain-dem';
export const TERRAIN_HILLSHADE_LAYER_ID = 'wm-terrain-hillshade';
export const TERRAIN_ATTRIBUTION_HTML =
  'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Mapzen/AWS Terrain Tiles</a>';

const TERRAIN_DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

/** Waterway line color tuned for the amber-on-charcoal theme (#0a0c10 bg). */
const TERRAIN_WATERWAY_COLOR = '#3d5a6b';
/** Water polygon fill: a shade above the charcoal bg so lakes/seas read. */
const TERRAIN_WATER_FILL = '#14212b';
/** Physical-feature label ink: desaturated blue-gray, halo near-black. */
const TERRAIN_LABEL_COLOR = '#8299a8';
const TERRAIN_LABEL_HALO = '#05070b';

const WATERWAY_SOURCE_LAYER_RE = /^(waterway|physical_line)$/;
const WATER_FILL_SOURCE_LAYER_RE = /^(water|ocean|lake)$/;
const PHYSICAL_LABEL_SOURCE_LAYER_RE = /^(water_name|waterway|mountain_peak|physical_point)$/;

type StyleLayerLike = {
  id: string;
  type: string;
  'source-layer'?: string;
};

/**
 * Adds the terrarium DEM source + a subtle hillshade layer to a loaded map.
 * Idempotent; safe to call after every style.load. Hillshade is inserted below
 * the first symbol layer so relief never washes over labels.
 */
export function addHillshadeLayers(map: maplibregl.Map): void {
  if (!map.getSource(TERRAIN_DEM_SOURCE_ID)) {
    map.addSource(TERRAIN_DEM_SOURCE_ID, {
      type: 'raster-dem',
      tiles: [TERRAIN_DEM_TILES],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 15,
      attribution: 'Terrain: Mapzen/AWS Terrain Tiles',
    });
  }
  if (!map.getLayer(TERRAIN_HILLSHADE_LAYER_ID)) {
    const layers = (map.getStyle()?.layers ?? []) as StyleLayerLike[];
    const firstSymbol = layers.find((l) => l.type === 'symbol')?.id;
    map.addLayer({
      id: TERRAIN_HILLSHADE_LAYER_ID,
      type: 'hillshade',
      source: TERRAIN_DEM_SOURCE_ID,
      paint: {
        // Subtle relief: shadows near-black, highlights a warm dark gray so
        // ridgelines pick up a faint amber warmth without washing out the
        // dark identity.
        'hillshade-exaggeration': 0.55,
        'hillshade-shadow-color': '#03050a',
        'hillshade-highlight-color': '#6b6350',
        'hillshade-accent-color': '#10141a',
      },
    }, firstSymbol);
  }
}

/**
 * Boosts the active vector basemap's physical geography: rivers/waterways as
 * visible blue-gray lines (wider at high zoom), water polygons a shade above
 * the charcoal background, and natural-feature labels (water names, peaks)
 * un-hidden and tinted. No-op for layers the style doesn't have; original
 * styling is restored by the caller via a full style reload (setStyle with
 * diff:false), so nothing needs to be saved here.
 */
export function boostPhysicalGeographyLayers(map: maplibregl.Map): void {
  const layers = (map.getStyle()?.layers ?? []) as StyleLayerLike[];
  for (const layer of layers) {
    const srcLayer = layer['source-layer'] ?? '';
    try {
      if (layer.type === 'line' && WATERWAY_SOURCE_LAYER_RE.test(srcLayer)) {
        map.setLayoutProperty(layer.id, 'visibility', 'visible');
        map.setPaintProperty(layer.id, 'line-color', TERRAIN_WATERWAY_COLOR);
        map.setPaintProperty(layer.id, 'line-opacity', 0.9);
        map.setPaintProperty(layer.id, 'line-width', [
          'interpolate', ['linear'], ['zoom'],
          4, 0.4,
          8, 1.1,
          12, 2.2,
          16, 4,
        ]);
      } else if (layer.type === 'fill' && WATER_FILL_SOURCE_LAYER_RE.test(srcLayer)) {
        map.setPaintProperty(layer.id, 'fill-color', TERRAIN_WATER_FILL);
      } else if (layer.type === 'symbol' && PHYSICAL_LABEL_SOURCE_LAYER_RE.test(srcLayer)) {
        map.setLayoutProperty(layer.id, 'visibility', 'visible');
        map.setPaintProperty(layer.id, 'text-color', TERRAIN_LABEL_COLOR);
        map.setPaintProperty(layer.id, 'text-halo-color', TERRAIN_LABEL_HALO);
      }
    } catch {
      // A style may reject individual paint/layout writes (e.g. data-driven
      // expressions it can't override); skip that layer rather than aborting
      // the whole terrain pass.
    }
  }
}

/**
 * Full terrain pass for a loaded style: hillshade + physical-geography boost.
 * Callers must ensure the style is loaded (call from a style.load handler).
 */
export function applyTerrainToMap(map: maplibregl.Map): void {
  addHillshadeLayers(map);
  boostPhysicalGeographyLayers(map);
}

async function tryBuildRegisteredPMTilesStyle(flavor: PMTilesTheme): Promise<StyleSpecification | null> {
  try {
    const style = await buildPMTilesStyle(flavor);
    if (!style) return null;
    await registerPMTilesProtocol();
    return style;
  } catch (err) {
    console.warn('[basemap] PMTiles style unavailable, using fallback:', (err as Error)?.message);
    return null;
  }
}

export async function getStyleForProvider(provider: MapProvider, mapTheme: string): Promise<StyleSpecification | string> {
  const lightFallback = isLightMapTheme(mapTheme);
  switch (provider) {
    case 'pmtiles': {
      const style = await tryBuildRegisteredPMTilesStyle(asPMTilesTheme(mapTheme));
      if (style) return style;
      return lightFallback ? FALLBACK_LIGHT_STYLE : FALLBACK_DARK_STYLE;
    }
    case 'openfreemap':
      return mapTheme === 'positron' ? FALLBACK_LIGHT_STYLE : FALLBACK_DARK_STYLE;
    case 'carto':
      return CARTO_STYLES[mapTheme] ?? CARTO_DARK;
    default: {
      const pmtiles = await tryBuildRegisteredPMTilesStyle(asPMTilesTheme(mapTheme));
      return pmtiles ?? (lightFallback ? FALLBACK_LIGHT_STYLE : FALLBACK_DARK_STYLE);
    }
  }
}
