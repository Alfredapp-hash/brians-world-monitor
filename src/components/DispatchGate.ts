import { BRAND, createBrandLockup } from '@/config/brand';
import { openSignUp } from '@/services/clerk';
import {
  DISPATCH_FLY_MS,
  hasFlyableLocation,
  markDispatchEntered,
  persistHomeLocation,
  type DispatchHomeLocation,
} from '@/services/dispatch-gate';
import { applyStageModeToDocument } from '@/services/godseye-mode';
import { h } from '@/utils/dom-utils';
import {
  lookupPostalCode,
  regionFromCoordinates,
  requestUserGeolocation,
  resolveUserCountryCode,
  type PostalLookupResult,
} from '@/utils/user-location';

export type DispatchGateEnterHandler = (location: DispatchHomeLocation) => void | Promise<void>;

/** First-paint copy. Kept as literals so the overlay does not inflate en.shell.json. */
const COPY = {
  postalLabel: 'Postal / ZIP code',
  postalPlaceholder: 'Optional — 10001, SW1A 1AA, …',
  useMyLocation: 'Use my location',
  locating: 'Locating…',
  enter: 'Enter The Dispatch',
  createAccount: 'Create account',
  guestNoLocation: 'Continue without a location',
  lookupError: "We couldn't find that postal code. You can still enter without a location.",
  lookingUp: 'Looking up location…',
  geoError: 'Location is unavailable. Enter a postal code, or continue without one.',
  escapeHint: 'Press Escape to enter as a guest without a location',
} as const;

export function isDispatchGateOpen(): boolean {
  return document.documentElement.dataset.dispatchGate === 'open';
}

export function applyDispatchGatePresentation(): void {
  const root = document.documentElement;
  root.dataset.stageMode = 'godseye';
  root.dataset.dispatchGate = 'open';
  root.classList.remove('wm-map-collapsed');
}

export function clearDispatchGatePresentation(): void {
  delete document.documentElement.dataset.dispatchGate;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export async function playDispatchEntryCinematic(
  map: {
    isGlobeMode(): boolean;
    setCenter(lat: number, lon: number, zoom?: number): void;
    switchToFlat(options?: { immediate?: boolean }): void | Promise<void>;
  } | null,
  location: DispatchHomeLocation | null,
  beforeDashboard?: () => void,
): Promise<void> {
  const reduced = prefersReducedMotion();
  const flyable = hasFlyableLocation(location);

  if (flyable && map) {
    map.setCenter(location.lat, location.lon, 4);
    if (!reduced && map.isGlobeMode()) {
      await sleep(DISPATCH_FLY_MS);
    }
  }

  if (map?.isGlobeMode()) {
    await Promise.resolve(map.switchToFlat({ immediate: true }));
  }

  if (flyable && map) {
    map.setCenter(location.lat, location.lon, 4);
  }

  beforeDashboard?.();
  clearDispatchGatePresentation();
  applyStageModeToDocument('dashboard');

  if (!reduced) {
    const root = document.documentElement;
    root.dataset.dispatchEntering = '1';
    await sleep(420);
    delete root.dataset.dispatchEntering;
  }
}

export class DispatchGate {
  readonly element: HTMLElement;
  private readonly onEnter: DispatchGateEnterHandler;
  private readonly postalInput: HTMLInputElement;
  private readonly errorEl: HTMLElement;
  private readonly geoBtn: HTMLButtonElement;
  private readonly enterBtn: HTMLButtonElement;
  private readonly signupBtn: HTMLButtonElement;
  private readonly skipBtn: HTMLButtonElement;
  private defaultCountry: string | null = null;
  private geoCoords: { lat: number; lon: number } | null = null;
  private busy = false;
  private destroyed = false;
  private previouslyFocused: HTMLElement | null = null;
  private lookupAbort: AbortController | null = null;

  constructor(onEnter: DispatchGateEnterHandler) {
    this.onEnter = onEnter;

    const lockup = createBrandLockup('#');
    lockup.tabIndex = -1;
    lockup.addEventListener('click', (event) => event.preventDefault());

    this.postalInput = h('input', {
      id: 'dispatchGatePostal',
      className: 'dispatch-gate__input',
      type: 'text',
      name: 'postal',
      autocomplete: 'postal-code',
      spellcheck: 'false',
      inputmode: 'text',
      placeholder: COPY.postalPlaceholder,
      'aria-describedby': 'dispatchGateError',
    }) as HTMLInputElement;

    this.geoBtn = h('button', {
      type: 'button',
      className: 'dispatch-gate__geo',
      id: 'dispatchGateGeoBtn',
    }, COPY.useMyLocation) as HTMLButtonElement;

    this.errorEl = h('p', {
      className: 'dispatch-gate__error',
      id: 'dispatchGateError',
      role: 'status',
      'aria-live': 'polite',
    });

    this.enterBtn = h('button', {
      type: 'button',
      className: 'dispatch-gate__primary',
      id: 'dispatchGateEnterBtn',
    }, COPY.enter) as HTMLButtonElement;

    this.signupBtn = h('button', {
      type: 'button',
      className: 'dispatch-gate__secondary',
      id: 'dispatchGateSignupBtn',
    }, COPY.createAccount) as HTMLButtonElement;

    this.skipBtn = h('button', {
      type: 'button',
      className: 'dispatch-gate__tertiary',
      id: 'dispatchGateSkipBtn',
    }, COPY.guestNoLocation) as HTMLButtonElement;

    const plate = h('div', { className: 'dispatch-gate__plate wm-plate' },
      h('p', { className: 'dispatch-gate__eyebrow' }, BRAND.shortName),
      lockup,
      h('div', {},
        h('h1', { className: 'dispatch-gate__title', id: 'dispatchGateTitle' }, BRAND.name),
        h('p', { className: 'dispatch-gate__tagline' }, BRAND.tagline),
      ),
      h('div', { className: 'dispatch-gate__field' },
        h('label', { className: 'dispatch-gate__label', 'for': 'dispatchGatePostal' }, COPY.postalLabel),
        this.postalInput,
        this.geoBtn,
      ),
      this.errorEl,
      h('div', { className: 'dispatch-gate__actions' },
        this.enterBtn,
        this.signupBtn,
        this.skipBtn,
      ),
      h('p', { className: 'dispatch-gate__hint' }, COPY.escapeHint),
    );

    this.element = h('div', {
      className: 'dispatch-gate',
      id: 'dispatchGate',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'dispatchGateTitle',
      'aria-label': BRAND.name,
    }, plate);

    this.element.addEventListener('keydown', (event) => this.onKeydown(event));
    this.enterBtn.addEventListener('click', () => { void this.submit('guest'); });
    this.signupBtn.addEventListener('click', () => { void this.submit('signup'); });
    this.skipBtn.addEventListener('click', () => { void this.submit('skip'); });
    this.geoBtn.addEventListener('click', () => { void this.useDeviceLocation(); });

    document.body.appendChild(this.element);
    this.previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    requestAnimationFrame(() => {
      if (this.destroyed) return;
      this.element.classList.add('is-open');
      this.postalInput.focus();
    });

    void resolveUserCountryCode().then((code) => {
      if (!this.destroyed) this.defaultCountry = code;
    });
  }

  private focusables(): HTMLElement[] {
    return [this.postalInput, this.geoBtn, this.enterBtn, this.signupBtn, this.skipBtn]
      .filter((el) => !el.disabled);
  }

  private onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.lookupAbort?.abort();
      this.busy = false;
      void this.submit('skip');
      return;
    }
    if (event.key === 'Enter' && event.target === this.postalInput) {
      event.preventDefault();
      void this.submit('guest');
      return;
    }
    if (event.key !== 'Tab') return;
    const nodes = this.focusables();
    if (nodes.length === 0) return;
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    const active = document.activeElement;
    if (!nodes.includes(active as HTMLElement)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private setBusy(busy: boolean, status?: string): void {
    this.busy = busy;
    this.enterBtn.disabled = busy;
    this.signupBtn.disabled = busy;
    this.geoBtn.disabled = busy;
    this.postalInput.disabled = busy;
    if (busy && status) this.errorEl.textContent = status;
  }

  private setError(message: string): void {
    this.errorEl.textContent = message;
  }

  private async useDeviceLocation(): Promise<void> {
    if (this.busy) return;
    this.geoBtn.disabled = true;
    this.geoBtn.textContent = COPY.locating;
    const coords = await requestUserGeolocation();
    this.geoBtn.disabled = false;
    this.geoBtn.textContent = COPY.useMyLocation;
    if (!coords) {
      this.setError(COPY.geoError);
      return;
    }
    this.geoCoords = coords;
    this.setError('');
  }

  private locationFromLookup(result: PostalLookupResult, postal: string): DispatchHomeLocation {
    return {
      postal,
      countryCode: result.code || this.defaultCountry || undefined,
      lat: result.lat,
      lon: result.lon,
      region: regionFromCoordinates(result.lat, result.lon),
      source: 'postal',
    };
  }

  private skippedLocation(): DispatchHomeLocation {
    return {
      source: 'skipped',
      countryCode: this.defaultCountry || undefined,
    };
  }

  private geoLocation(): DispatchHomeLocation | null {
    if (!this.geoCoords) return null;
    return {
      postal: this.postalInput.value.trim() || undefined,
      countryCode: this.defaultCountry || undefined,
      lat: this.geoCoords.lat,
      lon: this.geoCoords.lon,
      region: regionFromCoordinates(this.geoCoords.lat, this.geoCoords.lon),
      source: 'geo',
    };
  }

  private async resolveLocation(mode: 'guest' | 'signup' | 'skip'): Promise<DispatchHomeLocation | null> {
    if (mode === 'skip') return this.skippedLocation();

    const geo = this.geoLocation();
    const postal = this.postalInput.value.trim();
    if (!postal) return geo ?? this.skippedLocation();

    this.setBusy(true, COPY.lookingUp);
    this.lookupAbort?.abort();
    this.lookupAbort = new AbortController();
    const signal = this.lookupAbort.signal;
    let result = await lookupPostalCode(postal, this.defaultCountry, signal);
    if (!result && this.defaultCountry) {
      result = await lookupPostalCode(postal, null, signal);
    }
    if (signal.aborted) return null;
    if (result) return this.locationFromLookup(result, postal);

    this.setBusy(false);
    this.setError(COPY.lookupError);
    return null;
  }

  private async submit(mode: 'guest' | 'signup' | 'skip'): Promise<void> {
    if (this.busy && mode !== 'skip') return;
    this.setBusy(true, '');

    const location = await this.resolveLocation(mode);
    if (!location) {
      this.setBusy(false);
      return;
    }
    persistHomeLocation(location);
    markDispatchEntered();

    this.element.classList.add('is-leaving');
    this.element.classList.remove('is-open');
    const fadeMs = prefersReducedMotion() ? 0 : 280;
    if (fadeMs > 0) await sleep(fadeMs);

    try {
      await this.onEnter(location);
      if (mode === 'signup') openSignUp();
    } finally {
      this.destroy();
    }
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.element.remove();
    try {
      this.previouslyFocused?.focus();
    } catch {
      // Focus restoration is best-effort after the dashboard takes over.
    }
  }
}
