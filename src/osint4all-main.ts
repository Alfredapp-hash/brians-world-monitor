import './styles/osint4all.css';
import { BRAND } from '@/config/brand';
import {
  OSINT_CATEGORIES,
  OSINT_TOOLS,
  filterOsintTools,
  type OsintCategory,
  type OsintPricing,
  type OsintTool,
} from '@/data/osint-tools';

const PIN_KEY = 'tpd-osint4all-pins';

function loadPins(): Set<string> {
  try {
    const raw = localStorage.getItem(PIN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function savePins(pins: Set<string>): void {
  localStorage.setItem(PIN_KEY, JSON.stringify([...pins]));
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function renderCard(tool: OsintTool, pins: Set<string>, onPin: (id: string) => void): HTMLElement {
  const card = el('article', 'o4a-card');
  card.append(el('h2', '', tool.name), el('div', 'o4a-domain', tool.domain));
  const meta = el('div', 'o4a-meta');
  meta.append(el('span', 'o4a-chip', tool.category), el('span', 'o4a-chip', tool.pricing));
  if (tool.usedByDispatch) meta.append(el('span', 'o4a-chip is-dispatch', 'Used on the Dispatch map'));
  card.append(meta, el('p', '', tool.summary), el('p', '', `Best for: ${tool.bestFor}`));
  const actions = el('div', 'o4a-actions');
  const visit = el('a', 'o4a-visit', 'Visit tool');
  visit.href = tool.url;
  visit.target = '_blank';
  visit.rel = 'noopener noreferrer';
  const pin = el('button', 'o4a-pin', pins.has(tool.id) ? 'Pinned' : 'Pin');
  pin.type = 'button';
  pin.addEventListener('click', () => onPin(tool.id));
  actions.append(visit, pin);
  card.append(actions);
  return card;
}

function boot(): void {
  const root = document.getElementById('osintRoot');
  if (!root) return;

  const pins = loadPins();
  const state = { query: '', category: 'Any' as OsintCategory | 'Any', pricing: 'Any' as OsintPricing | 'Any' };

  const page = el('main', 'o4a');
  const brand = el('a', 'o4a-brand', BRAND.name);
  brand.href = '/';
  page.append(brand);
  page.append(el('h1', '', 'OSINT4ALL'));
  page.append(
    el(
      'p',
      'o4a-lede',
      'A civilian directory of public tools: archives, registries, maps, constitutions, and travel advisories. Search by job. Filters do not change editorial order. Nothing here is ranked because someone paid.',
    ),
  );

  const filters = el('div', 'o4a-filters');
  const search = el('input', 'o4a-search') as HTMLInputElement;
  search.type = 'search';
  search.placeholder = 'Search by job, source type, or tool name';
  search.setAttribute('aria-label', 'Search tools');
  const cat = el('select', 'o4a-select') as HTMLSelectElement;
  cat.setAttribute('aria-label', 'Category');
  cat.append(new Option('Any category', 'Any'));
  for (const c of OSINT_CATEGORIES) cat.append(new Option(c, c));
  const price = el('select', 'o4a-select') as HTMLSelectElement;
  price.setAttribute('aria-label', 'Pricing');
  for (const p of ['Any', 'Free', 'Freemium', 'Paid'] as const) price.append(new Option(p === 'Any' ? 'Any pricing' : p, p));
  filters.append(search, cat, price);
  page.append(filters);

  const count = el('div', 'o4a-count');
  const grid = el('div', 'o4a-grid');
  page.append(count, grid);
  page.append(el('p', 'o4a-rule', `Editorial directory · ${OSINT_TOOLS.length} tools · pin list stays in this browser.`));
  const nav = el('nav', 'o4a-nav');
  const about = el('a', '', 'About');
  about.href = BRAND.about;
  const dash = el('a', '', 'Open the dashboard');
  dash.href = '/';
  nav.append(about, dash);
  page.append(nav);
  root.replaceChildren(page);

  const paint = () => {
    const tools = filterOsintTools(state);
    count.textContent = `${tools.length} tools`;
    grid.replaceChildren();
    if (tools.length === 0) {
      grid.append(el('p', 'o4a-empty', 'No tools match. Clear the search or pick Any category.'));
      return;
    }
    for (const tool of tools) {
      grid.append(
        renderCard(tool, pins, (id) => {
          if (pins.has(id)) pins.delete(id);
          else pins.add(id);
          savePins(pins);
          paint();
        }),
      );
    }
  };

  search.addEventListener('input', () => {
    state.query = search.value;
    paint();
  });
  cat.addEventListener('change', () => {
    state.category = cat.value as OsintCategory | 'Any';
    paint();
  });
  price.addEventListener('change', () => {
    state.pricing = price.value as OsintPricing | 'Any';
    paint();
  });
  paint();
}

boot();
