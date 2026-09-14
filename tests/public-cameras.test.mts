import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PUBLIC_CAMERA_SHARDS,
  boundsIntersect,
  isInBounds,
  isPublicCameraId,
  makePublicCameraId,
  parseCaltransDistrict,
  parseNycDotCameras,
  parseTflJamCams,
  parsePublicCameraId,
} from '../server/worldmonitor/webcam/v1/public-cameras.ts';
import {
  getWebcamSource,
  getWebcamSourceUrl,
  isPublicCameraId as isPublicCameraIdClient,
} from '../src/services/webcams/index.ts';
import { getMissionPreset } from '../src/services/mission-presets.ts';
import { GODSEYE_MISSION_PRESET_ID } from '../src/services/godseye-mode.ts';
import { getAllowedLayerKeys, sanitizeLayersForVariant } from '../src/config/map-layer-definitions.ts';
import { DEFAULT_MAP_LAYERS } from '../src/config/panels.ts';
import { buildMapUrl, parseMapUrlState } from '../src/utils/urlState.ts';

// ─── Fixtures: trimmed to the shape each operator actually publishes ────────

const caltransRow = (overrides: Record<string, unknown> = {}) => ({
  cctv: {
    index: '1',
    location: {
      district: '4',
      locationName: 'TV102 -- I-580 : West of SR-24',
      nearbyPlace: 'Oakland',
      longitude: '-122.27291',
      latitude: '37.82539',
    },
    inService: 'true',
    imageData: {
      streamingVideoURL: 'https://wzmedia.dot.ca.gov/D4/W580_JWO_24_IC.stream/playlist.m3u8',
      static: {
        currentImageURL: 'https://cwwp2.dot.ca.gov/data/d4/cctv/image/tv102i580westofsr24/tv102i580westofsr24.jpg',
      },
    },
    ...overrides,
  },
});

const tflPlace = (overrides: Record<string, unknown> = {}) => ({
  id: 'JamCams_00002.00865',
  commonName: 'A406 Billet Upass E',
  placeType: 'JamCam',
  lat: 51.60067,
  lon: -0.01594,
  additionalProperties: [
    { category: 'payload', key: 'available', value: 'true' },
    { category: 'payload', key: 'imageUrl', value: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00002.00865.jpg' },
    { category: 'payload', key: 'videoUrl', value: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00002.00865.mp4' },
  ],
  ...overrides,
});

const nycCamera = (overrides: Record<string, unknown> = {}) => ({
  id: '8a6bc417-4877-4ebe-8052-88c1b261baf1',
  name: 'Central Park West @ 86 St',
  latitude: 40.785302,
  longitude: -73.969353,
  area: 'Manhattan',
  isOnline: 'true',
  imageUrl: 'https://webcams.nyctmc.org/api/cameras/8a6bc417-4877-4ebe-8052-88c1b261baf1/image',
  ...overrides,
});

describe('public camera normalization — Caltrans', () => {
  it('maps a district record onto the layer\'s camera shape', () => {
    const [camera] = parseCaltransDistrict({ data: [caltransRow()] }, 'caltransd04', '4');
    assert.ok(camera);
    assert.equal(camera.id, 'pub-caltransd04-tv102i580westofsr24');
    assert.equal(camera.title, 'TV102 -- I-580 : West of SR-24 — Oakland');
    assert.equal(camera.lat, 37.82539);
    assert.equal(camera.lng, -122.27291);
    assert.equal(camera.category, 'traffic');
    assert.equal(camera.country, 'United States');
    assert.match(camera.stillUrl, /\.jpg$/);
    assert.match(camera.streamUrl, /\.m3u8$/);
    assert.match(camera.attribution, /Caltrans District 4/);
  });

  it('drops cameras the operator has already marked out of service', () => {
    const cameras = parseCaltransDistrict({ data: [caltransRow({ inService: 'false' })] }, 'caltransd04', '4');
    assert.equal(cameras.length, 0);
  });

  it('drops cameras with no published still image', () => {
    const cameras = parseCaltransDistrict(
      { data: [caltransRow({ imageData: { static: {} } })] },
      'caltransd04',
      '4',
    );
    assert.equal(cameras.length, 0);
  });

  it('drops Null Island coordinates rather than clustering them off Africa', () => {
    const row = caltransRow();
    row.cctv.location.latitude = '0';
    row.cctv.location.longitude = '0';
    assert.equal(parseCaltransDistrict({ data: [row] }, 'caltransd04', '4').length, 0);
  });

  it('deduplicates repeated camera slugs within one district', () => {
    const cameras = parseCaltransDistrict({ data: [caltransRow(), caltransRow()] }, 'caltransd04', '4');
    assert.equal(cameras.length, 1);
  });

  it('survives a malformed document instead of throwing', () => {
    assert.deepEqual(parseCaltransDistrict(null, 'caltransd04', '4'), []);
    assert.deepEqual(parseCaltransDistrict({ data: 'nope' }, 'caltransd04', '4'), []);
    assert.deepEqual(parseCaltransDistrict({ data: [null, {}] }, 'caltransd04', '4'), []);
  });
});

describe('public camera normalization — TfL JamCams', () => {
  it('lifts image and video URLs out of the additionalProperties bag', () => {
    const [camera] = parseTflJamCams([tflPlace()], 'tfllondon');
    assert.ok(camera);
    assert.equal(camera.title, 'A406 Billet Upass E');
    assert.equal(camera.country, 'United Kingdom');
    assert.match(camera.stillUrl, /\.jpg$/);
    assert.match(camera.streamUrl, /\.mp4$/);
    assert.equal(camera.attribution, 'Powered by TfL Open Data');
  });

  it('sanitizes the dotted operator id into the RPC id charset', () => {
    const [camera] = parseTflJamCams([tflPlace()], 'tfllondon');
    assert.equal(camera!.id, 'pub-tfllondon-JamCams_00002_00865');
    // The server's own id guard must accept what the parser emits.
    assert.match(camera!.id, /^[\w-]+$/);
  });

  it('drops cameras TfL reports as unavailable', () => {
    const place = tflPlace({
      additionalProperties: [
        { key: 'available', value: 'false' },
        { key: 'imageUrl', value: 'https://example.invalid/a.jpg' },
      ],
    });
    assert.equal(parseTflJamCams([place], 'tfllondon').length, 0);
  });

  it('survives a malformed document instead of throwing', () => {
    assert.deepEqual(parseTflJamCams(null, 'tfllondon'), []);
    assert.deepEqual(parseTflJamCams([null, {}], 'tfllondon'), []);
  });
});

describe('public camera normalization — NYC DOT', () => {
  it('labels a camera with its borough', () => {
    const [camera] = parseNycDotCameras([nycCamera()], 'nycdot');
    assert.ok(camera);
    assert.equal(camera.title, 'Central Park West @ 86 St (Manhattan)');
    assert.equal(camera.id, 'pub-nycdot-8a6bc417_4877_4ebe_8052_88c1b261baf1');
    assert.equal(camera.streamUrl, '', 'NYC publishes stills only');
    assert.equal(camera.attribution, 'NYC DOT Traffic Management Center');
  });

  it('drops cameras NYC reports as offline', () => {
    assert.equal(parseNycDotCameras([nycCamera({ isOnline: 'false' })], 'nycdot').length, 0);
  });

  it('survives a malformed document instead of throwing', () => {
    assert.deepEqual(parseNycDotCameras(undefined, 'nycdot'), []);
    assert.deepEqual(parseNycDotCameras([null, {}], 'nycdot'), []);
  });
});

describe('public camera ids', () => {
  it('round-trips a shard out of a generated id', () => {
    const id = makePublicCameraId('nycdot', 'abc.def');
    assert.equal(id, 'pub-nycdot-abc_def');
    assert.deepEqual(parsePublicCameraId(id), { shardId: 'nycdot' });
  });

  it('does not claim Windy ids', () => {
    for (const id of ['1234567890', 'windy-cam-9', '', undefined]) {
      assert.equal(isPublicCameraId(id as string), false, `should not claim ${String(id)}`);
    }
  });

  it('agrees with the client-side detector', () => {
    const serverId = makePublicCameraId('tfllondon', 'JamCams_00002.00865');
    assert.equal(isPublicCameraId(serverId), true);
    assert.equal(isPublicCameraIdClient(serverId), true);
    assert.equal(isPublicCameraIdClient('1234567890'), false);
  });

  it('keeps every shard id free of the separator the scheme splits on', () => {
    for (const shard of PUBLIC_CAMERA_SHARDS) {
      assert.ok(!shard.id.includes('-'), `${shard.id} must not contain '-'`);
      assert.match(shard.id, /^[a-z0-9]+$/);
    }
  });
});

describe('public camera attribution', () => {
  it('credits each operator rather than defaulting everything to Windy', () => {
    assert.equal(getWebcamSource('pub-tfllondon-x').attribution, 'Powered by TfL Open Data');
    assert.equal(getWebcamSource('pub-nycdot-x').attribution, 'NYC DOT Traffic Management Center');
    assert.match(getWebcamSource('pub-caltransd07-x').attribution, /Caltrans District 7/);
    assert.equal(getWebcamSource('1234567890').attribution, 'Powered by Windy');
  });

  it('marks only keyless sources as public', () => {
    assert.equal(getWebcamSource('pub-nycdot-x').isPublicSource, true);
    assert.equal(getWebcamSource('1234567890').isPublicSource, false);
  });

  it('never sends a public camera to a Windy page that will not have it', () => {
    assert.equal(getWebcamSourceUrl('pub-nycdot-x'), '');
    assert.equal(
      getWebcamSourceUrl('pub-nycdot-x', { windyUrl: 'https://webcams.nyctmc.org/map' }),
      'https://webcams.nyctmc.org/map',
    );
    assert.equal(getWebcamSourceUrl('1234567890'), 'https://www.windy.com/webcams/1234567890');
  });
});

describe('shard selection', () => {
  const london = { w: -0.3, s: 51.4, e: 0.1, n: 51.6 };

  it('selects only the shards a viewport overlaps', () => {
    const overlapping = PUBLIC_CAMERA_SHARDS.filter((s) => boundsIntersect(s.bounds, london));
    assert.deepEqual(overlapping.map((s) => s.id), ['tfllondon']);
  });

  it('selects the Bay Area district for a San Francisco viewport', () => {
    const sf = { w: -122.6, s: 37.6, e: -122.2, n: 37.9 };
    const ids = PUBLIC_CAMERA_SHARDS.filter((s) => boundsIntersect(s.bounds, sf)).map((s) => s.id);
    assert.ok(ids.includes('caltransd04'), `expected caltransd04 in ${ids.join(',')}`);
    assert.ok(!ids.includes('nycdot'));
  });

  it('reaches every shard from a whole-Earth viewport', () => {
    const world = { w: -180, s: -90, e: 180, n: 90 };
    for (const shard of PUBLIC_CAMERA_SHARDS) {
      assert.ok(boundsIntersect(shard.bounds, world), `${shard.id} unreachable from a global view`);
    }
  });

  it('handles a viewport that wraps the antimeridian', () => {
    const pacific = { w: 170, s: -10, e: -170, n: 10 };
    assert.equal(boundsIntersect({ w: 175, s: -5, e: 179, n: 5 }, pacific), true);
    assert.equal(boundsIntersect({ w: -10, s: -5, e: 10, n: 5 }, pacific), false);
    assert.equal(isInBounds(0, 178, pacific), true);
    assert.equal(isInBounds(0, 0, pacific), false);
  });

  it('excludes records that fall outside the requested viewport', () => {
    assert.equal(isInBounds(51.5, -0.1, london), true);
    assert.equal(isInBounds(40.78, -73.97, london), false);
  });
});

describe("God's Eye stage camera layer", () => {
  it('stages webcams alongside the rest of the globe bundle', () => {
    const preset = getMissionPreset(GODSEYE_MISSION_PRESET_ID);
    assert.ok(preset);
    assert.ok(preset.layers.includes('webcams'), "God's Eye should stage the camera layer");
  });

  it('keeps cameras out of the variants that never allowed them', () => {
    // The surveillance read is wrong for happy, and off-topic for the rest.
    for (const variant of ['happy', 'tech', 'finance', 'commodity', 'energy'] as const) {
      assert.equal(
        getAllowedLayerKeys(variant).has('webcams'),
        false,
        `${variant} must not allow the camera layer`,
      );
      const staged = sanitizeLayersForVariant({ ...DEFAULT_MAP_LAYERS, webcams: true }, variant);
      assert.equal(staged.webcams, false, `${variant} must sanitize a staged camera layer back off`);
    }
  });

  it('allows cameras in the full variant, which is where the stage runs', () => {
    assert.equal(getAllowedLayerKeys('full').has('webcams'), true);
    const staged = sanitizeLayersForVariant({ ...DEFAULT_MAP_LAYERS, webcams: true }, 'full');
    assert.equal(staged.webcams, true);
  });

  it('leaves the layer off by default, so no reader is opted into cameras', () => {
    assert.equal(DEFAULT_MAP_LAYERS.webcams, false);
  });
});

describe('camera layer deep links', () => {
  it('turns the layer on from ?layers=webcams', () => {
    const parsed = parseMapUrlState('?layers=webcams', DEFAULT_MAP_LAYERS);
    assert.equal(parsed.layers?.webcams, true);
  });

  it('turns the layer back off when a shared link omits it', () => {
    const parsed = parseMapUrlState('?layers=conflicts', { ...DEFAULT_MAP_LAYERS, webcams: true });
    assert.equal(parsed.layers?.webcams, false);
  });

  it('round-trips the layer through a shareable URL', () => {
    const url = buildMapUrl('https://example.invalid/', {
      view: 'global',
      zoom: 10,
      center: { lat: 40.75, lon: -73.98 },
      timeRange: '24h',
      layers: { ...DEFAULT_MAP_LAYERS, webcams: true },
    });
    assert.match(url, /layers=[^&]*webcams/);
    assert.equal(parseMapUrlState(new URL(url).search, DEFAULT_MAP_LAYERS).layers?.webcams, true);
  });
});
