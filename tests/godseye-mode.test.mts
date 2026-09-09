import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  GODSEYE_MISSION_PRESET_ID,
  STAGE_MODE_KEY,
  STAGE_RESTORE_KEY,
  altitudeToZoom,
  buildGodsEyeStageState,
  buildStageEntryUrl,
  buildStageExitUrl,
  captureStageRestore,
  countActiveLayers,
  engageGodsEyeStage,
  formatHudLatLon,
  formatHudScale,
  getStageMode,
  isGodsEyeStage,
  isStageMode,
  parseStageCameraFromSearch,
  parseStageRestore,
  releaseGodsEyeStage,
  resolveStageModeForLoad,
  serializeStageRestore,
  summarizeStageTelemetry,
  type KeyValueStore,
} from '../src/services/godseye-mode.ts';
import { STORAGE_KEYS } from '../src/config/variants/base.ts';
import { ALL_PANELS, DEFAULT_MAP_LAYERS } from '../src/config/panels.ts';
import { MISSION_PRESET_STORAGE_KEY, getMissionPreset } from '../src/services/mission-presets.ts';
import { READER_MODE_KEY } from '../src/services/reader-mode.ts';

/** In-memory store so the pure stage logic is testable without a browser. */
function makeStore(seed: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

/** A store whose every operation throws, like Safari private mode. */
const hostileStore: KeyValueStore = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('SecurityError'); },
  removeItem() { throw new Error('SecurityError'); },
};

describe('stage mode state', () => {
  it('recognizes only the two stage modes', () => {
    assert.equal(isStageMode('godseye'), true);
    assert.equal(isStageMode('dashboard'), true);
    assert.equal(isStageMode('everyday'), false);
    assert.equal(isStageMode(null), false);
    assert.equal(isStageMode(undefined), false);
  });

  it('defaults to the dashboard when nothing is stored', () => {
    assert.equal(getStageMode(makeStore()), 'dashboard');
    assert.equal(isGodsEyeStage(makeStore()), false);
  });

  it('reads a stored stage and ignores a corrupt one', () => {
    assert.equal(getStageMode(makeStore({ [STAGE_MODE_KEY]: 'godseye' })), 'godseye');
    assert.equal(getStageMode(makeStore({ [STAGE_MODE_KEY]: 'cockpit' })), 'dashboard');
  });

  it('treats blocked storage as "no stage" instead of throwing', () => {
    assert.equal(getStageMode(hostileStore), 'dashboard');
    assert.doesNotThrow(() => engageGodsEyeStage(hostileStore));
    assert.doesNotThrow(() => releaseGodsEyeStage(hostileStore));
  });

  it('treats a missing storage area as "no stage"', () => {
    assert.equal(getStageMode(null), 'dashboard');
  });
});

describe('resolveStageModeForLoad', () => {
  it('lets an explicit URL parameter outrank the stored preference', () => {
    assert.equal(resolveStageModeForLoad('?godseye=1', 'dashboard'), 'godseye');
    assert.equal(resolveStageModeForLoad('?godseye=true', 'dashboard'), 'godseye');
    assert.equal(resolveStageModeForLoad('?godseye=0', 'godseye'), 'dashboard');
    assert.equal(resolveStageModeForLoad('?godseye=false', 'godseye'), 'dashboard');
  });

  it('falls back to the stored preference without a parameter', () => {
    assert.equal(resolveStageModeForLoad('', 'godseye'), 'godseye');
    assert.equal(resolveStageModeForLoad('?lang=fr', 'godseye'), 'godseye');
    assert.equal(resolveStageModeForLoad(null, 'dashboard'), 'dashboard');
    assert.equal(resolveStageModeForLoad(undefined, 'dashboard'), 'dashboard');
  });

  it('ignores an unparseable parameter value rather than guessing', () => {
    assert.equal(resolveStageModeForLoad('?godseye=maybe', 'dashboard'), 'dashboard');
    assert.equal(resolveStageModeForLoad('?godseye=maybe', 'godseye'), 'godseye');
  });
});

describe('stage restore snapshot', () => {
  it('captures the three preferences the stage displaces', () => {
    const store = makeStore({
      [READER_MODE_KEY]: 'everyday',
      [STORAGE_KEYS.mapMode]: JSON.stringify('flat'),
      [MISSION_PRESET_STORAGE_KEY]: 'crisis-desk',
    });
    assert.deepEqual(captureStageRestore(store), {
      readerMode: 'everyday',
      mapMode: 'flat',
      missionPresetId: 'crisis-desk',
      camera: null,
    });
  });

  it('records absent preferences as null rather than inventing defaults', () => {
    assert.deepEqual(captureStageRestore(makeStore()), {
      readerMode: null,
      mapMode: null,
      missionPresetId: null,
      camera: null,
    });
  });

  it('carries the camera it was handed', () => {
    const camera = { lat: 34.05, lon: -118.24, zoom: 6, altitude: 0.15, view: 'america' };
    assert.deepEqual(captureStageRestore(makeStore(), camera).camera, camera);
  });

  it('survives a corrupt map-mode value', () => {
    const store = makeStore({ [STORAGE_KEYS.mapMode]: '{not json' });
    assert.equal(captureStageRestore(store).mapMode, null);
  });

  it('rejects an out-of-union map mode', () => {
    const store = makeStore({ [STORAGE_KEYS.mapMode]: JSON.stringify('isometric') });
    assert.equal(captureStageRestore(store).mapMode, null);
  });

  it('round-trips through serialization', () => {
    const snapshot = {
      readerMode: 'analyst',
      mapMode: 'globe',
      missionPresetId: 'energy-security',
      camera: { lat: -33.87, lon: 151.21, zoom: 5, altitude: 0.3, view: 'oceania' },
    } as const;
    assert.deepEqual(parseStageRestore(serializeStageRestore(snapshot)), snapshot);
  });

  it('parses defensively', () => {
    assert.equal(parseStageRestore(null), null);
    assert.equal(parseStageRestore(''), null);
    assert.equal(parseStageRestore('{oops'), null);
    assert.equal(parseStageRestore('"a string"'), null);
    assert.deepEqual(parseStageRestore('{"readerMode":"nonsense","mapMode":7}'), {
      readerMode: null,
      mapMode: null,
      missionPresetId: null,
      camera: null,
    });
  });

  it('drops a camera with no usable centre rather than restoring to 0,0', () => {
    assert.equal(parseStageRestore('{"camera":{"lat":"north","lon":12}}')?.camera, null);
    assert.equal(parseStageRestore('{"camera":{"lat":null,"lon":null}}')?.camera, null);
    assert.equal(parseStageRestore('{"camera":7}')?.camera, null);
  });

  it('fills a partial camera with usable defaults instead of discarding the centre', () => {
    assert.deepEqual(parseStageRestore('{"camera":{"lat":10,"lon":20}}')?.camera, {
      lat: 10,
      lon: 20,
      zoom: 2,
      altitude: null,
      view: null,
    });
  });
});

describe('altitudeToZoom', () => {
  it('inverts the zoom → altitude ladder the globe renderer uses', () => {
    // Mirrors GlobeMap.setCenter: zoom >= 7 → 0.08, >= 6 → 0.15, and so on.
    assert.equal(altitudeToZoom(0.08), 7);
    assert.equal(altitudeToZoom(0.15), 6);
    assert.equal(altitudeToZoom(0.3), 5);
    assert.equal(altitudeToZoom(0.5), 4);
    assert.equal(altitudeToZoom(0.8), 3);
    assert.equal(altitudeToZoom(1.8), 2);
  });

  it('falls back to a whole-world zoom on an unreadable altitude', () => {
    assert.equal(altitudeToZoom(Number.NaN), 2);
  });
});

describe('stage entry and exit URLs', () => {
  const HOME = 'https://worldmonitor.app/';

  it('marks the stage in the address bar so it is shareable immediately', () => {
    const url = new URL(buildStageEntryUrl(HOME));
    assert.equal(url.searchParams.get('godseye'), '1');
  });

  it('drops the dashboard camera and layers so the stage frames itself', () => {
    const entry = new URL(
      buildStageEntryUrl(`${HOME}?lat=34.05&lon=-118.24&zoom=7&view=america&layers=conflicts&country=US`),
    );
    for (const key of ['lat', 'lon', 'zoom', 'view', 'layers', 'country']) {
      assert.equal(entry.searchParams.get(key), null, `${key} must not survive stage entry`);
    }
  });

  it('leaves parameters that are nobody else’s business alone', () => {
    const entry = new URL(buildStageEntryUrl(`${HOME}?lang=fr&utm_source=x`));
    assert.equal(entry.searchParams.get('lang'), 'fr');
    assert.equal(entry.searchParams.get('utm_source'), 'x');
  });

  it('strips the stage parameter on exit so a reload cannot re-engage', () => {
    const exit = new URL(buildStageExitUrl(`${HOME}?godseye=1&zoom=2&layers=ais`, null));
    assert.equal(exit.searchParams.get('godseye'), null);
    // Exit must not hand the stage's transient layer bundle to the dashboard —
    // applyInitialUrlState persists whatever layers it is given.
    assert.equal(exit.searchParams.get('layers'), null);
  });

  it('replays the reader’s camera through the map’s own parameters', () => {
    const exit = new URL(
      buildStageExitUrl(`${HOME}?godseye=1&lat=0&lon=0&zoom=2&view=global`, {
        lat: 51.5074,
        lon: -0.1278,
        zoom: 6,
        altitude: 0.15,
        view: 'eu',
      }),
    );
    assert.equal(exit.searchParams.get('lat'), '51.5074');
    assert.equal(exit.searchParams.get('lon'), '-0.1278');
    assert.equal(exit.searchParams.get('zoom'), '6.00');
    assert.equal(exit.searchParams.get('view'), 'eu');
  });

  it('clears the stage framing when there was no camera to restore', () => {
    const exit = new URL(buildStageExitUrl(`${HOME}?godseye=1&lat=20&lon=0&zoom=1.90&view=global`, null));
    for (const key of ['lat', 'lon', 'zoom', 'view']) {
      assert.equal(exit.searchParams.get(key), null);
    }
  });

  it('survives a href it cannot parse rather than navigating nowhere', () => {
    assert.equal(buildStageEntryUrl('not a url'), 'not a url');
    assert.equal(buildStageExitUrl('not a url', null), 'not a url');
  });
});

describe('parseStageCameraFromSearch', () => {
  it('reads the camera a hand-edited deep link was already carrying', () => {
    assert.deepEqual(parseStageCameraFromSearch('?lat=48.85&lon=2.35&zoom=5&view=eu&godseye=1'), {
      lat: 48.85,
      lon: 2.35,
      zoom: 5,
      altitude: null,
      view: 'eu',
    });
  });

  it('reports no camera when the URL never described one', () => {
    assert.equal(parseStageCameraFromSearch('?godseye=1'), null);
    assert.equal(parseStageCameraFromSearch(''), null);
    assert.equal(parseStageCameraFromSearch('?lat=48.85'), null);
  });
});

describe('buildGodsEyeStageState', () => {
  it('stages the preset’s curated panels instead of the reader’s dashboard', () => {
    const preset = getMissionPreset(GODSEYE_MISSION_PRESET_ID)!;
    // A reader with a wide analyst layout: every panel the app knows, enabled.
    const dashboard: Record<string, { name: string; enabled: boolean; priority: number }> = {};
    for (const key of Object.keys(ALL_PANELS)) {
      dashboard[key] = { name: key, enabled: true, priority: 3 };
    }

    const staged = buildGodsEyeStageState(dashboard, DEFAULT_MAP_LAYERS, 'full');
    assert.ok(staged, 'the stage must produce a bundle');

    const enabled = Object.entries(staged.panelSettings)
      .filter(([, config]) => config.enabled)
      .map(([key]) => key);
    // Every enabled panel gets a rail shell, so "far fewer than the dashboard"
    // is the whole point — this is what turns ~84 empty shells into a read.
    assert.ok(enabled.length < 10, `stage rail should be curated, got ${enabled.length} panels`);
    assert.ok(enabled.includes('map'));
    for (const key of enabled) {
      assert.ok(preset.panels.includes(key), `${key} is not part of the stage preset`);
    }
  });

  it('stages the preset’s layers so the HUD count describes the stage', () => {
    const staged = buildGodsEyeStageState({}, DEFAULT_MAP_LAYERS, 'full');
    assert.ok(staged);
    const active = countActiveLayers(staged.mapLayers);
    assert.ok(active > 0, 'the stage must light up layers');
    assert.ok(active <= getMissionPreset(GODSEYE_MISSION_PRESET_ID)!.layers.length);
  });

  it('leaves the reader’s stored layout alone — the bundle is transient', () => {
    const store = makeStore({
      [READER_MODE_KEY]: 'analyst',
      [MISSION_PRESET_STORAGE_KEY]: 'crisis-desk',
    });
    const dashboard = { map: { name: 'Map', enabled: true, priority: 1 } };
    engageGodsEyeStage(store);
    buildGodsEyeStageState(dashboard, DEFAULT_MAP_LAYERS, 'full');

    // Nothing but the three snapshotted preferences and the stage keys moved.
    assert.deepEqual(dashboard, { map: { name: 'Map', enabled: true, priority: 1 } });
    assert.equal(store.getItem(STORAGE_KEYS.panels), null);

    // And exit needs no un-apply: the snapshot alone restores the reader.
    const restored = releaseGodsEyeStage(store);
    assert.equal(restored?.missionPresetId, 'crisis-desk');
    assert.equal(store.getItem(MISSION_PRESET_STORAGE_KEY), 'crisis-desk');
  });
});

describe('engage and release', () => {
  it('stages an analyst 3D globe and remembers what it displaced', () => {
    const store = makeStore({
      [READER_MODE_KEY]: 'everyday',
      [STORAGE_KEYS.mapMode]: JSON.stringify('flat'),
      [MISSION_PRESET_STORAGE_KEY]: 'everyday-reader',
    });

    const snapshot = engageGodsEyeStage(store);

    assert.equal(store.getItem(STAGE_MODE_KEY), 'godseye');
    assert.equal(store.getItem(READER_MODE_KEY), 'analyst');
    assert.equal(store.getItem(STORAGE_KEYS.mapMode), JSON.stringify('globe'));
    assert.equal(store.getItem(MISSION_PRESET_STORAGE_KEY), GODSEYE_MISSION_PRESET_ID);
    assert.deepEqual(snapshot, {
      readerMode: 'everyday',
      mapMode: 'flat',
      missionPresetId: 'everyday-reader',
      camera: null,
    });
  });

  it('remembers the camera the reader was on so exit can give it back', () => {
    const store = makeStore();
    const camera = { lat: 34.05, lon: -118.24, zoom: 7, altitude: 0.08, view: 'america' };
    engageGodsEyeStage(store, camera);
    assert.deepEqual(releaseGodsEyeStage(store)?.camera, camera);
  });

  it('gives back exactly the pre-stage world on release', () => {
    const store = makeStore({
      [READER_MODE_KEY]: 'everyday',
      [STORAGE_KEYS.mapMode]: JSON.stringify('flat'),
      [MISSION_PRESET_STORAGE_KEY]: 'everyday-reader',
    });

    engageGodsEyeStage(store);
    const restored = releaseGodsEyeStage(store);

    assert.deepEqual(restored, {
      readerMode: 'everyday',
      mapMode: 'flat',
      missionPresetId: 'everyday-reader',
      camera: null,
    });
    assert.equal(store.getItem(STAGE_MODE_KEY), 'dashboard');
    assert.equal(store.getItem(READER_MODE_KEY), 'everyday');
    assert.equal(store.getItem(STORAGE_KEYS.mapMode), JSON.stringify('flat'));
    assert.equal(store.getItem(MISSION_PRESET_STORAGE_KEY), 'everyday-reader');
    assert.equal(store.getItem(STAGE_RESTORE_KEY), null);
  });

  it('clears preferences the reader never had instead of leaving the stage values behind', () => {
    const store = makeStore();
    engageGodsEyeStage(store);
    releaseGodsEyeStage(store);

    assert.equal(store.getItem(READER_MODE_KEY), null);
    assert.equal(store.getItem(STORAGE_KEYS.mapMode), null);
    assert.equal(store.getItem(MISSION_PRESET_STORAGE_KEY), null);
  });

  it('does not overwrite the snapshot when the stage is engaged twice', () => {
    const store = makeStore({
      [READER_MODE_KEY]: 'everyday',
      [MISSION_PRESET_STORAGE_KEY]: 'crisis-desk',
    });

    engageGodsEyeStage(store);
    // A second engage (a re-entered link, a double click) must not capture the
    // stage's own values — that is how a reader loses their layout for good.
    engageGodsEyeStage(store);
    const restored = releaseGodsEyeStage(store);

    assert.equal(restored?.readerMode, 'everyday');
    assert.equal(restored?.missionPresetId, 'crisis-desk');
    assert.equal(store.getItem(MISSION_PRESET_STORAGE_KEY), 'crisis-desk');
  });

  it('reports nothing to restore when no stage was engaged', () => {
    assert.equal(releaseGodsEyeStage(makeStore()), null);
  });

  it('still leaves the stage when the snapshot is missing', () => {
    const store = makeStore({ [STAGE_MODE_KEY]: 'godseye' });
    releaseGodsEyeStage(store);
    assert.equal(getStageMode(store), 'dashboard');
  });

  it('points at a mission preset that actually exists', () => {
    const preset = getMissionPreset(GODSEYE_MISSION_PRESET_ID);
    assert.ok(preset, "the stage's mission preset must be registered");
    assert.ok(preset.layers.length > 0, 'stage preset must stage map layers');
    assert.ok(preset.panels.includes('map'), 'stage preset must keep the map panel');
  });
});

describe('HUD readout formatting', () => {
  it('formats coordinates at a fixed width per hemisphere', () => {
    assert.equal(formatHudLatLon(34.0522, -118.2437), '34.1°N 118.2°W');
    assert.equal(formatHudLatLon(-33.8688, 151.2093), '33.9°S 151.2°E');
  });

  it('zero-pads so the split-flap board never reflows between columns', () => {
    const equator = formatHudLatLon(0, 0);
    const extreme = formatHudLatLon(-89.99, -179.99);
    assert.equal(equator.length, extreme.length);
    assert.equal(equator, '00.0°N 000.0°E');
  });

  it('shows a blank instrument rather than NaN', () => {
    assert.equal(formatHudLatLon(Number.NaN, 0), '--.-°- ---.-°-');
    assert.equal(formatHudLatLon(0, Number.POSITIVE_INFINITY), '--.-°- ---.-°-');
  });

  it('pads the unset readout to a live readout width', () => {
    // The split-flap board reserves one column per character, so a placeholder
    // of a different width makes acquiring a first fix renumber every column
    // instead of flipping the digits that actually changed.
    assert.equal(
      formatHudLatLon(Number.NaN, Number.NaN).length,
      formatHudLatLon(-89.99, -179.99).length,
    );
  });

  it('names the viewing scale from camera altitude', () => {
    assert.equal(formatHudScale(3), 'ORBITAL');
    assert.equal(formatHudScale(2), 'ORBITAL');
    assert.equal(formatHudScale(1.4), 'CONTINENTAL');
    assert.equal(formatHudScale(0.7), 'REGIONAL');
    assert.equal(formatHudScale(0.3), 'THEATRE');
    assert.equal(formatHudScale(0.05), 'LOCAL');
  });

  it('treats an unknown altitude as orbital rather than crashing', () => {
    assert.equal(formatHudScale(Number.NaN), 'ORBITAL');
  });
});

describe('summarizeStageTelemetry', () => {
  it('reports acquisition before the renderer is up', () => {
    assert.equal(summarizeStageTelemetry('acquiring', 0), 'ACQUIRING SIGNAL');
    assert.equal(summarizeStageTelemetry('acquiring', 11), 'ACQUIRING SIGNAL');
  });

  it('reports the live layer count', () => {
    assert.equal(summarizeStageTelemetry('live', 11), 'LIVE · 11 LAYERS');
    assert.equal(summarizeStageTelemetry('live', 1), 'LIVE · 1 LAYER');
    assert.equal(summarizeStageTelemetry('live', 0), 'LIVE · 0 LAYERS');
  });

  it('says offline instead of claiming live data', () => {
    assert.equal(summarizeStageTelemetry('offline', 4), 'OFFLINE · 4 LAYERS');
  });

  it('never renders a fractional or negative count', () => {
    assert.equal(summarizeStageTelemetry('live', -3), 'LIVE · 0 LAYERS');
    assert.equal(summarizeStageTelemetry('live', 2.7), 'LIVE · 2 LAYERS');
  });
});

describe('countActiveLayers', () => {
  it('counts only enabled layers', () => {
    assert.equal(countActiveLayers({ a: true, b: false, c: true }), 2);
    assert.equal(countActiveLayers({}), 0);
    assert.equal(countActiveLayers(null), 0);
    assert.equal(countActiveLayers(undefined), 0);
  });
});
