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
  NCI_INDICATORS, type NciResult, type IndicatorScore, type AiNciParse,
} from '@/utils/nci-score';
import { rssProxyUrl } from '@/utils';
import { trackNarratives, localStorageNarrativeStore, type NarrativeStatus } from '@/utils/narrative-tracker';
import { bridgeLocalCoverage, storyKey } from '@/utils/local-bridge';
import { recordNciObservation, type NciTrend } from '@/utils/nci-score';
import { shareStoryToX, type ShareStory } from '@/services/share-card';
import {
  dispatchDiscordAlerts, getDiscordWebhook, setDiscordWebhook,
  getAlertsEnabled, setAlertsEnabled, isValidWebhookUrl, sendTestAlert,
  maybeSendDailyDigest,
  type AlertStory,
} from '@/services/discord-alerts';
import { isEverydayReaderMode, summarizeCivilianCoverage } from '@/services/reader-mode';

type SourceClass = 'mainstream' | 'independent' | 'state' | 'gov' | 'local';

const CLASS_ORDER: SourceClass[] = ['mainstream', 'independent', 'local', 'state', 'gov'];

const CLASS_LABELS: Record<SourceClass, string> = {
  mainstream: 'Mainstream',
  independent: 'Independent',
  state: 'State-affiliated',
  gov: 'Government/official',
  local: 'Local press',
};

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
  /** Stable story key for trend/AI caches. */
  key: string;
  /** NCI score trend vs prior observations. */
  trend?: NciTrend;
}

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

function compareCluster(cluster: ClusteredEvent, allNews?: NewsItem[]): ComparedCluster {
  let items = cluster.allItems as NewsItem[];

  // Cross-language bridge: pull in non-English coverage of the same story
  // that token-based clustering missed (shared entity anchors, alias table
  // for Cyrillic/Arabic scripts). This is what makes "what does the local
  // press say" work for stories the local press writes in its own language.
  if (allNews?.length) {
    const inCluster = new Set(items.map(i => `${i.source}\u0000${i.title}`));
    const candidates = allNews.filter(n =>
      n.lang && n.lang !== 'en' && !inCluster.has(`${n.source}\u0000${n.title}`));
    if (candidates.length > 0) {
      const bridged = bridgeLocalCoverage(
        items.map(i => i.title),
        candidates.map(c => ({ source: c.source, title: c.title, lang: c.lang })),
      );
      if (bridged.length > 0) {
        const bridgedKeys = new Set(bridged.map(b => `${b.source}\u0000${b.title}`));
        const extra = candidates.filter(c => bridgedKeys.has(`${c.source}\u0000${c.title}`)).slice(0, 8);
        items = [...items, ...extra];
      }
    }
  }

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

  // Stable story key (survives cluster.id churn as the primary headline
  // changes) — used for manual overrides, trend history, and AI caching alike.
  const key = storyKey(cluster.primaryTitle);

  // NCI Engineered Reality heuristic scoring, with any saved manual overrides.
  const nci = applyManualScores(
    heuristicNciScore({
      titles: items.map(i => ({ source: i.source, title: i.title, pubDate: i.pubDate })),
      tp,
    }),
    key,
  );

  // Trend: record this observation and compare vs history.
  let trend: NciTrend | undefined;
  try {
    trend = recordNciObservation(key, nci.normalized);
  } catch { /* storage unavailable */ }

  return {
    cluster,
    items: compared,
    consensusTerms: [...consensus].filter(t => t.length > 3).slice(0, 8),
    flags,
    groups,
    tp,
    nci,
    key,
    trend,
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

/** Tiny stable string hash for generating unique element ids. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

/** Only http(s) links are safe to render as anchors (blocks javascript:/data:). */
function isSafeHttpUrl(url: string): boolean {
  try {
    const p = new URL(url, location.href);
    return p.protocol === 'http:' || p.protocol === 'https:';
  } catch {
    return false;
  }
}

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
      if (!title || !link || !isSafeHttpUrl(link)) continue;
      if (existing.has(source.toLowerCase())) continue;
      // Strip a trailing " - <Source>" suffix. Source text is untrusted RSS
      // content, so escape it before building the regex (a metachar-bearing
      // source name like "A.P." or "News (Reuters" would otherwise mis-strip
      // or throw and kill the whole result set).
      const suffix = new RegExp(`\\s+-\\s+${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
      out.push({ source, title: title.replace(suffix, ''), link });
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
  private live = false;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  /** Story keys currently being AI-scored, to prevent overlapping requests. */
  private aiInFlight = new Set<string>();
  /** Session cache of AI rubric scores by story key (60-min TTL). */
  private aiCache = new Map<string, { t: number; parse: AiNciParse; summary: string }>();
  /** Per-story UI updaters so async AI results can refresh badges in place. */
  private nciUpdaters = new Map<string, (result: NciResult, aiSummary?: string) => void>();
  private static readonly AI_CACHE_TTL_MS = 60 * 60 * 1000;
  private static readonly AUTO_AI_MAX = 3;
  private static readonly AUTO_REFRESH_MS = 10 * 60 * 1000;

  constructor(getLatestNews: () => NewsItem[]) {
    const everyday = isEverydayReaderMode();
    super({
      id: 'coverage-compare',
      title: everyday ? 'How outlets frame this' : 'Coverage Compare',
      infoTooltip: everyday
        ? 'See which outlet types covered a story, which stayed quiet, and how framing differs — plain language first. Deeper scoring stays optional.'
        : 'Filters spin from signal: clusters the same story across mainstream, independent, state, and local sources; detects synchronized talking points (identical phrasing across outlets), separates normal wire-copy from coordinated messaging, flags loaded language, and scores narrative sync. AI Compare uses your local Ollama when configured.',
    });
    this.getLatestNews = getLatestNews;

    const refreshBtn = h('button', { className: 'btn btn-primary cc-refresh-btn', type: 'button' }, everyday ? 'Refresh framing' : 'Analyze coverage') as HTMLButtonElement;
    refreshBtn.addEventListener('click', () => void this.analyze());

    this.statusEl = h('div', { className: 'cc-status' }, everyday
      ? 'Comparing who covered each story, who stayed quiet, and how the framing differs…'
      : 'Click "Analyze coverage" to cluster current headlines across sources.');
    this.statsEl = h('div', { className: 'cc-stats' });
    this.listEl = h('div', { className: 'cc-list' });

    this.aiStatusEl = h('span', { className: 'cc-ai-status cc-ai-status-none' }, '● Local AI: checking…');

    // Discord alerts config (collapsible).
    const alertsBtn = h('button', { className: 'cc-alerts-btn', type: 'button', title: 'Discord alert settings', 'aria-label': 'Discord alert settings', 'aria-expanded': 'false' }) as HTMLButtonElement;
    setTrustedHtml(alertsBtn, trustedHtml(
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
      'Static line-icon bell for Discord alert settings',
    ));
    const alertsPanel = this.buildAlertsConfig();
    alertsBtn.addEventListener('click', () => {
      const open = alertsPanel.style.display === 'none';
      alertsPanel.style.display = open ? '' : 'none';
      alertsBtn.setAttribute('aria-expanded', String(open));
    });

    // Everyday: NCI / local AI / Discord behind a secondary expand — first paint is covered/ignored.
    const methodNote = everyday
      ? h('details', { className: 'cc-method-details' },
          h('summary', { className: 'cc-method-summary' }, 'Scoring, AI & alerts (optional)'),
          h('div', { className: 'cc-persistent-note' },
            'Advanced scores measure coordination indicators (0–100) — not proof of manipulation. ',
            h('a', { className: 'cc-method-link', href: '/methodology.html', target: '_blank', rel: 'noopener noreferrer' }, 'How scoring works →')),
          h('div', { className: 'cc-everyday-advanced-tools' }, this.aiStatusEl, alertsBtn),
          alertsPanel,
        )
      : h('div', { className: 'cc-persistent-note' },
          'NCI = manipulation-indicator score (0–100). It measures signals of coordination, not proof of it. ',
          h('a', { className: 'cc-method-link', href: '/methodology.html', target: '_blank', rel: 'noopener noreferrer' }, 'How it works →'));

    replaceChildren(this.content, h('div', { className: `cc-content${everyday ? ' cc-content--everyday' : ''}` },
      everyday
        ? h('div', { className: 'cc-toolbar' }, refreshBtn)
        : h('div', { className: 'cc-toolbar' }, refreshBtn, h('div', { className: 'cc-toolbar-right' }, this.aiStatusEl, alertsBtn)),
      ...(everyday ? [] : [alertsPanel]),
      this.statsEl,
      this.statusEl,
      methodNote,
      this.listEl,
    ));
    void this.updateAiStatus();

    // Auto-run once news is likely loaded, then keep fresh in the background.
    // Everyday opens via "How outlets frame this" — analyze sooner so first paint isn't empty.
    setTimeout(() => { if (!this.analyzing && this.listEl.childElementCount === 0) void this.analyze(); }, everyday ? 1_500 : 12_000);
    this.refreshTimer = setInterval(() => {
      if (!document.hidden && !this.analyzing && this.element.isConnected) void this.analyze();
    }, CoverageComparePanel.AUTO_REFRESH_MS);
  }

  override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private renderStats(stories: number, alerts: number, avgNci: number, maxNci: number, asymmetries = 0, recurring = 0): void {
    const stat = (label: string, value: string, cls = '') =>
      h('div', { className: `cc-stat ${cls}` },
        h('div', { className: 'cc-stat-value' }, value),
        h('div', { className: 'cc-stat-label' }, label));
    if (isEverydayReaderMode()) {
      // Civilian first paint — no NCI acronyms in the strip.
      replaceChildren(this.statsEl,
        stat('Stories', String(stories)),
        stat('Shared phrasing', String(alerts), alerts > 0 ? 'cc-stat-alert' : ''),
        stat('Coverage gaps', String(asymmetries), asymmetries > 0 ? 'cc-stat-warn' : ''),
        stat('Recurring lines', String(recurring), recurring > 0 ? 'cc-stat-alert' : ''),
      );
      return;
    }
    // Spelled-out labels (design review P3 — "TP"/"NCI" acronyms were opaque).
    replaceChildren(this.statsEl,
      stat('Stories', String(stories)),
      stat('Talking-point alerts', String(alerts), alerts > 0 ? 'cc-stat-alert' : ''),
      stat('Recurring narratives', String(recurring), recurring > 0 ? 'cc-stat-alert' : ''),
      stat('Coverage asymmetry', String(asymmetries), asymmetries > 0 ? 'cc-stat-warn' : ''),
      stat('Avg manipulation', String(avgNci), avgNci >= 41 ? 'cc-stat-warn' : ''),
      stat('Peak manipulation', String(maxNci), maxNci >= 41 ? 'cc-stat-warn' : ''),
    );
  }

  /** Open X compose with this story's analysis pre-filled. */
  private shareStory(cc: ComparedCluster): void {
    const coordinated = cc.tp.phrases.filter(p => p.kind === 'coordinated');
    const share: ShareStory = {
      title: cc.cluster.primaryTitle,
      nci: cc.nci.normalized,
      tierLabel: cc.nci.tier.label,
      talkingPoint: cc.tp.talkingPointAlert,
      recurring: Boolean(cc.narratives && [...cc.narratives.values()].some(n => n.recurring)),
      sourceCount: cc.cluster.sourceCount,
      topPhrase: coordinated[0]?.phrase,
      phraseSources: coordinated[0]?.sources,
    };
    // Link the tweet to the public methodology page so readers can see how
    // the score is computed rather than taking the number on faith.
    shareStoryToX(share, `${location.origin}/methodology.html`);
  }

  /** Full-screen side-by-side story detail view. */
  private openStoryDetail(cc: ComparedCluster): void {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const titleId = `cc-modal-title-${Math.abs(hashString(cc.key))}`;
    const overlay = h('div', {
      className: 'cc-modal-overlay',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
    });
    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      // Restore focus to the control that opened the dialog.
      previouslyFocused?.focus?.();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'Tab') this.trapTab(e, overlay);
    };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const closeBtn = h('button', { className: 'cc-modal-close', type: 'button', title: 'Close (Esc)', 'aria-label': 'Close dialog' }, '✕') as HTMLButtonElement;
    closeBtn.addEventListener('click', close);

    const modalShareBtn = h('button', { className: 'cc-share-btn', type: 'button', title: 'Share on X', 'aria-label': 'Share this analysis on X' }, '𝕏 Share') as HTMLButtonElement;
    modalShareBtn.addEventListener('click', () => this.shareStory(cc));

    // One column per source class present, side by side.
    const columns = CLASS_ORDER
      .filter(cls => cc.groups[cls].length > 0)
      .map(cls => h('div', { className: 'cc-modal-col' },
        h('div', { className: `cc-group-label cc-group-${cls}` }, `${CLASS_LABELS[cls]} (${cc.groups[cls].length})`),
        ...cc.groups[cls].map(g => {
          const time = g.item.pubDate
            ? h('span', { className: 'cc-modal-time' }, new Date(g.item.pubDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
            : null;
          return h('div', { className: 'cc-modal-item' },
            h('div', { className: 'cc-modal-item-head' },
              h('span', { className: 'cc-source' }, g.item.source),
              ...(g.item.lang && g.item.lang !== 'en' ? [h('span', { className: 'cc-lang' }, g.item.lang)] : []),
              ...(time ? [time] : []),
              ...(g.divergent ? [h('span', { className: 'cc-flag cc-flag-warn' }, 'divergent')] : []),
            ),
            h('a', { className: 'cc-headline', href: g.item.link, target: '_blank', rel: 'noopener noreferrer' }, g.item.title),
            ...(g.uniqueTerms.length ? [h('div', { className: 'cc-unique' }, `unique: ${g.uniqueTerms.join(', ')}`)] : []),
          );
        }),
      ));

    const phrases = cc.tp.phrases.slice(0, 6).map(p =>
      h('div', { className: `cc-phrase${p.kind === 'coordinated' ? ' cc-phrase-coord' : ''}` },
        h('span', { className: 'cc-phrase-kind' }, p.kind === 'coordinated' ? '⚠ coordinated' : 'wire copy'),
        h('span', { className: 'cc-phrase-text' }, `“${p.phrase}”`),
        h('span', { className: 'cc-phrase-sources' }, p.sources.join(' · ')),
      ));

    overlay.append(h('div', { className: 'cc-modal' },
      h('div', { className: 'cc-modal-header' },
        h('span', { className: `cc-nci-badge cc-nci-l${cc.nci.tier.level}` }, `NCI ${cc.nci.normalized}`),
        h('span', { className: `cc-sync ${cc.tp.syncScore >= 60 ? 'cc-sync-high' : cc.tp.syncScore >= 30 ? 'cc-sync-mid' : 'cc-sync-low'}` }, `sync ${cc.tp.syncScore}%`),
        h('h2', { className: 'cc-modal-title', id: titleId }, cc.cluster.primaryTitle),
        modalShareBtn,
        closeBtn,
      ),
      ...(phrases.length ? [h('div', { className: 'cc-modal-phrases' }, ...phrases)] : []),
      h('div', { className: 'cc-modal-columns' }, ...columns),
      h('div', { className: 'cc-nci-disclaimer' },
        `${cc.nci.tier.label} — the NCI scale measures indicators, not proof.`),
    ));
    document.body.append(overlay);
    // Move focus into the dialog (close button) so keyboard/SR users land inside.
    closeBtn.focus();
  }

  /** Keep Tab focus cycling within the modal (simple two-end trap). */
  private trapTab(e: KeyboardEvent, container: HTMLElement): void {
    const focusable = container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }

  /** Discord webhook alert configuration UI. */
  private buildAlertsConfig(): HTMLElement {
    const input = h('input', {
      className: 'cc-alerts-input',
      type: 'password',
      placeholder: 'Discord webhook URL (Server Settings → Integrations → Webhooks)',
      'aria-label': 'Discord webhook URL',
      value: getDiscordWebhook(),
      autocomplete: 'off',
    }) as HTMLInputElement;

    const toggle = h('input', { type: 'checkbox', id: 'cc-alerts-toggle' }) as HTMLInputElement;
    toggle.checked = getAlertsEnabled();
    toggle.addEventListener('change', () => setAlertsEnabled(toggle.checked));

    const status = h('span', { className: 'cc-alerts-status' });

    const saveBtn = h('button', { className: 'btn btn-ghost cc-copy-btn', type: 'button' }, 'Save') as HTMLButtonElement;
    saveBtn.addEventListener('click', () => {
      const url = input.value.trim();
      if (url && !isValidWebhookUrl(url)) {
        status.textContent = 'Not a Discord webhook URL — it should start with https://discord.com/api/webhooks/';
        status.className = 'cc-alerts-status cc-alerts-err';
        return;
      }
      setDiscordWebhook(url);
      status.textContent = url ? 'Saved.' : 'Cleared.';
      status.className = 'cc-alerts-status cc-alerts-ok';
    });

    const testBtn = h('button', { className: 'btn btn-ghost cc-copy-btn', type: 'button' }, 'Send test') as HTMLButtonElement;
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      status.textContent = 'Sending…';
      status.className = 'cc-alerts-status';
      const ok = await sendTestAlert(input.value.trim());
      status.textContent = ok ? 'Test message delivered — check your Discord.' : 'Failed — check the URL and channel permissions.';
      status.className = `cc-alerts-status ${ok ? 'cc-alerts-ok' : 'cc-alerts-err'}`;
      testBtn.disabled = false;
    });

    const panel = h('div', { className: 'cc-alerts-config' },
      h('div', { className: 'cc-alerts-row' },
        h('label', { className: 'cc-alerts-label', htmlFor: 'cc-alerts-toggle' }, toggle, ' Post alerts to Discord (talking points, recurring narratives, NCI ≥ 61)'),
      ),
      h('div', { className: 'cc-alerts-row' }, input, saveBtn, testBtn),
      status,
    );
    panel.style.display = 'none';
    return panel;
  }

  /**
   * Automatically run the full AI rubric on the most-flagged stories
   * (talking-point alerts or NCI >= 41), sequentially, when local AI is
   * configured. Results cache for the session; manual overrides win.
   */
  private async autoAiScore(compared: ComparedCluster[]): Promise<void> {
    if (!getRuntimeConfigSnapshot().secrets.OLLAMA_API_URL?.value?.trim()) return;
    const now = Date.now();
    const candidates = compared
      .filter(cc => cc.tp.talkingPointAlert || cc.nci.normalized >= 41)
      .filter(cc => {
        // Skip stories already cached OR currently being scored (rapid live
        // refreshes would otherwise spawn duplicate concurrent Ollama calls).
        if (this.aiInFlight.has(cc.key)) return false;
        const cached = this.aiCache.get(cc.key);
        return !cached || now - cached.t >= CoverageComparePanel.AI_CACHE_TTL_MS;
      })
      .slice(0, CoverageComparePanel.AUTO_AI_MAX);

    for (const cc of candidates) {
      this.aiInFlight.add(cc.key);
      try {
        const headlineLines = cc.items.slice(0, 20).map(c => {
          const langTag = c.item.lang && c.item.lang !== 'en' ? ` [${c.item.lang}]` : '';
          return `- ${c.item.source}${langTag} (${CLASS_LABELS[c.cls]}): "${c.item.title}"`;
        });
        const text = await ollamaCompare(buildNciPrompt(cc.cluster.primaryTitle, headlineLines, cc.nci));
        const parsed = text ? parseAiNciResponse(text) : null;
        if (!parsed) continue;
        this.aiCache.set(cc.key, { t: Date.now(), parse: parsed, summary: parsed.summary });
        cc.nci = applyManualScores(mergeNci(cc.nci, parsed), cc.key);
        this.nciUpdaters.get(cc.key)?.(cc.nci, parsed.summary || undefined);
      } catch { /* per-story failures are non-fatal */ } finally {
        this.aiInFlight.delete(cc.key);
      }
    }
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

  /**
   * Live-pipeline entry point: data-loader pushes freshly ML-clustered
   * stories here on every feed refresh (same push path as AI Insights),
   * so the comparison tracks the live news feed without re-clustering.
   */
  updateClusters(clusters: ClusteredEvent[]): void {
    if (this.analyzing || !clusters?.length) return;
    void this.analyze(clusters);
  }

  private async analyze(preClustered?: ClusteredEvent[]): Promise<void> {
    if (this.analyzing) return;
    this.analyzing = true;
    this.live = Boolean(preClustered);
    this.statusEl.textContent = 'Clustering stories across sources…';
    try {
      const news = this.getLatestNews();
      if (!preClustered && (!news || news.length < 10)) {
        this.statusEl.textContent = 'Not enough headlines loaded yet — try again in a moment.';
        return;
      }
      const clusters = (preClustered ?? clusterNews(news))
        .filter(c => new Set((c.allItems as NewsItem[]).map(i => i.source)).size >= 2)
        .sort((a, b) => b.sourceCount - a.sourceCount)
        .slice(0, 12);

      if (clusters.length === 0) {
        // Distinct from the "not loaded yet" case — this is a healthy result.
        this.statusEl.textContent = '✓ No coordinated multi-source stories in the current window — nothing flagged.';
        return;
      }

      // Narrative persistence: track coordinated phrases across analysis runs.
      const narrativeStore = localStorageNarrativeStore();

      const compared = clusters.map(c => compareCluster(c, news))
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
      // Re-apply fresh session AI scores (manual overrides stay supreme).
      for (const cc of compared) {
        const cached = this.aiCache.get(cc.key);
        if (cached && Date.now() - cached.t < CoverageComparePanel.AI_CACHE_TTL_MS) {
          cc.nci = applyManualScores(mergeNci(cc.nci, cached.parse), cc.key);
        }
      }

      this.renderStats(compared.length, alerts, avgNci, maxNci, asymmetries, recurringCount);
      void this.updateAiStatus();
      const updatedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (isEverydayReaderMode()) {
        this.statusEl.textContent =
          (this.live ? 'Live · ' : '')
          + `${compared.length} stor${compared.length === 1 ? 'y' : 'ies'} · ${news.length} headlines`
          + (alerts ? ` · ${alerts} with shared phrasing` : ' · no synchronized phrasing spotted')
          + (asymmetries ? ` · ${asymmetries} coverage gap${asymmetries > 1 ? 's' : ''}` : '')
          + ` · updated ${updatedAt}`;
      } else {
        this.statusEl.textContent =
          (this.live ? '⦿ LIVE — synced with news feed refresh · ' : '')
          + `${news.length} headlines analyzed`
          + (alerts ? ` · ⚠ ${alerts} talking-point alert${alerts > 1 ? 's' : ''}` : ' · no synchronized talking points detected')
          + ` · updated ${updatedAt}`;
      }
      this.nciUpdaters.clear();
      replaceChildren(this.listEl, ...compared.map(cc => this.renderCluster(cc)));
      void this.autoAiScore(compared);

      // Discord alerts for flagged stories (deduped, fire-and-forget).
      const alertStories: AlertStory[] = compared.map(cc => ({
        key: cc.key,
        title: cc.cluster.primaryTitle,
        nci: cc.nci.normalized,
        tierLabel: cc.nci.tier.label,
        tierLevel: cc.nci.tier.level,
        talkingPoint: cc.tp.talkingPointAlert,
        recurring: Boolean(cc.narratives && [...cc.narratives.values()].some(n => n.recurring)),
        sourceCount: cc.cluster.sourceCount,
        flags: cc.flags,
        phrases: cc.tp.phrases.map(p => ({ phrase: p.phrase, kind: p.kind, sources: p.sources })),
      }));
      void dispatchDiscordAlerts(alertStories);
      void maybeSendDailyDigest({
        stories: alertStories,
        headlineCount: news.length,
        alerts,
        avgNci,
        peakNci: maxNci,
      });
    } finally {
      this.analyzing = false;
    }
  }

  private renderCluster(cc: ComparedCluster): HTMLElement {
    // Three-tier hierarchy (sprint Workstream D): the collapsed summary row
    // (Tier 1) shows only the NCI badge, source count, title, and the single
    // worst-severity flag chip. Everything else compresses into a quiet meta
    // line (Tier 2) and the full flag/evidence set inside the expansion
    // (Tier 3) — no signal is dropped, only demoted.
    interface FlagSpec { text: string; className: string; title?: string; severity: 0 | 1 | 2; talkingPoint?: boolean }
    const flagSpecs: FlagSpec[] = cc.flags.map(f => {
      const alert = f.includes('TALKING POINT');
      const warn = !alert && (f.includes('State') || f.includes('No independent') || f.includes('divergent') || f.includes('Loaded'));
      return {
        text: f,
        className: `cc-flag${alert ? ' cc-flag-alert' : warn ? ' cc-flag-warn' : ''}`,
        severity: alert ? 2 : warn ? 1 : 0,
        talkingPoint: alert,
      };
    });

    // Coverage asymmetry flags (blackout detection).
    if (cc.asymmetry === 'mainstream-silent') {
      flagSpecs.push({
        text: 'Mainstream silent',
        className: 'cc-flag cc-flag-warn',
        severity: 1,
        title: 'Independent outlets are covering this story but no mainstream outlet in the pool is — possible under-reporting or an unverified story gaining traction.',
      });
    } else if (cc.asymmetry === 'no-independent') {
      flagSpecs.push({
        text: 'No independent corroboration',
        className: 'cc-flag cc-flag-warn',
        severity: 1,
        title: 'Broad mainstream/state coverage with zero independent or local corroboration in the pool.',
      });
    }

    // Recurring narrative flags (phrases pushed across hours/days).
    const recurring = cc.narratives ? [...cc.narratives.values()].filter(n => n.recurring) : [];
    for (const n of recurring.slice(0, 2)) {
      flagSpecs.push({
        text: `↻ RECURRING ${n.age}`,
        className: 'cc-flag cc-flag-alert',
        severity: 2,
        title: `"${n.phrase}" observed in ${n.record.runs} analysis runs over ${n.age} by: ${n.record.sources.join(', ')}. Persistent synchronized phrasing is the signature of a pushed narrative.`,
      });
    }

    const mkFlag = (s: FlagSpec) =>
      h('span', { className: s.className, ...(s.title ? { title: s.title } : {}) }, s.text);

    // Tier 1 keeps at most ONE flag chip: worst severity wins
    // (alert > warn > default); the talking-point flag wins ties.
    let worstFlag: FlagSpec | null = null;
    for (const s of flagSpecs) {
      if (!worstFlag
        || s.severity > worstFlag.severity
        || (s.severity === worstFlag.severity && s.talkingPoint && !worstFlag.talkingPoint)) {
        worstFlag = s;
      }
    }

    // Freshness: any item published in the last 30 minutes → LIVE.
    const now = Date.now();
    const isLive = cc.items.some(i => i.item.pubDate && now - i.item.pubDate.getTime() < 30 * 60_000);

    // Narrative sync meter (full chip lives in the Tier 3 signal row;
    // Tier 2 compresses it to a word).
    const sync = cc.tp.syncScore;
    const syncClass = sync >= 60 ? 'cc-sync-high' : sync >= 30 ? 'cc-sync-mid' : 'cc-sync-low';
    const syncMeter = h('span', {
      className: `cc-sync ${syncClass}`,
      title: 'Narrative sync: how much of this coverage shares identical phrasing across distinct outlets. High + non-wire = likely talking point.',
    }, `sync ${sync}%`);

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

    // Trend chip: score moved >= 5 points vs prior observation of this story.
    // Renders in the Tier 3 signal row; Tier 2 shows the compressed delta.
    let trendChip: HTMLElement | null = null;
    const trendMoved = Boolean(cc.trend && cc.trend.prev !== null && Math.abs(cc.trend.delta) >= 5);
    const trendRising = trendMoved && cc.trend!.delta > 0;
    if (trendMoved) {
      trendChip = h('span', {
        className: `cc-flag ${trendRising ? 'cc-flag-alert' : ''}`,
        title: `NCI moved ${cc.trend!.delta > 0 ? '+' : ''}${cc.trend!.delta} since last observation (${cc.trend!.prev} → ${cc.nci.normalized}). A rising score means manipulation indicators are accumulating as the narrative builds.`,
      }, `${trendRising ? '▲' : '▼'} ${trendRising ? '+' : ''}${cc.trend!.delta}`);
    }

    // Tier 3 signal row: the FULL flag set (sync meter, LIVE, trend, every
    // heuristic/asymmetry/recurring chip) — same data as before, now shown
    // only when the card is expanded.
    const signalRow = h('div', { className: 'cc-flag-row' },
      syncMeter,
      ...(isLive ? [h('span', { className: 'cc-flag cc-flag-live', title: 'New reporting within the last 30 minutes' }, '⦿ LIVE')] : []),
      ...(trendChip ? [trendChip] : []),
      ...flagSpecs.map(mkFlag),
    );

    // Tier 2: one quiet meta line under the title — compressed sync
    // descriptor plus tiny colored dots instead of full chips.
    const syncWord = sync >= 60 ? 'high' : sync >= 30 ? 'moderate' : 'low';
    const syncDot = sync >= 60 ? 'cc-meta-dot-alert' : sync >= 30 ? 'cc-meta-dot-watch' : 'cc-meta-dot-dim';
    const metaChildren: Array<HTMLElement | string> = [
      h('span', { className: `cc-meta-dot ${syncDot}` }),
      `sync ${syncWord} ${sync}%`,
    ];
    if (cc.tp.phrases.length > 0) {
      metaChildren.push(' · ', `${cc.tp.phrases.length} phrase${cc.tp.phrases.length > 1 ? 's' : ''}`);
    }
    if (flagSpecs.length > 1) metaChildren.push(' · ', `${flagSpecs.length} flags`);
    if (recurring.length > 0) {
      metaChildren.push(' · ', h('span', { className: 'cc-meta-dot cc-meta-dot-alert' }), `↻ recurring ${recurring[0]!.age}`);
    }
    if (trendMoved) {
      metaChildren.push(' · ', `${trendRising ? '▲' : '▼'} ${trendRising ? '+' : ''}${cc.trend!.delta}`);
    }
    if (isLive) {
      metaChildren.push(' · ', h('span', { className: 'cc-meta-dot cc-meta-dot-live' }), '⦿ live');
    }
    const metaLine = h('div', { className: 'cc-meta' }, ...metaChildren);

    const everyday = isEverydayReaderMode();
    const civilian = everyday
      ? summarizeCivilianCoverage(cc.groups, {
          asymmetry: cc.asymmetry,
          divergentCount: cc.items.filter((i) => i.divergent).length,
          talkingPoint: cc.tp.talkingPointAlert,
          loadedCount: cc.tp.loadedTerms.length,
        })
      : null;
    const civilianCovered = civilian
      ? h('div', { className: 'cc-civilian-covered' }, civilian.covered)
      : null;
    const civilianIgnored = civilian?.ignored
      ? h('div', { className: 'cc-civilian-ignored' }, civilian.ignored)
      : null;
    const civilianFraming = civilian?.framing
      ? h('div', { className: 'cc-civilian-framing' }, civilian.framing)
      : null;

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
          'aria-label': `${ind.label}: score ${s.score} of 5 (${s.source}). Activate to change.`,
        }, String(s.score)) as HTMLButtonElement;
        scoreBtn.addEventListener('click', () => {
          const next = (s.score % 5) + 1 as 1 | 2 | 3 | 4 | 5;
          const merged = new Map<number, IndicatorScore>(cc.nci.scores);
          merged.set(ind.id, { score: next, evidence: 'Manually scored', source: 'manual' });
          cc.nci = finalizeNci(merged);
          saveManualScore(cc.key, ind.id, next);
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
      const copyBtn = h('button', { className: 'btn btn-ghost cc-copy-btn', type: 'button' }, 'Copy report') as HTMLButtonElement;
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
      // Trend sparkline: score history across observations (needs 2+ points).
      let sparkline: HTMLElement | null = null;
      const points = cc.trend?.points ?? [];
      if (points.length >= 2) {
        const w = 90;
        const hgt = 22;
        const vals = points.map(p => p.v);
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        const range = Math.max(1, max - min);
        const coords = vals.map((v, i) =>
          `${(i / (vals.length - 1)) * (w - 4) + 2},${hgt - 3 - ((v - min) / range) * (hgt - 6)}`).join(' ');
        const rising = vals[vals.length - 1]! > vals[0]!;
        const svgWrap = h('span', {
          className: 'cc-nci-spark',
          title: `NCI over ${points.length} observations: ${vals.join(' → ')}`,
        });
        setTrustedHtml(svgWrap, trustedHtml(
          `<svg width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}"><polyline points="${coords}" fill="none" stroke="${rising ? 'var(--status-alert)' : 'var(--status-good)'}" stroke-width="1.5"/></svg>`,
          'sparkline SVG built from numeric score history only'));
        sparkline = svgWrap;
      }

      replaceChildren(nciBody,
        h('div', { className: 'cc-nci-verdict' },
          h('span', { className: `cc-nci-badge cc-nci-l${result.tier.level}` }, `${result.normalized}/100`),
          h('span', { className: 'cc-nci-tier' }, result.tier.label),
          ...(sparkline ? [sparkline] : []),
          copyBtn,
        ),
        ...(lastAiSummary ? [h('div', { className: 'cc-nci-summary' }, lastAiSummary)] : []),
        h('div', { className: 'cc-nci-table' }, ...rows),
        h('div', { className: 'cc-nci-disclaimer' },
          'The NCI scale measures indicators of coordinated manipulation — it does not by itself prove an influence campaign exists. Click any score to override it with your own judgment (saved locally).'),
      );
    };

    const nciAiBtn = h('button', { className: 'btn btn-secondary cc-ai-btn cc-nci-ai-btn', type: 'button' }, everyday ? 'Full score (local AI)' : 'Full NCI Score (AI)') as HTMLButtonElement;
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
        nciAiBtn.textContent = everyday ? 'Full score (local AI)' : 'Full NCI Score (AI)';
      }
    });

    // Register updater so async auto-AI scoring can refresh this story in place.
    this.nciUpdaters.set(cc.key, (result, aiSummary) => {
      renderNciBreakdown(result, aiSummary);
      nciBadge.textContent = `NCI ${result.normalized}`;
      nciBadge.className = `cc-nci-badge cc-nci-l${result.tier.level}`;
    });

    const nciDetails = h('details', { className: 'cc-nci' },
      h('summary', { className: 'cc-nci-toggle' },
        everyday
          ? `Advanced score breakdown (optional) — ${cc.nci.normalized}/100`
          : `NCI Engineered Reality breakdown — ${cc.nci.normalized}/100 (${cc.nci.tier.label})`),
      nciBody,
      h('div', { className: 'cc-ai-row' }, nciAiBtn),
    );
    (nciDetails as HTMLDetailsElement).addEventListener('toggle', () => {
      if ((nciDetails as HTMLDetailsElement).open && nciBody.childElementCount === 0) renderNciBreakdown(cc.nci);
    });

    // ── Local coverage finder ──
    const localBtn = h('button', { className: 'btn btn-ghost cc-local-btn', type: 'button' }, 'Find local coverage') as HTMLButtonElement;
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

    const aiBtn = h('button', { className: 'btn btn-primary cc-ai-btn', type: 'button' }, 'AI Compare') as HTMLButtonElement;
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

    const expandBtn = h('button', {
      className: 'cc-expand-btn',
      type: 'button',
      title: 'Open full side-by-side comparison',
      'aria-label': 'Open full side-by-side comparison',
    }, '⛶') as HTMLButtonElement;
    expandBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openStoryDetail(cc);
    });

    const shareBtn = h('button', {
      className: 'cc-share-btn',
      type: 'button',
      title: 'Share this analysis on X',
      'aria-label': 'Share this analysis on X',
    }, '𝕏') as HTMLButtonElement;
    shareBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.shareStory(cc);
    });

    // Action buttons live in a sibling toolbar row, NOT inside <summary>
    // (nesting interactive controls in a summary is invalid and breaks
    // screen-reader/keyboard semantics).
    const actionRow = h('div', { className: 'cc-card-actions' }, shareBtn, expandBtn);

    // Left-border stripe colored by NCI tier makes suspicious stories pop out
    // of the list before any text is read (design review P1).
    // Everyday Tier 1: covered / quiet / framing — NCI badge stays inside expansion.
    const details = h('details', { className: `cc-details cc-tier-l${cc.nci.tier.level}${cc.tp.talkingPointAlert ? ' cc-details-alert' : ''}${everyday ? ' cc-details--everyday' : ''}` },
      everyday
        ? h('summary', { className: 'cc-summary cc-summary--everyday' },
            h('span', { className: 'cc-count' }, `${cc.cluster.sourceCount}×`),
            h('span', { className: 'cc-title' }, cc.cluster.primaryTitle),
            ...(worstFlag && !worstFlag.text.includes('NCI') ? [mkFlag(worstFlag)] : []),
            ...(civilianCovered ? [civilianCovered] : []),
            ...(civilianIgnored ? [civilianIgnored] : []),
            ...(civilianFraming ? [civilianFraming] : []),
          )
        : h('summary', { className: 'cc-summary' },
            // Tier 1: NCI badge + source count + title + at most ONE worst flag
            // (3 chips max), with the Tier 2 meta line wrapping underneath.
            nciBadge,
            h('span', { className: 'cc-count' }, `${cc.cluster.sourceCount}×`),
            h('span', { className: 'cc-title' }, cc.cluster.primaryTitle),
            ...(worstFlag ? [mkFlag(worstFlag)] : []),
            metaLine,
          ),
      actionRow,
      // Everyday: outlet groups (covered/ignored evidence) before sync/NCI chrome.
      ...(everyday ? groupEls : []),
      ...(everyday ? [] : [signalRow]),
      ...(everyday ? [] : phraseEls),
      ...(!everyday && loadedEl ? [loadedEl] : []),
      ...(!everyday && consensus ? [consensus] : []),
      ...(everyday
        ? [h('div', { className: 'cc-everyday-score-row' }, nciBadge, h('span', { className: 'cc-everyday-score-hint' }, 'Optional deep score'))]
        : []),
      ...(everyday ? [signalRow, ...phraseEls] : []),
      ...(everyday && loadedEl ? [loadedEl] : []),
      ...(everyday && consensus ? [consensus] : []),
      nciDetails,
      ...(everyday ? [] : groupEls),
      localResult,
      // Everyday: AI Compare stays inside the story expand, behind a quiet details gate.
      ...(everyday
        ? [h('details', { className: 'cc-everyday-ai-details' },
            h('summary', { className: 'cc-everyday-ai-summary' }, 'Local AI compare (optional)'),
            h('div', { className: 'cc-ai-row cc-ai-row--everyday' }, aiBtn, localBtn),
            aiResult,
          )]
        : [h('div', { className: 'cc-ai-row' }, aiBtn, localBtn), aiResult]),
    );
    if (cc.tp.talkingPointAlert) (details as HTMLDetailsElement).open = true;
    return details as HTMLElement;
  }
}
