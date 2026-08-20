/**
 * NCI Engineered Reality Scoring System.
 *
 * A structured "influence-campaign likelihood" rubric: 20 indicators, each
 * scored 1 (not present) to 5 (strongly present). The total is normalized to
 * 0–100 and mapped to tier bands. The scale measures INDICATORS of
 * coordinated manipulation — it does not by itself prove a psyop exists.
 *
 * Two scoring layers:
 *  - Heuristic: ~13 indicators are auto-scored from live cluster data
 *    (headline lexicons, phrase-synchronization analysis, publish timing).
 *  - AI: the full 20-indicator rubric can be scored by an LLM (local Ollama
 *    first) which also covers indicators that need world knowledge —
 *    beneficiaries, missing information, cherry-picked statistics, logical
 *    fallacies, historical parallels.
 *
 * Pure functions, no DOM.
 */
import { effectivePubDateMs } from '../services/feed-date';
import { normalizeTitle, LOADED_TERMS, type TalkingPointAnalysis } from './talking-points';

export type IndicatorSource = 'auto' | 'ai' | 'default' | 'manual';

export interface NciIndicator {
  id: number;
  label: string;
  /** What to look for, including the later-added emphasis factors folded in. */
  hint: string;
  /** True when the heuristic layer can score it from headline data alone. */
  auto: boolean;
}

export const NCI_INDICATORS: NciIndicator[] = [
  { id: 1, label: 'Suspicious timing', hint: 'Story bursts across many outlets nearly simultaneously, or lands at a strategically convenient moment.', auto: true },
  { id: 2, label: 'Emotional manipulation', hint: 'Fear, anger, or disgust language doing the persuading instead of facts.', auto: true },
  { id: 3, label: 'Uniform / scripted messaging', hint: 'Identical or near-identical phrasing across nominally independent outlets.', auto: true },
  { id: 4, label: 'Important missing information', hint: 'Key context absent everywhere; includes moving goalposts and contradictory official messaging over time.', auto: false },
  { id: 5, label: 'Overly simplistic narratives', hint: 'Complex events reduced to a single clean cause or villain.', auto: false },
  { id: 6, label: 'Tribal / us-vs-them framing', hint: 'Language dividing audiences into in-group and out-group; includes public shaming and social coercion.', auto: true },
  { id: 7, label: 'Authority overload', hint: 'Stacked appeals to experts/officials/agencies substituting for evidence.', auto: true },
  { id: 8, label: 'Pressure for urgent action', hint: 'Act-now framing that punishes deliberation.', auto: true },
  { id: 9, label: 'Novelty / unprecedented danger', hint: 'Relentless emphasis on newness or historic uniqueness of the threat.', auto: true },
  { id: 10, label: 'Financial / political beneficiaries', hint: 'Identifiable parties who gain; includes conflicts of interest and pharmaceutical, corporate, or government payments.', auto: false },
  { id: 11, label: 'Suppression of dissent', hint: 'Dissenters banned, punished, or delegitimized; includes censorship and algorithmic suppression.', auto: true },
  { id: 12, label: 'False dilemmas', hint: 'Only two options presented when more exist.', auto: true },
  { id: 13, label: 'Bandwagon / social proof', hint: '"Everyone agrees" pressure; consensus asserted rather than demonstrated.', auto: true },
  { id: 14, label: 'Repeated emotional messaging', hint: 'The same emotive terms recycled across outlets and days.', auto: true },
  { id: 15, label: 'Cherry-picked statistics', hint: 'Selective numbers, denominators hidden, baselines omitted.', auto: false },
  { id: 16, label: 'Logical fallacies', hint: 'Strawmen, ad hominem, appeal to consequences, motte-and-bailey.', auto: false },
  { id: 17, label: 'Manufactured outrage', hint: 'Outrage framing ("slams", "fury", "backlash") disproportionate to events.', auto: true },
  { id: 18, label: 'Framing & language manipulation', hint: 'Loaded labels and euphemisms steering conclusions before facts arrive.', auto: true },
  { id: 19, label: 'Rapid behavior-change push', hint: 'Messaging engineered to alter public behavior quickly.', auto: true },
  { id: 20, label: 'Historical propaganda parallels', hint: 'Techniques matching documented influence campaigns.', auto: false },
];

export interface IndicatorScore {
  score: 1 | 2 | 3 | 4 | 5;
  evidence: string;
  source: IndicatorSource;
}

export interface NciResult {
  scores: Map<number, IndicatorScore>;
  /** Raw total: sum of the 20 indicator scores (range 20–100). */
  total: number;
  /** Normalized 0–100: (total − 20) / 80 × 100. */
  normalized: number;
  tier: NciTier;
}

export interface NciTier {
  label: string;
  min: number;
  max: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export const NCI_TIERS: NciTier[] = [
  { min: 0, max: 20, label: 'Low indication of coordinated manipulation', level: 0 },
  { min: 21, max: 40, label: 'Some persuasive or propaganda techniques present', level: 1 },
  { min: 41, max: 60, label: 'Significant manipulation indicators', level: 2 },
  { min: 61, max: 80, label: 'Strong likelihood of an organized influence campaign', level: 3 },
  { min: 81, max: 100, label: 'Extreme, highly coordinated engineered-reality environment', level: 4 },
];

export function tierFor(normalized: number): NciTier {
  const n = Math.max(0, Math.min(100, Math.round(normalized)));
  return NCI_TIERS.find(t => n >= t.min && n <= t.max) ?? NCI_TIERS[0]!;
}

// ── Lexicons for heuristic indicators (direction-neutral) ──

const TRIBAL = new Set([
  'traitor', 'traitors', 'enemy', 'enemies', 'elites', 'elite', 'globalists',
  'patriots', 'woke', 'deplorables', 'sheep', 'shills', 'sellout', 'sellouts',
  'them', 'invaders', 'outsiders', 'loyalists', 'collaborators', 'deniers',
  'apologists', 'sympathizers',
]);

const AUTHORITY = new Set([
  'experts', 'officials', 'scientists', 'authorities', 'agencies',
  'studies', 'consensus', 'researchers', 'doctors', 'economists',
]);

const URGENCY = new Set([
  'urgent', 'urgently', 'emergency', 'immediately', 'deadline', 'ultimatum',
  'imminent', 'looming', 'countdown', 'scramble', 'scrambles', 'rush', 'rushes',
]);

const NOVELTY = new Set([
  'unprecedented', 'historic', 'never-before-seen', 'record-breaking',
  'record', 'first-ever', 'bombshell', 'shocking', 'staggering',
]);

const DILEMMA_PHRASES = [
  'no choice', 'only way', 'only option', 'no alternative', 'last chance',
  'either we', 'or else', 'the only',
];

const BANDWAGON = new Set([
  'everyone', 'consensus', 'majority', 'overwhelmingly', 'unanimous',
  'agree', 'agrees', 'unites', 'united', 'momentum',
]);

const SUPPRESSION = new Set([
  'banned', 'censored', 'silenced', 'deplatformed', 'suspended',
  'shadowbanned', 'blacklisted', 'fired', 'punished', 'criminalized',
]);

const OUTRAGE = new Set([
  'outrage', 'outraged', 'fury', 'furious', 'backlash', 'slams', 'blasts',
  'erupts', 'firestorm', 'uproar', 'condemns', 'condemnation',
]);

const BEHAVIOR_PUSH = new Set([
  'urged', 'urges', 'demands', 'demand', 'must', 'calls', 'mandate',
  'mandates', 'comply', 'compliance', 'boycott', 'mobilize',
]);

/** Map a 0–1 signal fraction to a 1–5 indicator score. */
export function scaleScore(fraction: number): 1 | 2 | 3 | 4 | 5 {
  if (fraction <= 0) return 1;
  if (fraction < 0.15) return 2;
  if (fraction < 0.35) return 3;
  if (fraction < 0.6) return 4;
  return 5;
}

export interface NciClusterInput {
  titles: Array<{ source: string; title: string; pubDate?: Date; pubDateMissing?: boolean }>;
  tp: TalkingPointAnalysis;
}

interface LexiconHit { fraction: number; matched: string[] }

function lexiconScan(titles: NciClusterInput['titles'], lexicon: Set<string>): LexiconHit {
  if (titles.length === 0) return { fraction: 0, matched: [] };
  const matched = new Set<string>();
  let hits = 0;
  for (const t of titles) {
    const words = normalizeTitle(t.title);
    let hit = false;
    for (const w of words) {
      if (lexicon.has(w)) { matched.add(w); hit = true; }
    }
    if (hit) hits++;
  }
  return { fraction: hits / titles.length, matched: [...matched] };
}

function phraseScan(titles: NciClusterInput['titles'], phrases: string[]): LexiconHit {
  if (titles.length === 0) return { fraction: 0, matched: [] };
  const matched = new Set<string>();
  let hits = 0;
  for (const t of titles) {
    const lower = ` ${normalizeTitle(t.title).join(' ')} `;
    let hit = false;
    for (const p of phrases) {
      if (lower.includes(` ${p} `)) { matched.add(p); hit = true; }
    }
    if (hit) hits++;
  }
  return { fraction: hits / titles.length, matched: [...matched] };
}

function evidenceFor(hit: LexiconHit): string {
  if (hit.matched.length === 0) return 'No lexicon matches in current headlines.';
  return `${Math.round(hit.fraction * 100)}% of headlines: ${hit.matched.slice(0, 5).join(', ')}`;
}

interface DatedPublishTimes {
  times: number[];
  missingCount: number;
}

/**
 * Collect real publication timestamps for burst/timing analysis.
 * Items with `pubDateMissing`, no `pubDate`, or an effective stamp of 0
 * are excluded — synthesized "now" stamps must not look like a simultaneous
 * burst. Matches the velocity.ts pattern: filter missing dates, then
 * `effectivePubDateMs` (never treat 0 as a clustered epoch timestamp).
 */
function collectDatedPublishMs(titles: NciClusterInput['titles']): DatedPublishTimes {
  const times: number[] = [];
  let missingCount = 0;
  for (const t of titles) {
    if (t.pubDate == null || t.pubDateMissing === true) {
      missingCount++;
      continue;
    }
    const ms = effectivePubDateMs({ pubDate: t.pubDate, pubDateMissing: t.pubDateMissing });
    if (ms > 0) times.push(ms);
    else missingCount++;
  }
  times.sort((a, b) => a - b);
  return { times, missingCount };
}

/** Max dated items published within any rolling 2-hour window, as a fraction of dated items. */
function burstFractionFromTimes(times: number[]): number {
  if (times.length < 3) return 0;
  const WINDOW = 2 * 60 * 60 * 1000;
  let best = 0;
  for (let i = 0; i < times.length; i++) {
    let j = i;
    while (j < times.length && times[j]! - times[i]! <= WINDOW) j++;
    best = Math.max(best, j - i);
  }
  return best / times.length;
}

function timingEvidence(burst: number, missingCount: number): string {
  const missingNote = missingCount > 0
    ? ` (${missingCount} undated excluded)`
    : '';
  if (burst > 0) {
    return `${Math.round(burst * 100)}% of dated items published within a 2-hour window${missingNote}`;
  }
  if (missingCount > 0) {
    return `Insufficient dated timestamps to assess timing (${missingCount} item${missingCount === 1 ? '' : 's'} missing pubDate).`;
  }
  return 'Insufficient timing spread to assess.';
}

export function heuristicNciScore(input: NciClusterInput): NciResult {
  const { titles, tp } = input;
  const scores = new Map<number, IndicatorScore>();
  const set = (id: number, score: 1 | 2 | 3 | 4 | 5, evidence: string, source: IndicatorSource = 'auto') =>
    scores.set(id, { score, evidence, source });

  // 1. Suspicious timing — publication burst tightness across dated outlets.
  const { times, missingCount } = collectDatedPublishMs(titles);
  const burst = burstFractionFromTimes(times);
  set(1, scaleScore(burst >= 0.8 && times.length >= 4 ? burst : burst * 0.6),
    timingEvidence(burst, missingCount));

  // 2. Emotional manipulation — loaded-language density.
  const loaded = lexiconScan(titles, LOADED_TERMS);
  set(2, scaleScore(loaded.fraction), evidenceFor(loaded));

  // 3. Uniform / scripted messaging — from the talking-point engine.
  const coordinated = tp.phrases.filter(p => p.kind === 'coordinated');
  const syncFrac = tp.syncScore / 100;
  set(3, scaleScore(coordinated.length > 0 ? Math.max(syncFrac, 0.2) : syncFrac * 0.5),
    coordinated.length > 0
      ? `Sync ${tp.syncScore}% — coordinated phrase${coordinated.length > 1 ? 's' : ''}: ${coordinated.slice(0, 2).map(p => `"${p.phrase}"`).join(', ')}`
      : `Sync ${tp.syncScore}% — no non-wire shared phrasing.`);

  // 6. Tribal framing.
  const tribal = lexiconScan(titles, TRIBAL);
  set(6, scaleScore(tribal.fraction), evidenceFor(tribal));

  // 7. Authority overload.
  const authority = lexiconScan(titles, AUTHORITY);
  set(7, scaleScore(authority.fraction), evidenceFor(authority));

  // 8. Urgency pressure.
  const urgency = lexiconScan(titles, URGENCY);
  set(8, scaleScore(urgency.fraction), evidenceFor(urgency));

  // 9. Novelty / unprecedented danger.
  const novelty = lexiconScan(titles, NOVELTY);
  set(9, scaleScore(novelty.fraction), evidenceFor(novelty));

  // 11. Suppression of dissent.
  const suppression = lexiconScan(titles, SUPPRESSION);
  set(11, scaleScore(suppression.fraction), evidenceFor(suppression));

  // 12. False dilemmas.
  const dilemma = phraseScan(titles, DILEMMA_PHRASES);
  set(12, scaleScore(dilemma.fraction), evidenceFor(dilemma));

  // 13. Bandwagon / social proof.
  const bandwagon = lexiconScan(titles, BANDWAGON);
  set(13, scaleScore(bandwagon.fraction), evidenceFor(bandwagon));

  // 14. Repeated emotional messaging — loaded terms echoed by 2+ outlets.
  const echoed = tp.loadedTerms.filter(l => l.sources.length >= 2);
  const echoFrac = titles.length ? Math.min(1, echoed.length / 3) : 0;
  set(14, scaleScore(echoFrac),
    echoed.length ? `Echoed by 2+ outlets: ${echoed.slice(0, 4).map(l => l.term).join(', ')}` : 'No cross-outlet emotional repetition.');

  // 17. Manufactured outrage.
  const outrage = lexiconScan(titles, OUTRAGE);
  set(17, scaleScore(outrage.fraction), evidenceFor(outrage));

  // 18. Framing & language manipulation — loaded phrasing inside coordinated phrases.
  const loadedCoord = coordinated.filter(p => p.loaded);
  const framingSignal = Math.min(1, loaded.fraction * 0.6 + (loadedCoord.length > 0 ? 0.4 : 0));
  set(18, scaleScore(framingSignal),
    loadedCoord.length
      ? `Loaded coordinated phrasing: ${loadedCoord.slice(0, 2).map(p => `"${p.phrase}"`).join(', ')}`
      : evidenceFor(loaded));

  // 19. Rapid behavior-change push.
  const behavior = lexiconScan(titles, BEHAVIOR_PUSH);
  set(19, scaleScore(behavior.fraction), evidenceFor(behavior));

  // Indicators that need world knowledge — default until AI/manual scoring.
  for (const ind of NCI_INDICATORS) {
    if (!scores.has(ind.id)) {
      set(ind.id, 1, 'Not auto-scorable from headlines — run AI scoring for a full assessment.', 'default');
    }
  }

  return finalizeNci(scores);
}

export function finalizeNci(scores: Map<number, IndicatorScore>): NciResult {
  let total = 0;
  for (const ind of NCI_INDICATORS) total += scores.get(ind.id)?.score ?? 1;
  const normalized = Math.round(((total - 20) / 80) * 100);
  return { scores, total, normalized, tier: tierFor(normalized) };
}

// ── AI scoring ──

export function buildNciPrompt(storyTitle: string, headlineLines: string[], heuristic: NciResult): string {
  const rubric = NCI_INDICATORS.map(i => `${i.id}. ${i.label} — ${i.hint}`).join('\n');
  const auto = NCI_INDICATORS
    .filter(i => heuristic.scores.get(i.id)?.source === 'auto')
    .map(i => `${i.id}: ${heuristic.scores.get(i.id)!.score} (${heuristic.scores.get(i.id)!.evidence})`)
    .join('\n');
  return [
    `Score this news story cluster on the NCI Engineered Reality rubric.`,
    `Story: ${storyTitle}`,
    '',
    'Headlines by source:',
    ...headlineLines,
    '',
    'Rubric — score each indicator 1 (not present) to 5 (strongly present):',
    rubric,
    '',
    'Automated lexicon/timing analysis already estimated these (adjust if you disagree):',
    auto,
    '',
    'The scale measures indicators, not proof of a psyop. Be calibrated: most ordinary',
    'news should score low. Reserve 4–5 for clear, specific evidence you can cite.',
    '',
    'Respond with ONLY a JSON object, no prose before or after:',
    '{"scores":[{"id":1,"score":2,"evidence":"one short sentence"},...all 20...],"summary":"2-3 sentence overall assessment"}',
  ].join('\n');
}

export interface AiNciParse {
  scores: Map<number, IndicatorScore>;
  summary: string;
}

export function parseAiNciResponse(text: string): AiNciParse | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const data = JSON.parse(match[0]) as { scores?: Array<{ id?: number; score?: number; evidence?: string }>; summary?: string };
    if (!Array.isArray(data.scores)) return null;
    const scores = new Map<number, IndicatorScore>();
    for (const s of data.scores) {
      const id = Number(s.id);
      let sc = Math.round(Number(s.score));
      if (!Number.isFinite(id) || !NCI_INDICATORS.some(i => i.id === id)) continue;
      if (!Number.isFinite(sc)) continue;
      sc = Math.max(1, Math.min(5, sc));
      scores.set(id, { score: sc as 1 | 2 | 3 | 4 | 5, evidence: String(s.evidence || '').slice(0, 300), source: 'ai' });
    }
    if (scores.size === 0) return null;
    return { scores, summary: String(data.summary || '').slice(0, 1000) };
  } catch {
    return null;
  }
}

/** Merge AI scores over heuristic ones (AI wins where provided). */
export function mergeNci(heuristic: NciResult, ai: AiNciParse): NciResult {
  const merged = new Map(heuristic.scores);
  for (const [id, s] of ai.scores) merged.set(id, s);
  return finalizeNci(merged);
}

// ── Manual score persistence (localStorage) ──

const MANUAL_STORE_KEY = 'bwm-nci-manual-scores';
const MANUAL_STORE_MAX_CLUSTERS = 300;

type ManualStore = Record<string, { t: number; scores: Record<string, number> }>;

function readManualStore(): ManualStore {
  try {
    return JSON.parse(localStorage.getItem(MANUAL_STORE_KEY) || '{}') as ManualStore;
  } catch {
    return {};
  }
}

export function saveManualScore(clusterId: string, indicatorId: number, score: number): void {
  try {
    const store = readManualStore();
    const entry = store[clusterId] ?? { t: 0, scores: {} };
    entry.t = Date.now();
    entry.scores[String(indicatorId)] = score;
    store[clusterId] = entry;
    // Evict oldest clusters beyond cap.
    const keys = Object.keys(store);
    if (keys.length > MANUAL_STORE_MAX_CLUSTERS) {
      keys.sort((a, b) => (store[a]?.t ?? 0) - (store[b]?.t ?? 0));
      for (const k of keys.slice(0, keys.length - MANUAL_STORE_MAX_CLUSTERS)) delete store[k];
    }
    localStorage.setItem(MANUAL_STORE_KEY, JSON.stringify(store));
  } catch { /* storage unavailable */ }
}

export function loadManualScores(clusterId: string): Map<number, 1 | 2 | 3 | 4 | 5> {
  const out = new Map<number, 1 | 2 | 3 | 4 | 5>();
  try {
    const entry = readManualStore()[clusterId];
    if (!entry) return out;
    for (const [id, sc] of Object.entries(entry.scores)) {
      const n = Math.max(1, Math.min(5, Math.round(Number(sc))));
      const iid = Number(id);
      if (Number.isFinite(iid) && NCI_INDICATORS.some(i => i.id === iid)) {
        out.set(iid, n as 1 | 2 | 3 | 4 | 5);
      }
    }
  } catch { /* storage unavailable */ }
  return out;
}

/** Apply saved manual overrides to a result. */
export function applyManualScores(result: NciResult, clusterId: string): NciResult {
  const manual = loadManualScores(clusterId);
  if (manual.size === 0) return result;
  const merged = new Map(result.scores);
  for (const [id, score] of manual) {
    merged.set(id, { score, evidence: 'Manually scored', source: 'manual' });
  }
  return finalizeNci(merged);
}

// ── NCI trend history (localStorage) ──

const TREND_STORE_KEY = 'bwm-nci-trend';
const TREND_MAX_STORIES = 200;
const TREND_MAX_POINTS = 20;
const TREND_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

interface TrendEntry { points: Array<{ t: number; v: number }> }

export interface NciTrend {
  /** Previous observed score (most recent before this one), or null. */
  prev: number | null;
  /** Delta vs previous observation (0 when no history). */
  delta: number;
  /** All observed points, oldest first. */
  points: Array<{ t: number; v: number }>;
}

/**
 * Record an observation of a story's NCI score and return its trend.
 * Observations < 10 minutes apart collapse into the newest value.
 */
export function recordNciObservation(storyKey: string, normalized: number, now: number = Date.now()): NciTrend {
  let store: Record<string, TrendEntry> = {};
  try {
    store = JSON.parse(localStorage.getItem(TREND_STORE_KEY) || '{}') as Record<string, TrendEntry>;
  } catch { /* storage unavailable */ }

  // Retention + cap.
  for (const [k, e] of Object.entries(store)) {
    const last = e?.points?.[e.points.length - 1]?.t ?? 0;
    if (now - last > TREND_RETENTION_MS) delete store[k];
  }
  const keys = Object.keys(store);
  if (keys.length > TREND_MAX_STORIES) {
    keys.sort((a, b) =>
      (store[a]?.points?.[store[a].points.length - 1]?.t ?? 0)
      - (store[b]?.points?.[store[b].points.length - 1]?.t ?? 0));
    for (const k of keys.slice(0, keys.length - TREND_MAX_STORIES)) delete store[k];
  }

  const entry = store[storyKey] ?? { points: [] };
  const lastPoint = entry.points[entry.points.length - 1];
  let prev: number | null = null;
  if (lastPoint && now - lastPoint.t < 10 * 60_000) {
    // Rapid re-analysis: update in place; prev is the point before it.
    prev = entry.points.length >= 2 ? entry.points[entry.points.length - 2]!.v : null;
    lastPoint.t = now;
    lastPoint.v = normalized;
  } else {
    prev = lastPoint?.v ?? null;
    entry.points.push({ t: now, v: normalized });
    if (entry.points.length > TREND_MAX_POINTS) entry.points.splice(0, entry.points.length - TREND_MAX_POINTS);
  }
  store[storyKey] = entry;
  try {
    localStorage.setItem(TREND_STORE_KEY, JSON.stringify(store));
  } catch { /* storage unavailable */ }

  return { prev, delta: prev === null ? 0 : normalized - prev, points: entry.points };
}

// ── Report export ──

export function buildNciReport(storyTitle: string, result: NciResult, extra: {
  sources: string[];
  phrases?: Array<{ phrase: string; kind: string; sources: string[] }>;
  aiSummary?: string;
}): string {
  const lines = [
    `# NCI Engineered Reality Assessment`,
    ``,
    `**Story:** ${storyTitle}`,
    `**Score:** ${result.normalized}/100 — ${result.tier.label}`,
    `**Sources analyzed:** ${extra.sources.join(', ')}`,
    ``,
  ];
  if (extra.aiSummary) lines.push(`**AI assessment:** ${extra.aiSummary}`, '');
  if (extra.phrases?.length) {
    lines.push(`## Synchronized phrasing`, '');
    for (const p of extra.phrases) lines.push(`- "${p.phrase}" (${p.kind}) — ${p.sources.join(', ')}`);
    lines.push('');
  }
  lines.push(`## Indicators (1 = not present, 5 = strongly present)`, '');
  lines.push(`| # | Indicator | Score | Basis | Evidence |`);
  lines.push(`|---|-----------|-------|-------|----------|`);
  for (const ind of NCI_INDICATORS) {
    const s = result.scores.get(ind.id)!;
    lines.push(`| ${ind.id} | ${ind.label} | ${s.score} | ${s.source} | ${s.evidence.replace(/\|/g, '/')} |`);
  }
  lines.push('', `> The NCI scale measures indicators of coordinated manipulation — it does not by itself prove an influence campaign exists.`);
  return lines.join('\n');
}
