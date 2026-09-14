/**
 * Conversion surface configuration — what Free includes, what Pro adds, where
 * donations go, and which AI providers accept a user-supplied key.
 *
 * Design rule for this file (and everything that reads it): NOTHING here may
 * be used to gate the core dashboard. Map, layers, globe, God's Eye, reader
 * mode, public cameras, panels and live data are free and stay free — this
 * fork self-hosts its own backend and `panel-gating.hasPremiumAccess()`
 * deliberately returns true for every visitor. The only metered resource is
 * *our* hosted LLM spend on on-demand briefing regeneration, and even that
 * has a free allowance plus a bring-your-own-key escape hatch.
 *
 * Config layer: imports nothing but types (types -> config -> services).
 */

/** Hosted on-demand brief regenerations per UTC day, no key required. */
export const FREE_BRIEFING_RUNS_PER_DAY = 10;

/** Same, for an active paying subscriber. Mirrors DIRECT_LLM_DAILY_QUOTA_LIMIT
 *  (server/_shared/direct-llm-quota.ts) so the client never promises an
 *  allowance the gateway will refuse. */
export const PRO_BRIEFING_RUNS_PER_DAY = 50;

/**
 * Where "Support this project" goes.
 *
 * Override per-deployment with VITE_DONATE_URL (a GitHub Sponsors, Ko-fi,
 * Open Collective or hosted-checkout link). The default is the fork owner's
 * GitHub Sponsors page, derived from BRAND.github's account. Donations are
 * intentionally NOT routed through Dodo checkout: a donor is not buying a
 * subscription and should never land in a plan-selection flow.
 */
export function getDonateUrl(): string {
  // Cast through `undefined`: this module is also loaded by node:test runs
  // where `import.meta.env` does not exist at all.
  const env = import.meta.env as ImportMetaEnv | undefined;
  const configured = env?.VITE_DONATE_URL;
  if (typeof configured === 'string' && configured.trim()) {
    const trimmed = configured.trim();
    // Only ever hand an https destination to window.open / an href.
    try {
      const url = new URL(trimmed);
      if (url.protocol === 'https:') return url.toString();
    } catch {
      // Fall through to the default below rather than rendering a broken link.
    }
  }
  return 'https://github.com/sponsors/Alfredapp-hash';
}

/**
 * Honest feature accounting for the settings comparison.
 *
 * `free` is written to read like an inventory of a complete product, because
 * it is one. `proAdds` may only contain things that genuinely exist: the
 * hosted briefing allowance lift, and the Pro surfaces already shipped in
 * this codebase (WM Analyst chat, REST API keys, MCP connectors, alerting).
 * Do not add aspirational rows here.
 */
export const FREE_INCLUDES: readonly string[] = [
  'The whole map — 50+ live layers, globe view, and the God\u2019s Eye cinematic stage',
  'Everyday reader mode and the full analyst dashboard, side by side',
  'Public camera layer and every map overlay, unwatermarked',
  '500+ news feeds and 65+ external data sources, refreshed live',
  'Every panel, custom layouts, saved views, and shareable links',
  'The AI world brief, synthesized for everyone and kept current',
  `${FREE_BRIEFING_RUNS_PER_DAY} on-demand brief regenerations a day on our AI budget`,
  'Bring your own AI key for unlimited briefs — free, never metered by us',
];

export const PRO_ADDS: readonly string[] = [
  `${PRO_BRIEFING_RUNS_PER_DAY} on-demand briefs a day on our AI budget — no key to manage`,
  'Deeper briefs: analyst frameworks, market implications, and situation deduction',
  'WM Analyst — conversational follow-ups on any story or region',
  'REST API keys and official SDKs for pulling WorldMonitor data into your own tools',
  'MCP connectors so Claude, Cursor and other agents can query your dashboard',
  'Priority alerting and notification channels',
];

/** Providers a user can point at with their own key. */
export interface ByokProviderDef {
  readonly id: ByokProviderId;
  readonly label: string;
  /** Shown under the input so the user knows what they are pasting. */
  readonly hint: string;
  /** Where to get a key. */
  readonly signupUrl: string;
  /** Cheap, side-effect-free endpoint used by the "Test" button. */
  readonly verifyUrl: string;
  /** OpenAI-compatible chat-completions endpoint, called directly from the page. */
  readonly chatUrl: string;
  /**
   * Default model for BYOK brief synthesis. Provider model catalogs change
   * often; this is the single place to update them.
   */
  readonly chatModel: string;
  /** Expected prefix, used for a fast client-side format check. */
  readonly keyPrefix: string;
  readonly minLength: number;
}

export type ByokProviderId = 'groq' | 'openrouter';

export const BYOK_PROVIDERS: readonly ByokProviderDef[] = [
  {
    id: 'groq',
    label: 'Groq',
    hint: 'Fast Llama-class inference. Free tier is generous enough for daily briefs.',
    signupUrl: 'https://console.groq.com/keys',
    verifyUrl: 'https://api.groq.com/openai/v1/models',
    chatUrl: 'https://api.groq.com/openai/v1/chat/completions',
    chatModel: 'llama-3.3-70b-versatile',
    keyPrefix: 'gsk_',
    minLength: 20,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    hint: 'One key, many models. Pay-as-you-go against your own credit.',
    signupUrl: 'https://openrouter.ai/keys',
    verifyUrl: 'https://openrouter.ai/api/v1/key',
    chatUrl: 'https://openrouter.ai/api/v1/chat/completions',
    chatModel: 'deepseek/deepseek-chat',
    keyPrefix: 'sk-or-',
    minLength: 20,
  },
];

export function getByokProvider(id: string): ByokProviderDef | undefined {
  return BYOK_PROVIDERS.find((p) => p.id === id);
}
