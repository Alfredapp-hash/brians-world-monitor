import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyWebcamStreamUrl } from '../src/services/webcams/stream-player.ts';
import { getWebcamStream } from '../src/services/webcams/index.ts';
import {
  parseCaltransDistrict,
  parseNycDotCameras,
  parseTflJamCams,
} from '../server/worldmonitor/webcam/v1/public-cameras.ts';

// Real URL shapes, taken from live responses of each operator.
const CALTRANS_HLS = 'https://wzmedia.dot.ca.gov/D4/W580_JWO_24_IC.stream/playlist.m3u8';
const TFL_MP4 = 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00002.00865.mp4';
const WINDY_EMBED = 'https://webcams.windy.com/webcams/public/embed/player/1234567890/day';

describe('classifyWebcamStreamUrl', () => {
  it('reads a Caltrans playlist as HLS', () => {
    assert.deepEqual(classifyWebcamStreamUrl(CALTRANS_HLS), { url: CALTRANS_HLS, kind: 'hls' });
  });

  it('reads a TfL clip as progressive', () => {
    assert.deepEqual(classifyWebcamStreamUrl(TFL_MP4), { url: TFL_MP4, kind: 'progressive' });
  });

  it('tolerates a query string on the playlist', () => {
    const url = `${CALTRANS_HLS}?wowzatokenhash=abc`;
    assert.equal(classifyWebcamStreamUrl(url)?.kind, 'hls');
  });

  it('is case-insensitive about the extension', () => {
    assert.equal(classifyWebcamStreamUrl('https://example.org/a/B.MP4')?.kind, 'progressive');
  });

  // The gate that matters: Windy's playerUrl is an HTML embed page. A media
  // element pointed at it fails opaquely instead of falling back to the still.
  it('rejects an embeddable player page', () => {
    assert.equal(classifyWebcamStreamUrl(WINDY_EMBED), null);
  });

  it('rejects http, which the media-src CSP would block anyway', () => {
    assert.equal(classifyWebcamStreamUrl('http://wzmedia.dot.ca.gov/D4/x.stream/playlist.m3u8'), null);
  });

  it('rejects empty, absent and unparseable values', () => {
    assert.equal(classifyWebcamStreamUrl(''), null);
    assert.equal(classifyWebcamStreamUrl(undefined), null);
    assert.equal(classifyWebcamStreamUrl(null), null);
    assert.equal(classifyWebcamStreamUrl('/relative/playlist.m3u8'), null);
  });

  it('rejects a still image', () => {
    assert.equal(
      classifyWebcamStreamUrl('https://cwwp2.dot.ca.gov/data/d4/cctv/image/tv102/tv102.jpg'),
      null,
    );
  });
});

describe('getWebcamStream', () => {
  it('plays a public agency HLS stream', () => {
    const stream = getWebcamStream('pub-caltransd04-tv102i580westofsr24', { playerUrl: CALTRANS_HLS });
    assert.deepEqual(stream, { url: CALTRANS_HLS, kind: 'hls' });
  });

  it('plays a public agency MP4 clip', () => {
    const stream = getWebcamStream('pub-tfllondon-JamCams_00002_00865', { playerUrl: TFL_MP4 });
    assert.deepEqual(stream, { url: TFL_MP4, kind: 'progressive' });
  });

  // Windy cameras are periodic stills compiled into a timelapse page; there is
  // no live feed to play, and the field means something different there.
  it('never plays a Windy id, even if its playerUrl looks like media', () => {
    assert.equal(getWebcamStream('1234567890', { playerUrl: CALTRANS_HLS }), null);
    assert.equal(getWebcamStream('1234567890', { playerUrl: WINDY_EMBED }), null);
  });

  it('leaves a stills-only public camera on the still path', () => {
    assert.equal(getWebcamStream('pub-nycdot-8a6bc417_4877_4ebe', { playerUrl: '' }), null);
    assert.equal(getWebcamStream('pub-nycdot-8a6bc417_4877_4ebe', {}), null);
    assert.equal(getWebcamStream('pub-nycdot-8a6bc417_4877_4ebe', null), null);
  });
});

// The server parsers and the client playback gate are the two ends of one
// contract. These assert they still agree: a stream the parser keeps must be one
// the popup will attempt, and a source with no stream must not claim one.
describe('parsed records classify as the operator publishes them', () => {
  it('Caltrans records carry a playable HLS stream', () => {
    const raw = {
      data: [{
        cctv: {
          index: '1',
          location: { locationName: 'TV102 -- I-580', nearbyPlace: 'Oakland', latitude: '37.82539', longitude: '-122.27291' },
          inService: 'true',
          imageData: {
            streamingVideoURL: CALTRANS_HLS,
            static: { currentImageURL: 'https://cwwp2.dot.ca.gov/data/d4/cctv/image/tv102/tv102.jpg' },
          },
        },
      }],
    };
    const [record] = parseCaltransDistrict(raw, 'caltransd04', '4');
    assert.ok(record);
    assert.equal(getWebcamStream(record.id, { playerUrl: record.streamUrl })?.kind, 'hls');
  });

  it('TfL records carry a playable MP4', () => {
    const raw = [{
      id: 'JamCams_00002.00865',
      commonName: 'A406 Billet Upass E',
      lat: 51.60067,
      lon: -0.01594,
      additionalProperties: [
        { key: 'available', value: 'true' },
        { key: 'imageUrl', value: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00002.00865.jpg' },
        { key: 'videoUrl', value: TFL_MP4 },
      ],
    }];
    const [record] = parseTflJamCams(raw, 'tfllondon');
    assert.ok(record);
    assert.equal(getWebcamStream(record.id, { playerUrl: record.streamUrl })?.kind, 'progressive');
  });

  it('NYC DOT records resolve to no stream at all', () => {
    const raw = [{
      id: '8a6bc417-4877-4ebe-8052-88c1b261baf1',
      name: '1 Ave @ 42 St',
      area: 'Manhattan',
      isOnline: 'true',
      latitude: 40.7509,
      longitude: -73.9683,
      imageUrl: 'https://webcams.nyctmc.org/api/cameras/8a6bc417/image',
    }];
    const [record] = parseNycDotCameras(raw, 'nycdot');
    assert.ok(record);
    assert.equal(record.streamUrl, '');
    assert.equal(getWebcamStream(record.id, { playerUrl: record.streamUrl }), null);
  });
});
