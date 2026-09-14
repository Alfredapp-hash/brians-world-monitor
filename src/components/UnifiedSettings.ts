import { CANONICAL_FEEDS, INTEL_SOURCES, SOURCE_REGION_MAP } from '@/config/feeds';
import {
  PANEL_CATEGORY_MAP,
  ALL_PANELS,
  VARIANT_DEFAULTS,
  getEffectivePanelConfig,
  getVariantPanelCategories,
  isPanelEntitled,
  FREE_MAX_PANELS,
  countFreePanelCapUsage,
  isFreePanelCapBlocking,
  isFreePanelCapCounted,
} from '@/config/panels';
import { isProUser } from '@/services/widget-store';
import { SITE_VARIANT } from '@/config/variant';
import { t } from '@/services/i18n';
import { createSettingsButton } from '@/components/settings-button';
import { confirmDialog } from '@/components/confirm-dialog';
import type { UnifiedSettingsTabId } from '@/components/settings-types';
import type { MapProvider } from '@/config/basemap';
import { escapeHtml } from '@/utils/sanitize';
import type { PanelConfig } from '@/types';
import { renderPreferences } from '@/services/preferences-content';
import { renderNotificationsSettings, type NotificationsSettingsResult } from '@/services/notifications-settings';
import { getAuthState } from '@/services/auth-state';
import { track } from '@/services/analytics';
import { hasFeature, onEntitlementChange, getEntitlementState } from '@/services/entitlements';
import { getSubscription, openBillingPortal, prereserveBillingPortalTab } from '@/services/billing';
import { createApiKey, listApiKeys, revokeApiKey, type ApiKeyInfo } from '@/services/api-keys';
import { listMcpClients, revokeMcpClient, fetchMcpQuota, type McpClientInfo, type McpQuota } from '@/services/mcp-clients';
import {
  acknowledgePlanLimitNotice,
  listCurrentPlanLimitNotices,
  type ApiPlanLimitNotice,
} from '@/services/api-plan-limit-notices';
import { setTrustedHtml, trustedHtml } from '@/utils/dom-utils';
import { STATUS, withAlpha } from '@/styles/tokens';
import {
  BYOK_PROVIDERS,
  FREE_INCLUDES,
  PRO_ADDS,
  getDonateUrl,
  type ByokProviderId,
} from '@/config/support';
import {
  clearByokKey,
  getByokKeyStates,
  saveByokKey,
  verifyByokKey,
} from '@/services/byok-keys';
import { isSupporter, getSupporterPlanName, onSupporterChange } from '@/services/supporter-status';
import { currentBriefingAllowance } from '@/services/briefing-gate';


function showToast(msg: string): void {
  document.querySelector('.toast-notification')?.remove();
  const el = document.createElement('div');
  el.className = 'toast-notification';
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('visible'));
  setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 300); }, 4000);
}

export interface UnifiedSettingsConfig {
  getPanelSettings: () => Record<string, PanelConfig>;
  savePanelSettings: (panels: Record<string, PanelConfig>) => void;
  getDisabledSources: () => Set<string>;
  toggleSource: (name: string) => void;
  setSourcesEnabled: (names: string[], enabled: boolean) => void;
  getAllSourceNames: () => string[];
  getLocalizedPanelName: (key: string, fallback: string) => string;
  resetLayout: () => void;
  isDesktopApp: boolean;
  onMapProviderChange?: (provider: MapProvider) => void;
}

type TabId = UnifiedSettingsTabId;

export class UnifiedSettings {
  private overlay: HTMLElement;
  private config: UnifiedSettingsConfig;
  private activeTab: TabId = 'settings';
  private activeSourceRegion = 'all';
  private sourceFilter = '';
  private activePanelCategory = 'all';
  private panelFilter = '';
  private escapeHandler: (e: KeyboardEvent) => void;
  private prefsCleanup: (() => void) | null = null;
  private notifCleanup: (() => void) | null = null;
  private pendingNotifs: NotificationsSettingsResult | null = null;
  private draftPanelSettings: Record<string, PanelConfig> = {};
  private panelsJustSaved = false;
  private savedTimeout: ReturnType<typeof setTimeout> | null = null;
  private confirmingClose = false;
  private apiKeys: ApiKeyInfo[] = [];
  private apiKeysLoading = false;
  private apiKeysError = '';
  private newlyCreatedKey: string | null = null;
  private planLimitNotices: ApiPlanLimitNotice[] = [];
  private planLimitNoticesLoading = false;
  // ---- Connected MCP clients tab (plan 2026-05-10-001 U9) ----
  private mcpClients: McpClientInfo[] = [];
  private mcpClientsLoading = false;
  private mcpClientsError = '';
  private mcpQuota: McpQuota | null = null;
  /** setInterval handle for quota auto-refresh; cleared on close()/destroy()/tab-switch. */
  private mcpQuotaTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeEntitlement: (() => void) | null = null;
  // Separate from the entitlement listener because `isSupporter()` also reads
  // the Dodo subscription, which lands on its own channel. Without this, a
  // user who subscribes (or whose snapshot arrives late) keeps reading
  // "You're on the free plan" on an open Pro tab.
  private unsubscribeSupporter: (() => void) | null = null;
  // Bounded "entitlement snapshot might still arrive" window. Starts false
  // on open() when currentState is null, flips true on first snapshot OR
  // after a fallback timeout so signed-in free users aren't stranded on an
  // empty placeholder when Convex is disabled / auth times out / init
  // silently fails (all of which leave currentState === null forever — see
  // src/services/entitlements.ts:41,47,58,78).
  private entitlementReady = false;
  private entitlementReadyTimer: ReturnType<typeof setTimeout> | null = null;
  // ---- Pro & Support tab ----
  // Per-provider status line for the BYOK rows. Holds only rendered prose —
  // never key material, so it is safe to keep in component state.
  private byokStatus: Partial<Record<ByokProviderId, { ok: boolean; message: string }>> = {};

  constructor(config: UnifiedSettingsConfig) {
    this.config = config;

    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay';
    this.overlay.id = 'unifiedSettingsModal';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-label', t('header.settings'));

    this.resetPanelDraft();

    this.escapeHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.close();
    };

    this.overlay.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;

      if (target === this.overlay) {
        this.close();
        return;
      }

      if (target.closest('.unified-settings-close')) {
        this.close();
        return;
      }

      if (target.closest('.upgrade-pro-cta')) {
        this.handleUpgradeClick();
        return;
      }

      // Signpost on the general settings tab — moves the user to the place
      // that explains Pro rather than starting a checkout from here.
      if (target.closest('.upgrade-pro-see-plans')) {
        this.switchTab('pro');
        this.overlay.querySelector<HTMLElement>('#us-tab-pro')?.focus();
        return;
      }

      if (target.closest('.upgrade-to-business-btn')) {
        // Self-serve Starter→Business upgrade (#4634): open the Dodo customer
        // portal, which surfaces the prorated plan change via the product
        // collection ("Allow Subscription Updates" enabled). Same hosted open
        // path as Manage Billing — Dodo owns payment + 3DS + proration; a failed
        // charge (prevent_change) leaves the customer on Starter.
        const reservedWin = prereserveBillingPortalTab();
        void openBillingPortal(reservedWin).then((result) => {
          if (result.outcome === 'no-customer') {
            showToast(
              'Subscription is managed outside Dodo. Email support@worldmonitor.app for help.',
            );
          }
        });
        return;
      }

      if (target.closest('.manage-billing-btn')) {
        // Pre-reserve the portal tab synchronously inside the click
        // handler so the popup blocker doesn't suppress the eventual
        // window.open inside openBillingPortal (which runs after an
        // await of the Convex action).
        const reservedWin = prereserveBillingPortalTab();
        void openBillingPortal(reservedWin).then((result) => {
          // NO_CUSTOMER: user is entitled but has no Dodo customer row
          // (comp grant, restore race, or post-purge cancellation). Send
          // them somewhere actionable instead of leaving them in a
          // generic Dodo portal that won't recognise them.
          if (result.outcome === 'no-customer') {
            showToast(
              'Subscription is managed outside Dodo. Email support@worldmonitor.app for help.',
            );
          }
        });
        return;
      }

      const planNoticeAck = target.closest<HTMLElement>('[data-plan-limit-ack]');
      if (planNoticeAck?.dataset.planLimitAck) {
        void this.handleAcknowledgePlanLimitNotice(planNoticeAck.dataset.planLimitAck);
        return;
      }

      const planNoticeCta = target.closest<HTMLElement>('[data-plan-limit-cta]');
      if (planNoticeCta?.dataset.planLimitCta) {
        this.handlePlanLimitNoticeCta(planNoticeCta.dataset.planLimitCta);
        return;
      }

      const byokSave = target.closest<HTMLElement>('[data-byok-save]');
      if (byokSave?.dataset.byokSave) {
        this.handleByokSave(byokSave.dataset.byokSave as ByokProviderId);
        return;
      }

      const byokTest = target.closest<HTMLElement>('[data-byok-test]');
      if (byokTest?.dataset.byokTest) {
        void this.handleByokTest(byokTest.dataset.byokTest as ByokProviderId);
        return;
      }

      const byokClear = target.closest<HTMLElement>('[data-byok-clear]');
      if (byokClear?.dataset.byokClear) {
        this.handleByokClear(byokClear.dataset.byokClear as ByokProviderId);
        return;
      }

      const tab = target.closest<HTMLElement>('.unified-settings-tab');
      if (tab?.dataset.tab) {
        this.switchTab(tab.dataset.tab as TabId);
        return;
      }

      const panelCatPill = target.closest<HTMLElement>('[data-panel-cat]');
      if (panelCatPill?.dataset.panelCat) {
        this.activePanelCategory = panelCatPill.dataset.panelCat;
        this.panelFilter = '';
        const searchInput = this.overlay.querySelector<HTMLInputElement>('.panels-search input');
        if (searchInput) searchInput.value = '';
        this.renderPanelCategoryPills();
        this.renderPanelsTab();
        return;
      }

      if (target.closest('.panels-reset-layout')) {
        this.config.resetLayout();
        return;
      }

      if (target.closest('.panels-save-layout')) {
        this.savePanelChanges();
        return;
      }

      const panelItem = target.closest<HTMLElement>('.panel-toggle-item');
      if (panelItem?.dataset.panel) {
        if (panelItem.dataset.proLocked) {
          window.open('/pro', '_blank', 'noopener,noreferrer');
          return;
        }
        this.toggleDraftPanel(panelItem.dataset.panel);
        return;
      }

      const sourceItem = target.closest<HTMLElement>('.source-toggle-item');
      if (sourceItem?.dataset.source) {
        this.config.toggleSource(sourceItem.dataset.source);
        this.renderSourcesGrid();
        this.updateSourcesCounter();
        return;
      }

      const pill = target.closest<HTMLElement>('.unified-settings-region-pill');
      if (pill?.dataset.region) {
        this.activeSourceRegion = pill.dataset.region;
        this.sourceFilter = '';
        const searchInput = this.overlay.querySelector<HTMLInputElement>('.sources-search input');
        if (searchInput) searchInput.value = '';
        this.renderRegionPills();
        this.renderSourcesGrid();
        this.updateSourcesCounter();
        return;
      }

      if (target.closest('.sources-select-all')) {
        const visible = this.getVisibleSourceNames();
        this.config.setSourcesEnabled(visible, true);
        this.renderSourcesGrid();
        this.updateSourcesCounter();
        return;
      }

      if (target.closest('.sources-select-none')) {
        const visible = this.getVisibleSourceNames();
        this.config.setSourcesEnabled(visible, false);
        this.renderSourcesGrid();
        this.updateSourcesCounter();
        return;
      }

      if (target.closest('.api-keys-create-btn')) {
        void this.handleCreateApiKey();
        return;
      }

      const revokeBtn = target.closest<HTMLElement>('.api-keys-revoke-btn');
      if (revokeBtn?.dataset.keyId) {
        void this.handleRevokeApiKey(revokeBtn.dataset.keyId);
        return;
      }

      if (target.closest('.api-keys-copy-btn')) {
        const key = this.newlyCreatedKey;
        if (key) {
          void navigator.clipboard.writeText(key).then(() => {
            const btn = this.overlay.querySelector<HTMLElement>('.api-keys-copy-btn');
            if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy'; }, 1500); }
          });
        }
        return;
      }

      const mcpRevokeBtn = target.closest<HTMLElement>('.mcp-clients-revoke-btn');
      if (mcpRevokeBtn?.dataset.tokenId) {
        void this.handleRevokeMcpClient(mcpRevokeBtn.dataset.tokenId);
        return;
      }

      const mcpCopyUrlBtn = target.closest<HTMLElement>('.mcp-clients-copy-url-btn');
      if (mcpCopyUrlBtn?.dataset.copyValue) {
        const value = mcpCopyUrlBtn.dataset.copyValue;
        // navigator.clipboard is async + can reject (insecure context, perms);
        // fall back gracefully so the button never silently no-ops.
        const showCopied = () => {
          mcpCopyUrlBtn.textContent = 'Copied!';
          setTimeout(() => { mcpCopyUrlBtn.textContent = 'Copy URL'; }, 1500);
        };
        if (navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(value).then(showCopied).catch(() => {
            mcpCopyUrlBtn.textContent = 'Copy failed';
            setTimeout(() => { mcpCopyUrlBtn.textContent = 'Copy URL'; }, 1500);
          });
        } else {
          mcpCopyUrlBtn.textContent = 'Copy unavailable';
          setTimeout(() => { mcpCopyUrlBtn.textContent = 'Copy URL'; }, 1500);
        }
        return;
      }
    });

    this.overlay.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      if (target.closest('.panels-search')) {
        this.panelFilter = target.value;
        this.renderPanelsTab();
      } else if (target.closest('.sources-search')) {
        this.sourceFilter = target.value;
        this.renderSourcesGrid();
        this.updateSourcesCounter();
      }
    });

    this.render();
    document.body.appendChild(this.overlay);
  }

  public open(tab?: TabId): void {
    if (tab) this.activeTab = tab;
    this.resetPanelDraft();
    // Seed entitlementReady BEFORE render() so the first paint of
    // renderUpgradeSection branches on the current snapshot state, not the
    // stale value left over from a previous open/close cycle.
    this.entitlementReady = getEntitlementState() !== null;
    this.render();
    this.overlay.classList.add('active');
    localStorage.setItem('wm-settings-open', '1');
    document.addEventListener('keydown', this.escapeHandler);
    track('settings-open', { tab: tab ?? 'default' });

    // Re-render API Keys panel when entitlements arrive (cold-load race:
    // hasFeature('apiAccess') returns false until the Convex subscription
    // delivers data, so a paid API Starter user sees the upgrade CTA briefly).
    this.unsubscribeEntitlement?.();
    this.unsubscribeEntitlement = onEntitlementChange(() => {
      this.entitlementReady = true;
      const panel = this.overlay.querySelector<HTMLElement>('[data-panel-id="api-keys"]');
      if (panel) {
        setTrustedHtml(panel, trustedHtml(this.renderApiKeysContent(), "legacy direct innerHTML migration"));
        // Re-attach CTA and input handlers for the refreshed content
        this.attachApiKeysHandlers();
        if (this.activeTab === 'api-keys' && getAuthState().user && hasFeature('apiAccess')) {
          void this.loadApiKeys();
        }
      }
      this.replaceUpgradeSection();
    });

    // Same cold-load race, Pro & Support tab: the status card and the brief
    // allowance are both derived from `isSupporter()`, so a late snapshot
    // would otherwise leave a paying user looking at an upgrade pitch. Only
    // fires when the answer actually flips, so it can't clobber a key the
    // user is mid-way through typing.
    this.unsubscribeSupporter?.();
    this.unsubscribeSupporter = onSupporterChange(() => {
      this.renderProSupportPanel();
      this.replaceUpgradeSection();
    });

    // Bounded fallback: the entitlement listener can legitimately never
    // fire (no VITE_CONVEX_URL, Convex API fails to load, waitForConvexAuth
    // times out at 10s, or init throws — see entitlements.ts:41,47,58,78).
    // Without this timer, the signed-in-free branch of renderUpgradeSection
    // would show a blank placeholder for the entire session. 12s > the 10s
    // auth timeout so the healthy-but-slow path lands on the real state;
    // any later path falls back to "Upgrade to Pro" with handleUpgradeClick
    // defensively re-checking isEntitled() at click time.
    if (this.entitlementReadyTimer) clearTimeout(this.entitlementReadyTimer);
    if (!this.entitlementReady) {
      this.entitlementReadyTimer = setTimeout(() => {
        this.entitlementReadyTimer = null;
        if (this.entitlementReady) return;
        this.entitlementReady = true;
        this.replaceUpgradeSection();
      }, 12_000);
    }
  }

  /**
   * Swap the .upgrade-pro-section wrapper in place. Click handlers are
   * delegated at overlay level, so replacing the node needs no rebind.
   */
  private replaceUpgradeSection(): void {
    const upgradeSection = this.overlay.querySelector('.upgrade-pro-section');
    if (!upgradeSection) return;
    const fresh = document.createElement('template');
    setTrustedHtml(fresh, trustedHtml(this.renderUpgradeSection().trim(), "legacy direct innerHTML migration"));
    const next = fresh.content.firstElementChild;
    if (next) upgradeSection.replaceWith(next);
  }

  public close(): void {
    // Unsaved panel changes → confirm before tearing down. The confirm is a
    // non-blocking in-app dialog (#4559): close() stays synchronous (8 callers)
    // and defers teardown to the user's choice instead of a blocking confirm().
    if (this.hasPendingPanelChanges()) {
      if (this.confirmingClose) return; // a confirm is already on screen
      this.confirmingClose = true;
      void confirmDialog({ message: t('header.unsavedChanges') }).then((discard) => {
        this.confirmingClose = false;
        if (discard) this.teardownSettings();
      });
      return;
    }
    this.teardownSettings();
  }

  private teardownSettings(): void {
    this.overlay.classList.remove('active');
    this.prefsCleanup?.();
    this.prefsCleanup = null;
    this.notifCleanup?.();
    this.notifCleanup = null;
    this.pendingNotifs = null;
    this.unsubscribeEntitlement?.();
    this.unsubscribeEntitlement = null;
    this.unsubscribeSupporter?.();
    this.unsubscribeSupporter = null;
    if (this.entitlementReadyTimer) {
      clearTimeout(this.entitlementReadyTimer);
      this.entitlementReadyTimer = null;
    }
    this.stopMcpQuotaPolling();
    this.resetPanelDraft();
    localStorage.removeItem('wm-settings-open');
    document.removeEventListener('keydown', this.escapeHandler);
  }

  public refreshPanelToggles(): void {
    this.resetPanelDraft();
    if (this.activeTab === 'panels') this.renderPanelsTab();
  }

  public getButton(): HTMLButtonElement {
    return createSettingsButton(() => this.open());
  }

  public destroy(): void {
    if (this.savedTimeout) clearTimeout(this.savedTimeout);
    this.prefsCleanup?.();
    this.prefsCleanup = null;
    this.notifCleanup?.();
    this.notifCleanup = null;
    this.pendingNotifs = null;
    this.unsubscribeEntitlement?.();
    this.unsubscribeEntitlement = null;
    this.unsubscribeSupporter?.();
    this.unsubscribeSupporter = null;
    // Mirror close() — without this, a destroy() during the 12s fallback
    // window leaves the timer live; it fires after teardown and calls
    // replaceUpgradeSection() against a detached overlay (no-op via the
    // querySelector early return, but a stray async callback + DOM
    // reference alive longer than intended).
    if (this.entitlementReadyTimer) {
      clearTimeout(this.entitlementReadyTimer);
      this.entitlementReadyTimer = null;
    }
    this.stopMcpQuotaPolling();
    document.removeEventListener('keydown', this.escapeHandler);
    this.overlay.remove();
  }

  private render(): void {
    this.prefsCleanup?.();
    this.prefsCleanup = null;
    this.notifCleanup?.();
    this.notifCleanup = null;
    this.pendingNotifs = null;

    const tabClass = (id: TabId) => `unified-settings-tab${this.activeTab === id ? ' active' : ''}`;
    const isSignedIn = !this.config.isDesktopApp && (getAuthState().user !== null);
    const prefs = renderPreferences({
      isDesktopApp: this.config.isDesktopApp,
      onMapProviderChange: this.config.onMapProviderChange,
      isSignedIn,
    });
    const showNotificationsTab = !this.config.isDesktopApp;
    const notifs = showNotificationsTab
      ? renderNotificationsSettings({ isSignedIn })
      : null;

    setTrustedHtml(this.overlay, trustedHtml(`
      <div class="modal unified-settings-modal">
        <div class="modal-header">
          <span class="modal-title">${t('header.settings')}</span>
          <button class="modal-close unified-settings-close" aria-label="Close">\u00d7</button>
        </div>
        <div class="unified-settings-tabs" role="tablist" aria-label="Settings">
          <button class="${tabClass('settings')}" data-tab="settings" role="tab" aria-selected="${this.activeTab === 'settings'}" id="us-tab-settings" aria-controls="us-tab-panel-settings">${t('header.tabSettings')}</button>
          <button class="${tabClass('panels')}" data-tab="panels" role="tab" aria-selected="${this.activeTab === 'panels'}" id="us-tab-panels" aria-controls="us-tab-panel-panels">${t('header.tabPanels')}</button>
          <button class="${tabClass('sources')}" data-tab="sources" role="tab" aria-selected="${this.activeTab === 'sources'}" id="us-tab-sources" aria-controls="us-tab-panel-sources">${t('header.tabSources')}</button>
          ${showNotificationsTab ? `<button class="${tabClass('notifications')}" data-tab="notifications" role="tab" aria-selected="${this.activeTab === 'notifications'}" id="us-tab-notifications" aria-controls="us-tab-panel-notifications">${t('header.tabNotifications')}</button>` : ''}
          <button class="${tabClass('api-keys')}" data-tab="api-keys" role="tab" aria-selected="${this.activeTab === 'api-keys'}" id="us-tab-api-keys" aria-controls="us-tab-panel-api-keys">API Keys <span class="panel-pro-badge">PRO</span></button>
          ${hasFeature('mcpAccess') ? `<button class="${tabClass('mcp-clients')}" data-tab="mcp-clients" role="tab" aria-selected="${this.activeTab === 'mcp-clients'}" id="us-tab-mcp-clients" aria-controls="us-tab-panel-mcp-clients">MCP Clients <span class="panel-pro-badge">PRO</span></button>` : ''}
          <button class="${tabClass('pro')}" data-tab="pro" role="tab" aria-selected="${this.activeTab === 'pro'}" id="us-tab-pro" aria-controls="us-tab-panel-pro">Pro &amp; Support</button>
        </div>
        <div class="unified-settings-tab-panel${this.activeTab === 'settings' ? ' active' : ''}" data-panel-id="settings" id="us-tab-panel-settings" role="tabpanel" aria-labelledby="us-tab-settings">
          ${prefs.html}
          ${this.renderUpgradeSection()}
        </div>
        <div class="unified-settings-tab-panel${this.activeTab === 'panels' ? ' active' : ''}" data-panel-id="panels" id="us-tab-panel-panels" role="tabpanel" aria-labelledby="us-tab-panels">
          <div class="unified-settings-region-wrapper">
            <div class="unified-settings-region-bar" id="usPanelCatBar"></div>
          </div>
          <div class="panels-search">
            <input type="text" placeholder="${t('header.filterPanels')}" value="${escapeHtml(this.panelFilter)}" />
          </div>
          <div class="panel-toggle-grid" id="usPanelToggles"></div>
          <div class="panels-footer">
            <span class="panels-status" id="usPanelsStatus" aria-live="polite"></span>
            <button class="panels-save-layout">${t('modals.story.save')}</button>
            <button class="panels-reset-layout" title="${t('header.resetLayoutTooltip')}" aria-label="${t('header.resetLayoutTooltip')}">${t('header.resetLayout')}</button>
          </div>
        </div>
        <div class="unified-settings-tab-panel${this.activeTab === 'sources' ? ' active' : ''}" data-panel-id="sources" id="us-tab-panel-sources" role="tabpanel" aria-labelledby="us-tab-sources">
          <div class="unified-settings-region-wrapper">
            <div class="unified-settings-region-bar" id="usRegionBar"></div>
          </div>
          <div class="sources-search">
            <input type="text" placeholder="${t('header.filterSources')}" value="${escapeHtml(this.sourceFilter)}" />
          </div>
          <div class="sources-toggle-grid" id="usSourceToggles"></div>
          <div class="sources-footer">
            <span class="sources-counter" id="usSourcesCounter"></span>
            <button class="sources-select-all">${t('common.selectAll')}</button>
            <button class="sources-select-none">${t('common.selectNone')}</button>
          </div>
        </div>
        ${notifs ? `
        <div class="unified-settings-tab-panel${this.activeTab === 'notifications' ? ' active' : ''}" data-panel-id="notifications" id="us-tab-panel-notifications" role="tabpanel" aria-labelledby="us-tab-notifications">
          ${notifs.html}
        </div>
        ` : ''}
        <div class="unified-settings-tab-panel${this.activeTab === 'api-keys' ? ' active' : ''}" data-panel-id="api-keys" id="us-tab-panel-api-keys" role="tabpanel" aria-labelledby="us-tab-api-keys">
          ${this.renderApiKeysContent()}
        </div>
        ${hasFeature('mcpAccess') ? `
        <div class="unified-settings-tab-panel${this.activeTab === 'mcp-clients' ? ' active' : ''}" data-panel-id="mcp-clients" id="us-tab-panel-mcp-clients" role="tabpanel" aria-labelledby="us-tab-mcp-clients">
          ${this.renderMcpClientsContent()}
        </div>
        ` : ''}
        <div class="unified-settings-tab-panel${this.activeTab === 'pro' ? ' active' : ''}" data-panel-id="pro" id="us-tab-panel-pro" role="tabpanel" aria-labelledby="us-tab-pro">
          ${this.renderProSupportContent()}
        </div>
      </div>
    `, "legacy direct innerHTML migration"));

    const settingsPanel = this.overlay.querySelector('#us-tab-panel-settings');
    if (settingsPanel) {
      this.prefsCleanup = prefs.attach(settingsPanel as HTMLElement);
    }

    // Defer notifications attach until the tab is first activated —
    // otherwise Pro users pay a getChannelsData() fetch on every modal
    // open even if they never visit this tab.
    this.pendingNotifs = notifs;
    if (this.activeTab === 'notifications') this.attachNotificationsTab();

    const closeBtn = this.overlay.querySelector<HTMLButtonElement>('.unified-settings-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.close();
      });
    }

    this.renderPanelCategoryPills();
    this.renderPanelsTab();
    this.renderRegionPills();
    this.renderSourcesGrid();
    this.updateSourcesCounter();

    this.attachApiKeysHandlers();
    this.attachByokHandlers();
    if (this.activeTab === 'api-keys' || this.activeTab === 'mcp-clients') {
      void this.loadPlanLimitNotices();
    }
    if (this.activeTab === 'api-keys' && getAuthState().user && hasFeature('apiAccess')) {
      void this.loadApiKeys();
    }
    if (this.activeTab === 'mcp-clients' && getAuthState().user && hasFeature('mcpAccess')) {
      void this.loadMcpClients();
      this.startMcpQuotaPolling();
    }
  }

  private switchTab(tab: TabId): void {
    this.activeTab = tab;

    this.overlay.querySelectorAll('.unified-settings-tab').forEach(el => {
      const isActive = (el as HTMLElement).dataset.tab === tab;
      el.classList.toggle('active', isActive);
      el.setAttribute('aria-selected', String(isActive));
    });

    this.overlay.querySelectorAll('.unified-settings-tab-panel').forEach(el => {
      el.classList.toggle('active', (el as HTMLElement).dataset.panelId === tab);
    });

    if (tab === 'api-keys' && getAuthState().user && hasFeature('apiAccess')) {
      void this.loadPlanLimitNotices();
      void this.loadApiKeys();
    }

    if (tab === 'mcp-clients' && getAuthState().user && hasFeature('mcpAccess')) {
      void this.loadPlanLimitNotices();
      void this.loadMcpClients();
      this.startMcpQuotaPolling();
    } else {
      // Stop polling when switching away — no need to keep the timer running
      // for a hidden tab.
      this.stopMcpQuotaPolling();
    }

    if (tab === 'notifications') {
      this.attachNotificationsTab();
    }

    // Re-render on entry so the brief allowance and stored-key states are
    // current — both can change while the modal sits open.
    if (tab === 'pro') {
      this.renderProSupportPanel();
    }
  }

  private attachNotificationsTab(): void {
    if (this.notifCleanup || !this.pendingNotifs) return;
    const notifPanel = this.overlay.querySelector('#us-tab-panel-notifications');
    if (notifPanel) {
      this.notifCleanup = this.pendingNotifs.attach(notifPanel as HTMLElement);
    }
  }

  // ───────────────────────── Pro & Support tab ─────────────────────────
  //
  // Three jobs, in this order of importance to the user:
  //   1. Tell them plainly that the dashboard they are already using is the
  //      whole product and costs nothing.
  //   2. Show what Pro genuinely adds, and where their free AI allowance
  //      stands today.
  //   3. Let them bring their own provider key, or donate, without either
  //      one being a prerequisite for the other.
  //
  // No lock icons, no blurred previews, no countdown pressure.

  private renderProSupportContent(): string {
    const supporter = isSupporter();
    const allowance = currentBriefingAllowance();
    const donateUrl = getDonateUrl();

    const freeList = FREE_INCLUDES
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join('');
    const proList = PRO_ADDS
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join('');

    const allowanceLine = allowance.unlimited
      ? 'Unlimited — you\u2019re running briefs on your own provider key.'
      : `${allowance.used} of ${allowance.cap} used today \u00b7 resets at ${escapeHtml(
          new Date(allowance.resetsAtMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        )}`;
    const allowancePct = allowance.unlimited
      ? 100
      : Math.min(100, Math.round((allowance.used / Math.max(1, allowance.cap)) * 100));

    // The status card is deliberately a thank-you for subscribers and a plain
    // offer for everyone else. `isSupporter()` — not the fork's always-true
    // `isEntitled()` — decides which, so free users see a real offer and
    // paying users are never re-pitched a checkout they already completed.
    const statusCard = supporter
      ? `
        <div class="wm-support-status wm-support-status--active">
          <div class="wm-support-status-head">
            <span class="wm-support-dot" aria-hidden="true"></span>
            <strong>${escapeHtml(getSupporterPlanName())}</strong>
          </div>
          <p class="wm-support-status-desc">Thank you \u2014 your subscription is what pays for the AI budget and the data feeds everyone else uses for free.</p>
          <button class="btn manage-billing-btn">Manage billing</button>
        </div>`
      : `
        <div class="wm-support-status">
          <div class="wm-support-status-head"><strong>You\u2019re on the free plan</strong></div>
          <p class="wm-support-status-desc">Which is a complete plan. Pro exists for people who want more AI on tap \u2014 not to unlock what you already have.</p>
          <div class="wm-support-status-actions">
            <button class="btn btn-primary upgrade-pro-cta">Upgrade to Pro</button>
            <a class="wm-support-link" href="/pro" target="_blank" rel="noopener">Compare plans and pricing \u2192</a>
          </div>
        </div>`;

    // Resolved once: each lookup deobfuscates and re-validates a stored key,
    // so calling it per row would decrypt every key N times per render.
    const keyStates = getByokKeyStates();
    const byokRows = BYOK_PROVIDERS.map((def) => {
      const state = keyStates.find((s) => s.provider === def.id);
      const status = this.byokStatus[def.id];
      const inputId = `us-byok-${def.id}`;
      const statusText = state?.present
        ? `Saved \u00b7 ${escapeHtml(state.masked)}`
        : 'Not set';
      return `
        <div class="wm-byok-row" data-byok-row="${def.id}">
          <div class="wm-byok-row-head">
            <label class="wm-byok-label" for="${inputId}">${escapeHtml(def.label)}</label>
            <span class="wm-byok-state${state?.present ? ' wm-byok-state--set' : ''}">${statusText}</span>
          </div>
          <div class="wm-byok-controls">
            <input type="password" id="${inputId}" class="wm-byok-input" data-byok-input="${def.id}"
                   autocomplete="off" spellcheck="false"
                   placeholder="${escapeHtml(state?.present ? 'Replace stored key' : `${def.keyPrefix}\u2026`)}"
                   aria-describedby="${inputId}-hint" />
            <button class="btn btn-primary wm-byok-btn" data-byok-save="${def.id}">Save</button>
            <button class="btn wm-byok-btn" data-byok-test="${def.id}">Test</button>
            ${state?.present ? `<button class="btn wm-byok-btn wm-byok-btn--quiet" data-byok-clear="${def.id}">Remove</button>` : ''}
          </div>
          <p class="wm-byok-hint" id="${inputId}-hint">
            ${escapeHtml(def.hint)}
            <a href="${escapeHtml(def.signupUrl)}" target="_blank" rel="noopener">Get a key \u2192</a>
          </p>
          <p class="wm-byok-status${status ? (status.ok ? ' wm-byok-status--ok' : ' wm-byok-status--warn') : ''}"
             data-byok-status="${def.id}" role="status" aria-live="polite">${status ? escapeHtml(status.message) : ''}</p>
        </div>`;
    }).join('');

    return `
      <div class="wm-support-tab">
        <section class="wm-support-intro">
          <h3 class="wm-support-h">The dashboard is free. All of it.</h3>
          <p>Every layer, the globe, God\u2019s Eye, reader mode, the public cameras, every panel and all the live feeds. No watermark, no locked map, no trial clock. Pro and donations are how the bill gets paid \u2014 they are not how you get access.</p>
        </section>

        ${statusCard}

        <section class="wm-support-compare">
          <div class="wm-support-col">
            <h4 class="wm-support-col-h">In the free app</h4>
            <ul class="wm-support-list wm-support-list--free">${freeList}</ul>
          </div>
          <div class="wm-support-col">
            <h4 class="wm-support-col-h">Pro adds</h4>
            <ul class="wm-support-list wm-support-list--pro">${proList}</ul>
          </div>
        </section>

        <section class="wm-support-section">
          <h4 class="wm-support-section-h">Today\u2019s AI brief allowance</h4>
          <p class="wm-support-section-desc">The world brief is always there for everyone. This counts only the times you ask us to regenerate one from scratch, which spends real tokens on our account.</p>
          <div class="wm-allowance">
            <div class="wm-allowance-bar" role="progressbar" aria-label="Fresh briefs used today"
                 aria-valuemin="0" aria-valuemax="${allowance.unlimited ? 100 : allowance.cap}"
                 aria-valuenow="${allowance.unlimited ? 0 : allowance.used}">
              <span class="wm-allowance-fill${allowance.unlimited ? ' wm-allowance-fill--unlimited' : ''}" style="width:${allowancePct}%"></span>
            </div>
            <p class="wm-allowance-line">${allowanceLine}</p>
          </div>
        </section>

        <section class="wm-support-section">
          <h4 class="wm-support-section-h">Bring your own AI key</h4>
          <p class="wm-support-section-desc">Point the briefing engine at your own provider account and it stops counting against any allowance \u2014 free plan included. Keys are stored in this browser only: they are never sent to our servers, never written to logs, and never leave the page except to the provider you chose.</p>
          ${byokRows}
        </section>

        <section class="wm-support-section wm-support-donate">
          <h4 class="wm-support-section-h">Support the project</h4>
          <p class="wm-support-section-desc">If the dashboard is useful to you and a subscription isn\u2019t what you want, a one-off contribution covers data bills just as well. Entirely optional, and nothing in the app changes either way.</p>
          <a class="btn wm-donate-btn" href="${escapeHtml(donateUrl)}" target="_blank" rel="noopener">Make a donation</a>
        </section>
      </div>`;
  }

  /** Re-render just the Pro tab body (after a BYOK save/test/clear). */
  private renderProSupportPanel(): void {
    const panel = this.overlay.querySelector<HTMLElement>('#us-tab-panel-pro');
    if (!panel) return;
    setTrustedHtml(panel, trustedHtml(this.renderProSupportContent(), 'settings pro tab re-render'));
    this.attachByokHandlers();
  }

  private attachByokHandlers(): void {
    // Enter submits the row the caret is in.
    this.overlay.querySelectorAll<HTMLInputElement>('[data-byok-input]').forEach((input) => {
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const provider = input.dataset.byokInput as ByokProviderId | undefined;
        if (provider) this.handleByokSave(provider);
      });
    });
  }

  private readByokInput(provider: ByokProviderId): string {
    const input = this.overlay.querySelector<HTMLInputElement>(`[data-byok-input="${provider}"]`);
    return input?.value ?? '';
  }

  private setByokStatus(provider: ByokProviderId, ok: boolean, message: string): void {
    this.byokStatus[provider] = { ok, message };
    // Update in place when possible so the user's caret/scroll survives.
    const el = this.overlay.querySelector<HTMLElement>(`[data-byok-status="${provider}"]`);
    if (el) {
      el.textContent = message;
      el.classList.toggle('wm-byok-status--ok', ok);
      el.classList.toggle('wm-byok-status--warn', !ok);
    }
  }

  private handleByokSave(provider: ByokProviderId): void {
    const raw = this.readByokInput(provider);
    const result = saveByokKey(provider, raw);
    if (!result.valid) {
      // Validation failures are the common case (empty paste, wrong prefix).
      // Report them in the row, leave the field alone, save nothing.
      this.setByokStatus(provider, false, result.hint ?? 'That key could not be saved.');
      return;
    }
    this.byokStatus[provider] = { ok: true, message: 'Key saved in this browser. Briefs will use it from now on.' };
    this.renderProSupportPanel();
  }

  private async handleByokTest(provider: ByokProviderId): Promise<void> {
    // Test whatever is in the box; fall back to the stored key so "Test"
    // works on its own after a reload.
    const typed = this.readByokInput(provider).trim();
    const stored = getByokKeyStates().find((s) => s.provider === provider)?.present ?? false;
    if (!typed && !stored) {
      this.setByokStatus(provider, false, 'Paste a key first, or save one.');
      return;
    }
    this.setByokStatus(provider, true, 'Checking with the provider\u2026');
    const { getByokKey } = await import('@/services/byok-keys');
    const candidate = typed || getByokKey(provider) || '';
    const result = await verifyByokKey(provider, candidate);
    this.setByokStatus(provider, result.ok, result.message);
  }

  private handleByokClear(provider: ByokProviderId): void {
    clearByokKey(provider);
    this.byokStatus[provider] = { ok: true, message: 'Key removed from this browser.' };
    this.renderProSupportPanel();
  }

  private renderUpgradeSection(): string {
    // Signed-in user whose Convex entitlement snapshot has not arrived yet
    // AND whose bounded-wait window has not expired. Rendering "Upgrade to
    // Pro" in this window is how paying users click through to
    // /api/create-checkout and hit 409 duplicate_subscription — same race
    // as the 2026-04-17/18 panel-overlay incident fixed in panel-gating.ts,
    // different surface. The entitlementReady flag is flipped either by
    // the onEntitlementChange listener (healthy path) or by a 12s fallback
    // timer in open() (Convex-disabled / auth-timeout / init-fail paths
    // where currentState would otherwise stay null forever and strand a
    // signed-in free user on an empty placeholder).
    if (!this.entitlementReady && getAuthState().user && getEntitlementState() === null) {
      // `hidden` so the browser's default `[hidden] { display: none }`
      // suppresses the empty card — without it, the base `.upgrade-pro-
      // section` styles (margin + padding + border + surface background
      // in main.css:22833) paint a visibly empty bordered box during the
      // Convex cold-load window, which is exactly the state we're trying
      // to clean up. Element stays queryable for the replaceWith swap in
      // open().
      return '<div class="upgrade-pro-section upgrade-pro-loading" hidden aria-hidden="true"></div>';
    }
    // `isSupporter()`, not `isEntitled()`. In this fork `isEntitled()` is
    // hard-wired true (every panel is unlocked for everyone by design), so
    // keying the billing card off it showed an anonymous first-time visitor
    // an active "Pro — Manage Billing" card and sent them to a Dodo portal
    // that had never heard of them. `isSupporter()` reads the actual
    // subscription/role facts, so this card now only appears for people who
    // really are paying.
    if (isSupporter()) {
      const sub = getSubscription();
      const planName = sub?.displayName ?? 'Pro';
      const statusBase = sub?.status === 'active' ? STATUS.good : sub?.status === 'on_hold' ? STATUS.watch : STATUS.alert;
      const statusColor = statusBase;
      const statusBorderColor = withAlpha(statusBase, 0.2);
      const statusBgColor = withAlpha(statusBase, 0.04);

      let statusLine = '';
      if (sub?.currentPeriodEnd) {
        const dateStr = new Date(sub.currentPeriodEnd).toLocaleDateString();
        if (sub.status === 'active') {
          statusLine = `Renews: ${dateStr}`;
        } else if (sub.status === 'on_hold') {
          statusLine = 'On hold -- please update payment method';
        } else if (sub.status === 'cancelled') {
          statusLine = `Cancelled -- access until ${dateStr}`;
        } else if (sub.status === 'expired') {
          statusLine = 'Expired';
        }
      }

      return `
        <div class="upgrade-pro-section upgrade-pro-active" style="margin-top:16px;padding:14px 16px;border:1px solid ${statusBorderColor};border-radius:6px;background:${statusBgColor};">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:${statusLine ? '8' : '0'}px;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColor};flex-shrink:0;"></span>
            <span style="color:${statusColor};font-weight:600;font-size:13px;">${escapeHtml(planName)}</span>
          </div>
          ${statusLine ? `<div class="upgrade-pro-status-line">${escapeHtml(statusLine)}</div>` : ''}
          ${sub?.planKey === 'api_starter' ? `<button class="upgrade-to-business-btn" style="margin-right:8px;">Upgrade to Business</button>` : ''}
          <button class="manage-billing-btn">Manage Billing</button>
        </div>
      `;
    }

    // Fallback branch: 12s timer fired but Convex never delivered a
    // snapshot. entitlementReady===true does NOT prove the user is free —
    // it just means we've given up waiting. A paying user whose auth/query
    // is simply very slow (beyond the 10s waitForConvexAuth timeout) would
    // otherwise race into in-modal startCheckout here and reproduce the
    // 409 duplicate_subscription cascade this PR exists to eliminate.
    // Render the card with a plain anchor to /pro instead: /pro has its
    // own entitlement gating on fresh page load, and navigating away is a
    // no-op for backend subscription state. The `upgrade-pro-cta-link`
    // class does NOT match the `.upgrade-pro-cta` delegated click handler
    // (line ~95), so the browser handles the navigation natively.
    if (getAuthState().user && getEntitlementState() === null) {
      return `
        <div class="upgrade-pro-section upgrade-pro-fallback">
          <div class="upgrade-pro-title">You\u2019re on the free plan</div>
          <div class="upgrade-pro-desc">Every panel, layer and map mode is already unlocked. Pro adds more AI briefing and developer access.</div>
          <a class="upgrade-pro-cta-link" href="/pro" target="_blank" rel="noopener">Compare plans \u2192</a>
        </div>
      `;
    }

    // Free plan, snapshot settled. Deliberately NOT a second checkout
    // button: the full story and the one upgrade action live on the
    // Pro & Support tab, so this is a signpost, not a pitch. The old copy
    // here ("Unlock all panels, AI analysis...") described a paywall this
    // fork does not have and made the free app sound broken.
    return `
      <div class="upgrade-pro-section upgrade-pro-free">
        <div class="upgrade-pro-title">You\u2019re on the free plan</div>
        <div class="upgrade-pro-desc">Everything on this dashboard is unlocked. Pro adds more AI briefing, your own provider keys, and developer access.</div>
        <button class="upgrade-pro-see-plans">See what Pro adds</button>
      </div>
    `;
  }

  private handleUpgradeClick(): void {
    // Defense in depth: the upgrade CTA can only be clicked when either (a)
    // the user is genuinely free-tier, or (b) the 12s fallback timer fired
    // before the Convex snapshot arrived. In (b), the snapshot might land
    // AFTER the timer but BEFORE the click — re-check here so a
    // late-arriving "you're a paying user" state routes to the billing
    // portal instead of triggering /api/create-checkout against an active
    // subscription (which would 409 and re-enter the duplicate_subscription
    // → getCustomerPortalUrl cascade).
    //
    // Must be isSupporter(), not isEntitled(): the latter is always true in
    // this fork, which would send every free user who clicks "Upgrade" to a
    // customer portal that has no record of them instead of to checkout.
    if (isSupporter()) {
      this.close();
      const reservedWin = prereserveBillingPortalTab();
      void openBillingPortal(reservedWin).then((result) => {
        if (result.outcome === 'no-customer') {
          showToast(
            'Subscription is managed outside Dodo. Email support@worldmonitor.app for help.',
          );
        }
      });
      return;
    }
    this.close();
    if (this.config.isDesktopApp) {
      window.open('https://brians-world-monitor.vercel.app/pro', '_blank', 'noopener,noreferrer');
      return;
    }
    import('@/services/checkout').then(m => import('@/config/products').then(p => m.startCheckout(p.DEFAULT_UPGRADE_PRODUCT))).catch(() => {
      window.open('https://brians-world-monitor.vercel.app/pro', '_blank', 'noopener,noreferrer');
    });
  }

  private categoryMatchesVariant(catDef: { variants?: string[] }): boolean {
    return !catDef.variants || catDef.variants.includes(SITE_VARIANT);
  }

  private getAvailablePanelCategories(): Array<{ key: string; label: string }> {
    return [
      { key: 'all', label: t('header.sourceRegionAll') },
      ...getVariantPanelCategories(this.config.getPanelSettings(), SITE_VARIANT)
        .map(({ key, labelKey }) => ({ key, label: t(labelKey) })),
    ];
  }

  private getVisiblePanelEntries(): Array<[string, PanelConfig]> {
    const panelSettings = this.draftPanelSettings;
    let entries = Object.entries(panelSettings)
      .filter(([key]) => key !== 'runtime-config' || this.config.isDesktopApp)
      .filter(([key]) => !key.startsWith('cw-'));

    if (this.activePanelCategory !== 'all') {
      const catDef = PANEL_CATEGORY_MAP[this.activePanelCategory];
      if (catDef) {
        if (!this.categoryMatchesVariant(catDef)) {
          return [];
        }
        const allowed = new Set(catDef.panelKeys);
        entries = entries.filter(([key]) => allowed.has(key));
      }
    }

    if (this.panelFilter) {
      const lower = this.panelFilter.toLowerCase();
      entries = entries.filter(([key, panel]) =>
        key.toLowerCase().includes(lower) ||
        panel.name.toLowerCase().includes(lower) ||
        this.config.getLocalizedPanelName(key, panel.name).toLowerCase().includes(lower)
      );
    }

    return entries;
  }

  private renderPanelCategoryPills(): void {
    const bar = this.overlay.querySelector('#usPanelCatBar');
    if (!bar) return;

    const categories = this.getAvailablePanelCategories();
    setTrustedHtml(bar, trustedHtml(categories.map(c =>
      `<button class="unified-settings-region-pill${this.activePanelCategory === c.key ? ' active' : ''}" data-panel-cat="${c.key}">${escapeHtml(c.label)}</button>`
    ).join(''), "legacy direct innerHTML migration"));
  }

  private renderPanelsTab(): void {
    const container = this.overlay.querySelector('#usPanelToggles');
    if (!container) return;

    const savedSettings = this.config.getPanelSettings();
    const pro = isProUser();
    const entries = this.getVisiblePanelEntries();
    setTrustedHtml(container, trustedHtml(entries.map(([key, panel]) => {
      // Preserve saved config for dynamic cw-* panels; unknown keys should not
      // collapse to getEffectivePanelConfig's disabled synthetic fallback.
      const resolvedPanel = ALL_PANELS[key] ? getEffectivePanelConfig(key, SITE_VARIANT) : panel;
      const entitled = isPanelEntitled(key, resolvedPanel, pro);
      const locked = !entitled;
      const changed = !locked && savedSettings[key]?.enabled !== panel.enabled;
      const displayName = this.config.getLocalizedPanelName(key, resolvedPanel.name ?? panel.name);
      return `
        <div class="panel-toggle-item ${panel.enabled && !locked ? 'active' : ''}${changed ? ' changed' : ''}${locked ? ' pro-locked' : ''}" data-panel="${escapeHtml(key)}" aria-pressed="${panel.enabled && !locked}" ${locked ? 'data-pro-locked="1"' : ''}>
          <div class="panel-toggle-checkbox">${panel.enabled && !locked ? '\u2713' : ''}${locked ? '\uD83D\uDD12' : ''}</div>
          <span class="panel-toggle-label">${escapeHtml(displayName)}</span>
          ${(locked || resolvedPanel.premium) ? '<span class="panel-toggle-pro-badge">PRO</span>' : ''}
        </div>
      `;
    }).join(''), "legacy direct innerHTML migration"));

    this.updatePanelsFooter();
  }

  private clonePanelSettings(source: Record<string, PanelConfig> = this.config.getPanelSettings()): Record<string, PanelConfig> {
    const cloned: Record<string, PanelConfig> = Object.fromEntries(
      Object.entries(source).map(([key, panel]) => [key, { ...panel }]),
    );
    const variantDefaults = new Set(VARIANT_DEFAULTS[SITE_VARIANT] ?? []);
    for (const key of Object.keys(ALL_PANELS)) {
      if (!(key in cloned)) {
        cloned[key] = { ...getEffectivePanelConfig(key, SITE_VARIANT), enabled: variantDefaults.has(key) };
      }
    }
    return cloned;
  }

  private resetPanelDraft(): void {
    this.draftPanelSettings = this.clonePanelSettings();
    this.panelsJustSaved = false;
  }

  private hasPendingPanelChanges(): boolean {
    const savedSettings = this.config.getPanelSettings();
    return Object.entries(this.draftPanelSettings).some(([key, panel]) => savedSettings[key]?.enabled !== panel.enabled);
  }

  private toggleDraftPanel(key: string): void {
    const panel = this.draftPanelSettings[key];
    if (!panel) return;
    // Preserve saved config for dynamic cw-* panels; unknown keys should not
    // collapse to getEffectivePanelConfig's disabled synthetic fallback.
    const resolvedPanel = ALL_PANELS[key] ? getEffectivePanelConfig(key, SITE_VARIANT) : panel;
    if (!panel.enabled && !isPanelEntitled(key, resolvedPanel, isProUser())) return;
    if (!panel.enabled && isFreePanelCapBlocking(isProUser()) && isFreePanelCapCounted(key)) {
      const enabledCount = countFreePanelCapUsage(this.draftPanelSettings);
      if (enabledCount >= FREE_MAX_PANELS) {
        showToast(t('modals.settingsWindow.freePanelLimit', { max: String(FREE_MAX_PANELS) }));
        return;
      }
    }
    panel.enabled = !panel.enabled;
    this.panelsJustSaved = false;
    this.renderPanelsTab();
  }

  private savePanelChanges(): void {
    if (!this.hasPendingPanelChanges()) return;
    this.config.savePanelSettings(Object.fromEntries(Object.entries(this.draftPanelSettings).map(([k, v]) => [k, { ...v }])));
    this.draftPanelSettings = this.clonePanelSettings();
    this.panelsJustSaved = true;
    this.renderPanelsTab();
    if (this.savedTimeout) clearTimeout(this.savedTimeout);
    this.savedTimeout = setTimeout(() => {
      this.panelsJustSaved = false;
      this.savedTimeout = null;
      this.updatePanelsFooter();
    }, 2000);
  }

  private updatePanelsFooter(): void {
    const status = this.overlay.querySelector<HTMLElement>('#usPanelsStatus');
    const saveButton = this.overlay.querySelector<HTMLButtonElement>('.panels-save-layout');
    const hasPendingChanges = this.hasPendingPanelChanges();

    if (saveButton) {
      saveButton.disabled = !hasPendingChanges;
    }

    if (status) {
      status.textContent = this.panelsJustSaved ? t('modals.settingsWindow.saved') : '';
      status.classList.toggle('visible', this.panelsJustSaved);
    }
  }

  private getAvailableRegions(): Array<{ key: string; label: string }> {
    // A region pill shows when at least one of its sources is actually being
    // loaded — getAllSourceNames() covers the active preset PLUS any cross-
    // variant panels the user enabled, so customized-in regions appear too.
    const allowed = new Set(this.config.getAllSourceNames());
    const regions: Array<{ key: string; label: string }> = [
      { key: 'all', label: t('header.sourceRegionAll') }
    ];

    for (const [regionKey, regionDef] of Object.entries(SOURCE_REGION_MAP)) {
      if (regionKey === 'intel') {
        if (INTEL_SOURCES.length > 0) {
          regions.push({ key: regionKey, label: t(regionDef.labelKey) });
        }
        continue;
      }
      const hasFeeds = regionDef.feedKeys.some(fk =>
        (CANONICAL_FEEDS[fk] ?? []).some(f => allowed.has(f.name)));
      if (hasFeeds) {
        regions.push({ key: regionKey, label: t(regionDef.labelKey) });
      }
    }

    return regions;
  }

  private getSourcesByRegion(): Map<string, string[]> {
    const map = new Map<string, string[]>();
    // Resolve region membership from CANONICAL_FEEDS (the all-variant union),
    // then intersect with the sources actually loaded — getAllSourceNames()
    // already covers the active preset + any custom panels the user enabled —
    // so a customized-in panel's sources show under their proper region pill,
    // not just the 'all' view.
    const allowed = new Set(this.config.getAllSourceNames());

    for (const [regionKey, regionDef] of Object.entries(SOURCE_REGION_MAP)) {
      const sources: string[] = [];
      if (regionKey === 'intel') {
        INTEL_SOURCES.forEach(f => sources.push(f.name));
      } else {
        for (const fk of regionDef.feedKeys) {
          for (const f of CANONICAL_FEEDS[fk] ?? []) {
            if (allowed.has(f.name)) sources.push(f.name);
          }
        }
      }
      if (sources.length > 0) {
        map.set(regionKey, sources.sort((a, b) => a.localeCompare(b)));
      }
    }

    return map;
  }

  private getVisibleSourceNames(): string[] {
    let sources: string[];
    if (this.activeSourceRegion === 'all') {
      sources = this.config.getAllSourceNames();
    } else {
      const byRegion = this.getSourcesByRegion();
      sources = byRegion.get(this.activeSourceRegion) || [];
    }

    if (this.sourceFilter) {
      const lower = this.sourceFilter.toLowerCase();
      sources = sources.filter(s => s.toLowerCase().includes(lower));
    }

    return sources;
  }

  private renderRegionPills(): void {
    const bar = this.overlay.querySelector('#usRegionBar');
    if (!bar) return;

    const regions = this.getAvailableRegions();
    setTrustedHtml(bar, trustedHtml(regions.map(r =>
      `<button class="unified-settings-region-pill${this.activeSourceRegion === r.key ? ' active' : ''}" data-region="${r.key}">${escapeHtml(r.label)}</button>`
    ).join(''), "legacy direct innerHTML migration"));
  }

  private renderSourcesGrid(): void {
    const container = this.overlay.querySelector('#usSourceToggles');
    if (!container) return;

    const sources = this.getVisibleSourceNames();
    const disabled = this.config.getDisabledSources();

    setTrustedHtml(container, trustedHtml(sources.map(source => {
      const isEnabled = !disabled.has(source);
      const escaped = escapeHtml(source);
      return `
        <div class="source-toggle-item ${isEnabled ? 'active' : ''}" data-source="${escaped}">
          <div class="source-toggle-checkbox">${isEnabled ? '\u2713' : ''}</div>
          <span class="source-toggle-label">${escaped}</span>
        </div>
      `;
    }).join(''), "legacy direct innerHTML migration"));
  }

  private updateSourcesCounter(): void {
    const counter = this.overlay.querySelector('#usSourcesCounter');
    if (!counter) return;

    const disabled = this.config.getDisabledSources();
    const allSources = this.config.getAllSourceNames();
    const enabledTotal = allSources.length - disabled.size;

    counter.textContent = t('header.sourcesEnabled', { enabled: String(enabledTotal), total: String(allSources.length) });
  }

  private async loadPlanLimitNotices(): Promise<void> {
    if (!getAuthState().user || this.planLimitNoticesLoading) return;
    this.planLimitNoticesLoading = true;
    try {
      this.planLimitNotices = await listCurrentPlanLimitNotices();
    } catch (err) {
      console.warn('[settings] Failed to load API plan-limit notices:', err);
      this.planLimitNotices = [];
    } finally {
      this.planLimitNoticesLoading = false;
      this.renderPlanLimitNoticeBlocks();
    }
  }

  private renderPlanLimitNoticeBlocks(): void {
    const html = this.renderPlanLimitNotices();
    this.overlay.querySelectorAll<HTMLElement>('[data-plan-limit-notices]').forEach((el) => {
      setTrustedHtml(el, trustedHtml(html, "legacy direct innerHTML migration"));
    });
  }

  private planLimitDimensionLabel(dimension: ApiPlanLimitNotice['dimension']): string {
    switch (dimension) {
      case 'api_daily_requests': return 'Daily API requests';
      case 'api_minute_burst': return 'API burst traffic';
      case 'mcp_daily_calls': return 'Daily MCP calls';
      case 'mcp_minute_burst': return 'MCP burst traffic';
    }
  }

  private planLimitStateLabel(state: ApiPlanLimitNotice['state']): string {
    if (state === 'warning') return 'Nearing plan limit';
    if (state === 'sustained_burst') return 'Burst limit exceeded';
    return 'Plan limit exceeded';
  }

  private renderPlanLimitNotices(): string {
    if (this.planLimitNotices.length === 0) return '';
    const nf = new Intl.NumberFormat();
    return `
      <div class="api-plan-limit-notices" aria-live="polite">
        ${this.planLimitNotices.map((notice) => {
          const limit = notice.limit == null ? 'unlimited' : nf.format(notice.limit);
          const usage = nf.format(notice.usage);
          const ratio = notice.usageRatio == null ? '' : ` (${Math.round(notice.usageRatio * 100)}%)`;
          const cta = notice.ctaKind === 'contact_support'
            ? 'Contact support'
            : notice.ctaKind === 'billing_portal'
            ? 'Manage billing'
            : notice.ctaKind === 'checkout'
            ? 'Upgrade'
            : '';
          return `
            <div class="api-plan-limit-notice ${escapeHtml(notice.state)}">
              <div class="api-plan-limit-notice-main">
                <div class="api-plan-limit-notice-title">${escapeHtml(this.planLimitStateLabel(notice.state))}</div>
                <div class="api-plan-limit-notice-body">
                  ${escapeHtml(this.planLimitDimensionLabel(notice.dimension))}: ${escapeHtml(usage)} used / ${escapeHtml(limit)} included${escapeHtml(ratio)} in ${escapeHtml(notice.windowKey)}.
                  You can upgrade for more room or reduce traffic to stay on this plan.
                </div>
              </div>
              <div class="api-plan-limit-notice-actions">
                ${cta ? `<button class="btn btn-primary api-plan-limit-notice-cta" data-plan-limit-cta="${escapeHtml(notice._id)}">${escapeHtml(cta)}</button>` : ''}
                <button class="btn btn-ghost api-plan-limit-notice-ack" data-plan-limit-ack="${escapeHtml(notice._id)}">Dismiss</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  private async handleAcknowledgePlanLimitNotice(noticeId: string): Promise<void> {
    try {
      await acknowledgePlanLimitNotice(noticeId);
      this.planLimitNotices = this.planLimitNotices.filter((notice) => notice._id !== noticeId);
      this.renderPlanLimitNoticeBlocks();
    } catch (err) {
      console.warn('[settings] Failed to acknowledge API plan-limit notice:', err);
      showToast('Could not dismiss this notice. Try again.');
    }
  }

  private handlePlanLimitNoticeCta(noticeId: string): void {
    const notice = this.planLimitNotices.find((item) => item._id === noticeId);
    if (!notice) return;
    if (notice.ctaKind === 'billing_portal') {
      const reservedWin = prereserveBillingPortalTab();
      void openBillingPortal(reservedWin).then((result) => {
        if (result.outcome === 'no-customer') {
          showToast('Subscription is managed outside Dodo. Email support@worldmonitor.app for help.');
        }
      });
      return;
    }
    if (notice.ctaKind === 'checkout') {
      // Never send an active subscriber to a fresh checkout. The upgrade target
      // (api_starter) sits in a DIFFERENT tierGroup than an existing Pro sub, and
      // getCheckoutBlockingSubscription only blocks a same-tierGroup duplicate
      // (#4797) — so startCheckout would STACK a second live subscription and
      // double-charge. Route entitled users to the billing portal instead (same
      // precedent as handleUpgradeClick); its no-customer outcome surfaces the
      // support path for a subscription managed outside Dodo.
      //
      // isSupporter() rather than the fork's always-true isEntitled(), so a
      // genuinely unsubscribed user still reaches checkout from this notice.
      if (isSupporter()) {
        const reservedWin = prereserveBillingPortalTab();
        void openBillingPortal(reservedWin).then((result) => {
          if (result.outcome === 'no-customer') {
            showToast('Subscription is managed outside Dodo. Email support@worldmonitor.app for help.');
          }
        });
        return;
      }
      this.close();
      import('@/services/checkout').then(m => import('@/config/products').then((p) => {
        const product = notice.upgradeTargetPlanKey === 'api_starter'
          ? p.DODO_PRODUCTS.API_STARTER_MONTHLY
          : p.DODO_PRODUCTS.PRO_MONTHLY;
        return m.startCheckout(product);
      })).catch(() => {
        window.open('https://brians-world-monitor.vercel.app/pro', '_blank', 'noopener,noreferrer');
      });
      return;
    }
    if (notice.ctaKind === 'contact_support') {
      window.location.href = `mailto:support@worldmonitor.app?subject=${encodeURIComponent('WorldMonitor API plan limit upgrade')}`;
    }
  }

  // ---------------------------------------------------------------------------
  // API Keys tab
  // ---------------------------------------------------------------------------

  private attachApiKeysHandlers(): void {
    // Enter to submit (only exists when entitled user sees full UI)
    const apiKeyInput = this.overlay.querySelector<HTMLInputElement>('.api-keys-name-input');
    if (apiKeyInput) {
      apiKeyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') void this.handleCreateApiKey();
      });
    }

    // Gate CTA click (sign-in for anonymous, checkout for free)
    const gateBtn = this.overlay.querySelector<HTMLElement>('.api-keys-gate-btn');
    if (gateBtn) {
      gateBtn.addEventListener('click', () => {
        if (!getAuthState().user) {
          this.close();
          import('@/services/clerk').then(m => m.openSignIn()).catch(() => {});
        } else {
          this.close();
          import('@/services/checkout').then(m => import('@/config/products').then(p => m.startCheckout(p.DODO_PRODUCTS.API_STARTER_MONTHLY))).catch(() => {
            window.open('https://brians-world-monitor.vercel.app/pro', '_blank', 'noopener,noreferrer');
          });
        }
      });
    }
  }

  private renderApiKeysContent(): string {
    const authState = getAuthState();

    if (!authState.user) {
      const lockIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`;
      return `
        <div class="panel-locked-state">
          <div class="panel-locked-icon">${lockIcon}</div>
          <div class="panel-locked-desc">Sign in to unlock API Keys</div>
          <button class="panel-locked-cta api-keys-gate-btn">Sign In</button>
        </div>`;
    }

    if (!hasFeature('apiAccess')) {
      const upgradeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="16 12 12 8 8 12"/><line x1="12" y1="16" x2="12" y2="8"/></svg>`;
      return `
        <div class="panel-locked-state">
          <div class="panel-locked-icon">${upgradeIcon}</div>
          <div class="panel-locked-desc">Create and manage API keys to access WorldMonitor data programmatically.</div>
          <button class="panel-locked-cta api-keys-gate-btn">Upgrade to API Starter</button>
        </div>`;
    }

    return `
      <div class="api-keys-section">
        <div data-plan-limit-notices>${this.renderPlanLimitNotices()}</div>
        <div class="api-keys-header">
          <p class="api-keys-desc">Create API keys to access WorldMonitor data programmatically. Keys are shown once on creation — store them securely.</p>
        </div>
        <div class="api-keys-create-form">
          <input type="text" class="api-keys-name-input" placeholder="Key name (e.g. my-app)" maxlength="64" />
          <button class="btn btn-primary api-keys-create-btn">Create Key</button>
        </div>
        <div class="api-keys-created-banner" id="usApiKeysBanner" style="display:none;"></div>
        <div class="api-keys-error" id="usApiKeysError" style="display:none;"></div>
        <div class="api-keys-list" id="usApiKeysList">
          <div class="api-keys-loading">Loading...</div>
        </div>
      </div>`;
  }

  private async loadApiKeys(): Promise<void> {
    this.apiKeysLoading = true;
    this.apiKeysError = '';
    this.renderApiKeysList();

    try {
      this.apiKeys = await listApiKeys();
    } catch (err) {
      this.apiKeysError = err instanceof Error ? err.message : 'Failed to load keys';
    } finally {
      this.apiKeysLoading = false;
      this.renderApiKeysList();
    }
  }

  private async handleCreateApiKey(): Promise<void> {
    const input = this.overlay.querySelector<HTMLInputElement>('.api-keys-name-input');
    const btn = this.overlay.querySelector<HTMLButtonElement>('.api-keys-create-btn');
    const name = input?.value.trim();
    if (!name || !input || !btn) return;

    btn.disabled = true;
    btn.textContent = 'Creating...';
    this.apiKeysError = '';
    this.newlyCreatedKey = null;
    this.hideBanner();

    try {
      const result = await createApiKey(name);
      this.newlyCreatedKey = result.key;
      input.value = '';
      this.showCreatedBanner(result.key);
      await this.loadApiKeys();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create key';
      this.apiKeysError = msg.includes('KEY_LIMIT_REACHED')
        ? 'Maximum of 5 active keys reached. Revoke an existing key first.'
        : msg.includes('API_ACCESS_REQUIRED')
        ? 'API keys require an API access subscription (API Starter or higher).'
        : msg;
      this.renderApiKeysError();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create Key';
    }
  }

  private async handleRevokeApiKey(keyId: string): Promise<void> {
    const keyInfo = this.apiKeys.find(k => k.id === keyId);
    const keyName = keyInfo?.name ?? 'this key';
    if (!confirm(`Revoke "${keyName}"? This cannot be undone. Any applications using this key will stop working.`)) return;

    try {
      await revokeApiKey(keyId);
      await this.loadApiKeys();
    } catch (err) {
      this.apiKeysError = err instanceof Error ? err.message : 'Failed to revoke key';
      this.renderApiKeysError();
    }
  }

  private showCreatedBanner(key: string): void {
    const banner = this.overlay.querySelector<HTMLElement>('#usApiKeysBanner');
    if (!banner) return;

    banner.style.display = 'block';
    setTrustedHtml(banner, trustedHtml(`
      <div class="api-keys-banner-title">Key created — copy it now, it won't be shown again</div>
      <div class="api-keys-banner-key">
        <code class="api-keys-key-value">${escapeHtml(key)}</code>
        <button class="btn btn-secondary api-keys-copy-btn">Copy</button>
      </div>
    `, "legacy direct innerHTML migration"));
  }

  private hideBanner(): void {
    const banner = this.overlay.querySelector<HTMLElement>('#usApiKeysBanner');
    if (banner) {
      banner.style.display = 'none';
      setTrustedHtml(banner, trustedHtml('', "legacy direct innerHTML migration"));
    }
  }

  private renderApiKeysError(): void {
    const el = this.overlay.querySelector<HTMLElement>('#usApiKeysError');
    if (!el) return;
    if (this.apiKeysError) {
      el.style.display = 'block';
      el.textContent = this.apiKeysError;
    } else {
      el.style.display = 'none';
      el.textContent = '';
    }
  }

  private renderApiKeysList(): void {
    const container = this.overlay.querySelector('#usApiKeysList');
    if (!container) return;

    if (this.apiKeysLoading && this.apiKeys.length === 0) {
      setTrustedHtml(container, trustedHtml('<div class="api-keys-loading">Loading...</div>', "legacy direct innerHTML migration"));
      return;
    }

    this.renderApiKeysError();

    const active = this.apiKeys.filter(k => !k.revokedAt);
    const revoked = this.apiKeys.filter(k => k.revokedAt);

    if (active.length === 0 && revoked.length === 0) {
      setTrustedHtml(container, trustedHtml('<div class="api-keys-empty">No API keys yet. Create one above to get started.</div>', "legacy direct innerHTML migration"));
      return;
    }

    const formatDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

    const renderKey = (k: ApiKeyInfo) => {
      const isRevoked = !!k.revokedAt;
      return `
        <div class="api-keys-item${isRevoked ? ' revoked' : ''}">
          <div class="api-keys-item-main">
            <span class="api-keys-item-name">${escapeHtml(k.name)}</span>
            <code class="api-keys-item-prefix">${escapeHtml(k.keyPrefix)}${'*'.repeat(8)}</code>
          </div>
          <div class="api-keys-item-meta">
            <span>Created ${formatDate(k.createdAt)}</span>
            ${k.lastUsedAt ? `<span>Last used ${formatDate(k.lastUsedAt)}</span>` : ''}
            ${isRevoked ? `<span class="api-keys-item-revoked-badge">Revoked ${formatDate(k.revokedAt!)}</span>` : ''}
          </div>
          ${!isRevoked ? `<button class="btn btn-ghost api-keys-revoke-btn" data-key-id="${escapeHtml(k.id)}">Revoke</button>` : ''}
        </div>
      `;
    };

    setTrustedHtml(container, trustedHtml(active.map(renderKey).join('')
      + (revoked.length > 0 ? `<div class="api-keys-revoked-section"><div class="api-keys-revoked-label">Revoked</div>${revoked.map(renderKey).join('')}</div>` : ''), "legacy direct innerHTML migration"));
  }

  // ---------------------------------------------------------------------------
  // Connected MCP clients tab (plan 2026-05-10-001 U9)
  //
  // Distinct from the API Keys tab above (gated on `apiAccess`). This tab is
  // gated on `mcpAccess` so Pro users (where `apiAccess === false`) see ONLY
  // this tab. API Starter+ users (`apiAccess && mcpAccess`) see BOTH tabs;
  // they manage independent surfaces (manual API keys vs auto-issued OAuth
  // tokens for Claude Desktop / Cursor / etc).
  // ---------------------------------------------------------------------------

  private renderMcpClientsContent(): string {
    const authState = getAuthState();

    if (!authState.user) {
      const lockIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`;
      return `
        <div class="panel-locked-state">
          <div class="panel-locked-icon">${lockIcon}</div>
          <div class="panel-locked-desc">Sign in to manage connected MCP clients</div>
        </div>`;
    }

    if (!hasFeature('mcpAccess')) {
      // Defensive — if the user lost mcpAccess (subscription lapsed) but the
      // tab was still rendered, show an upgrade CTA. Normal flow hides the
      // tab entirely.
      const upgradeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="16 12 12 8 8 12"/><line x1="12" y1="16" x2="12" y2="8"/></svg>`;
      return `
        <div class="panel-locked-state">
          <div class="panel-locked-icon">${upgradeIcon}</div>
          <div class="panel-locked-desc">Connect Claude Desktop and other AI clients to your WorldMonitor account.</div>
        </div>`;
    }

    return `
      <div class="mcp-clients-section">
        <div data-plan-limit-notices>${this.renderPlanLimitNotices()}</div>
        <div class="mcp-clients-header">
          <p class="mcp-clients-desc">Connect Claude Desktop, Cursor, and other AI clients to your WorldMonitor account. Each client gets its own credential — revoke any time.</p>
        </div>
        <div class="mcp-clients-quota" id="usMcpQuota" aria-live="polite">${this.renderMcpQuotaText()}</div>
        <div class="mcp-clients-error" id="usMcpClientsError" style="display:none;"></div>
        <div class="mcp-clients-list" id="usMcpClientsList">
          <div class="mcp-clients-loading">Loading...</div>
        </div>
      </div>`;
  }

  private renderMcpQuotaText(): string {
    const q = this.mcpQuota;
    if (!q) {
      return `<span class="mcp-clients-quota-loading">Loading quota...</span>`;
    }
    const reset = this.formatQuotaReset(q.resetsAt);
    return `<span class="mcp-clients-quota-label">MCP daily quota:</span>
      <strong>${q.used} / ${q.limit}</strong>
      <span class="mcp-clients-quota-reset">used today, resets ${escapeHtml(reset)}</span>`;
  }

  private formatQuotaReset(iso: string): string {
    const ts = Date.parse(iso);
    if (!Number.isFinite(ts)) return 'at next UTC midnight';
    const ms = ts - Date.now();
    if (ms <= 0) return 'momentarily';
    const totalSec = Math.floor(ms / 1000);
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    if (hrs > 0) return `in ${hrs}h ${mins}m`;
    if (mins > 0) return `in ${mins}m`;
    return 'in under a minute';
  }

  private async loadMcpClients(): Promise<void> {
    this.mcpClientsLoading = true;
    this.mcpClientsError = '';
    this.renderMcpClientsList();

    try {
      this.mcpClients = await listMcpClients();
    } catch (err) {
      this.mcpClientsError = err instanceof Error ? err.message : 'Failed to load MCP clients';
    } finally {
      this.mcpClientsLoading = false;
      this.renderMcpClientsList();
    }

    // Kick a fresh quota fetch alongside the list so the user sees current
    // numbers immediately on tab open (the polling timer takes 30s otherwise).
    void this.refreshMcpQuota();
  }

  private async refreshMcpQuota(): Promise<void> {
    try {
      this.mcpQuota = await fetchMcpQuota();
    } catch {
      // fetchMcpQuota already returns sane fallbacks, but defensive catch.
      this.mcpQuota = null;
    }
    this.renderMcpQuotaInPlace();
  }

  private renderMcpQuotaInPlace(): void {
    const el = this.overlay.querySelector<HTMLElement>('#usMcpQuota');
    if (el) setTrustedHtml(el, trustedHtml(this.renderMcpQuotaText(), "legacy direct innerHTML migration"));
  }

  /**
   * Auto-refresh the quota counter every 30s while the tab is visible.
   * Cleared on tab-switch, close(), and destroy() — see stopMcpQuotaPolling.
   */
  private startMcpQuotaPolling(): void {
    if (this.mcpQuotaTimer) return; // idempotent
    this.mcpQuotaTimer = setInterval(() => {
      // Skip silently if the tab is no longer visible — can happen if the
      // overlay was hidden via display:none rather than full destroy().
      if (this.activeTab !== 'mcp-clients') return;
      void this.refreshMcpQuota();
    }, 30_000);
  }

  private stopMcpQuotaPolling(): void {
    if (this.mcpQuotaTimer) {
      clearInterval(this.mcpQuotaTimer);
      this.mcpQuotaTimer = null;
    }
  }

  private async handleRevokeMcpClient(tokenId: string): Promise<void> {
    const client = this.mcpClients.find(c => c.id === tokenId);
    const label = client?.name?.trim() ? `"${client.name}"` : 'this client';
    if (!confirm(`Revoke ${label}? The connected AI client will need to re-authorize before its next request.`)) return;

    try {
      await revokeMcpClient(tokenId);
      // Refresh both list (Convex query result cached locally) and quota
      // (revoke does not change the daily counter, but the user might have
      // crossed the boundary while the modal was open).
      await this.loadMcpClients();
    } catch (err) {
      this.mcpClientsError = err instanceof Error ? err.message : 'Failed to revoke MCP client';
      this.renderMcpClientsError();
    }
  }

  private renderMcpClientsError(): void {
    const el = this.overlay.querySelector<HTMLElement>('#usMcpClientsError');
    if (!el) return;
    if (this.mcpClientsError) {
      el.style.display = 'block';
      el.textContent = this.mcpClientsError;
    } else {
      el.style.display = 'none';
      el.textContent = '';
    }
  }

  private renderMcpClientsList(): void {
    const container = this.overlay.querySelector('#usMcpClientsList');
    if (!container) return;

    if (this.mcpClientsLoading && this.mcpClients.length === 0) {
      setTrustedHtml(container, trustedHtml('<div class="mcp-clients-loading">Loading...</div>', "legacy direct innerHTML migration"));
      return;
    }

    this.renderMcpClientsError();

    const active = this.mcpClients.filter(c => !c.revokedAt);
    const revoked = this.mcpClients.filter(c => c.revokedAt);

    if (active.length === 0 && revoked.length === 0) {
      const mcpUrl = 'https://brians-world-monitor.vercel.app/mcp';
      setTrustedHtml(container, trustedHtml(`
        <div class="mcp-clients-empty">
          <div class="mcp-clients-empty-title">No connected MCP clients yet</div>
          <div class="mcp-clients-empty-desc">To connect Claude Desktop or another AI client, paste this URL into the client's MCP server settings and sign in with your WorldMonitor Pro account:</div>
          <div class="mcp-clients-empty-url">
            <code>${escapeHtml(mcpUrl)}</code>
            <button class="btn btn-secondary mcp-clients-copy-url-btn" data-copy-value="${escapeHtml(mcpUrl)}">Copy URL</button>
          </div>
        </div>`, "legacy direct innerHTML migration"));
      return;
    }

    const formatDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    const formatRelative = (ts: number): string => {
      const ms = Date.now() - ts;
      const sec = Math.floor(ms / 1000);
      if (sec < 60) return 'just now';
      const min = Math.floor(sec / 60);
      if (min < 60) return `${min}m ago`;
      const hrs = Math.floor(min / 60);
      if (hrs < 24) return `${hrs}h ago`;
      return formatDate(ts);
    };

    const renderClient = (c: McpClientInfo) => {
      const isRevoked = !!c.revokedAt;
      const name = c.name?.trim() || 'Connected MCP client';
      const lastUsed = c.lastUsedAt ? formatRelative(c.lastUsedAt) : 'never';
      return `
        <div class="mcp-clients-item${isRevoked ? ' revoked' : ''}">
          <div class="mcp-clients-item-main">
            <span class="mcp-clients-item-name">${escapeHtml(name)}</span>
          </div>
          <div class="mcp-clients-item-meta">
            <span>Connected ${formatDate(c.createdAt)}</span>
            <span>Last used ${escapeHtml(lastUsed)}</span>
            ${isRevoked ? `<span class="mcp-clients-item-revoked-badge">Revoked ${formatDate(c.revokedAt!)}</span>` : ''}
          </div>
          ${!isRevoked ? `<button class="btn btn-ghost mcp-clients-revoke-btn" data-token-id="${escapeHtml(c.id)}">Revoke</button>` : ''}
        </div>
      `;
    };

    setTrustedHtml(container, trustedHtml(active.map(renderClient).join('')
      + (revoked.length > 0 ? `<div class="mcp-clients-revoked-section"><div class="mcp-clients-revoked-label">Revoked</div>${revoked.map(renderClient).join('')}</div>` : ''), "legacy direct innerHTML migration"));
  }
}
