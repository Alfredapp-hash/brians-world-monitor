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
import { analyzeTalkingPoints, type TalkingPointAnalysis, type TitleForAnalysis } from '@/utils/talking-points';
import {
  heuristicNciScore, buildNciPrompt, parseAiNciResponse, mergeNci, finalizeNci,
  applyManualScores, saveManualScore, buildNciReport,
  NCI_INDICATORS, type NciResult, type IndicatorScore,
} from '@/utils/nci-score';
import { rssProxyUrl } from '@/utils';
import { trackNarratives, localStorageNarrativeStore, type NarrativeStatus } from '@/utils/narrative-tracker';

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
  tp: TalkingPointAnalysis;
  nci: NciResult;
  /** Narrative persistence status per coordinated phrase (filled in analyze()). */
  narratives?: Map<string, NarrativeStatus>;
  /** Coverage asymmetry: 'mainstream-silent' | 'no-independent' | null. */
  asymmetry?: string | null;
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

  // Talking-point / synchronized-phrasing analysis.
  const tpTitles: TitleForAnalysis[] = compared.map(c => ({
    source: c.item.source,
    title: c.item.title,
    isWire: getSourceType(c.item.source) === 'wire',
    isState: c.cls === 'state',
  }));
  const tp = analyzeTalkingPoints(tpTitles);

  const flags: string[] = [];
  if (tp.talkingPointAlert) flags.push('⚠ TALKING POINT — synchronized phrasing');
  const coordinated = tp.phrases.filter(p => p.kind === 'coordinated');
  if (!tp.talkingPointAlert && coordinated.length > 0) flags.push('Shared phrasing (non-wire)');
  if (tp.phrases.some(p => p.kind === 'syndication')) flags.push('Wire copy detected');
  if (tp.loadedTerms.length > 0) flags.push(`Loaded language (${tp.loadedTerms.length})`);
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

  // NCI Engineered Reality heuristic scoring, with any saved manual overrides.
  const nci = applyManualScores(
    heuristicNciScore({
      titles: items.map(i => ({ source: i.source, title: i.title, pubDate: i.pubDate })),
      tp,
    }),
    cluster.id,
  );

  return {
    cluster,
    items: compared,
    consensusTerms: [...consensus].filter(t => t.length > 3).slice(0, 8),
    flags,
    groups,
    tp,
    nci,
  };
}

function buildComparePrompt(cc: ComparedCluster): string {
  const lines: string[] = [
    `Story: ${cc.cluster.primaryTitle}`,
    '',
    'Below are headlines about the same story from different types of news sources.',
    'Your job is to filter signal from spin. Answer concisely in markdown with these sections:',
    '1. **Verifiable core** — facts all source groups report the same way (the part most likely true).',
    '2. **Talking points** — repeated phrasing/framing that reads like a distributed message rather than independent reporting. Distinguish wire-service copy (normal) from suspicious synchronization. Say who benefits from each talking point.',
    '3. **Differences** — where framing, emphasis, or claimed facts differ between groups (mainstream vs independent vs state vs local).',
    '4. **Unique claims** — anything only one outlet reports (flag as unverified).',
    '5. **BS meter** — a 1–10 rating of how much of this coverage is spin vs substance, with one sentence of justification.',
    '',
  ];
  if (cc.tp.phrases.length > 0) {
    lines.push('Automated phrase analysis already detected these shared phrases (verify and interpret them):');
    for (const p of cc.tp.phrases.slice(0, 6)) {
      lines.push(`- "${p.phrase}" used by ${p.sources.join(', ')} (${p.kind}${p.loaded ? ', loaded language' : ''})`);
    }
    lines.push('');
  }
  if (cc.tp.loadedTerms.length > 0) {
    lines.push(`Loaded terms detected: ${cc.tp.loadedTerms.slice(0, 8).map(l => `"${l.term}" (${l.sources.join(', ')})`).join('; ')}`);
    lines.push('');
  }
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

const QUERY_STOPWORDS = new Set(['after', 'amid', 'over', 'says', 'said', 'with', 'from', 'that', 'this', 'will', 'have', 'been', 'more', 'than', 'into', 'about', 'their', 'when', 'what', 'were', 'against']);

/**
 * Find local/regional coverage of a story: query Google News with the story's
 * key terms plus its location, and return outlets not already in the cluster.
 */
async function findLocalCoverage(cc: ComparedCluster): Promise<Array<{ source: string; title: string; link: string }>> {
  const words = cc.cluster.primaryTitle
    .toLowerCase().replace(/[^a-z0-9\s-]/g, '').split(/\s+/)
    .filter(w => w.length >= 4 && !QUERY_STOPWORDS.has(w));
  const keywords = [...new Set(words)].slice(0, 4);
  const location = (cc.cluster as { locationName?: string }).locationName
    || cc.items.find(i => i.item.locationName)?.item.locationName || '';
  const q = [...keywords, location].filter(Boolean).join(' ');
  if (!q) return [];
  const url = rssProxyUrl(`https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:3d`)}&hl=en-US&gl=US&ceid=US:en`);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];
    const xml = new DOMParser().parseFromString(await res.text(), 'text/xml');
    const existing = new Set(cc.items.map(i => i.item.source.toLowerCase()));
    const out: Array<{ source: string; title: string; link: string }> = [];
    for (const item of xml.querySelectorAll('item')) {
      const title = item.querySelector('title')?.textContent?.trim() || '';
      const link = item.querySelector('link')?.textContent?.trim() || '';
      const source = item.querySelector('source')?.textContent?.trim() || 'Unknown';
      if (!title || !link) continue;
      if (existing.has(source.toLowerCase())) continue;
      out.push({ source, title: title.replace(new RegExp(`\\s+-\\s+${source}$`), ''), link });
      if (out.length >= 10) break;
    }
    return out;
  } catch {
    return [];
  }
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
  private statsEl: HTMLElement;
  private aiStatusEl: HTMLElement;
  private analyzing = false;
  private static readonly AUTO_REFRESH_MS = 10 * 60 * 1000;

  constructor(getLatestNews: () => NewsItem[]) {
    super({
      id: 'coverage-compare',
      title: 'Coverage Compare',
      infoTooltip: 'Filters spin from signal: clusters the same story across mainstream, independent, state, and local sources; detects synchronized talking points (identical phrasing across outlets), separates normal wire-copy from coordinated messaging, flags loaded language, and scores narrative sync. AI Compare uses your local Ollama when configured.',
    });
    this.getLatestNews = getLatestNews;

    const refreshBtn = h('button', { className: 'cc-refresh-btn', type: 'button' }, 'Analyze coverage') as HTMLButtonElement;
    refreshBtn.addEventListener('click', () => void this.analyze());

    this.statusEl = h('div', { className: 'cc-status' }, 'Click "Analyze coverage" to cluster current headlines across sources.');
    this.statsEl = h('div', { className: 'cc-stats' });
    this.listEl = h('div', { className: 'cc-list' });

    this.aiStatusEl = h('span', { className: 'cc-ai-status cc-ai-status-none' }, '● Local AI: checking…');

    replaceChildren(this.content, h('div', { className: 'cc-content' },
      h('div', { className: 'cc-toolbar' }, refreshBtn, this.aiStatusEl),
      this.statsEl,
      this.statusEl,
      this.listEl,
    ));
    void this.updateAiStatus();

    // Auto-run once news is likely loaded, then keep fresh in the background.
    setTimeout(() => { if (!this.analyzing && this.listEl.childElementCount === 0) void this.analyze(); }, 12_000);
    setInterval(() => {
      if (!document.hidden && !this.analyzing && this.element.isConnected) void this.analyze();
    }, CoverageComparePanel.AUTO_REFRESH_MS);
  }

  private renderStats(stories: number, alerts: number, avgNci: number, maxNci: number, asymmetries = 0, recurring = 0): void {
    const stat = (label: string, value: string, cls = '') =>
      h('div', { className: `cc-stat ${cls}` },
        h('div', { className: 'cc-stat-value' }, value),
        h('div', { className: 'cc-stat-label' }, label));
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    replaceChildren(this.statsEl,
      stat('Stories', String(stories)),
      stat('TP alerts', String(alerts), alerts > 0 ? 'cc-stat-alert' : ''),
      stat('Recurring', String(recurring), recurring > 0 ? 'cc-stat-alert' : ''),
      stat('Asymmetry', String(asymmetries), asymmetries > 0 ? 'cc-stat-warn' : ''),
      stat('Avg NCI', String(avgNci), avgNci >= 41 ? 'cc-stat-warn' : ''),
      stat('Peak NCI', String(maxNci), maxNci >= 41 ? 'cc-stat-warn' : ''),
      stat('Updated', time),
    );
  }

  /** Ping the configured Ollama endpoint and reflect reachability in the toolbar. */
  private async updateAiStatus(): Promise<void> {
    const el = this.aiStatusEl;
    const baseUrl = getRuntimeConfigSnapshot().secrets.OLLAMA_API_URL?.value?.trim();
    if (!baseUrl) {
      el.className = 'cc-ai-status cc-ai-status-none';
      el.textContent = '● Local AI: not configured';
      el.title = 'Set OLLAMA_API_URL in Settings → Ollama local summarization to enable AI Compare and Full NCI scoring.';
      return;
    }
    try {
      const res = await fetch(new URL('/api/tags', baseUrl).toString(), { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        el.className = 'cc-ai-status cc-ai-status-ok';
        el.textContent = '● Local AI: ready';
        el.title = `Ollama reachable at ${baseUrl}`;
        return;
      }
      throw new Error(String(res.status));
    } catch {
      el.className = 'cc-ai-status cc-ai-status-down';
      el.textContent = '● Local AI: offline';
      el.title = `Ollama not reachable at ${baseUrl}. Is it running? Is OLLAMA_ORIGINS set to allow this site?`;
    }
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

      // Narrative persistence: track coordinated phrases across analysis runs.
      const narrativeStore = localStorageNarrativeStore();

      const compared = clusters.map(compareCluster)
        // Talking-point alerts first, then by NCI score, then sync, then spread.
        .sort((a, b) =>
          Number(b.tp.talkingPointAlert) - Number(a.tp.talkingPointAlert)
          || b.nci.normalized - a.nci.normalized
          || b.tp.syncScore - a.tp.syncScore
          || b.cluster.sourceCount - a.cluster.sourceCount);
      // Coverage asymmetry + narrative tracking per cluster.
      let asymmetries = 0;
      let recurringCount = 0;
      for (const cc of compared) {
        const { mainstream, independent, local, state } = cc.groups;
        if (mainstream.length === 0 && independent.length >= 2) {
          cc.asymmetry = 'mainstream-silent';
          asymmetries++;
        } else if (independent.length === 0 && local.length === 0 && mainstream.length + state.length >= 4) {
          cc.asymmetry = 'no-independent';
          asymmetries++;
        } else {
          cc.asymmetry = null;
        }
        const coordinated = cc.tp.phrases
          .filter(p => p.kind === 'coordinated')
          .map(p => ({ phrase: p.phrase, sources: p.sources }));
        if (coordinated.length > 0) {
          cc.narratives = trackNarratives(coordinated, narrativeStore);
          if ([...cc.narratives.values()].some(n => n.recurring)) recurringCount++;
        }
      }

      const alerts = compared.filter(c => c.tp.talkingPointAlert).length;
      const maxNci = compared.reduce((m, c) => Math.max(m, c.nci.normalized), 0);
      const avgNci = Math.round(compared.reduce((s, c) => s + c.nci.normalized, 0) / compared.length);
      this.renderStats(compared.length, alerts, avgNci, maxNci, asymmetries, recurringCount);
      void this.updateAiStatus();
      this.statusEl.textContent =
        `${news.length} headlines analyzed`
        + (alerts ? ` · ⚠ ${alerts} talking-point alert${alerts > 1 ? 's' : ''}` : ' · no synchronized talking points detected');
      replaceChildren(this.listEl, ...compared.map(cc => this.renderCluster(cc)));
    } finally {
      this.analyzing = false;
    }
  }

  private renderCluster(cc: ComparedCluster): HTMLElement {
    const flagEls = cc.flags.map(f => {
      const alert = f.includes('TALKING POINT');
      const warn = !alert && (f.includes('State') || f.includes('No independent') || f.includes('divergent') || f.includes('Loaded'));
      return h('span', { className: `cc-flag${alert ? ' cc-flag-alert' : warn ? ' cc-flag-warn' : ''}` }, f);
    });

    // Coverage asymmetry flags (blackout detection).
    if (cc.asymmetry === 'mainstream-silent') {
      flagEls.push(h('span', {
        className: 'cc-flag cc-flag-warn',
        title: 'Independent outlets are covering this story but no mainstream outlet in the pool is — possible under-reporting or an unverified story gaining traction.',
      }, 'Mainstream silent'));
    } else if (cc.asymmetry === 'no-independent') {
      flagEls.push(h('span', {
        className: 'cc-flag cc-flag-warn',
        title: 'Broad mainstream/state coverage with zero independent or local corroboration in the pool.',
      }, 'No independent corroboration'));
    }

    // Recurring narrative flags (phrases pushed across hours/days).
    const recurring = cc.narratives ? [...cc.narratives.values()].filter(n => n.recurring) : [];
    for (const n of recurring.slice(0, 2)) {
      flagEls.push(h('span', {
        className: 'cc-flag cc-flag-alert',
        title: `"${n.phrase}" observed in ${n.record.runs} analysis runs over ${n.age} by: ${n.record.sources.join(', ')}. Persistent synchronized phrasing is the signature of a pushed narrative.`,
      }, `↻ RECURRING ${n.age}`));
    }

    // Narrative sync meter.
    const sync = cc.tp.syncScore;
    const syncClass = sync >= 60 ? 'cc-sync-high' : sync >= 30 ? 'cc-sync-mid' : 'cc-sync-low';
    const syncMeter = h('span', {
      className: `cc-sync ${syncClass}`,
      title: 'Narrative sync: how much of this coverage shares identical phrasing across distinct outlets. High + non-wire = likely talking point.',
    }, `sync ${sync}%`);
    flagEls.unshift(syncMeter);

    // Shared-phrase evidence chips.
    const phraseEls = cc.tp.phrases.slice(0, 4).map(p =>
      h('div', { className: `cc-phrase${p.kind === 'coordinated' ? ' cc-phrase-coord' : ''}` },
        h('span', { className: 'cc-phrase-kind' }, p.kind === 'coordinated' ? '⚠ coordinated' : 'wire copy'),
        h('span', { className: 'cc-phrase-text' }, `“${p.phrase}”`),
        h('span', { className: 'cc-phrase-sources' }, p.sources.join(' · ')),
        ...(p.loaded ? [h('span', { className: 'cc-flag cc-flag-warn' }, 'loaded')] : []),
      ));

    const loadedEl = cc.tp.loadedTerms.length
      ? h('div', { className: 'cc-loaded' },
          'Loaded language: ',
          ...cc.tp.loadedTerms.slice(0, 6).map(l =>
            h('span', { className: 'cc-loaded-term', title: `Used by: ${l.sources.join(', ')}` }, `${l.term} (${l.sources.length})`)),
        )
      : null;

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

    // ── NCI Engineered Reality Score ──
    const nciBadge = h('span', {
      className: `cc-nci-badge cc-nci-l${cc.nci.tier.level}`,
      title: `NCI Engineered Reality Score: ${cc.nci.normalized}/100 — ${cc.nci.tier.label}. Measures manipulation indicators, not proof of a psyop.`,
    }, `NCI ${cc.nci.normalized}`);
    flagEls.splice(1, 0, nciBadge);

    const nciBody = h('div', { className: 'cc-nci-body' });
    let lastAiSummary: string | undefined;
    const renderNciBreakdown = (result: NciResult, aiSummary?: string) => {
      if (aiSummary !== undefined) lastAiSummary = aiSummary;
      const rows = NCI_INDICATORS.map(ind => {
        const s = result.scores.get(ind.id)!;
        const scoreBtn = h('button', {
          className: `cc-nci-score cc-nci-s${s.score}`,
          type: 'button',
          title: 'Click to score this indicator yourself (cycles 1→5)',
        }, String(s.score)) as HTMLButtonElement;
        scoreBtn.addEventListener('click', () => {
          const next = (s.score % 5) + 1 as 1 | 2 | 3 | 4 | 5;
          const merged = new Map<number, IndicatorScore>(cc.nci.scores);
          merged.set(ind.id, { score: next, evidence: 'Manually scored', source: 'manual' });
          cc.nci = finalizeNci(merged);
          saveManualScore(cc.cluster.id, ind.id, next);
          renderNciBreakdown(cc.nci);
          nciBadge.textContent = `NCI ${cc.nci.normalized}`;
          nciBadge.className = `cc-nci-badge cc-nci-l${cc.nci.tier.level}`;
        });
        return h('div', { className: 'cc-nci-row' },
          h('span', { className: 'cc-nci-num' }, String(ind.id)),
          h('span', { className: 'cc-nci-label', title: ind.hint }, ind.label),
          scoreBtn,
          h('span', { className: `cc-nci-src cc-nci-src-${s.source}` },
            s.source === 'ai' ? 'AI' : s.source === 'auto' ? 'auto' : s.source === 'manual' ? 'you' : '—'),
          h('span', { className: 'cc-nci-evidence' }, s.evidence),
        );
      });
      const copyBtn = h('button', { className: 'cc-copy-btn', type: 'button' }, 'Copy report') as HTMLButtonElement;
      copyBtn.addEventListener('click', () => {
        const report = buildNciReport(cc.cluster.primaryTitle, result, {
          sources: [...new Set(cc.items.map(i => i.item.source))],
          phrases: cc.tp.phrases.map(p => ({ phrase: p.phrase, kind: p.kind, sources: p.sources })),
          aiSummary: lastAiSummary,
        });
        void navigator.clipboard?.writeText(report).then(() => {
          copyBtn.textContent = 'Copied ✓';
          setTimeout(() => { copyBtn.textContent = 'Copy report'; }, 2000);
        });
      });
      replaceChildren(nciBody,
        h('div', { className: 'cc-nci-verdict' },
          h('span', { className: `cc-nci-badge cc-nci-l${result.tier.level}` }, `${result.normalized}/100`),
          h('span', { className: 'cc-nci-tier' }, result.tier.label),
          copyBtn,
        ),
        ...(lastAiSummary ? [h('div', { className: 'cc-nci-summary' }, lastAiSummary)] : []),
        h('div', { className: 'cc-nci-table' }, ...rows),
        h('div', { className: 'cc-nci-disclaimer' },
          'The NCI scale measures indicators of coordinated manipulation — it does not by itself prove an influence campaign exists. Click any score to override it with your own judgment (saved locally).'),
      );
    };

    const nciAiBtn = h('button', { className: 'cc-ai-btn cc-nci-ai-btn', type: 'button' }, 'Full NCI Score (AI)') as HTMLButtonElement;
    nciAiBtn.addEventListener('click', async () => {
      nciAiBtn.disabled = true;
      nciAiBtn.textContent = 'Scoring…';
      try {
        const headlineLines = cc.items.slice(0, 20).map(c => {
          const langTag = c.item.lang && c.item.lang !== 'en' ? ` [${c.item.lang}]` : '';
          return `- ${c.item.source}${langTag} (${CLASS_LABELS[c.cls]}): "${c.item.title}"`;
        });
        const prompt = buildNciPrompt(cc.cluster.primaryTitle, headlineLines, cc.nci);
        const text = await ollamaCompare(prompt);
        const parsed = text ? parseAiNciResponse(text) : null;
        if (parsed) {
          const merged = mergeNci(cc.nci, parsed);
          cc.nci = merged;
          renderNciBreakdown(merged, parsed.summary || undefined);
          nciBadge.textContent = `NCI ${merged.normalized}`;
          nciBadge.className = `cc-nci-badge cc-nci-l${merged.tier.level}`;
        } else {
          renderNciBreakdown(cc.nci);
          nciBody.append(h('div', { className: 'cc-nci-error' },
            text
              ? 'AI response could not be parsed as rubric JSON — showing heuristic scores.'
              : 'Local AI unavailable — configure Ollama in Settings (Ollama local summarization) to run the full 20-indicator assessment.'));
        }
      } finally {
        nciAiBtn.disabled = false;
        nciAiBtn.textContent = 'Full NCI Score (AI)';
      }
    });

    const nciDetails = h('details', { className: 'cc-nci' },
      h('summary', { className: 'cc-nci-toggle' },
        `NCI Engineered Reality breakdown — ${cc.nci.normalized}/100 (${cc.nci.tier.label})`),
      nciBody,
      h('div', { className: 'cc-ai-row' }, nciAiBtn),
    );
    (nciDetails as HTMLDetailsElement).addEventListener('toggle', () => {
      if ((nciDetails as HTMLDetailsElement).open && nciBody.childElementCount === 0) renderNciBreakdown(cc.nci);
    });

    // ── Local coverage finder ──
    const localBtn = h('button', { className: 'cc-local-btn', type: 'button' }, 'Find local coverage') as HTMLButtonElement;
    const localResult = h('div', { className: 'cc-local-result' });
    localBtn.addEventListener('click', async () => {
      localBtn.disabled = true;
      localBtn.textContent = 'Searching…';
      try {
        const finds = await findLocalCoverage(cc);
        if (finds.length === 0) {
          replaceChildren(localResult, h('div', { className: 'cc-status' }, 'No additional regional coverage found for this story.'));
        } else {
          replaceChildren(localResult,
            h('div', { className: 'cc-group' },
              h('div', { className: 'cc-group-label cc-group-local' }, `Additional local & regional coverage (${finds.length})`),
              ...finds.map(f => h('div', { className: 'cc-item' },
                h('span', { className: 'cc-source' }, f.source),
                h('a', { className: 'cc-headline', href: f.link, target: '_blank', rel: 'noopener noreferrer' }, f.title),
              )),
            ));
        }
      } finally {
        localBtn.disabled = false;
        localBtn.textContent = 'Find local coverage';
      }
    });

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

    const details = h('details', { className: `cc-details${cc.tp.talkingPointAlert ? ' cc-details-alert' : ''}` },
      h('summary', { className: 'cc-summary' },
        h('span', { className: 'cc-count' }, `${cc.cluster.sourceCount}×`),
        h('span', { className: 'cc-title' }, cc.cluster.primaryTitle),
        ...flagEls,
      ),
      ...phraseEls,
      ...(loadedEl ? [loadedEl] : []),
      ...(consensus ? [consensus] : []),
      nciDetails,
      ...groupEls,
      localResult,
      h('div', { className: 'cc-ai-row' }, aiBtn, localBtn),
      aiResult,
    );
    if (cc.tp.talkingPointAlert) (details as HTMLDetailsElement).open = true;
    return details as HTMLElement;
  }
}
