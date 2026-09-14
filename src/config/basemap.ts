// Map provider/theme preferences. Pure config: NO maplibre/pmtiles/protomaps
// runtime deps live here so the preferences UI (UnifiedSettings → preferences-content)
// can render without dragging maplibre+deck.gl into the entry bundle.
// maplibre-using helpers live in `./basemap-styles.ts` and are loaded
// lazily alongside MapContainer/DeckGLMap when the map panel mounts.

const R2_PROXY = import.meta.env.VITE_PMTILES_URL ?? '';
const R2_PUBLIC = import.meta.env.VITE_PMTILES_URL_PUBLIC ?? '';
const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;
export const R2_BASE = isTauri && R2_PUBLIC ? R2_PUBLIC : R2_PROXY;

const hasTilesUrl = !!R2_BASE;

export type PMTilesTheme = 'black' | 'dark' | 'grayscale' | 'light' | 'white';
export type OpenFreeMapTheme = 'dark' | 'positron';
export type CartoTheme = 'dark-matter' | 'voyager' | 'positron';

export const FALLBACK_DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark';
export const FALLBACK_LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/positron';

export type MapProvider = 'satellite' | 'auto' | 'pmtiles' | 'openfreemap' | 'carto';

/**
 * Satellite themes. 'imagery-hybrid' drapes boundaries + place names over the
 * photography so a reader can name what they are looking at; 'imagery' is the
 * bare photograph for screen captures and the God's Eye stage.
 */
export type SatelliteTheme = 'imagery-hybrid' | 'imagery';

export function isSatelliteProvider(provider: MapProvider): boolean {
  return provider === 'satellite';
}

export function asSatelliteTheme(mapTheme: string): SatelliteTheme {
  return mapTheme === 'imagery' ? 'imagery' : 'imagery-hybrid';
}

const STORAGE_KEY = 'wm-map-provider';
const THEME_STORAGE_PREFIX = 'wm-map-theme:';

export { hasTilesUrl as hasPMTilesUrl };

function readStorageValue(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Map preferences remain at their in-memory defaults for this session.
  }
}

export const MAP_PROVIDER_OPTIONS: { value: MapProvider; label: string }[] = (() => {
  const opts: { value: MapProvider; label: string }[] = [
    { value: 'satellite', label: 'Satellite imagery (recommended)' },
  ];
  if (hasTilesUrl) {
    opts.push({ value: 'auto', label: 'Auto (PMTiles → OpenFreeMap fallback)' });
    opts.push({ value: 'pmtiles', label: 'PMTiles (self-hosted)' });
  }
  opts.push({ value: 'openfreemap', label: 'OpenFreeMap' });
  opts.push({ value: 'carto', label: 'CARTO' });
  return opts;
})();

const PMTILES_THEMES: { value: string; label: string }[] = [
  { value: 'black', label: 'Black (deepest dark)' },
  { value: 'dark', label: 'Dark' },
  { value: 'grayscale', label: 'Grayscale' },
  { value: 'light', label: 'Light' },
  { value: 'white', label: 'White' },
];

export const MAP_THEME_OPTIONS: Record<MapProvider, { value: string; label: string }[]> = {
  satellite: [
    { value: 'imagery-hybrid', label: 'Imagery + labels' },
    { value: 'imagery', label: 'Imagery only' },
  ],
  pmtiles: PMTILES_THEMES,
  auto: PMTILES_THEMES,
  openfreemap: [
    { value: 'dark', label: 'Dark' },
    { value: 'positron', label: 'Positron (light)' },
  ],
  carto: [
    { value: 'dark-matter', label: 'Dark Matter' },
    { value: 'voyager', label: 'Voyager (light)' },
    { value: 'positron', label: 'Positron (light)' },
  ],
};

const DEFAULT_THEME: Record<MapProvider, string> = {
  satellite: 'imagery-hybrid',
  pmtiles: 'black',
  auto: 'black',
  openfreemap: 'dark',
  carto: 'dark-matter',
};

/**
 * Satellite is the default basemap for every surface.
 *
 * Previously this defaulted to the PMTiles 'black' theme, which is a near-black
 * vector style — correct for a chart, wrong for a product whose subject is the
 * planet. Readers with a stored provider keep it; everyone else now opens on
 * photography. See `satellite-imagery.ts` for which service actually serves it.
 */
export function getMapProvider(): MapProvider {
  const stored = readStorageValue(STORAGE_KEY) as MapProvider | null;
  if (stored) {
    if (stored === 'pmtiles' || stored === 'auto') {
      return hasTilesUrl ? stored : 'openfreemap';
    }
    return stored;
  }
  return 'satellite';
}

export function setMapProvider(provider: MapProvider): void {
  writeStorageValue(STORAGE_KEY, provider);
}

export function getMapTheme(provider: MapProvider): string {
  const stored = readStorageValue(THEME_STORAGE_PREFIX + provider);
  const options = MAP_THEME_OPTIONS[provider];
  if (stored && options.some(o => o.value === stored)) return stored;
  return DEFAULT_THEME[provider];
}

export function setMapTheme(provider: MapProvider, theme: string): void {
  const options = MAP_THEME_OPTIONS[provider];
  if (!options.some(o => o.value === theme)) return;
  writeStorageValue(THEME_STORAGE_PREFIX + provider, theme);
}

// ── Terrain mode (physical-geography basemap) ────────────────────────────────
// 'terrain' layers hillshade relief + boosted waterways/physical labels on top
// of the active dark basemap; 'flat' is the classic flat dark style. Persisted
// separately from provider/theme so it survives provider switches. Default is
// 'terrain' (real physical geography out of the box).

export type TerrainMode = 'terrain' | 'flat';

const TERRAIN_STORAGE_KEY = 'jsam-terrain-mode';

export function getTerrainMode(): TerrainMode {
  const stored = readStorageValue(TERRAIN_STORAGE_KEY);
  if (stored === 'flat' || stored === 'terrain') return stored;
  return 'terrain';
}

export function setTerrainMode(mode: TerrainMode): void {
  writeStorageValue(TERRAIN_STORAGE_KEY, mode);
}

export function isLightMapTheme(mapTheme: string): boolean {
  return ['light', 'white', 'positron', 'voyager'].includes(mapTheme);
}

export function asPMTilesTheme(mapTheme: string): PMTilesTheme {
  const valid = PMTILES_THEMES.some(o => o.value === mapTheme);
  return (valid ? mapTheme : 'black') as PMTilesTheme;
}
