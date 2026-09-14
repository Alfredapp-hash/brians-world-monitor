import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { sanitizeUrl } from '@/utils/sanitize';
import type { OsintCatalog, OsintTool } from '@/osint/catalog.types';
import { loadOsintCatalog } from '@/osint/load-catalog';
import { categoriesForSelect, filterOsintCatalog, toolById } from '@/osint/search-catalog';

export class OsintCatalogPanel extends Panel {
  private catalog: OsintCatalog | null = null;
  private loading = true;
  private error: string | null = null;
  private query = '';
  private categoryId: string | 'all' = 'all';
  private searchInput: HTMLInputElement | null = null;
  private categorySelect: HTMLSelectElement | null = null;
  private listEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;

  constructor() {
    super({
      id: 'osint-catalog',
      title: 'OSINT Tools',
      showCount: true,
      infoTooltip:
        'Portable OSINT4ALL catalog. Browse public investigation tools by category. External links open in a new tab.',
    });
    this.element.classList.add('panel-tall');
    this.content.addEventListener('input', (event) => {
      const search = this.searchInput;
      const target = event.target as HTMLElement | null;
      if (!search || target !== search) return;
      this.query = search.value;
      this.paintResults();
    });
    this.content.addEventListener('change', (event) => {
      const select = this.categorySelect;
      const target = event.target as HTMLElement | null;
      if (!select || target !== select) return;
      this.categoryId = select.value || 'all';
      this.paintResults();
    });
    void this.load();
  }

  public refresh(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.catalog = null;
    this.resetChrome();
    this.render();
    try {
      const catalog = await loadOsintCatalog();
      if (!this.element?.isConnected) return;
      this.catalog = catalog;
      this.error = null;
    } catch (err) {
      if (this.isAbortError(err)) return;
      if (!this.element?.isConnected) return;
      this.error =
        err instanceof Error
          ? err.message
          : 'WAITING ON catalog shards — could not load catalog.meta.json + tools.a/b.';
    }
    this.loading = false;
    this.render();
  }

  private resetChrome(): void {
    this.searchInput = null;
    this.categorySelect = null;
    this.listEl = null;
    this.statusEl = null;
  }

  protected render(): void {
    if (this.loading) {
      this.resetChrome();
      this.showLoading('Loading OSINT catalog…');
      return;
    }

    if (this.error || !this.catalog) {
      this.resetChrome();
      this.showError(this.error || 'WAITING ON catalog.json commit.', () => this.refresh());
      return;
    }

    this.setErrorState(false);
    this.ensureChrome();
    this.paintResults();
  }

  private ensureChrome(): void {
    if (!this.catalog || this.listEl) return;

    const search = h('input', {
      className: 'osint-catalog-search',
      type: 'search',
      placeholder: 'Search tools, tags, or jobs',
      value: this.query,
      'aria-label': 'Search OSINT tools',
      autocomplete: 'off',
    }) as HTMLInputElement;

    const select = h('select', {
      className: 'osint-catalog-select',
      'aria-label': 'OSINT category',
    }) as HTMLSelectElement;
    select.append(new Option('All categories', 'all'));
    for (const category of categoriesForSelect(this.catalog)) {
      const option = new Option(
        `${category.label} (${category.toolIds.length})`,
        category.id,
      );
      select.append(option);
    }
    select.value = this.categoryId;

    const filters = h('div', { className: 'osint-catalog-filters' },
      h('label', { className: 'osint-catalog-label' },
        h('span', { className: 'osint-catalog-label-text' }, 'Search'),
        search,
      ),
      h('label', { className: 'osint-catalog-label' },
        h('span', { className: 'osint-catalog-label-text' }, 'Category'),
        select,
      ),
    );

    const status = h('div', {
      className: 'osint-catalog-status',
      role: 'status',
      'aria-live': 'polite',
    });
    const list = h('div', { className: 'osint-catalog-list' });

    replaceChildren(this.content,
      h('div', { className: 'osint-catalog-panel' },
        h('p', { className: 'osint-catalog-lede' },
          'Public investigation tools from the OSINT4ALL catalog. Nothing here is ranked because someone paid.',
        ),
        filters,
        status,
        list,
      ),
    );

    this.searchInput = search;
    this.categorySelect = select;
    this.statusEl = status;
    this.listEl = list;
  }

  private paintResults(): void {
    if (!this.catalog || !this.listEl || !this.statusEl) return;
    const tools = filterOsintCatalog(this.catalog, {
      query: this.query,
      categoryId: this.categoryId,
    });
    this.setCount(tools.length);
    this.statusEl.textContent = tools.length === 1
      ? '1 tool'
      : `${tools.length} tools`;
    replaceChildren(this.listEl,
      ...(tools.length > 0
        ? tools.map((tool) => this.buildCard(tool))
        : [h('p', { className: 'osint-catalog-empty' }, 'No tools match. Clear search or pick All categories.')]),
    );
  }

  private buildCard(tool: OsintTool): HTMLElement {
    const href = sanitizeUrl(tool.url);
    const tags = h('ul', { className: 'osint-catalog-tags' },
      ...tool.tags.map((tag) => h('li', { className: 'osint-catalog-tag' }, tag)),
    );

    const actions = h('div', { className: 'osint-catalog-actions' });
    if (href) {
      actions.append(
        h('a', {
          className: 'osint-catalog-visit',
          href,
          target: '_blank',
          rel: 'noopener noreferrer',
        }, `Open ${tool.hostname}`),
      );
    }

    const detail = h('div', { className: 'osint-catalog-detail' },
      h('p', { className: 'osint-catalog-detail-copy' }, tool.detail),
    );
    if (tool.howTo.length > 0) {
      detail.append(
        h('h4', { className: 'osint-catalog-subhead' }, 'How to'),
        h('ol', { className: 'osint-catalog-steps' },
          ...tool.howTo.map((step) => h('li', null, step)),
        ),
      );
    }
    if (tool.proTip) {
      detail.append(
        h('p', { className: 'osint-catalog-protip' },
          h('strong', null, 'Pro tip: '),
          tool.proTip,
        ),
      );
    }
    if (tool.installCommand) {
      detail.append(
        h('h4', { className: 'osint-catalog-subhead' }, 'Install / command'),
        h('pre', { className: 'osint-catalog-command' },
          h('code', null, tool.installCommand),
        ),
      );
    }
    if (tool.alternatives.length > 0) {
      detail.append(
        h('h4', { className: 'osint-catalog-subhead' }, 'Alternatives'),
        h('ul', { className: 'osint-catalog-alts' },
          ...tool.alternatives.map((altId) => {
            const alt = this.catalog ? toolById(this.catalog, altId) : undefined;
            return h('li', null, alt ? alt.name : altId);
          }),
        ),
      );
    }

    return h('article', { className: 'osint-catalog-card' },
      h('header', { className: 'osint-catalog-card-head' },
        h('h3', { className: 'osint-catalog-name' }, tool.name),
        h('div', { className: 'osint-catalog-host' }, tool.hostname),
      ),
      h('p', { className: 'osint-catalog-summary' }, tool.summary),
      tags,
      actions,
      h('details', { className: 'osint-catalog-expand' },
        h('summary', null, 'Details'),
        detail,
      ),
    );
  }
}
