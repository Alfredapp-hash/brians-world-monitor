/**
 * Discord alert dispatch for Coverage Compare.
 *
 * When the engine flags a story — synchronized talking points, a high NCI
 * score, or a recurring narrative — it posts an embed to the user's Discord
 * server via an ordinary Discord webhook (Server Settings → Integrations →
 * Webhooks → New Webhook → Copy URL). The webhook URL is stored locally in
 * the browser; nothing is proxied through any third party.
 *
 * Dedupe: each story key alerts at most once per 24h window, tracked in
 * localStorage, so feed refreshes don't spam the channel.
 */

const WEBHOOK_KEY = 'bwm-discord-webhook';
const ENABLED_KEY = 'bwm-discord-alerts-enabled';
const SENT_KEY = 'bwm-discord-sent';
const SENT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SENT_ENTRIES = 500;
const MAX_ALERTS_PER_RUN = 3;

export interface AlertStory {
  key: string;
  title: string;
  nci: number;
  tierLabel: string;
  tierLevel: number;
  talkingPoint: boolean;
  recurring: boolean;
  sourceCount: number;
  flags: string[];
  phrases: Array<{ phrase: string; kind: string; sources: string[] }>;
}

export function getDiscordWebhook(): string {
  try { return localStorage.getItem(WEBHOOK_KEY) || ''; } catch { return ''; }
}

export function setDiscordWebhook(url: string): void {
  try {
    if (url.trim()) localStorage.setItem(WEBHOOK_KEY, url.trim());
    else localStorage.removeItem(WEBHOOK_KEY);
  } catch { /* storage unavailable */ }
}

export function getAlertsEnabled(): boolean {
  try { return localStorage.getItem(ENABLED_KEY) === 'true'; } catch { return false; }
}

export function setAlertsEnabled(enabled: boolean): void {
  try { localStorage.setItem(ENABLED_KEY, String(enabled)); } catch { /* ignore */ }
}

export function isValidWebhookUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:'
      && (u.hostname === 'discord.com' || u.hostname === 'discordapp.com')
      && u.pathname.startsWith('/api/webhooks/');
  } catch {
    return false;
  }
}

interface SentStore { [storyKey: string]: number }

function readSent(): SentStore {
  try { return JSON.parse(localStorage.getItem(SENT_KEY) || '{}') as SentStore; } catch { return {}; }
}

function writeSent(store: SentStore): void {
  try { localStorage.setItem(SENT_KEY, JSON.stringify(store)); } catch { /* ignore */ }
}

/** Pure: which stories should alert now, given the sent-history store. */
export function selectAlertable(
  stories: AlertStory[],
  sent: SentStore,
  now: number = Date.now(),
): AlertStory[] {
  return stories
    .filter(s => s.talkingPoint || s.recurring || s.nci >= 61)
    .filter(s => {
      const last = sent[s.key];
      return !last || now - last >= SENT_TTL_MS;
    })
    .sort((a, b) => Number(b.talkingPoint) - Number(a.talkingPoint) || b.nci - a.nci)
    .slice(0, MAX_ALERTS_PER_RUN);
}

const TIER_COLORS = [0x2ecc71, 0xf1c40f, 0xe67e22, 0xe74c3c, 0x9b1d1d];

/** Pure: build the Discord webhook payload for one story. */
export function buildAlertPayload(story: AlertStory): object {
  const kind = story.talkingPoint
    ? '⚠ TALKING POINT — synchronized phrasing detected'
    : story.recurring
      ? '↻ RECURRING NARRATIVE'
      : '📊 High manipulation indicators';

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: 'NCI Score', value: `**${story.nci}/100** — ${story.tierLabel}`, inline: true },
    { name: 'Outlets', value: String(story.sourceCount), inline: true },
  ];
  const coordinated = story.phrases.filter(p => p.kind === 'coordinated').slice(0, 3);
  if (coordinated.length) {
    fields.push({
      name: 'Synchronized phrasing',
      value: coordinated
        .map(p => `"${p.phrase}" — ${p.sources.slice(0, 5).join(', ')}`)
        .join('\n')
        .slice(0, 1000),
    });
  }
  if (story.flags.length) {
    fields.push({ name: 'Flags', value: story.flags.slice(0, 6).join(' · ').slice(0, 1000) });
  }

  return {
    username: "Brian's World Monitor",
    embeds: [{
      title: kind,
      description: `**${story.title}**`.slice(0, 2000),
      color: TIER_COLORS[story.tierLevel] ?? TIER_COLORS[2],
      fields,
      footer: { text: 'NCI measures indicators, not proof · Brian\'s World Monitor' },
      timestamp: new Date().toISOString(),
    }],
  };
}

/**
 * Send alerts for flagged stories. Fire-and-forget; failures are silent
 * (webhook down ≠ broken dashboard). Returns how many were sent.
 */
export async function dispatchDiscordAlerts(stories: AlertStory[]): Promise<number> {
  if (!getAlertsEnabled()) return 0;
  const webhook = getDiscordWebhook();
  if (!isValidWebhookUrl(webhook)) return 0;

  const now = Date.now();
  const sent = readSent();

  // Retention sweep + cap.
  for (const [k, t] of Object.entries(sent)) {
    if (now - t > SENT_TTL_MS * 7) delete sent[k];
  }
  const keys = Object.keys(sent);
  if (keys.length > MAX_SENT_ENTRIES) {
    keys.sort((a, b) => (sent[a] ?? 0) - (sent[b] ?? 0));
    for (const k of keys.slice(0, keys.length - MAX_SENT_ENTRIES)) delete sent[k];
  }

  const alertable = selectAlertable(stories, sent, now);
  let count = 0;
  for (const story of alertable) {
    try {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildAlertPayload(story)),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok || res.status === 204) {
        sent[story.key] = now;
        count++;
      }
      // Space out to respect Discord webhook rate limits.
      await new Promise(r => setTimeout(r, 600));
    } catch { /* silent */ }
  }
  if (count > 0) writeSent(sent);
  return count;
}

/** Send a test message so the user can verify their webhook. */
export async function sendTestAlert(webhookUrl: string): Promise<boolean> {
  if (!isValidWebhookUrl(webhookUrl)) return false;
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: "Brian's World Monitor",
        embeds: [{
          title: '✅ Webhook connected',
          description: 'Coverage Compare alerts will post here: talking-point detections, recurring narratives, and high-NCI stories.',
          color: 0xf0a832,
        }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok || res.status === 204;
  } catch {
    return false;
  }
}
