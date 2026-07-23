/**
 * Coverage Compare Panel
 *
 * Clusters the same story across outlets and compares how different kinds of
 * sources cover it: mainstream wires/broadcasters, independent/investigative
 * outlets, state-affiliated media, and local (non-English / regional) press.
 *
 * Heuristic layer (always on, no AI needed):
 *  - Groups each cluster's headlines by source class.
 *  - Extracts consensus terms (shared across most headlines) and each
 *    outlet's unique-angle terms.
 *  - Flags: divergent framing, state-media-only coverage, no independent
 *    corroboration, and available local coverage.
 *
 * AI layer (on demand, per story): "AI Compare" sends the grouped headlines
 * to the local Ollama endpoint when configured (Settings -> Ollama), falling
 * back to the standard summarization chain otherwise.
 */
import { Panel } from './Panel';
import { h, replaceChildren, setTrustedHtml, trustedHtml } from '@/utils/dom-utils';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { NewsItem } from '@/types';
import { clusterNews } from '@/services/clustering';
import type { ClusteredEvent } from '@/types';
import { getSourceType, getSourcePropagandaRisk } from '@/config/feeds';
import { tokenize } from '@/utils/analysis-constants';
import { getRuntimeConfigSnapshot } from '@/services/runtime-config';
import { generateSummary } from '@/services/summarization';

type SourceClass = 'mainstream' | 'independent' | 'state' | 'gov' | 'local';

interface ComparedItem {
  item: NewsItem;
  cls: SourceClass;
  uniqueTerms: string[];
  divergent: boolean;
}

interface ComparedCluster {
  cluster: ClusteredEvent;
  items: ComparedItem[];
  consensusTerms: string[];
  flags: string[];
  groups: Record<SourceClass, ComparedItem[]>;
}

const CLASS_LABELS: Record<SourceClass, string> = {
  mainstream: 'Mainstream',
  independent: 'Independent',
  state: 'State-affiliated',
  gov: 'Government/official',
  local: 'Local press',
};

const CLASS_ORDER: SourceClass[] = ['mainstream', 'independent', 'local', 'state', 'gov'];

function classifySource(item: NewsItem): SourceClass {
  // Local first: non-English coverage is the "what does the local press say" lens.
  if (item.lang && item.lang !== 'en') return 'local';
  const risk = getSourcePropagandaRisk(item.source);
  if (risk.risk === 'high' || (risk.risk === 'medium' && risk.stateAffiliated)) return 'state';
  const type = getSourceType(item.source);
  if (type === 'gov') return 'gov';
  if (type === 'intel' || type === 'other') return 'independent';
  return 'mainstream'; // wire, mainstream, market, tech
}

function compareCluster(cluster: ClusteredEvent): ComparedCluster {
  const items = cluster.allItems as NewsItem[];
  const tokenSets = items.map(i => tokenize(i.title));

  // Consensus terms: tokens present in >= half the headlines (min 2).
  const df = new Map<string, number>();
  for (const set of tokenSets) for (const tok of set) df.set(tok, (df.get(tok) || 0) + 1);
  const threshold = Math.max(2, Math.ceil(items.length / 2));
  const consensus = new Set([...df.entries()].filter(([, n]) => n >= threshold).map(([t]) => t));

  const compared: ComparedItem[] = items.map((item, idx) => {
    const set = tokenSets[idx]!;
    const uniqueTerms = [...set].filter(t => df.get(t) === 1 && t.length > 3).slice(0, 5);
    let shared = 0;
    for (const t of set) if (consensus.has(t)) shared++;
    const divergent = consensus.size > 0 && shared / consensus.size < 0.25 && items.length >= 3;
    return { item, cls: classifySource(item), uniqueTerms, divergent };
  });

  const groups: Record<SourceClass, ComparedItem[]> = {
    mainstream: [], independent: [], state: [], gov: [], local: [],
  };
  for (const c of compared) groups[c.cls].push(c);

  const flags: string[] = [];
  if (groups.local.length > 0) flags.push(`Local coverage (${groups.local.length})`);
  if (groups.state.length > 0 && groups.mainstream.length > 0) flags.push('State vs mainstream framing');
  if (groups.state.length > 0 && groups.mainstream.length === 0 && groups.independent.length === 0) {
    flags.push('State media only — no independent corroboration');
  }
  if (groups.independent.length === 0 && groups.local.length === 0 && compared.length >= 3) {
    flags.push('No independent outlet yet');
  }
  const divergentCount = compared.filter(c => c.divergent).length;
  if (divergentCount > 0) flags.push(`${divergentCount} divergent framing${divergentCount > 1 ? 's' : ''}`);

  return {
    cluster,
    items: compared,
    consensusTerms: [...consensus].filter(t => t.length > 3).slice(0, 8),
    flags,
    groups,
  };
}

function buildComparePrompt(cc: ComparedCluster): string {
  const lines: string[] = [
    `Story: ${cc.cluster.primaryTitle}`,
    '',
    'Below are headlines about the same story from different types of news sources.',
    'Compare the coverage. Answer concisely in markdown with these sections:',
    '1. **Agreement** — facts all source groups report the same way.',
    '2. **Differences** — where framing, emphasis, or claimed facts differ between groups (mainstream vs independent vs state vs local).',
    '3. **Unique claims** — anything only one outlet reports (flag as unverified).',
    '4. **Bias flags** — likely framing/propaganda signals and whose interest they serve.',
    '',
  ];
  for (const cls of CLASS_ORDER) {
    const group = cc.groups[cls];
    if (!group.length) continue;
    lines.push(`### ${CLASS_LABELS[cls]}`);
    for (const g of group.slice(0, 8)) {
      const langTag = g.item.lang && g.item.lang !== 'en' ? ` [${g.item.lang}]` : '';
      lines.push(`- ${g.item.source}${langTag}: "${g.item.title}"`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function ollamaCompare(prompt: string): Promise<string | null> {
  const secrets = getRuntimeConfigSnapshot().secrets;
  const baseUrl = secrets.OLLAMA_API_URL?.value?.trim();
  const model = secrets.OLLAMA_MODEL?.value?.trim() || 'llama3.1:8b';
  if (!baseUrl) return null;
  try {
    const res = await fetch(new URL('/v1/chat/completions', baseUrl).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a media analysis assistant comparing how different news sources cover the same story. Be neutral, specific, and concise.' },
          { role: 'user', content: prompt },
        ],
        stream: false,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

export class CoverageComparePanel extends Panel {
  private getLatestNews: () => NewsItem[];
  private listEl: HTMLElement;
  private statusEl: HTMLElement;
  private analyzing = false;

  constructor(getLatestNews: () => NewsItem[]) {
    super({
      id: 'coverage-compare',
      title: 'Coverage Compare',
      infoTooltip: 'Compares how mainstream, independent, state, and local sources cover the same story — highlighting agreements, differences, unique claims, and bias flags. AI Compare uses your local Ollama when configured.',
    });
    this.getLatestNews = getLatestNews;

    const refreshBtn = h('button', { className: 'cc-refresh-btn', type: 'button' }, 'Analyze coverage') as HTMLButtonElement;
    refreshBtn.addEventListener('click', () => void this.analyze());

    this.statusEl = h('div', { className: 'cc-status' }, 'Click "Analyze coverage" to cluster current headlines across sources.');
    this.listEl = h('div', { className: 'cc-list' });

    replaceChildren(this.content, h('div', { className: 'cc-content' },
      h('div', { className: 'cc-toolbar' }, refreshBtn),
      this.statusEl,
      this.listEl,
    ));

    // Auto-run once news is likely loaded.
    setTimeout(() => { if (!this.analyzing && this.listEl.childElementCount === 0) void this.analyze(); }, 12_000);
  }

  private async analyze(): Promise<void> {
    if (this.analyzing) return;
    this.analyzing = true;
    this.statusEl.textContent = 'Clustering stories across sources…';
    try {
      const news = this.getLatestNews();
      if (!news || news.length < 10) {
        this.statusEl.textContent = 'Not enough headlines loaded yet — try again in a moment.';
        return;
      }
      const clusters = clusterNews(news)
        .filter(c => new Set((c.allItems as NewsItem[]).map(i => i.source)).size >= 2)
        .sort((a, b) => b.sourceCount - a.sourceCount)
        .slice(0, 12);

      if (clusters.length === 0) {
        this.statusEl.textContent = 'No multi-source stories found in the current window.';
        return;
      }

      const compared = clusters.map(compareCluster);
      this.statusEl.textContent = `${compared.length} multi-source stories · ${news.length} headlines analyzed`;
      replaceChildren(this.listEl, ...compared.map(cc => this.renderCluster(cc)));
    } finally {
      this.analyzing = false;
    }
  }

  private renderCluster(cc: ComparedCluster): HTMLElement {
    const flagEls = cc.flags.map(f => {
      const warn = f.includes('State') || f.includes('No independent') || f.includes('divergent');
      return h('span', { className: `cc-flag${warn ? ' cc-flag-warn' : ''}` }, f);
    });

    const groupEls: HTMLElement[] = [];
    for (const cls of CLASS_ORDER) {
      const group = cc.groups[cls];
      if (!group.length) continue;
      groupEls.push(h('div', { className: 'cc-group' },
        h('div', { className: `cc-group-label cc-group-${cls}` }, `${CLASS_LABELS[cls]} (${group.length})`),
        ...group.slice(0, 8).map(g => {
          const langTag = g.item.lang && g.item.lang !== 'en' ? h('span', { className: 'cc-lang' }, g.item.lang!) : null;
          const unique = g.uniqueTerms.length
            ? h('span', { className: 'cc-unique', title: 'Terms only this outlet uses for this story' }, `unique: ${g.uniqueTerms.join(', ')}`)
            : null;
          const divergent = g.divergent ? h('span', { className: 'cc-flag cc-flag-warn' }, 'divergent framing') : null;
          const link = h('a', { className: 'cc-headline', href: g.item.link, target: '_blank', rel: 'noopener noreferrer' }, g.item.title);
          const parts = [h('span', { className: 'cc-source' }, g.item.source), langTag, link, unique, divergent]
            .filter((x): x is HTMLElement => x !== null);
          return h('div', { className: 'cc-item' }, ...parts);
        }),
      ));
    }

    const aiBtn = h('button', { className: 'cc-ai-btn', type: 'button' }, 'AI Compare') as HTMLButtonElement;
    const aiResult = h('div', { className: 'cc-ai-result' });
    aiBtn.addEventListener('click', async () => {
      aiBtn.disabled = true;
      aiBtn.textContent = 'Comparing…';
      try {
        const prompt = buildComparePrompt(cc);
        let text = await ollamaCompare(prompt);
        let via = 'local AI';
        if (!text) {
          const headlines = cc.items.slice(0, 20).map(c => `${c.item.source}: ${c.item.title}`);
          const result = await generateSummary(headlines, undefined, 'Compare coverage: agreements, differences, unique claims, and bias flags across these sources reporting the same story.');
          text = result?.summary || null;
          via = result ? `${result.provider}` : via;
        }
        if (text) {
          const html = DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
          setTrustedHtml(aiResult, trustedHtml(`<div class="cc-ai-via">via ${via}</div>${html}`, 'AI compare output sanitized with DOMPurify'));
        } else {
          aiResult.textContent = 'AI comparison unavailable — configure Ollama in Settings (Ollama local summarization) or add a Groq/OpenRouter key.';
        }
      } finally {
        aiBtn.disabled = false;
        aiBtn.textContent = 'AI Compare';
      }
    });

    const consensus = cc.consensusTerms.length
      ? h('div', { className: 'cc-consensus' }, `Shared across sources: ${cc.consensusTerms.join(', ')}`)
      : null;

    const details = h('details', { className: 'cc-details' },
      h('summary', { className: 'cc-summary' },
        h('span', { className: 'cc-count' }, `${cc.cluster.sourceCount}×`),
        h('span', { className: 'cc-title' }, cc.cluster.primaryTitle),
        ...flagEls,
      ),
      ...(consensus ? [consensus] : []),
      ...groupEls,
      h('div', { className: 'cc-ai-row' }, aiBtn),
      aiResult,
    );
    return details as HTMLElement;
  }
}
