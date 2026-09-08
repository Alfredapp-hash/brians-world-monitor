/**
 * God's Eye — the globe-first presentation stage.
 *
 * World Monitor ships two reading densities (everyday / analyst, see
 * `reader-mode.ts`). Both stage the map as one section inside a dashboard.
 * God's Eye is a third presentation on a separate axis: the globe becomes the
 * whole stage, panels float over it as translucent chrome, and the intelligence
 * reads as attached to Earth rather than as a feed beside a map widget.
 *
 * WHY A SEPARATE AXIS. Folding this into `ReaderMode` would widen a union that
 * the pre-paint script, the CSS, and the everyday/analyst tests all key on.
 * Instead the stage is its own attribute (`data-stage-mode`), so everyday and
 * analyst keep working untouched and God's Eye layers on top of whichever one
 * the reader was already in.
 *
 * EXACT RESTORE. Entering the stage rewrites three durable preferences (reader
 * mode, map dimension, mission preset) because the stage genuinely needs
 * analyst chrome on a 3D globe with a wide layer bundle. Leaving must give the
 * reader back precisely what they had, so entry snapshots those three values
 * first and exit replays the snapshot. A stage entered twice without an
 * intervening exit must NOT overwrite the snapshot with its own staged values —
 * that would strand the reader on the stage's settings forever.
 */

import { STORAGE_KEYS } from '@/config/variants/base';
import type { MapModePreference } from '@/config/variants/base';
import { MISSION_PRESET_STORAGE_KEY } from '@/services/mission-presets';
import { READER_MODE_KEY, type ReaderMode } from '@/services/reader-mode';

export type StageMode = 'dashboard' | 'godseye';

export const STAGE_MODE_KEY = 'jsam-stage-mode';
export const STAGE_RESTORE_KEY = 'jsam-stage-restore-v1';

/** Mission preset that supplies the stage's layer + panel bundle. */
export const GODSEYE_MISSION_PRESET_ID = 'gods-eye' as const;

/** URL escape hatch — `?godseye=1` engages, `?godseye=0` leaves. */
export const GODSEYE_URL_PARAM = 'godseye';

export function isStageMode(value: string | null | undefined): value is StageMode {
  return value === 'dashboard' || value === 'godseye';
}

/**
 * What the reader had before the stage took over. Every field is optional
 * because a reader may never have set one — a missing field means "restore to
 * no stored preference", not "restore to a default we invented".
 */
export interface StageRestoreSnapshot {
  readerMode: ReaderMode | null;
  mapMode: MapModePreference | null;
  missionPresetId: string | null;
}

/** Minimal storage surface, so the pure logic is testable without a browser. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function safeStore(store?: KeyValueStore | null): KeyValueStore | null {
  if (store !== undefined) return store;
  try {
    return globalThis.localStorage;
  } catch {
    // Privacy-restricted storage must not make the stage throw on boot.
    return null;
  }
}

function read(store: KeyValueStore | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(store: KeyValueStore | null, key: string, value: string): void {
  try {
    store?.setItem(key, value);
  } catch {
    // Best-effort: the stage still applies for this page load.
  }
}

function remove(store: KeyValueStore | null, key: string): void {
  try {
    store?.removeItem(key);
  } catch {
    // Best-effort.
  }
}

export function getStageMode(store?: KeyValueStore | null): StageMode {
  const stored = read(safeStore(store), STAGE_MODE_KEY);
  return isStageMode(stored) ? stored : 'dashboard';
}

export function isGodsEyeStage(store?: KeyValueStore | null): boolean {
  return getStageMode(store) === 'godseye';
}

/**
 * Resolve the stage for this page load. An explicit URL parameter outranks the
 * stored preference so a shared link always lands on the experience its author
 * meant, and so support can always demo the stage on a fresh browser.
 */
export function resolveStageModeForLoad(
  search: string | null | undefined,
  stored: StageMode,
): StageMode {
  const raw = new URLSearchParams(search || '').get(GODSEYE_URL_PARAM);
  if (raw === '1' || raw === 'true') return 'godseye';
  if (raw === '0' || raw === 'false') return 'dashboard';
  return stored;
}

/**
 * Capture the preferences the stage is about to overwrite.
 *
 * `mapMode` is stored JSON-encoded by `map-mode-preference.ts`, so it is
 * carried through as the RAW stored string and decoded only for the typed
 * field — writing back a bare `globe` where a `"globe"` was expected would
 * silently reset the reader's map dimension.
 */
export function captureStageRestore(store?: KeyValueStore | null): StageRestoreSnapshot {
  const area = safeStore(store);
  const readerMode = read(area, READER_MODE_KEY);
  const missionPresetId = read(area, MISSION_PRESET_STORAGE_KEY);
  let mapMode: MapModePreference | null = null;
  const rawMapMode = read(area, STORAGE_KEYS.mapMode);
  if (rawMapMode) {
    try {
      const parsed = JSON.parse(rawMapMode) as unknown;
      if (parsed === 'flat' || parsed === 'globe') mapMode = parsed;
    } catch {
      // Corrupt value restores as "no preference" rather than propagating.
    }
  }
  return {
    readerMode: readerMode === 'everyday' || readerMode === 'analyst' ? readerMode : null,
    mapMode,
    missionPresetId,
  };
}

export function serializeStageRestore(snapshot: StageRestoreSnapshot): string {
  return JSON.stringify(snapshot);
}

export function parseStageRestore(raw: string | null | undefined): StageRestoreSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StageRestoreSnapshot> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    const readerMode = parsed.readerMode;
    const mapMode = parsed.mapMode;
    return {
      readerMode: readerMode === 'everyday' || readerMode === 'analyst' ? readerMode : null,
      mapMode: mapMode === 'flat' || mapMode === 'globe' ? mapMode : null,
      missionPresetId: typeof parsed.missionPresetId === 'string' ? parsed.missionPresetId : null,
    };
  } catch {
    return null;
  }
}

/**
 * Engage the stage, snapshotting what it displaces.
 *
 * Re-entering an already-engaged stage is a no-op for the snapshot: the stored
 * one still describes the pre-stage world, and overwriting it with the stage's
 * own values is exactly how a reader loses their layout.
 */
export function engageGodsEyeStage(store?: KeyValueStore | null): StageRestoreSnapshot {
  const area = safeStore(store);
  const existing = parseStageRestore(read(area, STAGE_RESTORE_KEY));
  const alreadyStaged = getStageMode(area) === 'godseye';
  const snapshot = alreadyStaged && existing ? existing : captureStageRestore(area);
  if (!alreadyStaged || !existing) {
    write(area, STAGE_RESTORE_KEY, serializeStageRestore(snapshot));
  }
  write(area, STAGE_MODE_KEY, 'godseye');
  // The stage is a 3D globe with analyst chrome by definition.
  write(area, READER_MODE_KEY, 'analyst');
  write(area, STORAGE_KEYS.mapMode, JSON.stringify('globe'));
  write(area, MISSION_PRESET_STORAGE_KEY, GODSEYE_MISSION_PRESET_ID);
  return snapshot;
}

/**
 * Leave the stage and replay the snapshot. Returns what was restored so the
 * caller can report it, or null when there was nothing staged.
 */
export function releaseGodsEyeStage(store?: KeyValueStore | null): StageRestoreSnapshot | null {
  const area = safeStore(store);
  const snapshot = parseStageRestore(read(area, STAGE_RESTORE_KEY));
  write(area, STAGE_MODE_KEY, 'dashboard');
  remove(area, STAGE_RESTORE_KEY);
  if (!snapshot) return null;

  if (snapshot.readerMode) write(area, READER_MODE_KEY, snapshot.readerMode);
  else remove(area, READER_MODE_KEY);

  if (snapshot.mapMode) write(area, STORAGE_KEYS.mapMode, JSON.stringify(snapshot.mapMode));
  else remove(area, STORAGE_KEYS.mapMode);

  if (snapshot.missionPresetId) write(area, MISSION_PRESET_STORAGE_KEY, snapshot.missionPresetId);
  else remove(area, MISSION_PRESET_STORAGE_KEY);

  return snapshot;
}

export function applyStageModeToDocument(mode: StageMode = getStageMode()): void {
  const root = document.documentElement;
  if (mode === 'godseye') root.dataset.stageMode = 'godseye';
  else delete root.dataset.stageMode;
}

// ─── HUD telemetry formatting (pure) ────────────────────────────────────────

/**
 * Instrument-style coordinate readout. Fixed width per hemisphere so the
 * split-flap board does not reflow between columns as the globe turns — the
 * unset readout is padded to the same width as a live one for the same reason.
 *
 * One decimal, not two: the second decimal is ~1km of precision that no reader
 * of a whole-Earth view can use, and it turns the last column into a permanent
 * blur while the globe drifts.
 */
export function formatHudLatLon(lat: number, lon: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '--.-°- ---.-°-';
  const latHemisphere = lat >= 0 ? 'N' : 'S';
  const lonHemisphere = lon >= 0 ? 'E' : 'W';
  const latText = Math.abs(lat).toFixed(1).padStart(4, '0');
  const lonText = Math.abs(lon).toFixed(1).padStart(5, '0');
  return `${latText}°${latHemisphere} ${lonText}°${lonHemisphere}`;
}

export type HudScaleBand = 'ORBITAL' | 'CONTINENTAL' | 'REGIONAL' | 'THEATRE' | 'LOCAL';

/**
 * Name the viewing scale from the globe's camera altitude, expressed in Earth
 * radii the way globe.gl reports it. Bands are named rather than numeric
 * because the HUD is telling the reader how far out they are standing, not
 * reporting a measurement.
 */
export function formatHudScale(altitude: number): HudScaleBand {
  if (!Number.isFinite(altitude) || altitude >= 2) return 'ORBITAL';
  if (altitude >= 1) return 'CONTINENTAL';
  if (altitude >= 0.5) return 'REGIONAL';
  if (altitude >= 0.2) return 'THEATRE';
  return 'LOCAL';
}

/**
 * Acquisition state of the stage's data plane.
 *
 * Deliberately coarse. The HUD must never imply a freshness guarantee the
 * client cannot actually source: 'live' means the map has rendered its layers,
 * not that every upstream feed is current. Per-source freshness stays where it
 * already lives — the status indicator and the panels' own staleness chips.
 */
export type StageSignalState = 'acquiring' | 'live' | 'offline';

/**
 * One-line readout for the HUD's status board. Fixed-shape strings so the
 * split-flap board flips columns in place instead of reflowing.
 */
export function summarizeStageTelemetry(
  state: StageSignalState,
  activeLayerCount: number,
): string {
  const layers = Math.max(0, Math.trunc(activeLayerCount));
  const noun = layers === 1 ? 'LAYER' : 'LAYERS';
  if (state === 'offline') return `OFFLINE · ${layers} ${noun}`;
  if (state === 'acquiring') return 'ACQUIRING SIGNAL';
  return `LIVE · ${layers} ${noun}`;
}

/**
 * Count enabled entries in a map-layer record. Takes a plain `object` rather
 * than an index signature so the closed `MapLayers` interface can be passed
 * without a cast at every call site.
 */
export function countActiveLayers(layers: object | null | undefined): number {
  if (!layers) return 0;
  return Object.values(layers).filter(Boolean).length;
}
