/**
 * X (Twitter) share for flagged stories.
 *
 * Builds a concise, credible tweet from a story's Coverage Compare analysis
 * and opens the X web intent. Keeps within 280 chars, leads with the signal
 * (talking point / NCI), names the outlet count, and attributes the handle.
 */

export interface ShareStory {
  title: string;
  nci: number;
  tierLabel: string;
  talkingPoint: boolean;
  recurring: boolean;
  sourceCount: number;
  topPhrase?: string;
  phraseSources?: string[];
}

const HANDLE = '@JSAsmonitor';
const MAX = 275; // leave headroom under 280

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, Math.max(0, n - 1)).trimEnd() + '…';
}

/** Pure: compose the tweet text (no URL — X appends the share url separately). */
export function buildTweetText(story: ShareStory): string {
  const lead = story.talkingPoint
    ? '⚠ SYNCHRONIZED TALKING POINT'
    : story.recurring
      ? '↻ RECURRING NARRATIVE'
      : `📊 Manipulation indicators high (NCI ${story.nci}/100)`;

  const parts: string[] = [`${lead}`];
  parts.push(`"${truncate(story.title, 120)}"`);

  const detail: string[] = [`NCI ${story.nci}/100 (${story.tierLabel})`, `${story.sourceCount} outlets`];
  if (story.talkingPoint && story.topPhrase && story.phraseSources?.length) {
    detail.push(`identical phrasing "${truncate(story.topPhrase, 40)}" across ${story.phraseSources.length}`);
  }
  parts.push(detail.join(' · '));
  parts.push(`Spin filter via ${HANDLE}`);

  let text = parts.join('\n');
  if (text.length > MAX) {
    // Drop the detail line's phrase clause first, then hard-truncate.
    parts[2] = `NCI ${story.nci}/100 · ${story.sourceCount} outlets`;
    text = parts.join('\n');
    if (text.length > MAX) text = truncate(text, MAX);
  }
  return text;
}

/** Open the X web-intent compose window with the story pre-filled. */
export function shareStoryToX(story: ShareStory, shareUrl?: string): void {
  const text = buildTweetText(story);
  const params = new URLSearchParams({ text });
  if (shareUrl) params.set('url', shareUrl);
  const intent = `https://twitter.com/intent/tweet?${params.toString()}`;
  window.open(intent, '_blank', 'noopener,noreferrer,width=550,height=640');
}
