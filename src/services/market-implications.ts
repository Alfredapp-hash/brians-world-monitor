import { toApiUrl } from '@/services/runtime';
import { getHydratedData } from '@/services/bootstrap';
import { oncePerPageLoad } from '@/services/page-load-once';

export interface TransmissionNode {
  node: string;
  impactType: string;
  logic: string;
}

export interface MarketImplicationCard {
  ticker: string;
  name: string;
  direction: string;
  timeframe: string;
  confidence: string;
  title: string;
  narrative: string;
  riskCaveat: string;
  driver: string;
  transmissionChain?: TransmissionNode[];
}

export interface MarketImplicationsData {
  cards: MarketImplicationCard[];
  degraded: boolean;
  emptyReason: string;
  generatedAt: string;
}

export function normalizeCard(raw: Record<string, unknown>): MarketImplicationCard {
  const chain = Array.isArray(raw.transmissionChain)
    ? (raw.transmissionChain as Array<Record<string, unknown>>).map(n => ({
        node: String(n.node ?? ''),
        impactType: String(n.impactType ?? ''),
        logic: String(n.logic ?? ''),
      }))
    : Array.isArray(raw.transmission_chain)
      ? (raw.transmission_chain as Array<Record<string, unknown>>).map(n => ({
          node: String(n.node ?? ''),
          impactType: String(n.impact_type ?? ''),
          logic: String(n.logic ?? ''),
        }))
      : [];
  return {
    ticker: String(raw.ticker ?? ''),
    name: String(raw.name ?? ''),
    direction: String(raw.direction ?? ''),
    timeframe: String(raw.timeframe ?? ''),
    confidence: String(raw.confidence ?? ''),
    title: String(raw.title ?? ''),
    narrative: String(raw.narrative ?? ''),
    riskCaveat: String(raw.riskCaveat ?? raw.risk_caveat ?? ''),
    driver: String(raw.driver ?? ''),
    transmissionChain: chain,
  };
}

// Cache keyed by frameworkId ('' = no framework). Avoids 100 users × 1 API call
// when all have the same framework selected — server serves from its own Redis key.
const cache = new Map<string, { data: MarketImplicationsData; cachedAt: number }>();
const CACHE_TTL = 10 * 60 * 1000;

export function getCachedMarketImplications(): MarketImplicationsData | null {
  return cache.get('')?.data ?? null;
}

export async function fetchMarketImplications(frameworkId = '', force = false): Promise<MarketImplicationsData | null> {
  const now = Date.now();
  const cached = cache.get(frameworkId);
  if (!force && cached && !cached.data.degraded && now - cached.cachedAt < CACHE_TTL) return cached.data;

  if (!force && !frameworkId) {
    const hydrated = getHydratedData('marketImplications') as { cards?: unknown[]; degraded?: boolean; emptyReason?: string; generatedAt?: string } | undefined;
    if (hydrated?.cards && Array.isArray(hydrated.cards) && hydrated.cards.length > 0 && !hydrated.degraded) {
      const data: MarketImplicationsData = {
        cards: hydrated.cards.map(c => normalizeCard(c as Record<string, unknown>)),
        degraded: false,
        emptyReason: hydrated.emptyReason ?? '',
        generatedAt: hydrated.generatedAt ?? '',
      };
      cache.set('', { data, cachedAt: now });
      return data;
    }
  }

  return oncePerPageLoad(`intelligence:list-market-implications:${frameworkId}`, async () => {
    const resolved = toApiUrl('/api/intelligence/v1/list-market-implications');
    const origin = typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://127.0.0.1';
    const url = resolved.startsWith('http://') || resolved.startsWith('https://')
      ? new URL(resolved)
      : new URL(resolved, origin);
    if (frameworkId) url.searchParams.set('frameworkId', frameworkId);
    let resp: Response;
    try {
      resp = await globalThis.fetch(url.toString(), {
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      if (cached?.data) return cached.data;
      throw error instanceof Error ? error : new Error('Market implications request failed');
    }
    if (!resp.ok) {
      if (cached?.data) return cached.data;
      throw new Error(`Market implications unavailable (HTTP ${resp.status})`);
    }

    const raw = (await resp.json()) as { cards?: unknown[]; degraded?: boolean; emptyReason?: string; generatedAt?: string };
    if (!Array.isArray(raw.cards)) {
      if (cached?.data) return cached.data;
      throw new Error('Market implications unavailable (invalid payload)');
    }

    const data: MarketImplicationsData = {
      cards: raw.cards.map(c => normalizeCard(c as Record<string, unknown>)),
      degraded: raw.degraded ?? false,
      emptyReason: raw.emptyReason ?? '',
      generatedAt: raw.generatedAt ?? '',
    };
    cache.set(frameworkId, { data, cachedAt: now });
    return data;
  }, force);
}
