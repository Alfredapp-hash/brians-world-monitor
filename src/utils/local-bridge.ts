/**
 * Cross-language local-press bridge.
 *
 * Non-English headlines rarely share enough tokens with English ones to
 * cluster together, so "what does the local press say" breaks exactly when
 * it matters. This module bridges the gap deterministically: it extracts
 * entity anchors from a cluster's titles (proper nouns + a multilingual
 * alias table for high-salience geopolitical entities) and attaches
 * unclustered non-English items that share enough anchors.
 *
 * Pure functions, no DOM.
 */

/**
 * Multilingual aliases for high-salience entities. Each row is one entity;
 * matching any alias (case-insensitive) maps to the canonical anchor.
 * Deliberately compact — proper-noun latin matching covers most European
 * languages; this table bridges Cyrillic, Arabic, and common exonyms.
 */
const ENTITY_ALIASES: string[][] = [
  ['russia', 'россия', 'россии', 'روسيا', 'rusia', 'russie', 'russland'],
  ['ukraine', 'украина', 'украины', 'أوكرانيا', 'ucrania', 'ukraina'],
  ['putin', 'путин', 'путина', 'بوتين'],
  ['zelensky', 'зеленский', 'зеленского', 'زيلينسكي', 'zelenski', 'selenskyj'],
  ['china', 'китай', 'китая', 'الصين', 'chine', 'čína'],
  ['iran', 'иран', 'ирана', 'إيران', 'irán'],
  ['israel', 'израиль', 'израиля', 'إسرائيل', 'israël'],
  ['gaza', 'газа', 'газы', 'غزة'],
  ['nato', 'нато', 'الناتو', 'otan'],
  ['usa', 'сша', 'الولايات المتحدة', 'eeuu', 'états-unis', 'estados unidos'],
  ['trump', 'трамп', 'трампа', 'ترامب'],
  ['europe', 'европа', 'европы', 'أوروبا', 'europa'],
  ['syria', 'сирия', 'سوريا', 'siria', 'syrie'],
  ['taiwan', 'тайвань', 'تايوان', 'taiwán'],
  ['korea', 'корея', 'كوريا', 'corea', 'corée'],
  ['india', 'индия', 'الهند'],
  ['turkey', 'турция', 'تركيا', 'turquía', 'türkei', 'türkiye'],
  ['un', 'оон', 'الأمم المتحدة', 'onu'],
];

const ALIAS_TO_CANONICAL = new Map<string, string>();
for (const row of ENTITY_ALIASES) {
  const canonical = row[0]!;
  for (const alias of row) ALIAS_TO_CANONICAL.set(alias, canonical);
}

// Words that look like proper nouns but are headline furniture or journalese.
const ANCHOR_STOP = new Set([
  'the', 'a', 'an', 'breaking', 'live', 'update', 'exclusive', 'watch',
  'video', 'opinion', 'analysis', 'new', 'news', 'report', 'world',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'officials', 'experts', 'sources', 'police', 'government', 'president',
  'minister', 'leaders', 'senate', 'court', 'study', 'scientists', 'why',
  'how', 'what', 'when', 'inside', 'after', 'amid', 'here', 'this', 'these',
]);

/**
 * Unicode-aware word split (keeps Cyrillic, Arabic, and other scripts).
 * Splits at apostrophes so Romance elisions ("l'Ukraine", "dell'Iran")
 * expose the proper noun as its own token.
 */
function words(title: string): string[] {
  return title.split(/[^\p{L}\p{N}-]+/u).filter(Boolean);
}

/**
 * Extract entity anchors from a title:
 *  - alias-table matches (any script) → canonical anchor
 *  - capitalized latin words (length >= 3, not sentence-initial furniture) → lowercased anchor
 */
export function extractAnchors(title: string): Set<string> {
  const anchors = new Set<string>();
  const ws = words(title);
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]!;
    const lower = w.toLowerCase();
    const canonical = ALIAS_TO_CANONICAL.get(lower);
    if (canonical) { anchors.add(canonical); continue; }
    // Capitalized latin token. Sentence-initial words are capitalized by
    // convention, so the first word needs a slightly longer minimum and the
    // journalese stoplist to qualify.
    const minLen = i === 0 ? 4 : 3;
    if (new RegExp(`^[A-Z][a-z-]{${minLen - 1},}$`).test(w) && !ANCHOR_STOP.has(lower)) {
      anchors.add(lower);
    }
  }
  return anchors;
}

export interface BridgeCandidate {
  source: string;
  title: string;
  lang?: string;
}

/**
 * Anchors for a cluster: union of anchors across its titles, weighted toward
 * ones appearing in 2+ titles (those define the story).
 */
export function clusterAnchors(titles: string[]): { core: Set<string>; all: Set<string> } {
  const counts = new Map<string, number>();
  for (const t of titles) {
    for (const a of extractAnchors(t)) counts.set(a, (counts.get(a) || 0) + 1);
  }
  const all = new Set(counts.keys());
  const core = new Set([...counts.entries()].filter(([, n]) => n >= 2).map(([a]) => a));
  return { core, all };
}

/**
 * Stable-ish key for a story across analysis runs: its sorted entity anchors
 * (falling back to the longest title tokens when no anchors exist). Cluster
 * ids change as clusters grow; anchors survive.
 */
export function storyKey(primaryTitle: string): string {
  const anchors = [...extractAnchors(primaryTitle)].sort();
  if (anchors.length >= 2) return anchors.slice(0, 4).join('|');
  const tokens = words(primaryTitle).map(w => w.toLowerCase()).filter(w => w.length >= 5).sort();
  return [...new Set([...anchors, ...tokens])].slice(0, 4).join('|') || primaryTitle.toLowerCase().slice(0, 40);
}

/**
 * Decide which non-English candidates belong to the cluster.
 * Rule: >= 2 shared anchors, or 1 shared CORE anchor when the candidate has
 * few latin tokens (non-latin-script headlines can often only ever match via
 * the alias table, so demanding 2 anchors would exclude them entirely).
 */
export function bridgeLocalCoverage(
  clusterTitles: string[],
  candidates: BridgeCandidate[],
): BridgeCandidate[] {
  if (clusterTitles.length === 0 || candidates.length === 0) return [];
  const { core, all } = clusterAnchors(clusterTitles);
  if (all.size === 0) return [];

  const out: BridgeCandidate[] = [];
  for (const cand of candidates) {
    const candAnchors = extractAnchors(cand.title);
    if (candAnchors.size === 0) continue;
    let shared = 0;
    let sharedCore = 0;
    for (const a of candAnchors) {
      if (all.has(a)) shared++;
      if (core.has(a)) sharedCore++;
    }
    const latinTokens = words(cand.title).filter(w => /^[A-Za-z]/.test(w)).length;
    const sparseLatinScript = latinTokens <= 2;
    if (shared >= 2 || (sharedCore >= 1 && sparseLatinScript)) {
      out.push(cand);
    }
  }
  return out;
}
