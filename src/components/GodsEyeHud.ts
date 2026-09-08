/**
 * God's Eye HUD — the film-title chrome that floats over the globe stage.
 *
 * Composition follows the four peripheral corridors of a heads-up display, so
 * the optical centre of the globe is never covered:
 *
 *   top-left      brand titlecard + classification strip
 *   bottom-left   live camera readout (centre coordinates, viewing scale)
 *   bottom-right  signal status board
 *   top-right     the interactive control rail (exit, layers, dimension)
 *
 * Everything except the control rail is `pointer-events: none`, so the reader
 * can drag the globe straight through the HUD. The readouts are driven by a
 * caller-supplied provider rather than by reaching into the map, which keeps
 * this component free of renderer knowledge and lets the app layer decide what
 * it can honestly report.
 */

import { h } from '@/utils/dom-utils';
import { setSplitFlapText } from '@/utils/split-flap';
import {
  formatHudLatLon,
  formatHudScale,
  summarizeStageTelemetry,
  type StageSignalState,
} from '@/services/godseye-mode';

/** Cadence of the HUD readout repaint. Slow enough to read, fast enough to track a drag. */
const HUD_TICK_MS = 500;

/**
 * How far the view centre must move, in degrees, before the coordinate board
 * flaps rather than simply updating.
 *
 * The globe idles with a slow auto-rotation, so the longitude readout changes
 * on every single tick. Flapping each of those turned the board into permanent
 * noise — the opposite of an instrument. A real split-flap fires on an EVENT,
 * so the board now flaps when the view jumps (a country selection, a preset,
 * a fling) and tracks silently through drift. The threshold sits above the
 * per-tick idle drift and below any deliberate move.
 */
const COORD_FLAP_DEGREES = 1.5;

export interface GodsEyeTelemetry {
  /** Globe centre, or null when the renderer has not reported one yet. */
  center: { lat: number; lon: number } | null;
  /** Camera altitude in Earth radii, or null on a flat renderer. */
  altitude: number | null;
  activeLayerCount: number;
  signal: StageSignalState;
}

export interface GodsEyeHudOptions {
  /** Product name shown in the titlecard. */
  title: string;
  readTelemetry: () => GodsEyeTelemetry;
  onExit: () => void;
  /** Show/hide the floating panel rail. Receives the requested next state. */
  onToggleRail?: (visible: boolean) => void;
  /** Whether the rail starts visible. */
  railVisible?: boolean;
}

export class GodsEyeHud {
  readonly element: HTMLElement;
  private readonly options: GodsEyeHudOptions;
  private readonly coordEl: HTMLElement;
  private readonly scaleEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private tickTimer: number | null = null;
  private destroyed = false;
  /** Last centre the coordinate board reported, for the drift-vs-jump test. */
  private lastCenter: { lat: number; lon: number } | null = null;

  constructor(options: GodsEyeHudOptions) {
    this.options = options;

    this.coordEl = h('span', { className: 'godseye-hud__readout' }, formatHudLatLon(NaN, NaN));
    this.scaleEl = h('span', { className: 'godseye-hud__readout' }, 'ORBITAL');
    this.statusEl = h('span', { className: 'godseye-hud__readout' }, 'ACQUIRING SIGNAL');

    const titleCard = h(
      'div',
      { className: 'godseye-hud__corner godseye-hud__corner--tl' },
      h('span', { className: 'godseye-hud__bracket', 'aria-hidden': 'true' }),
      h(
        'div',
        { className: 'godseye-hud__stack' },
        h('span', { className: 'godseye-hud__classification' }, 'Open sources · global'),
        h('p', { className: 'godseye-hud__title' }, options.title),
      ),
    );

    const cameraCard = h(
      'div',
      { className: 'godseye-hud__corner godseye-hud__corner--bl' },
      h('span', { className: 'godseye-hud__bracket', 'aria-hidden': 'true' }),
      h(
        'div',
        { className: 'godseye-hud__stack' },
        h('span', { className: 'godseye-hud__label' }, 'View centre'),
        this.coordEl,
        h('span', { className: 'godseye-hud__label' }, 'Scale'),
        this.scaleEl,
      ),
    );

    // The status board is the one HUD element assistive tech should follow —
    // it is the only place the stage reports acquisition changes.
    const statusCard = h(
      'div',
      { className: 'godseye-hud__corner godseye-hud__corner--br' },
      h('span', { className: 'godseye-hud__bracket', 'aria-hidden': 'true' }),
      h(
        'div',
        { className: 'godseye-hud__stack', role: 'status', 'aria-live': 'polite' },
        h('span', { className: 'godseye-hud__label' }, 'Signal'),
        h(
          'span',
          { className: 'godseye-hud__readout' },
          h('span', { className: 'godseye-hud__pulse', 'aria-hidden': 'true' }),
          this.statusEl,
        ),
      ),
    );

    this.element = h(
      'div',
      { className: 'godseye-hud', 'data-godseye-hud': '' },
      titleCard,
      cameraCard,
      statusCard,
      this.buildControls(),
    );
  }

  private buildControls(): HTMLElement {
    const exitBtn = h(
      'button',
      {
        type: 'button',
        className: 'godseye-hud__btn godseye-hud__btn--exit',
        id: 'godseyeExitBtn',
        title: "Leave God's Eye and restore your previous view",
      },
      'Exit',
      h('kbd', { 'aria-hidden': 'true' }, 'Esc'),
    ) as HTMLButtonElement;
    exitBtn.addEventListener('click', () => this.options.onExit());

    const controls = h(
      'div',
      { className: 'godseye-hud__controls' },
      exitBtn,
    );

    if (this.options.onToggleRail) {
      let visible = this.options.railVisible !== false;
      const railBtn = h(
        'button',
        {
          type: 'button',
          className: 'godseye-hud__btn',
          id: 'godseyeRailBtn',
          title: 'Show or hide the intelligence panels',
          'aria-pressed': String(visible),
        },
        'Panels',
      ) as HTMLButtonElement;
      railBtn.addEventListener('click', () => {
        visible = !visible;
        railBtn.setAttribute('aria-pressed', String(visible));
        this.options.onToggleRail?.(visible);
      });
      controls.insertBefore(railBtn, exitBtn);
    }

    return controls;
  }

  /** Fade the HUD in and begin the readout ticker. */
  start(): void {
    if (this.destroyed || this.tickTimer !== null) return;
    // One frame of delay so the fade transition has a starting value to run from.
    requestAnimationFrame(() => {
      if (!this.destroyed) this.element.classList.add('is-live');
    });
    this.refresh();
    this.tickTimer = window.setInterval(() => this.refresh(), HUD_TICK_MS);
  }

  /**
   * Did the view centre JUMP, or is this the globe drifting?
   *
   * Acquiring a first fix, or losing one, counts as a jump — those are the
   * events the board most wants to announce. Longitude is compared the short
   * way round so crossing the antimeridian reads as the ~1° step it is rather
   * than a 358° leap.
   */
  private isCoordJump(next: { lat: number; lon: number } | null): boolean {
    const previous = this.lastCenter;
    if (!previous || !next) return previous !== next;
    const dLat = Math.abs(next.lat - previous.lat);
    const dLonRaw = Math.abs(next.lon - previous.lon) % 360;
    const dLon = Math.min(dLonRaw, 360 - dLonRaw);
    return Math.max(dLat, dLon) >= COORD_FLAP_DEGREES;
  }

  /** Repaint the readouts from the provider. Cheap: three no-op string writes when idle. */
  refresh(): void {
    if (this.destroyed) return;
    let telemetry: GodsEyeTelemetry;
    try {
      telemetry = this.options.readTelemetry();
    } catch {
      // A provider that throws must not kill the ticker — the HUD simply holds
      // its last honest readout.
      return;
    }

    const { center, altitude, activeLayerCount, signal } = telemetry;
    setSplitFlapText(
      this.coordEl,
      center ? formatHudLatLon(center.lat, center.lon) : formatHudLatLon(NaN, NaN),
      // Drift updates the digits in place; only a jump earns the cascade.
      { immediate: !this.isCoordJump(center) },
    );
    this.lastCenter = center;
    // A flat renderer has no altitude, so the scale band is unknown rather
    // than silently reported as orbital.
    setSplitFlapText(this.scaleEl, altitude === null ? 'SURFACE' : formatHudScale(altitude));
    setSplitFlapText(this.statusEl, summarizeStageTelemetry(signal, activeLayerCount));
  }

  destroy(): void {
    this.destroyed = true;
    if (this.tickTimer !== null) {
      window.clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.element.remove();
  }
}
