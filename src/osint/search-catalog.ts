import type { OsintCatalog, OsintCategory, OsintTool } from './catalog.types';

export interface OsintSearchState {
  query: string;
  categoryId: string | 'all';
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function termOverlaps(left: string, right: string): boolean {
  return left === right || left.includes(right) || right.includes(left);
}

/** Expand a query with catalog synonyms and searchHints. */
export function expandSearchTerms(
  query: string,
  catalog: Pick<OsintCatalog, 'searchHints' | 'synonyms'>,
): string[] {
  const q = normalize(query);
  if (!q) return [];

  const terms = new Set<string>([q]);
  for (const group of catalog.synonyms) {
    const hit = group.some((alias) => termOverlaps(normalize(alias), q));
    if (!hit) continue;
    for (const alias of group) {
      const normalized = normalize(alias);
      if (normalized) terms.add(normalized);
    }
  }
  for (const hint of catalog.searchHints) {
    const normalized = normalize(hint);
    if (normalized && termOverlaps(normalized, q)) terms.add(normalized);
  }
  return [...terms];
}

function toolHaystack(tool: OsintTool, categoryLabelById: Map<string, string>): string {
  return [
    tool.name,
    tool.summary,
    tool.detail,
    tool.hostname,
    tool.proTip ?? '',
    tool.installCommand ?? '',
    ...tool.tags,
    ...tool.howTo,
    ...tool.alternatives,
    ...tool.categoryIds.map((id) => categoryLabelById.get(id) ?? id),
  ]
    .join('\n')
    .toLowerCase();
}

export function toolMatchesQuery(
  tool: OsintTool,
  terms: string[],
  categoryLabelById: Map<string, string>,
): boolean {
  if (terms.length === 0) return true;
  const haystack = toolHaystack(tool, categoryLabelById);
  return terms.some((term) => haystack.includes(term));
}

export function filterOsintCatalog(
  catalog: OsintCatalog,
  state: OsintSearchState,
): OsintTool[] {
  const categoryLabelById = new Map(catalog.categories.map((category) => [category.id, category.label]));
  const terms = expandSearchTerms(state.query, catalog);
  return catalog.tools.filter((tool) => {
    if (state.categoryId !== 'all' && !tool.categoryIds.includes(state.categoryId)) {
      return false;
    }
    return toolMatchesQuery(tool, terms, categoryLabelById);
  });
}

export function categoriesForSelect(catalog: OsintCatalog): OsintCategory[] {
  return catalog.categories.slice();
}

export function toolById(catalog: OsintCatalog, id: string): OsintTool | undefined {
  return catalog.tools.find((tool) => tool.id === id);
}
