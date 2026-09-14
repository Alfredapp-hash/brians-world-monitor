/**
 * Everyday vs analyst view density.
 *
 * Everyday: news-brief first paint, map demoted, analyst tools behind
 * progressive disclosure. Analyst: full dashboard chrome.
 * Does not strip APIs or data pipelines — only layout and panel enablement.
 */

export const READER_MODE_KEY = 'jsam-view-mode';
export const READER_MODE_SEED_KEY = 'jsam-everyday-seeded-v1';
export const READER_ANALYST_OPEN_KEY = 'jsam-reader-analyst-open';

export type ReaderMode = 'everyday' | 'analyst';

/** Core scan path for everyday readers — brief + top stories only. */
export const EVERYDAY_CORE_PANELS: readonly string[] = [
  'insights',
  'politics',
] as const;

/**
 * Deep data kept available but off by default in everyday mode.
 * Revealed via "Show more analysis" without leaving everyday chrome.
 */
export const EVERYDAY_ANALYST_PANELS: readonly string[] = [
  'coverage-compare',
  'cii',
  'finance',
  'markets',
  'strategic-posture',
  'gdelt-intel',
  'strategic-risk',
  'forecast',
] as const;

export const EVERYDAY_MISSION_PRESET_ID = 'everyday-reader' as const;

export function isReaderMode(value: string | null | undefined): value is ReaderMode {
  return value === 'everyday' || value === 'analyst';
}

export function getReaderMode(): ReaderMode {
  try {
    const stored = localStorage.getItem(READER_MODE_KEY);
    if (isReaderMode(stored)) return stored;
  } catch {
    // private mode / blocked storage
  }
  return 'everyday';
}

/** Outlet classes used by Coverage Compare / Everyday framing copy. */
export type CoverageSourceClass = 'mainstream' | 'independent' | 'state' | 'gov' | 'local';

const COVERAGE_CLASS_ORDER: CoverageSourceClass[] = [
  'mainstream',
  'independent',
  'local',
  'state',
  'gov',
];

const CIVILIAN_CLASS_LABELS: Record<CoverageSourceClass, string> = {
  mainstream: 'mainstream wires',
  independent: 'independent outlets',
  state: 'state-affiliated media',
  gov: 'official / government',
  local: 'local press',
};

/** Plain-language covered / quiet / framing wedge for Everyday first paint. */
export interface CivilianCoverageSummary {
  covered: string;
  ignored: string | null;
  framing: string | null;
}

/**
 * Covered vs quiet source classes + one framing sentence — no NCI jargon.
 */
export function summarizeCivilianCoverage(
  groups: Record<CoverageSourceClass, ReadonlyArray<unknown>>,
  opts?: {
    asymmetry?: string | null;
    divergentCount?: number;
    talkingPoint?: boolean;
    loadedCount?: number;
  },
): CivilianCoverageSummary {
  const coveredClasses = COVERAGE_CLASS_ORDER.filter((cls) => (groups[cls]?.length ?? 0) > 0);
  const ignoredClasses = COVERAGE_CLASS_ORDER.filter((cls) => (groups[cls]?.length ?? 0) === 0);

  const covered =
    coveredClasses.length === 0
      ? 'Coverage still forming across outlets'
      : `Covered by ${coveredClasses
          .map((cls) => {
            const n = groups[cls]!.length;
            const label = CIVILIAN_CLASS_LABELS[cls];
            return n > 1 ? `${label} (${n})` : label;
          })
          .join(', ')}`;

  const ignored =
    ignoredClasses.length === 0
      ? null
      : `Quiet so far: ${ignoredClasses.map((cls) => CIVILIAN_CLASS_LABELS[cls]).join(', ')}`;

  let framing: string | null = null;
  if (opts?.talkingPoint) {
    framing = 'Several outlets are using nearly the same phrasing — worth reading more than one take.';
  } else if (opts?.asymmetry === 'mainstream-silent') {
    framing = 'Independent outlets are on this; big mainstream desks are quieter so far.';
  } else if (opts?.asymmetry === 'no-independent') {
    framing = 'Broad coverage, but little independent corroboration in this pool yet.';
  } else if ((opts?.divergentCount ?? 0) > 0) {
    framing = 'Outlets are emphasizing different angles on the same story.';
  } else if ((opts?.loadedCount ?? 0) > 0) {
    framing = 'Some headlines use charged wording — compare how each outlet frames it.';
  } else if (coveredClasses.length >= 3) {
    framing = 'Multiple outlet types are covering this — compare how they tell it.';
  }

  return { covered, ignored, framing };
}

export function setReaderMode(mode: ReaderMode): void {
  try {
    localStorage.setItem(READER_MODE_KEY, mode);
  } catch {
    // ignore
  }
  applyReaderModeToDocument(mode);
}

export function applyReaderModeToDocument(mode: ReaderMode = getReaderMode()): void {
  document.documentElement.dataset.readerMode = mode;
}

export function isEverydayReaderMode(): boolean {
  return getReaderMode() === 'everyday';
}

export function isReaderAnalystOpen(): boolean {
  try {
    return localStorage.getItem(READER_ANALYST_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function setReaderAnalystOpen(open: boolean): void {
  try {
    if (open) localStorage.setItem(READER_ANALYST_OPEN_KEY, '1');
    else localStorage.removeItem(READER_ANALYST_OPEN_KEY);
  } catch {
    // ignore
  }
  document.documentElement.classList.toggle('reader-analyst-open', open);
}

export function applyReaderAnalystOpenToDocument(): void {
  document.documentElement.classList.toggle('reader-analyst-open', isReaderAnalystOpen());
}

/** True when this install has never recorded an explicit reader-mode choice. */
export function hasExplicitReaderModeChoice(): boolean {
  try {
    return isReaderMode(localStorage.getItem(READER_MODE_KEY));
  } catch {
    return true;
  }
}

/**
 * First-run seed: new installs (no panel-order, no mission) get everyday.
 * Existing customized users get analyst so their layout is not rewritten.
 */
export function seedReaderModePreference(): ReaderMode {
  try {
    if (localStorage.getItem(READER_MODE_SEED_KEY)) {
      return getReaderMode();
    }
    localStorage.setItem(READER_MODE_SEED_KEY, '1');

    if (hasExplicitReaderModeChoice()) {
      return getReaderMode();
    }

    const hasCustomLayout =
      !!localStorage.getItem('panel-order') ||
      !!localStorage.getItem('worldmonitor-mission-preset-v1');

    const mode: ReaderMode = hasCustomLayout ? 'analyst' : 'everyday';
    localStorage.setItem(READER_MODE_KEY, mode);
    return mode;
  } catch {
    return 'everyday';
  }
}
