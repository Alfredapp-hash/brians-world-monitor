/**
 * First-viewport hero for everyday reader mode:
 * brand + one lead headline + why-it-matters + CTAs.
 * Hydrates from server insights when available; keeps deep tools one click away.
 */

import { BRAND } from '@/config/brand';
import {
  fetchServerInsights,
  getServerInsights,
  type ServerInsights,
} from '@/services/insights-loader';
import { sanitizeUrl } from '@/utils/sanitize';
import { clearChildren, h } from '@/utils/dom-utils';

function firstSentence(text: string, maxLen = 180): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const match = cleaned.match(/^(.+?[.!?])(?:\s|$)/);
  const sentence = match?.[1] ?? cleaned;
  if (sentence.length <= maxLen) return sentence;
  return `${sentence.slice(0, maxLen - 1).trimEnd()}…`;
}

/** Quiet covered/ignored wedge — lead story outlets only (no peer-story bleed). */
export function formatCoverageSpinCue(
  sourceCount: number,
  primarySource?: string | null,
): string | null {
  if (sourceCount <= 0) return null;
  const outlet = primarySource?.trim() || '';
  if (sourceCount >= 6) {
    return outlet
      ? `Wide coverage · ${sourceCount} outlets (incl. ${outlet}) — see who frames it differently`
      : `Wide coverage · ${sourceCount} outlets — see who frames it differently`;
  }
  if (sourceCount >= 3) {
    return outlet
      ? `Building coverage · ${outlet} + ${sourceCount - 1} more`
      : `Building coverage · ${sourceCount} outlets reporting`;
  }
  return outlet
    ? `Thin coverage so far · mainly ${outlet}`
    : 'Thin coverage so far — framing may still be forming';
}

export class ReaderHero {
  readonly element: HTMLElement;
  private leadEl: HTMLElement;
  private whyEl: HTMLElement;
  private metaEl: HTMLElement;
  private spinEl: HTMLElement;
  private storyCta: HTMLAnchorElement;
  private framingCta: HTMLButtonElement;
  private mapCta: HTMLButtonElement;
  private statusEl: HTMLElement;
  private onOpenCoverage: (() => void) | null = null;
  private onToggleMap: (() => void) | null = null;
  private onOpenStory: ((url: string) => void) | null = null;
  private panelObserver: MutationObserver | null = null;
  private hydratedFromServer = false;
  private retryBtn: HTMLButtonElement | null = null;

  constructor() {
    // `wm-plate` is the shared console surface (console-2026.css §4): the lead
    // story is an object on the grey stage, the same material as every panel.
    this.element = h('section', {
      className: 'reader-hero wm-plate',
      'aria-label': "Today's briefing",
    });

    // Brand-first: product name is the hero signal; lead is the one headline.
    const brand = h('p', { className: 'reader-hero__brand' }, BRAND.name);
    this.leadEl = h('h1', { className: 'reader-hero__lead is-loading' }, 'Loading the top story…');
    this.whyEl = h(
      'p',
      { className: 'reader-hero__why' },
      'A plain-language look at what matters right now — deeper analysis stays one click away.',
    );
    this.spinEl = h('p', { className: 'reader-hero__spin' }, '');
    this.spinEl.hidden = true;
    this.metaEl = h('p', { className: 'reader-hero__meta' }, '');
    this.statusEl = h('p', {
      className: 'reader-hero__status',
      role: 'status',
      'aria-live': 'polite',
    }, '');
    this.statusEl.hidden = true;

    this.storyCta = h('a', {
      className: 'reader-hero__cta reader-hero__cta--primary',
      href: '#',
    }, 'Read story') as HTMLAnchorElement;
    this.storyCta.hidden = true;

    this.framingCta = h(
      'button',
      { className: 'reader-hero__cta reader-hero__cta--ghost', type: 'button' },
      'How outlets frame this',
    ) as HTMLButtonElement;

    this.mapCta = h(
      'button',
      {
        className: 'reader-hero__cta reader-hero__cta--ghost',
        type: 'button',
        'aria-expanded': 'false',
      },
      'Show map',
    ) as HTMLButtonElement;

    const actions = h(
      'div',
      { className: 'reader-hero__actions' },
      this.storyCta,
      this.framingCta,
      this.mapCta,
    );
    // Composition: brand → lead → why → spin → CTAs → quiet meta (no kicker clutter)
    const copy = h(
      'div',
      { className: 'reader-hero__copy' },
      brand,
      this.leadEl,
      this.whyEl,
      this.spinEl,
      this.statusEl,
      actions,
      this.metaEl,
    );
    this.element.append(copy);

    this.framingCta.addEventListener('click', () => this.onOpenCoverage?.());
    this.mapCta.addEventListener('click', () => this.onToggleMap?.());
    this.storyCta.addEventListener('click', (e) => {
      const href = this.storyCta.getAttribute('href');
      if (!href || href === '#') {
        e.preventDefault();
        return;
      }
      if (this.onOpenStory) {
        e.preventDefault();
        this.onOpenStory(href);
      }
    });
  }

  setHandlers(handlers: {
    onOpenCoverage?: () => void;
    onToggleMap?: () => void;
    /** @deprecated use onToggleMap */
    onShowMap?: () => void;
    onOpenStory?: (url: string) => void;
  }): void {
    this.onOpenCoverage = handlers.onOpenCoverage ?? null;
    this.onToggleMap = handlers.onToggleMap ?? handlers.onShowMap ?? null;
    this.onOpenStory = handlers.onOpenStory ?? null;
  }

  /** Keep CTA label / aria in sync with map peek expand state. */
  setMapExpanded(expanded: boolean): void {
    this.mapCta.textContent = expanded ? 'Hide map' : 'Show map';
    this.mapCta.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  async hydrate(): Promise<void> {
    let data = getServerInsights();
    if (!data) {
      try {
        data = await fetchServerInsights();
      } catch {
        data = null;
      }
    }
    if (data) {
      this.renderInsights(data);
      return;
    }

    this.renderFallback();
    this.watchPanelsForLead();

    // Digest often lands after first paint — retry briefly so the hero
    // upgrades from "warming up" without a full reload.
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise((r) => setTimeout(r, 2500));
      if (this.hydratedFromServer) return;
      data = getServerInsights();
      if (!data) {
        try {
          data = await fetchServerInsights();
        } catch {
          data = null;
        }
      }
      if (data) {
        this.renderInsights(data);
        return;
      }
      // Client-side insights/politics often paint before the server digest.
      this.pullLeadFromPanels();
    }

    if (!this.hydratedFromServer && !this.leadEl.classList.contains('is-hydrated')) {
      this.renderError();
    }
  }

  /** When bootstrap insights are cold, mirror the first painted brief/story. */
  private watchPanelsForLead(): void {
    this.panelObserver?.disconnect();
    const root = document.getElementById('panelsGrid');
    if (!root) return;
    this.pullLeadFromPanels();
    this.panelObserver = new MutationObserver(() => {
      if (this.hydratedFromServer) {
        this.panelObserver?.disconnect();
        this.panelObserver = null;
        return;
      }
      this.pullLeadFromPanels();
    });
    this.panelObserver.observe(root, { childList: true, subtree: true, characterData: true });
  }

  private pullLeadFromPanels(): boolean {
    if (this.hydratedFromServer) return true;
    const insightsPanel = document.querySelector<HTMLElement>('#panelsGrid .panel[data-panel="insights"]');
    const title =
      insightsPanel?.querySelector('.insight-story-title')?.textContent?.trim() ||
      document.querySelector('#panelsGrid .panel[data-panel="politics"] .news-title, #panelsGrid .panel[data-panel="politics"] a.item-title, #panelsGrid .panel[data-panel="politics"] .feed-item-title')?.textContent?.trim() ||
      '';
    const brief =
      insightsPanel?.querySelector('.insights-brief-text')?.textContent?.trim() ||
      '';
    if (!title && !brief) return false;

    this.clearStatus();
    this.leadEl.classList.remove('is-loading');
    this.leadEl.classList.add('is-hydrated');
    this.leadEl.textContent = title || 'World brief';
    this.whyEl.textContent =
      firstSentence(brief) ||
      'Here is the story drawing the most multi-source attention right now.';
    this.metaEl.textContent = 'From today’s live brief';
    this.spinEl.hidden = true;
    this.spinEl.textContent = '';
    this.storyCta.hidden = true;
    this.storyCta.removeAttribute('href');
    this.markBriefCloserReady();
    return true;
  }

  private renderInsights(data: ServerInsights): void {
    this.hydratedFromServer = true;
    this.panelObserver?.disconnect();
    this.panelObserver = null;
    this.clearStatus();

    const lead = data.topStories[0];
    const briefLine = data.briefStoryLines?.[0]?.text;
    const why =
      briefLine ||
      firstSentence(data.worldBrief) ||
      'Here is the story drawing the most multi-source attention right now.';

    this.leadEl.classList.remove('is-loading');
    this.leadEl.classList.add('is-hydrated');
    this.leadEl.textContent = lead?.primaryTitle || 'World brief';
    this.whyEl.textContent = why;

    const sourceBits: string[] = [];
    if (lead?.primarySource) sourceBits.push(lead.primarySource);
    if (lead?.sourceCount && lead.sourceCount > 1) sourceBits.push(`${lead.sourceCount} outlets`);
    if (data.generatedAt) {
      const ageMin = Math.max(0, Math.round((Date.now() - new Date(data.generatedAt).getTime()) / 60_000));
      sourceBits.push(ageMin < 60 ? `Updated ${ageMin}m ago` : `Updated ${Math.round(ageMin / 60)}h ago`);
    }
    this.metaEl.textContent = sourceBits.join(' · ');

    const spin = formatCoverageSpinCue(lead?.sourceCount ?? 0, lead?.primarySource);
    if (spin) {
      this.spinEl.hidden = false;
      this.spinEl.textContent = spin;
    } else {
      this.spinEl.hidden = true;
      this.spinEl.textContent = '';
    }

    const safeUrl = lead?.primaryLink ? sanitizeUrl(lead.primaryLink) : '';
    if (safeUrl) {
      this.storyCta.hidden = false;
      this.storyCta.href = safeUrl;
      this.storyCta.target = '_blank';
      this.storyCta.rel = 'noopener noreferrer';
      this.storyCta.textContent = 'Read story';
    } else {
      this.storyCta.hidden = true;
    }
    this.markBriefCloserReady();
  }

  private renderFallback(): void {
    this.leadEl.classList.add('is-loading');
    this.leadEl.classList.remove('is-hydrated');
    this.leadEl.textContent = 'Your world brief is warming up';
    this.whyEl.textContent =
      'Headlines below update as feeds arrive. Open “How outlets frame this” when you want outlet-by-outlet coverage.';
    this.metaEl.textContent = '';
    this.spinEl.hidden = true;
    this.spinEl.textContent = '';
    this.storyCta.hidden = true;
    this.clearStatus();
  }

  private renderError(): void {
    this.leadEl.classList.remove('is-loading');
    this.leadEl.textContent = 'We couldn’t load today’s lead';
    this.whyEl.textContent = 'Check your connection, then try again — stories below may still update live.';
    this.metaEl.textContent = '';
    this.spinEl.hidden = true;
    this.statusEl.hidden = false;
    this.statusEl.replaceChildren();
    this.retryBtn = h(
      'button',
      { className: 'reader-hero__cta reader-hero__cta--ghost', type: 'button' },
      'Try again',
    ) as HTMLButtonElement;
    this.retryBtn.addEventListener('click', () => {
      void this.retryHydrate();
    });
    this.statusEl.append(this.retryBtn);
    this.markBriefCloserReady();
  }

  private async retryHydrate(): Promise<void> {
    this.clearStatus();
    this.renderFallback();
    this.hydratedFromServer = false;
    await this.hydrate();
  }

  private clearStatus(): void {
    this.statusEl.hidden = true;
    this.statusEl.replaceChildren();
    this.retryBtn = null;
  }

  /** Reveal the post-brief closer once the hero has real (or explicit error) copy. */
  private markBriefCloserReady(): void {
    const closer = document.getElementById('readerBriefDone');
    if (!closer) return;
    closer.hidden = false;
    closer.removeAttribute('aria-hidden');
    closer.classList.add('is-ready');
  }

  destroy(): void {
    this.panelObserver?.disconnect();
    this.panelObserver = null;
    clearChildren(this.element);
    this.onOpenCoverage = null;
    this.onToggleMap = null;
    this.onOpenStory = null;
    this.retryBtn = null;
  }
}
