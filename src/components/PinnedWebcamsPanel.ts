import { Panel } from './Panel';
import { t } from '../services/i18n';
import {
  getPinnedWebcams,
  getActiveWebcams,
  unpinWebcam,
  toggleWebcam,
  onPinnedChange,
} from '../services/webcams/pinned-store';
import { classifyWebcamStreamUrl, createWebcamPlayer } from '../services/webcams/stream-player';
import { isPublicCameraId } from '../services/webcams';
import type { WebcamPlayerHandle } from '../services/webcams/stream-player';

const MAX_SLOTS = 4;
const PLAYER_FALLBACK = 'https://webcams.windy.com/webcams/public/embed/player';

/**
 * Windy's embed page for a pinned camera. Only Windy ids have one: their public
 * player URL is a deterministic function of the id, which is why this fallback
 * can exist at all. A public-agency id run through it would build a Windy URL
 * for a camera Windy has never heard of.
 */
function buildPlayerUrl(webcamId: string, playerUrl?: string): string | null {
  if (playerUrl) return playerUrl;
  if (isPublicCameraId(webcamId)) return null;
  return `${PLAYER_FALLBACK}/${encodeURIComponent(webcamId)}/day`;
}

export class PinnedWebcamsPanel extends Panel {
  private unsubscribe: (() => void) | null = null;
  // One per grid slot: the panel is a wall of simultaneous feeds, so players are
  // tracked as a set rather than a single active stream.
  private players: WebcamPlayerHandle[] = [];

  constructor() {
    super({ id: 'windy-webcams', title: t('panels.windyWebcams'), className: 'panel-wide', closable: true });
    this.unsubscribe = onPinnedChange(() => this.render());
    this.render();
  }

  private destroyPlayers(): void {
    for (const player of this.players) player.destroy();
    this.players = [];
  }

  /**
   * Fill a slot with whatever the pinned camera can actually show.
   *
   * The stored `playerUrl` is provider-shaped: Windy ids carry an embeddable
   * page, agency ids carry an HLS playlist or an MP4. Feeding a `.m3u8` to an
   * iframe — which is what this panel did before playback was wired — renders
   * the playlist as text or triggers a download.
   */
  private fillSlot(slot: HTMLElement, cam: { webcamId: string; title: string; playerUrl: string }): void {
    const stream = classifyWebcamStreamUrl(cam.playerUrl);
    if (stream) {
      const player = createWebcamPlayer({
        stream,
        className: 'pinned-webcam-player',
        onUnavailable: () => {
          if (!slot.isConnected) return;
          player.element.remove();
          const offline = document.createElement('div');
          offline.className = 'pinned-webcam-placeholder';
          offline.textContent = '\u{1F4F7}\u200A\u2715 Stream unavailable';
          slot.prepend(offline);
        },
      });
      this.players.push(player);
      slot.appendChild(player.element);
      return;
    }

    const embedUrl = buildPlayerUrl(cam.webcamId, cam.playerUrl);
    if (!embedUrl) {
      const stillsOnly = document.createElement('div');
      stillsOnly.className = 'pinned-webcam-placeholder';
      stillsOnly.textContent = 'Stills only \u2014 view on the map';
      slot.appendChild(stillsOnly);
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.className = 'pinned-webcam-iframe';
    iframe.src = embedUrl;
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
    iframe.setAttribute('frameborder', '0');
    iframe.title = cam.title || cam.webcamId;
    iframe.allow = 'autoplay; encrypted-media';
    iframe.allowFullscreen = true;
    iframe.setAttribute('loading', 'lazy');
    slot.appendChild(iframe);
  }

  private render(): void {
    this.destroyPlayers();
    while (this.content.firstChild) this.content.removeChild(this.content.firstChild);
    this.content.className = 'panel-content pinned-webcams-content';

    const active = getActiveWebcams();
    const allPinned = getPinnedWebcams();

    const grid = document.createElement('div');
    grid.className = 'pinned-webcams-grid';

    for (let i = 0; i < MAX_SLOTS; i++) {
      const slot = document.createElement('div');
      slot.className = 'pinned-webcam-slot';

      const cam = active[i];
      if (cam) {
        this.fillSlot(slot, cam);

        const labelBar = document.createElement('div');
        labelBar.className = 'pinned-webcam-label';

        const titleSpan = document.createElement('span');
        titleSpan.className = 'pinned-webcam-title';
        titleSpan.textContent = cam.title || cam.webcamId;
        labelBar.appendChild(titleSpan);

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'pinned-webcam-toggle';
        toggleBtn.title = 'Hide stream';
        toggleBtn.textContent = '\u23F8';
        toggleBtn.addEventListener('click', () => toggleWebcam(cam.webcamId));
        labelBar.appendChild(toggleBtn);

        const unpinBtn = document.createElement('button');
        unpinBtn.className = 'pinned-webcam-unpin';
        unpinBtn.title = 'Unpin';
        unpinBtn.textContent = '\u2716';
        unpinBtn.addEventListener('click', () => unpinWebcam(cam.webcamId));
        labelBar.appendChild(unpinBtn);

        slot.appendChild(labelBar);
      } else {
        slot.classList.add('pinned-webcam-slot--empty');
        const placeholder = document.createElement('div');
        placeholder.className = 'pinned-webcam-placeholder';
        placeholder.textContent = t('components.pinnedWebcams.pinFromMap') || 'Pin a webcam from the map';
        slot.appendChild(placeholder);
      }

      grid.appendChild(slot);
    }

    this.content.appendChild(grid);

    if (allPinned.length > MAX_SLOTS) {
      const listSection = document.createElement('div');
      listSection.className = 'pinned-webcams-list';

      const listHeader = document.createElement('div');
      listHeader.className = 'pinned-webcams-list-header';
      listHeader.textContent = `Pinned (${allPinned.length})`;
      listSection.appendChild(listHeader);

      allPinned.forEach(cam => {
        const row = document.createElement('div');
        row.className = 'pinned-webcam-row';
        if (cam.active) row.classList.add('pinned-webcam-row--active');

        const name = document.createElement('span');
        name.className = 'pinned-webcam-row-name';
        name.textContent = cam.title || cam.webcamId;
        row.appendChild(name);

        const country = document.createElement('span');
        country.className = 'pinned-webcam-row-country';
        country.textContent = cam.country;
        row.appendChild(country);

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'pinned-webcam-row-toggle';
        toggleBtn.textContent = cam.active ? 'ON' : 'OFF';
        toggleBtn.addEventListener('click', () => toggleWebcam(cam.webcamId));
        row.appendChild(toggleBtn);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'pinned-webcam-row-remove';
        removeBtn.textContent = '\u2716';
        removeBtn.title = 'Unpin';
        removeBtn.addEventListener('click', () => unpinWebcam(cam.webcamId));
        row.appendChild(removeBtn);

        listSection.appendChild(row);
      });

      this.content.appendChild(listSection);
    }
  }

  public refresh(): void {
    this.render();
  }

  public destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.destroyPlayers();
    this.content.querySelectorAll('iframe').forEach(f => {
      f.src = 'about:blank';
      f.remove();
    });
    super.destroy();
  }
}
