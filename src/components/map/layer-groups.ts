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
  label: string;
  layers: readonly (keyof MapLayers)[];
}

/** localStorage key for per-group collapsed/expanded persistence. */
export const LAYER_GROUPS_OPEN_STORAGE_KEY = 'jsam-layer-groups-open';

/** localStorage key for the whole-panel (hamburger) collapsed/expanded state. */
export const LAYER_PANEL_COLLAPSED_STORAGE_KEY = 'jsam-layer-panel-collapsed';

const HAMBURGER_ICON = '&#9776;'; // ☰
const CLOSE_ICON = '&#10005;'; // ✕

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
  const setCollapsed = (collapsed: boolean): void => {
    // Reuses the SAME class name the SVG fallback's panel pill already uses
    // (see the `opts.panelLabel` branch below) so all three map engines
    // share one collapsed-panel CSS rule instead of three near-duplicates.
    panelEl.classList.toggle('layer-panel-collapsed', collapsed);
    collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    collapseBtn.setAttribute('aria-label', collapsed ? 'Show map layers menu' : 'Hide map layers menu');
    setTrustedHtml(collapseBtn, trustedHtml(collapsed ? HAMBURGER_ICON : CLOSE_ICON, 'static hamburger/close glyph for the layer panel toggle'));
  };
  setCollapsed(stored ?? true);
  collapseBtn.addEventListener('click', () => {
    const nowCollapsed = !panelEl.classList.contains('panel-collapsed');
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
 */
export const LAYER_GROUPS: readonly LayerGroupDef[] = [
  {
    id: 'military-conflict',
    label: 'Military & Conflict',
    layers: ['conflicts', 'ucdpEvents', 'hotspots', 'bases', 'military', 'iranAttacks'],
  },
  {
    id: 'nuclear-hazard',
    label: 'Nuclear & Hazard',
    layers: ['nuclear', 'irradiators', 'radiationWatch', 'weather', 'natural', 'fires', 'climate', 'diseaseOutbreaks'],
  },
  {
    id: 'surveillance',
    label: 'Surveillance',
    layers: ['alprCameras', 'gpsJamming', 'satellites', 'webcams'],
  },
  {
    id: 'infrastructure-energy',
    label: 'Infrastructure & Energy',
    layers: [
      'pipelines', 'cables', 'datacenters', 'outages', 'cyberThreats',
      'storageFacilities', 'fuelShortages', 'renewableInstallations',
      'minerals', 'miningSites', 'processingPlants', 'spaceports', 'cloudRegions',
      'economic', 'ciiChoropleth', 'resilienceScore',
      'stockExchanges', 'financialCenters', 'centralBanks', 'commodityHubs', 'gulfInvestments',
    ],
  },
  {
    id: 'movement',
    label: 'Movement',
    layers: ['ais', 'liveTankers', 'flights', 'waterways', 'tradeRoutes', 'commodityPorts'],
  },
  {
    id: 'civil',
    label: 'Civil',
    layers: ['protests', 'sanctions', 'displacement', 'positiveEvents', 'kindness', 'happiness', 'speciesRecovery'],
  },
  {
    id: OTHER_GROUP_ID,
    label: 'Other',
    layers: ['startupHubs', 'techHQs', 'accelerators', 'techEvents', 'dayNight'],
  },
];

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
    for (const { row } of rows) body.appendChild(row);

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
  }

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
