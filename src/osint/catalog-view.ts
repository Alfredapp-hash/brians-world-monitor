import { h, replaceChildren } from '@/utils/dom-utils';
import { sanitizeUrl } from '@/utils/sanitize';
import type { OsintCatalog, OsintTool, OsintToolDetails } from './catalog.types';
import { OSINT_DISPATCH_NAME } from './dispatch';
import { applyToolDetails, loadOsintCatalog, loadOsintCatalogDetails } from './load-catalog';
import { categoriesForSelect, filterOsintCatalog, toolById } from './search-catalog';

export const OSINT_DISPATCH_LEDE =
  'Public investigation tools in OSINTDispatch. Nothing here is ranked because someone paid.';

function toolNeedsLazyDetails(tool: OsintTool): boolean {
  return !tool.detail.trim() || tool.howTo.length === 0;
}

export interface OsintCatalogViewHooks {
  setCount?: (count: number) => void;
  showLoading?: (message: string) => void;
  showError?: (message: string, retry: () => void) => void;
  clearError?: () => void;
}

export class OsintCatalogView {
  private catalog: OsintCatalog | null = null;
  private loading = true;
  private error: string | null = null;
  private query = '';
  private categoryId: string | 'all' = 'all';
  private searchInput: HTMLInputElement | null = null;
  private categorySelect: HTMLSelectElement | null = null;
  private listEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private detailsById: Map<string, OsintToolDetails> | null = null;
  private detailsPromise: Promise<Map<string, OsintToolDetails>> | null = null;
  private expandedIds = new Set<string>();
  private detailsLoadingIds = new Set<string>();

  constructor(
    private readonly host: HTMLElement,
    private readonly hooks: OsintCatalogViewHooks = {},
  ) {
    this.host.addEventListener('input', (event) => {
      const search = this.searchInput;
      const target = event.target as HTMLElement | null;
      if (!search || target !== search) return;
      this.query = search.value;
      this.paintResults();
    });
    this.host.addEventListener('change', (event) => {
      const select = this.categorySelect;
      const target = event.target as HTMLElement | null;
      if (!select || target !== select) return;
      this.categoryId = select.value || 'all';
      this.paintResults();
    });
    this.host.addEventListener(
      'toggle',
      (event) => {
        const details = event.target;
        if (!(details instanceof HTMLDetailsElement)) return;
        const card = details.closest<HTMLElement>('[data-tool-id]');
        const toolId = card?.dataset.toolId;
        if (!toolId) return;
        if (!details.open) {
          this.expandedIds.delete(toolId);
          return;
        }
        this.expandedIds.add(toolId);
        void this.mergeDetailsOnExpand(toolId);
      },
      true,
    );
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
      if (!this.host.isConnected) return;
      this.catalog = catalog;
      this.error = null;
    } catch (err) {
      if (this.isAbortError(err)) return;
      if (!this.host.isConnected) return;
      this.error =
        err instanceof Error
          ? err.message
          : 'WAITING ON catalog shards — could not load catalog.meta.json + toolShardFiles.';
    }
    this.loading = false;
    this.render();
  }

  private isAbortError(err: unknown): boolean {
    return err instanceof DOMException && err.name === 'AbortError';
  }

  private resetChrome(): void {
    this.searchInput = null;
    this.categorySelect = null;
    this.listEl = null;
    this.statusEl = null;
  }

  public render(): void {
    if (this.loading) {
      this.resetChrome();
      if (this.hooks.showLoading) {
        this.hooks.showLoading(`Loading ${OSINT_DISPATCH_NAME}…`);
        return;
      }
      replaceChildren(this.host,
        h('p', { className: 'osint-dispatch-status-banner' }, `Loading ${OSINT_DISPATCH_NAME}…`),
      );
      return;
    }

    if (this.error || !this.catalog) {
      this.resetChrome();
      const message = this.error
        || 'WAITING ON catalog shards — catalog.meta.json or a tool shard is not available yet.';
      if (this.hooks.showError) {
        this.hooks.showError(message, () => this.refresh());
        return;
      }
      const retry = h('button', { className: 'osint-dispatch-retry', type: 'button' }, 'Retry');
      retry.addEventListener('click', () => this.refresh());
      replaceChildren(this.host,
        h('div', { className: 'osint-dispatch-error' },
          h('p', null, message),
          retry,
        ),
      );
      return;
    }

    this.hooks.clearError?.();
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
      'aria-label': `Search ${OSINT_DISPATCH_NAME}`,
      autocomplete: 'off',
    }) as HTMLInputElement;

    const select = h('select', {
      className: 'osint-catalog-select',
      'aria-label': `${OSINT_DISPATCH_NAME} category`,
    }) as HTMLSelectElement;
    select.append(new Option('All categories', 'all'));
    for (const category of categoriesForSelect(this.catalog)) {
      select.append(new Option(`${category.label} (${category.toolIds.length})`, category.id));
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

    replaceChildren(this.host,
      h('div', { className: 'osint-catalog-panel' },
        h('p', { className: 'osint-catalog-lede' }, OSINT_DISPATCH_LEDE),
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

  private async mergeDetailsOnExpand(toolId: string): Promise<void> {
    if (!this.catalog) return;
    const index = this.catalog.tools.findIndex((tool) => tool.id === toolId);
    if (index < 0) return;
    const tool = this.catalog.tools[index];
    if (!tool || !toolNeedsLazyDetails(tool)) return;

    this.detailsLoadingIds.add(toolId);
    this.paintResults();
    try {
      this.detailsPromise ??= loadOsintCatalogDetails();
      this.detailsById ??= await this.detailsPromise;
      if (!this.host.isConnected || !this.catalog) return;
      this.catalog.tools[index] = applyToolDetails(tool, this.detailsById.get(toolId));
    } finally {
      this.detailsLoadingIds.delete(toolId);
      if (this.host.isConnected) this.paintResults();
    }
  }

  private paintResults(): void {
    if (!this.catalog || !this.listEl || !this.statusEl) return;
    const tools = filterOsintCatalog(this.catalog, {
      query: this.query,
      categoryId: this.categoryId,
    });
    this.hooks.setCount?.(tools.length);
    this.statusEl.textContent = tools.length === 1 ? '1 tool' : `${tools.length} tools`;
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

    const expand = h('details', { className: 'osint-catalog-expand' },
      h('summary', null, 'Details'),
      detail,
    ) as HTMLDetailsElement;
    if (this.expandedIds.has(tool.id)) expand.open = true;
    if (this.detailsLoadingIds.has(tool.id)) {
      detail.append(h('p', { className: 'osint-catalog-detail-copy' }, 'Loading details…'));
    }

    return h('article', {
      className: 'osint-catalog-card',
      dataset: { toolId: tool.id },
    },
      h('header', { className: 'osint-catalog-card-head' },
        h('h3', { className: 'osint-catalog-name' }, tool.name),
        h('div', { className: 'osint-catalog-host' }, tool.hostname),
      ),
      h('p', { className: 'osint-catalog-summary' }, tool.summary),
      tags,
      actions,
      expand,
    );
  }
}
