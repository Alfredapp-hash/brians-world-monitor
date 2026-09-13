/**
 * Live playback for the public half of the webcam layer.
 *
 * WHY THIS EXISTS. Caltrans and TfL already hand us a media URL alongside the
 * still (`GetWebcamImageResponse.playerUrl`), and until now every popup threw it
 * away and rendered the JPEG. This module turns that URL into a `<video>`.
 *
 * WHAT THE UPSTREAMS ACTUALLY DO, measured rather than assumed:
 *
 *   - TfL JamCams publish a ~130KB MP4 clip per camera on S3 with
 *     `Access-Control-Allow-Origin: *`. It is a short loop refreshed in place,
 *     not a continuous feed, so progressive playback is looped.
 *   - Caltrans publish HLS from a Wowza server (`wzmedia.dot.ca.gov`). Roughly a
 *     third of the listed streams answer at any moment; the rest return 404
 *     (camera not publishing) or 403. A 200 carries `Access-Control-Allow-Origin: *`,
 *     so hls.js can read it — but the 403s are *load shedding*, not a permanent
 *     verdict, and they arrive in bursts once a client has opened a handful of
 *     streams in quick succession. That is why retries here are deliberately
 *     stingier than the Live News player's: a popup that hammers the playlist
 *     turns a recoverable 403 into a persistent one for the whole browser.
 *   - NYC DOT publish stills only. `getWebcamStream` returns null and the popup
 *     keeps the behaviour it already had.
 *
 * Because a majority of Caltrans cameras are legitimately not streaming, failure
 * is the common path, not the exception: every entry point here ends in either a
 * playing video or one `onUnavailable` call, and the caller is expected to put
 * the still back when that fires.
 */

/** Playback strategies the popup knows how to drive. */
export type WebcamStreamKind = 'hls' | 'progressive';

export interface WebcamStream {
  url: string;
  kind: WebcamStreamKind;
}

/** Why playback stopped being possible. Reported for logging, not shown verbatim. */
export type WebcamPlaybackFailure =
  /** Manifest/segment/media load failed — 403, 404, CORS, DNS, timeout. */
  | 'network'
  /** The container or codec decoded on neither the native path nor hls.js. */
  | 'media'
  /** No HLS support at all: not Safari, and hls.js reports the platform unusable. */
  | 'unsupported'
  /** Nothing ever reached the `playing` state inside the start budget. */
  | 'timeout';

/**
 * A stream URL is only played when its extension names a container a `<video>`
 * can take. This is the gate that keeps Windy's `playerUrl` out: that field
 * carries an *embed page* (`webcams.windy.com/.../embed/player/<id>/day`), which
 * would load as an HTML document into a media element and fail opaquely.
 *
 * Query strings are tolerated (`playlist.m3u8?token=…`); anything else — an
 * `http:` URL, a bare directory, a page — is not a stream as far as this
 * module is concerned.
 */
export function classifyWebcamStreamUrl(url: string | null | undefined): WebcamStream | null {
  if (!url || typeof url !== 'string') return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // Mixed content would be blocked by the browser anyway, and our CSP only
  // admits `https:` for media-src.
  if (parsed.protocol !== 'https:') return null;

  const path = parsed.pathname.toLowerCase();
  if (path.endsWith('.m3u8')) return { url, kind: 'hls' };
  if (path.endsWith('.mp4') || path.endsWith('.webm')) return { url, kind: 'progressive' };
  return null;
}

export interface WebcamPlayerOptions {
  stream: WebcamStream;
  /** The operator's still, used as the poster so the frame is never empty. */
  posterUrl?: string;
  /**
   * Rendered width in px, for the map popups whose preview is a fixed 200px
   * column. Omit to let the caller's own CSS size the element — the pinned
   * panel fills a grid slot.
   */
  width?: number;
  /** Extra class on the wrapper, so callers can size/position it. */
  className?: string;
  /**
   * Start muted playback without waiting for a click. Muted autoplay is
   * permitted by browser policy; when it is refused anyway the player degrades
   * to a click-to-play button rather than reporting failure.
   */
  autoplay?: boolean;
  /**
   * Fired once, when frames are actually moving. Popups use this to cancel their
   * auto-dismiss timer — a feed the user is watching should not vanish.
   */
  onPlaying?: () => void;
  /**
   * Fired at most once, when playback is over for good. The caller renders the
   * still and its "open at source" link from here.
   */
  onUnavailable?: (reason: WebcamPlaybackFailure) => void;
}

export interface WebcamPlayerHandle {
  /** Mount this. Teardown is driven by `destroy()`, not by removing it. */
  element: HTMLElement;
  destroy(): void;
}

/**
 * How long a stream gets to produce its first frame. Caltrans' Wowza answers or
 * refuses in well under a second when it is healthy; a stall past this is a
 * silently wedged connection, which the native-HLS path reports no other way.
 */
const START_TIMEOUT_MS = 12_000;

/**
 * The popup can be torn down by any of several unrelated paths (close button,
 * auto-dismiss, marker re-click, map re-render). Rather than requiring every one
 * of them to know about the player, poll for detachment: an hls.js instance left
 * running keeps pulling segments forever, and on Caltrans that is exactly the
 * traffic that earns a 403.
 */
const DETACH_POLL_MS = 4000;

/** Conservative retry budget — see the 403 load-shedding note in the file header. */
const HLS_CONFIG = {
  enableWorker: true,
  lowLatencyMode: false,
  manifestLoadingMaxRetry: 1,
  manifestLoadingTimeOut: 8000,
  levelLoadingMaxRetry: 1,
  fragLoadingMaxRetry: 2,
  // Traffic cameras are watched live, in a popup, for seconds. Holding a long
  // back buffer costs memory for tape nobody rewinds.
  backBufferLength: 10,
} as const;

export function createWebcamPlayer(options: WebcamPlayerOptions): WebcamPlayerHandle {
  const { stream, posterUrl, width, autoplay = true } = options;

  const wrapper = document.createElement('div');
  wrapper.className = options.className
    ? `webcam-stream-player ${options.className}`
    : 'webcam-stream-player';
  if (width !== undefined) wrapper.style.width = `${width}px`;

  const video = document.createElement('video');
  video.className = 'webcam-stream-video';
  // No webcam in this layer carries an audio track, and an unmuted element is
  // also what browsers refuse to autoplay.
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.controls = false;
  video.preload = 'none';
  // A short clip refreshed in place reads as a still that twitches once unless
  // it loops; a live HLS playlist must not loop.
  video.loop = stream.kind === 'progressive';
  video.setAttribute('referrerpolicy', 'no-referrer');
  if (posterUrl) video.poster = posterUrl;
  wrapper.appendChild(video);

  const badge = document.createElement('span');
  badge.className = 'webcam-stream-badge';
  badge.textContent = stream.kind === 'hls' ? 'LIVE' : 'LOOP';
  badge.hidden = true;
  wrapper.appendChild(badge);

  let playButton: HTMLButtonElement | null = null;
  let hls: { destroy(): void } | null = null;
  let startTimer: ReturnType<typeof setTimeout> | null = null;
  let detachTimer: ReturnType<typeof setInterval> | null = null;
  let settled = false;
  let disposed = false;

  const clearTimers = (): void => {
    if (startTimer !== null) { clearTimeout(startTimer); startTimer = null; }
    if (detachTimer !== null) { clearInterval(detachTimer); detachTimer = null; }
  };

  const teardownMedia = (): void => {
    if (hls) { try { hls.destroy(); } catch { /* already gone */ } hls = null; }
    try {
      video.pause();
      video.removeAttribute('src');
      video.load();
    } catch { /* detached element */ }
  };

  const destroy = (): void => {
    if (disposed) return;
    disposed = true;
    settled = true;
    clearTimers();
    teardownMedia();
  };

  /** Single-shot: playback is over, hand the popup back its still. */
  const fail = (reason: WebcamPlaybackFailure): void => {
    if (settled || disposed) return;
    settled = true;
    clearTimers();
    teardownMedia();
    console.warn('[webcams] stream playback unavailable:', reason, stream.url);
    options.onUnavailable?.(reason);
  };

  const succeed = (): void => {
    if (settled || disposed) return;
    settled = true;
    if (startTimer !== null) { clearTimeout(startTimer); startTimer = null; }
    badge.hidden = false;
    playButton?.remove();
    playButton = null;
    options.onPlaying?.();
  };

  video.addEventListener('playing', succeed);

  /**
   * Muted autoplay refused (policy, low-power mode, an extension) is not a
   * broken stream — surface a play button instead of the offline still.
   */
  const showPlayButton = (): void => {
    if (settled || disposed || playButton) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'webcam-stream-play';
    button.textContent = '\u25B6 Play live';
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      void video.play().catch(() => { /* the user can click again */ });
    });
    playButton = button;
    wrapper.appendChild(button);
  };

  const attemptPlay = (): void => {
    if (!autoplay || disposed) return;
    const attempt = video.play();
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch(() => {
        if (settled || disposed) return;
        showPlayButton();
      });
    }
  };

  startTimer = setTimeout(() => fail('timeout'), START_TIMEOUT_MS);
  detachTimer = setInterval(() => {
    if (!wrapper.isConnected) destroy();
  }, DETACH_POLL_MS);

  if (stream.kind === 'progressive') {
    video.preload = 'auto';
    video.src = stream.url;
    video.addEventListener('error', () => fail('media'));
    attemptPlay();
    return { element: wrapper, destroy };
  }

  // Safari and every WKWebView (so also the Tauri shell on macOS) play HLS from
  // a plain `src`; loading hls.js there would be dead weight.
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.preload = 'auto';
    video.src = stream.url;
    video.addEventListener('error', () => fail('network'));
    attemptPlay();
    return { element: wrapper, destroy };
  }

  void (async () => {
    let Hls: typeof import('hls.js').default;
    try {
      ({ default: Hls } = await import('hls.js'));
    } catch {
      fail('unsupported');
      return;
    }
    if (disposed || !wrapper.isConnected) return;
    if (!Hls.isSupported()) {
      fail('unsupported');
      return;
    }

    const instance = new Hls(HLS_CONFIG);
    hls = instance;
    instance.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      fail(data.type === Hls.ErrorTypes.MEDIA_ERROR ? 'media' : 'network');
    });
    instance.loadSource(stream.url);
    instance.attachMedia(video);
    attemptPlay();
  })();

  return { element: wrapper, destroy };
}
