/**
 * Brief synthesis on the user's own provider account.
 *
 * This is what makes the "bring your own key → unlimited briefs" promise in
 * settings true rather than marketing. When a key is stored, the request
 * goes from the page straight to the provider's OpenAI-compatible endpoint:
 *
 *   - it never passes through a WorldMonitor edge function, so the key stays
 *     off our infrastructure entirely;
 *   - it spends the user's credit, not our LLM budget, which is precisely
 *     why these runs are not metered by briefing-allowance.ts;
 *   - it is attempted BEFORE the hosted provider chain, so a BYOK user isn't
 *     silently falling back onto our budget while believing otherwise.
 *
 * Failures return null so `generateSummaryInternal` continues down the normal
 * hosted chain. A bad key must degrade to "the brief still works", never to
 * "the brief is gone".
 *
 * Nothing here logs the key, the Authorization header, or the request init.
 */

import { BYOK_PROVIDERS, type ByokProviderDef } from '@/config/support';
import { getByokKey } from '@/services/byok-keys';

export interface ByokSummary {
  summary: string;
  provider: ByokProviderDef['id'];
  model: string;
}

/** Hard ceiling so a runaway provider can't hang the insights pipeline. */
const BYOK_TIMEOUT_MS = 25_000;

function buildMessages(
  headlines: string[],
  geoContext?: string,
  lang = 'en',
): Array<{ role: 'system' | 'user'; content: string }> {
  const system = [
    'You are an intelligence analyst writing a short world brief.',
    'Synthesize the supplied headlines into 2-4 sentences of plain prose.',
    'Lead with what changed and why it matters. No preamble, no bullet points,',
    'no headings, and no invented facts or figures beyond the supplied material.',
    lang !== 'en' ? `Write the brief in language code "${lang}".` : '',
  ].filter(Boolean).join(' ');

  const parts = [`Headlines:\n${headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}`];
  if (geoContext && geoContext.trim()) {
    parts.push(`Supporting signal context:\n${geoContext.trim()}`);
  }

  return [
    { role: 'system', content: system },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

async function callProvider(
  def: ByokProviderDef,
  key: string,
  headlines: string[],
  geoContext?: string,
  lang?: string,
): Promise<ByokSummary | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BYOK_TIMEOUT_MS);

  try {
    const resp = await globalThis.fetch(def.chatUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: def.chatModel,
        messages: buildMessages(headlines, geoContext, lang),
        temperature: 0.3,
        max_tokens: 400,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      // Status only — the response body of a failed auth call can echo
      // request material, and this line lands in the user's console.
      console.warn(`[byok] ${def.label} declined the request (${resp.status})`);
      return null;
    }

    const data = await resp.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
    };
    const summary = data.choices?.[0]?.message?.content?.trim();
    if (!summary) return null;

    return { summary, provider: def.id, model: data.model || def.chatModel };
  } catch {
    // Timeout, CORS, offline. Silent by design: the hosted chain takes over.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Try each configured provider in order. Returns null when no key is stored,
 * which is the common case and must stay cheap (no network, no logging).
 */
export async function tryByokSummary(
  headlines: string[],
  geoContext?: string,
  lang?: string,
): Promise<ByokSummary | null> {
  for (const def of BYOK_PROVIDERS) {
    const key = getByokKey(def.id);
    if (!key) continue;
    const result = await callProvider(def, key, headlines, geoContext, lang);
    if (result) return result;
  }
  return null;
}
