/**
 * "Is this person actually paying us?" — the honest subscription signal.
 *
 * Why this exists alongside `panel-gating.hasPremiumAccess()` and
 * `entitlements.isEntitled()`: both of those are hard-wired to `true` in this
 * fork, on purpose. The fork self-hosts its own backend, so every panel,
 * layer and map surface is unlocked for everyone and must stay that way.
 * That makes them useless for answering a different question — whether to
 * show someone an upgrade path, or to thank them for subscribing.
 *
 * So this module reads the underlying billing facts directly:
 *   - an active (or in-grace) Dodo subscription, or
 *   - a Clerk `pro` role, or
 *   - a Convex entitlement snapshot on a non-free plan.
 *
 * HARD RULE: nothing in the dashboard's rendering path may gate content on
 * `isSupporter()`. It may only decide between "offer Pro" and "thank you",
 * and lift the hosted briefing allowance. If you find yourself hiding a
 * layer, panel, camera, globe mode or reader view behind this, stop — that is
 * the paywall this product deliberately does not have.
 */

import { getAuthState } from './auth-state';
import { getSubscription, onSubscriptionChange } from './billing';
import { getEntitlementState, onEntitlementChange } from './entitlements';

/**
 * True when a real payment relationship exists.
 *
 * `on_hold` counts: a subscriber whose card just failed is still a customer,
 * and pitching them a fresh checkout instead of a payment-method fix is how
 * duplicate subscriptions get created (see billing.ts / the 2026-04 incident
 * notes in panel-gating.ts).
 */
export function isSupporter(): boolean {
  const sub = getSubscription();
  if (sub && (sub.status === 'active' || sub.status === 'on_hold')) return true;

  if (getAuthState().user?.role === 'pro') return true;

  const ent = getEntitlementState();
  if (ent && ent.planKey && ent.planKey !== 'free' && ent.features.tier >= 1) {
    if (ent.validUntil === 0 || ent.validUntil > Date.now()) return true;
  }

  return false;
}

/**
 * Display name for the current plan — "Pro" unless Dodo told us something
 * more specific (e.g. "API Starter").
 */
export function getSupporterPlanName(): string {
  return getSubscription()?.displayName ?? 'Pro';
}

/**
 * Fire `cb` whenever the paying-or-not answer could have changed. Both
 * upstream subscriptions deliver late snapshots over a Convex WebSocket, so
 * callers that render a CTA need to re-render rather than trust first paint.
 * Returns an unsubscribe function.
 */
export function onSupporterChange(cb: (supporter: boolean) => void): () => void {
  let last = isSupporter();
  const emit = (): void => {
    const next = isSupporter();
    if (next === last) return;
    last = next;
    cb(next);
  };
  const offSub = onSubscriptionChange(emit);
  const offEnt = onEntitlementChange(emit);
  return () => {
    offSub();
    offEnt();
  };
}
