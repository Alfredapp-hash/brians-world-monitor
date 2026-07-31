import { Panel } from './Panel';
import { escapeHtml } from '@/services/forecast';
import type { Forecast } from '@/services/forecast';
import { t } from '@/services/i18n';
import { getForecastMacroRegion } from '../../shared/forecast-macro-regions.js';
import { unsafeRawHtml } from '@/utils/sanitize';
import { setTrustedHtml, trustedHtml } from '@/utils/dom-utils';
import { mergeCachedCaseFiles, needsCaseFileRefetch, shouldFetchCaseFile } from './forecast-case-files';
import { CATEGORY, NEUTRAL, STATUS, withAlpha } from '@/styles/tokens';

const DOMAINS = ['all', 'conflict', 'market', 'supply_chain', 'political', 'military', 'cyber', 'infrastructure'] as const;
const PANEL_MIN_PROBABILITY = 0.1;

interface ForecastSourceState {
  generatedAt: number;
  degraded: boolean;
  stale: boolean;
  error: string;
}

// Macro region pill values. Each non-empty id matches an entry in the
// ForecastMacroRegionId union emitted by getForecastMacroRegion() (see
// shared/forecast-macro-regions.js). Filtering is entirely client-side:
// this.forecasts stays the full unfiltered set, and the render pipeline
// applies the active macro region on every render so the filter survives
// refresh-time updateForecasts() calls. The '' (empty) id means
// "All Regions" — no filter applied. Forecasts whose region does not
// classify (unknown or 'global') only appear under "All Regions".
const FORECAST_REGIONS = [
  { id: '', label: 'All Regions' },
  { id: 'mena', label: 'MENA' },
  { id: 'east-asia', label: 'East Asia' },
  { id: 'europe', label: 'Europe' },
  { id: 'south-asia', label: 'South Asia' },
  { id: 'sub-saharan-africa', label: 'Africa' },
  { id: 'latam', label: 'LatAm' },
  { id: 'north-america', label: 'N. America' },
] as const;

const DOMAIN_LABELS: Record<string, string> = {
  all: 'All',
  conflict: 'Conflict',
  market: 'Market',
  supply_chain: 'Supply Chain',
  political: 'Political',
  military: 'Military',
  cyber: 'Cyber',
  infrastructure: 'Infra',
};

// Qualitative domain identity hues — raw constants (not CSS vars) because
// they're combined with hex-alpha suffixes via withAlpha() and set as SVG
// presentation attributes. One meaning per hue within this layer.
const DOMAIN_COLORS: Record<string, string> = {
  conflict:       CATEGORY.red,
  market:         CATEGORY.gold,
  supply_chain:   CATEGORY.blue,
  political:      CATEGORY.violet,
  military:       CATEGORY.orange,
  cyber:          CATEGORY.violet,
  infrastructure: CATEGORY.green,
};

// Derived from stateKind — maps to a domain color bucket for the theater card accent
const STATE_KIND_DOMAIN: Record<string, string> = {
  supply_chain_disruption: 'supply_chain',
  freight_disruption:      'supply_chain',
  energy_disruption:       'market',
  energy_price_shock:      'market',
  military_posture:        'military',
  conflict_escalation:     'conflict',
};

// --- Types for simulation theater data -------------------------------------
const PATH_ID_LABELS: Record<string, string> = {
  escalation:     'Escalation',
  containment:    'Containment',
  market_cascade: 'Market Cascade',
};

interface SimulationPath {
  pathId: string;
  label: string;
  summary: string;
  confidence: number;
  keyActors: string[];
}

interface SimulationTheater {
  theaterId: string;
  theaterLabel: string;
  stateKind: string;
  topPaths: SimulationPath[];
  dominantReactions: string[];
  stabilizers: string[];
  invalidators: string[];
}

function parseTheaters(json: string): SimulationTheater[] {
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (v): v is SimulationTheater =>
        v && typeof v === 'object' && typeof v.theaterId === 'string' && typeof v.theaterLabel === 'string',
    );
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------

let _styleInjected = false;
function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .fc-panel { font-size: 12px; }
    .fc-filters { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--border); }
    .fc-filter { background: transparent; border: 1px solid var(--border); color: var(--text-secondary); padding: 2px 8px; border-radius: 3px; cursor: pointer; font-size: 11px; font-family: inherit; }
    .fc-filter.fc-active { background: var(--accent); color: var(--bg); border-color: var(--accent); }

    /* ── NEXUS: theater grid ─────────────────────────────────────────────── */
    .fc-nexus { padding: 8px; }
    .fc-theater-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; margin-bottom: 10px; }
    .fc-theater-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 18px 16px;
      cursor: pointer;
      transition: all 0.2s;
      position: relative;
      overflow: hidden;
    }
    .fc-theater-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 2px;
      background: var(--fc-theater-color, var(--status-info));
    }
    .fc-theater-card:hover { border-color: var(--border-strong); transform: translateY(-1px); }
    .fc-theater-card.fc-theater-selected { border-color: var(--accent); background: var(--overlay-subtle); }
    .fc-theater-top { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 10px; }
    .fc-theater-name { font-size: 11px; font-weight: 700; line-height: 1.3; color: var(--text); flex: 1; padding-right: 8px; }
    .fc-gauge-wrap { position: relative; width: 38px; height: 38px; flex-shrink: 0; }
    .fc-gauge-svg { width: 38px; height: 38px; transform: rotate(-90deg); }
    .fc-gauge-bg { fill: none; stroke: var(--border); stroke-width: 4; }
    .fc-gauge-fill { fill: none; stroke-width: 4; stroke-linecap: round; }
    .fc-gauge-label { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); font-size: 9px; font-weight: 700; }
    .fc-theater-path { font-size: 9px; color: var(--text-secondary); line-height: 1.4; margin-top: 4px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
    .fc-path-type { font-size: 8px; padding: 1px 4px; border-radius: 2px; font-weight: 600; letter-spacing: 0.03em; opacity: 0.75; white-space: nowrap; }
    .fc-path-type-escalation    { background: ${withAlpha(STATUS.alert, 0.2)}; color: var(--status-alert); border: 1px solid ${withAlpha(STATUS.alert, 0.3)}; }
    .fc-path-type-containment   { background: ${withAlpha(STATUS.good, 0.15)}; color: var(--status-good); border: 1px solid ${withAlpha(STATUS.good, 0.25)}; }
    .fc-path-type-market_cascade { background: ${withAlpha(STATUS.watch, 0.15)}; color: var(--status-watch); border: 1px solid ${withAlpha(STATUS.watch, 0.25)}; }
    .fc-cat-tag {
      font-size: 9px; padding: 1px 5px; border-radius: 3px; white-space: nowrap;
      flex-shrink: 0; font-weight: 500; display: inline-block;
    }

    /* ── NEXUS: expanded theater detail ─────────────────────────────────── */
    .fc-theater-detail {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 5px;
      margin-bottom: 10px;
      overflow: hidden;
    }
    .fc-theater-detail-hdr { padding: 10px 12px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 8px; }
    .fc-theater-detail-name { font-size: 12px; font-weight: 700; color: var(--text); }
    .fc-theater-paths { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 10px 12px; }
    @media (max-width: 480px) { .fc-theater-paths { grid-template-columns: 1fr; } }
    .fc-path-card { background: rgba(0,0,0,0.25); border: 1px solid var(--border); border-radius: 4px; padding: 9px 10px; }
    .fc-path-label { font-size: 10px; font-weight: 700; color: var(--text); margin-bottom: 2px; }
    .fc-path-conf { font-size: 9px; color: var(--text-secondary); margin-bottom: 5px; }
    .fc-path-bar { height: 2px; border-radius: 1px; margin: 4px 0; }
    .fc-path-summary { font-size: 10px; color: var(--text-secondary); line-height: 1.5; }
    .fc-path-actors { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 5px; }
    .fc-actor-chip { font-size: 9px; padding: 1px 5px; border: 1px solid var(--border); border-radius: 2px; color: var(--text-secondary); background: rgba(255,255,255,0.02); }
    .fc-theater-footer { padding: 8px 12px; border-top: 1px solid var(--border); display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
    .fc-theater-footer-section { }
    .fc-footer-title { font-size: 9px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 5px; }
    .fc-footer-item { font-size: 9px; color: var(--text-secondary); padding: 2px 0; line-height: 1.4; }
    .fc-footer-item::before { content: '›'; margin-right: 4px; }
    .fc-stab-item::before { color: var(--status-good); }
    .fc-inval-item::before { color: var(--status-alert); }
    .fc-react-item::before { color: var(--status-info); }

    /* ── Section label ───────────────────────────────────────────────────── */
    .fc-section-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-secondary); padding: 6px 8px 4px; }

    /* ── Forecast probability table ──────────────────────────────────────── */
    .fc-prob-table { border: 1px solid var(--border); border-radius: 4px; overflow: hidden; margin: 0 8px 8px; }
    .fc-prob-hdr { display: grid; grid-template-columns: 1fr 80px 100px 60px; padding: 8px 14px; border-bottom: 1px solid var(--border); }
    .fc-prob-hdr span { font-size: 9px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.08em; }
    .fc-prob-item { border-bottom: 1px solid var(--border); }
    .fc-prob-item:last-child { border-bottom: none; }
    .fc-prob-row { display: grid; grid-template-columns: 1fr 80px 100px 60px; align-items: center; padding: 9px 14px; cursor: pointer; transition: background 0.1s; }
    .fc-prob-item:hover .fc-prob-row { background: rgba(255,255,255,0.02); }
    .fc-prob-label { font-size: 10px; color: var(--text-secondary); line-height: 1.4; }
    .fc-bar-wrap { display: flex; align-items: center; gap: 8px; }
    .fc-prob-bar-track { flex: 1; height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; min-width: 40px; }
    .fc-prob-bar-fill { height: 100%; border-radius: 2px; }
    .fc-prob-pct { font-size: 11px; font-weight: 700; min-width: 30px; text-align: right; }
    .fc-trend-text { font-size: 10px; }
    .fc-domain-tag { font-size: 9px; padding: 2px 6px; border-radius: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* ── Detail toggle (hidden by default; shown on item hover) ──────────── */
    .fc-hidden { display: none; }
    .fc-toggle-row { display: none; flex-wrap: wrap; gap: 8px; padding: 0 14px 8px; }
    .fc-prob-item:hover .fc-toggle-row { display: flex; }
    .fc-toggle { cursor: pointer; color: var(--text-secondary); font-size: 11px; }
    .fc-toggle:hover { color: var(--text); }
    .fc-detail { padding: 8px 14px 4px; border-top: 1px solid var(--border); }
    .fc-detail-grid { display: grid; gap: 8px; }
    .fc-section { display: grid; gap: 4px; }
    .fc-section-title { color: var(--text-secondary); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; }
    .fc-section-copy { font-size: 11px; color: var(--text); line-height: 1.45; }
    .fc-list-block { display: grid; gap: 4px; }
    .fc-list-item { font-size: 11px; color: var(--text-secondary); line-height: 1.4; }
    .fc-list-item::before { content: ''; display: inline-block; width: 6px; height: 1px; background: var(--text-secondary); margin-right: 6px; vertical-align: middle; }
    .fc-chip-row { display: flex; flex-wrap: wrap; gap: 6px; }
    .fc-chip { border: 1px solid var(--border); border-radius: 999px; padding: 2px 8px; font-size: 10px; color: var(--text-secondary); background: rgba(255,255,255,0.02); }
    .fc-perspectives { margin-top: 2px; }
    .fc-perspective { font-size: 11px; color: var(--text-secondary); padding: 2px 0; line-height: 1.4; }
    .fc-perspective strong { color: var(--text); font-weight: 600; }
    .fc-scenario { font-style: italic; }
    .fc-signals { padding: 8px 14px 4px; border-top: 1px solid var(--border); }
    .fc-signals-title { color: var(--text-secondary); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
    .fc-signal { color: var(--text-secondary); font-size: 11px; padding: 3px 0 3px 12px; line-height: 1.45; position: relative; margin-top: 2px; }
    .fc-signal::before { content: ''; position: absolute; left: 0; top: 9px; display: inline-block; width: 6px; height: 1px; background: var(--text-secondary); }
    .fc-empty { padding: 20px; text-align: center; color: var(--text-secondary); }
    .fc-source-notice { margin: 6px 8px 0; padding: 6px 8px; border: 1px solid ${withAlpha(STATUS.watch, 0.35)}; border-radius: 4px; color: var(--status-watch); background: ${withAlpha(STATUS.watch, 0.08)}; font-size: 10px; line-height: 1.35; }

    /* ── Simulation confidence sub-bar (Option D) ────────────────────────── */
    /* Thin colored underbar below the forecast title. Width encodes sim       */
    /* path confidence. At rest: barely visible. On row hover: full opacity   */
    /* + text label reveals below the bar. Zero extra columns needed.         */
    .fc-sim-bar-wrap { margin-top: 4px; }
    .fc-sim-bar { height: 2px; border-radius: 1px; opacity: 0.45; transition: opacity 0.15s; }
    .fc-prob-item:hover .fc-sim-bar { opacity: 0.9; }
    .fc-sim-label { font-size: 9px; display: none; margin-top: 2px; line-height: 1.2; }
    .fc-prob-item:hover .fc-sim-label { display: block; }

    /* ── Simulation verdict chip ─────────────────────────────────────────── */
    .fc-sim-chip { display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px; border-radius: 3px; font-size: 9px; font-weight: 600; letter-spacing: 0.03em; white-space: nowrap; flex-shrink: 0; line-height: 1.6; }
    .fc-sim-chip::before { content: ''; display: inline-block; width: 4px; height: 4px; border-radius: 50%; flex-shrink: 0; }
    .fc-sim-chip--backed   { background: var(--status-good-bg);  color: var(--status-good); border: 1px solid ${withAlpha(STATUS.good, 0.28)}; }
    .fc-sim-chip--backed::before   { background: var(--status-good); }
    .fc-sim-chip--flagged  { background: var(--status-watch-bg); color: var(--status-watch); border: 1px solid ${withAlpha(STATUS.watch, 0.28)}; }
    .fc-sim-chip--flagged::before  { background: var(--status-watch); }
    .fc-sim-chip--skeptical { background: ${withAlpha(STATUS.alert, 0.10)}; color: var(--status-alert); border: 1px solid ${withAlpha(STATUS.alert, 0.28)}; }
    .fc-sim-chip--skeptical::before { background: var(--status-alert); }
    .fc-label-inner { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .fc-forecast-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `;
  document.head.appendChild(style);
}

export class ForecastPanel extends Panel {
  // Full unfiltered set from the server. The region + domain filters are
  // applied on every render() — never mutate this by filtering, or refresh
  // updates from data-loader will wipe the filter state.
  private forecasts: Forecast[] = [];
  /** De-dupe guard for the dossier fetch. Cleared when a refresh brings a forecast we've never fetched. */
  private caseFilesPromise: Promise<void> | null = null;
  /**
   * Dossiers already fetched, by forecast id. Survives refresh ticks: the bootstrap
   * feed carries the LIST only, so without this cache a refresh would drop the dossier
   * the user just opened and re-render the pane empty (#5300).
   */
  private caseFilesById = new Map<string, NonNullable<Forecast['caseFile']>>();
  /**
   * Every forecast id a completed fetch covered — including those that legitimately have
   * no dossier. Tracked separately from `caseFilesById` so a dossier-less forecast counts
   * as resolved: keying the refetch decision off a missing `caseFile` alone would refetch
   * the whole feed on every click of such a pane.
   */
  private caseFilesFetchedIds = new Set<string>();
  /** True once a fetch has completed successfully — so a refresh never cancels an in-flight one. */
  private caseFilesSettled = false;
  private sourceState: ForecastSourceState = { generatedAt: 0, degraded: false, stale: false, error: '' };
  private activeDomain: string = 'all';
  private selectedRegion: string = '';
  private theaters: SimulationTheater[] = [];
  private expandedTheaterId: string | null = null;

  constructor() {
    super({ id: 'forecast', title: 'AI Forecasts', showCount: true, infoTooltip: t('components.forecast.infoTooltip') });
    injectStyles();
    this.content.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;

      const filterBtn = target.closest('[data-fc-domain]') as HTMLElement | null;
      if (filterBtn) {
        this.activeDomain = filterBtn.dataset.fcDomain || 'all';
        this.render();
        return;
      }

      const regionBtn = target.closest('[data-fc-region]') as HTMLElement | null;
      if (regionBtn) {
        const nextRegion = regionBtn.dataset.fcRegion ?? '';
        if (nextRegion === this.selectedRegion) return;
        this.selectedRegion = nextRegion;
        // Client-side filter only — no RPC fires. The next render() pulls
        // from the full this.forecasts set and applies the macro region
        // filter in getVisibleForecasts().
        this.setCount(this.getVisibleForecasts().length);
        this.render();
        return;
      }

      const theaterBtn = target.closest('[data-fc-theater]') as HTMLElement | null;
      if (theaterBtn) {
        const tid = theaterBtn.dataset.fcTheater || null;
        this.expandedTheaterId = this.expandedTheaterId === tid ? null : tid;
        this.render();
        return;
      }

      const toggle = target.closest('[data-fc-toggle]') as HTMLElement | null;
      if (toggle) {
        const item = toggle.closest('.fc-prob-item');
        const panelId = toggle.dataset.fcToggle;
        const detail = panelId ? item?.querySelector(`[data-fc-panel="${panelId}"]`) as HTMLElement | null : null;
        if (detail) detail.classList.toggle('fc-hidden');
        // The bootstrap payload carries the LIST, not the dossiers — 78% of the old
        // key was caseFile prose nobody expands (#5300). Fetch them the first time
        // someone actually opens one; the feed is CDN-shielded, so this is cheap.
        const forecastId = panelId?.startsWith('detail-') ? panelId.slice('detail-'.length) : '';
        const forecast = forecastId ? this.forecasts.find((f) => f.id === forecastId) : undefined;
        if (detail && shouldFetchCaseFile(forecast, !detail.classList.contains('fc-hidden'), !detail.innerHTML.trim())) {
          void this.loadCaseFiles();
        }
        return;
      }

      // Touch/click on the prob row itself: show the toggle row so Analysis is reachable on touch devices
      const probRow = target.closest('.fc-prob-row') as HTMLElement | null;
      if (probRow) {
        const item = probRow.closest('.fc-prob-item') as HTMLElement | null;
        const toggleRow = item?.querySelector('.fc-toggle-row') as HTMLElement | null;
        if (toggleRow) toggleRow.style.display = toggleRow.style.display === 'flex' ? '' : 'flex';
        return;
      }
    });
  }

  /**
   * Fetch the evidence dossiers on first expand (#5300).
   *
   * The bootstrap payload is the dashboard LIST: `caseFile` was 78% of the old key —
   * ~19,000 words of prose that were shipped to every visitor, downloaded on every
   * page load, and parsed into hidden DOM during the LCP window, for content almost
   * nobody opens. The full feed still carries them, and it is now CDN-shielded, so
   * pulling it once when a user actually clicks "Analysis" is cheap.
   *
   * Failure is non-fatal: the detail pane just stays empty, exactly as it would if
   * the seeder had produced no case file.
   */
  private async loadCaseFiles(): Promise<void> {
    if (this.caseFilesPromise) return this.caseFilesPromise;

    this.caseFilesPromise = (async () => {
      try {
        const { fetchForecastFeed } = await import('@/services/forecast');
        const feed = await fetchForecastFeed();
        for (const f of feed.forecasts) {
          this.caseFilesFetchedIds.add(f.id);
          if (f.caseFile) this.caseFilesById.set(f.id, f.caseFile);
        }
        this.caseFilesSettled = true;
        this.forecasts = this.forecasts.map((f) => {
          const caseFile = this.caseFilesById.get(f.id);
          return !f.caseFile && caseFile ? { ...f, caseFile } : f;
        });

        // Patch the panes in place rather than calling render(). A full re-render
        // rebuilds every detail div with its default `fc-hidden` class and would
        // slam shut the pane the user just opened.
        for (const f of this.forecasts) {
          if (!f.caseFile) continue;
          const pane = this.element.querySelector(
            `[data-fc-panel="detail-${CSS.escape(f.id)}"]`,
          ) as HTMLElement | null;
          if (pane && !pane.innerHTML.trim()) {
            // renderDetailBody() escapes every interpolated value (escapeHtml/renderList),
            // exactly as it does on the eager path this replaces.
            setTrustedHtml(pane, trustedHtml(this.renderDetailBody(f), 'ForecastPanel case-file detail; same escaped markup as the eager render path (#5300)'));
          }
        }
      } catch {
        // Leave the pane empty and allow a later retry.
        this.caseFilesPromise = null;
      }
    })();

    return this.caseFilesPromise;
  }

  updateForecasts(forecasts: Forecast[], sourceState?: Partial<ForecastSourceState>): void {
    // Refresh ticks re-hydrate from the bootstrap feed, which carries the LIST without
    // the dossiers (#5300). Re-merge anything already fetched, or the dossier the user
    // has open would vanish on the next tick and re-render as an empty pane.
    this.forecasts = mergeCachedCaseFiles(forecasts, this.caseFilesById);
    // A refreshed list can introduce a forecast no completed fetch covered — drop the
    // de-dupe latch so the next expand re-fetches it.
    if (needsCaseFileRefetch(this.forecasts, this.caseFilesFetchedIds, this.caseFilesSettled)) {
      this.caseFilesPromise = null;
      this.caseFilesSettled = false;
    }
    this.sourceState = {
      generatedAt: sourceState?.generatedAt ?? this.sourceState.generatedAt,
      degraded: sourceState?.degraded === true,
      stale: sourceState?.stale === true,
      error: sourceState?.error || '',
    };
    const visible = this.getVisibleForecasts();
    this.setCount(visible.length);
    // Badge reflects fetch success (this.forecasts.length), not the filtered
    // result. A user who picks a region with zero matches should still see
    // the feed as "live" — the empty-state copy inside the panel communicates
    // the filter miss. Tying the badge to the filter caused the panel to
    // flip to "unavailable" on any empty region pill.
    this.setDataBadge(this.forecasts.length > 0 && !this.sourceState.degraded ? 'live' : 'unavailable');
    this.render();
  }

  updateSimulation(theaterSummariesJson: string): void {
    this.theaters = parseTheaters(theaterSummariesJson);
    // Only re-render if forecasts are already loaded — prevents a flash of "No forecasts available"
    // when the simulation RPC resolves before the forecast RPC. updateForecasts will trigger
    // the combined render when it arrives.
    if (this.forecasts.length > 0) this.render();
  }

  // Returns forecasts that pass the probability AND region filters. Domain
  // filter is applied later in render() so the count reflects the prob+region
  // view (matching what the user sees with 'All' domains selected). Keep this
  // pure and idempotent — it reads from this.forecasts + this.selectedRegion
  // and must survive arbitrary refresh-time updateForecasts() calls.
  private getVisibleForecasts(): Forecast[] {
    const probFiltered = this.forecasts.filter(
      f => (f.probability || 0) >= PANEL_MIN_PROBABILITY,
    );
    if (!this.selectedRegion) return probFiltered;
    return probFiltered.filter(
      f => getForecastMacroRegion(f.region) === this.selectedRegion,
    );
  }

  private render(): void {
    const visibleForecasts = this.getVisibleForecasts();
    const filtersHtml = DOMAINS.map(d =>
      `<button class="fc-filter${d === this.activeDomain ? ' fc-active' : ''}" data-fc-domain="${d}">${DOMAIN_LABELS[d]}</button>`
    ).join('');
    const regionsHtml = FORECAST_REGIONS.map(r =>
      `<button class="fc-filter${r.id === this.selectedRegion ? ' fc-active' : ''}" data-fc-region="${escapeHtml(r.id)}">${escapeHtml(r.label)}</button>`
    ).join('');

    if (visibleForecasts.length === 0) {
      // Differentiate fetch-miss (this.forecasts.length === 0) from
      // filter-miss (this.forecasts has rows but none match the current
      // region/probability filter). The badge already reflects fetch success
      // independently; this copy just helps the user understand why the
      // list is empty so they can adjust the pill without thinking the feed
      // is broken.
      const hasAnyForecasts = this.forecasts.length > 0;
      const emptyCopy = hasAnyForecasts
        ? 'No forecasts match the current filter'
        : this.sourceState.degraded
          ? 'Forecasts are temporarily offline — retrying automatically.'
          : this.sourceState.error
            ? 'Forecasts are warming up — retrying automatically.'
            : 'No forecasts available';
      const sourceHtml = this.renderSourceNotice();
      this.setSafeContent(unsafeRawHtml(`
        <div class="fc-panel">
          <div class="fc-filters">${filtersHtml}</div>
          <div class="fc-filters">${regionsHtml}</div>
          ${sourceHtml}
          <div class="fc-empty">${escapeHtml(emptyCopy)}</div>
        </div>
      `, 'legacy Panel.setContent() migration'));
      return;
    }

    const filtered = this.activeDomain === 'all'
      ? visibleForecasts
      : visibleForecasts.filter(f => f.domain === this.activeDomain);

    const nexusHtml = this.theaters.length > 0
      ? `<div class="fc-nexus">${this.renderNexus()}</div><div class="fc-section-label">Probability Bets</div>`
      : '';
    const tableHtml = this.renderProbTable(filtered);
    const sourceHtml = this.renderSourceNotice();

    this.setSafeContent(unsafeRawHtml(`
      <div class="fc-panel">
        <div class="fc-filters">${filtersHtml}</div>
        <div class="fc-filters">${regionsHtml}</div>
        ${sourceHtml}
        ${nexusHtml}
        ${tableHtml}
      </div>
    `, 'legacy Panel.setContent() migration'));
  }

  private renderSourceNotice(): string {
    if (!this.sourceState.degraded && !this.sourceState.stale && !this.sourceState.error) return '';
    // Calm, sentence-cased copy — no raw backend error codes in the UI.
    const parts = [
      this.sourceState.degraded ? 'Live forecast feed is catching up' : '',
      this.sourceState.stale ? 'showing cached data' : '',
      !this.sourceState.degraded && this.sourceState.error ? 'retrying automatically' : '',
    ].filter(Boolean);
    return `<div class="fc-source-notice">${escapeHtml(parts.join(' · '))}</div>`;
  }

  // ── NEXUS theater grid + expandable detail ──────────────────────────────

  private renderNexus(): string {
    const cards = this.theaters.map(t => this.renderTheaterCard(t)).join('');
    const detail = this.expandedTheaterId
      ? this.renderTheaterDetail(this.theaters.find(t => t.theaterId === this.expandedTheaterId) ?? null)
      : '';
    return `
      <div class="fc-section-label" style="padding-top:4px">Active Theaters</div>
      <div class="fc-theater-grid">${cards}</div>
      ${detail}
    `;
  }

  private renderTheaterCard(t: SimulationTheater): string {
    const domain = STATE_KIND_DOMAIN[t.stateKind] || 'supply_chain';
    const color = DOMAIN_COLORS[domain] || CATEGORY.blue;
    const catLabel = DOMAIN_LABELS[domain] || domain;
    const dominantPath = t.topPaths[0];
    const conf = dominantPath?.confidence ?? 0;
    const confPct = Math.round(conf * 100);
    // Raw constants: feeds an SVG stroke presentation attribute, where CSS
    // custom properties don't resolve.
    const confColor = conf >= 0.65 ? STATUS.good : conf >= 0.45 ? STATUS.watch : STATUS.alert;
    const isSelected = this.expandedTheaterId === t.theaterId;

    // SVG gauge: circumference for r=15 is 94.25; stroke-dashoffset = circ * (1 - conf)
    const r = 15;
    const circ = 2 * Math.PI * r;
    const offset = circ * (1 - conf);

    return `
      <div class="fc-theater-card${isSelected ? ' fc-theater-selected' : ''}"
           style="--fc-theater-color:${color}"
           data-fc-theater="${escapeHtml(t.theaterId)}">
        <div class="fc-theater-top">
          <div class="fc-theater-name">${escapeHtml(t.theaterLabel)}</div>
          <div class="fc-gauge-wrap">
            <svg class="fc-gauge-svg" viewBox="0 0 34 34">
              <circle class="fc-gauge-bg" cx="17" cy="17" r="${r}"/>
              <circle class="fc-gauge-fill" cx="17" cy="17" r="${r}"
                stroke="${confColor}"
                stroke-dasharray="${circ.toFixed(1)}"
                stroke-dashoffset="${offset.toFixed(1)}"/>
            </svg>
            <span class="fc-gauge-label" style="color:${confColor}">${conf > 0 ? confPct + '%' : '—'}</span>
          </div>
        </div>
        <span class="fc-cat-tag" style="background:${color}1f;color:${color};border:1px solid ${color}47">${escapeHtml(catLabel)}</span>
        ${dominantPath ? `<div class="fc-theater-path">${dominantPath.pathId ? `<span class="fc-path-type fc-path-type-${escapeHtml(dominantPath.pathId)}">${escapeHtml(PATH_ID_LABELS[dominantPath.pathId] ?? dominantPath.pathId)}</span>` : ''}${escapeHtml(dominantPath.label)}</div>` : ''}
      </div>
    `;
  }

  private renderTheaterDetail(t: SimulationTheater | null): string {
    if (!t) return '';
    const domain = STATE_KIND_DOMAIN[t.stateKind] || 'supply_chain';
    const color = DOMAIN_COLORS[domain] || CATEGORY.blue;
    const catLabel = DOMAIN_LABELS[domain] || domain;

    const pathsHtml = t.topPaths.map(p => {
      const pctColor = p.confidence >= 0.65 ? 'var(--status-good)' : p.confidence >= 0.45 ? 'var(--status-watch)' : 'var(--status-alert)';
      const actors = p.keyActors.map(a => `<span class="fc-actor-chip">${escapeHtml(a)}</span>`).join('');
      const typeTag = p.pathId ? `<span class="fc-path-type fc-path-type-${escapeHtml(p.pathId)}">${escapeHtml(PATH_ID_LABELS[p.pathId] ?? p.pathId)}</span>` : '';
      const confText = p.confidence > 0 ? `${Math.round(p.confidence * 100)}% confidence` : '—';
      return `
        <div class="fc-path-card">
          <div class="fc-path-label">${typeTag}${escapeHtml(p.label)}</div>
          <div class="fc-path-conf">${confText}</div>
          <div class="fc-path-bar" style="background:${pctColor};width:${Math.round(p.confidence * 100)}%"></div>
          <div class="fc-path-summary">${escapeHtml(p.summary)}</div>
          ${actors ? `<div class="fc-path-actors">${actors}</div>` : ''}
        </div>
      `;
    }).join('');

    const reactions = t.dominantReactions.map(r =>
      `<div class="fc-footer-item fc-react-item">${escapeHtml(r)}</div>`
    ).join('');
    const stabilizers = t.stabilizers.map(s =>
      `<div class="fc-footer-item fc-stab-item">${escapeHtml(s)}</div>`
    ).join('');
    const invalidators = t.invalidators.map(s =>
      `<div class="fc-footer-item fc-inval-item">${escapeHtml(s)}</div>`
    ).join('');

    return `
      <div class="fc-theater-detail">
        <div class="fc-theater-detail-hdr">
          <span class="fc-theater-detail-name">${escapeHtml(t.theaterLabel)}</span>
          <span class="fc-cat-tag" style="background:${color}1f;color:${color};border:1px solid ${color}47">${escapeHtml(catLabel)}</span>
        </div>
        <div class="fc-theater-paths">${pathsHtml}</div>
        ${reactions || stabilizers || invalidators ? `
          <div class="fc-theater-footer">
            <div class="fc-theater-footer-section">
              <div class="fc-footer-title">Reactions</div>
              ${reactions || '<div class="fc-footer-item" style="opacity:0.4">—</div>'}
            </div>
            <div class="fc-theater-footer-section">
              <div class="fc-footer-title">Stabilizers</div>
              ${stabilizers || '<div class="fc-footer-item" style="opacity:0.4">—</div>'}
            </div>
            <div class="fc-theater-footer-section">
              <div class="fc-footer-title">Invalidators</div>
              ${invalidators || '<div class="fc-footer-item" style="opacity:0.4">—</div>'}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  // ── Probability table (replaces the old 2-col card grid) ────────────────

  private renderProbTable(forecasts: Forecast[]): string {
    if (forecasts.length === 0) {
      return '<div class="fc-empty">No forecasts for this filter</div>';
    }
    const header = `<div class="fc-prob-hdr">
      <span>Forecast</span><span>Probability</span><span>Trend</span><span>Domain</span>
    </div>`;
    const rows = forecasts.map(f => this.renderProbRow(f)).join('');
    return `<div class="fc-prob-table">${header}${rows}</div>`;
  }

  private renderProbRow(f: Forecast): string {
    const pct      = Math.round((f.probability || 0) * 100);
    const domain   = f.domain || 'conflict';
    const catColor = DOMAIN_COLORS[domain] || NEUTRAL.slate;
    const catLabel = DOMAIN_LABELS[domain] || domain;
    const probColor = pct >= 60 ? 'var(--status-good)' : pct >= 40 ? 'var(--status-watch)' : 'var(--status-alert)';
    const trendText  = f.trend === 'rising' ? '↑ rising' : f.trend === 'falling' ? '↓ falling' : '→ stable';
    const trendColor = f.trend === 'rising' ? 'var(--status-good)' : f.trend === 'falling' ? 'var(--status-alert)' : 'var(--text-dim)';

    const sigs = f.signals || [];
    const signalsHtml = sigs.length > 0
      ? sigs.map(s =>
          `<div class="fc-signal">${escapeHtml(s.value.replace(/^[\s\u2013\u2014-]+/, ''))}</div>`
        ).join('')
      : '';

    const simBarHtml = this.renderSimBar(f);
    const simChipHtml = this.renderSimChip(f);
    const demoted = f.demotedBySimulation ?? false;

    return `
      <div class="fc-prob-item">
        <div class="fc-prob-row"${demoted ? ' style="opacity:0.5"' : ''}>
          <div class="fc-prob-label"
               style="border-left:2px solid ${catColor}47;padding-left:6px">
            <div class="fc-label-inner">
              <span class="fc-forecast-title">${escapeHtml(f.title)}</span>
              ${simChipHtml}
            </div>
            ${simBarHtml}
          </div>
          <div class="fc-bar-wrap">
            <div class="fc-prob-bar-track">
              <div class="fc-prob-bar-fill" style="background:${probColor};width:${pct}%"></div>
            </div>
            <span class="fc-prob-pct" style="color:${probColor}">${pct}%</span>
          </div>
          <span class="fc-trend-text" style="color:${trendColor}">${trendText}</span>
          <span class="fc-domain-tag"
                style="background:${catColor}1f;color:${catColor};border:1px solid ${catColor}33">
            ${escapeHtml(catLabel)}
          </span>
        </div>
        <div class="fc-toggle-row">
          <span class="fc-toggle" data-fc-toggle="detail-${escapeHtml(f.id)}">Analysis</span>
          ${sigs.length > 0 ? `<span class="fc-toggle" data-fc-toggle="signals-${escapeHtml(f.id)}">Signals (${sigs.length})</span>` : ''}
        </div>
        <div class="fc-detail fc-hidden" data-fc-panel="detail-${escapeHtml(f.id)}">${f.caseFile ? this.renderDetailBody(f) : ''}</div>
        ${signalsHtml ? `<div class="fc-signals fc-hidden" data-fc-panel="signals-${escapeHtml(f.id)}">${signalsHtml}</div>` : ''}
      </div>
    `;
  }

  // ── Simulation confidence sub-bar ───────────────────────────────────────

  private renderSimBar(f: Forecast): string {
    const adj = f.simulationAdjustment ?? 0;
    if (adj === 0) return '';

    const conf = f.simPathConfidence ?? 1.0;
    const demoted = f.demotedBySimulation ?? false;
    const adjPct = Math.round(Math.abs(adj) * 100);

    let barColor: string;
    let labelText: string;

    if (demoted) {
      barColor = 'var(--status-alert)';
      labelText = `AI flag: dropped · −${adjPct}%`;
    } else if (adj > 0) {
      barColor = conf >= 0.70 ? 'var(--status-good)' : 'var(--status-watch)';
      labelText = conf < 0.70 ? `AI signal (moderate) · +${adjPct}%` : `AI signal · +${adjPct}%`;
    } else {
      barColor = 'var(--status-warn)';
      labelText = `AI caution · −${adjPct}%`;
    }

    // Width encodes sim-path confidence for positive adjustments (at least 20% so bar is visible).
    // Negative adjustments use 100% width — structural signal, not confidence-dependent.
    const barWidthPct = adj > 0 ? Math.round(Math.max(20, conf * 100)) : 100;

    return `<div class="fc-sim-bar-wrap">
      <div class="fc-sim-bar" style="width:${barWidthPct}%;background:${barColor}"></div>
      <span class="fc-sim-label" style="color:${barColor}">${escapeHtml(labelText)}</span>
    </div>`;
  }

  // ── Simulation verdict chip ──────────────────────────────────────────────

  private renderSimChip(f: Forecast): string {
    const adj = f.simulationAdjustment ?? 0;
    const demoted = f.demotedBySimulation ?? false;
    if (demoted) {
      return `<span class="fc-sim-chip fc-sim-chip--skeptical">AI skeptical</span>`;
    }
    if (adj === 0) return '';
    if (adj > 0) {
      return `<span class="fc-sim-chip fc-sim-chip--backed">AI backed</span>`;
    }
    return `<span class="fc-sim-chip fc-sim-chip--flagged">AI flagged</span>`;
  }

  // ── Detail sections (shared by rows) ────────────────────────────────────

  private renderDetailBody(f: Forecast): string {
    const caseFile = f.caseFile;
    const sections: string[] = [];

    if (f.scenario) {
      sections.push(`
        <div class="fc-section">
          <div class="fc-section-title">Executive View</div>
          <div class="fc-section-copy fc-scenario">${escapeHtml(f.scenario)}</div>
        </div>
      `);
    }
    if (caseFile?.baseCase) {
      sections.push(`
        <div class="fc-section">
          <div class="fc-section-title">Base Case</div>
          <div class="fc-section-copy">${escapeHtml(caseFile.baseCase)}</div>
        </div>
      `);
    }
    if (caseFile?.changeSummary || caseFile?.changeItems?.length) {
      sections.push(`
        <div class="fc-section">
          <div class="fc-section-title">What Changed</div>
          ${caseFile?.changeSummary ? `<div class="fc-section-copy">${escapeHtml(caseFile.changeSummary)}</div>` : ''}
          ${caseFile?.changeItems?.length ? this.renderList(caseFile.changeItems) : ''}
        </div>
      `);
    }
    if (caseFile?.worldState?.summary || caseFile?.worldState?.activePressures?.length) {
      sections.push(`
        <div class="fc-section">
          <div class="fc-section-title">World State</div>
          ${caseFile?.worldState?.summary ? `<div class="fc-section-copy">${escapeHtml(caseFile.worldState.summary)}</div>` : ''}
          ${caseFile?.worldState?.activePressures?.length ? `<div class="fc-section-copy"><strong>Pressures:</strong></div>${this.renderList(caseFile.worldState.activePressures)}` : ''}
          ${caseFile?.worldState?.stabilizers?.length ? `<div class="fc-section-copy"><strong>Stabilizers:</strong></div>${this.renderList(caseFile.worldState.stabilizers)}` : ''}
          ${caseFile?.worldState?.keyUnknowns?.length ? `<div class="fc-section-copy"><strong>Key unknowns:</strong></div>${this.renderList(caseFile.worldState.keyUnknowns)}` : ''}
        </div>
      `);
    }
    if (caseFile?.escalatoryCase || caseFile?.contrarianCase) {
      sections.push(`
        <div class="fc-section">
          <div class="fc-section-title">Alternative Paths</div>
          ${caseFile?.escalatoryCase ? `<div class="fc-section-copy"><strong>Escalatory:</strong> ${escapeHtml(caseFile.escalatoryCase)}</div>` : ''}
          ${caseFile?.contrarianCase ? `<div class="fc-section-copy"><strong>Contrarian:</strong> ${escapeHtml(caseFile.contrarianCase)}</div>` : ''}
        </div>
      `);
    }
    if (caseFile?.branches?.length) {
      sections.push(`
        <div class="fc-section">
          <div class="fc-section-title">Simulated Branches</div>
          ${this.renderBranches(caseFile.branches)}
        </div>
      `);
    }
    if (caseFile?.supportingEvidence?.length) {
      sections.push(`
        <div class="fc-section">
          <div class="fc-section-title">Supporting Evidence</div>
          ${this.renderEvidence(caseFile.supportingEvidence)}
        </div>
      `);
    }
    if (caseFile?.counterEvidence?.length) {
      sections.push(`
        <div class="fc-section">
          <div class="fc-section-title">Counter Evidence</div>
          ${this.renderEvidence(caseFile.counterEvidence)}
        </div>
      `);
    }
    if (caseFile?.triggers?.length) {
      sections.push(`
        <div class="fc-section">
          <div class="fc-section-title">Signals To Watch</div>
          ${this.renderList(caseFile.triggers)}
        </div>
      `);
    }
    if (caseFile?.actors?.length) {
      sections.push(`
        <div class="fc-section">
          <div class="fc-section-title">Actors</div>
          ${this.renderActors(caseFile.actors)}
        </div>
      `);
    } else if (caseFile?.actorLenses?.length) {
      sections.push(`
        <div class="fc-section">
          <div class="fc-section-title">Actor Lenses</div>
          ${this.renderList(caseFile.actorLenses)}
        </div>
      `);
    }
    if (f.perspectives?.strategic) {
      sections.push(`
        <div class="fc-section">
          <div class="fc-section-title">Perspectives</div>
          <div class="fc-perspectives">
            <div class="fc-perspective"><strong>Strategic:</strong> ${escapeHtml(f.perspectives.strategic)}</div>
            <div class="fc-perspective"><strong>Regional:</strong> ${escapeHtml(f.perspectives.regional || '')}</div>
            <div class="fc-perspective"><strong>Contrarian:</strong> ${escapeHtml(f.perspectives.contrarian || '')}</div>
          </div>
        </div>
      `);
    }

    const chips = [
      f.calibration?.marketTitle ? `Market: ${f.calibration.marketTitle} (${Math.round((f.calibration.marketPrice || 0) * 100)}%)` : '',
      typeof f.priorProbability === 'number' ? `Prior: ${Math.round(f.priorProbability * 100)}%` : '',
      f.cascades?.length ? `Cascades: ${f.cascades.length}` : '',
    ].filter(Boolean);
    if (chips.length > 0) {
      sections.push(`<div class="fc-section"><div class="fc-section-title">Context</div><div class="fc-chip-row">${chips.map(c => `<span class="fc-chip">${escapeHtml(c)}</span>`).join('')}</div></div>`);
    }

    return `<div class="fc-detail-grid">${sections.join('')}</div>`;
  }

  private renderList(items: string[] | undefined): string {
    if (!items || items.length === 0) return '';
    return `<div class="fc-list-block">${items.map(item => `<div class="fc-list-item">${escapeHtml(item)}</div>`).join('')}</div>`;
  }

  private renderEvidence(items: Array<{ summary?: string; weight?: number }> | undefined): string {
    if (!items || items.length === 0) return '';
    return `<div class="fc-list-block">${items.map(item => {
      const suffix = typeof item.weight === 'number' ? ` (${Math.round(item.weight * 100)}%)` : '';
      return `<div class="fc-list-item">${escapeHtml(`${item.summary || ''}${suffix}`.trim())}</div>`;
    }).join('')}</div>`;
  }

  private renderActors(items: Array<{
    name?: string;
    category?: string;
    role?: string;
    objectives?: string[];
    constraints?: string[];
    likelyActions?: string[];
    influenceScore?: number;
  }> | undefined): string {
    if (!items || items.length === 0) return '';
    return `<div class="fc-list-block">${items.map(actor => {
      const chips = [
        actor.category ? actor.category : '',
        typeof actor.influenceScore === 'number' ? `Influence ${Math.round(actor.influenceScore * 100)}%` : '',
      ].filter(Boolean).map(chip => `<span class="fc-chip">${escapeHtml(chip)}</span>`).join('');
      return `
        <div class="fc-section-copy">
          <strong>${escapeHtml(actor.name || 'Actor')}</strong>
          ${chips ? `<div class="fc-chip-row" style="margin-top:4px;">${chips}</div>` : ''}
          ${actor.role ? `<div class="fc-list-item">${escapeHtml(actor.role)}</div>` : ''}
          ${actor.objectives?.[0] ? `<div class="fc-list-item"><strong>Objective:</strong> ${escapeHtml(actor.objectives[0])}</div>` : ''}
          ${actor.constraints?.[0] ? `<div class="fc-list-item"><strong>Constraint:</strong> ${escapeHtml(actor.constraints[0])}</div>` : ''}
          ${actor.likelyActions?.[0] ? `<div class="fc-list-item"><strong>Likely action:</strong> ${escapeHtml(actor.likelyActions[0])}</div>` : ''}
        </div>
      `;
    }).join('')}</div>`;
  }

  private renderBranches(items: Array<{
    kind?: string;
    title?: string;
    summary?: string;
    outcome?: string;
    projectedProbability?: number;
    rounds?: Array<{ round?: number; focus?: string; developments?: string[]; actorMoves?: string[] }>;
  }> | undefined): string {
    if (!items || items.length === 0) return '';
    return `<div class="fc-list-block">${items.map(branch => {
      const projected = typeof branch.projectedProbability === 'number'
        ? `<span class="fc-chip">Projected ${Math.round(branch.projectedProbability * 100)}%</span>`
        : '';
      const rounds = (branch.rounds || []).slice(0, 3).map(round => {
        const copy = [(round.developments || []).slice(0, 2).join(' '), (round.actorMoves || []).slice(0, 1).join(' ')].filter(Boolean).join(' ');
        return `<div class="fc-list-item"><strong>R${round.round || 0}:</strong> ${escapeHtml(copy || round.focus || '')}</div>`;
      }).join('');
      return `
        <div class="fc-section-copy">
          <strong>${escapeHtml(branch.title || branch.kind || 'Branch')}</strong>
          <div class="fc-chip-row" style="margin-top:4px;">${projected}</div>
          ${branch.summary ? `<div class="fc-list-item">${escapeHtml(branch.summary)}</div>` : ''}
          ${branch.outcome ? `<div class="fc-list-item"><strong>Outcome:</strong> ${escapeHtml(branch.outcome)}</div>` : ''}
          ${rounds}
        </div>
      `;
    }).join('')}</div>`;
  }
}
