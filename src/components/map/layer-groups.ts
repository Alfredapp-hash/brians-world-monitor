/**
 * WS3 · Grouped map-layer panel — shared by ALL map engines.
 *
 * Both the DeckGL/Globe checkbox pickers and the SVG fallback's chip wall
 * render their existing per-layer rows (`.layer-toggle-row` — ids, labels,
 * click handlers and explain buttons untouched), then hand the row container
 * to `groupLayerToggles()`, which re-houses the rows into collapsible themed
 * group sections. Because the grouping (membership, order, headers, master
 * toggles, persistence) lives in this one module, the flat map and the globe
 * cannot drift.
 *
 * Master toggles actuate the engine's OWN controls (checkbox `change`
 * dispatch / button `.click()`), so every engine side effect — weather radar,
 * aircraft timers, choropleth exclusivity, analytics — runs through the
 * exact same code path as a manual click.
 */

import type { MapLayers } from '@/types';
import { setTrustedHtml, trustedHtml } from '@/utils/dom-utils';

export interface LayerGroupDef {
  id: string;
  /** Plain-language group name. What a non-analyst would call this shelf. */
  label: string;
  /** One-line "what is in here" shown as the header tooltip. */
  hint?: string;
  layers: readonly (keyof MapLayers)[];
}

/** localStorage key for per-group collapsed/expanded persistence. */
export const LAYER_GROUPS_OPEN_STORAGE_KEY = 'jsam-layer-groups-open';

/** localStorage key for the whole-panel (hamburger) collapsed/expanded state. */
export const LAYER_PANEL_COLLAPSED_STORAGE_KEY = 'jsam-layer-panel-collapsed';

const HAMBURGER_ICON = '&#9776;'; // ☰
const CLOSE_ICON = '&#10005;'; // ✕

/**
 * Human name for the collapsed picker button. The panel boots collapsed, so
 * this pill IS the map's layer affordance — a bare ☰ next to a legend reads as
 * "some menu", which is why the picker went unfound.
 */
const COLLAPSED_PANEL_LABEL = 'Layers';

/**
 * `data-*` attribute `groupLayerToggles().refresh()` writes the live
 * active-layer count onto the panel element, so the collapsed pill can report
 * "Layers · 7" without the two binders having to share a closure.
 */
const ACTIVE_COUNT_ATTR = 'data-active-layers';

/**
 * Panel element → "redraw your collapsed pill" callback, registered by
 * `bindLayerPanelCollapse` and invoked from `groupLayerToggles().refresh()`.
 * A WeakMap rather than a parameter because the engines call the two functions
 * separately (and in opposite orders), and neither needs to learn about the
 * other to keep the count honest.
 */
const collapsedLabelUpdaters = new WeakMap<HTMLElement, () => void>();

/** Repaint the collapsed pill of the panel that owns `listEl`, if any. */
function refreshCollapsedPanelLabel(listEl: HTMLElement): void {
  const panel = listEl.closest<HTMLElement>('.layer-toggles');
  if (!panel) return;
  collapsedLabelUpdaters.get(panel)?.();
}

function loadPanelCollapsed(): boolean | null {
  try {
    const raw = localStorage.getItem(LAYER_PANEL_COLLAPSED_STORAGE_KEY);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return null;
  } catch {
    return null;
  }
}

function savePanelCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(LAYER_PANEL_COLLAPSED_STORAGE_KEY, String(collapsed));
  } catch {
    /* storage unavailable (private mode) — collapse state is session-only */
  }
}

/**
 * Wires the layer panel's hamburger (☰) button so a single click
 * expands/collapses the ENTIRE panel — title, search box, and layer list —
 * down to just the icon button, instead of only hiding the list body.
 * Boots collapsed by default (declutters the map on first paint) unless the
 * user has previously expanded it, in which case that preference persists
 * across sessions via localStorage. Shared by the DeckGL and Globe map
 * engines so the affordance and behavior stay identical between them.
 */
export function bindLayerPanelCollapse(panelEl: HTMLElement, collapseBtn: HTMLElement): void {
  const stored = loadPanelCollapsed();
  collapseBtn.classList.add('layer-panel-toggle');

  const paint = (): void => {
    const collapsed = panelEl.classList.contains('layer-panel-collapsed');
    const active = Number(panelEl.getAttribute(ACTIVE_COUNT_ATTR) ?? '0');
    collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    collapseBtn.setAttribute(
      'aria-label',
      collapsed
        ? `Choose map layers${active > 0 ? ` — ${active} on` : ''}`
        : 'Hide map layers',
    );
    collapseBtn.setAttribute('title', collapsed ? 'Choose what is on the map' : 'Hide map layers');
    // Collapsed, the button is the picker's only affordance, so it says what it
    // opens and how much is already on. Expanded, the panel header carries the
    // title and the button goes back to being a plain close control.
    if (!collapsed) {
      setTrustedHtml(collapseBtn, trustedHtml(CLOSE_ICON, 'static close glyph for the layer panel toggle'));
      return;
    }
    setTrustedHtml(
      collapseBtn,
      trustedHtml(
        `${HAMBURGER_ICON} <span class="layer-panel-toggle-text">${COLLAPSED_PANEL_LABEL}</span>`
        + (active > 0 ? ` <span class="layer-panel-toggle-count">${active}</span>` : ''),
        'static hamburger glyph plus a numeric active-layer count',
      ),
    );
  };
  collapsedLabelUpdaters.set(panelEl, paint);

  const setCollapsed = (collapsed: boolean): void => {
    // Reuses the SAME class name the SVG fallback's panel pill already uses
    // (see the `opts.panelLabel` branch below) so all three map engines
    // share one collapsed-panel CSS rule instead of three near-duplicates.
    panelEl.classList.toggle('layer-panel-collapsed', collapsed);
    paint();
  };
  setCollapsed(stored ?? true);
  collapseBtn.addEventListener('click', () => {
    // Reads the class this function actually SETS. It previously probed
    // `panel-collapsed` — a Panel.ts class never applied here — so the
    // expression was permanently `true` and every click re-collapsed an
    // already-collapsed panel. The picker could not be opened at all.
    const nowCollapsed = !panelEl.classList.contains('layer-panel-collapsed');
    setCollapsed(nowCollapsed);
    savePanelCollapsed(nowCollapsed);
  });
}

export const OTHER_GROUP_ID = 'other';

/**
 * Complete group → layer-id mapping. Every key in LAYER_REGISTRY appears in
 * exactly one group; any layer key NOT listed here (future additions) falls
 * back to the 'other' group via groupForLayer(), so nothing can disappear.
 * Within a group, layers render in the order declared here (identical across
 * engines); layers unavailable in the current variant/engine simply have no
 * row, same as today.
 *
 * GROUPS ARE NAMED FOR WHAT PEOPLE COME LOOKING FOR, not for the desk that
 * owns the feed. "Cameras & live views" beats "Surveillance" because someone
 * hunting for street cameras types "camera", and disease belongs on its own
 * shelf rather than filed behind "Nuclear & Hazard" where nobody looks for it.
 * Groups whose every row is missing in the current variant/engine are hidden
 * by refresh(), so a `happy` reader never sees a war shelf.
 */
export const LAYER_GROUPS: readonly LayerGroupDef[] = [
  {
    id: 'cameras',
    label: 'Cameras & live views',
    hint: 'Public traffic and city cameras you can watch, plus what is overhead.',
    layers: ['webcams', 'alprCameras', 'satellites'],
  },
  {
    id: 'health',
    label: 'Health & disease',
    hint: 'Active disease outbreaks being tracked around the world.',
    layers: ['diseaseOutbreaks'],
  },
  {
    id: 'weather-nature',
    label: 'Weather & nature',
    hint: 'Storm warnings, earthquakes, wildfires and climate anomalies.',
    layers: ['weather', 'natural', 'fires', 'climate', 'dayNight'],
  },
  {
    id: 'conflict',
    label: 'War & conflict',
    hint: 'Fighting, tension hotspots and military presence.',
    layers: ['conflicts', 'ucdpEvents', 'hotspots', 'military', 'bases', 'gpsJamming', 'iranAttacks'],
  },
  {
    id: 'travel',
    label: 'Ships & flights',
    hint: 'Live vessel and aircraft movement, ports, routes and chokepoints.',
    layers: ['ais', 'liveTankers', 'flights', 'commodityPorts', 'tradeRoutes', 'waterways'],
  },
  {
    id: 'nuclear-radiation',
    label: 'Nuclear & radiation',
    hint: 'Reactors, radiation readings and radioactive-source sites.',
    layers: ['nuclear', 'radiationWatch', 'irradiators'],
  },
  {
    id: 'energy-internet',
    label: 'Power, pipes & internet',
    hint: 'Pipelines, fuel, clean energy, cables, outages and cyber attacks.',
    layers: [
      'pipelines', 'storageFacilities', 'fuelShortages', 'renewableInstallations',
      'cables', 'outages', 'cyberThreats', 'datacenters', 'cloudRegions', 'spaceports',
    ],
  },
  {
    id: 'people',
    label: 'People & society',
    hint: 'Protests, displacement, sanctions and good-news signals.',
    layers: [
      'protests', 'displacement', 'sanctions',
      'positiveEvents', 'kindness', 'happiness', 'speciesRecovery',
    ],
  },
  {
    id: 'money-resources',
    label: 'Money & resources',
    hint: 'Markets, banks, mines, minerals and the tech economy.',
    layers: [
      'economic', 'stockExchanges', 'financialCenters', 'centralBanks',
      'commodityHubs', 'gulfInvestments',
      'minerals', 'miningSites', 'processingPlants',
      'startupHubs', 'techHQs', 'accelerators', 'techEvents',
    ],
  },
  {
    id: 'country-risk',
    label: 'Country risk',
    hint: 'Whole-country shading for instability and resilience.',
    layers: ['ciiChoropleth', 'resilienceScore'],
  },
  {
    id: OTHER_GROUP_ID,
    label: 'Other',
    layers: [],
  },
];

/**
 * Picker-only plain-language renames.
 *
 * The engines build each row's label through `resolveLayerLabel()`, which
 * prefers the i18n string and falls back to `LayerDefinition.fallbackLabel`.
 * Those names are written for analysts — "Ship Traffic", "Armed Conflict
 * Events", "CII Instability" — and the legend, the CMD+K palette and the
 * layer-explanation cards all read the same source, so renaming them there
 * would ripple into surfaces this pass is not touching.
 *
 * `from` is therefore matched against the label the engine actually rendered:
 * a rename applies ONLY when the row is still showing the English source
 * string. A reader on a translated locale keeps their translation untouched
 * instead of being dropped back into English — which is exactly what a blind
 * overwrite would do, since most of these keys do have locale entries.
 */
export interface PlainLayerLabel {
  /** The English label the engines currently render for this layer. */
  from: string;
  /** What a non-analyst would call it. */
  to: string;
}

export const PLAIN_LAYER_LABELS: Partial<Record<keyof MapLayers, PlainLayerLabel>> = {
  webcams: { from: 'Live Webcams', to: 'Live cameras' },
  alprCameras: { from: 'ALPR Cameras', to: 'Plate-reader cameras' },
  satellites: { from: 'Orbital Surveillance', to: 'Satellites overhead' },
  diseaseOutbreaks: { from: 'Disease Outbreaks', to: 'Disease outbreaks' },
  weather: { from: 'Weather Alerts', to: 'Weather warnings' },
  natural: { from: 'Natural Events', to: 'Earthquakes & disasters' },
  fires: { from: 'Fires', to: 'Wildfires' },
  climate: { from: 'Climate Anomalies', to: 'Climate anomalies' },
  dayNight: { from: 'Day/Night', to: 'Daylight & night' },
  conflicts: { from: 'Conflict Zones', to: 'Conflict zones' },
  ucdpEvents: { from: 'Armed Conflict Events', to: 'Battles & clashes' },
  hotspots: { from: 'Intel Hotspots', to: 'Tension hotspots' },
  military: { from: 'Military Activity', to: 'Military movements' },
  bases: { from: 'Military Bases', to: 'Military bases' },
  gpsJamming: { from: 'GPS JAMMING', to: 'GPS jamming' },
  ais: { from: 'Ship Traffic', to: 'Ships' },
  liveTankers: { from: 'Live Tanker Positions', to: 'Oil tankers' },
  flights: { from: 'Aviation', to: 'Flights & airports' },
  commodityPorts: { from: 'Commodity Ports', to: 'Ports' },
  tradeRoutes: { from: 'Trade Routes', to: 'Shipping routes' },
  waterways: { from: 'Chokepoints', to: 'Shipping chokepoints' },
  nuclear: { from: 'Nuclear Sites', to: 'Nuclear sites' },
  radiationWatch: { from: 'Radiation Watch', to: 'Radiation readings' },
  irradiators: { from: 'Gamma Irradiators', to: 'Gamma irradiators' },
  pipelines: { from: 'Pipelines', to: 'Oil & gas pipelines' },
  storageFacilities: { from: 'Storage Facilities', to: 'Fuel storage' },
  fuelShortages: { from: 'Fuel Shortages', to: 'Fuel shortages' },
  renewableInstallations: { from: 'Clean Energy', to: 'Clean energy' },
  cables: { from: 'Undersea Cables', to: 'Internet cables' },
  outages: { from: 'Internet Disruptions', to: 'Internet outages' },
  cyberThreats: { from: 'Cyber Threats', to: 'Cyber attacks' },
  datacenters: { from: 'AI Data Centers', to: 'AI data centers' },
  cloudRegions: { from: 'Cloud Regions', to: 'Cloud regions' },
  protests: { from: 'Protests', to: 'Protests' },
  displacement: { from: 'Displacement Flows', to: 'Refugee movements' },
  positiveEvents: { from: 'Positive Events', to: 'Good news' },
  kindness: { from: 'Acts of Kindness', to: 'Acts of kindness' },
  happiness: { from: 'World Happiness', to: 'World happiness' },
  speciesRecovery: { from: 'Species Recovery', to: 'Wildlife recovery' },
  economic: { from: 'Economic Centers', to: 'Economic centers' },
  stockExchanges: { from: 'Stock Exchanges', to: 'Stock exchanges' },
  financialCenters: { from: 'Financial Centers', to: 'Financial centers' },
  centralBanks: { from: 'Central Banks', to: 'Central banks' },
  commodityHubs: { from: 'Commodity Hubs', to: 'Commodity hubs' },
  gulfInvestments: { from: 'GCC Investments', to: 'Gulf investments' },
  minerals: { from: 'Critical Minerals', to: 'Critical minerals' },
  miningSites: { from: 'Mining Sites', to: 'Mines' },
  processingPlants: { from: 'Processing Plants', to: 'Processing plants' },
  startupHubs: { from: 'Startup Hubs', to: 'Startup hubs' },
  techHQs: { from: 'Tech HQs', to: 'Tech headquarters' },
  accelerators: { from: 'Accelerators', to: 'Startup accelerators' },
  techEvents: { from: 'Tech Events', to: 'Tech events' },
  ciiChoropleth: { from: 'CII Instability', to: 'Country instability' },
  resilienceScore: { from: 'Resilience', to: 'Country resilience' },
};

/**
 * Plain-language name for a picker row, or `rendered` untouched when there is
 * no rename or the row is already showing a translation.
 */
export function plainLayerLabel(key: keyof MapLayers, rendered: string): string {
  const entry = PLAIN_LAYER_LABELS[key];
  if (!entry) return rendered;
  const trimmed = rendered.trim();
  if (trimmed.toLowerCase() !== entry.from.toLowerCase()) return rendered;
  return entry.to;
}

/** Resolve the group a layer belongs to; unknown keys land in 'other'. */
export function groupForLayer(key: keyof MapLayers): LayerGroupDef {
  const fallback = LAYER_GROUPS[LAYER_GROUPS.length - 1] as LayerGroupDef;
  return LAYER_GROUPS.find((g) => (g.layers as readonly string[]).includes(key)) ?? fallback;
}

export interface GroupedLayerPanelOptions {
  /** Element whose direct `.layer-toggle-row` children get grouped. */
  listEl: HTMLElement;
  /** Engine-state truth for whether a layer is currently on. */
  isActive: (key: keyof MapLayers) => boolean;
  /**
   * When set, render a compact panel header pill (used by the SVG fallback,
   * which has no toggle-header of its own). At narrow viewports the panel
   * boots collapsed to just this pill so it never covers the map.
   */
  panelLabel?: string;
}

export interface GroupedLayerPanelHandle {
  /** Recompute counts, master-toggle states, and group visibility. */
  refresh(): void;
}

type OpenState = Record<string, boolean>;

function loadOpenState(): OpenState {
  try {
    const raw = localStorage.getItem(LAYER_GROUPS_OPEN_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as OpenState) : {};
  } catch {
    return {};
  }
}

function saveOpenState(state: OpenState): void {
  try {
    localStorage.setItem(LAYER_GROUPS_OPEN_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable (private mode) — collapse state is session-only */
  }
}

interface GroupSection {
  def: LayerGroupDef;
  section: HTMLElement;
  header: HTMLElement;
  master: HTMLInputElement;
  count: HTMLElement;
  chevron: HTMLElement;
  body: HTMLElement;
  rows: Array<{ key: keyof MapLayers; row: HTMLElement }>;
}

/**
 * A row hidden by the engine (hideLayerToggle / data-layer-hidden) — excluded
 * from counts and master toggles. Search-hidden rows set display on the ROW,
 * engine hiding marks the `.layer-toggle` itself, so counts stay stable while
 * the user types a query.
 */
function isRowLayerHidden(row: HTMLElement): boolean {
  const toggle = row.querySelector<HTMLElement>('.layer-toggle');
  if (!toggle) return true;
  if (toggle.hasAttribute('data-layer-hidden')) return true;
  if (toggle.style.display === 'none') return true;
  return false;
}

/** The clickable control inside a row: a checkbox (DeckGL/Globe) or a button (SVG). */
function rowControl(row: HTMLElement): HTMLInputElement | HTMLButtonElement | null {
  return row.querySelector<HTMLInputElement>('.layer-toggle input[type="checkbox"]')
    ?? row.querySelector<HTMLButtonElement>('button.layer-toggle');
}

/**
 * Swap a row's analyst label for its plain-language name in place.
 *
 * Only text is rewritten — the lock glyph stays attached to the name and the
 * `PRO` badge element is left alone — so premium gating and the unlock pass in
 * DeckGLMap (which strips ' 🔒' from `.toggle-label`) keep working unchanged.
 * The original name is preserved on the toggle as `data-search-alias` so a
 * reader who knows the old vocabulary can still search for it.
 */
export function applyPlainRowLabel(key: keyof MapLayers, row: HTMLElement): void {
  const toggle = row.querySelector<HTMLElement>('.layer-toggle');
  if (!toggle) return;
  // DeckGL/Globe wrap the name in `.toggle-label`; the SVG chip is a bare
  // button whose textContent IS the name.
  const host = row.querySelector<HTMLElement>('.toggle-label')
    ?? (toggle.tagName === 'BUTTON' ? toggle : null);
  if (!host) return;

  const textNode = Array.from(host.childNodes).find(
    (node) => node.nodeType === 3 && (node.textContent ?? '').trim().length > 0,
  );
  if (!textNode) return;

  const raw = textNode.textContent ?? '';
  const locked = raw.includes('\uD83D\uDD12');
  const rendered = raw.replace('\uD83D\uDD12', '').trim();
  const plain = plainLayerLabel(key, rendered);
  if (plain === rendered) return;

  textNode.textContent = locked ? `${plain} \uD83D\uDD12` : plain;
  toggle.setAttribute('data-search-alias', rendered);
  // `aria-label` on the label/button would otherwise still announce the old
  // name (DeckGLMap/GlobeMap build the explain button's label from it).
  const explain = row.querySelector<HTMLElement>('.layer-explain-btn');
  if (explain) {
    const explainLabel = `Explain ${plain} layer`;
    explain.setAttribute('aria-label', explainLabel);
    if (explain.hasAttribute('title')) explain.setAttribute('title', explainLabel);
  }
}

/**
 * Re-house existing `.layer-toggle-row` elements into collapsible group
 * sections. Rows keep their identity (elements are moved, not rebuilt), so
 * all existing listeners and `querySelector('.layer-toggle[data-layer=…]')`
 * lookups keep working.
 */
export function groupLayerToggles(opts: GroupedLayerPanelOptions): GroupedLayerPanelHandle {
  const { listEl, isActive } = opts;
  const allRows = Array.from(listEl.querySelectorAll<HTMLElement>(':scope > .layer-toggle-row'));
  if (allRows.length === 0) return { refresh: () => {} };

  const rowByKey = new Map<keyof MapLayers, HTMLElement>();
  const keyOrder: Array<keyof MapLayers> = [];
  for (const row of allRows) {
    const key = row.dataset.layer as keyof MapLayers | undefined;
    if (!key || rowByKey.has(key)) continue;
    rowByKey.set(key, row);
    keyOrder.push(key);
  }

  // Membership: group-declared order first, then any stragglers (unknown ids)
  // into 'other' in engine order — nothing may disappear.
  const membership = new Map<string, Array<{ key: keyof MapLayers; row: HTMLElement }>>();
  for (const group of LAYER_GROUPS) membership.set(group.id, []);
  const claimed = new Set<keyof MapLayers>();
  for (const group of LAYER_GROUPS) {
    for (const key of group.layers) {
      const row = rowByKey.get(key);
      if (!row) continue;
      membership.get(group.id)?.push({ key, row });
      claimed.add(key);
    }
  }
  for (const key of keyOrder) {
    if (claimed.has(key)) continue;
    const row = rowByKey.get(key);
    if (row) membership.get(OTHER_GROUP_ID)?.push({ key, row });
  }

  const openState = loadOpenState();
  const sections: GroupSection[] = [];

  // Marker so sections take the rows' original position (before e.g. the
  // SVG panel's trailing help button).
  const marker = document.createComment('layer-groups');
  listEl.insertBefore(marker, allRows[0] ?? null);

  for (const group of LAYER_GROUPS) {
    const rows = membership.get(group.id) ?? [];
    if (rows.length === 0) continue;

    const section = document.createElement('section');
    section.className = 'layer-group';
    section.dataset.group = group.id;

    const header = document.createElement('div');
    header.className = 'layer-group-header';
    header.setAttribute('role', 'button');
    header.tabIndex = 0;
    if (group.hint) header.setAttribute('title', group.hint);

    const master = document.createElement('input');
    master.type = 'checkbox';
    master.className = 'layer-group-master';
    master.setAttribute('aria-label', `Toggle all ${group.label} layers`);

    const name = document.createElement('span');
    name.className = 'layer-group-name';
    name.textContent = group.label;

    const count = document.createElement('span');
    count.className = 'layer-group-count';

    const chevron = document.createElement('span');
    chevron.className = 'layer-group-chevron';
    chevron.textContent = '▾';
    chevron.setAttribute('aria-hidden', 'true');

    header.append(master, name, count, chevron);

    const body = document.createElement('div');
    body.className = 'layer-group-body';
    for (const { key, row } of rows) {
      applyPlainRowLabel(key, row);
      body.appendChild(row);
    }

    section.append(header, body);
    listEl.insertBefore(section, marker);

    const entry: GroupSection = { def: group, section, header, master, count, chevron, body, rows };
    sections.push(entry);

    // Default: collapsed unless the group holds an active layer; stored
    // preference wins over the default.
    const defaultOpen = rows.some(({ key }) => isActive(key));
    const open = openState[group.id] ?? defaultOpen;
    setSectionOpen(entry, open);

    const toggleOpen = (): void => {
      const nowOpen = entry.section.classList.contains('collapsed');
      setSectionOpen(entry, nowOpen);
      openState[group.id] = nowOpen;
      saveOpenState(openState);
    };
    header.addEventListener('click', (e) => {
      if (e.target === master) return; // master toggle handled below
      toggleOpen();
    });
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleOpen();
      }
    });

    // Group master toggle: mixed/none → all on, all on → all off. Native
    // checkbox semantics give us exactly that (indeterminate click → checked).
    master.addEventListener('click', (e) => e.stopPropagation());
    master.addEventListener('change', () => {
      const target = master.checked;
      for (const { key, row } of entry.rows) {
        if (isRowLayerHidden(row)) continue;
        if (isActive(key) === target) continue;
        const input = row.querySelector<HTMLInputElement>('.layer-toggle input[type="checkbox"]');
        if (input) {
          if (input.disabled) continue; // premium-locked — master skips it
          input.checked = target;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          continue;
        }
        const btn = row.querySelector<HTMLButtonElement>('button.layer-toggle');
        if (btn && !btn.disabled) btn.click();
      }
      refresh();
    });
  }
  marker.remove();

  function setSectionOpen(entry: GroupSection, open: boolean): void {
    entry.section.classList.toggle('collapsed', !open);
    entry.header.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  // Optional panel pill/header (SVG fallback). Narrow viewports boot
  // collapsed so the panel is reachable but never covers the map.
  let pill: HTMLButtonElement | null = null;
  if (opts.panelLabel) {
    pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'layer-groups-pill';
    pill.setAttribute('aria-expanded', 'true');
    listEl.insertBefore(pill, listEl.firstChild);
    const setPanelCollapsed = (collapsed: boolean): void => {
      listEl.classList.toggle('layer-panel-collapsed', collapsed);
      pill?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    };
    pill.addEventListener('click', () => {
      setPanelCollapsed(!listEl.classList.contains('layer-panel-collapsed'));
    });
    if (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 768px)').matches) {
      setPanelCollapsed(true);
    }
  }

  function refresh(): void {
    let totalActive = 0;
    for (const entry of sections) {
      const available = entry.rows.filter(({ row }) => !isRowLayerHidden(row));
      const active = available.filter(({ key }) => isActive(key)).length;
      totalActive += active;
      entry.count.textContent = `${active}/${available.length}`;
      entry.master.checked = available.length > 0 && active === available.length;
      entry.master.indeterminate = active > 0 && active < available.length;
      // Hide a group whose every row is engine-hidden, or (while searching)
      // whose every row the search filtered out.
      const searchVisible = entry.rows.some(({ row }) => row.style.display !== 'none' && !isRowLayerHidden(row));
      entry.section.style.display = available.length > 0 && searchVisible ? '' : 'none';
    }
    if (pill && opts.panelLabel) {
      pill.textContent = totalActive > 0 ? `${opts.panelLabel} · ${totalActive}` : opts.panelLabel;
    }
    // Publish the count for the collapsed hamburger pill (DeckGL/Globe), which
    // is bound separately in bindLayerPanelCollapse.
    const panel = listEl.closest<HTMLElement>('.layer-toggles');
    panel?.setAttribute(ACTIVE_COUNT_ATTR, String(totalActive));
    refreshCollapsedPanelLabel(listEl);
  }

  // Whole-row click → toggle. The `<label>`/`<button>` already covers most of
  // the row, but the gap beside it, the row padding and the icon gutter were
  // dead space, which makes a dense list feel unresponsive. Clicks that land
  // on the control, its descendants, or the explain button are left alone so
  // the engines' own handlers fire exactly once.
  listEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('.layer-toggle') || target.closest('.layer-explain-btn')) return;
    if (target.closest('.layer-group-header')) return;
    const row = target.closest<HTMLElement>('.layer-toggle-row');
    if (!row || !listEl.contains(row)) return;
    if (isRowLayerHidden(row)) return;
    const control = rowControl(row);
    if (!control || control.disabled) return;
    if (control.tagName === 'INPUT') {
      const input = control as HTMLInputElement;
      input.checked = !input.checked;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      control.click();
    }
  });

  // Per-layer user toggles bubble up as checkbox `change` (DeckGL/Globe) or
  // button clicks (SVG). Refresh after the engine handler has run.
  listEl.addEventListener('change', (e) => {
    const el = e.target as HTMLElement;
    if (el.closest('.layer-toggle')) queueMicrotask(refresh);
  });
  listEl.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el.closest('button.layer-toggle')) queueMicrotask(refresh);
  });

  // Keep grouped sections coherent with the layer search: while a query is
  // live, force group bodies open (CSS hook) and re-derive group visibility
  // after bindLayerSearch has applied row display changes.
  const search = listEl.closest('.layer-toggles')?.querySelector<HTMLInputElement>('.layer-search');
  search?.addEventListener('input', () => {
    queueMicrotask(() => {
      listEl.classList.toggle('layer-groups-searching', search.value.trim().length > 0);
      refresh();
    });
  });

  refresh();
  return { refresh };
}
